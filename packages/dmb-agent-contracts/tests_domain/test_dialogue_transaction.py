"""Only agent-owned SQLite dialogue fixtures; no application identities are created."""
import importlib
import os

import pytest


@pytest.fixture
def store(tmp_path):
    module = importlib.import_module(os.environ["DIALOGUE_TEST_MODULE"]+".session")
    value = module.SessionStore(path=str(tmp_path/"dialogue.sqlite"))
    yield value
    value.engine.dispose()


def test_cancelled_publication_rolls_back_dialogue_and_receipt(store):
    state = store.new_session(user_id=None)
    with pytest.raises(RuntimeError, match="cancelled_publication"):
        with store.engine.begin() as connection, store.transaction(connection):
            with store.serialized(state.session_id):
                changed = store.get(state.session_id)
                changed.phase = "cancelled-late-output"
                store.save(changed)
                store.cache_response(state.session_id, "synthetic-message", {"text": "late"})
                assert store.get_cached_response(state.session_id, "synthetic-message") == {"text": "late"}
            raise RuntimeError("cancelled_publication")
    assert store.get(state.session_id).phase == "welcome"
    assert store.get_cached_response(state.session_id, "synthetic-message") is None


def test_successful_publication_commits_dialogue_and_receipt(store):
    state = store.new_session(user_id=None)
    with store.engine.begin() as connection, store.transaction(connection):
        changed = store.get(state.session_id)
        changed.phase = "clarifying"
        store.save(changed)
        store.cache_response(state.session_id, "synthetic-message", {"text": "published"})
    assert store.get(state.session_id).phase == "clarifying"
    assert store.get_cached_response(state.session_id, "synthetic-message") == {"text": "published"}
