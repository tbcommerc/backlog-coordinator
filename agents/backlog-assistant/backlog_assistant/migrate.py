"""Explicit, transactional, own-database migrations. Never invoked implicitly by API startup."""
from backlog_assistant.config import environment
import os
from sqlalchemy import create_engine, text
from backlog_assistant.store import metadata



def validate(engine):
    from dmb_agent_contracts.run_migration import validate as validate_runs
    allowed = set(metadata.tables) | {"backlog_assistant_migrations", "agent_runtime_bindings", "agent_runtime_migrations"}
    validate_runs(engine, allowed_existing=allowed)
    with engine.connect() as connection:
        versions = set(connection.execute(text("SELECT version FROM backlog_assistant_migrations")).scalars())
    if versions != {1,2,3,4}:
        raise ValueError("database_migration_required")

def migrate(url, *, backup_verified=False):
    if not url.startswith("postgresql+psycopg://"):
        raise ValueError("assistant_database_requires_postgresql")
    engine = create_engine(url)
    with engine.begin() as c:
        c.execute(text("SELECT pg_advisory_xact_lock(73910241)"))
        # Refuse an accidentally supplied DMB or other agent database.
        tables = set(c.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public'")).scalars())
        own = set(metadata.tables) | {"backlog_assistant_migrations", "agent_runtime_bindings", "agent_runtime_migrations"}
        if tables - own:
            raise ValueError("assistant_database_must_be_dedicated")
        c.execute(text("CREATE TABLE IF NOT EXISTS backlog_assistant_migrations (version integer PRIMARY KEY)"))
        versions = set(c.execute(text("SELECT version FROM backlog_assistant_migrations")).scalars())
        if versions - {1, 2, 3, 4}:
            raise ValueError("database_version_newer_than_service")
        if 1 not in versions:
            metadata.create_all(c)
            c.execute(text("INSERT INTO backlog_assistant_migrations(version) VALUES (1)"))
        if 2 not in versions:
            from dmb_agent_contracts.run_store import metadata as run_metadata
            if tables and not set(run_metadata.tables) <= tables and not backup_verified:
                raise ValueError("run_schema_expansion_requires_verified_backup")
            run_metadata.create_all(c)
            c.execute(text("INSERT INTO backlog_assistant_migrations(version) VALUES (2)"))
        if 3 not in versions:
            from dmb_agent_contracts.run_migration import _validate_existing
            from dmb_agent_contracts.run_store import metadata as common_metadata
            _validate_existing(c, own - set(common_metadata.tables), allow_legacy_retry=True, allow_legacy_scope=True)
            from sqlalchemy import inspect
            columns = {column["name"] for column in inspect(c).get_columns("agent_runs")}
            if "retry_of" not in columns:
                if tables and not backup_verified:
                    raise ValueError("run_schema_expansion_requires_verified_backup")
                c.execute(text("ALTER TABLE agent_runs ADD COLUMN retry_of VARCHAR(36)"))
            c.execute(text("INSERT INTO backlog_assistant_migrations(version) VALUES (3)"))
        if 4 not in versions:
            from dmb_agent_contracts.run_migration import migrate_operation_scope
            from sqlalchemy import inspect
            compatible = any(value['column_names'] == ['caller','actor','operation','key']
                for value in inspect(c).get_unique_constraints('agent_runs'))
            if not compatible and tables and not backup_verified:
                raise ValueError('run_schema_expansion_requires_verified_backup')
            migrate_operation_scope(c)
            c.execute(text('INSERT INTO backlog_assistant_migrations(version) VALUES (4)'))
    validate(engine)
    engine.dispose()


if __name__ == "__main__":
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser()
    parser.add_argument("--verified-backup-file", type=Path)
    args = parser.parse_args()
    verified = bool(args.verified_backup_file and args.verified_backup_file.is_file() and args.verified_backup_file.stat().st_size)
    if args.verified_backup_file and not verified:
        parser.error("Verified backup file is missing or empty")
    os.environ.update(environment())
    migrate(os.environ["ASSISTANT_DATABASE_URL"], backup_verified=verified)
