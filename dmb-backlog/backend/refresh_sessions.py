"""Server-side refresh-token rotation and replay detection."""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import update
from sqlalchemy.orm import Session

from auth import create_refresh_token, decode_token
from models import RefreshSession, User


ROTATION_RETRY_GRACE_SECONDS = 10


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def cleanup_expired_sessions(db: Session) -> int:
    return db.query(RefreshSession).filter(
        RefreshSession.expires_at < _utcnow()
    ).delete(synchronize_session=False)


def issue_refresh_session(db: Session, user: User, family_id: str | None = None):
    family_id = family_id or str(uuid.uuid4())
    jti = str(uuid.uuid4())
    token = create_refresh_token(
        {"sub": str(user.id), "email": user.email},
        jti=jti,
        family_id=family_id,
    )
    payload = decode_token(token)
    session = RefreshSession(
        user_id=user.id,
        jti=jti,
        family_id=family_id,
        token_hash=hash_refresh_token(token),
        expires_at=datetime.fromtimestamp(payload["exp"], tz=timezone.utc),
    )
    db.add(session)
    db.flush()
    return token, session


def revoke_family(db: Session, family_id: str) -> None:
    db.query(RefreshSession).filter(
        RefreshSession.family_id == family_id,
        RefreshSession.revoked_at.is_(None),
    ).update({"revoked_at": _utcnow()}, synchronize_session=False)


def rotate_refresh_session(db: Session, token: str):
    payload = decode_token(token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    jti = payload.get("jti")
    family_id = payload.get("family_id")
    user_id = payload.get("sub")
    if not jti or not family_id or not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unmanaged refresh token")

    session = db.query(RefreshSession).filter(RefreshSession.jti == jti).first()
    if session is None or session.family_id != family_id or session.user_id != int(user_id):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh session not found")

    now = _utcnow()
    if session.revoked_at is not None:
        # A concurrent browser request can arrive just after a successful
        # rotation. Do not invalidate the winner's new token during a short
        # retry window; an older replay still revokes the whole family.
        if (
            session.rotated_to_jti
            and _as_utc(session.revoked_at) >= now - timedelta(seconds=ROTATION_RETRY_GRACE_SECONDS)
        ):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token already rotated")
        revoke_family(db, family_id)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token replay detected")

    if _as_utc(session.expires_at) < now or not secrets.compare_digest(
        session.token_hash, hash_refresh_token(token)
    ):
        session.revoked_at = now
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user or not user.is_active:
        revoke_family(db, family_id)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    new_token, new_session = issue_refresh_session(db, user, family_id=family_id)
    claimed = db.execute(
        update(RefreshSession)
        .where(
            RefreshSession.id == session.id,
            RefreshSession.revoked_at.is_(None),
            RefreshSession.token_hash == hash_refresh_token(token),
        )
        .values(revoked_at=now, rotated_to_jti=new_session.jti)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        # ``issue_refresh_session`` was flushed in this transaction; rollback
        # removes that losing child session as well.
        db.rollback()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token already rotated")
    cleanup_expired_sessions(db)
    db.commit()
    return user, new_token


def revoke_refresh_session(db: Session, token: str) -> None:
    payload = decode_token(token)
    if not payload or payload.get("type") != "refresh" or not payload.get("jti"):
        return
    session = db.query(RefreshSession).filter(RefreshSession.jti == payload["jti"]).first()
    if session and secrets.compare_digest(session.token_hash, hash_refresh_token(token)):
        session.revoked_at = session.revoked_at or _utcnow()
    cleanup_expired_sessions(db)
    db.commit()
