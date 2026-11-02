"""DialogueState - slots of a business requirement being collected.

The state machine is deterministic: it computes the current phase from which
slots are still empty. Slot filling collects structured data; the LLM only
generates natural phrasing around this state.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional
import re
import uuid


def value_status(value) -> str:
    """Distinguish an answer from an explicit gap, including older sessions."""
    if value is None or not str(value).strip():
        return "empty"
    text = str(value).strip().lower().rstrip(".! ")
    if text in {"не применимо", "неприменимо", "не относится", "n/a"}:
        return "not_applicable"
    if text in {"не знаю", "не знаю, нужно уточнить", "нужно уточнить", "неизвестно", "затрудняюсь"}:
        return "unknown"
    if re.match(r"^(?:пока |ещ[её] |сейчас )?(?:не знаю|не уверен[аы]?|затрудняюсь|неизвестно)(?:\b|[,;])", text):
        return "unknown"
    return "filled"

# ---- Phase definitions ----------------------------------------------------
PHASE_WELCOME = "welcome"
PHASE_IDENTIFY_INTENT = "identify_intent"
PHASE_NEED_STATEMENT = "need_statement"
PHASE_BUSINESS_CONTEXT = "business_context"
PHASE_AS_IS_TO_BE = "as_is_to_be"
PHASE_ROLES_SCENARIOS = "roles_scenarios"
PHASE_BUSINESS_RULES = "business_rules"
PHASE_DATA_INTEGRATIONS = "data_integrations"
PHASE_VALUE_PRIORITY = "value_priority"
PHASE_DUPLICATE_CHECK = "duplicate_check"
PHASE_SUMMARIZE = "summarize"
PHASE_CONFIRM = "confirm"
PHASE_DRAFT_READY = "draft_ready"
PHASE_SENT_FOR_REVIEW = "sent_for_review"
PHASE_CLARIFY_ANSWER = "clarify_answer"
PHASE_CLARIFY_PROCEED = "clarify_proceed"
PHASE_INCIDENT_TRIAGE = "incident_triage"
PHASE_ESCALATED = "escalated"
PHASE_DONE = "done"

# Main collection path order
PHASE_ORDER = [
    PHASE_IDENTIFY_INTENT,
    PHASE_NEED_STATEMENT,
    PHASE_BUSINESS_CONTEXT,
    PHASE_AS_IS_TO_BE,
    PHASE_ROLES_SCENARIOS,
    PHASE_BUSINESS_RULES,
    PHASE_DATA_INTEGRATIONS,
    PHASE_VALUE_PRIORITY,
]

# Incident path is intentionally short
PHASE_INCIDENT_ORDER = [PHASE_IDENTIFY_INTENT, PHASE_NEED_STATEMENT]

# ---- Slot descriptors -----------------------------------------------------
INTENTS = {
    "feature": "Новая функциональность",
    "change": "Изменение существующей функциональности",
    "problem": "Проблема / неудобство в текущем процессе",
    "clarification": "Запрос на разъяснение функциональности",
    "incident": "Инцидент / ошибка",
}

SLOT_LABELS = {
    "intent": "Тип обращения",
    "need_statement": "Суть потребности",
    "role": "Пользователь",
    "department": "Подразделение",
    "process": "Процесс",
    "product": "Продукт / тип сделок",
    "module": "Модуль платформы",
    "as_is": "Текущее состояние (As-Is)",
    "to_be": "Целевое состояние (To-Be)",
    "users": "Затронутые пользователи",
    "scenarios": "Сценарии",
    "business_rules": "Бизнес-правила",
    "acceptance_criteria": "Критерии приёмки",
    "data_integrations": "Данные и интеграции",
    "value": "Ценность / эффект",
    "priority": "Приоритет",
    "regulatory_flags": "Регуляторные аспекты",
    "dependencies": "Зависимости",
    "risks": "Риски",
    "open_questions": "Открытые вопросы",
}

PRODUCT_MODE_ASSIGNMENT_CAPTURE = "assignment_capture"
PRODUCT_MODE_REQUIREMENT_COPILOT = "requirement_copilot"
PRODUCT_MODES = (
    PRODUCT_MODE_ASSIGNMENT_CAPTURE,
    PRODUCT_MODE_REQUIREMENT_COPILOT,
)

ASSIGNMENT_SLOTS = [
    "assignment_statement", "business_goal", "expected_result", "scope_in",
    "scope_out", "originator", "deadline_or_urgency", "owner_next_step",
    "stakeholders", "constraints", "initial_risks", "source_materials",
    "open_questions",
]

REQUIREMENT_V2_SLOTS = [
    "scope_in", "scope_out", "actors", "alternative_scenarios",
    "exception_scenarios", "functional_requirements",
    "non_functional_requirements", "success_metrics",
]

SLOT_LABELS.update({
    "assignment_statement": "суть поручения",
    "business_goal": "бизнес-цель",
    "expected_result": "ожидаемый результат",
    "scope_in": "что входит в объём",
    "scope_out": "что не входит в объём",
    "originator": "инициатор поручения",
    "deadline_or_urgency": "срок или срочность",
    "owner_next_step": "ответственный за следующий шаг",
    "stakeholders": "заинтересованные стороны",
    "constraints": "ограничения",
    "initial_risks": "исходные риски",
    "source_materials": "исходные материалы",
    "actors": "участники сценария",
    "alternative_scenarios": "альтернативные сценарии",
    "exception_scenarios": "исключительные сценарии",
    "functional_requirements": "функциональные требования",
    "non_functional_requirements": "нефункциональные требования",
    "success_metrics": "метрики успеха",
})

# Required slots per phase (phase blocks until all are handled)
PHASE_REQUIRED_SLOTS = {
    PHASE_IDENTIFY_INTENT: ["intent"],
    PHASE_NEED_STATEMENT: ["need_statement"],
    PHASE_BUSINESS_CONTEXT: ["role", "process", "product"],
    PHASE_AS_IS_TO_BE: ["as_is", "to_be"],
    PHASE_ROLES_SCENARIOS: ["users"],
    PHASE_BUSINESS_RULES: ["acceptance_criteria"],
    PHASE_DATA_INTEGRATIONS: ["data_integrations"],
    PHASE_VALUE_PRIORITY: ["value"],
}

# ---- Dialogue modes ------------------------------------------------------
MODE_GUIDED = "guided"          # Жесткий сценарий для новичков
MODE_HYBRID = "hybrid"          # Основной режим — баланс строгости и гибкости
MODE_FREE_FORM = "free_form"    # Опытные пользователи, много данных сразу
MODE_EXPERT = "expert"          # BA/PO — меньше вопросов, больше скорости

DIALOGUE_MODES = [MODE_GUIDED, MODE_HYBRID, MODE_FREE_FORM, MODE_EXPERT]

# ---- Slot mandatory categories -------------------------------------------
MANDATORY_HARD = ["need_statement", "to_be", "role", "process"]
MANDATORY_SOFT = ["value", "product", "regulatory_flags"]
OPTIONAL = [
    "intent", "department", "module", "as_is", "users", "scenarios",
    "business_rules", "acceptance_criteria", "data_integrations", "priority",
    "dependencies", "risks", "open_questions",
]
OPTIONAL_INTERVIEW_SLOTS = {
    "department", "module", "scenarios", "business_rules",
    "regulatory_flags", "dependencies", "risks",
}

# All slots in collection order (used by planner / progress UI)
COLLECTION_SLOTS = [
    "intent", "need_statement", "role", "department", "process", "product",
    "module", "as_is", "to_be", "users", "scenarios", "business_rules",
    "acceptance_criteria", "data_integrations", "value", "priority",
    "regulatory_flags", "dependencies", "risks",
]

# What the user sees as requirement quality progress.  This is intentionally
# aligned with composer/scores.py instead of exposing every internal slot.
QUALITY_PROGRESS_SLOTS = [
    "need_statement", "to_be", "role", "process", "product",
    "acceptance_criteria", "module", "value", "regulatory_flags",
]


@dataclass
class Slot:
    key: str
    value: Optional[str] = None
    status: str = "empty"  # empty | filled | skipped
    confidence: float = 0.0  # 0.0 - 1.0, confidence of extraction
    source: str = ""  # user_message | knowledge_base | assumption | system
    confirmed: bool = False  # confirmed by user explicitly
    assumption: bool = False  # True if value was inferred, not stated
    evidence: str = ""  # User quotation supporting the current value
    message_id: str = ""  # Stable origin, independent of the retained chat window
    provenance: List[dict] = field(default_factory=list)  # Sources of compound facts

    @property
    def handled(self) -> bool:
        return self.status in ("filled", "skipped", "unknown", "not_applicable")

    @property
    def needs_review(self) -> bool:
        return self.assumption or (self.confidence < 0.7 and self.status == "filled")


@dataclass
class Gap:
    """A traceable unresolved question carried through dialogue and review."""

    id: str
    category: str  # business | technical | user_requirement | quality
    criticality: str  # high | medium | low
    question: str
    source: str = ""
    slot: str = ""
    status: str = "open"  # open | resolved | deferred
    resolution: str = ""
    artifact_type: str = ""
    mode: str = ""


@dataclass
class DialogueState:
    session_id: str = ""
    user_id: int = 0
    phase: str = PHASE_WELCOME
    dialogue_mode: str = MODE_HYBRID  # Current dialogue mode
    slots: Dict[str, Slot] = field(default_factory=dict)
    history: List[dict] = field(default_factory=list)
    ood_strikes: int = 0            # out-of-domain attempts
    escalation: bool = False
    domain_asked: bool = False
    domain_confirmed: bool = False
    pending_domain_message: str = ""
    finished: bool = False
    archived: bool = False
    incident_only: bool = False
    incident_triage_done: bool = False
    need_reflected: bool = False
    reflect_correction_pending: bool = False
    clarify_answered: bool = False
    clarify_proceed: Optional[bool] = None
    ask_counts: Dict[str, int] = field(default_factory=dict)
    last_asked_slot: Optional[str] = None
    edit_notes: List[str] = field(default_factory=list)
    needs_edit: bool = False
    duplicates: List[dict] = field(default_factory=list)
    sources: List[dict] = field(default_factory=list)
    summary_text: str = ""
    confirmed: bool = False
    draft: Optional[dict] = None
    review_status: str = ""         # "" | draft | needs_review
    review_task_id: Optional[int] = None
    quality_assessment: dict = field(default_factory=dict)
    gaps: List[Gap] = field(default_factory=list)
    pending_quality_slot: Optional[str] = None
    quality_asked_codes: List[str] = field(default_factory=list)
    
    # Phase 3: Q&A and Repair
    pending_question: Optional[str] = None  # Slot we're waiting to return to
    in_qa_mode: bool = False                # Currently answering user question
    repair_mode: bool = False               # Currently editing a slot
    repair_slot: Optional[str] = None       # Which slot is being repaired
    
    # Phase 3: Conflict detection
    slot_history: Dict[str, List[dict]] = field(default_factory=dict)  # Change history
    
    # Phase 3: Question tracking
    question_count: int = 0  # Number of questions asked in current session
    
    # Phase 4: User profile
    user_expertise: str = "medium"  # novice | medium | expert
    user_preferred_style: str = ""  # business | technical (auto-detected)
    profile_message_count: int = 0
    profile_tech_term_count: int = 0
    profile_novice_indicator_count: int = 0
    profile_expert_indicator_count: int = 0
    
    # Phase 4: Fatigue detection
    consecutive_questions: int = 0  # Questions asked without user giving data
    short_answers_count: int = 0  # Count of very short answers (<=3 words)
    fatigue_level: str = "normal"  # normal | tired | frustrated
    
    # Phase 4: Metrics tracking
    session_started_at: Optional[float] = None  # Timestamp
    first_slot_filled_at: Optional[float] = None  # Timestamp
    draft_created_at: Optional[float] = None  # Timestamp
    total_user_messages: int = 0
    total_agent_messages: int = 0
    
    # Intermediate summary tracking
    intermediate_summary_shown: bool = False  # Prevent showing summary twice in a row
    intermediate_summary_pending: bool = False
    fatigue_offer_shown: bool = False  # Prevent fatigue draft offer loop
    fatigue_offer_pending: bool = False

    # Conversation continuity: what was understood from the latest message.
    last_user_signal: str = ""
    last_extracted_slots: List[str] = field(default_factory=list)
    last_agent_decision: dict = field(default_factory=dict)
    requirement_conflicts: List[dict] = field(default_factory=list)
    requirement_assumptions: List[dict] = field(default_factory=list)
    requirement_shape: str = ""

    # Assistant V2 session envelope and artifact lifecycle. These values live
    # in state_json so the copied V1 persistence semantics remain unchanged.
    schema_version: int = 1
    operator_role: str = ""
    product_mode: str = ""
    source_context: dict = field(default_factory=dict)
    linked_object_snapshot: Optional[dict] = None
    artifact_type: str = ""
    artifact_revision_history: List[dict] = field(default_factory=list)
    artifact_id: str = ""
    document_review: dict = field(default_factory=dict)
    document_reviews: List[dict] = field(default_factory=list)
    document_findings: List[dict] = field(default_factory=list)
    document_proposals: List[dict] = field(default_factory=list)
    document_sources: List[dict] = field(default_factory=list)
    proposed_patch: Optional[dict] = None
    handoff_context: Optional[dict] = None
    final_summary_confirmed: bool = False
    prompt_set_version: str = ""

    # Phase 4: Escalation
    escalation_reason: str = ""  # Why escalated
    clarification_failures: int = 0  # Times agent failed to understand

    def __post_init__(self):
        for key in COLLECTION_SLOTS + ASSIGNMENT_SLOTS + REQUIREMENT_V2_SLOTS + ["need_statement"]:
            if key not in self.slots:
                self.slots[key] = Slot(key=key)

    def get(self, key: str) -> Optional[str]:
        slot = self.slots.get(key)
        return slot.value if slot and value_status(slot.value) == "filled" else None

    def set(self, key: str, value, confidence: float = 1.0, source: str = "user_message", 
            confirmed: bool = False, assumption: bool = False,
            evidence: str = "", message_id: str = "", provenance: Optional[List[dict]] = None):
        if key not in self.slots:
            self.slots[key] = Slot(key=key)
        self.slots[key].value = value
        self.slots[key].confidence = confidence
        self.slots[key].source = source
        self.slots[key].confirmed = confirmed
        self.slots[key].assumption = assumption
        self.slots[key].evidence = evidence
        self.slots[key].message_id = message_id
        self.slots[key].provenance = list(provenance or [])
        self.slots[key].status = value_status(value)
        if confirmed:
            self.resolve_field_conflicts(key, value, "user_confirmation")
            self.resolve_field_assumptions(key, "user_confirmation")
        if self.slots[key].status == "filled":
            if self.first_slot_filled_at is None:
                import time
                self.first_slot_filled_at = time.time()

    def skip(self, key: str):
        slot = self.slots.get(key)
        if slot:
            slot.status = "skipped"
    
    def get_slot(self, key: str) -> Optional[Slot]:
        return self.slots.get(key)
    
    def get_confidence(self, key: str) -> float:
        slot = self.slots.get(key)
        return slot.confidence if slot else 0.0
    
    def is_low_confidence(self, key: str, threshold: float = 0.6) -> bool:
        slot = self.slots.get(key)
        return slot and slot.status == "filled" and slot.confidence < threshold

    def list_values(self, key: str) -> List[str]:
        val = self.get(key)
        if not val:
            return []
        if isinstance(val, list):
            return [str(v) for v in val]
        return [v.strip() for v in str(val).split(";") if v.strip()]

    def add_message(self, role: str, content: str, message_id: str = ""):
        entry = {"role": role, "content": content}
        if role == "user" and not message_id:
            message_id = f"msg-{uuid.uuid4().hex}"
        if message_id:
            entry["message_id"] = message_id
        self.history.append(entry)
        from ..config import settings
        limit = max(2, settings.AGENT_HISTORY_MESSAGES)
        if len(self.history) > limit:
            del self.history[:-limit]

    def resolve_field_conflicts(self, key: str, value, reason: str = "user_confirmation"):
        """Resolve only conflicts concerning an explicitly corrected field."""
        for conflict in self.requirement_conflicts:
            if (conflict.get("field") or conflict.get("slot")) == key and conflict.get("status") == "open":
                conflict.update(status="resolved", resolution=str(value or ""), resolution_reason=reason)

    def resolve_field_assumptions(self, key: str, reason: str = "user_confirmation"):
        for assumption in self.requirement_assumptions:
            if (assumption.get("field") or assumption.get("slot")) == key and assumption.get("status") == "open":
                assumption.update(status="resolved", resolution_reason=reason)

    def progress(self) -> List[dict]:
        items = []
        for key in QUALITY_PROGRESS_SLOTS:
            slot = self.slots.get(key)
            if not slot:
                continue
            label = SLOT_LABELS.get(key, key)
            status = value_status(slot.value) if slot.status != "skipped" else "skipped"
            filled = status == "filled"
            items.append({
                "key": key, "label": label, "filled": filled,
                "status": status,
                "skipped": slot.status == "skipped", "confidence": slot.confidence,
                "needs_review": slot.needs_review,
            })
        return items

    def current_phase_required_missing(self) -> List[str]:
        required = PHASE_REQUIRED_SLOTS.get(self.phase, [])
        return [k for k in required if not self.slots[k].handled]

    def all_required_handled(self) -> bool:
        # The hard minimum is stable across modes.  Other gaps may be carried
        # into the draft as explicit open questions.
        return self.all_mandatory_hard_filled()
    
    def all_mandatory_hard_filled(self) -> bool:
        required = MANDATORY_HARD
        allow_explicit_gaps = False
        if self.product_mode == PRODUCT_MODE_ASSIGNMENT_CAPTURE:
            allow_explicit_gaps = True
            required = [
                "assignment_statement", "business_goal", "expected_result",
                "scope_in", "originator", "deadline_or_urgency", "owner_next_step",
            ]
        elif self.product_mode == PRODUCT_MODE_REQUIREMENT_COPILOT:
            allow_explicit_gaps = True
            required = [
                "need_statement", "business_goal", "as_is", "to_be", "scope_in",
                "scope_out", "role", "process", "scenarios", "acceptance_criteria",
                "business_rules", "dependencies", "risks",
            ]
        for k in required:
            slot = self.slots.get(k)
            allowed_empty_markers = (
                {"unknown", "not_specified", "not_applicable", "known_none"}
                if allow_explicit_gaps else set()
            )
            if not slot or (
                (slot.status != "filled" or value_status(slot.value) != "filled")
                and slot.status not in allowed_empty_markers
            ):
                return False
        return True
    
    def get_missing_mandatory_hard(self) -> List[str]:
        required = MANDATORY_HARD
        allow_explicit_gaps = False
        if self.product_mode == PRODUCT_MODE_ASSIGNMENT_CAPTURE:
            allow_explicit_gaps = True
            required = [
                "assignment_statement", "business_goal", "expected_result",
                "scope_in", "originator", "deadline_or_urgency", "owner_next_step",
            ]
        elif self.product_mode == PRODUCT_MODE_REQUIREMENT_COPILOT:
            allow_explicit_gaps = True
            required = [
                "need_statement", "business_goal", "as_is", "to_be", "scope_in",
                "scope_out", "role", "process", "scenarios", "acceptance_criteria",
                "business_rules", "dependencies", "risks",
            ]
        explicit_gap_markers = {"unknown", "not_specified", "not_applicable", "known_none"}
        missing = []
        for key in required:
            slot = self.slots.get(key)
            is_filled = bool(slot and slot.status == "filled" and value_status(slot.value) == "filled")
            is_explicit_gap = bool(slot and allow_explicit_gaps and slot.status in explicit_gap_markers)
            if not is_filled and not is_explicit_gap:
                missing.append(key)
        return missing
    
    def get_missing_mandatory_soft(self) -> List[str]:
        return [k for k in MANDATORY_SOFT if not self.slots.get(k) or self.slots[k].status != "filled"]
    
    def get_low_confidence_slots(self, threshold: float = 0.6) -> List[str]:
        return [k for k, slot in self.slots.items() 
                if slot.status == "filled" and slot.confidence < threshold]
    
    def get_open_questions(self) -> List[str]:
        questions = []
        for k in MANDATORY_SOFT + OPTIONAL:
            slot = self.slots.get(k)
            if slot and slot.status == "skipped":
                questions.append(f"Не уточнено: {SLOT_LABELS.get(k, k)}")
        return questions
    
    # ---- Phase 3: Dialogue mode methods ----
    def set_mode(self, mode: str):
        """Set dialogue mode (guided/hybrid/free_form/expert)."""
        if mode in DIALOGUE_MODES:
            self.dialogue_mode = mode
    
    def is_expert_mode(self) -> bool:
        return self.dialogue_mode == MODE_EXPERT
    
    def is_free_form_mode(self) -> bool:
        return self.dialogue_mode == MODE_FREE_FORM
    
    def is_guided_mode(self) -> bool:
        return self.dialogue_mode == MODE_GUIDED
    
    # ---- Phase 3: Q&A mode methods ----
    def enter_qa_mode(self, slot_to_return_to: str = None):
        """Enter Q&A mode, saving current slot to return to."""
        self.in_qa_mode = True
        self.pending_question = slot_to_return_to or self.last_asked_slot
        self.last_asked_slot = None
    
    def exit_qa_mode(self):
        """Exit Q&A mode and restore previous slot."""
        self.in_qa_mode = False
        self.last_asked_slot = self.pending_question
        self.pending_question = None
    
    # ---- Phase 3: Repair mode methods ----
    def enter_repair_mode(self, slot: str):
        """Enter repair mode for a specific slot."""
        self.repair_mode = True
        self.repair_slot = slot
    
    def exit_repair_mode(self):
        """Exit repair mode."""
        self.repair_mode = False
        self.repair_slot = None
    
    # ---- Phase 3: Slot history methods ----
    def record_slot_change(self, key: str, old_value: str, new_value: str, reason: str = "repair"):
        """Record a slot change in history for audit."""
        if key not in self.slot_history:
            self.slot_history[key] = []
        self.slot_history[key].append({
            "old_value": old_value,
            "new_value": new_value,
            "reason": reason,
            "timestamp": len(self.history),  # Use history length as pseudo-timestamp
        })
        from ..config import settings
        limit = max(1, settings.AGENT_SLOT_HISTORY_ITEMS)
        if len(self.slot_history[key]) > limit:
            del self.slot_history[key][:-limit]
    
    def get_slot_history(self, key: str) -> List[dict]:
        """Get change history for a slot."""
        return self.slot_history.get(key, [])
    
    def has_conflict(self, key: str, new_value: str) -> bool:
        """Check if new value conflicts with existing value."""
        slot = self.slots.get(key)
        if not slot or not slot.value:
            return False
        # Simple conflict detection: different non-empty values
        return slot.value != new_value and new_value
    
    # ---- Phase 4: User profile methods ----
    def set_expertise(self, level: str):
        """Set user expertise level (novice/medium/expert)."""
        if level in ("novice", "medium", "expert"):
            self.user_expertise = level
    
    def is_novice(self) -> bool:
        return self.user_expertise == "novice"
    
    def is_expert_user(self) -> bool:
        return self.user_expertise == "expert"
    
    # ---- Phase 4: Fatigue detection methods ----
    def record_question_asked(self):
        """Record that a question was asked to user."""
        self.consecutive_questions += 1
        self.total_agent_messages += 1
        self._update_fatigue()
    
    def record_user_answer(self, message: str):
        """Record user's answer and update fatigue metrics."""
        self.total_user_messages += 1
        
        # Check for short answers (potential fatigue)
        words = message.strip().split()
        if len(words) <= 3:
            self.short_answers_count += 1
        else:
            self.short_answers_count = 0
            self.consecutive_questions = 0
        
        self._update_fatigue()
    
    def _update_fatigue(self):
        """Update fatigue level based on dialogue patterns."""
        if self.consecutive_questions >= 5:
            self.fatigue_level = "frustrated"
        elif self.consecutive_questions >= 3 or self.short_answers_count >= 4:
            self.fatigue_level = "tired"
        else:
            self.fatigue_level = "normal"
    
    def is_fatigued(self) -> bool:
        return self.fatigue_level in ("tired", "frustrated")
    
    def is_frustrated(self) -> bool:
        return self.fatigue_level == "frustrated"
    
    # ---- Phase 4: Metrics methods ----
    def get_session_duration(self) -> float:
        """Get session duration in seconds."""
        import time
        if not self.session_started_at:
            return 0.0
        return time.time() - self.session_started_at
    
    def get_time_to_draft(self) -> float:
        """Get time from session start to draft creation in seconds."""
        if not self.session_started_at or not self.draft_created_at:
            return 0.0
        return self.draft_created_at - self.session_started_at
    
    # ---- Phase 4: Escalation methods ----
    def should_escalate(self) -> tuple[bool, str]:
        """Check if dialogue should be escalated to human.
        
        Returns (should_escalate, reason).
        """
        # Repeated out-of-domain
        if self.ood_strikes >= 3:
            return True, "repeated_out_of_domain"
        
        # User explicitly asked for human
        # (checked in orchestrator via message content)
        
        # Too many clarification failures
        if self.clarification_failures >= 3:
            return True, "repeated_clarification_failures"
        
        # User is frustrated
        if self.fatigue_level == "frustrated":
            return True, "user_frustrated"
        
        # Regulatory risk with low confidence
        reg_slot = self.slots.get("regulatory_flags")
        if reg_slot and reg_slot.status == "filled" and reg_slot.confidence < 0.5:
            return True, "regulatory_low_confidence"
        
        return False, ""
    
    def record_clarification_failure(self):
        """Record that agent failed to understand user."""
        self.clarification_failures += 1
