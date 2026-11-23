"""Local browser acceptance server, restricted to an isolated loopback PostgreSQL.

Never use this test entry point to deploy a stand. It seeds synthetic data only
in codex_deploytest_* and binds exclusively to 127.0.0.1.
"""
from sqlalchemy.engine import make_url

DEMO_LOGIN = "browser.demo"
DEMO_PASSWORD = "Isolated browser demonstration 2026!"


def main():
    from config import settings
    url = make_url(settings.DATABASE_URL)
    if url.get_backend_name() != "postgresql" or url.host not in {"127.0.0.1", "localhost"} or not (url.database or "").startswith("codex_deploytest_"):
        raise SystemExit("Refusing to run outside an isolated loopback deployment-test database")
    from database import SessionLocal
    from models import User
    from services.stand_setup import bootstrap_admin
    from services.credentials import hash_password
    with SessionLocal() as db:
        if db.query(User).count():
            raise SystemExit("Browser test database must have no users")
        user, _ = bootstrap_admin(db, DEMO_LOGIN, "Демонстрационный администратор", "isolated-browser-acceptance", demo_data=True)
        user.password_hash = hash_password(DEMO_PASSWORD)
        user.credential_state = "ready"
        db.commit()
    # Exercise normal ASGI routing and middleware without background processes.
    from main import app
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, lifespan="off", log_level="warning")


if __name__ == "__main__":
    main()
