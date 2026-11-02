from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from auth import get_current_user, require_permission
from database import get_db
from models import User, ReportingMeeting
from services.work_reporting import report, capture
from work_contract import Contract
from pydantic import Field

class Version(Contract):
    version: int = Field(ge=0)
from fastapi import HTTPException

router = APIRouter()

@router.get('/work-reports')
def read_report(meeting_id: int | None = Query(None, gt=0), team_id: str | None = Query(None),
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return report(db, user, meeting_id, team_id)

@router.post('/reporting-meetings/{meeting_id}/work-snapshot')
def save_snapshot(meeting_id: int, body: Version, db: Session = Depends(get_db),
                  user: User = Depends(require_permission('admin', 'full'))):
    meeting = db.query(ReportingMeeting).filter_by(id=meeting_id).with_for_update().first()
    if not meeting: raise HTTPException(404, 'Встреча не найдена')
    if meeting.version != body.version: raise HTTPException(409, 'Встреча изменена')
    if meeting.state not in {'planned', 'date_pending'}: raise HTTPException(422, 'Закрытую встречу нельзя переснимать')
    capture(db, meeting)
    db.commit()
    return report(db, user, meeting_id)
