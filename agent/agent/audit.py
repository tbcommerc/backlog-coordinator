"""Audit logging for all agent events (auditability principle).

Writes JSON lines to agent_logs/audit.log. Every dialogue event, refusal,
escalation and draft version is recorded.
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent.parent / "agent_logs"


def log_event(event_type: str, payload: dict):
    try:
        LOG_DIR.mkdir(exist_ok=True)
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "type": event_type,
            **payload,
        }
        with open(LOG_DIR / "audit.log", "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")
    except Exception:
        pass


def log_dialogue(session_id: str, user_id: int, role: str, message: str, response_action: str):
    log_event("dialogue", {
        "session_id": session_id,
        "user_id": user_id,
        "role": role,
        "message_preview": message[:300],
        "response_action": response_action,
    })


def log_refusal(session_id: str, user_id: int, reason: str, message: str):
    log_event("refusal", {
        "session_id": session_id,
        "user_id": user_id,
        "reason": reason,
        "message_preview": message[:300],
    })


def log_draft(session_id: str, user_id: int, draft_id: str, status: str, completeness: int):
    log_event("draft", {
        "session_id": session_id,
        "user_id": user_id,
        "draft_id": draft_id,
        "status": status,
        "completeness": completeness,
    })
