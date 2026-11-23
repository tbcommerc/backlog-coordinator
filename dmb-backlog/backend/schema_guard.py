"""Read-only schema revision checks; web workers never run migrations."""
from functools import lru_cache
from pathlib import Path
import json

from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import text, inspect


@lru_cache(maxsize=1)
def expected_heads():
    return tuple(sorted(ScriptDirectory(str(Path(__file__).parent / 'alembic')).get_heads()))


def schema_status(connection, *, check_structure=False):
    current = tuple(sorted(MigrationContext.configure(connection).get_current_heads()))
    expected = expected_heads()
    result = {'status': 'ok' if current == expected else 'migration_required',
              'current': list(current), 'expected': list(expected)}
    from config import settings
    if settings.DATABASE_REQUIRE_RESTRICTED_ROLE and current == expected:
        if connection.dialect.name != 'postgresql':
            result['status'] = 'postgresql_required'
            return result
        powers = connection.execute(text("""
            SELECT has_database_privilege(current_database(),'CREATE')
                OR has_schema_privilege(current_schema(),'CREATE')
                OR (SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls
                    FROM pg_roles WHERE rolname=current_user)
                OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname=current_schema() AND c.relkind IN ('r','p','v','m','S','f')
                      AND pg_has_role(c.relowner,'MEMBER'))
                OR has_table_privilege('alembic_version','INSERT,UPDATE,DELETE')
        """)).scalar()
        result['runtime_role'] = 'ddl_privileges_present' if powers else 'restricted'
        if powers:
            result['status'] = 'unsafe_runtime_role'
    if check_structure and result['status'] == 'ok':
        from models import User, Role, Task, DictionaryItem
        inspector = inspect(connection)
        missing = []
        for model in [User, Role, Task, DictionaryItem]:
            table = model.__table__
            if not inspector.has_table(table.name):
                missing.append(table.name)
                continue
            columns = {column['name']:column for column in inspector.get_columns(table.name)}
            missing.extend(table.name+'.'+column.name for column in table.columns if column.name not in columns)
            if table.name == 'tasks' and 'team_id' in columns and not columns['team_id']['nullable']:
                missing.append('tasks.team_id must allow NULL')
        result['structure'] = 'mismatch' if missing else 'ok'
        if missing:
            result['status'] = 'schema_structure_mismatch'
            result['missing'] = missing
    return result


def require_current_schema(connection):
    result = schema_status(connection, check_structure=True)
    if result['status'] != 'ok':
        raise RuntimeError('Prepared database schema or runtime role does not match this release; ask the DBA to prepare it before starting backend')
    return result


if __name__ == '__main__':
    from database import engine
    with engine.connect() as connection:
        result = schema_status(connection, check_structure=True)
    print(json.dumps(result))
    raise SystemExit(0 if result['status'] == 'ok' else 1)
