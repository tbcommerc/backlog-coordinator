"""Refresh history bound to a stable server-side session."""
import secrets
import uuid
from datetime import timedelta
from fastapi import HTTPException
from auth import create_refresh_token, decode_token
from models import RefreshSession, AuthSession
from services.auth_challenges import digest
from services.auth_sessions import now, utc, lock_user, check_session, event

ROTATION_RETRY_GRACE_SECONDS = 10
hash_refresh_token = digest


def cleanup_expired_sessions(db):
    return db.query(RefreshSession).filter(RefreshSession.expires_at < now()-timedelta(days=1)).delete(synchronize_session=False)


def issue_refresh_session(db, user, session):
    jti = str(uuid.uuid4())
    token = create_refresh_token({'sub': str(user.id), 'sid': session.id, 'auth_version': user.auth_version,
        'exp': int(utc(session.absolute_expires_at).timestamp())}, jti=jti, family_id=session.id)
    row = RefreshSession(user_id=user.id, jti=jti, family_id=session.id, auth_session_id=session.id,
        token_hash=digest(token), expires_at=session.absolute_expires_at)
    db.add(row)
    db.flush()
    return token, row


def rotate_refresh_session(db, token):
    payload = decode_token(token)
    if not payload or payload['type'] != 'refresh':
        raise HTTPException(401, 'INVALID_REFRESH')
    user = lock_user(db, int(payload['sub']))
    if not user:
        raise HTTPException(401, 'INVALID_REFRESH')
    session = check_session(db, user, payload['sid'], payload['auth_version'])
    row = db.query(RefreshSession).filter(RefreshSession.jti == payload['jti']).with_for_update().first()
    if not row or row.auth_session_id != session.id or not secrets.compare_digest(row.token_hash, digest(token)):
        raise HTTPException(401, 'INVALID_REFRESH')
    if row.revoked_at:
        if row.rotated_to_jti and utc(row.revoked_at)+timedelta(seconds=10) > now():
            raise HTTPException(409, 'REFRESH_ALREADY_ROTATED')
        session.revoked_at, session.revoke_reason = now(), 'refresh_replay'
        event(db, 'refresh_replay', user.id, session=session.id)
        db.commit()
        raise HTTPException(401, 'REFRESH_REPLAY')
    new_token, child = issue_refresh_session(db, user, session)
    row.revoked_at, row.rotated_to_jti = now(), child.jti
    db.commit()
    user._auth_sid = session.id
    return user, new_token


def revoke_refresh_session(db, token):
    payload = decode_token(token)
    if not payload:
        return
    user = lock_user(db, int(payload['sub']))
    row = db.query(AuthSession).filter(AuthSession.id == payload['sid'], AuthSession.user_id == int(payload['sub'])).first()
    if row and user:
        row.revoked_at, row.revoke_reason = now(), 'logout'
        event(db, 'logout', user.id, user.id, row.id)
        db.commit()
