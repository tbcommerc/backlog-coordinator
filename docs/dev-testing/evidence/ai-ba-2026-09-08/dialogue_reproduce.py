"""Pure in-memory reproductions for the 2026-09-08 AI BA dialogue audit.

Run from any directory with a Python environment containing agent dependencies.
No LLM, network, database, protected records, or application logging is used.
The only output file is dialogue_results.json next to this script.
These checks demonstrate accepted problematic inputs, not their production rate.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "agent"))

from agent.config import settings
from agent.dialogue.agentic import AgenticBA, Fact, TurnDecision, _validate
from agent.dialogue.state import DialogueState, value_status
from agent.dialogue.quality import assess_quality
from agent.composer.composer import build_draft
from agent.agentic_orchestrator import AgenticOrchestrator


class MemoryStore:
    def __init__(self, state):
        self.state = state

    def get(self, session_id):
        return self.state

    def save(self, state):
        self.state = state


def silent_addition_loss():
    state = DialogueState(session_id="in-memory-dialogue-audit")
    for key, value in {
        "need_statement": "Добавить лимит на операции в карточке сделки",
        "to_be": "При превышении лимита показывается отказ",
        "role": "бэк-офицер",
        "process": "заключение сделки",
        "business_rules": "Операции доступны только в рабочие дни",
    }.items():
        state.set(key, value)
    state.add_message("user", "Операции доступны только в рабочие дни")
    runtime = AgenticOrchestrator(MemoryStore(state))
    addition = TurnDecision(
        facts=[Fact(
            "business_rules",
            "Операции доступны только в рабочие дни; лимит 10 млн рублей",
            0.99, evidence="Добавьте лимит 10 млн рублей",
        )],
        next_action="ask", focus="acceptance_criteria",
        reply="Лимит 10 млн зафиксирован. Как проверить отказ?",
    )
    with patch("agent.agentic_orchestrator.agentic_ba.decide_strict", return_value=addition):
        response = runtime.handle_message(state.session_id, "Добавьте лимит 10 млн рублей")
    first = {
        "reply": response.message,
        "actual_rules": state.get("business_rules"),
        "decision_conflicts": list(state.last_agent_decision["contradictions"]),
    }
    second = TurnDecision(
        facts=[Fact(
            "acceptance_criteria", "При операции на 11 млн отображается отказ",
            0.99, evidence="При операции на 11 млн отображается отказ",
        )], next_action="answer", reply="Зафиксировано.",
    )
    with patch("agent.agentic_orchestrator.agentic_ba.decide_strict", return_value=second):
        runtime.handle_message(state.session_id, "При операции на 11 млн отображается отказ")
    draft = build_draft(state, None)
    assert "10 млн" not in state.get("business_rules")
    assert state.last_agent_decision["contradictions"] == []
    assert draft.conflicts == []
    return {
        "first_turn": first,
        "next_turn": {
            "actual_rules": draft.business_rules,
            "criteria": draft.acceptance_criteria,
            "decision_conflicts": state.last_agent_decision["contradictions"],
            "draft_conflicts": draft.conflicts,
            "gaps": draft.gaps,
        },
    }


def evidence_and_readiness():
    state = DialogueState()
    message = "Нужно поле ИНН в карточке сделки"
    decision = TurnDecision(facts=[
        Fact("role", "Все сотрудники банка", 1.0, evidence="карточке сделки"),
        Fact("process", "расчёты", 1.0),
        Fact("to_be", "Раскрывать ИНН всем сотрудникам", 1.0, evidence="отсутствующая цитата"),
        Fact("need_statement", message, 1.0, evidence=message),
    ])
    AgenticBA.guard_facts(state, message, decision)
    AgenticBA.apply(state, decision)
    draft = build_draft(state, None)
    assert state.all_mandatory_hard_filled()
    assert not state.get_slot("role").assumption
    assert state.get_slot("role").confidence == 1.0
    assert state.get_slot("to_be").assumption
    assert not any(item["severity"] == "critical" for item in draft.review_findings)
    return {
        "user_message": message,
        "can_generate_draft": state.all_mandatory_hard_filled(),
        "slots": {key: vars(state.get_slot(key)) for key in ("role", "process", "to_be")},
        "review_findings": draft.review_findings,
        "provenance": draft.field_provenance,
    }


def malformed_schema():
    state = DialogueState()
    state.set("role", "бэк-офицер")
    decision = _validate({
        "facts": [{"field": "role", "value": "администратор", "correction": "false", "assumption": "false"}],
        "ready_for_draft": "false", "use_knowledge_base": "false",
    })
    AgenticBA.apply(state, decision)
    string_booleans = {"actual_role": state.get("role"), "decision": decision.as_dict()}
    assert decision.ready_for_draft and decision.use_knowledge_base
    assert state.get("role") == "администратор"
    empty_state = DialogueState()
    empty = _validate({"facts": [
        {"field": key, "value": None} for key in ("need_statement", "to_be", "role", "process")
    ]})
    AgenticBA.guard_facts(empty_state, "не знаю", empty)
    AgenticBA.apply(empty_state, empty)
    assert empty_state.all_mandatory_hard_filled()
    return {
        "string_booleans": string_booleans,
        "null_core": {
            "can_generate_draft": empty_state.all_mandatory_hard_filled(),
            "slots": {key: empty_state.get(key) for key in ("need_statement", "to_be", "role", "process")},
        },
    }


def assumption_promotion():
    state = DialogueState()
    state.set("to_be", "Система автоматически пересчитывает лимит", 0.5, assumption=True)
    before = dict(vars(state.get_slot("to_be")))
    message = "Пока не уверен в автоматическом пересчёте"
    decision = TurnDecision(facts=[Fact("to_be", "Система автоматически пересчитывает лимит", 1.0)])
    AgenticBA.guard_facts(state, message, decision)
    AgenticBA.apply(state, decision)
    assert not state.get_slot("to_be").assumption
    assert state.get_slot("to_be").confidence == 0.8
    return {"user_message": message, "before": before, "after": dict(vars(state.get_slot("to_be")))}


def context_loss():
    state = DialogueState()
    state.set("value", "Не знаю")
    state.set("role", "инвестор", 0.5, assumption=True)
    state.sources = [{"type": "assumption", "text": "Работа без электронной подписи"}]
    state.last_agent_decision = {"contradictions": ["Срок 1 час либо 1 день"]}
    state.add_message("user", "Не знаю бизнес-эффект")
    for index in range(22):
        state.add_message("assistant", f"Уточнение {index}")
        state.add_message("user", f"Дополнение {index}")
    captured = {}

    class FakeLLM:
        name = "fake"

        def available(self):
            return True

        def chat(self, messages, **kwargs):
            captured.update(json.loads(messages[0]["content"]))
            return json.dumps({"reply": "Что уточним?"})

    with patch.object(settings, "AGENT_LLM_HISTORY_MESSAGES", 40), patch(
        "agent.dialogue.agentic.get_llm", return_value=FakeLLM()
    ):
        AgenticBA().decide_strict(state, "Продолжим")
    assert "value" not in captured["requirement"]
    assert captured["requirement"]["role"] == "инвестор"
    assert not any("Не знаю" in item["content"] for item in captured["history"])
    return {
        "payload_keys": list(captured),
        "requirement": captured["requirement"],
        "history_length": len(captured["history"]),
        "history_has_unknown": any("Не знаю" in item["content"] for item in captured["history"]),
        "persisted_unknown_status": state.get_slot("value").status,
        "persisted_role_metadata": vars(state.get_slot("role")),
        "omitted_context": {"sources": state.sources, "last_agent_decision": state.last_agent_decision},
    }


def false_semantic_rejections():
    cases = []
    for key, value in (
        ("role", "Согласующий менеджер"),
        ("role", "Комиссия использует платформу для согласования сделок"),
        ("process", "Внедрение нового инвестиционного продукта"),
        ("scenarios", "Менеджер проверяет, что внедрённое ограничение блокирует сделку"),
    ):
        state = DialogueState()
        decision = TurnDecision(facts=[Fact(key, value, 1.0, evidence=value)])
        AgenticBA.guard_facts(state, value, decision)
        assert decision.facts == []
        cases.append({"field": key, "value": value, "accepted": False, "issues": decision.contradictions})
    return cases


def unknown_statuses_and_questions():
    statuses = {text: value_status(text) for text in (
        "Пока не знаю", "не уверен", "Не знаю, уточню у коллег", "Не знаю", "Не применимо",
    )}
    replies = []
    for reply, focus in (
        ("Как оператор должен понимать, какие сделки исключены из отчёта?", "acceptance_criteria"),
        ("Как система покажет, какой лимит был превышен?", "to_be"),
    ):
        replies.append({"before": reply, "after": AgenticOrchestrator._one_question(reply, focus)})
    return {"value_statuses": statuses, "single_question_false_positives": replies}


def main():
    cases = {
        "silent_addition_loss": silent_addition_loss,
        "evidence_and_readiness": evidence_and_readiness,
        "malformed_schema": malformed_schema,
        "assumption_promotion": assumption_promotion,
        "context_loss": context_loss,
        "false_semantic_rejections": false_semantic_rejections,
        "unknown_statuses_and_questions": unknown_statuses_and_questions,
    }
    with patch.object(settings, "LLM_PROVIDER", "mock"), patch(
        "agent.agentic_orchestrator.log_event"
    ), patch("agent.agentic_orchestrator.log_refusal"):
        results = {name: function() for name, function in cases.items()}
    output = {
        "audit_date": "2026-09-08",
        "scope": "Current working tree; pure in-memory deterministic reproductions; no network or database",
        "case_count": len(results),
        "cases": results,
    }
    path = Path(__file__).with_name("dialogue_results.json")
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"completed_cases": len(results), "output": str(path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
