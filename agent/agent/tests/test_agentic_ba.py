import json

from agent.config import settings
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
    decision = AgenticBA().decide_strict(state, "ИНН нужен бэк-офицеру в карточке сделки")
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


def test_invalid_json_is_retried_once(monkeypatch):
    class FlakyJSONLLM(FakeLLM):
        def __init__(self):
            self.calls = []

        def chat_json(self, messages, system_prompt=None, temperature=0.2, max_tokens=1000):
            self.calls.append((temperature, max_tokens))
            if len(self.calls) == 1:
                return '{"facts": [}'
            return json.dumps({
                "facts": [{"field": "need_statement", "value": "Добавить сортировку"}],
                "next_action": "ask",
                "focus": "to_be",
                "reply": "Как должна работать сортировка?",
            }, ensure_ascii=False)

    llm = FlakyJSONLLM()
    monkeypatch.setattr("agent.dialogue.agentic.get_llm", lambda: llm)

    decision = AgenticBA().decide_strict(
        DialogueState(session_id="retry", user_id=1), "Добавить сортировку"
    )

    assert decision.reply == "Как должна работать сортировка?"
    assert llm.calls == [
        (0.2, settings.AGENT_DECISION_MAX_TOKENS),
        (0.0, settings.AGENT_DECISION_MAX_TOKENS),
    ]


def test_prompt_keeps_business_interview_out_of_solution_design(monkeypatch):
    captured = {}

    class CapturingLLM(FakeLLM):
        def chat(self, messages, system_prompt=None, temperature=0.2, max_tokens=1000):
            captured["prompt"] = system_prompt
            captured["payload"] = json.loads(messages[0]["content"])
            return super().chat(messages, system_prompt, temperature, max_tokens)

    monkeypatch.setattr("agent.dialogue.agentic.get_llm", lambda: CapturingLLM())
    state = DialogueState(session_id="business-depth", user_id=1)
    AgenticBA().decide_strict(state, "Нужно повторить отправку инструкции")

    assert "Не предлагай пользователю выбирать" in captured["prompt"]
    assert "техническую реализацию" in captured["prompt"]
    assert "очередь" in captured["prompt"]
    assert captured["payload"]["can_generate_draft"] is False


def test_semantic_guard_rejects_acceptance_group_as_user_role():
    from agent.dialogue.agentic import Fact, TurnDecision

    state = DialogueState(session_id="semantic-role", user_id=1)
    decision = TurnDecision(facts=[
        Fact("role", "Совместная рабочая группа", 1.0,
             evidence="Будет совместная рабочая группа"),
    ])

    AgenticBA.guard_facts(state, "Будет совместная рабочая группа", decision)
    AgenticBA.apply(state, decision)

    assert state.get("role") is None
    assert any("не является пользовательской ролью" in item for item in decision.contradictions)


def test_semantic_guard_rejects_rollout_as_process_and_scenario():
    from agent.dialogue.agentic import Fact, TurnDecision

    state = DialogueState(session_id="semantic-rollout", user_id=1)
    decision = TurnDecision(facts=[
        Fact("process", "Одномоментный переход всей платформы", 1.0),
        Fact("scenarios", "Обновление всех экранов за один релиз", 0.9),
    ])

    AgenticBA.guard_facts(state, "Одномоментно для всей платформы", decision)
    AgenticBA.apply(state, decision)

    assert state.get("process") is None
    assert state.get("scenarios") is None


def test_unsupported_evidence_becomes_low_confidence_assumption():
    from agent.dialogue.agentic import Fact, TurnDecision

    state = DialogueState(session_id="evidence", user_id=1)
    decision = TurnDecision(facts=[
        Fact("dependencies", "Утверждённый брендбук", 1.0,
             evidence="ссылка утверждена комитетом"),
    ])

    AgenticBA.guard_facts(state, "Есть брендбук, вот ссылка", decision)

    assert decision.facts[0].assumption is True
    assert decision.facts[0].confidence == 0.6


def test_descriptive_intent_is_reclassified_as_need_statement():
    from agent.dialogue.agentic import Fact, TurnDecision

    state = DialogueState(session_id="misfiled-intent", user_id=1)
    decision = TurnDecision(facts=[
        Fact(
            "intent",
            "Изменить дизайн системы в корпоративных зелёных тонах",
            1.0,
            evidence="изменить дизайн системы",
        ),
    ])

    AgenticBA.guard_facts(
        state, "Хочу изменить дизайн системы в корпоративных зелёных тонах", decision
    )
    AgenticBA.apply(state, decision)

    assert state.get("intent") is None
    assert state.get("need_statement") == "Изменить дизайн системы в корпоративных зелёных тонах"
