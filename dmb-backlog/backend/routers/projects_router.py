"""Read-only workspace for projects understood as ongoing work directions."""
from typing import Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from auth import get_current_user, require_non_business_customer_access
from database import get_db
from models import User
from services import project_workspace as service
from services.metric_rules import today

router = APIRouter(prefix='/projects', dependencies=[Depends(require_non_business_customer_access)])


@router.get('')
def catalogue(q: str = Query('', max_length=200), page: int = Query(1, ge=1),
              db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.catalogue(db, user, q, page)


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
