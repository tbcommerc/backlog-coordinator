import runpy
from pathlib import Path
import subprocess

def test_git_timeout_preserves_evidence_header(monkeypatch):
    scope = runpy.run_path(str(Path(__file__).resolve().parents[3]/'scripts/agent_evidence.py'))
    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired('git', 5)
    monkeypatch.setattr(scope['subprocess'], 'run', timeout)
    result = scope['evidence_header']('synthetic', 'offline_fixture', 'fixture')
    assert result['git_revision'] is None and result['git_revision_status'] == 'unavailable'
    assert result['sdk_files_sha256'] and result['real_remote'] == 'NOT_RUN'
