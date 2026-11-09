from sqlalchemy import inspect, text
import pytest
from business_analyst_experimental.session import SessionStore


def test_import_style_store_does_not_create_schema(tmp_path):
    store = SessionStore(path=str(tmp_path/"technical.db"), initialize=False)
    assert inspect(store.engine).get_table_names() == []
    store.migrate_schema()
    assert set(inspect(store.engine).get_table_names()) == {"sessions", "message_receipts"}
    store.engine.dispose()


def test_unexpected_schema_refused_before_ddl(tmp_path):
    store = SessionStore(path=str(tmp_path/"technical.db"), initialize=False)
    with store.engine.begin() as conn:
        conn.execute(text("CREATE TABLE unexpected_technical (id INTEGER PRIMARY KEY)"))
    with pytest.raises(RuntimeError, match="Unexpected agent schema"):
        store.migrate_schema(backup_verified=True)
    assert inspect(store.engine).get_table_names() == ["unexpected_technical"]
    store.engine.dispose()


def test_expand_requires_backup_preserves_content(tmp_path):
    store = SessionStore(path=str(tmp_path/"technical.db"), initialize=False)
    with store.engine.begin() as conn:
        conn.execute(text("CREATE TABLE sessions (session_id VARCHAR(64) PRIMARY KEY, user_id INTEGER, state_json TEXT NOT NULL, updated_at VARCHAR(64) NOT NULL)"))
        conn.execute(text("INSERT INTO sessions VALUES ('synthetic', 0, :payload, '2026-11-02')"), {"payload": '{"history":[{"role":"user","content":"Synthetic"}]}'})
    with pytest.raises(RuntimeError, match="verified backup"):
        store.migrate_schema()
    assert set(inspect(store.engine).get_table_names()) == {"sessions"}
    store.migrate_schema(backup_verified=True)
    with store.engine.connect() as conn:
        row = conn.execute(text("SELECT state_json, last_message_at, version FROM sessions")).one()
        assert "Synthetic" in row[0] and row[1] == "2026-11-02" and row[2] == 0
    store.engine.dispose()
