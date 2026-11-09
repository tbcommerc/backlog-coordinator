"""PostgreSQL-backed queue. Each accepted run dispatches one extraction request.

Queued work survives restarts. Interrupted claims expire without automatic
LLM retries: a user must explicitly request a new run after a failure.
"""
import logging
import threading
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pydantic import ValidationError

from meeting_contract import MeetingDraft
from models import MeetingCapture
from notifications import _create_notification

logger = logging.getLogger("dmb_backlog.meeting_analysis")
ACTIVE = ("queued", "running")
RUN_TIMEOUT_SECONDS = 600
ERROR_MESSAGES = {
    "meeting_ai_quota": "Провайдер AI ограничил доступный лимит. Попросите администратора проверить квоту и лимиты, затем запустите анализ явно. Черновик сохранён.",
    "meeting_service_auth": "Не удалось авторизовать подключение к сервису анализа. Попросите администратора проверить подключение. Черновик сохранён.",
    "meeting_service_configuration": "Сервис анализа не поддерживает текущий запрос. Попросите администратора проверить подключение и настройки. Черновик сохранён.",
    "operation_forbidden": "Право на выполнение анализа отозвано. Результат не применён; исходные правки сохранены.",
    "result_expired": "Срок хранения результата анализа истёк. Черновик сохранён; новый анализ запускается только по вашему решению.",
    "invalid_input": "Сервис анализа отклонил формат или размер исходного текста. Исправьте источник или продолжите вручную; черновик сохранён.",
    "operation_limit": "Достигнут лимит вызовов этого разбора. Черновик сохранён; новый анализ запускается только по вашему решению.",
    "cancelled": "Анализ отменён. Исходная расшифровка и ручные правки сохранены.",
    "source_conflict": "Разбор изменён во время анализа. Результат не применён; исходные правки сохранены.",
    "meeting_ai_auth": "Провайдер AI отклонил авторизацию. Администратору нужно проверить ключ и доступ к модели.",
    "invalid_result": "Агент вернул непроверяемый результат. Исходная расшифровка сохранена.",
    "interrupted": "Обработка прервана или превысила время ожидания. Можно явно запустить новый анализ.",
    "unavailable": "Не удалось завершить анализ. Исходная расшифровка сохранена; можно повторить попытку или продолжить вручную.",
}


def now():
    return datetime.now(timezone.utc)


def analysis_info(row):
    fields = ("analysis_status", "analysis_run_id", "analysis_requested_at", "analysis_started_at", "analysis_finished_at", "analysis_error_code")
    return {**{key: getattr(row, key) for key in fields},
            "analysis_error_message": ERROR_MESSAGES.get(row.analysis_error_code)}


def expire_runs(db, timestamp=None):
    timestamp = timestamp or now()
    count = db.query(MeetingCapture).filter(
        MeetingCapture.status == "draft",
        MeetingCapture.analysis_status == "running",
        MeetingCapture.analysis_backend == "legacy",
        MeetingCapture.analysis_started_at < timestamp - timedelta(seconds=RUN_TIMEOUT_SECONDS),
    ).update({"analysis_status": "failed", "analysis_error_code": "interrupted",
              "analysis_finished_at": timestamp, "updated_at": timestamp,
              "version": MeetingCapture.version + 1}, synchronize_session=False)
    db.commit()
    return count


def claim_run(db):
    row = db.query(MeetingCapture).filter_by(status="draft", analysis_status="queued", analysis_backend="legacy").order_by(
        MeetingCapture.analysis_requested_at, MeetingCapture.id).with_for_update(skip_locked=True).first()
    if row is None:
        db.rollback()
        return None
    timestamp = now()
    claimed = {"id": row.id, "run_id": row.analysis_run_id, "transcript": row.transcript,
               "meeting_date": row.meeting_date, "version": row.version}
    # CAS also protects tests/dialects without SELECT FOR UPDATE support.
    count = db.query(MeetingCapture).filter_by(id=row.id, analysis_status="queued",
        analysis_run_id=row.analysis_run_id, version=row.version).update({
            "analysis_status": "running", "analysis_started_at": timestamp,
            "updated_at": timestamp}, synchronize_session=False)
    db.commit()
    return claimed if count == 1 else None


def execute_run(session_factory, claimed, call_agent):
    error_code, items = None, None
    try:
        result = call_agent("POST", "/api/agent/meetings/extract", {
            "transcript": claimed["transcript"],
            "meeting_date": str(claimed["meeting_date"]) if claimed["meeting_date"] else None})
        draft = MeetingDraft(title="Проверка", transcript=claimed["transcript"], items=result["items"])
        if any(item.origin != "ai" or item.selected or item.task_id or item.link_choice for item in draft.items):
            raise ValueError("Invalid agent output")
        items = [item.model_dump(mode="json") for item in draft.items]
    except (ValidationError, KeyError, TypeError, ValueError):
        error_code = "invalid_result"
    except HTTPException as error:
        code = error.detail.get("code") if isinstance(error.detail, dict) else None
        error_code = code if isinstance(code, str) and code in ERROR_MESSAGES else "unavailable"
    except Exception:
        # Never persist or log the transcript, provider response or credentials.
        error_code = "unavailable"
    timestamp = now()
    values = {"analysis_status": "failed" if error_code else "completed",
              "analysis_error_code": error_code, "analysis_finished_at": timestamp,
              "updated_at": timestamp, "version": MeetingCapture.version + 1}
    if items is not None:
        values["items"] = items
    with session_factory() as db:
        # An expired, replaced, edited or confirmed run cannot overwrite data.
        changed = db.query(MeetingCapture).filter_by(id=claimed["id"], status="draft",
            analysis_run_id=claimed["run_id"], analysis_status="running",
            version=claimed["version"]).update(values, synchronize_session=False)
        if changed == 1 and not error_code:
            row = db.get(MeetingCapture, claimed["id"])
            _create_notification(
                db, row.owner_id, None, "meeting_capture",
                f"Разбор встречи готов: {row.title}"[:255],
                body=(f"Найдено пунктов: {len(items)}. Проверьте поручения перед сохранением."
                      if items else "Поручений и договорённостей не найдено. Можно проверить расшифровку и дополнить разбор вручную."),
                action_url=f"#/meeting-capture?capture={row.id}",
                group_key=f"meeting-analysis:{row.id}:{claimed['run_id']}",
                event_type="meeting.analysis.completed",
            )
        db.commit()


class MeetingAnalysisWorker:
    def __init__(self, session_factory, call_agent):
        self.session_factory, self.call_agent = session_factory, call_agent
        self.stopping = threading.Event()
        self.thread = threading.Thread(target=self.run, name="meeting-analysis", daemon=True)

    def start(self):
        self.thread.start()

    def stop(self):
        self.stopping.set()
        self.thread.join(timeout=2)

    def run(self):
        while not self.stopping.is_set():
            try:
                from config import settings
                if settings.MEETING_ANALYZER_ENABLED:
                    from .meeting_service_delivery import deliver_one
                    deliver_one(self.session_factory)
                with self.session_factory() as db:
                    expire_runs(db)
                    claimed = claim_run(db)
                if claimed:
                    execute_run(self.session_factory, claimed, self.call_agent)
                    continue
            except Exception:
                logger.error("Meeting analysis worker iteration failed; durable state retained")
            self.stopping.wait(1)
