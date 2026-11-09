import importlib
import os

import pytest

from dmb_agent_contracts.run_migration import migrate
from dmb_agent_contracts.run_store import Store, fingerprint, now
from dmb_agent_contracts.run_worker import execute


@pytest.mark.parametrize("cancel", [False, True])
def test_dialogue_facade_publishes_only_with_owning_run(tmp_path, monkeypatch, cancel):
    module = importlib.import_module(os.environ["DIALOGUE_TEST_MODULE"]+".runs")
    session_module = importlib.import_module(os.environ["DIALOGUE_TEST_MODULE"]+".session")
    sessions = session_module.SessionStore(path=str(tmp_path/"dialogues.sqlite"))
    migrate(sessions.engine, backup_verified=True, allowed_existing=("sessions", "message_receipts"))
    monkeypatch.setattr(module, "session_store", sessions)
    state = sessions.new_session(user_id=123)
    technical = Store(sessions.engine)
    body = {"operation": "dialogue.message", "conversation_ref": state.session_id,
        "input": {"message": "synthetic"}, "source": {"kind": "dialogue", "ref": state.session_id,
            "revision": state._storage_version, "snapshot_hash": "sha256:"+fingerprint({"message": "synthetic"})}}
    module.validate(body)
    row, _ = technical.create("dmb", "123", "synthetic-key", body, module.profile(), 150, 8,
        trusted_context={"user_id": 123, "role_name": "synthetic-trusted-role"})

    def chat(request, _):
        assert request.context["user_id"] == 123
        assert request.context["role_name"] == "synthetic-trusted-role"
        if cancel:
            current = technical.get(row["id"])
            assert technical.transition(current, "cancelled", finished_at=now())
        changed = sessions.get(state.session_id)
        changed.phase = "synthetic-output"
        sessions.save(changed)
        sessions.cache_response(state.session_id, request.message_id, {"message": "synthetic-output"})
        return {"message": "synthetic-output"}

    monkeypatch.setattr(module, "chat", chat)
    claimed = technical.claim()
    execute(technical, claimed, module.handle, transaction_scope=sessions.transaction)
    completed = technical.get(row["id"])
    assert completed["status"] == ("cancelled" if cancel else "completed")
    assert sessions.get(state.session_id).phase == ("welcome" if cancel else "synthetic-output")
    assert bool(sessions.get_cached_response(state.session_id, row["id"])) is (not cancel)
    sessions.engine.dispose()
