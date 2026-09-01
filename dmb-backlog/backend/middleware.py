"""
DMB Backlog - Middleware (Logging, Audit, CORS)
"""
import time
import logging
import sys
import uuid
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from audit_context import begin_audit_request, current_audit_request, end_audit_request
from metrics import inc_counter, observe_histogram
from telemetry import current_trace_id

import os
_log_dir = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(_log_dir, exist_ok=True)


def _utf8_stream_handler():
    if hasattr(sys.stderr, "reconfigure"):
        try:
            sys.stderr.reconfigure(encoding="utf-8")
        except Exception:
            pass
    return logging.StreamHandler()


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(_log_dir, "app.log"), encoding="utf-8"),
        _utf8_stream_handler()
    ],
    force=True
)
logger = logging.getLogger("dmb_backlog")


class LoggingMiddleware(BaseHTTPMiddleware):
    """Log all requests with timing"""
    
    async def dispatch(self, request: Request, call_next):
        start_time = time.time()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            duration_seconds = time.time() - start_time
            route = getattr(request.scope.get("route"), "path", request.url.path)
            labels = {
                "method": request.method,
                "route": route,
                "status": status_code,
            }
            inc_counter("dmb_http_requests_total", labels=labels)
            observe_histogram("dmb_http_request_duration_seconds", duration_seconds, {
                "method": request.method,
                "route": route,
            })
            if status_code in {409, 423}:
                inc_counter("dmb_concurrency_responses_total", labels={"status": status_code, "route": route})
            logger.info(
                "%s %s - Status: %s - Duration: %.2fms - IP: %s - Request-ID: %s - Trace-ID: %s",
                request.method,
                request.url.path,
                status_code,
                duration_seconds * 1000,
                request.client.host if request.client else "-",
                current_audit_request().request_id if current_audit_request() else "-",
                current_trace_id() or "-",
            )


class AuditMiddleware(BaseHTTPMiddleware):
    """Attach actor/request metadata to transaction-bound SQLAlchemy audit."""

    async def dispatch(self, request: Request, call_next):
        request_id = (request.headers.get("x-request-id") or uuid.uuid4().hex)[:64]
        user_id = None
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                from auth import decode_token
                payload = decode_token(auth_header[7:])
                if payload and payload.get("sub") is not None:
                    user_id = int(payload["sub"])
            except (TypeError, ValueError):
                user_id = None
        token = begin_audit_request(
            request_id=request_id,
            trace_id=current_trace_id(),
            user_id=user_id,
            method=request.method,
            path=request.url.path,
            ip_address=request.client.host if request.client else None,
        )
        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = request_id
            trace_id = current_trace_id()
            if trace_id:
                response.headers["X-Trace-ID"] = trace_id
            return response
        finally:
            end_audit_request(token)
