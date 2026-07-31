"""
DMB Backlog - Timeline Router
"""
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional, List

from database import get_db
from models import TimelineEvent, User
from schemas import TimelineEventCreate, TimelineEventUpdate, TimelineEventResponse, TimelineEventListResponse
from auth import get_current_user, require_permission

router = APIRouter()


@router.get("/", response_model=TimelineEventListResponse)
async def get_timeline_events(
    year: Optional[int] = Query(None),
    quarter: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(TimelineEvent)
    if year:
        query = query.filter(TimelineEvent.year == year)
    if quarter:
        query = query.filter(TimelineEvent.quarter == quarter)
    if month:
        query = query.filter(TimelineEvent.month == month)
    query = query.order_by(TimelineEvent.date.asc())
    items = query.all()
    result = []
    for ev in items:
        resp = TimelineEventResponse.model_validate(ev)
        resp.project_name = ev.project.name if ev.project else ""
        resp.creator_name = ev.creator.name if ev.creator else ""
        result.append(resp)
    return TimelineEventListResponse(items=result, total=len(result))


@router.get("/year/{year}", response_model=TimelineEventListResponse)
async def get_events_by_year(
    year: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    items = db.query(TimelineEvent).filter(TimelineEvent.year == year).order_by(TimelineEvent.date.asc()).all()
    result = []
    for ev in items:
        resp = TimelineEventResponse.model_validate(ev)
        resp.project_name = ev.project.name if ev.project else ""
        resp.creator_name = ev.creator.name if ev.creator else ""
        result.append(resp)
    return TimelineEventListResponse(items=result, total=len(result))


@router.get("/{event_id}", response_model=TimelineEventResponse)
async def get_timeline_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ev = db.query(TimelineEvent).filter(TimelineEvent.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    resp = TimelineEventResponse.model_validate(ev)
    resp.project_name = ev.project.name if ev.project else ""
    resp.creator_name = ev.creator.name if ev.creator else ""
    return resp


@router.post("/", response_model=TimelineEventResponse, status_code=201)
async def create_timeline_event(
    data: TimelineEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ev = TimelineEvent(
        title=data.title,
        description=data.description,
        event_type=data.event_type or "event",
        color=data.color or "#6366f1",
        date=data.date,
        quarter=data.quarter,
        month=data.month,
        year=data.year,
        project_id=data.project_id,
        is_recurring=data.is_recurring or False,
        recurring_interval=data.recurring_interval,
        visibility_level=data.visibility_level or "team",
        creator_id=current_user.id,
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    resp = TimelineEventResponse.model_validate(ev)
    resp.project_name = ev.project.name if ev.project else ""
    resp.creator_name = ev.creator.name if ev.creator else ""
    return resp


@router.put("/{event_id}", response_model=TimelineEventResponse)
async def update_timeline_event(
    event_id: int,
    data: TimelineEventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ev = db.query(TimelineEvent).filter(TimelineEvent.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(ev, key, value)
    db.commit()
    db.refresh(ev)
    resp = TimelineEventResponse.model_validate(ev)
    resp.project_name = ev.project.name if ev.project else ""
    resp.creator_name = ev.creator.name if ev.creator else ""
    return resp


@router.delete("/{event_id}")
async def delete_timeline_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ev = db.query(TimelineEvent).filter(TimelineEvent.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(ev)
    db.commit()
    return {"message": "Event deleted", "success": True}


@router.get("/admin", response_model=List[TimelineEventResponse])
async def get_admin_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "admin", "full")
    items = db.query(TimelineEvent).order_by(TimelineEvent.date.desc()).all()
    result = []
    for ev in items:
        resp = TimelineEventResponse.model_validate(ev)
        resp.project_name = ev.project.name if ev.project else ""
        resp.creator_name = ev.creator.name if ev.creator else ""
        result.append(resp)
    return result


@router.put("/admin/{event_id}", response_model=TimelineEventResponse)
async def admin_update_event(
    event_id: int,
    data: TimelineEventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "admin", "full")
    ev = db.query(TimelineEvent).filter(TimelineEvent.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(ev, key, value)
    db.commit()
    db.refresh(ev)
    resp = TimelineEventResponse.model_validate(ev)
    resp.project_name = ev.project.name if ev.project else ""
    resp.creator_name = ev.creator.name if ev.creator else ""
    return resp


@router.delete("/admin/{event_id}")
async def admin_delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    require_permission(current_user, "admin", "full")
    ev = db.query(TimelineEvent).filter(TimelineEvent.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(ev)
    db.commit()
    return {"message": "Event deleted", "success": True}
