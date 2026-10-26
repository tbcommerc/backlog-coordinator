from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from app.api.errors import DomainError
from app.config import get_settings


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


class DmbAdapterClient:
    def _post(self, path: str, body: dict[str, Any], actor_envelope: str) -> dict[str, Any]:
        settings = get_settings()
        request = urllib.request.Request(
            f"{settings.DMB_ADAPTER_BASE_URL.rstrip('/')}{path}",
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "X-Assistant-V2-Service-Secret": settings.SERVICE_SECRET,
                "X-Actor-Envelope": actor_envelope,
            },
        )
        try:
            with _opener.open(request, timeout=settings.DMB_ADAPTER_TIMEOUT_SECONDS) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {}
            detail = payload.get("detail") if isinstance(payload, dict) else None
            raise DomainError(
                "dmb_adapter_rejected",
                "DMB adapter отклонил запрос.",
                exc.code,
                detail if isinstance(detail, dict) else {"reason": str(detail or "rejected")},
            ) from exc
        except OSError as exc:
            raise DomainError("dmb_adapter_unavailable", "DMB adapter временно недоступен.", 503) from exc

    def snapshot(self, object_type: str, object_id: str, actor_envelope: str) -> dict[str, Any]:
        return self._post("/snapshots", {"object_type": object_type, "object_id": object_id}, actor_envelope)

    def validate_diff(self, body: dict[str, Any], actor_envelope: str) -> dict[str, Any]:
        return self._post("/diffs/validate", body, actor_envelope)

    def prepare_apply_intent(self, body: dict[str, Any], actor_envelope: str) -> dict[str, Any]:
        return self._post("/apply-intents/prepare", body, actor_envelope)
