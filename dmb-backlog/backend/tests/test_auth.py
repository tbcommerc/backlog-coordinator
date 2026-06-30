def test_health_check(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


def test_login_success(client, db):
    from models import User, Role
    from auth import get_password_hash

    role = Role(name="TestRole")
    db.add(role)
    db.commit()
    db.refresh(role)

    user = User(
        email="login@dmb.ru",
        password_hash=get_password_hash("pass123"),
        name="Login User",
        role_id=role.id,
        is_active=True,
    )
    db.add(user)
    db.commit()

    response = client.post("/api/v1/auth/login", json={"email": "login@dmb.ru", "password": "pass123"})
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["user"]["email"] == "login@dmb.ru"


def test_login_invalid_credentials(client):
    response = client.post("/api/v1/auth/login", json={"email": "bad@dmb.ru", "password": "wrong"})
    assert response.status_code == 401


def test_me_requires_auth(client):
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401


def test_me_returns_user(auth_headers):
    from fastapi.testclient import TestClient
    from main import app
    with TestClient(app) as c:
        response = c.get("/api/v1/auth/me", headers=auth_headers)
        assert response.status_code == 200
        assert response.json()["email"] == "test@dmb.ru"
