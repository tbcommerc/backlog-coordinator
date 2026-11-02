"""Pure publication and history helpers for customer requirement artifacts."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json


def draft_fingerprint(draft: dict) -> str:
    # Public interservice contract, mirrored by agents/business-analyst/composer/revision.py.
    canonical = json.dumps(draft, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


FIELD_LABELS = {
    "problem_statement": "Проблема", "current_process": "Текущий процесс (As-Is)",
    "target_process": "Целевой процесс (To-Be)", "process": "Бизнес-процесс",
    "business_value": "Бизнес-ценность", "primary_role": "Основная роль",
    "affected_users": "Затронутые пользователи", "user_roles": "Пользователи",
    "department": "Подразделение", "product": "Продукт", "module": "Модуль",
    "priority": "Приоритет", "scenarios": "Сценарии", "business_rules": "Бизнес-правила",
    "data_integrations": "Данные и интеграции", "acceptance_criteria": "Критерии приёмки",
    "dependencies": "Зависимости", "risks": "Риски", "regulatory_flags": "Регуляторные аспекты",
    "open_questions": "Открытые вопросы", "open_question_details": "Уточнения по разделам",
    "assumptions": "Допущения", "conflicts": "Противоречия", "gaps": "Реестр пробелов",
    "quality_issues": "Замечания к качеству", "review_findings": "Независимая проверка",
    "sources": "Источники", "duplicates": "Похожие требования",
    "field_provenance": "Происхождение формулировок", "field_confidence": "Уверенность по разделам",
    "field_status": "Состояние разделов", "intent": "Тип обращения",
    "completeness_score": "Полнота", "quality_score": "Качество формулировок",
    "confidence": "Уверенность", "quality_level": "Уровень качества",
    "quality_profile": "Профиль проверки", "review_blocked": "Есть блокирующие замечания",
    "status": "Статус черновика", "created_by": "Автор черновика", "id": "Номер черновика",
    "assumption_details": "Реестр допущений", "conflict_history": "История противоречий",
}


def render_request(draft: dict) -> str:
    """Publish every draft field; preserve structured details without flattening away facts."""
    lines = []
    for key in [*FIELD_LABELS, *(key for key in draft if key not in FIELD_LABELS and key != "title")]:
        value = draft.get(key)
        if value is None or value == "" or value == [] or value == {}:
            continue
        label = FIELD_LABELS.get(key, key)
        if isinstance(value, (dict, list)):
            if isinstance(value, list) and all(isinstance(item, str) for item in value):
                lines.append(f"**{label}:**\n" + "\n".join(f"- {item}" for item in value))
            elif isinstance(value, list) and key in {"conflicts", "review_findings", "quality_issues", "gaps", "open_question_details", "assumption_details", "conflict_history"}:
                lines.append(f"**{label}:**\n" + "\n".join(_finding_line(item) for item in value))
            else:
                # Keep evidence, exact criticality/status and source identifiers intact.
                lines.append(f"**{label}:**\n```json\n{json.dumps(value, ensure_ascii=False, indent=2)}\n```")
        else:
            lines.append(f"**{label}:** {value}")
    return "\n\n".join(lines)


def _finding_line(item) -> str:
    if not isinstance(item, dict):
        return f"- {item}"
    labels = {"message": "Замечание", "text": "Формулировка", "question": "Вопрос",
              "severity": "Важность", "criticality": "Критичность", "status": "Состояние",
              "field": "Раздел", "slot": "Раздел", "old_value": "Было", "new_value": "Стало",
              "evidence": "Основание", "message_id": "Исходное сообщение", "resolution": "Решение"}
    details = []
    for key, value in item.items():
        text = json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else str(value)
        details.append(f"{labels.get(key, key)}: {text}")
    return "- " + "; ".join(details)


def current_revision_history(request) -> list:
    existing = getattr(request, "revision_history", None)
    if isinstance(existing, list) and existing:
        return deepcopy(existing)
    if not getattr(request, "draft", None):
        return []
    at = getattr(request, "updated_at", None) or getattr(request, "created_at", None)
    return [{
        "revision": 1, "draft": deepcopy(request.draft),
        "draft_hash": draft_fingerprint(request.draft),
        "title": request.title, "description": render_request(request.draft),
        "created_at": at.isoformat() if hasattr(at, "isoformat") else at,
        "legacy_snapshot": True,
    }]


def ensure_request_history(request) -> None:
    """Capture the available legacy snapshot/comment before any replacement."""
    request.revision_history = current_revision_history(request)
    if not isinstance(getattr(request, "status_history", None), list):
        request.status_history = []
    if not request.status_history and getattr(request, "reject_reason", None):
        append_status_event(request, request.status, None, request.reject_reason, legacy=True)


def append_revision(request, draft: dict, user) -> None:
    revisions = list(getattr(request, "revision_history", None) or [])
    revisions.append({
        "revision": max((item.get("revision", 0) for item in revisions), default=0) + 1,
        "draft": deepcopy(draft), "draft_hash": draft_fingerprint(draft),
        "title": request.title, "description": render_request(draft),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "author_id": user.id, "author_name": getattr(user, "name", ""),
    })
    request.revision_history = revisions


def append_status_event(request, status: str, user, comment: str = "", *, legacy=False, metadata: dict | None = None) -> None:
    labels = {"submitted": "Отправлен на ревью", "in_review": "Начато ревью",
              "returned": "Запрошено уточнение", "rejected": "Запрос отклонён",
              "in_progress": "Передан в проработку", "approved": "Проработка завершена"}
    events = list(getattr(request, "status_history", None) or [])
    now = datetime.now(timezone.utc).isoformat()
    event = {
        "status": status, "title": "Сохранён комментарий прежнего ревью" if legacy else labels.get(status, "Запрос обновлён"),
        "comment": comment, "actor_id": getattr(user, "id", None),
        "actor_name": getattr(user, "name", "") or ("Историческая запись" if legacy else ""),
        "created_at": None if legacy else now,
        "observed_at": now if legacy else None,
        "revision": len(getattr(request, "revision_history", None) or []),
        "legacy_event": legacy,
    }
    if metadata:
        event["metadata"] = deepcopy(metadata)
    events.append(event)
    request.status_history = events
