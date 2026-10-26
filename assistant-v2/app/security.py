from __future__ import annotations

import threading
import time
from typing import Any

from fastapi import Security
from fastapi.security import APIKeyHeader
from jose import JWTError, jwt
from pydantic import BaseModel, ConfigDict, Field

from .api.errors import DomainError
from .config import get_settings


class ActorContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    issuer: str
    user_id: str
    team_id: str | None = None
    roles: list[str] = Field(default_factory=list)
    permissions: dict[str, Any] = Field(default_factory=dict)
    pilot_allowed: bool
    purpose: str | None = None
    request_id: str
    trace_id: str
    jti: str
    raw_envelope: str = Field(exclude=True)

    def audit_snapshot(self) -> dict[str, Any]:
        return {"type": "dmb_user", "id": self.user_id, "team_id": self.team_id}


_seen_jti: dict[str, int] = {}
_seen_lock = threading.Lock()
actor_envelope_scheme = APIKeyHeader(
    name="X-Actor-Envelope",
    scheme_name="DmbActorEnvelope",
    description="Короткоживущий signed envelope, выпускаемый только DMB gateway.",
    auto_error=False,
)


def reset_replay_cache() -> None:
    with _seen_lock:
        _seen_jti.clear()


def _consume_jti(jti: str, exp: int) -> None:
    now = int(time.time())
    with _seen_lock:
        for key, expiry in list(_seen_jti.items()):
            if expiry <= now:
                _seen_jti.pop(key, None)
        if jti in _seen_jti:
            raise DomainError("actor_envelope_replayed", "Actor envelope уже использован.", 401)
        _seen_jti[jti] = exp


def decode_actor_envelope(token: str, *, consume: bool = True) -> ActorContext:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.ENVELOPE_SECRET,
            algorithms=[settings.ENVELOPE_ALGORITHM],
            audience=settings.ENVELOPE_AUDIENCE,
            issuer=settings.ENVELOPE_ISSUER,
        )
    except JWTError as exc:
        raise DomainError("invalid_actor_envelope", "Недействительный actor envelope.", 401) from exc
    required = ("user_id", "pilot_allowed", "request_id", "trace_id", "jti", "exp")
    if any(payload.get(name) is None for name in required):
        raise DomainError("invalid_actor_envelope", "Actor envelope не содержит обязательные claims.", 401)
    if consume:
        _consume_jti(str(payload["jti"]), int(payload["exp"]))
    if payload.get("pilot_allowed") is not True:
        raise DomainError("pilot_not_allowed", "Пользователь не включён в пилот Assistant V2.", 403)
    return ActorContext(
        issuer=str(payload.get("iss")),
        user_id=str(payload["user_id"]),
        team_id=str(payload["team_id"]) if payload.get("team_id") is not None else None,
        roles=[str(value) for value in payload.get("roles") or []],
        permissions=dict(payload.get("permissions") or {}),
        pilot_allowed=True,
        purpose=payload.get("purpose"),
        request_id=str(payload["request_id"]),
        trace_id=str(payload["trace_id"]),
        jti=str(payload["jti"]),
        raw_envelope=token,
    )


def get_actor(x_actor_envelope: str | None = Security(actor_envelope_scheme)) -> ActorContext:
    settings = get_settings()
    if not settings.ENABLED:
        raise DomainError("assistant_v2_disabled", "Assistant V2 выключен.", 503)
    if not x_actor_envelope:
        raise DomainError("actor_envelope_required", "Требуется actor envelope от DMB gateway.", 401)
    return decode_actor_envelope(x_actor_envelope)
