"""One-use setup/reauth challenges; consumption shares the lifecycle transaction."""
import hashlib
import secrets
import uuid
from datetime import timedelta
from fastapi import HTTPException
from models import AuthChallenge
from services.auth_sessions import now, utc
from config import settings

PURPOSES = {'create_user', 'update_user', 'invitation', 'password_reset', 'revoke_sessions', 'change_login', 'access_state', 'revoke_others', 'update_role'}


def digest(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def issue(db, user, purpose, minutes, issuer=None, session=None, target=None):
    token = secrets.token_urlsafe(32)
    row = AuthChallenge(id=str(uuid.uuid4()), user_id=user.id, issuer_id=issuer,
        purpose=purpose, token_hash=digest(token), auth_version=user.auth_version,
        expires_at=now()+timedelta(minutes=minutes), session_id=session, target_user_id=target)
    db.add(row)
    db.flush()
    return {'token': token, 'expires_at': row.expires_at, 'operation_id': row.id}


def consume(db, token, user, purpose, session=None, target=None):
    row = db.query(AuthChallenge).filter(AuthChallenge.token_hash == digest(token)).with_for_update().first()
    if (not row or row.user_id != user.id or row.purpose != purpose or row.auth_version != user.auth_version or
        row.used_at or row.revoked_at or utc(row.expires_at) <= now() or row.session_id != session or row.target_user_id != target):
        raise HTTPException(401, 'CONFIRMATION_INVALID')
    row.used_at = now()
    return row
