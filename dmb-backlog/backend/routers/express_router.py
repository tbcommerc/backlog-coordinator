"""
DMB Backlog - Express Estimate Router (Экспресс-оценка)
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload
from typing import Optional, List
from datetime import date

from database import get_db
from models import Task, Epic, Story, TaskStatus, User
from schemas import (
    EpicCreate, EpicUpdate, EpicResponse, EpicListResponse,
    StoryCreate, StoryUpdate, StoryResponse, StoryListResponse,
    QuickEstimateTaskResponse, QuickEstimateResponse,
    TaskResponse, SuccessResponse
)
from auth import get_current_user, check_permission
from notifications import notify_express_import

router = APIRouter()

EFFORT_FIELDS = ['effort_designee', 'effort_analytics', 'effort_be', 'effort_python_be', 'effort_fe', 'effort_test', 'effort_test_auto', 'effort_delivery']

# ==================== Helper ====================

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
        progress=story.progress,
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
    cv = None
    if task.financial_effect is not None and task.effort_rub is not None and task.effort_rub > 0:
        cv = round(task.financial_effect / task.effort_rub, 2)

    return QuickEstimateTaskResponse(
        id=task.id,
        team_id=task.team_id,
        title=task.title,
        description=task.description,
        date_received=task.date_received,
        channel_id=task.channel_id,
        business_customer=task.business_customer,
        business_customer_id=task.business_customer_id,
        department_id=task.department_id,
        project_id=task.project_id,
        task_type_id=task.task_type_id,
        involved_teams=task.involved_teams,
        priority_id=task.priority_id,
        status_id=task.status_id,
        deadline_id=task.deadline_id,
        deadline_po_id=task.deadline_po_id,
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
        ice_score=task.ice_score,
        progress=task.progress,
        what_if=task.what_if,
        dod=task.dod,
        link_mockups=task.link_mockups,
        link_jira=task.link_jira,
        rejection_reason=task.rejection_reason,
        comment=task.comment,
        status_comment=task.status_comment,
        owner_id=task.owner_id,
        responsible_po_id=task.responsible_po_id,
        business_analyst_id=task.business_analyst_id,
        it_product_lead_id=task.it_product_lead_id,
        key_project=task.key_project,
        key_project_status=task.key_project_status,
        directorate_status=task.directorate_status,
        did_status=task.did_status,
        is_from_leadership=task.is_from_leadership,
        is_regular=task.is_regular,
        cv=cv,
        last_updated=task.last_updated,
        created_by=task.created_by,
        created_at=task.created_at,
        updated_at=task.updated_at,
        team_name=task.team.name if task.team else None,
        channel_name=task.channel.name if task.channel else None,
        department_name=task.department.name if task.department else None,
        project_name=task.project.name if task.project else None,
        priority_name=task.priority.name if task.priority else None,
        status_name=task.status.name if task.status else None,
        deadline_name=task.deadline.name if task.deadline else None,
        deadline_po_name=task.deadline_po.name if task.deadline_po else None,
        owner_name=task.owner.name if task.owner else None,
        responsible_po_name=task.responsible_po.name if task.responsible_po else None,
        business_analyst_name=task.business_analyst.name if task.business_analyst else None,
        it_product_lead_name=task.it_product_lead.name if task.it_product_lead else None,
        business_customer_name=task.business_customer_rel.name if task.business_customer_rel else None,
        epics=[epic_to_response(e) for e in epics],
    )


# ==================== GET Quick Estimate Data ====================

@router.get("/quick-estimate", response_model=QuickEstimateResponse)
async def get_quick_estimate(
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
    epics = db.query(Epic).filter(Epic.task_id.in_(task_ids)).order_by(Epic.id).all()
    epic_map: dict[int, list[Epic]] = {}
    for e in epics:
        epic_map.setdefault(e.task_id, []).append(e)

    # Get all stories for these epics
    epic_ids = [e.id for e in epics]
    stories = []
    if epic_ids:
        stories = db.query(Story).filter(Story.epic_id.in_(epic_ids)).order_by(Story.id).all()
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
async def create_epic(
    data: EpicCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new epic under a task."""
    task = db.query(Task).filter(Task.id == data.task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

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
async def update_epic(
    epic_id: int,
    data: EpicUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update an epic."""
    epic = db.query(Epic).filter(Epic.id == epic_id).first()
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")

    update_data = data.model_dump(exclude_unset=True)
    for field in EFFORT_FIELDS + ['title', 'description', 'priority']:
        if field in update_data:
            setattr(epic, field, update_data[field])

    db.commit()
    db.refresh(epic)
    return epic_to_response(epic)


@router.delete("/quick-estimate/epics/{epic_id}", response_model=SuccessResponse)
async def delete_epic(
    epic_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete an epic and its stories."""
    epic = db.query(Epic).filter(Epic.id == epic_id).first()
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")

    # Stories will be cascade-deleted
    db.delete(epic)
    db.commit()
    return SuccessResponse(success=True, detail="Epic deleted")


# ==================== STORIES ====================

@router.post("/quick-estimate/stories", response_model=StoryResponse, status_code=status.HTTP_201_CREATED)
async def create_story(
    data: StoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new story under an epic."""
    epic = db.query(Epic).filter(Epic.id == data.epic_id).first()
    if not epic:
        raise HTTPException(status_code=404, detail="Epic not found")

    story = Story(
        epic_id=data.epic_id,
        title=data.title,
        description=data.description,
        progress=data.progress,
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
async def update_story(
    story_id: int,
    data: StoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update a story."""
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    update_data = data.model_dump(exclude_unset=True)
    for field in EFFORT_FIELDS + ['title', 'description', 'progress']:
        if field in update_data:
            setattr(story, field, update_data[field])

    db.commit()
    db.refresh(story)
    return story_to_response(story)


@router.delete("/quick-estimate/stories/{story_id}", response_model=SuccessResponse)
async def delete_story(
    story_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a story."""
    story = db.query(Story).filter(Story.id == story_id).first()
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")

    db.delete(story)
    db.commit()
    return SuccessResponse(success=True, detail="Story deleted")


# ==================== TASK DELETE ====================

@router.delete("/quick-estimate/tasks/{task_id}", response_model=SuccessResponse)
async def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Delete a task and its epics/stories (cascade)."""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    epic_count = db.query(Epic).filter(Epic.task_id == task_id).count()
    db.delete(task)
    db.commit()
    detail = f"Task deleted ({epic_count} эпиков)" if epic_count else "Task deleted"
    return SuccessResponse(success=True, detail=detail)


# ==================== TASK EFFORT UPDATE ====================

@router.put("/quick-estimate/tasks/{task_id}", response_model=QuickEstimateTaskResponse)
async def update_task_effort(
    task_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Update effort fields on a task (for inline editing on quick-estimate page)."""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Only allow updating effort fields through this endpoint
    allowed_fields = set(EFFORT_FIELDS) | {'title'}
    for key, value in data.items():
        if key in allowed_fields:
            setattr(task, key, value)

    db.commit()
    db.refresh(task)

    # Get epics for the task
    epics = db.query(Epic).filter(Epic.task_id == task.id).order_by(Epic.id).all()
    return task_to_quick_estimate_response(task, epics)


# ==================== BACKLOG TASK IMPORT ====================

def _task_to_response(task: Task) -> TaskResponse:
    """Convert Task ORM to TaskResponse (for backlog task listing)."""
    cv = None
    if task.financial_effect is not None and task.effort_rub is not None and task.effort_rub > 0:
        cv = round(task.financial_effect / task.effort_rub, 2)

    return TaskResponse(
        id=task.id,
        team_id=task.team_id,
        title=task.title,
        description=task.description,
        date_received=task.date_received,
        channel_id=task.channel_id,
        business_customer=task.business_customer,
        business_customer_id=task.business_customer_id,
        department_id=task.department_id,
        project_id=task.project_id,
        task_type_id=task.task_type_id,
        involved_teams=task.involved_teams,
        priority_id=task.priority_id,
        status_id=task.status_id,
        deadline_id=task.deadline_id,
        deadline_po_id=task.deadline_po_id,
        effort_days=task.effort_days,
        effort_rub=task.effort_rub,
        financial_effect=task.financial_effect,
        ice_score=task.ice_score,
        progress=task.progress,
        what_if=task.what_if,
        dod=task.dod,
        link_mockups=task.link_mockups,
        link_jira=task.link_jira,
        rejection_reason=task.rejection_reason,
        comment=task.comment,
        status_comment=task.status_comment,
        owner_id=task.owner_id,
        responsible_po_id=task.responsible_po_id,
        business_analyst_id=task.business_analyst_id,
        it_product_lead_id=task.it_product_lead_id,
        key_project=task.key_project,
        key_project_status=task.key_project_status,
        directorate_status=task.directorate_status,
        did_status=task.did_status,
        is_from_leadership=task.is_from_leadership,
        is_regular=task.is_regular,
        effort_designee=task.effort_designee,
        effort_analytics=task.effort_analytics,
        effort_be=task.effort_be,
        effort_python_be=task.effort_python_be,
        effort_fe=task.effort_fe,
        effort_test=task.effort_test,
        effort_test_auto=task.effort_test_auto,
        effort_delivery=task.effort_delivery,
        cv=cv,
        last_updated=task.last_updated,
        created_by=task.created_by,
        created_at=task.created_at,
        updated_at=task.updated_at,
        team_name=task.team.name if task.team else None,
        channel_name=task.channel.name if task.channel else None,
        department_name=task.department.name if task.department else None,
        project_name=task.project.name if task.project else None,
        priority_name=task.priority.name if task.priority else None,
        status_name=task.status.name if task.status else None,
        deadline_name=task.deadline.name if task.deadline else None,
        deadline_po_name=task.deadline_po.name if task.deadline_po else None,
        owner_name=task.owner.name if task.owner else None,
        responsible_po_name=task.responsible_po.name if task.responsible_po else None,
        business_analyst_name=task.business_analyst.name if task.business_analyst else None,
        it_product_lead_name=task.it_product_lead.name if task.it_product_lead else None,
        business_customer_name=task.business_customer_rel.name if task.business_customer_rel else None,
    )


@router.get("/quick-estimate/backlog-tasks", response_model=List[TaskResponse])
async def get_backlog_tasks(
    q: str = Query("", max_length=200),
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

    tasks = query.order_by(Task.id.desc()).limit(20).all()
    return [_task_to_response(t) for t in tasks]


@router.post("/quick-estimate/import-task/{task_id}", response_model=QuickEstimateTaskResponse)
async def import_task_to_estimate(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Move a task from backlog into express estimation by changing its status."""
    task = db.query(Task).filter(Task.id == task_id, Task.is_deleted == False).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    qe_status = db.query(TaskStatus).filter(TaskStatus.name == "ЭКСПРЕСС-ОЦЕНКА").first()
    if not qe_status:
        raise HTTPException(status_code=500, detail="Status ЭКСПРЕСС-ОЦЕНКА not found")

    task.status_id = qe_status.id
    task.last_updated = date.today()
    db.commit()
    db.refresh(task)

    # Notifications: express import
    notify_express_import(db, task, current_user.name)
    db.commit()

    epics = db.query(Epic).filter(Epic.task_id == task.id).order_by(Epic.id).all()
    return task_to_quick_estimate_response(task, epics)
