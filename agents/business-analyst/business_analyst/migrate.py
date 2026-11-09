"""Explicit expand-only migration. Restore uses a compatible artifact."""
import argparse
from pathlib import Path
from .session import session_store


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--verified-backup-file", type=Path)
    args = parser.parse_args()
    verified = bool(args.verified_backup_file and args.verified_backup_file.is_file() and args.verified_backup_file.stat().st_size)
    if args.verified_backup_file and not verified:
        parser.error("Verified backup file is missing or empty")
    from sqlalchemy import inspect
    from dmb_agent_contracts.run_migration import migrate
    initially_empty = not inspect(session_store.engine).get_table_names()
    session_store.migrate_schema(backup_verified=verified)
    migrate(session_store.engine, backup_verified=verified or initially_empty,
        allowed_existing=("sessions", "message_receipts", "agent_runtime_bindings", "agent_runtime_migrations"))


if __name__ == "__main__":
    main()
