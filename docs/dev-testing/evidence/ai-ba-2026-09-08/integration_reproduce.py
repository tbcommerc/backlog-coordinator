"""Read-only integration probes for the AI business requirements audit.

Run from any directory with Python 3.10+ and Node.js on PATH:
    python -B docs/dev-testing/evidence/ai-ba-2026-09-08/integration_reproduce.py

Only the JSON evidence file next to this script is written. The probes extract
the current backend functions with AST, remove FastAPI decorators and inject
in-memory dependencies. No application import, server, database, user, team,
dictionary, LLM, or network operation is used. Frontend probes import the real
pure rendering helpers. This is controlled reproduction, not a live E2E run.
"""
from __future__ import annotations

import ast
from contextlib import nullcontext
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[4]
ROUTER = ROOT / "dmb-backlog/backend/routers/agent_router.py"


class Expression:
    def __eq__(self, other):
        return self

    def is_(self, other):
        return self


class RequestModel:
    id = Expression()
    agent_session_id = Expression()
    is_deleted = Expression()
    user_id = Expression()

    def __init__(self, **values):
        self.__dict__.update(values)
        self.id = 7
        self.version = 0


class FakeDB:
    def __init__(self, existing=None):
        self.existing = existing
        self.saved = None

    def query(self, *args):
        return self

    def filter(self, *args):
        return self

    def first(self):
        return self.existing

    def add(self, row):
        self.saved = row

    def flush(self):
        pass

    def commit(self):
        pass

    def refresh(self, row):
        pass


class MockHTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


def load_backend_functions(overrides=None):
    """Execute the unchanged function bodies, never the router imports."""
    source = ast.parse(ROUTER.read_text(encoding="utf-8-sig"))
    names = {
        "_render_request", "_request_available_actions", "agent_request_status",
        "agent_request_resume", "agent_send_for_review",
    }
    functions = [
        node for node in source.body
        if isinstance(node, ast.FunctionDef) and node.name in names
    ]
    for function in functions:
        function.decorator_list = []
        # Explicitly supply db/current_user instead of evaluating Depends().
        function.args.defaults = []
    constants = [
        node for node in source.body
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name)
            and target.id in {"REQUEST_STATUSES", "REQUEST_STATUS_TRANSITIONS"}
            for target in node.targets
        )
    ]
    module = ast.Module(body=[
        ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0),
        *constants, *functions,
    ], type_ignores=[])
    namespace = {
        "RequirementRequest": RequestModel,
        "HTTPException": MockHTTPException,
        "_submission_lock": lambda session_id: nullcontext(),
        "_user_session_ids": lambda db, user: {"audit-session"},
        "is_customer_portal_only": lambda user: False,
        "can_review_request": lambda user, team_id: True,
        "_request_to_dict": lambda row, user: dict(vars(row)),
    }
    namespace.update(overrides or {})
    exec(compile(ast.fix_missing_locations(module), str(ROUTER), "exec"), namespace)
    return namespace


def transfer_loss_probe():
    functions = load_backend_functions()
    draft = {
        "title": "Requirements transfer audit",
        "problem_statement": "NEED_MARKER",
        "process": "PROCESS_MARKER",
        "priority": "PRIORITY_MARKER",
        "acceptance_criteria": ["ACCEPTANCE_MARKER"],
        "risks": ["RISK_MARKER: stop settlement when limits are unavailable"],
        "dependencies": ["DEPENDENCY_MARKER: deploy after the core banking release"],
        "conflicts": [{"message": "CONFLICT_MARKER"}],
        "review_findings": [{"message": "REVIEW_MARKER", "severity": "warning"}],
        "gaps": [{"question": "GAP_MARKER"}],
        "field_provenance": {"target_process": {"source": "PROVENANCE_MARKER"}},
    }
    rendered = functions["_render_request"](draft)
    checks = {
        "need_preserved": "NEED_MARKER" in rendered,
        "process_preserved": "PROCESS_MARKER" in rendered,
        "priority_preserved": "PRIORITY_MARKER" in rendered,
        "acceptance_preserved": "ACCEPTANCE_MARKER" in rendered,
        "risks_preserved": "RISK_MARKER" in rendered,
        "dependencies_preserved": "DEPENDENCY_MARKER" in rendered,
        "conflicts_preserved": "CONFLICT_MARKER" in rendered,
        "review_findings_preserved": "REVIEW_MARKER" in rendered,
        "gaps_preserved": "GAP_MARKER" in rendered,
        "provenance_preserved": "PROVENANCE_MARKER" in rendered,
    }
    return {
        "kind": "actual pure backend renderer",
        "checks": checks,
        "loss_reproduced": not checks["risks_preserved"] and not checks["dependencies_preserved"],
        "limitation": "Structured RequirementRequest.draft retains these fields; the loss is in description copied to Task.",
        "rendered_description": rendered,
    }


def snapshot_race_probe():
    canonical = {"title": "Requirements audit", "problem_statement": "DRAFT_A"}
    observations = {"calls": []}

    def agent_call(method, path, payload=None):
        observations["calls"].append({"method": method, "path": path})
        if method == "GET":
            response = {"draft": deepcopy(canonical)}
            # Model an edit from another tab after the GET snapshot was read,
            # before the separately serialized confirmation endpoint executes.
            canonical["problem_statement"] = "DRAFT_B_AFTER_EXPLICIT_EDIT"
            return response
        observations["confirmed_draft"] = deepcopy(canonical)
        return {"action": "sent", "success": True, "draft": deepcopy(canonical)}

    functions = load_backend_functions({"_call_agent": agent_call})
    db = FakeDB()
    response = functions["agent_send_for_review"](
        SimpleNamespace(session_id="audit-session", title="", team_id=None),
        db, SimpleNamespace(id=2, team_id=3),
    )
    return {
        "kind": "actual backend submission with a controlled concurrent-edit interleaving",
        **observations,
        "persisted_draft": db.saved.draft,
        "response_draft": response["draft"],
        "same_confirmed_and_persisted_draft": db.saved.draft == observations["confirmed_draft"],
        "mismatch_reproduced": db.saved.draft != response["draft"],
        "limitation": "Agent HTTP and DB are simulated; this establishes the backend snapshot gap, not live race frequency.",
    }


def returned_claim_probe():
    row = SimpleNamespace(
        id=7, agent_session_id="audit-session", status="returned", version=2,
        reviewer_id=9, team_id=3, reject_reason="Please refine acceptance criteria",
        draft={"title": "Requirements audit", "problem_statement": "BEFORE_CUSTOMER_CORRECTION"},
    )
    latest_draft = {"title": "Requirements audit", "problem_statement": "AFTER_CUSTOMER_CORRECTION"}
    functions = load_backend_functions({"_call_agent": lambda *args: {"draft": deepcopy(latest_draft)}})
    db = FakeDB(existing=row)
    reviewer = SimpleNamespace(id=9, team_id=3)
    author = SimpleNamespace(id=2, team_id=3)
    actions = functions["_request_available_actions"](row, reviewer)
    functions["agent_request_status"](
        7, SimpleNamespace(status="in_review", version=2, assignee_id=None, reject_reason=""),
        db, reviewer,
    )
    try:
        functions["agent_request_resume"](7, db, author)
        resume_status = 200
    except MockHTTPException as error:
        resume_status = error.status_code
    response = functions["agent_send_for_review"](
        SimpleNamespace(session_id="audit-session", title="", team_id=None), db, author,
    )
    return {
        "kind": "actual backend actions, claim, resume and submission functions with in-memory dependencies",
        "actions_before_customer_resubmission": actions,
        "status_after_claim": row.status,
        "review_comment_after_claim": row.reject_reason,
        "author_resume_http_status": resume_status,
        "submitting_latest_draft_response": response,
        "latest_agent_draft": latest_draft,
        "persisted_request_draft": row.draft,
        "silent_discard_reproduced": response.get("action") == "sent" and row.draft != latest_draft,
        "limitation": "Authorization predicate and persistence are mocked; no live user or protected record was modified.",
    }


def frontend_projection_probe():
    node = shutil.which("node")
    if not node:
        return {"status": "not_run", "reason": "Node.js was not found on PATH"}
    javascript = """
import { signalCount, signalGroups, renderRequirementSections }
  from './js/components/requestPresentation.js';
const draft = {
  primary_role: 'ROLE_MARKER', user_roles: ['ROLE_MARKER'],
  process: 'PROCESS_MARKER', priority: 'PRIORITY_MARKER', department: 'DEPARTMENT_MARKER',
  quality_issues: [{ code: 'acceptance_not_measurable', message: 'QUALITY_MARKER' }],
  review_findings: [{ severity: 'warning', message: 'REVIEW_MARKER', field: 'sources' }],
  field_provenance: { target_process: { source: 'assumption', confirmed: false, assumption: true } },
};
const html = renderRequirementSections(draft);
console.log(JSON.stringify({
  signal_count: signalCount(draft), signal_groups: signalGroups(draft),
  displays_process: html.includes(draft.process), displays_priority: html.includes(draft.priority),
  displays_department: html.includes(draft.department),
  passport_claims_customer_confirmation: html.includes('Подтверждённая заказчиком'),
}));
"""
    completed = subprocess.run(
        [node, "--input-type=module"], input=javascript, text=True,
        encoding="utf-8", capture_output=True, check=True,
        cwd=ROOT / "dmb-backlog/frontend",
    )
    return {
        "kind": "actual pure frontend exports on a focused schema-compatible fixture",
        **json.loads(completed.stdout),
        "limitation": "Some quality issues are also copied to open_questions by the composer; this probe isolates which properties the reviewer view itself consumes.",
    }


def main():
    relative_sources = [
        "dmb-backlog/backend/routers/agent_router.py",
        "dmb-backlog/backend/models.py",
        "dmb-backlog/frontend/js/components/requestPresentation.js",
        "dmb-backlog/frontend/js/components/reviewPage.js",
        "agent/agent/api/router.py",
        "agent/agent/orchestrator.py",
    ]
    results = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "workspace": str(ROOT),
        "method": "Read-only execution of current source with isolated in-memory dependencies; no application or DB imports.",
        "source_sha256": {
            name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            for name in relative_sources
        },
        "transfer_loss": transfer_loss_probe(),
        "snapshot_race": snapshot_race_probe(),
        "returned_claim": returned_claim_probe(),
        "frontend_projection": frontend_projection_probe(),
    }
    output = Path(__file__).with_name("integration_results.json")
    output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(output),
        "transfer_loss_reproduced": results["transfer_loss"]["loss_reproduced"],
        "snapshot_mismatch_reproduced": results["snapshot_race"]["mismatch_reproduced"],
        "returned_claim_silent_discard_reproduced": results["returned_claim"]["silent_discard_reproduced"],
        "frontend_signal_count": results["frontend_projection"].get("signal_count"),
    }, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
