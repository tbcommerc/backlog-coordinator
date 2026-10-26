from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import Literal
from services.customer_queue import QueueResponse, queue_page
from database import get_db
from models import RequirementRequest, Task, User
from schemas import CustomerTaskListResponse, CustomerTaskResponse
from auth import get_current_user
from services.backlog_assistant_integration.policy import customer_tasks_clause, customer_task_allowed

router = APIRouter()


def _task_to_customer_response(task: Task) -> CustomerTaskResponse:
    """Build the explicit customer-safe task projection used by list and detail."""
    return CustomerTaskResponse(
        id=task.id,
        public_id=task.public_id,
        title=task.title,
        description=task.description,
        progress=task.progress if task.progress is not None else 0,
        created_at=task.created_at,
        updated_at=task.updated_at,
        team_name=task.team.name if task.team else None,
        status_name=task.status.name if task.status else None,
        deadline_name=task.deadline.name if task.deadline else None,
    )


@router.get("/tasks", response_model=CustomerTaskListResponse)
def get_customer_tasks(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Получить только задачи связанного с пользователем бизнес-заказчика."""
    if current_user.business_customer_id is None:
        return CustomerTaskListResponse(items=[], total=0, page=page, per_page=per_page, pages=0)

    query = db.query(Task).filter(
        Task.is_deleted == False,
        customer_tasks_clause(current_user)
    )

    total = query.count()
    tasks = query.order_by(desc(Task.created_at)).offset((page - 1) * per_page).limit(per_page).all()

    items = [_task_to_customer_response(task) for task in tasks]

    return CustomerTaskListResponse(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )


@router.get("/tasks/{task_id}", response_model=CustomerTaskResponse)
def get_customer_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Получить одну задачу только в области текущего бизнес-заказчика."""
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.is_deleted == False,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Задача не найдена")

    if not customer_task_allowed(db, current_user, task):
        raise HTTPException(status_code=404, detail="Задача не найдена")
    return _task_to_customer_response(task)


@router.get("/queue", response_model=QueueResponse)
def get_customer_queue(
    q: str = Query("", max_length=200),
    group: Literal["", "action", "draft", "review", "work", "complete"] = "",
    sort: Literal["newest", "oldest"] = "newest",
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Customer-safe unified queue; no writes or lifecycle synchronization."""
    from routers.agent_router import agent_sessions
    warnings = []
    try:
        sessions = agent_sessions(db=db, current_user=current_user).get("sessions") or []
    except HTTPException:
        sessions = []
        warnings.append("Черновики ассистента временно недоступны.")
    return queue_page(db, current_user, sessions, q=q.strip(), group=group, sort=sort,
        page=page, per_page=per_page, warnings=warnings)


@router.get("/requests/{request_id}/events")
def get_customer_request_events(request_id: int, db: Session = Depends(get_db),
                                current_user: User = Depends(get_current_user)):
    from services.customer_events import request_events
    exists = db.query(RequirementRequest.id).filter(RequirementRequest.id == request_id,
        RequirementRequest.user_id == current_user.id,
        RequirementRequest.is_deleted.is_(False)).first()
    if not exists:
        raise HTTPException(404, "Запрос не найден")
    return request_events(db, current_user.id, request_id)
