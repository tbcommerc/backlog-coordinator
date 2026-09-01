"""Cross-process singleton locks for background jobs."""
from __future__ import annotations

from contextlib import contextmanager
from hashlib import blake2b
from threading import Lock

from sqlalchemy import text

from database import engine


_local_locks: dict[str, Lock] = {}


class SingletonWorkerLease:
    def __init__(self, acquired: bool, connection=None):
        self.acquired = acquired
        self.connection = connection

    def __bool__(self) -> bool:
        return self.acquired

    def is_valid(self) -> bool:
        """A live PostgreSQL connection implies its advisory lock is still held."""
        if not self.acquired:
            return False
        if self.connection is None:
            return True
        self.connection.execute(text("SELECT 1"))
        return True


def advisory_lock_key(name: str) -> int:
    """Return a deterministic signed bigint accepted by PostgreSQL."""
    digest = blake2b(name.encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, byteorder="big", signed=True)


@contextmanager
def singleton_worker_lock(name: str):
    """Yield whether this process owns the named singleton worker lease.

    PostgreSQL advisory locks are connection-scoped and are automatically
    released if the worker or its database connection disappears.  SQLite is
    a development-only fallback and can coordinate threads in one process.
    """
    if engine.dialect.name != "postgresql":
        lock = _local_locks.setdefault(name, Lock())
        acquired = lock.acquire(blocking=False)
        try:
            yield SingletonWorkerLease(acquired)
        finally:
            if acquired:
                lock.release()
        return

    key = advisory_lock_key(name)
    connection = engine.connect()
    acquired = False
    try:
        acquired = bool(connection.execute(
            text("SELECT pg_try_advisory_lock(:key)"), {"key": key}
        ).scalar())
        yield SingletonWorkerLease(acquired, connection)
    finally:
        if acquired:
            try:
                connection.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": key})
            except Exception:
                # A broken connection has already released its session lock.
                pass
            finally:
                connection.close()
        else:
            connection.close()
