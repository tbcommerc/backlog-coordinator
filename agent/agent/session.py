"""Session store (SQLite, stdlib) - keeps dialogue state per session.

Sessions are owned by the agent service; the DMB backend only passes
session_id through. Serialization is JSON via dataclass helpers.
"""
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timezone

from .config import settings
from .dialogue.state import DialogueState, Slot


def _slot_from_dict(d: dict) -> Slot:
    return Slot(
        key=d.get("key", ""),
        value=d.get("value"),
        status=d.get("status", "empty"),
        confidence=d.get("confidence", 0.0),
        source=d.get("source", ""),
        confirmed=d.get("confirmed", False),
        assumption=d.get("assumption", False),
    )


def state_to_dict(state: DialogueState) -> dict:
    return {
        "session_id": state.session_id,
        "user_id": state.user_id,
        "phase": state.phase,
        "dialogue_mode": state.dialogue_mode,
        "slots": {k: {
            "key": s.key,
            "value": s.value,
            "status": s.status,
            "confidence": s.confidence,
            "source": s.source,
            "confirmed": s.confirmed,
            "assumption": s.assumption,
        } for k, s in state.slots.items()},
        "history": state.history,
        "ood_strikes": state.ood_strikes,
        "escalation": state.escalation,
        "domain_asked": state.domain_asked,
        "domain_confirmed": state.domain_confirmed,
        "finished": state.finished,
        "incident_only": state.incident_only,
        "incident_triage_done": state.incident_triage_done,
        "need_reflected": state.need_reflected,
        "reflect_correction_pending": state.reflect_correction_pending,
        "clarify_answered": state.clarify_answered,
        "clarify_proceed": state.clarify_proceed,
        "ask_counts": state.ask_counts,
        "last_asked_slot": state.last_asked_slot,
        "edit_notes": state.edit_notes,
        "needs_edit": state.needs_edit,
        "duplicates": state.duplicates,
        "sources": state.sources,
        "summary_text": state.summary_text,
        "confirmed": state.confirmed,
        "draft": state.draft,
        "review_status": state.review_status,
        "review_task_id": state.review_task_id,
        # Phase 3 fields
        "pending_question": state.pending_question,
        "in_qa_mode": state.in_qa_mode,
        "repair_mode": state.repair_mode,
        "repair_slot": state.repair_slot,
        "slot_history": state.slot_history,
        "question_count": state.question_count,
        # Phase 4 fields
        "user_expertise": state.user_expertise,
        "user_preferred_style": state.user_preferred_style,
        "profile_message_count": state.profile_message_count,
        "profile_tech_term_count": state.profile_tech_term_count,
        "profile_novice_indicator_count": state.profile_novice_indicator_count,
        "profile_expert_indicator_count": state.profile_expert_indicator_count,
        "consecutive_questions": state.consecutive_questions,
        "short_answers_count": state.short_answers_count,
        "fatigue_level": state.fatigue_level,
        "session_started_at": state.session_started_at,
        "first_slot_filled_at": state.first_slot_filled_at,
        "draft_created_at": state.draft_created_at,
        "total_user_messages": state.total_user_messages,
        "total_agent_messages": state.total_agent_messages,
        "escalation_reason": state.escalation_reason,
        "clarification_failures": state.clarification_failures,
        "intermediate_summary_shown": state.intermediate_summary_shown,
        "intermediate_summary_pending": state.intermediate_summary_pending,
        "fatigue_offer_shown": state.fatigue_offer_shown,
        "fatigue_offer_pending": state.fatigue_offer_pending,
        "last_user_signal": state.last_user_signal,
        "last_extracted_slots": state.last_extracted_slots,
    }


def state_from_dict(data: dict) -> DialogueState:
    state = DialogueState(
        session_id=data.get("session_id", ""),
        user_id=data.get("user_id", 0),
        phase=data.get("phase", "welcome"),
        dialogue_mode=data.get("dialogue_mode", "hybrid"),
        history=data.get("history", []),
        ood_strikes=data.get("ood_strikes", 0),
        escalation=data.get("escalation", False),
        domain_asked=data.get("domain_asked", False),
        domain_confirmed=data.get("domain_confirmed", False),
        finished=data.get("finished", False),
        incident_only=data.get("incident_only", False),
        incident_triage_done=data.get("incident_triage_done", False),
        need_reflected=data.get("need_reflected", False),
        reflect_correction_pending=data.get("reflect_correction_pending", False),
        clarify_answered=data.get("clarify_answered", False),
        clarify_proceed=data.get("clarify_proceed"),
        ask_counts=data.get("ask_counts", {}),
        last_asked_slot=data.get("last_asked_slot"),
        edit_notes=data.get("edit_notes", []),
        needs_edit=data.get("needs_edit", False),
        duplicates=data.get("duplicates", []),
        sources=data.get("sources", []),
        summary_text=data.get("summary_text", ""),
        confirmed=data.get("confirmed", False),
        draft=data.get("draft"),
        review_status=data.get("review_status", ""),
        review_task_id=data.get("review_task_id"),
        # Phase 3 fields
        pending_question=data.get("pending_question"),
        in_qa_mode=data.get("in_qa_mode", False),
        repair_mode=data.get("repair_mode", False),
        repair_slot=data.get("repair_slot"),
        slot_history=data.get("slot_history", {}),
        question_count=data.get("question_count", 0),
        # Phase 4 fields
        user_expertise=data.get("user_expertise", "medium"),
        user_preferred_style=data.get("user_preferred_style", ""),
        profile_message_count=data.get("profile_message_count", 0),
        profile_tech_term_count=data.get("profile_tech_term_count", 0),
        profile_novice_indicator_count=data.get("profile_novice_indicator_count", 0),
        profile_expert_indicator_count=data.get("profile_expert_indicator_count", 0),
        consecutive_questions=data.get("consecutive_questions", 0),
        short_answers_count=data.get("short_answers_count", 0),
        fatigue_level=data.get("fatigue_level", "normal"),
        session_started_at=data.get("session_started_at"),
        first_slot_filled_at=data.get("first_slot_filled_at"),
        draft_created_at=data.get("draft_created_at"),
        total_user_messages=data.get("total_user_messages", 0),
        total_agent_messages=data.get("total_agent_messages", 0),
        escalation_reason=data.get("escalation_reason", ""),
        clarification_failures=data.get("clarification_failures", 0),
        intermediate_summary_shown=data.get("intermediate_summary_shown", False),
        intermediate_summary_pending=data.get("intermediate_summary_pending", False),
        fatigue_offer_shown=data.get("fatigue_offer_shown", False),
        fatigue_offer_pending=data.get("fatigue_offer_pending", False),
        last_user_signal=data.get("last_user_signal", ""),
        last_extracted_slots=data.get("last_extracted_slots", []),
    )
    slots = {}
    for key, slot_data in (data.get("slots") or {}).items():
        slots[key] = _slot_from_dict(slot_data)
    state.slots = slots
    state.__post_init__()
    return state


class SessionStore:
    def __init__(self, path: str = None):
        self.path = path or settings.SESSION_DB
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                user_id INTEGER,
                state_json TEXT,
                updated_at TEXT
            )
        """)
        self._conn.commit()

    def new_session(self, user_id: int) -> DialogueState:
        session_id = uuid.uuid4().hex[:16]
        state = DialogueState(session_id=session_id, user_id=user_id)
        state.phase = "welcome"
        self.save(state)
        return state

    def get(self, session_id: str) -> DialogueState | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT state_json FROM sessions WHERE session_id=?", (session_id,)
            ).fetchone()
        if not row:
            return None
        try:
            return state_from_dict(json.loads(row[0]))
        except Exception:
            return None

    def save(self, state: DialogueState):
        payload = json.dumps(state_to_dict(state), ensure_ascii=False, default=str)
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            self._conn.execute(
                "INSERT INTO sessions(session_id, user_id, state_json, updated_at) VALUES(?,?,?,?) "
                "ON CONFLICT(session_id) DO UPDATE SET state_json=excluded.state_json, "
                "updated_at=excluded.updated_at",
                (state.session_id, state.user_id, payload, now),
            )
            self._conn.commit()

    def delete(self, session_id: str):
        with self._lock:
            self._conn.execute("DELETE FROM sessions WHERE session_id=?", (session_id,))
            self._conn.commit()

    def list_for_user(self, user_id: int, limit: int = 50) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT session_id, state_json, updated_at FROM sessions "
                "WHERE user_id=? ORDER BY updated_at DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        result = []
        for session_id, state_json, updated_at in rows:
            title = "Новый диалог"
            phase = ""
            try:
                state = state_from_dict(json.loads(state_json))
                phase = state.phase
                for entry in state.history:
                    if entry.get("role") == "user" and entry.get("content"):
                        title = entry["content"].strip().replace("\n", " ")[:80]
                        break
            except Exception:
                pass
            result.append({
                "session_id": session_id,
                "title": title,
                "phase": phase,
                "updated_at": updated_at,
            })
        return result


session_store = SessionStore()
