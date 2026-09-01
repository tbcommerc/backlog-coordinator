from agent.dialogue.gaps import synchronize_gaps
from agent.dialogue.quality import assess_quality
from agent.dialogue.state import DialogueState
from agent.session import state_from_dict, state_to_dict


def test_gap_registry_survives_session_round_trip():
    state = DialogueState(session_id="gap-session", user_id=7)
    state.set("intent", "change")
    state.set("need_statement", "Изменить расчёт")
    state.skip("data_integrations")
    synchronize_gaps(state, assess_quality(state))

    restored = state_from_dict(state_to_dict(state))

    assert restored.gaps
    assert any(gap.category == "technical" for gap in restored.gaps)
    assert any(gap.status == "deferred" for gap in restored.gaps)
