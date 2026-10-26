from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.orm.exc import StaleDataError


class DomainError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 422, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


def error_payload(request: Request, *, code: str, message: str, details: Any = None, retryable: bool = False) -> dict:
    return {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
            "request_id": getattr(request.state, "request_id", "unknown"),
            "trace_id": getattr(request.state, "trace_id", "unknown"),
            "retryable": retryable,
        }
    }


async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_payload(
            request,
            code=exc.code,
            message=exc.message,
            details=exc.details,
            retryable=exc.status_code in {409, 429, 502, 503, 504},
        ),
    )


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    bounded = [
        {"loc": list(error.get("loc", ())), "type": error.get("type"), "message": error.get("msg")}
        for error in exc.errors()[:20]
    ]
    return JSONResponse(
        status_code=422,
        content=error_payload(request, code="validation_error", message="Запрос не прошёл валидацию.", details={"errors": bounded}),
    )


async def stale_data_error_handler(request: Request, _: StaleDataError) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content=error_payload(
            request,
            code="version_conflict",
            message="Объект был изменён параллельно. Обновите данные и повторите действие.",
            details={"refresh_required": True},
            retryable=True,
        ),
    )
