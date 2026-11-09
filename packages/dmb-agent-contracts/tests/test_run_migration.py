import pytest
from sqlalchemy import create_engine, inspect, text

from dmb_agent_contracts.run_migration import migrate


def test_existing_agent_history_requires_backup_and_survives_expansion(tmp_path):
    engine = create_engine("sqlite:///"+str(tmp_path/"history.sqlite"))
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE synthetic_history (id integer primary key, value text)"))
        connection.execute(text("INSERT INTO synthetic_history VALUES (1, 'preserve')"))
    with pytest.raises(RuntimeError, match="requires_verified_backup"):
        migrate(engine, allowed_existing=("synthetic_history",))
    assert set(inspect(engine).get_table_names()) == {"synthetic_history"}
    migrate(engine, backup_verified=True, allowed_existing=("synthetic_history",))
    migrate(engine, allowed_existing=("synthetic_history",))
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT value FROM synthetic_history WHERE id=1")) == "preserve"
    engine.dispose()


def test_foreign_database_is_refused_even_with_backup(tmp_path):
    engine = create_engine("sqlite:///"+str(tmp_path/"foreign.sqlite"))
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE foreign_data (id integer primary key)"))
    with pytest.raises(RuntimeError, match="unexpected_agent_schema"):
        migrate(engine, backup_verified=True)
    assert set(inspect(engine).get_table_names()) == {"foreign_data"}
    engine.dispose()
