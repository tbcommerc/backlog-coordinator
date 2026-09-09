"""
DMB Backlog - Express Estimate Router (Экспресс-оценка)
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.exc import StaleDataError
from typing import Optional, List

from database import get_db
from models import Task, Epic, Story, TaskStatus, TaskHistory, User
from schemas import (
    EpicCreate, EpicUpdate, EpicResponse, EpicListResponse,
    StoryCreate, StoryUpdate, StoryResponse, StoryListResponse,
    SortRequest,
    TaskVersionRequest, TaskVersionsRequest,
    QuickEstimateTaskResponse, QuickEstimateResponse,
    TaskResponse, SuccessResponse
)
from auth import get_current_user, check_permission, authorize_task
from services.task_metrics import calculate_cost_value_ratio

router = APIRouter()

EFFORT_FIELDS = ['effort_designee', 'effort_analytics', 'effort_be', 'effort_python_be', 'effort_fe', 'effort_test', 'effort_test_auto', 'effort_delivery']


def _assert_task_version(task: Task, submitted_version: int) -> None:
    if submitted_version != (task.version or 0):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Задача была изменена другим пользователем.",
                "current_version": task.version or 0,
                "submitted_version": submitted_version,
            },
        )


def _commit_task_change(db: Session, task_id: int, submitted_version: int) -> None:
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        current = db.query(Task).filter(Task.id == task_id).first()
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Задача изменилась во время выполнения операции.",
                "current_version": (current.version or 0) if current else None,
                "submitted_version": submitted_version,
            },
        )

# ==================== Helper ====================

def _task_for_epic(db: Session, epic: Epic) -> Task:
    task = db.query(Task).filter(Task.id == epic.task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Parent task not found")
    return task


def _task_for_story(db: Session, story: Story) -> Task:
    epic = db.query(Epic).filter(Epic.id == story.epic_id).first()
    if not epic:
        raise HTTPException(status_code=404, detail="Parent epic not found")
    return _task_for_epic(db, epic)

def epic_to_response(epic: Epic) -> EpicResponse:
    stories = getattr(epic, '_stories', [])
    return EpicResponse(
        id=epic.id,
        task_id=epic.task_id,
        title=epic.title,
        description=epic.description,
        priority=epic.priority,
        effort_designee=epic.effort_designee,
        effort_analytics=epic.effort_analytics,
        effort_be=epic.effort_be,
        effort_python_be=epic.effort_python_be,
        effort_fe=epic.effort_fe,
        effort_test=epic.effort_test,
        effort_test_auto=epic.effort_test_auto,
        effort_delivery=epic.effort_delivery,
        stories=[story_to_response(s) for s in stories],
        created_at=epic.created_at,
        updated_at=epic.updated_at,
    )


def story_to_response(story: Story) -> StoryResponse:
    return StoryResponse(
        id=story.id,
        epic_id=story.epic_id,
        title=story.title,
        description=story.description,
        effort_designee=story.effort_designee,
        effort_analytics=story.effort_analytics,
        effort_be=story.effort_be,
        effort_python_be=story.effort_python_be,
        effort_fe=story.effort_fe,
        effort_test=story.effort_test,
        effort_test_auto=story.effort_test_auto,
        effort_delivery=story.effort_delivery,
        created_at=story.created_at,
        updated_at=story.updated_at,
    )


def task_to_quick_estimate_response(task: Task, epics: list[Epic]) -> QuickEstimateTaskResponse:
    from schemas import TaskResponse
    # Build base TaskResponse
    cv = calculate_cost_value_ratio(task.effort_rub, task.financial_effect)

    return QuickEstimateTaskResponse(
        id=task.id,
        public_id=task.public_id,
        team_id=task.team_id,
        title=task.title,
        description=task.description,
        date_received=task.date_received,
        channel_id=task.channel_id,
        business_customer_id=task.business_customer_id,
        department_id=task.department_id,
        project_id=task.project_id,
        task_type_id=task.task_type_id,
        involved_teams=task.involved_teams,
        priority_id=task.priority_id,
        status_id=task.status_id,
        deadline_id=task.deadline_id,
        effort_days=task.effort_days,
        effort_rub=task.effort_rub,
        effort_designee=task.effort_designee,
        effort_analytics=task.effort_analytics,
        effort_be=task.effort_be,
        effort_python_be=task.effort_python_be,
        effort_fe=task.effort_fe,
        effort_test=task.effort_test,
        effort_test_auto=task.effort_test_auto,
        effort_delivery=task.effort_delivery,
        financial_effect=task.financial_effect,
        # Legacy tasks may still have NULL despite the current API contract.
        # Keep one such row from breaking the whole quick-estimate response.
        progress=task.progress if task.progress is not None else 0,
        link_mockups=task.link_mockups,
        link_jira=task.link_jira,
        rejection_reason=task.rejection_reason,
        comment=task.comment,
        owner_id=task.owner_id,
        key_project_status=task.key_project_status,
        directorate_status=task.directorate_status,
        did_status=task.did_status,
        cv=cv,
        created_by=task.created_by,
        created_at=task.created_at,
        updated_at=task.updated_at,
        version=task.version or 0,
        team_name=task.team.name if task.team else None,
        channel_name=task.channel.name if task.channel else None,
        department_name=task.department.name if task.department else None,
        project_name=task.project.name if task.project else None,
        priority_name=task.priority.name if task.priority else None,
        status_name=task.status.name if task.status else None,
        deadline_name=task.deadline.name if task.deadline else None,
        owner_name=task.owner.name if task.owner else None,
        business_customer_name=task.business_customer_rel.name if task.business_customer_rel else None,
        epics=[epic_to_response(e) for e in epics],
    )


# ==================== GET Quick Estimate Data ====================

@router.get("/quick-estimate", response_model=QuickEstimateResponse)
def get_quick_estimate(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get all tasks in 'ЭКСПРЕСС-ОЦЕНКА' status for the user's team, with epics and stories."""
    team_id = current_user.team_id
    if not team_id:
        raise HTTPException(status_code=400, detail="User has no team assigned")

    # Find the status id for "ЭКСПРЕСС-ОЦЕНКА"
    status_obj = db.query(TaskStatus).filter(TaskStatus.name == "ЭКСПРЕСС-ОЦЕНКА").first()
    if not status_obj:
        raise HTTPException(status_code=500, detail="Status 'ЭКСПРЕСС-ОЦЕНКА' not found")

    # Get tasks
    tasks = db.query(Task).filter(
        Task.is_deleted == False,
        Task.team_id == team_id,
        Task.status_id == status_obj.id
    ).order_by(Task.id.desc()).all()

    if not tasks:
        return QuickEstimateResponse(tasks=[], total=0)

    task_ids = [t.id for t in tasks]

    # Get all epics for these tasks
    epics = db.query(Epic).filter(Epic.task_id.in_(task_ids)).order_by(Epic.sort_order, Epic.id).all()
    epic_map: dict[int, list[Epic]] = {}
    for e in epics:
        epic_map.setdefault(e.task_id, []).append(e)

    # Get all stories for these epics
    epic_ids = [e.id for e in epics]
    stories = []
    if epic_ids:
        stories = db.query(Story).filter(Story.epic_id.in_(epic_ids)).order_by(Story.sort_order, Story.id).all()
    story_map: dict[int, list[Story]] = {}
    for s in stories:
        story_map.setdefault(s.epic_id, []).append(s)

    # Attach stories to epics
    for e in epics:
        e._stories = story_map.get(e.id, [])

    # Build response
    result_tasks = []
    for t in tasks:
        task_epics = epic_map.get(t.id, [])
        result_tasks.append(task_to_quick_estimate_response(t, task_epics))

    return QuickEstimateResponse(tasks=result_tasks, total=len(result_tasks))


# ==================== EPICS ====================

@router.post("/quick-estimate/epics", response_model=EpicResponse, status_code=status.HTTP_201_CREATED)
def create_epic(
    data: EpicCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new epic under a task."""
    task = db.query(Task).filter(Task.id == data.task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    authorize_task("edit", task, current_user)

    epic = Epic(
        task_id=data.task_id,
        title=data.title,
        description=data.description,
        priority=data.priority,
        effort_designee=data.effort_designee,
        effort_analytics=data.effort_analytics,
        effort_be=data.effort_be,
        effort_python_be=data.effort_python_be,
        effort_fe=data.effort_fe,
        effort_test=data.effort_test,
        effort_test_auto=data.effort_test_auto,
        effort_delivery=data.effort_delivery,
    )
    db.add(epic)
    db.commit()
    db.refresh(epic)
    return epic_to_response(epic)


@router.put("/quick-estimate/epics/{epic_id}", response_model=EpicResponse)
def update_epic(
    epic_id: int,
    data: EpicUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update an epic."""
    epic = db.query(Epic).filter(Epic.id == epic_id).first()
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")

    authorize_task("edit", _task_for_epic(db, epic), current_user)

    update_data = data.model_dump(exclude_unset=True)
    for field in EFFORT_FIELDS + ['title', 'description', 'priority']:
        if field in update_data:
            setattr(epic, field, update_data[field])

    db.commit()
    db.refresh(epic)
    return epic_to_response(epic)


@router.delete("/quick-estimate/epics/{epic_id}", response_model=SuccessResponse)
def delete_epic(
    epic_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete an epic and its stories."""
    epic = db.query(Epic).filter(Epic.id == epic_id).first()
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")

    authorize_task("edit", _task_for_epic(db, epic), current_user)

    # Stories will be cascade-deleted
    db.delete(epic)
    db.commit()
    return SuccessResponse(success=True, detail="Epic deleted")


# ==================== STORIES ====================

@router.post("/quick-estimate/stories", response_model=StoryResponse, status_code=status.HTTP_201_CREATED)
def create_story(
    data: StoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new story under an epic."""
    epic = db.query(Epic).filter(Epic.id == data.epic_id).first()
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")

    authorize_task("edit", _task_for_epic(db, epic), current_user)

    story = Story(
        epic_id=data.epic_id,
        title=data.title,
        description=data.description,
        effort_designee=data.effort_designee,
        effort_analytics=data.effort_analytics,
        effort_be=data.effort_be,
        effort_python_be=data.effort_python_be,
        effort_fe=data.effort_fe,
        effort_test=data.effort_test,
        effort_test_auto=data.effort_test_auto,
        effort_delivery=data.effort_delivery,
    )
    db.add(story)
    db.commit()
    db.refresh(story)
    return story_to_response(story)


@router.put("/quick-estimate/stories/{story_id}", response_model=StoryResponse)
def update_story(
    story_id: int,
    data: StoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a story."""
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    authorize_task("edit", _task_for_story(db, story), current_user)

    update_data = data.model_dump(exclude_unset=True)
    for field in EFFORT_FIELDS + ['title', 'description']:
        if field in update_data:
            setattr(story, field, update_data[field])

    db.commit()
    db.refresh(story)
    return story_to_response(story)


@router.delete("/quick-estimate/stories/{story_id}", response_model=SuccessResponse)
def delete_story(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a story."""
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    authorize_task("edit", _task_for_story(db, story), current_user)

    db.delete(story)
    db.commit()
    return SuccessResponse(success=True, detail="Story deleted")


@router.delete("/quick-estimate/tasks/{task_id}", response_model=SuccessResponse)
def remove_task_from_estimate(
    task_id: int,
    version: int = Query(..., ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Remove a task from express estimation by restoring its previous status."""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    authorize_task("edit", task, current_user)
    _assert_task_version(task, version)

    qe_status = db.query(TaskStatus).filter(TaskStatus.name == "ЭКСПРЕСС-ОЦЕНКА").first()
    if not qe_status or task.status_id != qe_status.id:
        raise HTTPException(status_code=400, detail="Task is not in express estimation")

    if task.previous_status_id:
        task.status_id = task.previous_status_id
    else:
        backlog = db.query(TaskStatus).filter(TaskStatus.name == "НОВАЯ ЗАДАЧА").first()
        if backlog:
            task.status_id = backlog.id
        else:
            raise HTTPException(status_code=500, detail="Default status not found")

    task.previous_status_id = None
    task.version = (task.version or 0) + 1
    _commit_task_change(db, task.id, version)
    return SuccessResponse(success=True, detail="Task removed from express estimation")


@router.put("/quick-estimate/complete", response_model=SuccessResponse)
def complete_quick_estimate(
    payload: TaskVersionsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Complete the team's express estimate and move all its tasks to decision."""
    if not current_user.team_id:
        raise HTTPException(status_code=400, detail="User has no team assigned")

    qe_status = db.query(TaskStatus).filter(TaskStatus.name == "ЭКСПРЕСС-ОЦЕНКА").first()
    decision_status = db.query(TaskStatus).filter(TaskStatus.name == "ПРИНЯТИЕ РЕШЕНИЯ").first()
    if not qe_status or not decision_status:
        raise HTTPException(status_code=409, detail="Required workflow statuses are not configured")

    tasks = db.query(Task).filter(
        Task.is_deleted == False,
        Task.team_id == current_user.team_id,
        Task.status_id == qe_status.id,
    ).order_by(Task.id).all()
    if not tasks:
        raise HTTPException(status_code=409, detail="No tasks in express estimation")

    # Authorize the full batch before changing any task.
    for task in tasks:
        authorize_task("edit", task, current_user)

    missing_versions = sorted(task.id for task in tasks if task.id not in payload.versions)
    if missing_versions:
        raise HTTPException(
            status_code=428,
            detail={"message": "Не переданы версии задач.", "missing_task_ids": missing_versions},
        )
    conflicts = [
        {
            "task_id": task.id,
            "submitted_version": payload.versions[task.id],
            "current_version": task.version or 0,
        }
        for task in tasks
        if payload.versions[task.id] != (task.version or 0)
    ]
    if conflicts:
        raise HTTPException(
            status_code=409,
            detail={"message": "Часть задач изменена другими пользователями.", "conflicts": conflicts},
        )

    try:
        for task in tasks:
            db.add(TaskHistory(
                task_id=task.id,
                changed_by=current_user.id,
                field_name="status_id",
                old_value=str(qe_status.id),
                new_value=str(decision_status.id),
            ))
            task.status_id = decision_status.id
            task.previous_status_id = None
            task.version = (task.version or 0) + 1
        db.commit()
    except StaleDataError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Задачи изменились во время завершения экспресс-оценки",
        )
    except Exception:
        db.rollback()
        raise

    return SuccessResponse(
        success=True,
        detail=f"Экспресс-оценка завершена. Задач переведено: {len(tasks)}",
    )


# ==================== TASK EFFORT UPDATE ====================

@router.put("/quick-estimate/tasks/{task_id}", response_model=QuickEstimateTaskResponse)
def update_task_effort(
    task_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update effort fields on a task (for inline editing on quick-estimate page)."""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    authorize_task("edit", task, current_user)

    if 'version' not in data:
        raise HTTPException(status_code=428, detail="Для изменения задачи необходимо передать её версию")
    client_version = data.pop('version')
    if client_version != (task.version or 0):
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Задача была изменена другим пользователем.",
                "current_version": task.version or 0,
                "submitted_version": client_version,
            },
        )

    allowed_fields = set(EFFORT_FIELDS) | {'title'}
    for key, value in data.items():
        if key in allowed_fields:
            if key.startswith('effort_') and value is not None and (not isinstance(value, (int, float)) or value < 0):
                raise HTTPException(status_code=422, detail=f"Field '{key}' must be a non-negative number")
            setattr(task, key, value)

    task.version = (task.version or 0) + 1
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        current = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Задача была изменена другим пользователем.",
                "current_version": (current.version or 0) if current else None,
                "submitted_version": client_version,
            },
        )
    db.refresh(task)

    epics = db.query(Epic).filter(Epic.task_id == task.id).order_by(Epic.sort_order, Epic.id).all()
    return task_to_quick_estimate_response(task, epics)


# ==================== BATCH SORT ====================

@router.patch("/quick-estimate/sort", response_model=SuccessResponse)
def update_sort_order(
    data: SortRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Batch update sort_order for epics and stories within their parents."""
    for item in data.epics:
        epic = db.query(Epic).filter(Epic.id == item.id).first()
        if epic:
            authorize_task("edit", _task_for_epic(db, epic), current_user)
            epic.sort_order = item.sort_order

    for item in data.stories:
        story = db.query(Story).filter(Story.id == item.id).first()
        if story:
            authorize_task("edit", _task_for_story(db, story), current_user)
            story.sort_order = item.sort_order

    db.commit()
    return SuccessResponse(success=True, detail="Sort order updated")


# ==================== BACKLOG TASK IMPORT ====================

def _task_to_response(task: Task) -> TaskResponse:
    """Convert Task ORM to TaskResponse (for backlog task listing)."""
    cv = calculate_cost_value_ratio(task.effort_rub, task.financial_effect)

    return TaskResponse(
        id=task.id,
        public_id=task.public_id,
        team_id=task.team_id,
        title=task.title,
        description=task.description,
        date_received=task.date_received,
        channel_id=task.channel_id,
        business_customer_id=task.business_customer_id,
        department_id=task.department_id,
        project_id=task.project_id,
        task_type_id=task.task_type_id,
        involved_teams=task.involved_teams,
        priority_id=task.priority_id,
        status_id=task.status_id,
        deadline_id=task.deadline_id,
        effort_days=task.effort_days,
        effort_rub=task.effort_rub,
        financial_effect=task.financial_effect,
        # Legacy rows may contain NULL even though the public API contract
        # exposes progress as an integer. Keep the import picker available.
        progress=task.progress if task.progress is not None else 0,
        link_mockups=task.link_mockups,
        link_jira=task.link_jira,
        rejection_reason=task.rejection_reason,
        comment=task.comment,
        owner_id=task.owner_id,
        key_project_status=task.key_project_status,
        directorate_status=task.directorate_status,
        did_status=task.did_status,
        effort_designee=task.effort_designee,
        effort_analytics=task.effort_analytics,
        effort_be=task.effort_be,
        effort_python_be=task.effort_python_be,
        effort_fe=task.effort_fe,
        effort_test=task.effort_test,
        effort_test_auto=task.effort_test_auto,
        effort_delivery=task.effort_delivery,
        cv=cv,
        created_by=task.created_by,
        created_at=task.created_at,
        updated_at=task.updated_at,
        version=task.version or 0,
        team_name=task.team.name if task.team else None,
        channel_name=task.channel.name if task.channel else None,
        department_name=task.department.name if task.department else None,
        project_name=task.project.name if task.project else None,
        priority_name=task.priority.name if task.priority else None,
        status_name=task.status.name if task.status else None,
        deadline_name=task.deadline.name if task.deadline else None,
        owner_name=task.owner.name if task.owner else None,
        business_customer_name=task.business_customer_rel.name if task.business_customer_rel else None,
    )


@router.get("/quick-estimate/backlog-tasks")
def get_backlog_tasks(
    q: str = Query("", max_length=200),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get team tasks NOT in ЭКСПРЕСС-ОЦЕНКА status — for importing into express estimation."""
    team_id = current_user.team_id
    if not team_id:
        raise HTTPException(status_code=400, detail="User has no team assigned")

    qe_status = db.query(TaskStatus).filter(TaskStatus.name == "ЭКСПРЕСС-ОЦЕНКА").first()
    qe_status_id = qe_status.id if qe_status else -1

    query = db.query(Task).filter(
        Task.is_deleted == False,
        Task.team_id == team_id,
        Task.status_id != qe_status_id
    )

    if q:
        query = query.filter(Task.title.ilike(f"%{q}%"))

    total = query.count()
    tasks = query.order_by(Task.id.desc()).offset(offset).limit(limit).all()
    return {"items": [_task_to_response(t) for t in tasks], "total": total}


@router.post("/quick-estimate/import-task/{task_id}", response_model=QuickEstimateTaskResponse)
def import_task_to_estimate(
    task_id: int,
    payload: TaskVersionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Move a task from backlog into express estimation by changing its status."""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    authorize_task("edit", task, current_user)
    _assert_task_version(task, payload.version)

    qe_status = db.query(TaskStatus).filter(TaskStatus.name == "ЭКСПРЕСС-ОЦЕНКА").first()
    if not qe_status:
        raise HTTPException(status_code=500, detail="Status ЭКСПРЕСС-ОЦЕНКА not found")

    task.previous_status_id = task.status_id
    task.status_id = qe_status.id
    task.version = (task.version or 0) + 1
    _commit_task_change(db, task.id, payload.version)
    db.refresh(task)

    epics = db.query(Epic).filter(Epic.task_id == task.id).order_by(Epic.sort_order, Epic.id).all()
    return task_to_quick_estimate_response(task, epics)
