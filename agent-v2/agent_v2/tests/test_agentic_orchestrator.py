import pytest
from pathlib import Path

from agent_v2.agentic_orchestrator import AgenticOrchestrator
from agent_v2.dialogue.agentic import Fact, LLMUnavailable, TurnDecision
from agent_v2.session import SessionStore
from agent_v2.composer.composer import build_draft


@pytest.fixture()
def orch(tmp_path):
    return AgenticOrchestrator(SessionStore(str(tmp_path / "agentic.db")))


def test_model_decision_owns_next_question_without_phase_machine(orch, monkeypatch):
    decision = TurnDecision(
        facts=[
            Fact("need_statement", "Добавить в карточку сделки клиента и ИНН", 0.95),
            Fact("to_be", "В карточке отображаются клиент и ИНН", 0.9),
        ],
        next_action="ask", focus="data_integrations",
        reply="Откуда должны поступать наименование клиента и ИНН?", source="llm",
    )
    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: decision)
    sid = orch.new_session(1).session_id
    response = orch.handle_message(sid, "Добавить в карточку сделки клиента и ИНН. В карточке отображаются клиент и ИНН")

    assert response.message == "Откуда должны поступать наименование клиента и ИНН?"
    assert response.expected_slot == "data_integrations"
    assert response.phase == "agentic_dialogue"


def test_answer_with_question_word_is_processed_by_model_not_kb_router(orch, monkeypatch):
    decisions = iter([
        TurnDecision(facts=[Fact("need_statement", "Перекрасить кнопки", 0.95)],
                     next_action="ask", focus="business_rules",
                     reply="В какой цвет нужно перекрасить кнопки?", source="llm"),
        TurnDecision(facts=[Fact("business_rules", "кнопки зелёного цвета", 0.9, evidence="Когда кнопки станут зелёного цвета")],
                     next_action="ask", focus="acceptance_criteria",
                     reply="Есть ли кнопки, которые должны сохранить текущий цвет?", source="llm"),
    ])
    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: next(decisions))
    sid = orch.new_session(2).session_id
    orch.handle_message(sid, "Нужно перекрасить кнопки")
    response = orch.handle_message(sid, "Когда кнопки станут зелёного цвета")

    assert "базе знаний" not in response.message.lower()
    assert orch.store.get(sid).get("business_rules") == "кнопки зелёного цвета"


def test_conversational_feedback_is_delegated_to_model(orch, monkeypatch):
    decision = TurnDecision(next_action="ask", focus="business_rules",
                            reply="Вы правы, цвет я ещё не уточнил. В какой цвет нужно перекрасить кнопки?",
                            source="llm")
    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: decision)
    sid = orch.new_session(3).session_id
    response = orch.handle_message(sid, "Даже не спросишь, в какой цвет?")

    assert response.message.startswith("Вы правы")
    assert response.action == "question"


def test_user_turn_is_persisted_before_model_failure(orch, monkeypatch):
    def fail(_state, _text):
        raise LLMUnavailable("network blocked")

    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", fail)
    sid = orch.new_session(31).session_id

    response = orch.handle_message(
        sid, "Нужен контроль расчётов", message_id="turn-before-failure"
    )

    assert response.action == "unavailable"
    assert orch.store.get(sid).history[-2] == {
        "role": "user",
        "content": "Нужен контроль расчётов",
        "message_id": "turn-before-failure",
    }


def test_invalid_model_json_fails_closed_without_recovering_facts(orch, monkeypatch):
    def invalid_json(_state, _text):
        try:
            raise ValueError("LLM response has no JSON object")
        except ValueError as cause:
            raise LLMUnavailable(str(cause)) from cause

    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", invalid_json)
    sid = orch.new_session(32).session_id

    response = orch.handle_message(sid, "Нужен контроль расчётов", message_id="invalid-json-turn")

    assert response.action == "unavailable"
    assert orch.store.get(sid).get("need_statement") is None
    assert [item["role"] for item in orch.store.get(sid).history[-2:]] == ["user", "assistant"]


def test_invalid_json_does_not_promote_misfiled_intent(orch, monkeypatch):
    def invalid_json(_state, _text):
        try:
            raise ValueError("LLM response has no JSON object")
        except ValueError as cause:
            raise LLMUnavailable(str(cause)) from cause

    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", invalid_json)
    state = orch.store.new_session(33)
    state.set("intent", "Изменить дизайн всей системы в корпоративных зелёных тонах")
    orch.store.save(state)

    response = orch.handle_message(state.session_id, "Я уже сформулировал потребность выше")
    restored = orch.store.get(state.session_id)

    assert restored.get("need_statement") is None
    assert response.action == "unavailable"
    assert "какую проблему или изменение" not in response.message.lower()


def test_repeated_unavailable_message_is_not_duplicated_in_history(orch, monkeypatch):
    monkeypatch.setattr(
        "agent_v2.agentic_orchestrator.agentic_ba.decide_strict",
        lambda _state, _text: (_ for _ in ()).throw(LLMUnavailable("network blocked")),
    )
    sid = orch.new_session(34).session_id

    first = orch.handle_message(sid, "Нужно изменить дизайн", message_id="failure-1")
    second = orch.handle_message(sid, "Повторить", message_id="failure-2")
    history = orch.store.get(sid).history

    assert first.message == second.message
    assert sum(1 for item in history if item.get("content") == first.message) == 1


def test_primary_runtime_has_no_legacy_dialogue_dependencies():
    source = Path(__file__).parents[1].joinpath("agentic_orchestrator.py").read_text(encoding="utf-8")
    for forbidden in ("compute_phase", "next_slot", "question_bank", "assess_answer", "qa_handler"):
        assert forbidden not in source


def test_runtime_factory_always_returns_agentic_orchestrator(tmp_path, monkeypatch):
    import agent_v2.orchestrator as runtime

    monkeypatch.setattr(runtime, "_orchestrator_singleton", None)
    instance = runtime.get_orchestrator(SessionStore(str(tmp_path / "factory.db")))

    assert isinstance(instance, AgenticOrchestrator)


def test_sent_session_is_not_exposed_as_draft_ready(orch):
    state = orch.store.new_session(12)
    state.confirmed = True
    state.draft = {"id": "REQ-12", "title": "Отправленный запрос"}
    state.review_status = "needs_review"
    state.review_task_id = 12
    orch.store.save(state)

    restored = orch._build_response(state, "session", "")
    continued = orch.handle_message(state.session_id, "Какой статус у запроса?")

    assert restored.phase == "sent_for_review"
    assert restored.request_id == 12
    assert continued.phase == "sent_for_review"
    assert continued.action == "sent_locked"
    assert continued.request_id == 12


def test_send_for_review_is_blocked_by_independent_critical_review(orch):
    state = orch.store.new_session(13)
    for key, value in {
        "intent": "change", "need_statement": "Изменить расчёт",
        "role": "операционист", "process": "расчёт сделки",
        "as_is": "Одинаковый процесс", "to_be": "Одинаковый процесс",
        "acceptance_criteria": "Результат формируется не позднее 10 секунд",
    }.items():
        state.set(key, value)
    state.confirmed = True
    state.draft = build_draft(state, None).model_dump()
    orch.store.save(state)

    response = orch.confirm_and_send(state.session_id, 13, "Изменить расчёт", user_id=13)

    assert response.action == "validation_error"
    assert orch.store.get(state.session_id).review_status == ""


def test_primary_runtime_fails_closed_when_llm_is_unavailable(orch, monkeypatch):
    from agent_v2.dialogue.agentic import LLMUnavailable
    monkeypatch.setattr(
        "agent_v2.agentic_orchestrator.agentic_ba.decide_strict",
        lambda state, text: (_ for _ in ()).throw(LLMUnavailable("network blocked")),
    )
    sid = orch.new_session(4).session_id
    response = orch.handle_message(sid, "Нужно добавить поле ИНН")

    assert response.action == "unavailable"
    assert "модель сейчас недоступна" in response.message.lower()
    assert orch.store.get(sid).get("need_statement") is None
    assert any(
        item["role"] == "user" and item["content"] == "Нужно добавить поле ИНН"
        for item in orch.store.get(sid).history
    )
    assert orch.store.get(sid).total_user_messages == 1


def test_explicit_out_of_domain_is_confined_before_llm(orch, monkeypatch):
    monkeypatch.setattr(
        "agent_v2.agentic_orchestrator.agentic_ba.decide_strict",
        lambda state, text: pytest.fail("out-of-domain text reached the LLM"),
    )
    sid = orch.new_session(40).session_id

    first = orch.handle_message(sid, "Какая погода в Москве?")
    second = orch.handle_message(sid, "Расскажи анекдот")
    third = orch.handle_message(sid, "Спой песню")

    assert first.action == "out_of_domain"
    assert second.action == "out_of_domain"
    assert third.action == "escalated"
    assert orch.store.get(sid).ood_strikes == 3


@pytest.mark.parametrize("message", [
    "Позовите аналитика",
    "Слишком сложно, не могу продолжить",
    "Хочу говорить с человеком",
])
def test_human_request_escalates_before_llm(orch, monkeypatch, message):
    monkeypatch.setattr(
        "agent_v2.agentic_orchestrator.agentic_ba.decide_strict",
        lambda state, text: pytest.fail("human request reached the LLM"),
    )
    sid = orch.new_session(41).session_id

    response = orch.handle_message(sid, message)

    assert response.action == "escalated"
    assert orch.store.get(sid).escalation is True


def test_model_summary_first_requests_acceptance_then_product(orch, monkeypatch):
    decisions = iter([
        TurnDecision(
            facts=[
                Fact("need_statement", "Автоматизировать реестр облигаций по сделкам", 0.95),
                Fact("to_be", "Система выгружает реестр в Excel", 0.95),
                Fact("role", "бэк-офицер", 0.95),
                Fact("process", "расчёты по сделкам", 0.95),
                Fact("value", "Сокращение времени подготовки реестра с 20 до 2 минут", 0.95),
            ],
            next_action="summarize", source="llm",
        ),
        TurnDecision(
            facts=[Fact("acceptance_criteria", "Файл формируется не позднее 60 секунд", 0.95)],
            next_action="summarize", source="llm",
        ),
        TurnDecision(
            facts=[Fact("product", "Облигации и еврооблигации", 0.95)],
            next_action="summarize", source="llm",
        ),
    ])
    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: next(decisions))
    sid = orch.new_session(42).session_id

    acceptance = orch.handle_message(sid, "Автоматизировать реестр облигаций по сделкам. Система выгружает реестр в Excel. Пользователь: бэк-офицер; процесс: расчёты по сделкам. Сокращение времени подготовки реестра с 20 до 2 минут")
    product = orch.handle_message(sid, "Файл формируется не позднее 60 секунд")
    summary = orch.handle_message(sid, "Облигации и еврооблигации")

    assert acceptance.action == "question"
    assert acceptance.expected_slot == "acceptance_criteria"
    assert product.action == "question"
    assert product.expected_slot == "product"
    assert summary.action == "summarize"


def test_ready_for_draft_checks_business_gaps_before_summary(orch, monkeypatch):
    decision = TurnDecision(
        facts=[
            Fact("need_statement", "Повторить отправку инструкции из карточки", 0.95),
            Fact("to_be", "Бэк-офицер повторно отправляет инструкцию", 0.95),
            Fact("role", "бэк-офицер", 0.95),
            Fact("process", "отправка расчётной инструкции", 0.95),
        ],
        next_action="ask", focus="data_integrations",
        reply="Какая очередь должна использоваться?",
        ready_for_draft=True, source="llm",
    )
    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: decision)
    sid = orch.new_session(5).session_id

    response = orch.handle_message(sid, "Повторить отправку инструкции из карточки. Бэк-офицер повторно отправляет инструкцию. Пользователь: бэк-офицер; процесс: отправка расчётной инструкции")

    assert response.action == "question"
    assert response.expected_slot == "acceptance_criteria"
    assert "Какая очередь" not in response.message
    assert not orch.store.get(sid).summary_text


def test_progress_question_is_answered_and_finishes_collection(orch, monkeypatch):
    decisions = iter([
        TurnDecision(
            facts=[
                Fact("need_statement", "Повторить отправку инструкции", 0.95),
                Fact("to_be", "Повтор доступен в карточке", 0.95),
                Fact("role", "бэк-офицер", 0.95),
                Fact("process", "отправка расчётной инструкции", 0.95),
            ],
            next_action="ask", focus="business_rules",
            reply="Какие ошибки допускают повтор?", source="llm",
        ),
        TurnDecision(
            facts=[Fact("business_rules", "Повтор разрешён для временных ошибок", 0.95)],
            next_action="ask", focus="data_integrations",
            reply="Какой callback используется?", source="llm",
        ),
    ])
    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: next(decisions))
    sid = orch.new_session(6).session_id
    orch.handle_message(sid, "Повторить отправку инструкции. Повтор доступен в карточке. Пользователь: бэк-офицер; процесс: отправка расчётной инструкции")

    response = orch.handle_message(sid, "Повтор разрешён для временных ошибок. Много ещё вопросов?")

    assert response.action == "summarize"
    assert response.message.startswith("Основное уже собрано")
    assert "callback" not in response.message


def test_summary_preserves_long_acceptance_criteria(orch):
    state = orch.store.new_session(7)
    long_value = "Критерий " + ("с наблюдаемым результатом " * 20) + "завершён."
    state.set("need_statement", "Потребность")
    state.set("to_be", "Целевое состояние")
    state.set("role", "бэк-офицер")
    state.set("process", "расчёты")
    state.set("acceptance_criteria", long_value)

    orch._prepare_summary(state, None)

    assert long_value in state.summary_text
    assert "завершён." in state.summary_text


def test_solution_design_question_is_deferred_for_business_user(orch, monkeypatch):
    decision = TurnDecision(
        facts=[
            Fact("need_statement", "Повторить отправку инструкции", 0.95),
            Fact("to_be", "Повтор доступен в карточке", 0.95),
            Fact("role", "бэк-офицер", 0.95),
            Fact("process", "отправка расчётной инструкции", 0.95),
        ],
        next_action="ask", focus="data_integrations",
        reply="Это должен быть синхронный запрос или асинхронная отправка через очередь?",
        source="llm",
    )
    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: decision)
    sid = orch.new_session(8).session_id

    response = orch.handle_message(sid, "Повторить отправку инструкции. Повтор доступен в карточке. Пользователь: бэк-офицер; процесс: отправка расчётной инструкции")

    assert response.action == "question"
    assert response.expected_slot == "acceptance_criteria"
    assert "синхронный запрос или" not in response.message
    assert "системному аналитику или архитектору" in orch.store.get(sid).get("open_questions")


def test_solution_design_question_is_allowed_for_explicit_technical_request(orch, monkeypatch):
    decision = TurnDecision(
        facts=[Fact("need_statement", "Проработать повторную отправку", 0.95)],
        next_action="ask", focus="data_integrations",
        reply="Это должен быть синхронный запрос или асинхронная отправка через очередь?",
        source="llm",
    )
    monkeypatch.setattr("agent_v2.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: decision)
    sid = orch.new_session(9).session_id

    response = orch.handle_message(sid, "Нужно проработать технические требования: Проработать повторную отправку")

    assert response.action == "question"
    assert "синхронный запрос" in response.message


def test_compound_model_question_is_reduced_to_one_question(orch, monkeypatch):
    decision = TurnDecision(
        facts=[Fact("need_statement", "Обновить дизайн платформы", 0.9)],
        next_action="ask", focus="role",
        reply=("Кто будет пользоваться обновлённой платформой? "
               "И кто будет принимать результат?"),
        source="llm",
    )
    monkeypatch.setattr(
        "agent_v2.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: decision
    )
    sid = orch.new_session(50).session_id

    response = orch.handle_message(sid, "Обновить дизайн платформы")

    assert response.message == "Кто будет пользоваться обновлённой платформой?"
    assert response.message.count("?") == 1


def test_brandbook_dialogue_does_not_misfile_acceptors_and_rollout(orch, monkeypatch):
    decision = TurnDecision(
        facts=[
            Fact("intent", "change", 0.95),
            Fact("need_statement", "Привести платформу к новому стилю Банка", 0.95),
            Fact("to_be", "Все экраны соответствуют синей гамме брендбука", 0.95),
            Fact("role", "Совместная рабочая группа", 1.0),
            Fact("process", "Одномоментный переход всей платформы", 1.0),
            Fact("scenarios", "Обновление всех экранов за один релиз", 0.9),
            Fact("dependencies", "Утверждённый брендбук", 0.95),
            Fact("acceptance_criteria", "Соответствие брендбуку", 0.95),
            Fact("value", "Требование руководства Банка", 1.0),
        ],
        next_action="summarize", source="llm",
    )
    monkeypatch.setattr(
        "agent_v2.agentic_orchestrator.agentic_ba.decide_strict", lambda state, text: decision
    )
    sid = orch.new_session(51).session_id

    response = orch.handle_message(
        sid,
        "Привести платформу к новому стилю Банка. Все экраны соответствуют синей гамме брендбука. "
        "Утверждённый брендбук. Принимать будет совместная рабочая группа; переход одномоментный. Соответствие брендбуку",
    )
    state = orch.store.get(sid)

    assert state.get("role") is None
    assert state.get("process") is None
    assert state.get("scenarios") is None
    assert state.get("value") is None
    assert response.action == "question"
    assert response.action in {"question", "clarify"}


def test_model_knowledge_decision_executes_retrieval(orch, monkeypatch):
    decision = TurnDecision(
        next_action="answer",
        reply="",
        use_knowledge_base=True,
        knowledge_query="как работает приоритизация",
        source="llm",
    )
    calls = []
    monkeypatch.setattr(
        "agent_v2.agentic_orchestrator.agentic_ba.decide_strict",
        lambda state, text: decision,
    )
    monkeypatch.setattr(
        "agent_v2.agentic_orchestrator.retrieval.answer_from_kb",
        lambda query, k=4: calls.append((query, k)) or [{"text": "Приоритет рассчитывается по восьми факторам."}],
    )
    sid = orch.new_session(52).session_id

    response = orch.handle_message(sid, "Как работает приоритизация?")

    assert calls == [("как работает приоритизация", 4)]
    assert response.action == "clarify"
    assert "восьми факторам" in response.message
    assert orch.store.get(sid).sources[0]["text"].startswith("Приоритет")
