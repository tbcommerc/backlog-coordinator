from routers.timeline_router import router


def _route_methods(path):
    methods = set()
    for route in router.routes:
        if route.path == path:
            methods.update(route.methods or set())
    return methods


def test_public_timeline_routes_are_read_only():
    assert _route_methods("/") == {"GET"}
    assert _route_methods("/{event_id}") == {"GET"}


def test_timeline_mutations_exist_only_under_admin_prefix():
    assert "POST" in _route_methods("/admin")
    assert "PUT" in _route_methods("/admin/{event_id}")
    assert "DELETE" in _route_methods("/admin/{event_id}")


def test_admin_timeline_mutations_require_full_admin_permission():
    for route in router.routes:
        if route.path not in {"/admin", "/admin/{event_id}"}:
            continue
        if not ({"POST", "PUT", "DELETE"} & (route.methods or set())):
            continue
        dependency_names = {
            dependency.call.__name__
            for dependency in route.dependant.dependencies
            if getattr(dependency, "call", None)
        }
        assert "permission_checker" in dependency_names
