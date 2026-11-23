import asyncio
import pytest
from sqlalchemy import text
from schema_guard import schema_status, expected_heads, require_current_schema


@pytest.mark.parametrize('revision',[None,'d352a19c40e8','unknown_bank_revision'])
def test_unprepared_revision_is_rejected_without_schema_repairs(db,monkeypatch,revision):
    from config import settings
    monkeypatch.setattr(settings,'DATABASE_REQUIRE_RESTRICTED_ROLE',False)
    if revision:
        db.execute(text('CREATE TABLE alembic_version(version_num VARCHAR(32) PRIMARY KEY)'))
        db.execute(text('INSERT INTO alembic_version VALUES (:revision)'),{'revision':revision})
    result=schema_status(db.connection())
    assert result['status']=='migration_required'
    with pytest.raises(RuntimeError,match='DBA'):
        require_current_schema(db.connection())


def test_revision_marker_is_not_enough_if_structure_does_not_match(db,monkeypatch):
    from config import settings
    monkeypatch.setattr(settings,'DATABASE_REQUIRE_RESTRICTED_ROLE',False)
    db.execute(text('CREATE TABLE alembic_version(version_num VARCHAR(32) PRIMARY KEY)'))
    db.execute(text('INSERT INTO alembic_version VALUES (:revision)'),{'revision':expected_heads()[0]})
    assert require_current_schema(db.connection())['structure']=='ok'
    db.execute(text('ALTER TABLE tasks ALTER COLUMN team_id SET NOT NULL'))
    result=schema_status(db.connection(),check_structure=True)
    assert result['status']=='schema_structure_mismatch'
    assert result['missing']==['tasks.team_id must allow NULL']


def test_production_start_stops_before_application_side_effects(monkeypatch):
    import main
    import schema_guard
    from config import settings
    monkeypatch.setattr(settings,'DEBUG',False)
    monkeypatch.setattr(main,'validate_runtime_settings',lambda:None)
    monkeypatch.setattr(main,'init_db',lambda:None)
    class Connection:
        def __enter__(self):return self
        def __exit__(self,*args):return False
    monkeypatch.setattr(main.engine,'connect',lambda:Connection())
    def reject(connection):raise RuntimeError('DBA preparation required')
    monkeypatch.setattr(schema_guard,'require_current_schema',reject)
    async def start():
        async with main.lifespan(main.app):
            pytest.fail('Unprepared production application must not start')
    with pytest.raises(RuntimeError,match='DBA preparation'):
        asyncio.run(start())
