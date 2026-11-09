"""Read-only workspace for projects understood as ongoing work directions."""
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from auth import get_current_user, require_non_business_customer_access
from database import get_db
from models import User
from services import project_workspace as service
from services.metric_rules import today
from services import project_management
from project_contract import TaskPlanUpdate

router = APIRouter(prefix='/projects', dependencies=[Depends(require_non_business_customer_access)])


@router.get('/{project_id}/management')
def management(project_id: int, year: int = Query(..., ge=2000, le=2099),
               quarter: int = Query(0, ge=0, le=4),
               view: Literal['plan','gantt','deviations'] = 'plan',
               horizon: Literal['period','all','undated'] = 'period',
               page: int = Query(1, ge=1), q: str = Query('', max_length=200), milestones: bool = False,
               team: str = Query('', max_length=200), state: str = Query('', max_length=200),
               owner: str = Query('', max_length=200), sort: Literal['start','due','owner','title'] = 'start',
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return project_management.management(db,user,project_id,year,quarter,view,horizon,page,q,milestones,team,state,sort,owner)


@router.put('/{project_id}/tasks/{task_id}/plan')
def update_plan(project_id: int, task_id: int, payload: TaskPlanUpdate,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return project_management.update_plan(db,user,project_id,task_id,payload)


@router.get('/{project_id}/tasks/{task_id}/plan')
def task_plan(project_id: int, task_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from fastapi import HTTPException
    rows = project_management.task_rows(db,user,project_id,task_id)
    if not rows:
        raise HTTPException(404,'Задача недоступна в этом проекте')
    return rows[0]


@router.get('')
def catalogue(q: str = Query('', max_length=200), page: int = Query(1, ge=1),
              team: str = Query('',max_length=200), owner: str = Query('',max_length=200),
              db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.catalogue(db, user, q, page, team, owner)


@router.get('/{project_id}/workspace')
def workspace(project_id: int, year: int | None = Query(None, ge=2000, le=2099),
              db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.workspace(db, user, project_id, year or today().year)


@router.get('/{project_id}/backlog')
def backlog(project_id: int, year: int | None = Query(None, ge=2000, le=2099),
            bucket: Literal['all','1','2','3','4','annual','unplanned'] = 'all',
            q: str = Query('', max_length=200), state: Literal['all','active','closed'] = 'all',
            page: int = Query(1, ge=1), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.backlog(db, user, project_id, year or today().year, bucket, q, state, page)


@router.get('/{project_id}/results')
def results(project_id: int, year: int | None = Query(None, ge=2000, le=2099),
            quarter: int = Query(0, ge=0, le=4), kind: Literal['work','backlog','moves','metrics'] = 'work',
            page: int = Query(1, ge=1), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.results(db, user, project_id, year or today().year, quarter, kind, page)
