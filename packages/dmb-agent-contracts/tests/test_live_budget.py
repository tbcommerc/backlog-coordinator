"""Live qualification may never reset or silently exceed user authorization."""
import importlib.util
import json
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("agent_live_budget",
    Path(__file__).resolve().parents[3]/"scripts/agent_live_budget.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def ledger(tmp_path, **values):
    path = tmp_path/"budget.json"
    path.write_text(json.dumps({"max_calls":40, "max_seconds":1200,
        "reserved_calls":21, "reserved_seconds":639, **values}))
    return path


def test_success_refunds_only_unused_time_and_preserves_prior_calls(tmp_path):
    path = ledger(tmp_path)
    with module.LiveBudget(path).request(45):
        during = json.loads(path.read_text())
        assert during["reserved_calls"] == 22
        assert during["reserved_seconds"] == 684
    after = json.loads(path.read_text())
    assert after["reserved_calls"] == 22 and after["reserved_seconds"] == 640
    assert after["active_reservations"] == {}


def test_unknown_transport_outcome_consumes_entire_reservation(tmp_path):
    path = ledger(tmp_path)
    with pytest.raises(ConnectionError):
        with module.LiveBudget(path).request(45):
            raise ConnectionError("Synthetic lost response")
    value = json.loads(path.read_text())
    assert value["reserved_calls"] == 22 and value["reserved_seconds"] == 684


@pytest.mark.parametrize("values", [{"reserved_calls":40}, {"reserved_seconds":1190}])
def test_limit_failure_never_performs_or_charges_request(tmp_path, values):
    path = ledger(tmp_path, **values)
    before = path.read_bytes()
    with pytest.raises(RuntimeError, match="live_budget_exhausted"):
        with module.LiveBudget(path).request(45):
            pytest.fail("No network request is authorized")
    assert path.read_bytes() == before


def test_missing_ledger_cannot_create_new_authorization(tmp_path):
    with pytest.raises(FileNotFoundError):
        module.LiveBudget(tmp_path/"missing.json")
