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
import re

from ..config import settings
from ..llm.factory import get_llm
from .state import COLLECTION_SLOTS, INTENTS, SLOT_LABELS, DialogueState

logger = logging.getLogger("agentic_ba")


class LLMUnavailable(RuntimeError):
    """The primary dialogue model cannot produce a valid turn decision."""

ALLOWED_ACTIONS = {"ask", "reflect", "summarize", "draft", "answer"}
ALLOWED_SLOTS = set(COLLECTION_SLOTS) | {"need_statement", "open_questions"}

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
- role — только пользовательская роль, непосредственно работающая с системой;
  согласующая группа, комиссия и руководство не являются role.
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

Допустимые поля: intent, need_statement, role, department, process, product,
module, as_is, to_be, users, scenarios, business_rules, acceptance_criteria,
data_integrations, value, priority, regulatory_flags, dependencies, risks,
open_questions.

Структура:
{"facts":[{"field":"...","value":"...","evidence":"точная цитата пользователя","confidence":0.0,"assumption":false,
"correction":false}],"next_action":"ask|reflect|summarize|draft|answer",
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
        }


def _json_object(text: str) -> dict:
    raw = (text or "").strip()
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.I | re.S)
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("LLM response has no JSON object")
    return json.loads(raw[start:end + 1])


def _validate(data: dict) -> TurnDecision:
    facts = []
    for raw in data.get("facts", []) if isinstance(data.get("facts"), list) else []:
        if not isinstance(raw, dict) or raw.get("field") not in ALLOWED_SLOTS:
            continue
        value = str(raw.get("value", "")).strip()
        if not value:
            continue
        try:
            confidence = min(1.0, max(0.0, float(raw.get("confidence", 0.8))))
        except (TypeError, ValueError):
            confidence = 0.8
        facts.append(Fact(
            field=raw["field"], value=value, confidence=confidence,
            assumption=bool(raw.get("assumption", False)),
            correction=bool(raw.get("correction", False)),
            evidence=str(raw.get("evidence", "")).strip(),
        ))
    action = str(data.get("next_action", "ask"))
    if action not in ALLOWED_ACTIONS:
        action = "ask"
    focus = str(data.get("focus", ""))
    if focus not in ALLOWED_SLOTS:
        focus = ""
    return TurnDecision(
        facts=facts, next_action=action, focus=focus,
        reply=str(data.get("reply", "")).strip(),
        assumptions=[str(x) for x in data.get("assumptions", []) if str(x).strip()],
        contradictions=[str(x) for x in data.get("contradictions", []) if str(x).strip()],
        ready_for_draft=bool(data.get("ready_for_draft", False)),
        use_knowledge_base=bool(data.get("use_knowledge_base", False)),
        knowledge_query=str(data.get("knowledge_query", "")).strip(),
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
        if fact.field == "role" and any(marker in low for marker in cls._ROLE_NON_USER):
            return "согласующая сторона не является пользовательской ролью"
        if fact.field == "process" and any(marker in low for marker in cls._ROLLOUT):
            return "стратегия внедрения не является бизнес-процессом"
        if fact.field == "scenarios" and any(marker in low for marker in cls._ROLLOUT):
            return "план релиза не является пользовательским сценарием"
        if fact.field == "value" and any(marker in low for marker in cls._VALUE_NON_EFFECT):
            return "источник инициативы не является бизнес-ценностью"
        return ""

    @classmethod
    def guard_facts(cls, state: DialogueState, message: str, decision: TurnDecision) -> None:
        """Reject semantic slot mismatches and calibrate unsupported confidence."""
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
            rejection = cls._semantic_rejection(fact)
            if rejection:
                decision.contradictions.append(
                    f"{SLOT_LABELS.get(fact.field, fact.field)} не заполнено: {rejection}."
                )
                continue
            if fact.evidence and not cls._evidence_is_supported(state, message, fact.evidence):
                fact.assumption = True
                fact.confidence = min(fact.confidence, 0.6)
            elif not fact.evidence and not fact.assumption:
                # Старые/совместимые провайдеры могут не вернуть evidence. Факт
                # сохраняется, но больше не получает ложную абсолютную уверенность.
                fact.confidence = min(fact.confidence, 0.8)
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
        payload = {
            "requirement": {k: s.value for k, s in state.slots.items() if s.status == "filled"},
            "missing_hard": state.get_missing_mandatory_hard(),
            "last_question_focus": state.last_asked_slot or "",
            "history": state.history,
            "user_message": message,
            "dialogue_mode": state.dialogue_mode,
            "questions_asked": state.question_count,
            "can_generate_draft": state.all_mandatory_hard_filled(),
            "fatigue_level": state.fatigue_level,
        }
        try:
            chat = getattr(llm, "chat_json", llm.chat)
            answer = chat(
                [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                system_prompt=SYSTEM, temperature=0.2,
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
                    system_prompt=SYSTEM, temperature=0.0,
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
        }
        return prompts.get(focus, f"Что важно уточнить по аспекту «{SLOT_LABELS.get(focus, focus)}»?")

    @staticmethod
    def apply(state: DialogueState, decision: TurnDecision) -> list[str]:
        updated = []
        for fact in decision.facts:
            current = state.get(fact.field)
            if current and current != fact.value:
                if not fact.correction:
                    decision.contradictions.append(
                        f"{SLOT_LABELS.get(fact.field, fact.field)}: «{current}» / «{fact.value}»"
                    )
                    continue
                state.record_slot_change(fact.field, current, fact.value, reason="agentic_correction")
            state.set(fact.field, fact.value, fact.confidence, source="llm_extraction",
                      assumption=fact.assumption)
            updated.append(fact.field)
        if decision.assumptions:
            state.sources.extend({"type": "assumption", "text": x} for x in decision.assumptions)
        return updated


agentic_ba = AgenticBA()
