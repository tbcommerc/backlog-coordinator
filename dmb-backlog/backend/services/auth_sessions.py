"""Stable server sessions. User locks serialize lifecycle, login and refresh."""
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from models import AuthSession, AuthChallenge, RefreshSession, SecurityEvent, User
from config import settings


def now():
    return datetime.now(timezone.utc)


def utc(value):
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def event(db, action, subject=None, actor=None, session=None, reason=None, outcome='success'):
    from audit_context import current_audit_request
    context = current_audit_request()
    db.add(SecurityEvent(action=action, subject_id=subject, actor_id=actor, session_id=session,
        reason=reason, outcome=outcome, request_id=context.request_id if context else None,
        ip_address=context.ip_address if context else None))


def lock_user(db, user_id):
    return db.query(User).filter(User.id == user_id).populate_existing().with_for_update().first()


def check_session(db, user, sid, version):
    session = db.query(AuthSession).filter(AuthSession.id == sid, AuthSession.user_id == user.id).populate_existing().first()
    idle = settings.AUTH_ADMIN_IDLE_MINUTES if user.role and user.role.admin_access == 'full' else settings.AUTH_IDLE_MINUTES
    if (not user.is_active or user.credential_state != 'ready' or user.auth_version != version or
        not session or session.auth_version != version or session.revoked_at or
        utc(session.absolute_expires_at) <= now() or utc(session.last_activity_at) + timedelta(minutes=idle) <= now()):
        raise HTTPException(401, 'SESSION_INVALID')
    return session


def revoke(db, user_id, reason, except_sid=None):
    query = db.query(AuthSession).filter(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
    if except_sid:
        query = query.filter(AuthSession.id != except_sid)
    return query.update({'revoked_at': now(), 'revoke_reason': reason}, synchronize_session='fetch')


def invalidate(db, user, reason):
    user.auth_version += 1
    revoke(db, user.id, reason)
    db.query(AuthChallenge).filter(AuthChallenge.user_id == user.id, AuthChallenge.revoked_at.is_(None)).update({'revoked_at': now()}, synchronize_session='fetch')


def new_session(db, user, request):
    active = db.query(AuthSession).filter(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)).order_by(AuthSession.created_at).all()
    for old in active[:max(0, len(active) - settings.AUTH_MAX_SESSIONS + 1)]:
        old.revoked_at, old.revoke_reason = now(), 'session_limit'
    timestamp = now()
    session = AuthSession(id=str(uuid.uuid4()), user_id=user.id, auth_version=user.auth_version,
        created_at=timestamp, last_activity_at=timestamp,
        absolute_expires_at=timestamp + timedelta(hours=settings.AUTH_SESSION_HOURS),
        ip_address=(request.client.host if request.client else '')[:64],
        client_label=request.headers.get('user-agent', '')[:256])
    db.add(session)
    db.flush()
    return session
