from routers.work_relations_router import would_cycle, serialize_graph
from types import SimpleNamespace as NS
from fastapi import HTTPException
import pytest


def test_cycles_include_mixed_types_and_self_reference():
    a, b, c = ('major', 1), ('work', 1), ('work', 2)
    assert would_cycle([], a, a)
    assert not would_cycle([], a, b)  # Numeric ids are not interchangeable.
    assert would_cycle([(a, b), (b, c)], c, a)
    assert not would_cycle([(a, b)], a, c)


def test_dependency_lock_is_transaction_scoped_and_fails_closed():
    statements = []
    db = NS(bind=NS(dialect=NS(name='postgresql')), execute=lambda stmt: statements.append(str(stmt)))
    serialize_graph(db)
    assert statements == ['SELECT pg_advisory_xact_lock(18001642)']
    db.bind.dialect.name = 'sqlite'
    with pytest.raises(HTTPException) as exc: serialize_graph(db)
    assert exc.value.status_code == 503
