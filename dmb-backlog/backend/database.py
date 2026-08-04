"""
DMB Backlog - Database Setup
"""
from sqlalchemy import create_engine, inspect, text, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from config import settings

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
)


def _sqlite_lower_unicode(value):
    """Unicode-aware lower() для SQLite (встроенный lower() работает только с ASCII)."""
    return value.lower() if isinstance(value, str) else value


if "sqlite" in settings.DATABASE_URL:
    @event.listens_for(engine, "connect")
    def _register_sqlite_lower_unicode(dbapi_conn, connection_record):
        dbapi_conn.create_function("lower_unicode", 1, _sqlite_lower_unicode)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


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
                if col.default and hasattr(col.default, 'arg'):
                    default = f" DEFAULT '{col.default.arg}'"
                with engine.connect() as conn:
                    try:
                        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}"))
                        conn.commit()
                        print(f"[db] Added column: {table_name}.{col.name} ({col_type})")
                    except Exception as e:
                        print(f"[db] Column {table_name}.{col.name}: {e}")


def init_db():
    """Create all tables and ensure schema is up to date"""
    ensure_schema()