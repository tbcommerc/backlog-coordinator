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
                {"field": "process", "value": "заключение сделки", "confidence": 0.9,
                 "evidence": "при заключении сделки"},
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
    decision = AgenticBA().decide_strict(state, "ИНН нужен бэк-офицеру в карточке сделки при заключении сделки")
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
    AgenticBA.guard_facts(state, "Процесс — заключение сделки", decision)

    AgenticBA.apply(state, decision)

    assert state.get("process") == "расчёты по сделкам"
    assert decision.contradictions


def test_explicit_correction_keeps_audit_history():
    from agent.dialogue.agentic import Fact, TurnDecision
    state = DialogueState(session_id="s", user_id=1)
    state.set("process", "расчёты по сделкам")
    decision = TurnDecision(facts=[Fact("process", "расчёт маржи", correction=True,
                                        evidence="процесс — расчёт маржи")])
    AgenticBA.guard_facts(state, "Исправьте: процесс — расчёт маржи", decision)

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


def _apply_message(state, message, facts, **kwargs):
    from agent.dialogue.agentic import TurnDecision
    state.add_message("user", message)
    decision = TurnDecision(facts=facts, **kwargs)
    AgenticBA.guard_facts(state, message, decision)
    AgenticBA.apply(state, decision)
    return decision


def test_compound_addition_keeps_previous_rules_and_provenance():
    from agent.dialogue.agentic import Fact
    state = DialogueState()
    _apply_message(state, "Операции доступны только в рабочие дни", [
        Fact("business_rules", "Операции доступны только в рабочие дни")])
    first_id = state.get_slot("business_rules").message_id
    decision = _apply_message(state, "Добавьте лимит 10 млн рублей", [
        Fact("business_rules", "Операции доступны только в рабочие дни; лимит 10 млн рублей",
             evidence="Добавьте лимит 10 млн рублей")])
    assert state.list_values("business_rules") == ["Операции доступны только в рабочие дни", "лимит 10 млн рублей"]
    assert not state.requirement_conflicts
    assert decision.application_results[-1]["status"] == "applied"
    assert state.get_slot("business_rules").provenance[0]["message_id"] == first_id


def test_scalar_conflict_survives_later_decision_until_explicit_correction():
    from agent.dialogue.agentic import Fact
    state = DialogueState()
    state.set("role", "трейдер")
    decision = _apply_message(state, "Пользователь — риск-менеджер", [Fact("role", "риск-менеджер")])
    assert state.get("role") == "трейдер"
    assert decision.application_results[-1]["status"] == "conflict"
    _apply_message(state, "Продолжим", [])
    assert state.requirement_conflicts[0]["status"] == "open"
    _apply_message(state, "Исправьте роль: риск-менеджер", [
        Fact("role", "риск-менеджер", operation="replace", evidence="Исправьте роль: риск-менеджер")])
    assert state.get("role") == "риск-менеджер"
    assert state.requirement_conflicts[0]["status"] == "resolved"


def test_changed_numeric_rule_is_conflict_instead_of_addition():
    from agent.dialogue.agentic import Fact
    state = DialogueState()
    state.set("business_rules", "лимит 10 млн рублей")
    decision = _apply_message(state, "Добавьте лимит 20 млн рублей", [
        Fact("business_rules", "лимит 20 млн рублей", operation="add")])
    assert state.get("business_rules") == "лимит 10 млн рублей"
    assert state.requirement_conflicts[-1]["status"] == "open"
    assert decision.application_results[-1]["status"] == "conflict"


def test_unrelated_evidence_and_missing_evidence_are_assumptions():
    from agent.dialogue.agentic import Fact
    state = DialogueState()
    _apply_message(state, "Нужно поле ИНН в карточке сделки", [
        Fact("role", "Все сотрудники банка", 1.0, evidence="карточке сделки"),
        Fact("process", "расчёты", 1.0),
    ])
    assert state.get("role") is None
    assert state.get("process") is None
    assert not state.all_mandatory_hard_filled()
    assert len(state.requirement_assumptions) == 2


def test_unsupported_candidate_does_not_complete_core_or_report_applied():
    from agent.dialogue.agentic import Fact
    state = DialogueState()
    for key in ("need_statement", "process", "role"):
        state.set(key, f"known-{key}")
    decision = _apply_message(state, "Нужен экран истории", [
        Fact("to_be", "Раскрывать все данные всем сотрудникам", 1.0, evidence="экран истории")])
    assert state.get("to_be") is None
    assert not state.all_mandatory_hard_filled()
    assert decision.application_results[-1]["status"] == "rejected"
    assert state.requirement_assumptions[-1]["text"] == "Раскрывать все данные всем сотрудникам"


def test_repeating_assumption_does_not_promote_it():
    from agent.dialogue.agentic import Fact
    state = DialogueState()
    state.set("to_be", "Система автоматически пересчитывает лимит", 0.5, assumption=True)
    _apply_message(state, "Пока не уверен в автоматическом пересчёте", [
        Fact("to_be", "Система автоматически пересчитывает лимит", 1.0)])
    assert state.get_slot("to_be").assumption
    assert state.get_slot("to_be").confidence == 0.5


def test_explicit_confirm_requires_current_user_confirmation():
    from agent.dialogue.agentic import Fact
    state = DialogueState()
    state.set("role", "риск-менеджер", 0.5, assumption=True)
    _apply_message(state, "Подтверждаю роль", [
        Fact("role", "риск-менеджер", operation="confirm", evidence="Подтверждаю роль")])
    assert not state.get_slot("role").assumption
    assert state.get_slot("role").confirmed


def test_confirmation_does_not_match_data_word_or_negative_confirmation():
    from agent.dialogue.agentic import Fact
    for message in ("Данные за месяц", "Не подтверждаю роль", "Неверно"):
        state = DialogueState()
        state.set("role", "риск-менеджер", 0.5, assumption=True)
        decision = _apply_message(state, message, [
            Fact("role", "риск-менеджер", operation="confirm", evidence=message)])
        assert state.get_slot("role").assumption
        assert not state.get_slot("role").confirmed
        assert decision.application_results[-1]["status"] == "rejected"


def test_stale_quote_cannot_replace_current_role():
    from agent.dialogue.agentic import Fact
    state = DialogueState()
    state.add_message("user", "Роль — трейдер")
    state.set("role", "риск-менеджер")
    decision = _apply_message(state, "Нужна история за месяц", [
        Fact("role", "трейдер", operation="replace", evidence="Роль — трейдер")])
    assert state.get("role") == "риск-менеджер"
    assert decision.application_results[-1]["status"] == "rejected"


def test_remove_one_rule_preserves_other_rules():
    from agent.dialogue.agentic import Fact
    state = DialogueState()
    state.set("business_rules", "только рабочие дни; лимит 10 млн")
    _apply_message(state, "Уберите правило только рабочие дни", [
        Fact("business_rules", "только рабочие дни", operation="remove", evidence="Уберите правило только рабочие дни")])
    assert state.get("business_rules") == "лимит 10 млн"


def test_defer_retains_explicit_status_and_current_quote():
    from agent.dialogue.agentic import Fact
    state = DialogueState()
    _apply_message(state, "Пока не знаю, уточню у коллег", [
        Fact("value", "", operation="defer", answer_status="deferred", evidence="Пока не знаю, уточню у коллег")])
    assert state.get("value") is None
    assert state.get_slot("value").status == "skipped"
    assert state.get_slot("value").evidence == "Пока не знаю, уточню у коллег"


def test_no_to_closed_integration_question_preserves_context_and_original_quote():
    from agent.dialogue.agentic import Fact
    state = DialogueState()
    state.add_message("assistant", "Нужны интеграции с другими системами?")
    state.last_asked_slot = "data_integrations"
    decision = _apply_message(state, "Нет", [
        Fact("data_integrations", "Интеграции не нужны", evidence="Нет")])
    assert state.get("data_integrations") == "Интеграции не нужны"
    assert state.get_slot("data_integrations").evidence == "Нет"
    assert state.get_slot("data_integrations").message_id == state.history[-1]["message_id"]
    assert decision.application_results[-1]["status"] == "applied"


def test_no_does_not_ground_arbitrary_rules_or_answers_to_open_questions():
    from agent.dialogue.agentic import Fact
    for question, value in [
        ("Нужны интеграции?", "Нужна интеграция с CRM каждые 10 минут"),
        ("Какие интеграции нужны?", "Интеграции не нужны"),
        ("Разве интеграции не нужны?", "Интеграции не нужны"),
    ]:
        state = DialogueState()
        state.add_message("assistant", question)
        state.last_asked_slot = "data_integrations"
        decision = _apply_message(state, "Нет", [Fact("data_integrations", value, evidence="Нет")])
        assert state.get("data_integrations") is None
        assert decision.application_results[-1]["status"] == "rejected"


def test_guard_is_idempotent_and_reports_rejections():
    from agent.dialogue.agentic import Fact, TurnDecision
    state = DialogueState()
    decision = TurnDecision(facts=[Fact("role", "Совместная рабочая группа")])
    AgenticBA.guard_facts(state, "Совместная рабочая группа", decision)
    AgenticBA.guard_facts(state, "Совместная рабочая группа", decision)
    assert len(decision.application_results) == 1
    assert decision.application_results[0]["status"] == "rejected"
    assert len(decision.contradictions) == 1


def test_system_users_and_business_scenarios_are_not_rejected_by_keywords():
    from agent.dialogue.agentic import Fact
    for key, value in [
        ("role", "Согласующий менеджер"),
        ("role", "Комиссия использует платформу для согласования сделок"),
        ("process", "Внедрение нового инвестиционного продукта"),
        ("scenarios", "Менеджер проверяет, что внедрённое ограничение блокирует сделку"),
    ]:
        state = DialogueState()
        _apply_message(state, value, [Fact(key, value, evidence=value)])
        assert state.get(key) == value


def test_schema_rejects_null_and_string_booleans():
    import pytest
    from agent.dialogue.agentic import _validate
    for payload in [
        {"facts": [{"field": "role", "value": None}]},
        {"facts": [{"field": "role", "value": "трейдер", "correction": "false"}]},
        {"facts": [{"field": "role", "value": "трейдер", "assumption": "false"}]},
        {"ready_for_draft": "false"}, {"use_knowledge_base": "false"},
        {"facts": [{"field": "role", "value": "трейдер", "confidence": float("nan")}]},
        {"assumptions": "строка вместо массива"},
    ]:
        with pytest.raises(ValueError):
            _validate(payload)
    assert _validate({"ready_for_draft": False}).ready_for_draft is False


def test_payload_keeps_unknown_provenance_and_open_conflicts_beyond_history(monkeypatch):
    from agent.dialogue.agentic import Fact
    captured = {}

    class Capturing(FakeLLM):
        def chat(self, messages, **kwargs):
            captured.update(json.loads(messages[0]["content"]))
            return json.dumps({"reply": "Продолжим"})

    state = DialogueState()
    _apply_message(state, "Не знаю бизнес-эффект", [Fact("value", "Не знаю", evidence="Не знаю бизнес-эффект")])
    state.set("role", "трейдер", 0.5, assumption=True, evidence="возможно трейдер", message_id="old-message")
    _apply_message(state, "Пользователь — риск-менеджер", [Fact("role", "риск-менеджер")], assumptions=["Нужна проверка владельца процесса"])
    for index in range(50):
        state.add_message("assistant", str(index))
    monkeypatch.setattr(settings, "AGENT_LLM_HISTORY_MESSAGES", 40)
    monkeypatch.setattr("agent.dialogue.agentic.get_llm", lambda: Capturing())
    AgenticBA().decide_strict(state, "Продолжим")
    assert captured["requirement_state"]["value"]["status"] == "unknown"
    assert captured["requirement_state"]["role"]["assumption"] is True
    assert captured["requirement_state"]["role"]["message_id"] == "old-message"
    assert captured["requirement_conflicts"]
    assert captured["requirement_assumptions"]
