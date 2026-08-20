import ast
from pathlib import Path


TASKS_ROUTER = Path(__file__).parents[1] / "routers" / "tasks_router.py"
EXPRESS_ROUTER = Path(__file__).parents[1] / "routers" / "express_router.py"
AGENT_ROUTER = Path(__file__).parents[1] / "routers" / "agent_router.py"
ADMIN_ROUTER = Path(__file__).parents[1] / "routers" / "admin_router.py"


def _function_node(name, path=TASKS_ROUTER):
    tree = ast.parse(path.read_text(encoding="utf-8-sig"))
    return next(
        node for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name
    )


def _db_calls(node, method):
    return [
        call for call in ast.walk(node)
        if isinstance(call, ast.Call)
        and isinstance(call.func, ast.Attribute)
        and isinstance(call.func.value, ast.Name)
        and call.func.value.id == "db"
        and call.func.attr == method
    ]


def test_apply_tags_never_commits_its_own_transaction():
    node = _function_node("_apply_tags")
    assert _db_calls(node, "commit") == []
    assert len(_db_calls(node, "flush")) >= 1


def test_update_task_has_single_commit_boundary():
    node = _function_node("update_task")
    assert len(_db_calls(node, "commit")) == 1
    assert len(_db_calls(node, "rollback")) >= 1


def test_multi_step_write_routes_have_single_commit_boundary():
    routes = (
        ("create_task", TASKS_ROUTER),
        ("import_task_to_estimate", EXPRESS_ROUTER),
        ("update_sort_order", EXPRESS_ROUTER),
        ("remove_task_from_estimate", EXPRESS_ROUTER),
        ("agent_send_for_review", AGENT_ROUTER),
        ("update_display_setting", ADMIN_ROUTER),
        ("update_competency_cost", ADMIN_ROUTER),
        ("delete_competency_cost", ADMIN_ROUTER),
    )
    for name, path in routes:
        node = _function_node(name, path)
        assert len(_db_calls(node, "commit")) == 1, name


def test_send_for_review_rolls_back_failed_operation():
    node = _function_node("agent_send_for_review", AGENT_ROUTER)
    assert len(_db_calls(node, "flush")) == 1
    assert len(_db_calls(node, "rollback")) == 1
