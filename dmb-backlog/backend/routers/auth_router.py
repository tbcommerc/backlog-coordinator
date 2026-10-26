"""
DMB Backlog - Auth Router
"""
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from datetime import datetime

from database import get_db
from models import User, AuthSession, AuthChallenge, SecurityEvent
from schemas import LoginRequest, TokenResponse, UserResponse
from auth import verify_password, create_access_token, get_current_user, get_request_review_access, is_customer_portal_only, get_task_action_scope, can_make_pip_decision
from rate_limit import get_rate_limiter, rate_limit_key
from refresh_sessions import issue_refresh_session, revoke_refresh_session, rotate_refresh_session, cleanup_expired_sessions
from config import settings

router = APIRouter()
REFRESH_COOKIE_NAME = "dmb_refresh"


def _require_trusted_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin and settings.DEBUG:
        return
    allowed = set(settings.AUTH_ORIGINS)
    if not origin or origin not in allowed:
        raise HTTPException(status_code=403, detail="Untrusted request origin")
    if not settings.DEBUG and not origin.lower().startswith("https://"):
        raise HTTPException(status_code=403, detail="HTTPS origin required")


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=not settings.DEBUG,
        samesite="strict",
        path="/api/v1/auth",
    )


@router.post("/login", response_model=TokenResponse)
async def login(request: Request, response: Response, login_data: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate user and return tokens"""
    _require_trusted_origin(request)
    from services.auth_limits import limit
    from services.credentials import normalize_login
    from services.auth_sessions import lock_user, new_session, event
    from starlette.concurrency import run_in_threadpool
    await limit("login-ip", request.client.host if request.client else "", settings.AUTH_LOGIN_IP_LIMIT, 60)
    try:
        normalized = normalize_login(login_data.login)
    except HTTPException:
        normalized = None
    await limit("login-account", normalized or "invalid-format", settings.AUTH_FAILURE_LIMIT, settings.AUTH_FAILURE_WINDOW, "peek")
    user = db.query(User).filter(User.login_normalized == normalized).first() if normalized else None
    original_hash = user.password_hash if user else None
    original_version = user.auth_version if user else None
    valid = await run_in_threadpool(verify_password, login_data.password, original_hash)
    from services.credentials import needs_rehash, hash_password
    replacement_hash = await run_in_threadpool(hash_password, login_data.password) if valid and needs_rehash(original_hash) else None
    if user:
        user = lock_user(db, user.id)
    if not user or not valid or not user.is_active or user.credential_state != "ready" or user.password_hash != original_hash or user.auth_version != original_version:
        await limit("login-account", normalized or "invalid-format", settings.AUTH_FAILURE_LIMIT, settings.AUTH_FAILURE_WINDOW)
        event(db, "login", subject=user.id if user else None, outcome="failure", reason="invalid_credentials")
        db.commit()
        raise HTTPException(401, "INVALID_CREDENTIALS")
    if replacement_hash:
        user.password_hash = replacement_hash
    from services.auth_sessions import now
    user.last_login = now()
    session = new_session(db, user, request)
    refresh_token, _ = issue_refresh_session(db, user, session)
    event(db, "login", user.id, user.id, session.id)
    db.commit()
    _set_refresh_cookie(response, refresh_token)
    access_token = create_access_token({"sub": str(user.id), "sid": session.id, "auth_version": user.auth_version})

    return TokenResponse(
        session_expires_at=session.absolute_expires_at,
        last_activity_at=session.last_activity_at,
        idle_timeout_seconds=60 * (settings.AUTH_ADMIN_IDLE_MINUTES if user.role and user.role.admin_access == 'full' else settings.AUTH_IDLE_MINUTES),
        access_token=access_token,
        expires_in=max(0, __import__("auth").decode_token(access_token)["exp"] - int(__import__("time").time())),
        user={
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "login": user.login_normalized,
            "role": user.role.name if user.role else None,
            "role_id": user.role_id,
            "team_id": user.team_id,
            "team_name": user.team_rel.name if user.team_rel else None,
            "can_edit": user.can_edit,
            "can_delete": user.can_delete,
            "can_export": user.can_export,
            "permissions": {
                "backlog_dmb": user.role.backlog_dmb_access if user.role else "none",
                "backlog_team": user.role.backlog_team_access if user.role else "none",
                "reports": user.role.reports_access if user.role else "none",
                "analytics": user.role.analytics_access if user.role else "none",
                "customer": user.role.customer_access if user.role else "none",
                "settings": user.role.settings_access if user.role else "none",
                "admin": user.role.admin_access if user.role else "none",
                "customer_portal_mode": "only" if is_customer_portal_only(user) else "standard",
                "review": get_request_review_access(user),
                "task_edit": get_task_action_scope(user, "edit"),
                "task_comment": get_task_action_scope(user, "comment"),
                "task_delete": get_task_action_scope(user, "delete"),
                "pip_decision": "available" if can_make_pip_decision(user) else "none",
            }
        }
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(request: Request, response: Response, db: Session = Depends(get_db)):
    """Refresh access token using refresh token"""
    _require_trusted_origin(request)
    from services.auth_limits import limit
    await limit("refresh-ip", request.client.host if request.client else "", settings.AUTH_REFRESH_IP_LIMIT, 60)
    current_refresh = request.cookies.get(REFRESH_COOKIE_NAME)
    if not current_refresh:
        raise HTTPException(status_code=401, detail="Refresh cookie not found")
    from auth import decode_token
    refresh_payload = decode_token(current_refresh)
    if refresh_payload:
        await limit("refresh-session", refresh_payload['sid'], 60, 60)
    user, refresh_token = rotate_refresh_session(db, current_refresh)
    _set_refresh_cookie(response, refresh_token)
    
    session = db.get(AuthSession, user._auth_sid)
    token_data = {"sub": str(user.id), "sid": user._auth_sid, "auth_version": user.auth_version}
    access_token = create_access_token(token_data)
    
    return TokenResponse(
        session_expires_at=session.absolute_expires_at,
        last_activity_at=session.last_activity_at,
        idle_timeout_seconds=60 * (settings.AUTH_ADMIN_IDLE_MINUTES if user.role and user.role.admin_access == 'full' else settings.AUTH_IDLE_MINUTES),
        access_token=access_token,
        expires_in=max(0, __import__("auth").decode_token(access_token)["exp"] - int(__import__("time").time())),
        user={
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "login": user.login_normalized,
            "role": user.role.name if user.role else None,
            "role_id": user.role_id,
            "team_id": user.team_id,
            "team_name": user.team_rel.name if user.team_rel else None,
            "can_edit": user.can_edit,
            "can_delete": user.can_delete,
            "can_export": user.can_export,
            "permissions": {
                "backlog_dmb": user.role.backlog_dmb_access if user.role else "none",
                "backlog_team": user.role.backlog_team_access if user.role else "none",
                "reports": user.role.reports_access if user.role else "none",
                "analytics": user.role.analytics_access if user.role else "none",
                "customer": user.role.customer_access if user.role else "none",
                "settings": user.role.settings_access if user.role else "none",
                "admin": user.role.admin_access if user.role else "none",
                "customer_portal_mode": "only" if is_customer_portal_only(user) else "standard",
                "review": get_request_review_access(user),
                "task_edit": get_task_action_scope(user, "edit"),
                "task_comment": get_task_action_scope(user, "comment"),
                "task_delete": get_task_action_scope(user, "delete"),
                "pip_decision": "available" if can_make_pip_decision(user) else "none",
            }
        }
    )


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Get current user profile"""
    return UserResponse(
        id=current_user.id,
        login=current_user.login_normalized,
        credential_state=current_user.credential_state,
        password_changed_at=current_user.password_changed_at,
        email=current_user.email,
        name=current_user.name,
        position=current_user.position,
        team_id=current_user.team_id,
        role_id=current_user.role_id,
        is_active=current_user.is_active,
        last_login=current_user.last_login,
        created_at=current_user.created_at,
        role_name=current_user.role.name if current_user.role else None,
        team_name=current_user.team_rel.name if current_user.team_rel else None,
        can_edit=current_user.can_edit,
        can_delete=current_user.can_delete,
        can_export=current_user.can_export,
        permissions={
            "backlog_dmb": current_user.role.backlog_dmb_access if current_user.role else "none",
            "backlog_team": current_user.role.backlog_team_access if current_user.role else "none",
            "reports": current_user.role.reports_access if current_user.role else "none",
            "analytics": current_user.role.analytics_access if current_user.role else "none",
            "customer": current_user.role.customer_access if current_user.role else "none",
            "settings": current_user.role.settings_access if current_user.role else "none",
            "admin": current_user.role.admin_access if current_user.role else "none",
            "customer_portal_mode": "only" if is_customer_portal_only(current_user) else "standard",
            "review": get_request_review_access(current_user),
            "task_edit": get_task_action_scope(current_user, "edit"),
            "task_comment": get_task_action_scope(current_user, "comment"),
            "task_delete": get_task_action_scope(current_user, "delete"),
            "pip_decision": "available" if can_make_pip_decision(current_user) else "none",
        },
    )


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    """Revoke the current server-side refresh session."""
    _require_trusted_origin(request)
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if refresh_token:
        revoke_refresh_session(db, refresh_token)
    authorization = request.headers.get("authorization", "")
    if authorization.startswith("Bearer "):
        revoke_refresh_session(db, authorization[7:])
    response.delete_cookie(REFRESH_COOKIE_NAME, path="/api/v1/auth", secure=not settings.DEBUG, httponly=True, samesite="strict")
    response.status_code = 204
    return None

# Password and self-service endpoints never accept identity/role/team fields.
from account_schemas import PasswordChange, PasswordSetup, Reauthenticate, Confirmation
from services import auth_sessions as sessions, auth_challenges as challenges, credentials
from services.auth_limits import sensitive_limit


def _current_locked(db, current_user):
    user = sessions.lock_user(db, current_user.id)
    sessions.check_session(db, user, current_user._auth_sid, current_user._auth_version)
    return user


@router.get('/password-policy')
def password_policy():
    return {'min_length': settings.AUTH_PASSWORD_MIN, 'max_length': settings.AUTH_PASSWORD_MAX,
        'normalization': 'NFC', 'support_contact': settings.AUTH_SUPPORT_CONTACT}


@router.post('/password/change', status_code=204, dependencies=[Depends(sensitive_limit)])
def password_change(data: PasswordChange, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    original = current_user.password_hash
    if not credentials.verify_password(data.current_password, original):
        sessions.event(db, 'password_change', current_user.id, current_user.id, outcome='failure', reason='invalid_password')
        db.commit()
        raise HTTPException(401, 'CURRENT_PASSWORD_INVALID')
    value = credentials.validate_password(data.new_password, current_user.login_normalized)
    if credentials.verify_password(value, original):
        raise HTTPException(422, 'PASSWORD_UNCHANGED')
    encoded = credentials.hash_password(value)
    user = _current_locked(db, current_user)
    if user.password_hash != original:
        raise HTTPException(401, 'SESSION_INVALID')
    sessions.invalidate(db, user, 'password_change')
    user.password_hash, user.password_changed_at = encoded, sessions.now()
    user.password_normalization_version = 1
    sessions.event(db, 'password_change', user.id, user.id)
    db.commit()


@router.post('/password/setup', status_code=204, dependencies=[Depends(sensitive_limit)])
def password_setup(data: PasswordSetup, db: Session = Depends(get_db)):
    row = db.query(AuthChallenge).filter(AuthChallenge.token_hash == challenges.digest(data.token)).first()
    if not row or row.purpose not in {'invitation', 'recovery'}:
        raise HTTPException(400, 'SETUP_TOKEN_INVALID')
    user = db.query(User).filter(User.id == row.user_id).first()
    if not user:
        raise HTTPException(400, 'SETUP_TOKEN_INVALID')
    expected = 'invited' if row.purpose == 'invitation' else 'reset_required'
    if (not user.is_active or user.credential_state != expected or row.auth_version != user.auth_version or
        row.used_at or row.revoked_at or sessions.utc(row.expires_at) <= sessions.now()):
        raise HTTPException(400, 'SETUP_TOKEN_INVALID')
    encoded = credentials.hash_password(credentials.validate_password(data.new_password, user.login_normalized or ''))
    user = sessions.lock_user(db, user.id)
    row = db.query(AuthChallenge).filter(AuthChallenge.id == row.id).populate_existing().with_for_update().first()
    expected = 'invited' if row.purpose == 'invitation' else 'reset_required'
    if (not user.is_active or user.credential_state != expected or row.auth_version != user.auth_version or
        row.used_at or row.revoked_at or sessions.utc(row.expires_at) <= sessions.now()):
        raise HTTPException(400, 'SETUP_TOKEN_INVALID')
    row.used_at = sessions.now()
    sessions.invalidate(db, user, 'password_setup')
    user.password_hash, user.password_changed_at = encoded, sessions.now()
    user.password_normalization_version, user.credential_state = 1, 'ready'
    sessions.event(db, 'password_setup', user.id, user.id)
    db.commit()


@router.post('/reauthenticate', dependencies=[Depends(sensitive_limit)])
def reauthenticate(data: Reauthenticate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    original = current_user.password_hash
    if not credentials.verify_password(data.password, original):
        sessions.event(db, 'reauthenticate', current_user.id, current_user.id, outcome='failure', reason='invalid_password')
        db.commit()
        raise HTTPException(401, 'CURRENT_PASSWORD_INVALID')
    user = _current_locked(db, current_user)
    if user.password_hash != original:
        raise HTTPException(401, 'SESSION_INVALID')
    if data.purpose != 'revoke_others' and (not user.role or user.role.admin_access != 'full'):
        raise HTTPException(403, 'FULL_ADMIN_REQUIRED')
    result = challenges.issue(db, user, 'reauth:'+data.purpose, settings.AUTH_REAUTH_MINUTES,
        session=current_user._auth_sid, target=data.target_user_id)
    db.commit()
    return result


@router.get('/sessions')
def own_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(AuthSession).filter(AuthSession.user_id == current_user.id, AuthSession.revoked_at.is_(None),
        AuthSession.absolute_expires_at > sessions.now()).order_by(AuthSession.created_at.desc()).all()
    return [{'id': r.id, 'created_at': r.created_at, 'last_activity_at': r.last_activity_at,
        'absolute_expires_at': r.absolute_expires_at, 'ip_address': r.ip_address,
        'client_label': r.client_label, 'is_current': r.id == current_user._auth_sid} for r in rows]


@router.delete('/sessions/{session_id}', status_code=204)
def revoke_own_session(session_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = _current_locked(db, current_user)
    row = db.query(AuthSession).filter(AuthSession.id == session_id, AuthSession.user_id == user.id).first()
    if not row:
        raise HTTPException(404, 'SESSION_NOT_FOUND')
    row.revoked_at, row.revoke_reason = sessions.now(), 'user_revoke'
    sessions.event(db, 'session_revoke', user.id, user.id, row.id)
    db.commit()


@router.post('/sessions/revoke-others', dependencies=[Depends(sensitive_limit)])
def revoke_others(data: Confirmation, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = _current_locked(db, current_user)
    challenges.consume(db, data.reauth_token, user, 'reauth:revoke_others', current_user._auth_sid)
    count = sessions.revoke(db, user.id, 'revoke_others', current_user._auth_sid)
    sessions.event(db, 'revoke_others', user.id, user.id)
    db.commit()
    return {'revoked': count}


from fastapi import Query
@router.get('/security-events')
def security_events(page: int = Query(1, ge=1), per_page: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(SecurityEvent).filter(SecurityEvent.subject_id == current_user.id).order_by(SecurityEvent.id.desc()).offset((page-1)*per_page).limit(per_page).all()
    return {'page': page, 'items': [{'id': r.id, 'created_at': r.created_at, 'action': r.action,
        'outcome': r.outcome, 'ip_address': r.ip_address} for r in rows]}
