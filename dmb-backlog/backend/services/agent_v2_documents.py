"""Pure contracts for publishing a V2 document, independent of intake review."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json

from fastapi import HTTPException


DOCUMENT_FIELDS = (
    ("Проблема", "problem_statement"), ("Бизнес-цель", "business_goal"),
    ("Текущий процесс", "current_process"), ("Целевой процесс", "target_process"),
    ("Бизнес-ценность", "business_value"), ("В объёме", "scope_in"),
    ("Вне объёма", "scope_out"), ("Бизнес-требования", "business_requirements"),
    ("Роли", "primary_role"), ("Акторы", "actors"), ("Процесс", "process"),
    ("Заинтересованные стороны", "stakeholders"), ("Сценарии", "scenarios"),
    ("Альтернативные сценарии", "alternative_scenarios"),
    ("Исключения", "exception_scenarios"), ("Бизнес-правила", "business_rules"),
    ("Данные и интеграции", "data_integrations"),
    ("Функциональные требования", "functional_requirements"),
    ("Нефункциональные требования", "non_functional_requirements"),
    ("Критерии приёмки", "acceptance_criteria"), ("Метрики успеха", "success_metrics"),
    ("Ограничения", "constraints"), ("Зависимости", "dependencies"), ("Риски", "risks"),
    ("Открытые вопросы", "open_questions"), ("Допущения", "assumptions"),
)


def fingerprint(value) -> str:
    payload = deepcopy(value)
    if isinstance(payload, dict):
        payload.pop("fingerprint", None)
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":"), default=str)
    return "sha256:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


def render_source_document(draft: dict) -> str:
    """Readable source with an exact original payload for lossless provenance."""
    sections = [f"# {draft.get('title') or 'Исходное бизнес-требование'}"]
    for label, field in DOCUMENT_FIELDS:
        value = draft.get(field)
        if value in (None, "", [], {}):
            continue
        if isinstance(value, list):
            text = "\n".join(
                f"- {item}" if isinstance(item, str)
                else f"- {item.get('text', json.dumps(item, ensure_ascii=False))}" if isinstance(item, dict)
                else f"- {item}" for item in value
            )
        elif isinstance(value, dict):
            text = json.dumps(value, ensure_ascii=False, indent=2)
        else:
            text = str(value)
        sections.append(f"## {label}\n{text}")
    sections.append("## Полный исходный документ\n```json\n" +
                    json.dumps(draft, ensure_ascii=False, indent=2, default=str) + "\n```")
    return "\n\n".join(sections)


def publication_package(state: dict, expected_hash: str, *, acknowledge_degraded: bool = False) -> dict:
    """A review is evidence for this revision, not a business approval."""
    draft = state.get("draft") or {}
    if not isinstance(draft, dict) or draft.get("schema") != "business-requirement-draft.v2":
        _block("document_required", "Сначала подготовьте документ бизнес-требований.")
    actual_hash = draft.get("fingerprint")
    if not expected_hash or expected_hash != actual_hash or fingerprint(draft) != actual_hash:
        _block("draft_revision_conflict", "Документ изменился. Обновите редакцию перед отправкой.")
    if not draft.get("artifact_id") or not isinstance(draft.get("revision"), int):
        _block("artifact_identity_missing", "Откройте документ в V2 и сохраните рабочую редакцию.")
    required = {
        "problem_statement": "Проблема", "business_goal": "Бизнес-цель",
        "scope_in": "Границы изменения", "acceptance_criteria": "Критерии результата",
    }
    missing = [key for key in required if not _meaningful(draft.get(key))]
    if missing:
        _block("document_sections_missing", "Уточните разделы: " + ", ".join(required[key] for key in missing), missing)
    review = state.get("document_review") or {}
    sources = state.get("document_sources") or []
    if (review.get("status") not in {"completed", "degraded"}
            or review.get("stale", False)
            or review.get("base_fingerprint") != actual_hash
            or review.get("linked_snapshot_fingerprint", "") != (state.get("linked_object") or {}).get("fingerprint", "")
            or review.get("source_fingerprint") != fingerprint(sources)):
        _block("document_review_stale", "Проверьте текущую редакцию БТ с актуальными источниками.")
    findings = state.get("document_findings") or []
    blocking = [item.get("id", "critical") for item in findings
                if item.get("base_fingerprint") == actual_hash
                and not item.get("stale", False)
                and item.get("review_id", review.get("id")) == review.get("id")
                and item.get("source_fingerprint", review.get("source_fingerprint")) == review.get("source_fingerprint")
                and item.get("severity") == "critical"
                and (item.get("status", "open") not in {"resolved", "rejected"}
                     or not str(item.get("reason") or "").strip())]
    if blocking:
        _block("critical_findings_open", "Разберите существенные замечания перед отправкой.", blocking)
    degraded = review.get("status") == "degraded"
    if degraded and not acknowledge_degraded:
        _block("degraded_review_confirmation_required",
               "AI-проверка недоступна. Подтвердите передачу с этой пометкой или повторите проверку.")
    return {
        "review": deepcopy(review), "findings": deepcopy(findings),
        "sources": deepcopy(sources),
        "decisions": deepcopy(state.get("document_decisions") or []),
        "degraded_acknowledged": bool(degraded and acknowledge_degraded),
    }


def _meaningful(value) -> bool:
    if isinstance(value, list):
        return any(_meaningful(item.get("text") if isinstance(item, dict) else item) for item in value)
    if not isinstance(value, str):
        return False
    return value.strip().casefold() not in {"", "—", "-", "unknown", "неизвестно", "не указано", "tbd"}


def _block(code: str, message: str, blocking_codes: list | None = None) -> None:
    raise HTTPException(status_code=409, detail={
        "code": code, "message": message, "blocking_codes": blocking_codes or [],
    })
