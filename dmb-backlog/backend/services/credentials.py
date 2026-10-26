"""Password policy; no network, normalization is versioned and never trims."""
import re
import threading
import unicodedata
from argon2 import PasswordHasher, Type
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import HTTPException
from config import settings

_hasher = PasswordHasher(time_cost=settings.AUTH_ARGON_TIME_COST, memory_cost=settings.AUTH_ARGON_MEMORY_KIB, parallelism=settings.AUTH_ARGON_PARALLELISM, type=Type.ID)
_slots = threading.BoundedSemaphore(settings.AUTH_HASH_WORKERS)
_dummy = _hasher.hash('dummy verification only; never a credential')
_BLOCKLIST = {'passwordpassword', 'password123456789', '123456789012345', 'qwertyuiopasdfgh', 'парольпарольпароль', 'administrator123', 'dmb2026'}


def normalize_login(value):
    value = value.strip()
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._@-]{2,253}', value, flags=re.ASCII):
        raise HTTPException(422, 'LOGIN_FORMAT_INVALID')
    return value.lower()


def normalize_password(value):
    return unicodedata.normalize('NFC', value)


def validate_password(value, login=''):
    value = normalize_password(value)
    if not settings.AUTH_PASSWORD_MIN <= len(value) <= settings.AUTH_PASSWORD_MAX:
        raise HTTPException(422, 'PASSWORD_LENGTH_INVALID')
    if any(unicodedata.category(c).startswith('C') for c in value):
        raise HTTPException(422, 'PASSWORD_CONTROL_CHARACTER')
    if value.casefold() in _BLOCKLIST or value.casefold() == login.casefold():
        raise HTTPException(422, 'PASSWORD_TOO_COMMON')
    return value


def _bounded(fn, *args):
    if not _slots.acquire(blocking=False):
        raise HTTPException(503, 'PASSWORD_SERVICE_BUSY', headers={'Retry-After': '1'})
    try:
        return fn(*args)
    finally:
        _slots.release()


def hash_password(value):
    return _bounded(_hasher.hash, normalize_password(value))


def verify_password(value, encoded):
    # Explicit compatibility rollout preserves the exact pre-cutover bcrypt input.
    if settings.AUTH_ALLOW_LEGACY_PASSWORDS and encoded and encoded.startswith(('$2a$', '$2b$', '$2y$')):
        if len(value.encode('utf-8')) > 72:
            return False  # Never accept bcrypt's ambiguous truncated input.
        from passlib.hash import bcrypt
        try:
            return _bounded(bcrypt.verify, value, encoded)
        except (ValueError, TypeError):
            return False
    candidate = encoded if encoded and encoded.startswith('$argon2id$') else _dummy
    try:
        matched = _bounded(_hasher.verify, candidate, normalize_password(value))
        return bool(encoded and encoded.startswith('$argon2id$') and matched)
    except (VerificationError, InvalidHashError, ValueError):
        return False


def needs_rehash(encoded):
    if settings.AUTH_ALLOW_LEGACY_PASSWORDS and encoded.startswith(('$2a$', '$2b$', '$2y$')):
        return False  # Keep existing credentials until the user changes their password.
    return _hasher.check_needs_rehash(encoded)
