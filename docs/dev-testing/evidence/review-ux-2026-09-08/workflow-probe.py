"""Offline source probe. Extracts production functions; never imports application/DB.

All request/user values are plain memory objects. No real DB records are created.
"""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[4]
source_path = ROOT / "dmb-backlog/backend/routers/agent_router.py"
tree = ast.parse(source_path.read_text(encoding="utf-8-sig"))
wanted = {"_request_available_actions", "agent_request_status", "_render_request"}
nodes = []
for node in tree.body:
    if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in {"REQUEST_STATUSES", "REQUEST_STATUS_TRANSITIONS"} for t in node.targets):
        nodes.append(node)
    if isinstance(node, ast.FunctionDef) and node.name in wanted:
        node.decorator_list = []
        node.returns = None
        for arg in node.args.args:
            arg.annotation = None
        node.args.defaults = [ast.Constant(None) for _ in node.args.defaults]
        nodes.append(node)

class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code = status_code
        self.detail = detail

class Field:
    def __eq__(self, other):
        return self
    def is_(self, other):
        return self

env = {
    "HTTPException": HTTPException,
    "RequirementRequest": SimpleNamespace(id=Field(), is_deleted=Field()),
    "is_customer_portal_only": lambda user: False,
    "can_review_request": lambda user, team_id: True,
    "_request_to_dict": lambda req, user: vars(req).copy(),
    "StaleDataError": type("StaleDataError", (Exception,), {}),
}
exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), str(source_path), "exec"), env)

def try_claim(user_id, status="returned"):
    req = SimpleNamespace(id=42, status=status, reviewer_id=11, team_id=7,
                          reject_reason="Уточните критерии", version=2,
                          is_deleted=False)
    user = SimpleNamespace(id=user_id)
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = req
    offered = env["_request_available_actions"](req, user)
    try:
        result = env["agent_request_status"](
            42, SimpleNamespace(status="in_review", version=2), db, user)
        return {"offered": offered, "status": result["status"],
                "comment_after": result["reject_reason"], "version_after": result["version"]}
    except HTTPException as error:
        return {"offered": offered, "http_status": error.status_code, "detail": error.detail["code"]}

mine = try_claim(11)
other = try_claim(12)
assert mine == {"offered": ["claim"], "status": "in_review", "comment_after": None, "version_after": 3}
assert other["offered"] == ["claim"] and other["http_status"] == 409
assert other["detail"] == "request_owned_by_another_reviewer"

draft = {"problem_statement": "Problem marker", "process": "Process marker",
         "dependencies": ["Dependency marker"], "risks": ["Risk marker"],
         "conflicts": [{"message": "Conflict marker"}], "priority": "Priority marker"}
description = env["_render_request"](draft)
assert "Process marker" in description and "Priority marker" in description
assert all(value not in description for value in ["Dependency marker", "Risk marker", "Conflict marker"])

print(json.dumps({"mode": "offline AST / memory only", "returned_same_reviewer": mine,
                  "returned_other_reviewer": other,
                  "description_omits": ["dependencies", "risks", "conflicts"],
                  "assertions": "passed"}, ensure_ascii=False, indent=2))
