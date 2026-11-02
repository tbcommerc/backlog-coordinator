from business_analyst_experimental.dialogue.quality import (
    acceptance_is_measurable,
    assess_quality,
    required_slots_for_phase,
)
from business_analyst_experimental.dialogue.state import DialogueState
from business_analyst_experimental.dialogue import semantic_analyzer
from business_analyst_experimental.session import state_from_dict, state_to_dict


def _state(intent="change", **values):
    state = DialogueState()
    state.set("intent", intent)
    for key, value in values.items():
        state.set(key, value)
    return state


def test_quality_profiles_have_different_required_blocks():
    feature = _state("feature")
    change = _state("change")
    assert "scenarios" in required_slots_for_phase(feature, "roles_scenarios")
    assert "scenarios" not in required_slots_for_phase(change, "roles_scenarios")
    assert "as_is" in required_slots_for_phase(change, "as_is_to_be")


def test_acceptance_quality_distinguishes_vague_from_observable():
    assert not acceptance_is_measurable("Система работает быстро и удобно")
    assert acceptance_is_measurable("Отчёт формируется не позднее 60 секунд")


def test_quality_detects_equal_as_is_and_to_be():
    state = _state(
        "change",
        need_statement="Нужно изменить сверку",
        role="Бэк-офицер",
        process="Расчёты",
        as_is="Оператор вручную сверяет расчёты",
        to_be="Оператор вручную сверяет расчёты",
        acceptance_criteria="Отчёт формируется в течение 60 секунд",
    )
    assessment = assess_quality(state)
    assert assessment.conflicts
    assert assessment.conflicts[0].code == "as_is_equals_to_be"
    assert assessment.level != "high"


def test_quality_penalizes_non_measurable_acceptance():
    state = _state(
        "change",
        need_statement="Нужно изменить сверку",
        role="Бэк-офицер",
        process="Расчёты",
        as_is="Ручная сверка",
        to_be="Автоматическая сверка",
        acceptance_criteria="Всё работает удобно",
    )
    assessment = assess_quality(state)
    assert any(i.code == "acceptance_not_measurable" for i in assessment.issues)


class _FakeProvider:
    name = "openai_compat"

    def available(self):
        return True

    def chat(self, *args, **kwargs):
        return '''```json
        {"slots": {
          "to_be": {"value": "Автоматическая сверка", "confidence": 0.99},
          "unknown": {"value": "нельзя принимать", "confidence": 1.0}
        }}
        ```'''


def test_semantic_analyzer_accepts_only_allowlisted_slots(monkeypatch):
    monkeypatch.setattr(semantic_analyzer, "get_llm", lambda: _FakeProvider())
    result = semantic_analyzer.analyze(
        "Пользователь подробно описывает, что ему нужна автоматическая сверка расчётов каждый рабочий день"
    )
    assert result["to_be"] == ("Автоматическая сверка", 0.88)
    assert "unknown" not in result


def test_quality_clarification_state_survives_session_serialization():
    state = DialogueState(session_id="quality-session")
    state.pending_quality_slot = "acceptance_criteria"
    state.quality_asked_codes = ["acceptance_not_measurable"]
    state.quality_assessment = {"score": 42, "level": "low"}

    restored = state_from_dict(state_to_dict(state))
    assert restored.pending_quality_slot == "acceptance_criteria"
    assert restored.quality_asked_codes == ["acceptance_not_measurable"]
    assert restored.quality_assessment["score"] == 42
