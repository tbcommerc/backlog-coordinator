"""
DMB Backlog - Database Setup
"""
import logging
import time

from sqlalchemy import create_engine, inspect, text, event, select, func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool
from config import settings


logger = logging.getLogger("dmb_backlog.database")


class MetricsQueuePool(QueuePool):
    """Record actual time spent waiting for a pooled DB connection."""

    def _do_get(self):
        started_at = time.monotonic()
        outcome = "success"
        try:
            return super()._do_get()
        except Exception:
            outcome = "error"
            raise
        finally:
            from metrics import inc_counter, observe_histogram
            observe_histogram(
                "dmb_db_pool_wait_seconds",
                time.monotonic() - started_at,
                {"outcome": outcome},
            )
            if outcome == "error":
                inc_counter("dmb_db_pool_checkout_errors_total")

_sqlite_database = settings.DATABASE_URL.lower().startswith("sqlite")
_engine_options = {
    "pool_pre_ping": True,
    "connect_args": {"check_same_thread": False} if _sqlite_database else {},
}
if not _sqlite_database:
    _engine_options.update({
        "poolclass": MetricsQueuePool,
        "pool_size": settings.DB_POOL_SIZE,
        "max_overflow": settings.DB_MAX_OVERFLOW,
        "pool_timeout": settings.DB_POOL_TIMEOUT_SECONDS,
    })

engine = create_engine(settings.DATABASE_URL, **_engine_options)


def _sqlite_lower_unicode(value):
    """Unicode-aware lower() для SQLite (встроенный lower() работает только с ASCII)."""
    return value.lower() if isinstance(value, str) else value


if _sqlite_database:
    @event.listens_for(engine, "connect")
    def _register_sqlite_lower_unicode(dbapi_conn, connection_record):
        dbapi_conn.create_function("lower_unicode", 1, _sqlite_lower_unicode)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def db_lower(value):
    """Return a Unicode-aware lowercase SQL expression for the active dialect."""
    if engine.dialect.name == "sqlite":
        return func.lower_unicode(value)
    return func.lower(value)


def get_db():
    """Dependency for getting DB session"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_schema():
    """Auto-add missing columns to existing tables. Never deletes or modifies existing data."""
    import models  # noqa: F401
    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    for table_name in inspector.get_table_names():
        existing_cols = {c['name'] for c in inspector.get_columns(table_name)}
        table = Base.metadata.tables.get(table_name)
        if table is None:
            continue
        for col in table.columns:
            if col.name not in existing_cols:
                col_type = str(col.type).upper()
                nullable = 'NULL' if col.nullable else 'NOT NULL'
                default = ''
                arg = None
                if col.server_default is not None:
                    arg = getattr(col.server_default, 'arg', None)
                elif col.default is not None and hasattr(col.default, 'arg'):
                    arg = col.default.arg
                if arg is True:
                    default = " DEFAULT 1"
                elif arg is False:
                    default = " DEFAULT 0"
                elif isinstance(arg, str):
                    default = f" DEFAULT '{arg}'"
                elif arg is not None:
                    default = f" DEFAULT {arg}"
                with engine.connect() as conn:
                    try:
                        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type} {default}"))
                        conn.commit()
                        logger.info("Added column %s.%s (%s)", table_name, col.name, col_type)
                    except SQLAlchemyError:
                        logger.exception("Failed to add column %s.%s", table_name, col.name)
                        raise

    # Public task IDs are stored because they are shown outside the database and
    # must remain stable. Existing rows are backfilled deterministically from the
    # immutable numeric primary key before the unique index is created.
    tasks_table = Base.metadata.tables.get("tasks")
    if tasks_table is not None and "public_id" in tasks_table.c:
        with engine.begin() as conn:
            task_rows = conn.execute(
                select(tasks_table.c.id, tasks_table.c.public_id)
            ).all()
            from models import format_task_public_id
            outdated_ids = [
                task_id for task_id, public_id in task_rows
                if public_id != format_task_public_id(task_id)
            ]
            if outdated_ids:
                for task_id in outdated_ids:
                    conn.execute(
                        tasks_table.update()
                        .where(tasks_table.c.id == task_id)
                        .values(public_id=format_task_public_id(task_id))
                    )
                logger.info("Backfilled public IDs for %d tasks", len(outdated_ids))

        public_id_index = next(
            (idx for idx in tasks_table.indexes if idx.name == "ux_tasks_public_id"),
            None,
        )
        if public_id_index is not None:
            public_id_index.create(bind=engine, checkfirst=True)

    # Presence is ephemeral, but duplicate rows make one user appear several
    # times and prevent atomic upsert. Keep the newest-independent canonical
    # row (smallest id) and enforce one viewer per task/user pair.
    task_viewers_table = Base.metadata.tables.get("task_viewers")
    if task_viewers_table is not None:
        with engine.begin() as conn:
            conn.execute(text(
                "DELETE FROM task_viewers "
                "WHERE id NOT IN ("
                "SELECT MIN(id) FROM task_viewers GROUP BY task_id, user_id"
                ")"
            ))
        viewer_index = next(
            (idx for idx in task_viewers_table.indexes if idx.name == "ux_task_viewers_task_user"),
            None,
        )
        if viewer_index is not None:
            viewer_index.create(bind=engine, checkfirst=True)


def init_db():
    """Validate connectivity; PostgreSQL schema is managed by Alembic."""
    if engine.dialect.name == "sqlite":
        # Compatibility path for isolated legacy/unit-test databases.
        ensure_schema()
        return
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
