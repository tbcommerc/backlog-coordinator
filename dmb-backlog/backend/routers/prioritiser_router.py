"""Integration with the task prioritisation and financial effect agent."""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth import authorize_task, get_current_user
from config import settings
from database import get_db
from metrics import inc_counter, observe_histogram
from models import Task, Team, User
from routers.tasks_router import update_task
from schemas import TaskResponse, TaskUpdate


logger = logging.getLogger("dmb_backlog.prioritiser")
router = APIRouter()


class PrioritiserRunRequest(BaseModel):
    version: int = Field(ge=0)


class PrioritiserValueProposal(BaseModel):
    value_mln: float = Field(ge=0)
    justification: str
    version: int = Field(ge=0)


class PrioritiserValueApproval(BaseModel):
    version: int = Field(ge=0)
    value_mln: float = Field(ge=0)
    justification: str = Field(min_length=1, max_length=10000)


def _number(value: Decimal | float | int | None) -> float | None:
    return None if value is None else float(value)


def _task_payload(task: Task, db: Session) -> dict:
    involved_ids = [team_id for team_id in (task.involved_teams or []) if isinstance(team_id, int)]
    involved_names = []
    if involved_ids:
        names_by_id = {
            team.id: team.name
            for team in db.query(Team).filter(Team.id.in_(involved_ids)).all()
        }
        involved_names = [names_by_id.get(team_id, str(team_id)) for team_id in involved_ids]
    return {
        "task_id": task.public_id or str(task.id),
        "task_type": task.task_type.name if task.task_type else "",
        "team": task.team.name if task.team else "",
        "title": task.title,
        "description": task.description or None,
        "created_date": task.date_received.isoformat() if task.date_received else None,
        "customer_division": task.department.name if task.department else None,
        "project": task.project.name if task.project else None,
        "deadline": task.deadline.name if task.deadline else None,
        "involved_teams": ", ".join(involved_names) or None,
        "effort_man_days": _number(task.effort_days),
        "business_customer": (
            task.business_customer_rel.name if task.business_customer_rel else None
        ),
        # A human-entered Value is truth for the prioritiser. A previous AI
        # estimate is deliberately not promoted to a manual value.
        "value_internal_mln": _number(task.financial_effect),
    }


def _call_prioritiser(path: str, payload: dict) -> dict:
    url = f"{settings.PRIORITISER_BASE_URL.rstrip('/')}{path}"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    started_at = time.monotonic()
    outcome = "success"
    try:
        with urllib.request.urlopen(request, timeout=settings.PRIORITISER_TIMEOUT_SECONDS) as response:
            result = json.loads(response.read().decode("utf-8"))
            if not isinstance(result, dict):
                raise ValueError("prioritiser response is not an object")
            return result
    except urllib.error.HTTPError as error:
        outcome = f"http_{error.code}"
        body = error.read().decode("utf-8", errors="replace")[:1000]
        logger.error("prioritiser POST %s -> %s: %s", path, error.code, body)
        raise HTTPException(status_code=502, detail=f"Агент приоритизации недоступен ({error.code})")
    except (OSError, TimeoutError, UnicodeError, json.JSONDecodeError, ValueError):
        outcome = "transport_error"
        logger.exception("prioritiser POST %s failed", path)
        raise HTTPException(status_code=502, detail="Сервис приоритизации недоступен")
    finally:
        labels = {"path": path, "outcome": outcome}
        inc_counter("dmb_prioritiser_requests_total", labels=labels)
        observe_histogram(
            "dmb_prioritiser_request_duration_seconds",
            time.monotonic() - started_at,
            labels=labels,
        )


def _load_task(task_id: int, db: Session, current_user: User) -> Task:
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted.is_(False)).first()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    authorize_task("edit", task, current_user)
    return task


def _raise_agent_error(result: dict) -> None:
    if result.get("status") not in {"insufficient_data", "error"}:
        return
    detail = {
        "code": f"prioritiser_{result.get('status')}",
        "message": result.get("error") or "Агент не смог выполнить расчёт",
        "missing_attributes": result.get("missing_attributes") or [],
    }
    raise HTTPException(status_code=422 if result.get("status") == "insufficient_data" else 502, detail=detail)


def _value_justification(value: dict, warnings: list[str]) -> str:
    parts = [str(value.get("explanation") or "").strip()]
    range_data = value.get("range") or {}
    if range_data.get("text"):
        parts.append(f"Диапазон оценки: {range_data['text']}.")
    confidence = value.get("confidence")
    if confidence:
        parts.append(f"Уверенность: {confidence}.")
    if warnings:
        parts.append("Предупреждения: " + "; ".join(map(str, warnings)) + ".")
    return "\n\n".join(part for part in parts if part)


@router.post("/{task_id}/prioritiser/value", response_model=PrioritiserValueProposal)
def calculate_task_value(
    task_id: int,
    body: PrioritiserRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = _load_task(task_id, db, current_user)
    result = _call_prioritiser(
        "/agent/value/full",
        {"request_type": "value", "task": _task_payload(task, db)},
    )
    _raise_agent_error(result)
    value = result.get("value") or {}
    value_mln = value.get("value_mln")
    if value_mln is None:
        raise HTTPException(status_code=422, detail="Агент не вернул финансовый эффект")
    return PrioritiserValueProposal(
        value_mln=float(value_mln),
        justification=_value_justification(value, result.get("warnings") or []),
        version=body.version,
    )


@router.post("/{task_id}/prioritiser/value/approve", response_model=TaskResponse)
def approve_task_value(
    task_id: int,
    body: PrioritiserValueApproval,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _load_task(task_id, db, current_user)
    return update_task(
        task_id,
        TaskUpdate(
            version=body.version,
            financial_effect=body.value_mln,
            financial_effect_justification=body.justification,
        ),
        db,
        current_user,
    )


@router.post("/{task_id}/prioritiser/priority", response_model=TaskResponse)
def calculate_task_priority(
    task_id: int,
    body: PrioritiserRunRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = _load_task(task_id, db, current_user)
    result = _call_prioritiser(
        "/agent/priority/full",
        {"request_type": "priority", "task": _task_payload(task, db)},
    )
    _raise_agent_error(result)
    priority = result.get("priority") or {}
    raw_score = priority.get("score")
    if raw_score is None:
        raise HTTPException(status_code=422, detail="Агент не вернул приоритет")

    score = max(0, min(100, round(float(raw_score) * 100)))
    rationale = str(priority.get("rationale") or "").strip()
    label = priority.get("priority")
    justification = f"Приоритет {label}; итоговый скор {score}/100."
    if rationale:
        justification += f"\n\n{rationale}"
    warnings = result.get("warnings") or []
    if warnings:
        justification += "\n\nПредупреждения: " + "; ".join(map(str, warnings)) + "."

    changes = {
        "version": body.version,
        "priority_score": score,
        "priority_justification": justification,
    }
    return update_task(task_id, TaskUpdate(**changes), db, current_user)
