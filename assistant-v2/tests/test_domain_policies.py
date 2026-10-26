from app.domain.digest import digest_json
from app.domain.diffs import aggregate_diff_status, validate_operations
from app.domain.readiness import validate_business_requirement
from app.domain.transitions import need_case_transition


def test_canonical_digest_is_order_independent():
    assert digest_json({"b": 2, "a": 1}) == digest_json({"a": 1, "b": 2})


def test_state_machine_rejects_shortcuts():
    assert need_case_transition("draft", "captured").allowed
    assert not need_case_transition("draft", "ready_for_analysis").allowed
    assert need_case_transition("clarifying", "ready_for_analysis").requires_readiness


def test_protected_diff_paths_are_rejected():
    errors = validate_operations([
        {"ordinal": 1, "op": "replace", "path": "/owner_id", "claim_refs": ["c1"], "evidence_refs": ["f1"], "rationale": "x"},
        {"ordinal": 2, "op": "replace", "path": "/description", "claim_refs": ["c1"], "evidence_refs": ["f1"], "rationale": "x"},
    ])
    assert [(error.ordinal, error.code) for error in errors] == [(1, "path_not_allowed")]


def test_diff_evidence_is_mandatory():
    errors = validate_operations([
        {"ordinal": 1, "op": "replace", "path": "/description", "claim_refs": ["c1"], "rationale": "x"},
    ])
    assert [(error.ordinal, error.code) for error in errors] == [(1, "lineage_required")]
    assert aggregate_diff_status(["accepted", "rejected"]) == "partially_accepted"


def test_business_requirement_validator_is_read_only_and_deterministic():
    content = {
        "title": "Requirement",
        "purpose": "Reduce manual work",
        "target_outcome": "Observable result",
        "scope_in": ["Registry"],
        "scope_out": ["External delivery"],
        "actors": ["Analyst"],
        "primary_scenarios": ["Create registry"],
        "business_rules": ["Only authorized records"],
        "assumptions": ["Source is available"],
        "acceptance_criteria": ["The exported file contains every authorized record"],
        "traceability": ["claim:c1"],
        "unresolved_items": [],
    }
    before = dict(content)
    assert validate_business_requirement(content) == []
    assert content == before
