"""LLM-driven business-analysis turn planner.

Python validates and applies decisions; it does not prescribe a questionnaire.
The model receives the current requirement map and recent conversation, then
returns facts plus the single most useful next action as strict JSON.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import logging
import re

from ..config import settings
from ..llm.factory import get_llm
from .state import COLLECTION_SLOTS, SLOT_LABELS, DialogueState

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
Выбирай один следующий вопрос с максимальной
ценностью для границ решения, рисков и проверяемости. Сначала выясняй параметры
самого изменения (например, какой цвет, какие элементы, источник данных,
редактируемость и исключения), и только потом формальные критерии приёмки.
Не предлагай варианты ответов и не повторяй уже известное. Верни только JSON.

Допустимые поля: intent, need_statement, role, department, process, product,
module, as_is, to_be, users, scenarios, business_rules, acceptance_criteria,
data_integrations, value, priority, regulatory_flags, dependencies, risks,
open_questions.

Структура:
{"facts":[{"field":"...","value":"...","confidence":0.0,"assumption":false,
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
        value = str(raw.get("value", "")).strip()[:2000]
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
        ))
    action = str(data.get("next_action", "ask"))
    if action not in ALLOWED_ACTIONS:
        action = "ask"
    focus = str(data.get("focus", ""))
    if focus not in ALLOWED_SLOTS:
        focus = ""
    return TurnDecision(
        facts=facts, next_action=action, focus=focus,
        reply=str(data.get("reply", "")).strip()[:2000],
        assumptions=[str(x)[:500] for x in data.get("assumptions", []) if str(x).strip()][:10],
        contradictions=[str(x)[:500] for x in data.get("contradictions", []) if str(x).strip()][:10],
        ready_for_draft=bool(data.get("ready_for_draft", False)),
        use_knowledge_base=bool(data.get("use_knowledge_base", False)),
        knowledge_query=str(data.get("knowledge_query", "")).strip()[:1000],
        source="llm",
    )


class AgenticBA:
    def decide_strict(self, state: DialogueState, message: str) -> TurnDecision:
        """Return an LLM decision or fail closed. No conversational fallback."""
        llm = get_llm()
        if getattr(llm, "name", "mock") == "mock" or not llm.available():
            raise LLMUnavailable("LLM provider is not configured")
        payload = {
            "requirement": {k: s.value for k, s in state.slots.items() if s.status == "filled"},
            "missing_hard": state.get_missing_mandatory_hard(),
            "last_question_focus": state.last_asked_slot or "",
            "recent_history": state.history[-8:],
            "user_message": message,
        }
        try:
            answer = llm.chat(
                [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                system_prompt=SYSTEM, temperature=0.2, max_tokens=1000,
            )
            decision = _validate(_json_object(answer))
            if not decision.reply and not decision.facts:
                raise ValueError("empty structured decision")
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
