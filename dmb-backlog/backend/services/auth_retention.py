"""Explicit retention job; does not change users, roles or team assignments."""
from datetime import timedelta
from sqlalchemy import exists
from models import SecurityEvent, RefreshSession, AuthChallenge, AuthSession
from config import settings
from services.auth_sessions import now, event


def prune(db):
    cutoff = now() - timedelta(days=settings.AUTH_SESSION_RETENTION_DAYS)
    counts = {}
    counts['events'] = db.query(SecurityEvent).filter(SecurityEvent.created_at < now()-timedelta(days=settings.AUTH_EVENTS_RETENTION_DAYS)).delete(synchronize_session=False)
    # Keep every refresh hash through the absolute family expiry plus one day.
    counts['refresh'] = db.query(RefreshSession).filter(RefreshSession.expires_at < now()-timedelta(days=1)).delete(synchronize_session=False)
    counts['challenges'] = db.query(AuthChallenge).filter(AuthChallenge.expires_at < cutoff).delete(synchronize_session=False)
    counts['sessions'] = db.query(AuthSession).filter(AuthSession.absolute_expires_at < cutoff,
        ~exists().where(RefreshSession.auth_session_id == AuthSession.id),
        ~exists().where(AuthChallenge.session_id == AuthSession.id)).delete(synchronize_session=False)
    event(db, 'security_retention')
    db.commit()
    return counts
