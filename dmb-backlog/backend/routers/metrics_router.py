"""Authenticated Metric KR API. All mutations lock/version the owning aggregate."""
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import uuid4
from typing import Literal
from fastapi import APIRouter, Depends, Query, Header, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from fastapi.encoders import jsonable_encoder
from sqlalchemy import or_, and_, exists
from sqlalchemy.orm import Session
from database import get_db
from auth import get_current_user, require_non_business_customer_access, can_access_task, task_read_scope_clause, get_task_action_scope, is_customer_portal_only
from models import User, Team, Project, Priority, BusinessCustomer, Department, DidClientGroup, Task, WorkTask, ReportingMeeting, TaskAttachment
from metric_models import Metric, MetricPeriod, MetricMeasurement, MetricComment, MetricLink, MetricFile, MetricReportingStatus
from metric_contract import Passport, PassportUpdate, PeriodCommand, MeasurementCommand, Transition, CommentCommand, LinkCommand, ReportCommand, Version, ArchiveCommand
from services import metric_service as service
from services.metric_rules import today, summarize
from services import work_tasks
from config import settings
from idempotency import reserve_idempotency

router=APIRouter(prefix='/metrics',dependencies=[Depends(require_non_business_customer_access)])

def saved(db,row,user):
    service.commit(db)
    return service.detail(db,row,user)

@router.get('/options')
def options(db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    def rows(model):
        return [dict(id=x.id,name=x.name) for x in db.query(model).order_by(model.name)]
    t=today();quarter=(t.month-1)//3+1
    start=date(t.year,quarter*3-2,1)
    from services.metric_rules import add_months
    from datetime import timedelta
    end=add_months(start,3)-timedelta(days=1)
    current=f'{start}|{end}'
    periods={current:dict(key=current,label=f'{quarter} квартал {t.year}',start_date=start,end_date=end)}
    pairs=db.query(MetricPeriod).join(Metric,Metric.id==MetricPeriod.metric_id).filter(task_read_scope_clause(user,Metric)).order_by(MetricPeriod.start_date.desc()).all()
    for p in pairs:
        key=f'{p.start_date}|{p.end_date}'
        periods.setdefault(key,dict(key=key,label=p.label,start_date=p.start_date,end_date=p.end_date))
    return jsonable_encoder(dict(today=t,current_period=current,periods=list(periods.values()),
        teams=rows(Team),projects=rows(Project),priorities=rows(Priority),business_customers=rows(BusinessCustomer),
        departments=rows(Department),did_client_groups=rows(DidClientGroup),
        users=[dict(id=x.id,name=x.name,team_id=x.team_id) for x in db.query(User).filter_by(is_active=True).order_by(User.name) if not is_customer_portal_only(x)],
        meetings=[dict(id=x.id,kind=x.kind,scheduled_date=x.scheduled_date,state=x.state) for x in db.query(ReportingMeeting).filter(ReportingMeeting.state.in_(['planned','held'])).order_by(ReportingMeeting.scheduled_date.desc())],
        can_create=get_task_action_scope(user,'edit')=='all' or (get_task_action_scope(user,'edit')=='team' and user.team_id is not None),
        edit_scope=get_task_action_scope(user,'edit'),user_id=user.id,team_id=user.team_id))

@router.get('')
def listing(period:str=Query('',max_length=30),q:str=Query('',max_length=200),
            team_id:str|None=None,owner_id:str|None=None,project_id:str|None=None,
            state:str='',
            scope:Literal['all','mine']='all',
            attention:str='',
            archived:bool=False,sort:Literal['title','updated','due','progress']='title',
            page:int=Query(1,ge=1),per_page:int=Query(25,ge=1,le=100),
            db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    if not period:
        t=today();start=date(t.year,((t.month-1)//3)*3+1,1)
        from services.metric_rules import add_months
        from datetime import timedelta
        end=add_months(start,3)-timedelta(days=1)
    else:
        try:
            a,b=period.split('|');start=date.fromisoformat(a);end=date.fromisoformat(b)
            if start>end: raise ValueError()
        except ValueError: raise HTTPException(422,'Неверный период фильтра')
    join=and_(MetricPeriod.metric_id==Metric.id,MetricPeriod.start_date==start,MetricPeriod.end_date==end)
    query=db.query(Metric,MetricPeriod).outerjoin(MetricPeriod,join).filter(
        Metric.is_archived==archived,task_read_scope_clause(user,Metric),
        or_(archived,MetricPeriod.id.isnot(None),~exists().where(MetricPeriod.metric_id==Metric.id).correlate(Metric)))
    from services.filter_values import filter_values
    for key,value in [('team_id',team_id),('owner_id',owner_id),('project_id',project_id)]:
        selected=filter_values(value,numeric=True)
        if selected:query=query.filter(getattr(Metric,key).in_(selected))
    if q:
        pattern='%'+q.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
        numeric=q.upper().removeprefix('MET-')
        user_ids=db.query(User.id).filter(User.name.ilike(pattern,escape='\\'))
        query=query.filter(or_(Metric.title.ilike(pattern,escape='\\'),Metric.owner_id.in_(user_ids),Metric.id==int(numeric) if numeric.isdigit() else False))
    states=filter_values(state,allowed={'draft','active','completed','cancelled'})
    if states:query=query.filter(or_(MetricPeriod.state.in_(states),and_(MetricPeriod.id.is_(None),'draft' in states)))
    base=query.all()
    ids=[p.id for m,p in base if p]
    points=db.query(MetricMeasurement).filter(MetricMeasurement.period_id.in_(ids)).all() if ids else []
    by_period={}
    for x in points:by_period.setdefault(x.period_id,[]).append(x)
    items=[]
    for m,p in base:
        item=service.passport(db,m,user)
        item['period']=service.period_response(p,by_period.get(p.id,[])) if p else None
        items.append(item)
    def summary(x):
        return x['period']['summary'] if x['period'] else dict(achieved=False,freshness='draft',progress=None,next_due=None)
    if scope=='mine':items=[x for x in items if x['owner_id']==user.id]
    counts=dict(active=sum(bool(x['period'] and x['period']['state']=='active') for x in items),
        achieved=sum(bool(x['period'] and x['period']['direction']!='range' and summary(x)['achieved']) for x in items),
        overdue=sum(summary(x)['freshness']=='overdue' for x in items),
        missing=sum(bool(x['period'] and x['period']['state']=='active' and summary(x)['fact'] is None) for x in items))
    attention_values=filter_values(attention,allowed={'active','achieved','overdue','missing'})
    if attention_values:
        items=[x for x in items if
            ('active' in attention_values and x['period'] and x['period']['state']=='active') or
            ('achieved' in attention_values and x['period'] and x['period']['direction']!='range' and summary(x)['achieved']) or
            ('overdue' in attention_values and summary(x)['freshness']=='overdue') or
            ('missing' in attention_values and x['period'] and x['period']['state']=='active' and summary(x)['fact'] is None)]
    if sort=='title':items.sort(key=lambda x:(x['title'].casefold(),x['id']))
    elif sort=='updated':items.sort(key=lambda x:(x['updated_at'],x['id']),reverse=True)
    elif sort=='due':items.sort(key=lambda x:(summary(x)['next_due'] or '9999-12-31',x['id']))
    else:items.sort(key=lambda x:(summary(x)['progress'] is None,-(summary(x)['progress'] or 0),x['id']))
    total=len(items)
    return dict(items=items[(page-1)*per_page:page*per_page],total=total,page=page,pages=max(1,(total+per_page-1)//per_page),summary=counts)

@router.get('/legacy/{task_id}')
def legacy(task_id:int,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=db.query(Metric).filter(Metric.legacy_task_id==task_id,task_read_scope_clause(user,Metric)).first()
    return {'metric_id':row.id if row else None}

@router.get('/targets')
def targets(kind:Literal['task','work']='task',q:str=Query('',max_length=200),db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    model=Task if kind=='task' else WorkTask
    query=db.query(model).filter(model.is_deleted.is_(False),task_read_scope_clause(user,Task) if kind=='task' else work_tasks.read_scope(user))
    if kind=='task':query=query.filter(Task.metric_id.is_(None))
    if q:
        pattern='%'+q.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
        query=query.filter(model.title.ilike(pattern,escape='\\'))
    return {'items':[dict(id=x.id,public_id=x.public_id,title=x.title) for x in query.order_by(model.id.desc()).limit(30)]}

@router.post('',status_code=201)
def create(req:Passport,idempotency_key:str|None=Header(None,min_length=8,max_length=64),db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    values=req.model_dump()
    scope=type('Scope',(),{'team_id':req.team_id})()
    service.require(can_access_task('edit',scope,user))
    service.validate_refs(db,values)
    reservation,fresh=reserve_idempotency(db,operation='metric.create',user_id=user.id,request_key=idempotency_key,request_data=req.model_dump(mode='json'))
    if reservation and not fresh:return service.detail(db,service.get_metric(db,reservation.resource_id,user),user)
    row=Metric(**values,created_by=user.id,version=1)
    db.add(row);db.flush()
    service.record(db,row,user,'created',after=values)
    if reservation:reservation.resource_type='metric';reservation.resource_id=row.id;reservation.resource_version=row.version
    return saved(db,row,user)

@router.get('/{metric_id}')
def detail(metric_id:int,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    return service.detail(db,service.get_metric(db,metric_id,user),user)

@router.patch('/{metric_id}')
def update(metric_id:int,req:PassportUpdate,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=service.command(db,metric_id,user,req.version)
    service.require(can_access_task('edit',row,user,req.team_id))
    values=req.model_dump(exclude={'version','reason'})
    service.validate_refs(db,values)
    if row.unit!=req.unit:
        has_data=db.query(MetricMeasurement.id).join(MetricPeriod).filter(MetricPeriod.metric_id==row.id).first()
        has_period=db.query(MetricPeriod.id).filter(MetricPeriod.metric_id==row.id,or_(MetricPeriod.state!='draft',MetricPeriod.legacy_fact.isnot(None))).first()
        service.require(not has_data and not has_period,'Единицу измерения нельзя менять после ввода измерений; создайте новую метрику',422)
    before=service.snapshot(row)
    for key,value in values.items():setattr(row,key,value)
    service.record(db,row,user,'passport',before,values,req.reason)
    return saved(db,row,user)

@router.post('/{metric_id}/archive')
def archive(metric_id:int,req:ArchiveCommand,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=service.command(db,metric_id,user,req.version,allow_archived=True)
    if req.archive:service.require(not db.query(MetricPeriod).filter_by(metric_id=row.id,state='active').first(),'Сначала завершите или отмените активные периоды',422)
    before=row.is_archived;row.is_archived=req.archive
    service.record(db,row,user,'archive',{'is_archived':before},{'is_archived':req.archive},req.reason)
    return saved(db,row,user)

@router.post('/{metric_id}/periods',status_code=201)
def create_period(metric_id:int,req:PeriodCommand,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=service.command(db,metric_id,user,req.version)
    p=MetricPeriod(metric_id=row.id,state='draft',**req.model_dump(exclude={'version','reason'}))
    service.validate_period(db,row,p)
    db.add(p);db.flush()
    service.record(db,row,user,'period_created',after=service.snapshot(p),period=p)
    return saved(db,row,user)

@router.patch('/{metric_id}/periods/{period_id}')
def update_period(metric_id:int,period_id:int,req:PeriodCommand,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=service.command(db,metric_id,user,req.version);p=service.get_period(db,row,period_id)
    service.require(p.state in ('draft','active'),'Закрытый период нельзя редактировать',409)
    if p.state=='active':service.require(bool(req.reason),'Укажите причину изменения цели или графика',422)
    values=req.model_dump(exclude={'version','reason'});before=service.snapshot(p)
    points=db.query(MetricMeasurement).filter_by(period_id=p.id).all()
    service.require(all(req.start_date<=x.measured_on<=req.end_date for x in points),'Новые границы исключают существующие измерения',422)
    for key,value in values.items():setattr(p,key,value)
    service.validate_period(db,row,p,active=p.state=='active',exclude_id=p.id)
    service.record(db,row,user,'period_updated',before,values,req.reason,p)
    return saved(db,row,user)

@router.post('/{metric_id}/periods/{period_id}/transition')
def transition(metric_id:int,period_id:int,req:Transition,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=service.command(db,metric_id,user,req.version);p=service.get_period(db,row,period_id)
    before=service.snapshot(p)
    if req.action=='activate':
        service.require(p.state=='draft','Активировать можно только черновик',409)
        service.validate_period(db,row,p,active=True,exclude_id=p.id)
        p.state='active';p.method_snapshot=row.method;p.source_snapshot=row.source;p.unit_snapshot=row.unit
    elif req.action=='reopen':
        service.require(p.state in ('completed','cancelled'),'Период не закрыт',409)
        service.require(bool(req.reason),'Укажите причину открытия периода',422)
        service.validate_period(db,row,p,active=True,exclude_id=p.id)
        p.state='active';p.closed_at=None;p.outcome=None;p.closing_note=''
    else:
        service.require(p.state=='active' or req.action=='cancel' and p.state=='draft','Этот переход недоступен',409)
        service.require(bool(req.reason),'Укажите итог или причину',422)
        points=db.query(MetricMeasurement).filter_by(period_id=p.id).all()
        service.require(req.action=='cancel' or points or req.confirm_no_data,'Подтвердите завершение без измерений',422)
        p.outcome=summarize(p,points)['outcome'];p.state='completed' if req.action=='complete' else 'cancelled'
        p.closed_at=datetime.now(timezone.utc);p.closing_note=req.reason
    service.record(db,row,user,req.action,before,service.snapshot(p),req.reason,p)
    return saved(db,row,user)

def measurement_values(db,row,p,req,exclude_id=None):
    service.require(p.state=='active','Измерения доступны только в активном периоде',409)
    service.require(p.start_date<=req.measured_on<=p.end_date and req.measured_on<=today(),'Дата измерения должна быть внутри периода и не в будущем',422)
    query=db.query(MetricMeasurement).filter_by(period_id=p.id,measured_on=req.measured_on)
    if exclude_id:query=query.filter(MetricMeasurement.id!=exclude_id)
    service.require(not query.first(),'На эту дату уже есть измерение. Исправьте существующую запись.',409)
    return req.model_dump(exclude={'version','reason'})

@router.post('/{metric_id}/periods/{period_id}/measurements',status_code=201)
def add_measurement(metric_id:int,period_id:int,req:MeasurementCommand,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=service.command(db,metric_id,user,req.version);p=service.get_period(db,row,period_id)
    values=measurement_values(db,row,p,req)
    point=MetricMeasurement(period_id=p.id,author_id=user.id,**values);db.add(point);db.flush()
    service.record(db,row,user,'measurement_added',after=service.snapshot(point),period=p)
    return saved(db,row,user)

@router.patch('/{metric_id}/measurements/{measurement_id}')
def correct_measurement(metric_id:int,measurement_id:int,req:MeasurementCommand,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=service.command(db,metric_id,user,req.version)
    point=db.query(MetricMeasurement).join(MetricPeriod).filter(MetricMeasurement.id==measurement_id,MetricPeriod.metric_id==row.id).first()
    service.require(point is not None,'Измерение недоступно',404)
    service.require(bool(req.reason),'Укажите причину исправления',422)
    p=service.get_period(db,row,point.period_id)
    values=measurement_values(db,row,p,req,point.id);before=service.snapshot(point)
    for key,value in values.items():setattr(point,key,value)
    point.updated_at=datetime.now(timezone.utc)
    service.record(db,row,user,'measurement_corrected',before,service.snapshot(point),req.reason,p)
    return saved(db,row,user)

@router.post('/{metric_id}/comments',status_code=201)
def comment(metric_id:int,req:CommentCommand,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=service.command(db,metric_id,user,req.version,action='comment')
    x=MetricComment(metric_id=row.id,author_id=user.id,text=req.text);db.add(x)
    service.record(db,row,user,'comment',after={'text':req.text})
    return saved(db,row,user)

@router.post('/{metric_id}/links',status_code=201)
def link(metric_id:int,req:LinkCommand,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=service.command(db,metric_id,user,req.version)
    if req.kind=='task':
        target=db.get(Task,req.target_id)
        service.require(target and not target.is_deleted and target.metric_id is None and can_access_task('read',target,user),'Задача недоступна',404)
    else:target=work_tasks.get_work(db,req.target_id,user)
    values={'task_id':target.id} if req.kind=='task' else {'work_task_id':target.id}
    service.require(not db.query(MetricLink).filter_by(metric_id=row.id,**values).first(),'Связь уже существует',409)
    db.add(MetricLink(metric_id=row.id,created_by=user.id,**values))
    service.record(db,row,user,'linked',after=values)
    return saved(db,row,user)

@router.delete('/{metric_id}/links/{link_id}')
def unlink(metric_id:int,link_id:int,version:int=Query(...,ge=1),db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=service.command(db,metric_id,user,version)
    x=db.query(MetricLink).filter_by(id=link_id,metric_id=row.id).first()
    service.require(x is not None,'Связь недоступна',404)
    before=service.snapshot(x);db.delete(x)
    service.record(db,row,user,'unlinked',before=before)
    return saved(db,row,user)

@router.post('/{metric_id}/reports')
def report(metric_id:int,req:ReportCommand,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=service.command(db,metric_id,user,req.version);p=service.get_period(db,row,req.period_id)
    meeting=db.query(ReportingMeeting).filter_by(id=req.meeting_id).with_for_update().first()
    service.require(meeting and meeting.state=='planned','Выберите запланированную встречу',422)
    x=db.query(MetricReportingStatus).filter_by(period_id=p.id,meeting_id=meeting.id).first()
    before=service.snapshot(x) if x else {}
    points=db.query(MetricMeasurement).filter_by(period_id=p.id).all()
    if not x:x=MetricReportingStatus(metric_id=row.id,period_id=p.id,meeting_id=meeting.id);db.add(x)
    x.text=req.text;x.snapshot=service.period_response(p,points);x.author_id=user.id;x.updated_at=datetime.now(timezone.utc)
    service.record(db,row,user,'report',before,{'meeting_id':meeting.id,'text':req.text,'snapshot':x.snapshot},period=p)
    return saved(db,row,user)

@router.post('/{metric_id}/files',status_code=201)
def upload(metric_id:int,version:int=Form(...,ge=1),measurement_id:int|None=Form(None),file:UploadFile=File(...),db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    from routers.task_collaboration_router import BLOCKED_ATTACHMENT_EXTENSIONS, MAX_FILE_SIZE, _validate_attachment_signature
    from attachment_scanner import scan_file, MalwareDetectedError
    row=service.command(db,metric_id,user,version)
    if measurement_id:
        point=db.query(MetricMeasurement).join(MetricPeriod).filter(MetricMeasurement.id==measurement_id,MetricPeriod.metric_id==row.id).first()
        service.require(point is not None,'Измерение недоступно',404)
    filename=Path((file.filename or 'file').replace('\\','/')).name[:255]
    extension=Path(filename).suffix.lower()
    service.require(len(extension)<=16 and extension not in BLOCKED_ATTACHMENT_EXTENSIONS,'Этот тип файла запрещён',422)
    folder=settings.ATTACHMENT_STORAGE_DIR.resolve()/'metrics';folder.mkdir(parents=True,exist_ok=True)
    key=uuid4().hex+extension;path=folder/key;size=0;header=b''
    try:
        with path.open('xb') as output:
            while chunk:=file.file.read(1024*1024):
                size+=len(chunk)
                service.require(size<=MAX_FILE_SIZE,'Максимальный размер файла — 50 МБ',413)
                header=(header+chunk)[:16];output.write(chunk)
        _validate_attachment_signature(extension,header)
        try:scan_file(str(path),settings.CLAMAV_HOST or '',settings.CLAMAV_PORT,settings.CLAMAV_TIMEOUT_SECONDS)
        except MalwareDetectedError:raise HTTPException(422,'Файл отклонён антивирусом')
        except OSError:raise HTTPException(503,'Проверка файла временно недоступна')
        db.add(MetricFile(metric_id=row.id,measurement_id=measurement_id,author_id=user.id,filename=filename,storage_key=key,size=size))
        service.record(db,row,user,'file_added',after={'filename':filename,'size':size,'measurement_id':measurement_id})
        return saved(db,row,user)
    except Exception:
        db.rollback();path.unlink(missing_ok=True);raise

@router.get('/{metric_id}/files/{file_id}/download')
def download(metric_id:int,file_id:int,legacy:bool=False,db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=service.get_metric(db,metric_id,user)
    if legacy:
        f=db.query(TaskAttachment).filter_by(id=file_id,task_id=row.legacy_task_id).first() if row.legacy_task_id else None
        service.require(f is not None,'Файл недоступен',404)
        folder=settings.ATTACHMENT_STORAGE_DIR.resolve()/str(row.legacy_task_id)
        path=(folder/f.filename).resolve();filename=f.original_name
    else:
        f=db.query(MetricFile).filter_by(id=file_id,metric_id=row.id,is_deleted=False).first()
        service.require(f is not None,'Файл недоступен',404)
        folder=settings.ATTACHMENT_STORAGE_DIR.resolve()/'metrics';path=(folder/f.storage_key).resolve();filename=f.filename
    service.require(path.is_relative_to(folder.resolve()) and path.is_file(),'Файл недоступен',404)
    return FileResponse(path,filename=filename,media_type='application/octet-stream',headers={'X-Content-Type-Options':'nosniff'})

@router.delete('/{metric_id}/files/{file_id}')
def remove_file(metric_id:int,file_id:int,version:int=Query(...,ge=1),db:Session=Depends(get_db),user:User=Depends(get_current_user)):
    row=service.command(db,metric_id,user,version)
    f=db.query(MetricFile).filter_by(id=file_id,metric_id=row.id,is_deleted=False).first()
    service.require(f is not None,'Файл недоступен',404)
    f.is_deleted=True
    service.record(db,row,user,'file_removed',before={'filename':f.filename,'file_id':f.id})
    return saved(db,row,user)
