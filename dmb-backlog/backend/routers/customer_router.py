from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from database import get_db
from models import Task, User
from schemas import TaskListResponse
from auth import get_current_user
from routers.tasks_router import task_to_response

router = APIRouter()


@router.get("/tasks", response_model=TaskListResponse)
def get_customer_tasks(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Получить только задачи связанного с пользователем бизнес-заказчика."""
    if current_user.business_customer_id is None:
        return TaskListResponse(items=[], total=0, page=page, per_page=per_page, pages=0)

    query = db.query(Task).filter(
        Task.is_deleted == False,
        Task.business_customer_id == current_user.business_customer_id
    )

    total = query.count()
    tasks = query.order_by(desc(Task.created_at)).offset((page - 1) * per_page).limit(per_page).all()

    items = [task_to_response(task, db) for task in tasks]

    return TaskListResponse(
        items=items,
        total=total,
        page=page,
        per_page=per_page,
        pages=(total + per_page - 1) // per_page,
    )
