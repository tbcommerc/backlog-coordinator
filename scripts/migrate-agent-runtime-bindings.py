"""Explicit optional runtime expansion in an already verified service-owned DB."""
import argparse
import importlib
from pathlib import Path
import runpy


def main():
    doctor = runpy.run_path(str(Path(__file__).with_name("agent-doctor.py")))
    parser = argparse.ArgumentParser()
    parser.add_argument("--service", required=True, choices=doctor["PROFILES"])
    parser.add_argument("--verified-backup-file", type=Path, required=True)
    args = parser.parse_args()
    if not args.verified_backup_file.is_file() or not args.verified_backup_file.stat().st_size:
        parser.error("Verified backup file is missing or empty")
    module, field, _, expected = doctor["PROFILES"][args.service]
    config = importlib.import_module(module)
    if args.service == "backlog-assistant":
        from backlog_assistant.store import metadata
        url = config.environment()[field]
        expected = set(metadata.tables) | {"backlog_assistant_migrations"}
    else:
        settings = config.settings if hasattr(config, "settings") else config.Settings()
        url = doctor["plain"](getattr(settings, field))
        if args.service == "value-priority-assessor":
            from value_priority_assessor.core.models import Base
            from value_priority_assessor import remote_tools
            expected = set(Base.metadata.tables) | {"alembic_version"}
    from sqlalchemy import create_engine, inspect
    from dmb_agent_contracts.run_store import metadata as run_metadata
    from dmb_agent_contracts.runtime_records import metadata as runtime_metadata, migrate
    if args.service in {"business-analyst", "business-analyst-experimental", "value-priority-assessor"}:
        expected = set(expected) | set(run_metadata.tables)
    if not url.startswith(("postgresql://", "postgresql+psycopg://")):
        raise RuntimeError("service_owned_postgresql_required")
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://"+url[len("postgresql://"):]
    engine = create_engine(url)
    try:
        existing = set(inspect(engine).get_table_names())
        if not set(expected) <= existing or existing - set(expected) - set(runtime_metadata.tables):
            raise RuntimeError("service_owned_migrated_schema_required")
        migrate(engine, backup_verified=True, allowed_existing=expected)
    finally:
        engine.dispose()
    print("Optional runtime bindings migrated; product/protected rows unchanged")


if __name__ == "__main__":
    main()
