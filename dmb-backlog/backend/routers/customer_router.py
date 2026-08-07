from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import Optional
from pydantic import BaseModel, Field
import re

from database import get_db
from models import Task, User, Team
from schemas import TaskResponse, TaskListResponse
from auth import get_current_user
from routers.tasks_router import task_to_response
from notifications import notify_customer_task_created

router = APIRouter()


class ChatMessage(BaseModel):
    message: str = Field(max_length=5000)


class ChatResponse(BaseModel):
    success: bool
    task_id: Optional[int] = None
    response: str
    parsed_fields: dict


def parse_chat_message(message: str, user: User) -> dict:
    """Parse natural language message to extract task fields"""
    fields = {
        "title": "",
        "description": "",
        "priority": "Средний",
        "status": "Сбор требований",
        "task_type": "Функциональность"
    }

    lines = message.strip().split('\n')
    if not lines:
        return fields

    title = lines[0].strip()
    if len(title) > 255:
        title = title[:255]
    fields["title"] = title

    description = '\n'.join(lines[1:]).strip() if len(lines) > 1 else ""
    if len(description) > 10000:
        description = description[:10000]
    fields["description"] = description

    message_lower = message.lower()
    if any(word in message_lower for word in ["срочно", "высокий приоритет", "важно", "критично"]):
        fields["priority"] = "Высокий"
    elif any(word in message_lower for word in ["низкий приоритет", "не срочно", "можно позже"]):
        fields["priority"] = "Низкий"

    if any(word in message_lower for word in ["баг", "ошибка", "bug", "исправить"]):
        fields["task_type"] = "Bug"
    elif any(word in message_lower for word in ["техдолг", "рефакторинг", "оптимизация"]):
        fields["task_type"] = "Техдолг"
    elif any(word in message_lower for word in ["исследование", "анализ", "research"]):
        fields["task_type"] = "Исследование"

    return fields


@router.get("/tasks", response_model=TaskListResponse)
async def get_customer_tasks(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get tasks created by current user (business customer)"""
    query = db.query(Task).filter(
        Task.is_deleted == False,
        Task.created_by == current_user.id
    )

    total = query.count()
    tasks = query.order_by(desc(Task.created_at)).offset((page - 1) * per_page).limit(per_page).all()

    items = [task_to_response(task, db) for task in tasks]

    return TaskListResponse(
        items=items,
        total=total,
        page=page,
        per_page=per_page
    )


@router.post("/chat", response_model=ChatResponse)
async def create_task_from_chat(
    message: ChatMessage,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a task from natural language message"""
    if not message.message.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Сообщение не может быть пустым"
        )

    parsed = parse_chat_message(message.message, current_user)

    if not parsed["title"]:
        return ChatResponse(
            success=False,
            response="Не удалось определить название задачи. Пожалуйста, начните сообщение с названия.",
            parsed_fields=parsed
        )

    team = db.query(Team).first()
    if not team:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не найдена команда по умолчанию"
        )

    task = Task(
        team_id=team.id,
        title=parsed["title"],
        description=parsed["description"],
        priority=parsed["priority"],
        status=parsed["status"],
        task_type=parsed["task_type"],
        created_by=current_user.id
    )

    db.add(task)
    db.commit()
    db.refresh(task)

    # Notifications: customer task created
    notify_customer_task_created(db, task, current_user.name)
    db.commit()

    response_text = f"Задача создана: #{task.id} - {task.title}\n"
    response_text += f"Приоритет: {task.priority}\n"
    response_text += f"Тип: {task.task_type}\n"
    if task.description:
        response_text += f"Описание: {task.description[:100]}..."

    return ChatResponse(
        success=True,
        task_id=task.id,
        response=response_text,
        parsed_fields=parsed
    )
