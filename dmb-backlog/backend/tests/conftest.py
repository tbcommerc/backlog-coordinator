import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base, get_db
from main import app


SQLALCHEMY_DATABASE_URL = "sqlite:///./test.db"

engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
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


@pytest.fixture(scope="function")
def client(db):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def auth_headers(client):
    from models import User, Role
    from auth import get_password_hash

    db = TestingSessionLocal()
    role = Role(name="Администратор", admin_access="full")
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

    response = client.post("/api/v1/auth/login", json={"email": "test@dmb.ru", "password": "testpass"})
    token = response.json()["access_token"]
    db.close()
    return {"Authorization": f"Bearer {token}"}
