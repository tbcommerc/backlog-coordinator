from pathlib import Path


def test_runtime_does_not_create_or_alter_schema():
    root = Path(__file__).resolve().parents[1]
    runtime = "\n".join(path.read_text(encoding="utf-8") for path in (root / "app").rglob("*.py"))
    assert ".create_all(" not in runtime
    assert "ALTER TABLE" not in runtime.upper()
    migration = (root / "migrations" / "versions" / "20260918_0001_initial.py").read_text(encoding="utf-8")
    assert "op.create_table" in migration
    assert "dmb_backlog" not in migration

