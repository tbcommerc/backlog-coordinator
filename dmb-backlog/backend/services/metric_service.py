"""Metric aggregate policy, serialization and validation."""
from datetime import datetime, timezone
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from auth import can_access_task, get_task_action_scope, is_customer_portal_only, task_read_scope_clause
from models import (User, Team, Project, Priority, BusinessCustomer, Department, DidClientGroup, Task,
                    TaskHistory, TaskComment, TaskAttachment, TaskReportingStatus, TaskReportingStatusRevision, WorkTask, ReportingMeeting)
from metric_models import (Metric, MetricPeriod, MetricMeasurement, MetricHistory, MetricComment,
                           MetricLink, MetricFile, MetricReportingStatus)
from services.metric_rules import summarize, today
from services import work_tasks

def require(allowed, message='Действие недоступно', code=403):
    if not allowed: raise HTTPException(code, message)

def snapshot(row):
    return jsonable_encoder({c.name:getattr(row,c.name) for c in row.__table__.columns})

def get_metric(db, metric_id, user, lock=False):
    query = db.query(Metric).filter(Metric.id==metric_id, task_read_scope_clause(user,Metric))
    if lock: query=query.with_for_update()
    row=query.first()
    require(row is not None,'Метрика недоступна',404)
    return row

def get_period(db,row,period_id):
    period=db.query(MetricPeriod).filter_by(id=period_id,metric_id=row.id).first()
    require(period is not None,'Период недоступен',404)
    return period

def command(db,metric_id,user,version,action='edit',allow_archived=False):
    row=get_metric(db,metric_id,user,lock=True)
    require(can_access_task(action,row,user))
    require(allow_archived or not row.is_archived,'Метрика в архиве',409)
    require(row.version==version,'Метрика изменена другим пользователем. Обновите карточку; введённые данные сохранены в форме.',409)
    return row

def record(db,row,user,action,before=None,after=None,reason='',period=None):
    row.version += 1
    row.updated_at=datetime.now(timezone.utc)
    db.add(MetricHistory(metric_id=row.id,period_id=period.id if period else None,
        actor_id=user.id,action=action,before=jsonable_encoder(before or {}),
        after=jsonable_encoder(after or {}),reason=reason))

def commit(db):
    try: db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409,'Такая запись уже существует или связанный объект изменён. Обновите карточку.')

def validate_refs(db,values):
    for key,model in [('team_id',Team),('owner_id',User),('project_id',Project),('priority_id',Priority),
                      ('business_customer_id',BusinessCustomer),('department_id',Department),('did_client_group_id',DidClientGroup)]:
        value=values.get(key)
        if value is None: continue
        obj=db.get(model,value)
        require(obj is not None,'Недоступное значение поля '+key,422)
        if model is User: require(obj.is_active and not is_customer_portal_only(obj),'Выберите активного внутреннего владельца',422)
    for team_id in values.get('involved_team_ids',[]):
        require(db.get(Team,team_id) is not None,'Вовлечённая команда недоступна',422)

def validate_period(db,row,period,active=False,exclude_id=None):
    require(period.start_date<=period.end_date,'Неверные даты периода',422)
    overlaps=db.query(MetricPeriod).filter(MetricPeriod.metric_id==row.id,
        MetricPeriod.start_date<=period.end_date,MetricPeriod.end_date>=period.start_date)
    if exclude_id: overlaps=overlaps.filter(MetricPeriod.id!=exclude_id)
    require(not overlaps.first(),'Периоды одной метрики не должны пересекаться',422)
    if period.baseline_date:
        require(period.baseline_date<=period.start_date and period.baseline_date<=today(),'Дата базы должна быть не позже начала периода и сегодняшнего дня',422)
    if not active: return
    require(bool(row.title and row.unit and row.method.strip() and row.source.strip() and row.owner_id),'Заполните единицу, владельца, методику и источник метрики',422)
    owner=db.get(User,row.owner_id)
    require(owner and owner.is_active and not is_customer_portal_only(owner),'Владелец метрики неактивен',422)
    require(period.direction and period.target is not None and period.first_due_date,'Заполните направление, цель и график измерений',422)
    if period.direction=='range':
        require(period.upper is not None and period.upper>=period.target,'Укажите допустимые границы',422)
    else:
        require(period.baseline is not None and period.baseline_date is not None,'Укажите исходное значение и его дату',422)
        require((period.direction=='up' and period.target>period.baseline) or (period.direction=='down' and period.target<period.baseline),'Цель должна соответствовать направлению улучшения',422)
    require(period.cadence!='interval' or bool(period.interval_days),'Укажите интервал',422)

def name(db,model,id):
    obj=db.get(model,id) if id else None
    return obj.name if obj else None

def passport(db,row,user):
    data=snapshot(row)
    data.pop('legacy_snapshot',None)
    data.update(public_id=f'MET-{row.id:03d}',team=name(db,Team,row.team_id),owner=name(db,User,row.owner_id),
        project=name(db,Project,row.project_id),priority=name(db,Priority,row.priority_id),
        business_customer=name(db,BusinessCustomer,row.business_customer_id),
        department=name(db,Department,row.department_id),did_client_group=name(db,DidClientGroup,row.did_client_group_id),
        involved_teams=[{'id':i,'name':name(db,Team,i)} for i in row.involved_team_ids or []],
        permissions={a:can_access_task(a,row,user) for a in ['edit','comment','delete']})
    return data

def period_response(period,measurements):
    return {**snapshot(period),'summary':jsonable_encoder(summarize(period,measurements))}

def file_response(f):
    return dict(id=f.id,filename=f.filename,size=f.size,measurement_id=f.measurement_id,created_at=f.created_at)

def detail(db,row,user):
    data=passport(db,row,user)
    periods=db.query(MetricPeriod).filter_by(metric_id=row.id).order_by(MetricPeriod.start_date.desc()).all()
    points=db.query(MetricMeasurement).filter(MetricMeasurement.period_id.in_([p.id for p in periods])).order_by(MetricMeasurement.measured_on.desc()).all() if periods else []
    data['periods']=[period_response(p,[m for m in points if m.period_id==p.id]) for p in periods]
    data['measurements']=[{**snapshot(m),'author':name(db,User,m.author_id)} for m in points]
    data['comments']=[{**snapshot(x),'author':name(db,User,x.author_id)} for x in db.query(MetricComment).filter_by(metric_id=row.id).order_by(MetricComment.id)]
    data['history']=[{**snapshot(x),'author':name(db,User,x.actor_id)} for x in db.query(MetricHistory).filter_by(metric_id=row.id).order_by(MetricHistory.id.desc())]
    data['files']=[file_response(x) for x in db.query(MetricFile).filter_by(metric_id=row.id,is_deleted=False).order_by(MetricFile.id)]
    data['reports']=[]
    for x in db.query(MetricReportingStatus).filter_by(metric_id=row.id).order_by(MetricReportingStatus.id.desc()):
        meeting=db.get(ReportingMeeting,x.meeting_id)
        data['reports'].append({**snapshot(x),'meeting_kind':meeting.kind if meeting else None,'meeting_date':meeting.scheduled_date if meeting else None})
    data['links']=[]
    for x in db.query(MetricLink).filter_by(metric_id=row.id).order_by(MetricLink.id):
        if x.task_id:
            target=db.get(Task,x.task_id)
            if not target or target.is_deleted or not can_access_task('read',target,user): continue
            item=dict(kind='task',target_id=target.id,public_id=target.public_id,title=target.title,
                      state=target.status.name if target.status else '',team=name(db,Team,target.team_id))
        else:
            target=db.query(WorkTask).filter(WorkTask.id==x.work_task_id,WorkTask.is_deleted.is_(False),work_tasks.read_scope(user)).first()
            if not target: continue
            item=dict(kind='work',target_id=target.id,public_id=target.public_id,title=target.title,state=target.status,team=name(db,Team,target.execution_team_id))
        data['links'].append(dict(id=x.id,**item))
    data['legacy']=None
    if row.legacy_task_id:
        original=db.get(Task,row.legacy_task_id)
        data['legacy']={'task_id':row.legacy_task_id,'public_id':original.public_id if original else None,'snapshot':row.legacy_snapshot,
            'comments':[dict(id=x.id,text=x.text,parent_id=x.parent_id,created_at=x.created_at,author=name(db,User,x.user_id)) for x in db.query(TaskComment).filter_by(task_id=row.legacy_task_id).order_by(TaskComment.id)],
            'history':[dict(id=x.id,action=x.field_name,before=x.old_value,after=x.new_value,created_at=x.changed_at,author=name(db,User,x.changed_by)) for x in db.query(TaskHistory).filter_by(task_id=row.legacy_task_id).order_by(TaskHistory.id.desc())],
            'files':[dict(id=x.id,filename=x.original_name,size=x.file_size,created_at=x.created_at) for x in db.query(TaskAttachment).filter_by(task_id=row.legacy_task_id)],
            'reports':[{**snapshot(x),'revisions':[snapshot(r) for r in x.revisions]} for x in db.query(TaskReportingStatus).filter_by(task_id=row.legacy_task_id)]}
    return jsonable_encoder(data)
