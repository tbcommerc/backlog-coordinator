"""Single account lifecycle policy for both user APIs."""
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from models import User, Role, LoginReservation
from services import auth_sessions as sessions, auth_challenges as challenges
from services.credentials import normalize_login
from config import settings


def admin_lock(db):
    # All changes to administrator readiness/membership take this lock first.
    db.execute(text('SELECT pg_advisory_xact_lock(761204120)'))


def authorize(db, actor, token, purpose, target=None):
    admin_lock(db)
    sid, version = actor._auth_sid, actor._auth_version
    actor = sessions.lock_user(db, actor.id)
    sessions.check_session(db, actor, sid, version)
    if not actor.role or actor.role.admin_access != 'full':
        raise HTTPException(403, 'FULL_ADMIN_REQUIRED')
    challenges.consume(db, token, actor, 'reauth:'+purpose, sid, target)
    return actor


def protect(db, actor, user, loses_admin):
    if not loses_admin:
        return
    if actor.id == user.id:
        raise HTTPException(409, 'CANNOT_RESTRICT_SELF')
    if user.role and user.role.admin_access == 'full' and user.is_active and user.credential_state == 'ready':
        others = db.query(User).join(Role).filter(User.id != user.id, User.is_active.is_(True),
            User.credential_state == 'ready', Role.admin_access == 'full').count()
        if not others:
            raise HTTPException(409, 'LAST_READY_ADMIN')


def commit(db):
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'ACCOUNT_CONFLICT') from None


def reserve(db, login, user):
    if db.get(LoginReservation, login):
        raise HTTPException(409, 'LOGIN_RESERVED')
    db.add(LoginReservation(login_normalized=login, user_id=user.id))


def create(db, actor, data):
    authorize(db, actor, data.reauth_token, 'create_user')
    login = normalize_login(data.login)
    if db.get(LoginReservation, login):
        raise HTTPException(409, 'LOGIN_RESERVED')
    values = data.model_dump(exclude={'reauth_token', 'login'})
    user = User(**values, login=login, login_normalized=login, credential_state='invited', auth_version=1)
    db.add(user)
    try:
        db.flush()
        reserve(db, login, user)
        sessions.event(db, 'user_created', user.id, actor.id)
        commit(db)
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'ACCOUNT_CONFLICT') from None
    return user


def update(db, actor, user_id, data):
    authorize(db, actor, data.reauth_token, 'update_user', user_id)
    user = sessions.lock_user(db, user_id)
    if not user:
        raise HTTPException(404, 'USER_NOT_FOUND')
    values = data.model_dump(exclude_unset=True, exclude={'reauth_token'})
    if 'login' in values or 'is_active' in values:
        raise HTTPException(422, 'USE_ACCOUNT_ACTION')
    role_id = values.get('role_id', user.role_id)
    role = db.get(Role, role_id) if role_id else None
    protect(db, actor, user, not role or role.admin_access != 'full')
    for key, value in values.items():
        setattr(user, key, value)
    sessions.invalidate(db, user, 'profile_changed')
    sessions.event(db, 'user_updated', user.id, actor.id)
    commit(db)
    return user


def action(db, actor, user_id, data, purpose):
    authorize(db, actor, data.reauth_token, purpose, user_id)
    user = sessions.lock_user(db, user_id)
    if not user:
        raise HTTPException(404, 'USER_NOT_FOUND')
    result = None
    reason = getattr(data, 'reason', None)
    if purpose == 'invitation':
        if not user.is_active or user.credential_state != 'invited':
            raise HTTPException(409, 'INVITATION_NOT_ALLOWED')
        sessions.invalidate(db, user, purpose)
        result = challenges.issue(db, user, 'invitation', settings.AUTH_INVITE_MINUTES, issuer=actor.id)
    elif purpose == 'password_reset':
        protect(db, actor, user, True)
        if not user.is_active or user.credential_state == 'invited':
            raise HTTPException(409, 'USE_INVITATION_OR_ENABLE_ACCOUNT')
        sessions.invalidate(db, user, purpose)
        user.credential_state = 'reset_required'
        result = challenges.issue(db, user, 'recovery', settings.AUTH_RECOVERY_MINUTES, issuer=actor.id)
    elif purpose == 'revoke_sessions':
        result = {'revoked': sessions.revoke(db, user.id, purpose)}
    elif purpose == 'change_login':
        login = normalize_login(data.login)
        if login != user.login_normalized:
            reserve(db, login, user)
            old = db.get(LoginReservation, user.login_normalized)
            if old:
                old.retired_at = sessions.now()
            user.login = user.login_normalized = login
            sessions.invalidate(db, user, purpose)
    elif purpose == 'access_state':
        protect(db, actor, user, not data.is_active)
        sessions.invalidate(db, user, purpose)
        user.is_active = data.is_active
    sessions.event(db, purpose, user.id, actor.id, reason=reason)
    commit(db)
    return result if result is not None else {'id': user.id, 'login': user.login, 'is_active': user.is_active, 'credential_state': user.credential_state}
