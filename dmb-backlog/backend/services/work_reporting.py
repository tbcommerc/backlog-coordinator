"""Separate work reporting: no Task financial/progress aggregation."""
from datetime import date
from fastapi import HTTPException
from sqlalchemy import select
from models import WorkTask, WorkMeetingSnapshot, ReportingMeeting, Task, MajorExternalLink
from auth import task_read_scope_clause, can_access_task, check_permission, is_customer_portal_only
from services.work_tasks import read_scope

FIELDS = ('id', 'title', 'status', 'execution_team_id', 'requester_id', 'assignee_id', 'acceptor_id',
          'major_task_id', 'direct_project_id', 'due_date', 'assignment_state', 'result_text', 'version')

def serialize(row):
    values = {key: getattr(row, key) for key in FIELDS}
    values['due_date'] = row.due_date.isoformat() if row.due_date else None
    return values

def capture(db, meeting):
    # Lock the meeting, including competing completion/capture commands.
    db.execute(select(ReportingMeeting.id).where(ReportingMeeting.id == meeting.id).with_for_update())
    existing = db.get(WorkMeetingSnapshot, meeting.id)
    if existing: return existing
    rows = db.query(WorkTask).filter(WorkTask.is_deleted.is_(False)).order_by(WorkTask.id).all()
    snapshot = WorkMeetingSnapshot(meeting_id=meeting.id, schema_version=1,
        payload={'as_of': date.today().isoformat(), 'items': [serialize(row) for row in rows]})
    db.add(snapshot)
    db.flush()
    return snapshot

def metrics(items, as_of):
    active = [x for x in items if x['status'] not in {'done', 'cancelled'}]
    return {'total':len(items), 'active':len(active), 'done':sum(x['status']=='done' for x in items),
        'overdue':sum(bool(x['due_date'] and x['due_date'] < as_of) for x in active),
        'in_acceptance':sum(x['status']=='in_acceptance' for x in active),
        'proposals':sum(x['assignment_state']=='proposed' for x in active)}

def report(db, user, meeting_id=None, team_id=None):
    if is_customer_portal_only(user): raise HTTPException(403, 'Внутренний отчёт недоступен')
    visible = db.query(WorkTask).filter(WorkTask.is_deleted.is_(False), read_scope(user)).all()
    snapshot = None
    if meeting_id is not None:
        meeting = db.get(ReportingMeeting, meeting_id)
        if not meeting: raise HTTPException(404, 'Встреча не найдена')
        snapshot = db.get(WorkMeetingSnapshot, meeting_id)
        if not snapshot:
            return {'available':False, 'message':'Для этой встречи снимок рабочих задач не зафиксирован', 'items':[], 'summary':None}
        ids = {x.id for x in visible}
        global_read = check_permission(user, 'backlog_dmb', 'read')
        items = [{k: v for k, v in x.items() if k != 'blocked_reason'} for x in snapshot.payload['items'] if x['id'] in ids and (global_read or
            user.id in (x['requester_id'], x['assignee_id'], x['acceptor_id']) or
            (user.team_id is not None and user.team_id == x['execution_team_id']))]
        as_of = snapshot.payload['as_of']
    else:
        items, as_of = [serialize(x) for x in visible], date.today().isoformat()
    from services.filter_values import filter_values
    team_ids=filter_values(team_id,numeric=True)
    if team_ids: items = [x for x in items if x['execution_team_id'] in team_ids]
    majors = db.query(Task).filter(Task.is_deleted.is_(False), task_read_scope_clause(user, Task))
    if team_ids: majors = majors.filter(Task.team_id.in_(team_ids))
    major_rows = majors.all()
    major_ids = {x.id for x in major_rows}
    external = db.query(MajorExternalLink).filter(MajorExternalLink.major_task_id.in_(major_ids)).all() if major_ids else []
    # Only expose the context when independently readable; snapshot ACL is intersected with current ACL.
    for item in items:
        parent = db.get(Task, item['major_task_id']) if item['major_task_id'] else None
        if not parent or parent.is_deleted or not can_access_task('read', parent, user): item['major_task_id'] = None
        for key in ('requester_id', 'assignee_id', 'acceptor_id'): item.pop(key, None)
    return {'available':True, 'mode':'snapshot' if snapshot else 'live', 'as_of':as_of,
        'schema_version':snapshot.schema_version if snapshot else 1,
        'summary':metrics(items, as_of), 'items':items,
        'major_summary':None if snapshot else {'obligations':len(major_ids), 'with_external_links':len({x.major_task_id for x in external}),
            'external_status':'links_only'},
        'major_items':[] if snapshot else [{'id':x.id,'public_id':x.public_id,'title':x.title,
            'work':metrics([w for w in items if w['major_task_id']==x.id], as_of),
            'external_links':sum(e.major_task_id==x.id for e in external)} for x in major_rows]}
