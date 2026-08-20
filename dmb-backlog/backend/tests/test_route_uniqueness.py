from collections import Counter

from routers.admin_router import router


def test_admin_router_has_no_duplicate_method_path_pairs():
    pairs = [
        (method, route.path)
        for route in router.routes
        for method in (route.methods or set())
        if method not in {"HEAD", "OPTIONS"}
    ]
    duplicates = [pair for pair, count in Counter(pairs).items() if count > 1]
    assert duplicates == []


def test_project_crud_is_registered_once_per_method():
    project_pairs = [
        (method, route.path)
        for route in router.routes
        for method in (route.methods or set())
        if route.path.startswith("/projects")
    ]
    assert sorted(project_pairs) == sorted([
        ("GET", "/projects"),
        ("POST", "/projects"),
        ("PUT", "/projects/{item_id}"),
        ("DELETE", "/projects/{item_id}"),
    ])
