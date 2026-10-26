"""Explicit, transactional, own-database migrations. Never invoked implicitly by API startup."""
import os
from sqlalchemy import create_engine, text
from service.store import metadata


def migrate(url):
    if not url.startswith("postgresql+psycopg://"):
        raise ValueError("assistant_database_requires_postgresql")
    engine = create_engine(url)
    with engine.begin() as c:
        c.execute(text("SELECT pg_advisory_xact_lock(73910241)"))
        # Refuse an accidentally supplied DMB or other agent database.
        tables = set(c.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public'")).scalars())
        own = set(metadata.tables) | {"backlog_assistant_migrations"}
        if tables - own:
            raise ValueError("assistant_database_must_be_dedicated")
        c.execute(text("CREATE TABLE IF NOT EXISTS backlog_assistant_migrations (version integer PRIMARY KEY)"))
        versions = set(c.execute(text("SELECT version FROM backlog_assistant_migrations")).scalars())
        if versions - {1}:
            raise ValueError("database_version_newer_than_service")
        if 1 not in versions:
            metadata.create_all(c)
            c.execute(text("INSERT INTO backlog_assistant_migrations(version) VALUES (1)"))
    engine.dispose()


if __name__ == "__main__":
    migrate(os.environ["ASSISTANT_DATABASE_URL"])
