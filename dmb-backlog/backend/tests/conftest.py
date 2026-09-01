import os

os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")
os.environ.setdefault("RUN_STARTUP_SEED", "false")
os.environ.setdefault("RUN_STARTUP_MAINTENANCE", "false")
os.environ.setdefault("RUN_NOTIFICATION_SCHEDULER", "false")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from database import Base, get_db
from main import app


SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})


def _sqlite_lower_unicode(value):
    return value.lower() if isinstance(value, str) else value


@event.listens_for(engine, "connect")
def _register_sqlite_lower_unicode(dbapi_conn, connection_record):
    dbapi_conn.create_function("lower_unicode", 1, _sqlite_lower_unicode)


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="function")
def db():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    yield db
    Base.metadata.drop_all(bind=engine)
    db.close()


@pytest.fixture(scope="function")
def client(db):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_headers(client):
    from models import User, Role
    from auth import get_password_hash

    db = TestingSessionLocal()
    role = Role(
        name="Администратор",
        admin_access="full",
        backlog_team_access="write_all",
        backlog_dmb_access="read_write",
        reports_access="read_write",
        analytics_access="read_write",
        customer_access="read_write",
        settings_access="available",
        can_edit_tasks=True,
        can_delete_tasks=True,
        can_export=True,
    )
    db.add(role)
    db.commit()
    db.refresh(role)

    user = User(
        email="test@dmb.ru",
        password_hash=get_password_hash("testpass"),
        name="Test User",
        role_id=role.id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    from auth import create_access_token
    token = create_access_token({"sub": str(user.id), "email": user.email})
    db.close()
    return {"Authorization": f"Bearer {token}"}
