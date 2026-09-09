"""Подключение к БД и сессии."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import REPO_ROOT, get_settings
from app.core.models import Base

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        url = get_settings().resolved_db_url()
        # check_same_thread нужен только SQLite: Streamlit и uvicorn ходят из разных потоков.
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        _engine = create_engine(url, future=True, connect_args=connect_args)
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)
    return _session_factory


@contextmanager
def session_scope() -> Iterator[Session]:
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_db(drop: bool = False) -> None:
    engine = get_engine()
    if not str(engine.url).startswith("sqlite"):
        tables = set(inspect(engine).get_table_names())
        if "alembic_version" not in tables:
            raise RuntimeError("Prioritiser schema is not migrated; run `alembic upgrade head`")
        from alembic.config import Config
        from alembic.runtime.migration import MigrationContext
        from alembic.script import ScriptDirectory

        alembic_config = Config(str(REPO_ROOT / "alembic.ini"))
        expected = ScriptDirectory.from_config(alembic_config).get_current_head()
        with engine.connect() as connection:
            current = MigrationContext.configure(connection).get_current_revision()
        if current != expected:
            raise RuntimeError(
                f"Prioritiser schema revision {current!r} is not current {expected!r}; run `alembic upgrade head`"
            )
        return
    if drop:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def reset_engine() -> None:
    """Сбрасывает кэш движка — нужно тестам, которые подменяют DB URL."""
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None
