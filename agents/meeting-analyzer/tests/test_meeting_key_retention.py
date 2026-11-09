import runpy
from pathlib import Path
from meeting_analyzer import store


def test_meeting_policy_change_preserves_old_key_guarantee(monkeypatch,tmp_path):
    namespace=runpy.run_path(str(Path(__file__).resolve().parents[3]/
        'packages/dmb-agent-contracts/tests/test_key_retention.py'))
    namespace['check_frozen_key_policy'](store,monkeypatch,tmp_path)
