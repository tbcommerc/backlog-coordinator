from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
import sys
import os
import time
from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from config import settings
from database import Base
import models  # noqa: F401 - registers every model in Base.metadata
from services.backlog_assistant_integration import ledger  # noqa: F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        # All deployment paths use the same session-level PostgreSQL lock.
        # Commit the probe transaction before Alembic owns its DDL transaction.
        locked = False
        lock_key = 709184521232
        try:
            if connection.dialect.name == 'postgresql':
                timeout = float(os.environ.get('MIGRATION_LOCK_TIMEOUT_SECONDS', '120'))
                if not 0 < timeout <= 3600:
                    raise ValueError('MIGRATION_LOCK_TIMEOUT_SECONDS must be in (0, 3600]')
                deadline = time.monotonic() + timeout
                while True:
                    locked = bool(connection.execute(text('SELECT pg_try_advisory_lock(:key)'), {'key': lock_key}).scalar())
                    connection.commit()
                    if locked:
                        break
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Another database migration is running; migration lock wait expired')
                    time.sleep(min(0.25, max(0, deadline - time.monotonic())))
            context.configure(
                connection=connection,
                target_metadata=target_metadata,
                compare_type=True,
                compare_server_default=True,
            )
            with context.begin_transaction():
                context.run_migrations()
        finally:
            if locked:
                connection.rollback()
                connection.execute(text('SELECT pg_advisory_unlock(:key)'), {'key': lock_key})
                connection.commit()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
