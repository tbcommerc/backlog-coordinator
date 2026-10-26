from types import SimpleNamespace as NS
from test_work_tasks import row, user
from services import work_tasks as work
from models import Notification, EventOutbox
from notifications import notification_target
from schemas import NotificationTargetResponse

def test_typed_notification_does_not_alias_task_id():
    result=NotificationTargetResponse.model_validate(notification_target(Notification(work_task_id=17,task_id=None,category='work')))
    assert result.kind=='work' and result.work_task_id==17
    assert result.task_id is None and result.url=='/work-tasks/17'

def test_notification_recipient_is_rechecked(monkeypatch):
    recipients=[user(2),user(3)]
    query=NS(filter=lambda *args:recipients)
    added=[]
    pending_query=NS(filter=lambda *args:NS(all=lambda:[]))
    db=NS(query=lambda model:pending_query if model is Notification else query,add=added.append)
    from fastapi import HTTPException
    def visible(db,id,recipient):
        if recipient.id==3: raise HTTPException(404)
    monkeypatch.setattr(work,'get_work',visible)
    work.notify_work(db,row(),user(1))
    rows=[x for x in added if isinstance(x,Notification)]
    assert len(rows)==1 and rows[0].user_id==2
    assert rows[0].work_task_id==1 and rows[0].task_id is None
    assert len([x for x in added if isinstance(x,EventOutbox)])==1

