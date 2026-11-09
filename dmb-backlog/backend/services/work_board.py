"""Bounded board reads, signed keyset cursors and batched card projection."""
import base64
import hashlib
import hmac
import json
from contextlib import contextmanager
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import and_, or_, func
from sqlalchemy.orm import Session
from config import settings
from models import WorkTask as W, Task, User, Team, Project, WorkHistory
from auth import can_access_task
from services import work_tasks as work
from services.work_query import Selection, STATUSES, TITLES


def fail(status, code, message):
    raise HTTPException(status, {'code':code, 'message':message})


@contextmanager
def snapshot(db):
    # Authentication can already have opened a READ COMMITTED transaction.
    # A separate short read transaction guarantees consistent counts and pages.
    engine = db.get_bind()
    if engine.dialect.name != 'postgresql':
        yield db
        return
    with engine.connect().execution_options(isolation_level='REPEATABLE READ') as connection:
        with Session(bind=connection) as reader:
            yield reader


def query_key(selection, user, size):
    data = [user.id, selection.filters.model_dump(), size, str(selection.today)]
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def encode(payload):
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(',',':')).encode()).decode().rstrip('=')
    sig = hmac.new(settings.SECRET_KEY.encode(), raw.encode(), hashlib.sha256).hexdigest()
    return raw + '.' + sig


def decode(cursor, key, status, size, now):
    try:
        if len(cursor) > 4096: raise ValueError()
        raw, sig = cursor.split('.')
        expected = hmac.new(settings.SECRET_KEY.encode(), raw.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig,expected): raise ValueError()
        value = json.loads(base64.urlsafe_b64decode(raw + '=' * (-len(raw)%4)))
        if value['direction'] not in ('next','previous') or not isinstance(value['keys'],list): raise ValueError()
        if any(type(x) not in (int,str) for x in value['keys']): raise ValueError()
        if not isinstance(value['at'],(int,float)): raise ValueError()
    except (ValueError, KeyError, TypeError, UnicodeError):
        fail(400,'invalid_cursor','Позиция колонки недействительна. Обновите колонку.')
    if now.timestamp()-value['at'] > 1800 or value['at'] > now.timestamp()+5:
        fail(409,'cursor_expired','Позиция устарела. Обновите доску.')
    if value.get('query') != key or value.get('status') != status or value.get('size') != size:
        fail(409,'query_changed','Условия изменились. Обновите доску.')
    return value


def boundary(keys, values, before=False):
    if len(keys) != len(values): fail(400,'invalid_cursor','Некорректная позиция колонки')
    return or_(*[and_(*[keys[j] == values[j] for j in range(i)], keys[i] < v if before else keys[i] > v)
                 for i,v in enumerate(values)])


def transition_options(row, user):
    from work_contract import Transition
    labels = {'new':'Восстановить задачу', 'ready':'Переоткрыть' if row.status=='done' else 'Передать исполнителю',
        'in_progress':'Вернуть на доработку' if row.status=='in_acceptance' else 'Начать работу',
        'in_acceptance':'Передать на приёмку','done':'Принять результат' if row.status=='in_acceptance' else 'Завершить',
        'cancelled':'Отменить задачу'}
    result=[]
    for target in work.TRANSITIONS.get(row.status, ()):
        enabled=True; reason=None
        try: work.transition_values(row,user,Transition(version=row.version,status=target,reason='reason',result_text='result'))
        except HTTPException as e:
            enabled=False;reason='forbidden' if e.status_code==403 else 'requirements'
        missing=[]
        if reason=='requirements' and work.editor(user,row.execution_team_id):
            missing=[name for name in ('description','assignee_id','due_date') if not getattr(row,name)]
        # Do not reveal or advertise operations belonging to another participant.
        if reason=='forbidden': continue
        inputs=[]
        if target in ('done','in_acceptance'): inputs=['confirmation'] if row.status=='in_acceptance' else ['result_text']
        if target=='cancelled' or row.status in ('done','cancelled') or row.status=='in_acceptance' and target=='in_progress': inputs=['reason']
        result.append(dict(target=target,label=labels[target],enabled=enabled,requires_input=inputs,
            disabled_reason_code=reason,missing_fields=missing))
    return result


def cards(db, rows, user, today):
    from services.work_presentation import next_step, readiness
    if not rows: return {}
    people_ids={x for r in rows for x in (r.assignee_id,r.acceptor_id) if x}
    people={x.id:x.name for x in db.query(User.id,User.name).filter(User.id.in_(people_ids))} if people_ids else {}
    teams={x.id:x.name for x in db.query(Team.id,Team.name).filter(Team.id.in_({r.execution_team_id for r in rows}))}
    parent_ids={r.major_task_id for r in rows if r.major_task_id}
    parents={x.id:x for x in db.query(Task.id,Task.title,Task.team_id,Task.project_id,Task.is_deleted).filter(Task.id.in_(parent_ids))} if parent_ids else {}
    project_ids={r.direct_project_id for r in rows if r.direct_project_id}
    projects={x.id:x.name for x in db.query(Project.id,Project.name).filter(Project.id.in_(project_ids))} if project_ids else {}
    latest=db.query(func.max(WorkHistory.id)).filter(WorkHistory.work_task_id.in_([r.id for r in rows]),
        WorkHistory.action=='transition').group_by(WorkHistory.work_task_id)
    history={h.work_task_id:h for h in db.query(WorkHistory).filter(WorkHistory.id.in_(latest))}
    output={}
    for row in rows:
        active=row.status not in ('done','cancelled')
        context=None;project=row.direct_project_id
        if row.major_task_id:
            parent=parents.get(row.major_task_id)
            if parent and not parent.is_deleted and can_access_task('read',parent,user):
                context={'kind':'major','id':parent.id,'title':parent.title};project=parent.project_id
            else: context={'kind':'unavailable','title':'Контекст недоступен'};project=None
        elif project: context={'kind':'project','id':project,'title':projects.get(project,'Проект')}
        options=transition_options(row,user)
        can_edit=work.editor(user,row.execution_team_id) or row.requester_id==user.id and row.status=='new'
        can_check=active and (can_edit or row.assignee_id==user.id)
        h=history.get(row.id)
        data={key:getattr(row,key) for key in ('id','title','version','status','work_direction','execution_team_id',
            'assignee_id','acceptor_id','assignment_state','acceptance_required','priority','due_date','completed_at')}
        data.update(public_id=row.public_id,context=context,effective_project_id=project,
            execution_team_name=teams.get(row.execution_team_id),assignee_name=people.get(row.assignee_id),
            acceptor_name=people.get(row.acceptor_id),
            next_actor_label=('Принимает: '+people.get(row.acceptor_id,'Не назначен')) if row.status=='in_acceptance' else people.get(row.assignee_id,'Не назначен'),
            is_overdue=active and bool(row.due_date and row.due_date<today),
            return_feedback_present=bool(active and h and h.before.get('status')=='in_acceptance' and h.after.get('status')=='in_progress'),
            checklist_progress={'done':sum(bool(x['completed']) for x in row.checklist or []),'total':len(row.checklist or [])},
            available_actions=[x['target'] for x in options if x['enabled']],transition_options=options,
            can_edit=can_edit and active,can_check=can_check,
            can_decide_assignment=row.status=='new' and row.assignment_state=='proposed' and work.editor(user,row.execution_team_id))
        data['next_step'] = next_step(row, data, people, teams.get(row.execution_team_id))
        data['readiness'] = readiness(row)
        output[row.id]=data
    return output


def read(db,user,filters,size=20,status=None,cursor=None,now=None,selected_id=None):
    if not settings.WORK_TASK_BOARD_ENABLED: fail(404,'board_disabled','Доска рабочих задач пока выключена')
    selection=Selection(db,user,filters,now)
    key=query_key(selection,user,size)
    counts=dict(selection.query.with_entities(W.status,func.count(W.id)).group_by(W.status).all())
    all_rows=[];descriptors=[]
    for code in ((status,) if status else STATUSES):
        included=selection.included(code)
        descriptor=dict(status=code,title=TITLES[code],state='included' if included else 'filtered',
            filter_reason=None if included else ('acceptance_collection' if filters.view=='acceptance' else 'status_filter'),
            total=counts.get(code,0) if included else None,items=[],range_start=0 if included else None,
            range_end=0 if included else None,next_cursor=None,previous_cursor=None)
        descriptors.append(descriptor)
        if not included: continue
        query=selection.query.filter(W.status==code)
        payload=decode(cursor,key,code,size,selection.now) if cursor and status else None
        before=bool(payload and payload['direction']=='previous')
        page=query
        if payload: page=page.filter(boundary(selection.keys,payload['keys'],before))
        selected=page.with_entities(W,*[key.label(f'board_key_{i}') for i,key in enumerate(selection.keys)]).order_by(*[x.desc() if before else x.asc() for x in selection.keys]).limit(size).all()
        if before: selected.reverse()
        rows=[x[0] for x in selected];all_rows.extend(rows)
        descriptor['_ids']=[r.id for r in rows]
        if selected:
            start=query.filter(boundary(selection.keys,list(selected[0][1:]),True)).count() if payload else 0
            descriptor.update(range_start=start+1,range_end=start+len(rows))
            def token(item,direction):
                return encode(dict(query=key,status=code,size=size,keys=list(item[1:]),direction=direction,at=selection.now.timestamp()))
            if start: descriptor['previous_cursor']=token(selected[0],'previous')
            if start+len(rows)<descriptor['total']: descriptor['next_cursor']=token(selected[-1],'next')
    projected=cards(db,all_rows,user,selection.today)
    for d in descriptors: d['items']=[projected[i] for i in d.pop('_ids',[])]
    envelope=dict(query_key=key,snapshot_at=selection.now.astimezone(timezone.utc),timezone='Europe/Moscow',filters=filters.model_dump())
    if status: return {**envelope,'column':descriptors[0]}
    collections,summary=selection.aggregates()
    return {**envelope,'columns':descriptors[:5],'cancelled':descriptors[5],
        'selected_matches':bool(selection.query.filter(W.id==selected_id).count()) if selected_id else None,
        'total':sum(d['total'] or 0 for d in descriptors),'collection_counts':collections,'summary':summary,'focus_counts':selection.focus_counts(),'summary_states':selection.summary_states()}
