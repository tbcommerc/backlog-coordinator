import json

from agent.dialogue.agentic import AgenticBA
from agent.dialogue.state import DialogueState


class FakeLLM:
    name = "fake"

    def available(self):
        return True

    def chat(self, messages, system_prompt=None, temperature=0.2, max_tokens=1000):
        return json.dumps({
            "facts": [
                {"field": "role", "value": "бэк-офицер", "confidence": 0.96},
                {"field": "process", "value": "заключение сделки", "confidence": 0.9},
                {"field": "unknown", "value": "must be ignored", "confidence": 1},
            ],
            "next_action": "ask",
            "focus": "data_integrations",
            "reply": "Откуда должен поступать ИНН клиента?",
            "assumptions": [],
            "contradictions": [],
        }, ensure_ascii=False)


def test_agentic_decision_extracts_multiple_facts_and_question(monkeypatch):
    state = DialogueState(session_id="s", user_id=1)
    monkeypatch.setattr("agent.dialogue.agentic.get_llm", lambda: FakeLLM())
    monkeypatch.setattr("agent.dialogue.agentic.settings.AGENT_DIALOGUE_ENGINE", "agentic")

    decision = AgenticBA().decide(state, "ИНН нужен бэк-офицеру в карточке сделки")
    updated = AgenticBA.apply(state, decision)

    assert updated == ["role", "process"]
    assert state.get("role") == "бэк-офицер"
    assert decision.focus == "data_integrations"
    assert decision.reply == "Откуда должен поступать ИНН клиента?"


def test_unmarked_conflict_is_not_silently_overwritten():
    state = DialogueState(session_id="s", user_id=1)
    state.set("process", "расчёты по сделкам")
    decision = type("Decision", (), {})()
    from agent.dialogue.agentic import Fact, TurnDecision
    decision = TurnDecision(facts=[Fact("process", "заключение сделки")])

    AgenticBA.apply(state, decision)

    assert state.get("process") == "расчёты по сделкам"
    assert decision.contradictions


def test_explicit_correction_keeps_audit_history():
    from agent.dialogue.agentic import Fact, TurnDecision
    state = DialogueState(session_id="s", user_id=1)
    state.set("process", "расчёты по сделкам")
    decision = TurnDecision(facts=[Fact("process", "расчёт маржи", correction=True)])

    AgenticBA.apply(state, decision)

    assert state.get("process") == "расчёт маржи"
    assert state.get_slot_history("process")[0]["old_value"] == "расчёты по сделкам"
