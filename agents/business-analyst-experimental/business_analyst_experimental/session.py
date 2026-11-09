"""Session store (SQLite, stdlib) - keeps dialogue state per session.

Sessions are owned by the agent service; the DMB backend only passes
session_id through. Serialization is JSON via dataclass helpers.
"""
import json
import threading
import uuid
from contextvars import ContextVar
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import Column, Integer, MetaData, String, Table, Text, cast, create_engine, delete, func, inspect, select, text, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .config import settings
from .dialogue.state import DialogueState, Gap, Slot


class SessionConflictError(RuntimeError):
    """The dialogue was changed after it was loaded."""


def _slot_from_dict(d: dict) -> Slot:
    return Slot(
        key=d.get("key", ""),
        value=d.get("value"),
        status=d.get("status", "empty"),
        confidence=d.get("confidence", 0.0),
        source=d.get("source", ""),
        confirmed=d.get("confirmed", False),
        assumption=d.get("assumption", False),
        evidence=d.get("evidence", ""),
        message_id=d.get("message_id", ""),
        provenance=d.get("provenance", []),
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
            "evidence": s.evidence,
            "message_id": s.message_id,
            "provenance": s.provenance,
        } for k, s in state.slots.items()},
        "history": state.history,
        "ood_strikes": state.ood_strikes,
        "escalation": state.escalation,
        "domain_asked": state.domain_asked,
        "domain_confirmed": state.domain_confirmed,
        "pending_domain_message": state.pending_domain_message,
        "finished": state.finished,
        "archived": state.archived,
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
        "quality_assessment": state.quality_assessment,
        "gaps": [gap.__dict__.copy() for gap in state.gaps],
        "pending_quality_slot": state.pending_quality_slot,
        "quality_asked_codes": state.quality_asked_codes,
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
        "last_agent_decision": state.last_agent_decision,
        "requirement_conflicts": state.requirement_conflicts,
        "requirement_assumptions": state.requirement_assumptions,
        "requirement_shape": state.requirement_shape,
        "schema_version": state.schema_version,
        "operator_role": state.operator_role,
        "product_mode": state.product_mode,
        "source_context": state.source_context,
        "linked_object_snapshot": state.linked_object_snapshot,
        "artifact_type": state.artifact_type,
        "artifact_revision_history": state.artifact_revision_history,
        "artifact_id": state.artifact_id,
        "document_review": state.document_review,
        "document_reviews": state.document_reviews,
        "document_findings": state.document_findings,
        "document_proposals": state.document_proposals,
        "document_sources": state.document_sources,
        "proposed_patch": state.proposed_patch,
        "handoff_context": state.handoff_context,
        "final_summary_confirmed": state.final_summary_confirmed,
        "prompt_set_version": state.prompt_set_version,
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
        pending_domain_message=data.get("pending_domain_message", ""),
        finished=data.get("finished", False),
        archived=data.get("archived", False),
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
        quality_assessment=data.get("quality_assessment", {}),
        gaps=[Gap(**gap) for gap in data.get("gaps", [])],
        pending_quality_slot=data.get("pending_quality_slot"),
        quality_asked_codes=data.get("quality_asked_codes", []),
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
        last_agent_decision=data.get("last_agent_decision", {}),
        requirement_conflicts=data.get("requirement_conflicts", []),
        requirement_assumptions=data.get("requirement_assumptions", []),
        requirement_shape=data.get("requirement_shape", ""),
        schema_version=data.get("schema_version", 1),
        operator_role=data.get("operator_role", ""),
        product_mode=data.get("product_mode", ""),
        source_context=data.get("source_context", {}),
        linked_object_snapshot=data.get("linked_object_snapshot"),
        artifact_type=data.get("artifact_type", ""),
        artifact_revision_history=data.get("artifact_revision_history", []),
        artifact_id=data.get("artifact_id", ""),
        document_review=data.get("document_review", {}),
        document_reviews=data.get("document_reviews", []),
        document_findings=data.get("document_findings", []),
        document_proposals=data.get("document_proposals", []),
        document_sources=data.get("document_sources", []),
        proposed_patch=data.get("proposed_patch"),
        handoff_context=data.get("handoff_context"),
        final_summary_confirmed=data.get("final_summary_confirmed", False),
        prompt_set_version=data.get("prompt_set_version", ""),
    )
    slots = {}
    for key, slot_data in (data.get("slots") or {}).items():
        slots[key] = _slot_from_dict(slot_data)
    state.slots = slots
    state.__post_init__()
    return state


def _session_summary_phase(state: DialogueState) -> str:
    """Return the user-visible lifecycle phase from authoritative state fields.

    Older rows may contain a stale ``state.phase`` because runtime responses used
    to compute the phase without persisting it. Draft/review/finished flags are
    therefore checked before the stored phase.
    """
    if state.review_status and state.review_task_id:
        return "sent_for_review"
    if state.draft:
        return "draft_ready"
    if state.finished:
        return "done"
    if state.summary_text:
        return "confirm"
    return state.phase or "welcome"


class SessionStore:
    """Persistent dialogue store backed by PostgreSQL or SQLite through SQLAlchemy."""

    def __init__(self, path: str = None, database_url: str = None, *, initialize: bool | None = None):
        target = database_url or path or settings.SESSION_DATABASE_URL or settings.SESSION_DB
        if "://" not in target:
            target = f"sqlite:///{Path(target).resolve().as_posix()}"

        self.database_url = target
        self.path = path or settings.SESSION_DB
        self._lock = threading.RLock()
        self._session_locks: dict[str, threading.RLock] = {}
        connect_args = {"check_same_thread": False} if target.startswith("sqlite") else {}
        engine_options = {"pool_pre_ping": True, "connect_args": connect_args}
        if not target.startswith("sqlite"):
            engine_options.update({
                "pool_size": settings.DB_POOL_SIZE,
                "max_overflow": settings.DB_MAX_OVERFLOW,
                "pool_timeout": settings.DB_POOL_TIMEOUT_SECONDS,
            })
        self._engine = create_engine(target, **engine_options)
        self._transaction_connection = ContextVar("agent_session_transaction_"+str(id(self)), default=None)
        self._metadata = MetaData()
        self._sessions = Table(
            "sessions",
            self._metadata,
            Column("session_id", String(64), primary_key=True),
            Column("user_id", Integer),
            Column("state_json", Text, nullable=False),
            Column("updated_at", String(64), nullable=False),
            Column("last_message_at", String(64)),
            Column("version", Integer, nullable=False, default=0),
        )
        self._message_receipts = Table(
            "message_receipts",
            self._metadata,
            Column("session_id", String(64), primary_key=True),
            Column("message_id", String(64), primary_key=True),
            Column("response_json", Text, nullable=False),
            Column("created_at", String(64), nullable=False),
        )
        # Explicit isolated fixtures may bootstrap their own SQLite schema.
        # The module-level production store never performs DDL during import.
        if initialize is None:
            initialize = bool(path or database_url) and target.startswith("sqlite")
        if initialize:
            self.migrate_schema()

    @contextmanager
    def transaction(self, connection):
        """Stage dialogue writes in the same transaction as the run publication CAS."""
        if connection.engine is not self._engine or not connection.in_transaction():
            raise ValueError("active_owned_transaction_required")
        existing = self._transaction_connection.get()
        if existing is not None and existing is not connection:
            raise ValueError("nested_transaction_conflict")
        token = self._transaction_connection.set(connection)
        try:
            yield
        finally:
            self._transaction_connection.reset(token)

    @contextmanager
    def _connection(self, write=False):
        connection = self._transaction_connection.get()
        if connection is not None:
            yield connection
        else:
            with (self._engine.begin() if write else self._engine.connect()) as connection:
                yield connection

    def migrate_schema(self, backup_verified=False):
        inspector = inspect(self._engine)
        existing = set(inspector.get_table_names()) - {"agent_runs", "agent_run_events", "agent_runtime_bindings", "agent_runtime_migrations"}
        expected = {"sessions", "message_receipts"}
        if existing - expected:
            raise RuntimeError("Unexpected agent schema; migration refused")
        if existing:
            if "sessions" not in existing:
                raise RuntimeError("Incomplete agent schema; migration refused")
            columns = {c["name"] for c in inspector.get_columns("sessions")}
            required = {"session_id", "user_id", "state_json", "updated_at"}
            for column in inspector.get_columns("sessions"):
                expected_column = self._sessions.columns.get(column["name"])
                if expected_column is not None and column["type"]._type_affinity != expected_column.type._type_affinity:
                    raise RuntimeError("Unexpected sessions column type; migration refused")
            if inspector.get_pk_constraint("sessions").get("constrained_columns") != ["session_id"]:
                raise RuntimeError("Unexpected sessions primary key; migration refused")
            if not required <= columns or columns - set(self._sessions.columns.keys()):
                raise RuntimeError("Unexpected sessions schema; migration refused")
            if existing == expected and columns == set(self._sessions.columns.keys()):
                receipt_columns = {c["name"] for c in inspector.get_columns("message_receipts")}
                if receipt_columns != set(self._message_receipts.columns.keys()):
                    raise RuntimeError("Unexpected receipt schema; migration refused")
                return
            if not backup_verified:
                raise RuntimeError("Existing schema needs migration: provide a verified backup file")
        self._metadata.create_all(self._engine)

        columns = {col["name"] for col in inspect(self._engine).get_columns("sessions")}
        if "last_message_at" not in columns:
            with self._connection(write=True) as conn:
                conn.execute(text("ALTER TABLE sessions ADD COLUMN last_message_at VARCHAR(64)"))
        if "version" not in columns:
            with self._connection(write=True) as conn:
                conn.execute(text("ALTER TABLE sessions ADD COLUMN version INTEGER NOT NULL DEFAULT 0"))
        with self._connection(write=True) as conn:
            conn.execute(
                update(self._sessions)
                .where(self._sessions.c.last_message_at.is_(None))
                .values(last_message_at=self._sessions.c.updated_at)
            )

    @property
    def engine(self):
        """Expose the SQLAlchemy engine for process-wide instrumentation."""
        return self._engine

    def new_session(self, user_id: int) -> DialogueState:
        session_id = uuid.uuid4().hex[:16]
        state = DialogueState(session_id=session_id, user_id=user_id)
        state.phase = "welcome"
        self.save(state)
        return state

    def get(self, session_id: str) -> DialogueState | None:
        with self._lock:
            with self._connection() as conn:
                row = conn.execute(
                    select(self._sessions.c.state_json, self._sessions.c.version).where(
                        self._sessions.c.session_id == session_id
                    )
                ).first()
        if not row:
            return None
        try:
            state = state_from_dict(json.loads(row[0]))
            state._storage_version = int(row[1] or 0)
            return state
        except Exception:
            return None

    def save(self, state: DialogueState):
        payload = json.dumps(state_to_dict(state), ensure_ascii=False, default=str)
        now = datetime.now(timezone.utc).isoformat()
        with self._lock:
            with self._connection(write=True) as conn:
                previous = conn.execute(
                    select(
                        self._sessions.c.state_json,
                        self._sessions.c.last_message_at,
                        self._sessions.c.version,
                    ).where(self._sessions.c.session_id == state.session_id)
                ).first()
                previous_history_size = -1
                previous_last_message_at = None
                if previous:
                    previous_last_message_at = previous[1]
                    try:
                        previous_history_size = len(json.loads(previous[0]).get("history") or [])
                    except Exception:
                        previous_history_size = -1
                history_size = len(state.history or [])
                last_message_at = (
                    now
                    if previous is None or history_size != previous_history_size
                    else (previous_last_message_at or now)
                )
                values = {
                    "session_id": state.session_id,
                    "user_id": state.user_id,
                    "state_json": payload,
                    "updated_at": now,
                    "last_message_at": last_message_at,
                }
                expected_version = getattr(state, "_storage_version", None)
                if previous is None:
                    values["version"] = 0
                    try:
                        conn.execute(self._sessions.insert().values(**values))
                    except IntegrityError as exc:
                        raise SessionConflictError(
                            f"Session {state.session_id} was created concurrently"
                        ) from exc
                    state._storage_version = 0
                else:
                    if expected_version is None:
                        expected_version = int(previous[2] or 0)
                    next_version = expected_version + 1
                    result = conn.execute(
                        update(self._sessions)
                        .where(
                            self._sessions.c.session_id == state.session_id,
                            self._sessions.c.version == expected_version,
                        )
                        .values(
                            **{key: value for key, value in values.items() if key != "session_id"},
                            version=next_version,
                        )
                    )
                    if result.rowcount == 0:
                        raise SessionConflictError(
                            f"Session {state.session_id} changed concurrently"
                        )
                    state._storage_version = next_version

    def _local_session_lock(self, session_id: str) -> threading.RLock:
        with self._lock:
            return self._session_locks.setdefault(session_id, threading.RLock())

    @contextmanager
    def serialized(self, session_id: str):
        """Serialize one dialogue across threads and PostgreSQL workers."""
        with self._local_session_lock(session_id):
            if self._engine.dialect.name != "postgresql":
                yield
                return
            ambient = self._transaction_connection.get()
            if ambient is not None:
                ambient.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:session_id, 0))"),
                    {"session_id": session_id})
                yield
                return
            with self._connection() as conn:
                conn.execute(
                    text("SELECT pg_advisory_lock(hashtextextended(:session_id, 0))"),
                    {"session_id": session_id},
                )
                try:
                    yield
                finally:
                    conn.execute(
                        text("SELECT pg_advisory_unlock(hashtextextended(:session_id, 0))"),
                        {"session_id": session_id},
                    )
                    conn.commit()

    def get_cached_response(self, session_id: str, message_id: str) -> dict | None:
        if not message_id:
            return None
        cutoff = (
            datetime.now(timezone.utc)
            - timedelta(days=max(1, settings.MESSAGE_RECEIPT_RETENTION_DAYS))
        ).isoformat()
        with self._connection() as conn:
            row = conn.execute(
                select(self._message_receipts.c.response_json).where(
                    self._message_receipts.c.session_id == session_id,
                    self._message_receipts.c.message_id == message_id,
                    self._message_receipts.c.created_at >= cutoff,
                )
            ).first()
        return json.loads(row[0]) if row else None

    def cache_response(self, session_id: str, message_id: str, response: dict) -> None:
        if not message_id:
            return
        values = {
            "session_id": session_id,
            "message_id": message_id,
            "response_json": json.dumps(response, ensure_ascii=False, default=str),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        with self._connection(write=True) as conn:
            cutoff = (
                datetime.now(timezone.utc)
                - timedelta(days=max(1, settings.MESSAGE_RECEIPT_RETENTION_DAYS))
            ).isoformat()
            conn.execute(
                delete(self._message_receipts).where(
                    self._message_receipts.c.created_at < cutoff
                )
            )
            if self._engine.dialect.name == "postgresql":
                stmt = postgresql_insert(self._message_receipts).values(**values)
                conn.execute(stmt.on_conflict_do_nothing())
            elif self._engine.dialect.name == "sqlite":
                stmt = sqlite_insert(self._message_receipts).values(**values)
                conn.execute(stmt.on_conflict_do_nothing())
            else:
                try:
                    conn.execute(self._message_receipts.insert().values(**values))
                except IntegrityError:
                    pass

    def delete(self, session_id: str):
        with self._lock:
            with self._connection(write=True) as conn:
                conn.execute(
                    delete(self._sessions).where(self._sessions.c.session_id == session_id)
                )
                conn.execute(
                    delete(self._message_receipts).where(
                        self._message_receipts.c.session_id == session_id
                    )
                )

    def list_for_user(self, user_id: int, limit: int = 50, *, linked_object_type: str = "", linked_object_id: str = "") -> list[dict]:
        if bool(linked_object_type) != bool(linked_object_id):
            raise ValueError("linked_object_type and linked_object_id must be provided together")
        conditions = [self._sessions.c.user_id == user_id]
        if linked_object_type:
            if self._engine.dialect.name == "postgresql":
                snapshot = cast(self._sessions.c.state_json, JSONB)["linked_object_snapshot"]
                conditions.extend([
                    snapshot["object_type"].astext == linked_object_type,
                    snapshot["object_id"].astext == linked_object_id,
                ])
            else:
                conditions.extend([
                    func.json_extract(self._sessions.c.state_json, "$.linked_object_snapshot.object_type") == linked_object_type,
                    func.json_extract(self._sessions.c.state_json, "$.linked_object_snapshot.object_id") == linked_object_id,
                ])
        with self._lock:
            with self._connection() as conn:
                rows = conn.execute(
                    select(
                        self._sessions.c.session_id,
                        self._sessions.c.state_json,
                        self._sessions.c.updated_at,
                        self._sessions.c.last_message_at,
                    )
                    .where(*conditions)
                    .order_by(
                        self._sessions.c.last_message_at.desc(),
                        self._sessions.c.session_id.asc(),
                    )
                    .limit(max(1, min(int(limit), 200)))
                ).all()
        result = []
        for session_id, state_json, updated_at, last_message_at in rows:
            state = None
            title = "Новый диалог"
            phase = ""
            archived = False
            has_draft = False
            last_message_role = ""
            needs_user_response = False
            try:
                state = state_from_dict(json.loads(state_json))
                phase = _session_summary_phase(state)
                archived = state.archived
                for entry in state.history:
                    if entry.get("role") == "user" and entry.get("content"):
                        title = entry["content"].strip().replace("\n", " ")[:80]
                        break
                has_draft = bool(state.draft)
                if state.draft and state.draft.get("title"):
                    title = str(state.draft["title"])[:180]
                last_message_role = next(
                    (entry.get("role", "") for entry in reversed(state.history) if entry.get("content")),
                    "",
                )
                needs_user_response = (
                    last_message_role == "assistant"
                    and phase not in {"draft_ready", "sent_for_review", "done"}
                    and not state.finished
                )
            except Exception:
                pass
            result.append({
                "session_id": session_id,
                "title": title,
                "phase": phase,
                "updated_at": updated_at,
                "last_message_at": last_message_at,
                "archived": archived,
                "has_draft": has_draft,
                "last_message_role": last_message_role,
                "needs_user_response": needs_user_response,
                "product_mode": getattr(state, "product_mode", ""),
                "operator_role": getattr(state, "operator_role", ""),
                "artifact_type": getattr(state, "artifact_type", ""),
                "storage_version": int(getattr(state, "_storage_version", 0)),
                "artifact_id": getattr(state, "artifact_id", "") or ((getattr(state, "draft", None) or {}).get("artifact_id", "")),
                "artifact_revision": (getattr(state, "draft", None) or {}).get("revision", 0),
                "draft_fingerprint": (getattr(state, "draft", None) or {}).get("fingerprint", ""),
                "linked_object": {key: (getattr(state, "linked_object_snapshot", None) or {}).get(key) for key in ("object_type", "object_id")} if getattr(state, "linked_object_snapshot", None) else None,
            })
        return result

    def set_archived(self, session_id: str, archived: bool) -> DialogueState | None:
        state = self.get(session_id)
        if state is None:
            return None
        state.archived = bool(archived)
        self.save(state)
        return state


session_store = SessionStore(initialize=False)
