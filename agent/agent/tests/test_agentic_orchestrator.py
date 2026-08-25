import pytest
from pathlib import Path

from agent.agentic_orchestrator import AgenticOrchestrator
from agent.dialogue.agentic import Fact, TurnDecision
from agent.session import SessionStore


@pytest.fixture()
def orch(tmp_path):
    return AgenticOrchestrator(SessionStore(str(tmp_path / "agentic.db")))


def test_model_decision_owns_next_question_without_phase_machine(orch, monkeypatch):
    decision = TurnDecision(
        facts=[
            Fact("intent", "change", 0.95),
            Fact("need_statement", "Добавить в карточку сделки клиента и ИНН", 0.95),
            Fact("to_be", "В карточке отображаются клиент и ИНН", 0.9),
        ],
        next_action="ask", focus="data_integrations",
        reply="Откуда должны поступать наименование клиента и ИНН?", source="llm",
    )
    monkeypatch.setattr("agent.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: decision)
    sid = orch.new_session(1).session_id
    response = orch.handle_message(sid, "Нужно добавить в карточку сделки клиента и ИНН")

    assert response.message == "Откуда должны поступать наименование клиента и ИНН?"
    assert response.expected_slot == "data_integrations"
    assert response.phase == "agentic_dialogue"


def test_answer_with_question_word_is_processed_by_model_not_kb_router(orch, monkeypatch):
    decisions = iter([
        TurnDecision(facts=[Fact("need_statement", "Перекрасить кнопки", 0.95)],
                     next_action="ask", focus="business_rules",
                     reply="В какой цвет нужно перекрасить кнопки?", source="llm"),
        TurnDecision(facts=[Fact("business_rules", "кнопки зелёного цвета", 0.9)],
                     next_action="ask", focus="acceptance_criteria",
                     reply="Есть ли кнопки, которые должны сохранить текущий цвет?", source="llm"),
    ])
    monkeypatch.setattr("agent.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: next(decisions))
    sid = orch.new_session(2).session_id
    orch.handle_message(sid, "Нужно перекрасить кнопки")
    response = orch.handle_message(sid, "Когда кнопки станут зелёного цвета")

    assert "базе знаний" not in response.message.lower()
    assert orch.store.get(sid).get("business_rules") == "кнопки зелёного цвета"


def test_conversational_feedback_is_delegated_to_model(orch, monkeypatch):
    decision = TurnDecision(next_action="ask", focus="business_rules",
                            reply="Вы правы, цвет я ещё не уточнил. В какой цвет нужно перекрасить кнопки?",
                            source="llm")
    monkeypatch.setattr("agent.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: decision)
    sid = orch.new_session(3).session_id
    response = orch.handle_message(sid, "Даже не спросишь, в какой цвет?")

    assert response.message.startswith("Вы правы")
    assert response.action == "question"


def test_primary_runtime_has_no_legacy_dialogue_dependencies():
    source = Path(__file__).parents[1].joinpath("agentic_orchestrator.py").read_text(encoding="utf-8")
    for forbidden in ("compute_phase", "next_slot", "question_bank", "assess_answer", "qa_handler"):
        assert forbidden not in source


def test_primary_runtime_fails_closed_when_llm_is_unavailable(orch, monkeypatch):
    from agent.dialogue.agentic import LLMUnavailable
    monkeypatch.setattr(
        "agent.agentic_orchestrator.agentic_ba.decide_strict",
        lambda state, text: (_ for _ in ()).throw(LLMUnavailable("network blocked")),
    )
    sid = orch.new_session(4).session_id
    response = orch.handle_message(sid, "Нужно добавить поле ИНН")

    assert response.action == "unavailable"
    assert "модель сейчас недоступна" in response.message.lower()
    assert orch.store.get(sid).get("need_statement") is None
