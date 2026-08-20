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
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        if request.method in ["POST", "PUT", "DELETE", "PATCH"]:
            if "/api/" in request.url.path:
                await self._safe_log_action(request, response)
        
        return response
    
    async def _safe_log_action(self, request: Request, response: Response):
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
            
            path_parts = request.url.path.split("/")
            entity_type = "unknown"
            entity_id = None
            
            if len(path_parts) >= 4:
                entity_type = path_parts[3]
                if len(path_parts) >= 5 and path_parts[4].isdigit():
                    entity_id = int(path_parts[4])
            
            audit_entry = AuditLog(
                user_id=int(user_id) if user_id else None,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                details=json.dumps({
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code
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
