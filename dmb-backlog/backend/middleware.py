"""
DMB Backlog - Middleware (Logging, Audit, CORS)
"""
import time
import json
import logging
import sys
from datetime import datetime
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.orm import Session
from models import AuditLog
from database import SessionLocal

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
        
        response = await call_next(request)
        
        duration = round((time.time() - start_time) * 1000, 2)
        
        logger.info(
            f"{request.method} {request.url.path} - "
            f"Status: {response.status_code} - "
            f"Duration: {duration}ms - "
            f"IP: {request.client.host if request.client else '-'}"
        )
        
        return response


class AuditMiddleware(BaseHTTPMiddleware):
    """Record write operations to audit log"""

    _SENSITIVE_FIELDS = {"password", "password_hash", "token", "access_token", "refresh_token", "secret", "authorization"}
    
    async def dispatch(self, request: Request, call_next):
        changed_fields = []
        if request.method in ["POST", "PUT", "DELETE", "PATCH"] and "/api/" in request.url.path:
            try:
                payload = json.loads((await request.body()).decode("utf-8") or "{}")
                if isinstance(payload, dict):
                    changed_fields = sorted(key for key in payload if key.lower() not in self._SENSITIVE_FIELDS)
            except (UnicodeDecodeError, json.JSONDecodeError):
                changed_fields = []
        response = await call_next(request)
        
        if request.method in ["POST", "PUT", "DELETE", "PATCH"]:
            if "/api/" in request.url.path:
                await self._safe_log_action(request, response, changed_fields)
        
        return response
    
    async def _safe_log_action(self, request: Request, response: Response, changed_fields=None):
        """Log action with retry logic"""
        db = None
        try:
            db = SessionLocal()
            
            user_id = None
            auth_header = request.headers.get("authorization", "")
            if auth_header.startswith("Bearer "):
                from auth import decode_token
                payload = decode_token(auth_header[7:])
                if payload:
                    user_id = payload.get("sub")
            
            action_map = {
                "POST": "create",
                "PUT": "update",
                "PATCH": "update",
                "DELETE": "delete"
            }
            action = action_map.get(request.method, request.method)
            
            path_parts = [part for part in request.url.path.split("/") if part]
            entity_type = "unknown"
            entity_id = None
            try:
                api_index = path_parts.index("api")
                resource_index = api_index + 2
                if len(path_parts) > resource_index and path_parts[resource_index] == "admin":
                    resource_index += 1
                if len(path_parts) > resource_index:
                    entity_type = path_parts[resource_index]
                if len(path_parts) > resource_index + 1 and path_parts[resource_index + 1].isdigit():
                    entity_id = int(path_parts[resource_index + 1])
            except ValueError:
                pass
            
            audit_entry = AuditLog(
                user_id=int(user_id) if user_id else None,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                details=json.dumps({
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "success": 200 <= response.status_code < 400,
                    "failure_reason": None if response.status_code < 400 else f"HTTP {response.status_code}",
                    "changed_fields": changed_fields or [],
                }),
                ip_address=request.client.host if request.client else None,
                created_at=datetime.utcnow()
            )
            
            db.add(audit_entry)
            db.commit()
            
        except Exception:
            logger.exception("Failed to write audit log")
            if db:
                try:
                    db.rollback()
                except Exception:
                    logger.exception("Failed to roll back audit transaction")
        finally:
            if db:
                try:
                    db.close()
                except Exception:
                    logger.exception("Failed to close audit database session")
