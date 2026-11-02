"""LLM-driven business-analysis turn planner.

Python validates and applies decisions; it does not prescribe a questionnaire.
The model receives the current requirement map and recent conversation, then
returns facts plus the single most useful next action as strict JSON.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import logging
import math
import re

from ..config import settings
from ..llm.factory import get_llm
from .state import (
    ASSIGNMENT_SLOTS,
    COLLECTION_SLOTS,
    INTENTS,
    REQUIREMENT_V2_SLOTS,
    SLOT_LABELS,
    DialogueState,
    value_status,
)
from ..v2.prompts import load_prompt_set

logger = logging.getLogger("agentic_ba")


class LLMUnavailable(RuntimeError):
    """The primary dialogue model cannot produce a valid turn decision."""

ALLOWED_ACTIONS = {"ask", "reflect", "summarize", "draft", "answer"}
ALLOWED_SLOTS = (
    set(COLLECTION_SLOTS)
    | set(ASSIGNMENT_SLOTS)
    | set(REQUIREMENT_V2_SLOTS)
    | {"need_statement", "open_questions"}
)
ALLOWED_OPERATIONS = {"add", "replace", "remove", "confirm", "defer"}
COMPOUND_SLOTS = {
    "users", "scenarios", "business_rules", "acceptance_criteria", "data_integrations",
    "dependencies", "risks", "regulatory_flags", "open_questions",
}

SYSTEM = """Ты — ведущий бизнес-аналитик платформы сопровождения инвестиционных сделок.
Веди естественное исследовательское интервью, а не анкету. Извлекай все явно
сообщённые факты из каждой реплики. Не выдумывай факты. Короткие ответы трактуй
в контексте последнего вопроса. Реплики «я уже ответил», «что уточнить?» и
вопросы о ходе беседы считай обратной связью: ответь по контексту, признай ошибку
при необходимости и продолжи. Никогда не используй базу знаний для объяснения
собственного вопроса. Не уточняй принадлежность к платформе, если пользователь
уже назвал платформу, сделку, карточку, экран или другой системный объект.
Выбирай один следующий вопрос с максимальной ценностью для границ решения,
бизнес-правил и проверяемости. Работай на уровне бизнес-требования: сначала
выясняй проблему пользователя, ожидаемый результат, роли, основной сценарий,
исключения и наблюдаемые критерии приёмки. Не предлагай пользователю выбирать
техническую реализацию (синхронный или асинхронный вызов, очередь, callback,
протокол, endpoint, формат payload, способ хранения), если он явно не просил
техническую проработку. Если пользователь сам сообщил технические детали,
зафиксируй их, но не углубляйся автоматически; недостающие проектные решения
помечай открытыми вопросами для системного аналитика или архитектора.

После заполнения минимального ядра — потребность, целевое поведение, роль и
процесс — не продолжай необязательную анкету. Если нет одного действительно
критического пробела, выбирай summarize или draft. Если критический вопрос всё
же нужен, в reply коротко сообщи, что черновик уже можно подготовить сейчас.
На вопросы «много ещё вопросов?», «что осталось?» и похожие сначала прямо
ответь о прогрессе и предложи закончить, а не задавай новый вопрос.
Не предлагай варианты ответов и не повторяй уже известное. Верни только JSON.

Соблюдай семантику полей:
- role — пользовательская роль, непосредственно работающая с системой.
  Согласующий менеджер или член комиссии тоже может быть пользователем; отличай
  участника работы в системе от внешней стороны, принимающей результат проекта.
- process — бизнес-процесс, в котором используется система; способ внедрения,
  этапность и «один релиз» не являются process.
- scenarios — действия пользователя и реакция системы; перечень экранов, объём
  работ и план релиза не являются пользовательским сценарием.
- value — ожидаемый бизнес-эффект или снижение риска; «требование руководства»
  и «надо сделать» описывают источник инициативы, но не бизнес-ценность.
- dependencies — внешние условия и обязательные входные материалы, например
  утверждённый брендбук.
- acceptance_criteria — наблюдаемый способ проверки результата; одной ссылки
  на стандарт или фразы «соответствует брендбуку» недостаточно без объекта,
  охвата либо способа проверки.
Если факт не подходит ни к одному полю, не помещай его в ближайшее по смыслу
поле: добавь его в assumptions или open_questions.

Для каждого факта возвращай evidence — короткую точную цитату из текущей или
предыдущей реплики пользователя. Если точной опоры нет, ставь assumption=true
и confidence не выше 0.6. Не расширяй состав групп и перечень объектов за
пределы пользовательской цитаты.

operation определяет изменение факта: add добавляет новый элемент без удаления
старых; replace заменяет прежнее значение целиком только по явной правке
пользователя; remove удаляет указанное прежнее значение по прямому указанию;
confirm подтверждает ранее обсуждённое значение; defer сохраняет неизвестность
или неприменимость (answer_status=unknown|not_applicable|deferred).
По умолчанию используй add. При дополнении списка возвращай только добавляемый
элемент. При replace верни полное итоговое значение. У replace/remove/confirm
цитата должна быть из текущей реплики. Не считай повторение гипотезы её
подтверждением. Учитывай requirement_state: unknown и deferred уже обсуждались,
assumption не является установленным фактом. Нерешённые conflicts не забывай.

Допустимые поля: intent, need_statement, role, department, process, product,
module, as_is, to_be, users, scenarios, business_rules, acceptance_criteria,
data_integrations, value, priority, regulatory_flags, dependencies, risks,
open_questions.

Структура:
{"facts":[{"field":"...","value":"...","evidence":"точная цитата пользователя","confidence":0.0,"assumption":false,
"correction":false,"operation":"add","answer_status":"known"}],"next_action":"ask|reflect|summarize|draft|answer",
"focus":"поле или пустая строка","reply":"одна естественная реплика",
"ready_for_draft":false,"use_knowledge_base":false,"knowledge_query":"",
"assumptions":[],"contradictions":[]}

ready_for_draft=true только когда понятны сама потребность, ожидаемое поведение,
пользователи и ключевые параметры решения. use_knowledge_base=true только если
пользователь явно просит справочную информацию о существующей платформе."""


@dataclass
class Fact:
    field: str
    value: str
    confidence: float = 0.8
    assumption: bool = False
    correction: bool = False
    evidence: str = ""
    operation: str = ""  # Empty supports decisions from older providers
    answer_status: str = "known"
    message_id: str = ""
    grounded: bool = False
    current_support: bool = False


@dataclass
class TurnDecision:
    facts: list[Fact] = field(default_factory=list)
    next_action: str = "ask"
    focus: str = ""
    reply: str = ""
    assumptions: list[str] = field(default_factory=list)
    contradictions: list[str] = field(default_factory=list)
    ready_for_draft: bool = False
    use_knowledge_base: bool = False
    knowledge_query: str = ""
    source: str = "fallback"
    application_results: list[dict] = field(default_factory=list)
    _guard_key: tuple | None = field(default=None, repr=False)

    def as_dict(self) -> dict:
        return {
            "facts": [vars(item) for item in self.facts],
            "next_action": self.next_action,
            "focus": self.focus,
            "reply": self.reply,
            "assumptions": self.assumptions,
            "contradictions": self.contradictions,
            "ready_for_draft": self.ready_for_draft,
            "use_knowledge_base": self.use_knowledge_base,
            "knowledge_query": self.knowledge_query,
            "source": self.source,
            "application_results": self.application_results,
        }


def _json_object(text: str) -> dict:
    raw = (text or "").strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.I | re.S)
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("LLM response has no JSON object")
    return json.loads(raw[start:end + 1])


def _validate(data: dict) -> TurnDecision:
    """Validate JSON types without truthiness or null-to-string coercion."""
    if not isinstance(data, dict):
        raise ValueError("decision must be an object")

    def boolean(raw, key, default=False):
        value = raw.get(key, default)
        if type(value) is not bool:
            raise ValueError(f"{key} must be a boolean")
        return value

    def string(raw, key, default="", limit=12000):
        value = raw.get(key, default)
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError(f"{key} must be a bounded string")
        return value.strip()

    def strings(key):
        values = data.get(key, [])
        if not isinstance(values, list) or len(values) > 50:
            raise ValueError(f"{key} must be a bounded list")
        if any(not isinstance(item, str) or len(item) > 4000 for item in values):
            raise ValueError(f"{key} must contain strings")
        return [item.strip() for item in values if item.strip()]

    raw_facts = data.get("facts", [])
    if not isinstance(raw_facts, list) or len(raw_facts) > 100:
        raise ValueError("facts must be a bounded list")
    facts = []
    for raw in raw_facts:
        if not isinstance(raw, dict):
            raise ValueError("fact must be an object")
        if not isinstance(raw.get("field"), str):
            raise ValueError("field must be a string")
        if raw.get("field") not in ALLOWED_SLOTS:
            continue
        operation = string(raw, "operation")
        if operation and operation not in ALLOWED_OPERATIONS:
            raise ValueError("unsupported fact operation")
        status = string(raw, "answer_status", "known")
        if status not in {"known", "unknown", "not_applicable", "deferred"}:
            raise ValueError("unsupported answer_status")
        value = string(raw, "value")
        if not value and operation not in {"remove", "confirm", "defer"}:
            raise ValueError("fact value must not be empty")
        confidence = raw.get("confidence", 0.8)
        if type(confidence) not in (int, float) or not math.isfinite(confidence) or not 0 <= confidence <= 1:
            raise ValueError("confidence must be a finite number between zero and one")
        facts.append(Fact(
            field=raw["field"], value=value, confidence=confidence,
            assumption=boolean(raw, "assumption"),
            correction=boolean(raw, "correction"),
            evidence=string(raw, "evidence", limit=4000),
            operation=operation, answer_status=status,
        ))
    action = string(data, "next_action", "ask")
    if action not in ALLOWED_ACTIONS:
        action = "ask"
    focus = string(data, "focus")
    if focus not in ALLOWED_SLOTS:
        focus = ""
    return TurnDecision(
        facts=facts, next_action=action, focus=focus,
        reply=string(data, "reply"),
        assumptions=strings("assumptions"), contradictions=strings("contradictions"),
        ready_for_draft=boolean(data, "ready_for_draft"),
        use_knowledge_base=boolean(data, "use_knowledge_base"),
        knowledge_query=string(data, "knowledge_query", limit=4000),
        source="llm",
    )


class AgenticBA:
    _ROLE_NON_USER = ("рабочая группа", "комиссия", "руководство", "согласующ")
    _ROLLOUT = ("одномомент", "поэтап", "один релиз", "этап внедрения", "внедр")
    _VALUE_NON_EFFECT = ("требование руководства", "поручение руководства", "надо сделать")
    _NEED_MARKERS = (
        "нуж", "хочу", "треб", "измен", "добав", "убрат", "удал", "сдела",
        "перекрас", "редизайн", "дизайн", "исправ", "автоматиз", "доработ",
    )

    @staticmethod
    def enabled() -> bool:
        """Whether the optional LLM decision layer can be used safely."""
        llm = get_llm()
        return getattr(llm, "name", "mock") != "mock" and bool(llm.available())

    @staticmethod
    def _normalise_evidence(value: str) -> str:
        return re.sub(r"\s+", " ", (value or "").strip().lower())

    @classmethod
    def _evidence_is_supported(cls, state: DialogueState, message: str, evidence: str) -> bool:
        needle = cls._normalise_evidence(evidence)
        if not needle:
            return False
        corpus = [message]
        corpus.extend(
            item.get("content", "") for item in state.history if item.get("role") == "user"
        )
        return any(needle in cls._normalise_evidence(text) for text in corpus)

    @classmethod
    def _semantic_rejection(cls, fact: Fact) -> str:
        low = fact.value.lower()
        if fact.field == "role" and re.fullmatch(
            r"(?:совместная |приёмочная |приемочная )?(?:рабочая группа|комиссия|руководство)", low
        ):
            return "согласующая сторона не является пользовательской ролью"
        if fact.field == "process" and re.search(
            r"^(?:одномоментн\w*|поэтапн\w*|один релиз|этап внедрения)|(?:вся|всей) платформ\w*$", low
        ):
            return "стратегия внедрения не является бизнес-процессом"
        if fact.field == "scenarios" and re.search(r"(?:за один релиз|одномоментный переход)$", low):
            return "план релиза не является пользовательским сценарием"
        if fact.field == "value" and low.strip(".! ") in cls._VALUE_NON_EFFECT:
            return "источник инициативы не является бизнес-ценностью"
        return ""

    @classmethod
    def _value_supported(cls, value: str, evidence: str) -> bool:
        """Conservative lexical support; this is not a claim of semantic entailment."""
        value, evidence = cls._normalise_evidence(value), cls._normalise_evidence(evidence)
        if value and value in evidence:
            return True
        if not value or not evidence:
            return False
        if set(re.findall(r"\d+(?:[.,]\d+)?", value)) - set(re.findall(r"\d+(?:[.,]\d+)?", evidence)):
            return False
        if re.search(r"\bне\b", evidence) and not re.search(r"\bне\b", value):
            return False
        ignored = {"нужно", "должен", "должна", "система", "платформа", "пользователь", "может"}
        words = [word for word in re.findall(r"[a-zа-яё]+", value) if len(word) > 2 and word not in ignored]
        source = {word[:5] for word in re.findall(r"[a-zа-яё]+", evidence) if len(word) > 2}
        return bool(words) and sum(word[:5] in source for word in words) / len(words) >= 0.75

    @classmethod
    def _contextual_absence(cls, state: DialogueState, message: str, fact: Fact) -> bool:
        """Interpret a closed-question 'no' without inventing entities or rules."""
        absent_values = {
            "data_integrations": {"интеграции не нужны", "нет интеграций", "без интеграций", "интеграции не требуются"},
            "dependencies": {"зависимостей нет", "нет зависимостей", "зависимости отсутствуют"},
            "risks": {"рисков нет", "нет рисков", "риски не выявлены"},
            "regulatory_flags": {"нет регуляторных аспектов", "регуляторные аспекты отсутствуют", "регуляторных ограничений нет"},
        }
        if state.last_asked_slot != fact.field or fact.field not in absent_values:
            return False
        if cls._normalise_evidence(message).strip(".!? ") != "нет":
            return False
        if cls._normalise_evidence(fact.evidence).strip(".!? ") != "нет":
            return False
        if cls._normalise_evidence(fact.value).strip(".!? ") not in absent_values[fact.field]:
            return False
        question = next((item.get("content", "") for item in reversed(state.history)
                         if item.get("role") == "assistant"), "").lower()
        subjects = {"data_integrations": "интеграц", "dependencies": "зависим", "risks": "риск", "regulatory_flags": "регулятор"}
        return subjects[fact.field] in question and "?" in question and not re.search(r"\bне\b", question) and bool(re.search(
            r"(?:^|[.!]\s*)(?:нужн[аыо]?\b|требу\w*\s+ли\b|есть\s+ли\b|имеются\s+ли\b|предусмотрены\s+ли\b)", question))

    @classmethod
    def guard_facts(cls, state: DialogueState, message: str, decision: TurnDecision) -> None:
        """Reject semantic slot mismatches and calibrate unsupported confidence."""
        guard_key = (id(state), len(state.history), message)
        if decision._guard_key == guard_key:
            return
        decision._guard_key = guard_key
        decision.application_results = []
        accepted = []
        has_need_statement = bool(state.get("need_statement")) or any(
            fact.field == "need_statement" for fact in decision.facts
        )
        for fact in decision.facts:
            # Providers occasionally put the full request into ``intent`` even
            # though that slot only accepts one of the canonical intent codes.
            # Preserve the user's statement as the requirement instead of
            # leaving the hard slot empty and asking them to repeat it.
            if fact.field == "intent" and fact.value not in INTENTS:
                if not has_need_statement:
                    fact.field = "need_statement"
                    has_need_statement = True
                else:
                    decision.contradictions.append(
                        "Тип обращения не заполнен: модель вернула описание потребности вместо кода типа."
                    )
                    continue
            rejection = cls._semantic_rejection(fact) if fact.operation not in {"remove", "confirm", "defer"} else ""
            if rejection:
                note = f"{SLOT_LABELS.get(fact.field, fact.field)} не заполнено: {rejection}."
                if note not in decision.contradictions:
                    decision.contradictions.append(note)
                decision.application_results.append({
                    "field": fact.field, "operation": fact.operation or "add",
                    "status": "rejected", "reason": rejection,
                })
                continue
            operation = fact.operation or ("replace" if fact.correction else "add")
            current = state.get(fact.field) or ""
            support_value = fact.value
            if operation == "add" and fact.field in COMPOUND_SLOTS and current:
                old_parts = {part.strip().casefold() for part in re.split(r"[;\n]+", str(current))}
                additions = [part.strip() for part in re.split(r"[;\n]+", fact.value) if part.strip().casefold() not in old_parts]
                if additions:
                    support_value = "; ".join(additions)
            if not fact.evidence and support_value and cls._normalise_evidence(support_value) in cls._normalise_evidence(message):
                fact.evidence = support_value
            elif support_value and cls._normalise_evidence(support_value) in cls._normalise_evidence(message) \
                    and not cls._value_supported(support_value, fact.evidence):
                fact.evidence = support_value
            intent_markers = {
                "feature": ("добав", "нуж", "созда", "новый", "новая", "хочу"),
                "change": ("измен", "исправ", "доработ", "обнов"),
                "problem": ("неудоб", "проблем", "меша"),
                "incident": ("ошиб", "сбой", "не работа", "падает"),
                "clarification": ("как ", "почему", "объясн", "что "),
            }
            if fact.field == "intent" and not fact.evidence and any(
                marker in message.lower() for marker in intent_markers.get(fact.value, ())
            ):
                fact.evidence = message
            exact_source = bool(fact.evidence) and cls._evidence_is_supported(state, message, fact.evidence)
            fact.current_support = bool(fact.evidence) and cls._normalise_evidence(fact.evidence) in cls._normalise_evidence(message)
            fact.grounded = exact_source and cls._value_supported(support_value, fact.evidence)
            if exact_source and cls._contextual_absence(state, message, fact):
                fact.grounded = True
            if fact.field == "intent" and exact_source and any(
                marker in fact.evidence.lower() for marker in intent_markers.get(fact.value, ())
            ):
                fact.grounded = True
            if re.search(r"\b(?:не уверен|не уверена|возможно|предполагаю|наверное)\b", message.lower()):
                fact.grounded = False
            if operation in {"remove", "confirm", "defer"} and fact.current_support:
                # The quote describes the operation; it need not repeat the stored value.
                markers = {"remove": ("убер", "убрат", "удал", "исключ", "не нуж", "отмен"),
                           "defer": ("не знаю", "не уверен", "уточн", "позже", "не примен", "не отно")}
                quote = fact.evidence.lower().strip(".!? ")
                if operation == "confirm":
                    fact.grounded = bool(re.search(r"\bподтверждаю\b", quote) or re.fullmatch(
                        r"(?:да|верно|вс[её] верно|согласен|согласна|правильно|так)", quote))
                    if re.search(r"\bне\b", quote):
                        fact.grounded = False
                else:
                    fact.grounded = any(marker in quote for marker in markers[operation])
                    if operation == "remove" and re.search(r"\bне (?:нужно |надо |следует )?(?:удал|убир|убра|исключ|отмен)", quote):
                        fact.grounded = False
            fact.current_support = fact.current_support and fact.grounded
            if not fact.grounded:
                fact.assumption = True
                fact.confidence = min(fact.confidence, 0.6)
            if fact.assumption:
                fact.confidence = min(fact.confidence, 0.6)
            fact.message_id = ""
            if exact_source:
                origin = next((item for item in reversed(state.history)
                               if item.get("role") == "user" and cls._normalise_evidence(fact.evidence) in cls._normalise_evidence(item.get("content", ""))), {})
                fact.message_id = origin.get("message_id", "")
            accepted.append(fact)
        decision.facts = accepted

    @classmethod
    def recover_need_statement(cls, state: DialogueState) -> bool:
        """Recover an already stated need from a malformed slot or user history."""
        if state.get("need_statement"):
            return False

        malformed_intent = state.get("intent")
        if malformed_intent and malformed_intent not in INTENTS:
            state.set(
                "need_statement", malformed_intent, confidence=0.9,
                source="semantic_recovery",
            )
            return True

        for item in state.history:
            if item.get("role") != "user":
                continue
            content = re.sub(r"\s+", " ", item.get("content", "")).strip()
            low = content.lower()
            if len(content) >= 12 and any(marker in low for marker in cls._NEED_MARKERS):
                state.set(
                    "need_statement", content, confidence=0.75,
                    source="history_recovery",
                )
                return True
        return False

    @staticmethod
    def _safe_answer_diagnostics(answer, llm) -> dict:
        """Return bounded diagnostics without credentials or full conversation text."""
        text = answer if isinstance(answer, str) else repr(answer)
        cleaned = re.sub(
            r"(?i)(api[_ -]?key|authorization|bearer|token)\s*[:=]?\s*\S+",
            r"\1=[REDACTED]",
            text,
        )
        cleaned = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[EMAIL]", cleaned)
        cleaned = re.sub(r"\b\d{6,}\b", "[NUMBER]", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()[:160]
        meta = getattr(llm, "last_response_meta", {}) or {}
        return {
            "answer_type": type(answer).__name__,
            "answer_length": len(text),
            "answer_sha256": hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()[:16],
            "preview": cleaned,
            "http_status": meta.get("http_status"),
            "content_type": meta.get("content_type"),
            "finish_reason": meta.get("finish_reason"),
        }

    def decide_strict(self, state: DialogueState, message: str) -> TurnDecision:
        """Return an LLM decision or fail closed. No conversational fallback."""
        llm = get_llm()
        if getattr(llm, "name", "mock") == "mock" or not llm.available():
            raise LLMUnavailable("LLM provider is not configured")
        prompt, prompt_version = load_prompt_set(
            state.product_mode or "requirement_copilot",
            state.operator_role or "BA",
        )
        state.prompt_set_version = prompt_version
        payload = {
            "requirement": {k: s.value for k, s in state.slots.items() if s.status == "filled"},
            "requirement_state": {
                k: {"value": s.value, "status": s.status, "confidence": s.confidence,
                    "assumption": s.assumption, "confirmed": s.confirmed,
                    "evidence": s.evidence, "message_id": s.message_id,
                    "provenance": [{"evidence": item.get("evidence", ""),
                                    "message_id": item.get("message_id", ""),
                                    "assumption": item.get("assumption", False)} for item in s.provenance]}
                for k, s in state.slots.items() if s.status != "empty" or s.value is not None
            },
            "requirement_conflicts": [item for item in state.requirement_conflicts if item.get("status") == "open"],
            "requirement_assumptions": [item for item in state.requirement_assumptions if item.get("status") == "open"],
            "open_gaps": [vars(gap) for gap in state.gaps if gap.status != "resolved"],
            "missing_hard": state.get_missing_mandatory_hard(),
            "last_question_focus": state.last_asked_slot or "",
            "history": state.history[-max(2, settings.AGENT_LLM_HISTORY_MESSAGES):],
            "user_message": message,
            "dialogue_mode": state.dialogue_mode,
            "questions_asked": state.question_count,
            "can_generate_draft": state.all_mandatory_hard_filled(),
            "fatigue_level": state.fatigue_level,
            "product_mode": state.product_mode,
            "operator_role": state.operator_role,
            "source_context": state.source_context,
            "linked_object_snapshot": state.linked_object_snapshot,
            "prompt_set_version": prompt_version,
        }
        try:
            chat = getattr(llm, "chat_json", llm.chat)
            answer = chat(
                [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                system_prompt=prompt, temperature=0.2,
                max_tokens=settings.AGENT_DECISION_MAX_TOKENS,
            )
            try:
                decision = _validate(_json_object(answer))
            except (json.JSONDecodeError, ValueError) as exc:
                logger.warning(
                    "Agentic BA received invalid JSON; retrying once: %s diagnostics=%s",
                    exc, self._safe_answer_diagnostics(answer, llm),
                )
                answer = chat(
                    [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                    system_prompt=prompt, temperature=0.0,
                    max_tokens=settings.AGENT_DECISION_MAX_TOKENS,
                )
                try:
                    decision = _validate(_json_object(answer))
                except (json.JSONDecodeError, ValueError):
                    logger.error(
                        "Agentic BA retry also returned invalid JSON: diagnostics=%s",
                        self._safe_answer_diagnostics(answer, llm),
                    )
                    raise
            if not decision.reply and not decision.facts:
                raise ValueError("empty structured decision")
            self.guard_facts(state, message, decision)
            return decision
        except Exception as exc:
            logger.error("Agentic BA LLM decision failed: %s", exc)
            raise LLMUnavailable(str(exc)) from exc

    def fallback_question(self, state: DialogueState, focus: str) -> str:
        prompts = {
            "need_statement": "Опишите, пожалуйста, какую проблему или изменение нужно проработать.",
            "role": "Кто должен видеть это изменение или пользоваться им?",
            "process": "В какой момент работы со сделкой понадобится это изменение?",
            "to_be": "Что именно должно отображаться или происходить после изменения?",
            "acceptance_criteria": "Какой конкретный результат должен увидеть пользователь?",
            "data_integrations": "Откуда должны поступать данные для этого изменения?",
            "business_rules": "Какие ограничения или исключения нужно учесть?",
            "risks": "Какие ошибки или нежелательные последствия важно предусмотреть?",
            "assignment_statement": "Как бы вы одним предложением сформулировали суть поручения?",
            "business_goal": "Какую бизнес-цель должно поддержать это поручение?",
            "expected_result": "Какой конкретный результат ожидается от проработки?",
            "scope_in": "Что точно входит в границы поручения?",
            "scope_out": "Что следует явно оставить за границами?",
            "originator": "Кто передал поручение, или нужно отметить инициатора как неизвестного?",
            "deadline_or_urgency": "Какой срок или срочность заданы, или срок не указан?",
            "owner_next_step": "Кто отвечает за следующий шаг после фиксации поручения?",
        }
        return prompts.get(focus, f"Что важно уточнить по аспекту «{SLOT_LABELS.get(focus, focus)}»?")

    @staticmethod
    def apply(state: DialogueState, decision: TurnDecision) -> list[str]:
        """Apply grounded operations and retain unresolved alternatives across turns.

        The return value stays compatible with older orchestrators. Per-fact
        application_results is the authoritative acknowledgement contract.
        """
        updated = []

        def remember(collection, item):
            identity = json.dumps({key: item.get(key) for key in ("code", "field", "text", "old_value", "new_value", "message")}, ensure_ascii=False, sort_keys=True)
            item["id"] = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]
            existing = next((old for old in collection if old.get("id") == item["id"]), None)
            if existing is None:
                collection.append(item)
            elif existing.get("status") == "resolved":
                existing.update(item)

        def conflict(fact, current, reason):
            message = f"{SLOT_LABELS.get(fact.field, fact.field)}: «{current}» / «{fact.value}»"
            if message not in decision.contradictions:
                decision.contradictions.append(message)
            remember(state.requirement_conflicts, {
                "code": "fact_conflict", "severity": "critical", "field": fact.field, "slot": fact.field,
                "message": message, "question": f"Уточните итоговое значение: {SLOT_LABELS.get(fact.field, fact.field)}.",
                "old_value": current, "new_value": fact.value, "evidence": fact.evidence,
                "message_id": fact.message_id, "status": "open", "resolution": "", "reason": reason,
            })

        def result(fact, operation, status, reason=""):
            decision.application_results.append({"field": fact.field, "operation": operation, "status": status, "reason": reason})

        for note in decision.contradictions:
            remember(state.requirement_conflicts, {
                "code": "model_conflict", "severity": "warning", "field": "", "slot": "",
                "message": note, "question": note, "status": "open", "resolution": "",
            })
        for fact in decision.facts:
            operation = fact.operation or ("replace" if fact.correction else "add")
            if fact.answer_status != "known" or value_status(fact.value) in {"unknown", "not_applicable"}:
                operation = "defer"
            slot = state.get_slot(fact.field)
            current = state.get(fact.field)
            if not fact.grounded or fact.assumption:
                remember(state.requirement_assumptions, {
                    "field": fact.field, "slot": fact.field, "text": fact.value, "status": "open",
                    "evidence": fact.evidence, "message_id": fact.message_id, "source": "llm",
                })
                result(fact, operation, "rejected", "Нет достаточной пользовательской опоры; сохранено как предположение")
                continue
            if operation in {"replace", "remove", "confirm"} and not (fact.current_support and not fact.assumption):
                reason = "Изменение требует подтверждающей цитаты из текущей реплики"
                if current and fact.value and current != fact.value:
                    conflict(fact, current, reason)
                result(fact, operation, "rejected", reason)
                continue
            if operation == "defer":
                if current and not fact.current_support:
                    result(fact, operation, "rejected", "Нельзя заменить известный факт неопределённостью без текущего ответа")
                    continue
                status = fact.answer_status
                status = value_status(fact.value) if status == "known" else status
                value = "Не применимо" if status == "not_applicable" else "Не знаю"
            elif operation == "confirm":
                if not current or (fact.value and fact.value != current):
                    result(fact, operation, "rejected", "Подтверждение должно относиться к существующему значению")
                    continue
                value = current
            elif operation == "remove":
                if not current:
                    result(fact, operation, "unchanged")
                    continue
                if fact.value and fact.value != current:
                    parts = state.list_values(fact.field)
                    if fact.field not in COMPOUND_SLOTS or fact.value not in parts:
                        result(fact, operation, "rejected", "Удаляемый элемент не найден")
                        continue
                    value = "; ".join(part for part in parts if part != fact.value)
                else:
                    value = ""
            elif operation == "add" and current:
                if current == fact.value:
                    result(fact, operation, "unchanged")
                    continue  # Repetition cannot promote or demote epistemic status.
                if fact.field not in COMPOUND_SLOTS:
                    conflict(fact, current, "Новая версия не является явным исправлением")
                    result(fact, operation, "conflict", "Требуется выбор итоговой версии")
                    continue
                parts = state.list_values(fact.field)
                seen = {part.casefold() for part in parts}
                incoming = [part.strip() for part in re.split(r"[;\n]+", fact.value) if part.strip()]
                def numeric_rule(text):
                    numbers = tuple(re.findall(r"\d+(?:[.,]\d+)?", text))
                    skeleton = re.sub(r"\d+(?:[.,]\d+)?", "#", text.casefold())
                    return re.sub(r"\s+", " ", skeleton).strip(), numbers
                incompatible = any(
                    numeric_rule(old)[0] == numeric_rule(new)[0]
                    and numeric_rule(old)[1] != numeric_rule(new)[1]
                    for old in parts for new in incoming
                )
                if incompatible:
                    conflict(fact, current, "Дополнение меняет числовое значение существующего правила")
                    result(fact, operation, "conflict", "Уточните новое значение существующего правила")
                    continue
                for part in incoming:
                    if part and part.casefold() not in seen:
                        parts.append(part)
                        seen.add(part.casefold())
                value = "; ".join(parts)
                if value == current:
                    result(fact, operation, "unchanged")
                    continue
            else:
                value = fact.value
            if current and current != value:
                state.record_slot_change(fact.field, current, value, reason=f"agentic_{operation}")
            provenance = list(slot.provenance) if slot and operation == "add" else []
            if slot and current and operation == "add" and not provenance:
                provenance.append({"value": current, "evidence": slot.evidence, "message_id": slot.message_id,
                                   "assumption": slot.assumption, "source": slot.source})
            origin = {"value": fact.value, "evidence": fact.evidence, "message_id": fact.message_id,
                      "assumption": fact.assumption, "source": "llm_extraction"}
            if origin not in provenance:
                provenance.append(origin)
            assumption = fact.assumption or bool(slot and operation == "add" and slot.assumption)
            confidence = min(slot.confidence, fact.confidence) if slot and current and operation == "add" else fact.confidence
            state.set(fact.field, value, confidence, source="llm_extraction", assumption=assumption,
                      confirmed=operation == "confirm", evidence=fact.evidence,
                      message_id=fact.message_id, provenance=provenance)
            if operation == "defer" and fact.answer_status == "deferred":
                state.get_slot(fact.field).status = "skipped"
            if operation in {"replace", "confirm"} or (operation == "remove" and not value):
                state.resolve_field_conflicts(fact.field, value, f"agentic_{operation}")
                state.resolve_field_assumptions(fact.field, f"agentic_{operation}")
            if assumption and value_status(value) == "filled":
                remember(state.requirement_assumptions, {
                    "field": fact.field, "slot": fact.field, "text": fact.value, "status": "open",
                    "evidence": fact.evidence, "message_id": fact.message_id, "source": "llm",
                })
            if fact.field not in updated:
                updated.append(fact.field)
            result(fact, operation, "applied")
        if decision.assumptions:
            for note in decision.assumptions:
                remember(state.requirement_assumptions, {"field": "", "slot": "", "text": note, "status": "open", "source": "llm"})
                source = {"type": "assumption", "text": note}
                if source not in state.sources:
                    state.sources.append(source)
        return updated


agentic_ba = AgenticBA()
