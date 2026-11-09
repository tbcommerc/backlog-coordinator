"""Quarterly v2 API. Every write serializes on its metric and is idempotent."""
from datetime import datetime, timezone
from typing import Annotated
from fastapi import APIRouter, Depends, Header, Query, UploadFile, File, Form, Request, HTTPException
from fastapi.routing import APIRoute
from fastapi.exceptions import RequestValidationError
from sqlalchemy import or_
from sqlalchemy.orm import Session
from database import get_db
from auth import get_current_user, require_non_business_customer_access, can_access_task, task_read_scope_clause
from models import User
from metric_models import Metric, MetricPeriod, MetricMeasurement, MetricHistory, MetricComment, MetricFile, MetricLink, MetricReportingStatus
from metric_quarterly_models import YearSettings, PauseInterval
from metric_quarterly_contract import Create, Plan, Plans, Fact, Close, Revise, Reason, Lifecycle, Archive, Measurement, Settings, PassportPatch, Migrate, Comment, RatioPreview
from metric_contract import Version, LinkCommand, ReportCommand
from services import metric_service as legacy, metric_quarterly_service as s
from services.metric_rules import today
from services.filter_values import filter_values
from idempotency import reserve_idempotency
from routers.metrics_router import options as legacy_options

class QuarterlyRoute(APIRoute):
    def get_route_handler(self):
        original=super().get_route_handler()
        async def handler(request:Request):
            from config import settings
            if request.method not in ('GET','HEAD','OPTIONS') and not request.url.path.endswith('/migration-preview') and not settings.METRICS_QUARTERLY_WRITE_ENABLED:
                raise HTTPException(503,dict(code='quarterly_writes_disabled',message='Запись временно отключена; чтение и история доступны',fields={}))
            try:return await original(request)
            except RequestValidationError as exc:
                raise HTTPException(422,dict(code='invalid_command',message='Проверьте поля команды',fields={'.'.join(str(x) for x in e['loc'][1:]):'Недопустимое значение' for e in exc.errors()}))
            except HTTPException as exc:
                if isinstance(exc.detail,str):
                    raise HTTPException(exc.status_code,dict(code='forbidden' if exc.status_code==403 else 'not_found' if exc.status_code==404 else 'request_failed',message=exc.detail,fields={}),headers=exc.headers)
                if isinstance(exc.detail,dict) and exc.detail.get('code')=='idempotency_key_reused':exc.detail['code']='idempotency_conflict'
                raise
        return handler


router=APIRouter(prefix='/metrics',route_class=QuarterlyRoute,dependencies=[Depends(require_non_business_customer_access)])
DB=Annotated[Session,Depends(get_db)]
Actor=Annotated[User,Depends(get_current_user)]
Key=Annotated[str,Header(alias='Idempotency-Key',min_length=8,max_length=64)]


@router.get('/options')
def options(db:DB,user:Actor):
    data=legacy_options(db,user)
    data.update(business_date=today().isoformat(),result_types=['volume','change','threshold','range'],aggregations=['sum','last','ratio','none'])
    return data


@router.post('',status_code=201)
def create(req:Create,db:DB,user:Actor,key:Key):
    s.check(can_access_task('edit',type('Scope',(),{'team_id':req.team_id})(),user),'forbidden','Нет права создания',403)
    values=req.model_dump(exclude={'year','expected_quarters','plans','save_mode'})
    legacy.validate_refs(db,values)
    reservation,fresh=reserve_idempotency(db,operation='q2.create',user_id=user.id,request_key=key,request_data=req.model_dump(mode='json'))
    if not fresh:
        return s.detail(db,legacy.get_metric(db,reservation.resource_id,user),user,req.year)
    row=Metric(**values,created_by=user.id,version=1,model_version='quarterly_v2',lifecycle_state='draft')
    db.add(row);db.flush()
    db.add(YearSettings(metric_id=row.id,year=req.year,expected_quarters=req.expected_quarters,exclusions={},aggregation=req.annual_aggregation,scale=req.aggregation_scale))
    legacy.record(db,row,user,'metric_created',after=values)
    for plan in req.plans:s.upsert_plan(db,row,user,req.year,plan,force_draft=req.save_mode=='draft')
    if req.save_mode=='start':
        s.check(any(p.approve for p in req.plans),'incomplete_plan','Утвердите хотя бы один план')
        row.lifecycle_state='tracking';legacy.record(db,row,user,'metric_started')
    return s.finish(db,row,user,reservation,req.year)


@router.post('/ratio-preview')
def ratio_preview(req:RatioPreview,user:Actor):
    from decimal import localcontext
    s.check(req.denominator>0,'invalid_components','Знаменатель должен быть положительным')
    with localcontext() as ctx:
        ctx.prec=60
        return dict(value=s.canonical(req.numerator/req.denominator*req.scale))


@router.get('')
def listing(db:DB,user:Actor,year:int=Query(default=None,ge=1,le=9999),quarter:int=Query(default=None,ge=1,le=4),
            view:str='quarter',q:str=Query('',max_length=200),team_id:str='',owner_id:str='',project_id:str='',metric_state:str='',
            period_state:str='',attention:str='',scope:str='all',archived:bool=False,sort:str='title',page:int=Query(1,ge=1),per_page:int=Query(25,ge=1,le=100)):
    # These bounded OLTP projections do not benefit from compiling correlated
    # calendar predicates on every request. Keep the setting transaction-local.
    if db.get_bind().dialect.name=='postgresql':
        from sqlalchemy import text
        db.execute(text('SET LOCAL jit = off'))
    year=year or today().year;quarter=quarter or (today().month-1)//3+1
    s.check(view in ('quarter','year') and scope in ('all','mine') and sort in ('title','updated','due','progress'),'invalid_filter','Некорректный режим')
    query=db.query(Metric).filter(task_read_scope_clause(user,Metric),Metric.is_archived==archived)
    for name,value in [('team_id',team_id),('owner_id',owner_id),('project_id',project_id)]:
        selected=filter_values(value,numeric=True)
        if selected:query=query.filter(getattr(Metric,name).in_(selected))
    selected=filter_values(metric_state,allowed={'draft','tracking','paused'})
    if selected:query=query.filter(Metric.lifecycle_state.in_(selected))
    if scope=='mine':query=query.filter(Metric.owner_id==user.id)
    if q:
        pattern='%'+q.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
        numeric=q.upper().removeprefix('MET-')
        query=query.filter(or_(Metric.title.ilike(pattern,escape='\\'),Metric.owner_id.in_(db.query(User.id).filter(User.name.ilike(pattern,escape='\\'))),Metric.id==int(numeric) if numeric.isdigit() else False))
    states=filter_values(period_state,allowed={'draft','active','completed','cancelled'})
    from services.metric_quarterly_query import predicate,progress_order,due_order
    selected_attention=filter_values(attention,allowed={'missing_fact','awaiting_close','not_achieved','overdue'})
    from sqlalchemy import func,case
    attention_names=('missing_fact','awaiting_close','not_achieved','overdue')
    from services.metric_quarterly_query import attention_conditions
    from metric_quarterly_models import FactRevision
    conditions=attention_conditions()
    flags=db.query(MetricPeriod.metric_id,*(func.bool_or(conditions[a]).label(a) for a in attention_names)).join(Metric,Metric.id==MetricPeriod.metric_id).outerjoin(FactRevision,FactRevision.id==MetricPeriod.current_fact_revision_id).filter(MetricPeriod.model_version=='quarterly_v2',MetricPeriod.calendar_year==year)
    if view=='quarter':flags=flags.filter(MetricPeriod.quarter==quarter)
    if states:flags=flags.filter(MetricPeriod.state.in_(states))
    flags=flags.group_by(MetricPeriod.metric_id).subquery()
    counts=query.outerjoin(flags,flags.c.metric_id==Metric.id).with_entities(*(func.sum(case((flags.c[a],1),else_=0)) for a in attention_names),func.count(Metric.id)).one()
    summary={a:int(count or 0) for a,count in zip(attention_names,counts)}
    if states or selected_attention:query=query.filter(predicate(year,quarter,view,states,selected_attention))
    s.check(sort!='progress' or view=='quarter','invalid_sort','Числовой прогресс доступен только за квартал')
    total=query.count() if states or selected_attention else counts[-1]
    if sort=='progress':query=query.order_by(progress_order(year,quarter),Metric.id)
    elif sort=='updated':query=query.order_by(Metric.updated_at.desc(),Metric.id)
    elif sort=='due':
        query=query.order_by(due_order(year,quarter,view),Metric.id)
    else:query=query.order_by(Metric.title,Metric.id)
    from models import Team,Project
    from fastapi.responses import JSONResponse
    named=query.add_columns(User.name,Team.name,Project.name).add_entity(YearSettings).outerjoin(User,User.id==Metric.owner_id).outerjoin(Team,Team.id==Metric.team_id).outerjoin(Project,Project.id==Metric.project_id).outerjoin(YearSettings,(YearSettings.metric_id==Metric.id)&(YearSettings.year==year))
    rows=[]
    for row,owner_name,team_name,project_name,year_settings in named.offset((page-1)*per_page).limit(per_page).with_for_update(read=True,of=Metric):
        row._quarterly_names=dict(owner_id=owner_name,team_id=team_name,project_id=project_name);row._quarterly_settings=year_settings;rows.append(row)
    items=s.batch_details(db,rows,user,year,compact=True,quarter=quarter if view=='quarter' else None)
    return JSONResponse(dict(items=items,total=total,page=page,pages=max(1,(total+per_page-1)//per_page),summary=summary,business_date=today().isoformat()))


@router.get('/{mid}')
def detail(mid:int,db:DB,user:Actor,year:int=Query(default=None,ge=1,le=9999),period_id:int|None=None):
    return s.detail(db,legacy.get_metric(db,mid,user),user,year or today().year,period_id)


@router.patch('/{mid}')
def passport(mid:int,req:PassportPatch,db:DB,user:Actor,key:Key):
    row,res,fresh=s.begin(db,mid,user,req,key,'passport')
    if fresh:
        values=req.model_dump(exclude_unset=True,exclude={'version','reason'})
        s.check(all(values.get(k,True) is not None for k in ('title','team_id','unit','description','source','method','display_precision','tags','involved_team_ids')),'invalid_field','Обязательное поле не может быть null')
        legacy.validate_refs(db,values)
        s.check(can_access_task('edit',row,user,values.get('team_id',row.team_id)),'forbidden','Команда недоступна',403)
        if 'unit' in values and values['unit']!=row.unit:
            used=db.query(MetricPeriod.id).filter(MetricPeriod.metric_id==mid,or_(MetricPeriod.state!='draft',MetricPeriod.current_fact_revision_id.isnot(None))).first()
            s.check(not used,'unit_locked','После утверждения плана единица не меняется')
        before=s.snapshot(row)
        for k,v in values.items():setattr(row,k,v)
        legacy.record(db,row,user,'passport',before,values,req.reason)
    return s.finish(db,row,user,res)


@router.put('/{mid}/years/{year}/plans')
def plans(mid:int,year:int,req:Plans,db:DB,user:Actor,key:Key):
    row,res,fresh=s.begin(db,mid,user,req,key,f'plans.{year}')
    if fresh:
        settings=db.query(YearSettings).filter_by(metric_id=mid,year=year).first()
        s.check(settings is not None,'year_scope_required','Сначала задайте область ведения года')
        for plan in req.plans:
            s.check(plan.quarter in settings.expected_quarters and str(plan.quarter) not in settings.exclusions,'outside_scope','План вне области ведения')
            s.upsert_plan(db,row,user,year,plan)
    return s.finish(db,row,user,res,year)


@router.patch('/{mid}/years/{year}/settings')
def settings(mid:int,year:int,req:Settings,db:DB,user:Actor,key:Key):
    row,res,fresh=s.begin(db,mid,user,req,key,f'year-settings.{year}')
    if fresh:
        s.check(1<=year<=9999,'invalid_year','Некорректный год')
        settings=db.query(YearSettings).filter_by(metric_id=mid,year=year).first()
        periods=db.query(MetricPeriod).filter_by(metric_id=mid,calendar_year=year).all()
        for p in periods:
            s.check(p.quarter in req.expected_quarters and str(p.quarter) not in req.exclusions,'scope_has_data','Для квартала с планом используйте отмену')
        before=s.snapshot(settings) if settings else {}
        if not settings:settings=YearSettings(metric_id=mid,year=year);db.add(settings)
        settings.expected_quarters=req.expected_quarters;settings.exclusions=req.exclusions;settings.aggregation=req.aggregation;settings.scale=req.scale
        legacy.record(db,row,user,'year_scope_changed',before,req.model_dump(mode='json'),req.reason)
    return s.finish(db,row,user,res,year)


@router.put('/{mid}/periods/{pid}/fact')
def fact(mid:int,pid:int,req:Fact,db:DB,user:Actor,key:Key):
    row,res,fresh=s.begin(db,mid,user,req,key,f'fact.{pid}')
    p=s.period(db,row,pid)
    if fresh:s.write_fact(db,row,p,user,req)
    return s.finish(db,row,user,res,p.calendar_year)


def close_command(mid,pid,req,db,user,key,correction):
    row,res,fresh=s.begin(db,mid,user,req,key,f'{"correct" if correction else "close"}.{pid}')
    p=s.period(db,row,pid)
    s.owner(row,user)
    if fresh:
        s.check(p.state==('completed' if correction else 'active'),'invalid_transition','Недоступное состояние',409)
        s.check(today()>p.end_date,'period_not_ended','Квартал ещё не завершился')
        s.check(req.confirm_final,'confirmation_required','Подтвердите итог')
        s.check(req.as_of_date==p.end_date or req.confirm_early_as_of,'confirmation_required','Подтвердите более раннюю дату факта')
        if correction:s.check(bool(req.reason),'reason_required','Укажите причину исправления')
        s.write_fact(db,row,p,user,req,final=True);s.close_snapshot(db,row,p,user,req.reason or req.comment)
    return s.finish(db,row,user,res,p.calendar_year)


@router.post('/{mid}/periods/{pid}/close')
def close(mid:int,pid:int,req:Close,db:DB,user:Actor,key:Key):
    return close_command(mid,pid,req,db,user,key,False)


@router.post('/{mid}/periods/{pid}/fact-corrections')
def correct_fact(mid:int,pid:int,req:Close,db:DB,user:Actor,key:Key):
    return close_command(mid,pid,req,db,user,key,True)


@router.post('/{mid}/periods/{pid}/plan-revisions')
def revise(mid:int,pid:int,req:Revise,db:DB,user:Actor,key:Key):
    row,res,fresh=s.begin(db,mid,user,req,key,f'revise.{pid}');p=s.period(db,row,pid)
    s.owner(row,user)
    s.check(p.state=='completed','invalid_transition','Этот пересмотр доступен только закрытому кварталу',409)
    if fresh:
        s.check(req.quarter==p.quarter,'invalid_quarter','Квартал не совпадает')
        s.upsert_plan(db,row,user,p.calendar_year,req,closed=True)
    return s.finish(db,row,user,res,p.calendar_year)


@router.post('/{mid}/periods/{pid}/activate')
def activate(mid:int,pid:int,req:Version,db:DB,user:Actor,key:Key):
    row,res,fresh=s.begin(db,mid,user,req,key,f'activate.{pid}');p=s.period(db,row,pid)
    if fresh:
        s.check(p.state=='draft','invalid_transition','Утвердить можно только черновик',409)
        s.validate(db,row,p);p.state='active';s.save_plan(db,row,p,user,'Утверждение')
        legacy.record(db,row,user,'plan_activated',period=p)
    return s.finish(db,row,user,res,p.calendar_year)


@router.post('/{mid}/periods/{pid}/cancel')
def cancel(mid:int,pid:int,req:Reason,db:DB,user:Actor,key:Key):
    return transition(mid,pid,req,db,user,key,False)


@router.post('/{mid}/periods/{pid}/restore')
def restore(mid:int,pid:int,req:Reason,db:DB,user:Actor,key:Key):
    return transition(mid,pid,req,db,user,key,True)


def transition(mid,pid,req,db,user,key,restore):
    row,res,fresh=s.begin(db,mid,user,req,key,f'{"restore" if restore else "cancel"}.{pid}');p=s.period(db,row,pid)
    if restore:s.owner(row,user)
    if fresh:
        s.check(p.state in (('cancelled',) if restore else ('draft','active')),'invalid_transition','Недоступное состояние',409)
        if restore:s.validate(db,row,p)
        p.state='active' if restore else 'cancelled'
        if not restore:p.closing_note=req.reason
        legacy.record(db,row,user,'period_restored' if restore else 'period_cancelled',after={'state':p.state},reason=req.reason,period=p)
    return s.finish(db,row,user,res,p.calendar_year)


@router.post('/{mid}/lifecycle')
def lifecycle(mid:int,req:Lifecycle,db:DB,user:Actor,key:Key):
    row,res,fresh=s.begin(db,mid,user,req,key,'lifecycle')
    if fresh:
        expected={'start':'draft','pause':'tracking','resume':'paused'}[req.action]
        s.check(row.lifecycle_state==expected,'invalid_transition','Недоступный переход',409)
        if req.action=='start':
            periods=db.query(MetricPeriod).filter_by(metric_id=mid,model_version='quarterly_v2',state='active').all()
            s.check(bool(periods),'incomplete_plan','Утвердите хотя бы один план')
            for p in periods:s.validate(db,row,p)
        else:s.check(bool(req.reason),'reason_required','Укажите причину')
        if req.action=='pause':db.add(PauseInterval(metric_id=mid,start_date=today(),author_id=user.id,reason=req.reason))
        if req.action=='resume':
            for pause in db.query(PauseInterval).filter_by(metric_id=mid,end_date=None):pause.end_date=today()
        row.lifecycle_state='paused' if req.action=='pause' else 'tracking'
        legacy.record(db,row,user,{'start':'metric_started','pause':'metric_paused','resume':'metric_resumed'}[req.action],reason=req.reason)
    return s.finish(db,row,user,res)


@router.post('/{mid}/archive')
def archive(mid:int,req:Archive,db:DB,user:Actor,key:Key):
    row,res,fresh=s.begin(db,mid,user,req,key,'archive',allow_archived=True)
    if fresh:
        s.check(row.is_archived!=req.archive,'invalid_transition','Состояние уже установлено',409)
        if req.archive:s.check(not db.query(MetricPeriod.id).filter_by(metric_id=mid,state='active').first(),'invalid_transition','Сначала закройте или отмените активные периоды',409)
        before=s.snapshot(row);row.is_archived=req.archive
        if not req.archive and row.lifecycle_state!='draft':
            row.lifecycle_state='paused'
            if not db.query(PauseInterval.id).filter_by(metric_id=mid,end_date=None).first():db.add(PauseInterval(metric_id=mid,start_date=today(),author_id=user.id,reason=req.reason))
        legacy.record(db,row,user,'metric_archived' if req.archive else 'metric_restored',before,s.snapshot(row),req.reason)
    return s.finish(db,row,user,res)


@router.get('/{mid}/periods/{pid}/measurements')
def measurements(mid:int,pid:int,db:DB,user:Actor,page:int=Query(1,ge=1),per_page:int=Query(25,ge=1,le=100)):
    row=legacy.get_metric(db,mid,user);s.period(db,row,pid)
    query=db.query(MetricMeasurement).filter_by(period_id=pid)
    return dict(items=[s.snapshot(x) for x in query.order_by(MetricMeasurement.measured_on.desc(),MetricMeasurement.id).offset((page-1)*per_page).limit(per_page)],total=query.count(),page=page)


@router.post('/{mid}/periods/{pid}/plan-preview')
def plan_preview(mid:int,pid:int,req:Plan,db:DB,user:Actor):
    from types import SimpleNamespace
    from services.metric_quarterly_rules import validate_plan,result
    from metric_quarterly_models import FactRevision
    row=legacy.get_metric(db,mid,user);p=s.period(db,row,pid)
    proposed=SimpleNamespace(**{c.name:getattr(p,c.name) for c in p.__table__.columns})
    for k,v in req.model_dump(exclude={'reason','approve','confirm_revision','quarter'},exclude_unset=True).items():setattr(proposed,k,v)
    try:validate_plan(proposed,today())
    except ValueError as exc:s.check(False,'invalid_plan',str(exc))
    fact=db.get(FactRevision,p.current_fact_revision_id) if p.current_fact_revision_id else None
    return dict(before=result(p,fact.value if fact else None,p.state=='completed'),after=result(proposed,fact.value if fact else None,p.state=='completed'))


@router.get('/{mid}/periods/{pid}/observation-chart')
def observation_chart(mid:int,pid:int,db:DB,user:Actor):
    row=legacy.get_metric(db,mid,user);s.period(db,row,pid)
    return dict(items=[dict(date=day.isoformat(),value=s.canonical(value)) for day,value in db.query(MetricMeasurement.measured_on,MetricMeasurement.value).filter_by(period_id=pid).order_by(MetricMeasurement.measured_on)])


def measurement_command(mid,pid,measurement_id,req,db,user,key):
    row,res,fresh=s.begin(db,mid,user,req,key,f'measurement.{pid}.{measurement_id}')
    point=None
    if measurement_id:
        point=db.query(MetricMeasurement).join(MetricPeriod).filter(MetricMeasurement.id==measurement_id,MetricPeriod.metric_id==mid).first()
        s.check(point is not None,'not_found','Замер недоступен',404);pid=point.period_id
    p=s.period(db,row,pid)
    if fresh:
        if p.state=='completed' and point:s.owner(row,user)
        else:s.check(p.state=='active','invalid_transition','Замер недоступен в этом состоянии',409)
        if point:s.check(bool(req.reason),'reason_required','Укажите причину исправления')
        s.check(p.start_date<=req.measured_on<=min(p.end_date,today()),'invalid_date','Дата должна быть внутри квартала и не в будущем')
        s.check(p.result_type!='volume' or req.value>=0,'invalid_decimal','Объём не может быть отрицательным')
        duplicate=db.query(MetricMeasurement.id).filter_by(period_id=pid,measured_on=req.measured_on)
        if point:duplicate=duplicate.filter(MetricMeasurement.id!=point.id)
        found=duplicate.first()
        s.check(not found,'duplicate_measurement_date','На эту дату уже есть замер; откройте исправление',409,measurement_id=found[0] if found else None)
        source=req.source or p.source_snapshot
        s.check(bool(source),'missing_source','Укажите источник')
        before=s.snapshot(point) if point else {}
        if not point:point=MetricMeasurement(period_id=pid,author_id=user.id);db.add(point)
        point.value=req.value;point.measured_on=req.measured_on;point.source=source;point.comment=req.comment;point.updated_at=datetime.now(timezone.utc)
        db.flush();legacy.record(db,row,user,'measurement_corrected' if before else 'measurement_added',before,s.snapshot(point),req.reason,p)
    return s.finish(db,row,user,res,p.calendar_year)


@router.post('/{mid}/periods/{pid}/measurements',status_code=201)
def add_measurement(mid:int,pid:int,req:Measurement,db:DB,user:Actor,key:Key):
    return measurement_command(mid,pid,None,req,db,user,key)


@router.patch('/{mid}/measurements/{measurement_id}')
def correct_measurement(mid:int,measurement_id:int,req:Measurement,db:DB,user:Actor,key:Key):
    return measurement_command(mid,None,measurement_id,req,db,user,key)


@router.get('/{mid}/measurements/{measurement_id}')
def measurement_detail(mid:int,measurement_id:int,db:DB,user:Actor):
    legacy.get_metric(db,mid,user)
    point=db.query(MetricMeasurement).join(MetricPeriod).filter(MetricMeasurement.id==measurement_id,MetricPeriod.metric_id==mid).first()
    s.check(point is not None,'not_found','Замер недоступен',404)
    return s.snapshot(point)


@router.get('/{mid}/history')
def history(mid:int,db:DB,user:Actor,period_id:int|None=None,action:str='',page:int=Query(1,ge=1),per_page:int=Query(25,ge=1,le=100)):
    row=legacy.get_metric(db,mid,user)
    query=db.query(MetricHistory).filter_by(metric_id=mid)
    if period_id:legacy.get_period(db,row,period_id);query=query.filter_by(period_id=period_id)
    if action:query=query.filter_by(action=action)
    return dict(items=[s.snapshot(x) for x in query.order_by(MetricHistory.id.desc()).offset((page-1)*per_page).limit(per_page)],total=query.count(),page=page)


@router.get('/{mid}/legacy-periods/{pid}')
def legacy_period(mid:int,pid:int,db:DB,user:Actor,page:int=Query(1,ge=1),per_page:int=Query(25,ge=1,le=100)):
    row=legacy.get_metric(db,mid,user);p=legacy.get_period(db,row,pid)
    s.check(p.model_version=='legacy_v1','invalid_transition','Период использует квартальную модель',409)
    points=db.query(MetricMeasurement).filter_by(period_id=pid).order_by(MetricMeasurement.measured_on.desc()).all()
    return dict(period=legacy.period_response(p,points),items=[s.snapshot(x) for x in points[(page-1)*per_page:page*per_page]],total=len(points),page=page)


@router.post('/{mid}/migration-preview')
def migration_preview(mid:int,db:DB,user:Actor):
    from services.metric_quarterly_rules import quarter_dates
    row=legacy.get_metric(db,mid,user)
    items=[]
    for p in db.query(MetricPeriod).filter_by(metric_id=mid,model_version='legacy_v1').order_by(MetricPeriod.start_date):
        q=(p.start_date.month-1)//3+1
        exact=quarter_dates(p.start_date.year,q)==(p.start_date,p.end_date)
        last=db.query(MetricMeasurement).filter_by(period_id=p.id).order_by(MetricMeasurement.measured_on.desc()).first()
        items.append(dict(period=s.snapshot(p),recognized_quarter=q if exact else None,
            proposed_type='range' if p.direction=='range' else 'change' if p.baseline is not None else 'threshold',
            proposed_fact=s.snapshot(last) if last else None,undated_legacy_fact=s.canonical(p.legacy_fact),
            decisions=['confirm_final_with_reliable_date'] if p.state=='completed' else ['confirm_preliminary_fact'] if last else [],
            incompatibilities=[] if exact else ['non_calendar_period_requires_manual_coverage']))
    return dict(metric_id=mid,version=row.version,periods=items)


@router.post('/{mid}/migrate')
def migrate(mid:int,req:Migrate,db:DB,user:Actor,key:Key):
    from services.metric_quarterly_rules import quarter_dates
    row=legacy.get_metric(db,mid,user,lock=True)
    s.check(can_access_task('edit',row,user),'forbidden','Нет права изменения',403)
    reservation,fresh=reserve_idempotency(db,operation='q2.migrate',user_id=user.id,request_key=key,request_data={'metric_id':mid,**req.model_dump(mode='json')})
    if not fresh:return s.detail(db,row,user,today().year)
    s.check(row.version==req.version,'version_conflict','Данные изменились',409,current_version=row.version)
    for choice in req.choices:
        p=legacy.get_period(db,row,choice.period_id)
        s.check(p.model_version=='legacy_v1','invalid_transition','Период уже переведён',409)
        quarter=(p.start_date.month-1)//3+1;year=p.start_date.year
        if choice.coverage_plans:
            s.check(choice.coverage_year is not None and choice.fact is None,'invalid_coverage','Укажите год покрытия; прежний факт не переносится в новые кварталы')
            s.check(len({x.quarter for x in choice.coverage_plans})==len(choice.coverage_plans),'invalid_coverage','Кварталы не должны повторяться')
            year=choice.coverage_year
            settings=db.query(YearSettings).filter_by(metric_id=mid,year=year).first()
            if not settings:
                settings=YearSettings(metric_id=mid,year=year,expected_quarters=[1,2,3,4],exclusions={},aggregation=req.annual_aggregation,scale=100);db.add(settings);db.flush()
            for plan in choice.coverage_plans:
                start,end=quarter_dates(year,plan.quarter)
                s.check(start<=p.end_date and end>=p.start_date,'invalid_coverage','Квартал не пересекается с выбранным прежним периодом')
                s.check(plan.quarter in settings.expected_quarters and str(plan.quarter) not in settings.exclusions,'outside_scope','Квартал вне области ведения')
                s.check(not db.query(MetricPeriod.id).filter_by(metric_id=mid,calendar_year=year,quarter=plan.quarter).first(),'invalid_coverage','Квартальный план уже существует')
                s.upsert_plan(db,row,user,year,plan,allow_legacy_overlap=True)
            legacy.record(db,row,user,'model_migrated',s.snapshot(p),{'manual_coverage':choice.model_dump(mode='json'),'legacy_retained':True},req.reason,p)
            continue
        s.check(quarter_dates(year,quarter)==(p.start_date,p.end_date),'manual_coverage_required','Некалендарный период оставьте в прежней модели')
        original=s.snapshot(p)
        if p.state=='completed':
            s.owner(row,user)
            s.check(choice.fact is not None,'fact_required','Для переноса закрытия нужен достоверный итог')
            s.check(today()>p.end_date and choice.fact.confirm_final,'confirmation_required','Подтвердите итог завершившегося квартала')
            s.check(choice.fact.as_of_date==p.end_date or choice.fact.confirm_early_as_of,'confirmation_required','Подтвердите раннюю дату итога')
        p.model_version='quarterly_v2';p.calendar_year=year;p.quarter=quarter;p.result_type=choice.result_type
        p.source_snapshot=p.source_snapshot or row.source;p.unit_snapshot=p.unit_snapshot or row.unit;p.method_snapshot=p.method_snapshot or row.method
        s.validate(db,row,p,p.state!='draft')
        s.save_plan(db,row,p,user,req.reason)
        settings=db.query(YearSettings).filter_by(metric_id=mid,year=year).first()
        if not settings:
            settings=YearSettings(metric_id=mid,year=year,expected_quarters=[1,2,3,4],exclusions={},aggregation=req.annual_aggregation,scale=100);db.add(settings);db.flush()
        if choice.fact:
            s.write_fact(db,row,p,user,choice.fact,final=p.state=='completed')
            if p.state=='completed':s.close_snapshot(db,row,p,user,req.reason)
        legacy.record(db,row,user,'model_migrated',original,{'choice':choice.model_dump(mode='json'),'period':s.snapshot(p)},req.reason,p)
    db.flush()
    row.model_version='mixed' if db.query(MetricPeriod.id).filter_by(metric_id=mid,model_version='legacy_v1').first() else 'quarterly_v2'
    row.lifecycle_state='paused';db.add(PauseInterval(metric_id=mid,start_date=today(),author_id=user.id,reason=req.reason))
    return s.finish(db,row,user,reservation)


@router.get('/{mid}/comments')
def comments(mid:int,db:DB,user:Actor,period_id:int|None=None,page:int=Query(1,ge=1),per_page:int=Query(25,ge=1,le=100)):
    row=legacy.get_metric(db,mid,user)
    query=db.query(MetricComment).filter_by(metric_id=mid)
    if period_id:legacy.get_period(db,row,period_id);query=query.filter_by(period_id=period_id)
    return dict(items=[s.snapshot(x) for x in query.order_by(MetricComment.id.desc()).offset((page-1)*per_page).limit(per_page)],total=query.count(),page=page)


@router.post('/{mid}/comments',status_code=201)
def comment(mid:int,req:Comment,db:DB,user:Actor,key:Key):
    row=legacy.get_metric(db,mid,user,lock=True)
    s.check(can_access_task('comment',row,user) and not row.is_archived,'forbidden','Нет права комментирования',403)
    res,fresh=reserve_idempotency(db,operation='q2.comment',user_id=user.id,request_key=key,request_data={'metric_id':mid,**req.model_dump(mode='json')})
    if fresh:
        s.check(row.version==req.version,'version_conflict','Данные изменились',409,current_version=row.version)
        p=legacy.get_period(db,row,req.period_id) if req.period_id else None
        db.add(MetricComment(metric_id=mid,period_id=req.period_id,author_id=user.id,text=req.text))
        legacy.record(db,row,user,'comment',after={'text':req.text},period=p)
    return s.finish(db,row,user,res)


@router.get('/{mid}/files')
def files(mid:int,db:DB,user:Actor,period_id:int|None=None):
    row=legacy.get_metric(db,mid,user)
    query=db.query(MetricFile).filter_by(metric_id=mid,is_deleted=False)
    if period_id:legacy.get_period(db,row,period_id);query=query.filter_by(period_id=period_id)
    return dict(items=[legacy.file_response(f) | {'period_id':f.period_id} for f in query.order_by(MetricFile.id)])


@router.get('/{mid}/files/{file_id}/download')
def download(mid:int,file_id:int,db:DB,user:Actor,legacy_file:bool=False):
    from routers.metrics_router import download as existing_download
    return existing_download(mid,file_id,legacy_file,db,user)


@router.post('/{mid}/files',status_code=201)
def upload(mid:int,db:DB,user:Actor,key:Key,version:int=Form(...,ge=1),period_id:int|None=Form(None),measurement_id:int|None=Form(None),file:UploadFile=File(...)):
    from services.metric_attachment_storage import store_attachment
    from hashlib import sha256
    # Hash file content to bind retries to the exact upload; bounded spool stream.
    from routers.task_collaboration_router import MAX_FILE_SIZE
    digest=sha256();size=0
    while chunk:=file.file.read(1024*1024):
        size+=len(chunk)
        s.check(size<=MAX_FILE_SIZE,'file_too_large','Максимальный размер файла — 50 МБ',413)
        digest.update(chunk)
    file.file.seek(0)
    req=Version(version=version)
    row=legacy.get_metric(db,mid,user,lock=True)
    s.check(can_access_task('edit',row,user) and not row.is_archived,'forbidden','Нет права изменения',403)
    res,fresh=reserve_idempotency(db,operation='q2.file',user_id=user.id,request_key=key,request_data=dict(metric_id=mid,version=version,period_id=period_id,measurement_id=measurement_id,name=file.filename,hash=digest.hexdigest()))
    if not fresh:return s.detail(db,row,user,today().year)
    s.check(row.version==version,'version_conflict','Данные изменились',409,current_version=row.version)
    p=legacy.get_period(db,row,period_id) if period_id else None
    if measurement_id:
        point=db.query(MetricMeasurement).join(MetricPeriod).filter(MetricMeasurement.id==measurement_id,MetricPeriod.metric_id==mid).first()
        s.check(point is not None and (period_id is None or point.period_id==period_id),'not_found','Замер недоступен',404)
    path,values=store_attachment(file)
    try:
        db.add(MetricFile(metric_id=mid,period_id=period_id,measurement_id=measurement_id,author_id=user.id,**values))
        legacy.record(db,row,user,'file_added',after={'filename':values['filename'],'period_id':period_id},period=p)
        return s.finish(db,row,user,res)
    except Exception:db.rollback();path.unlink(missing_ok=True);raise


@router.delete('/{mid}/files/{file_id}')
def remove_file(mid:int,file_id:int,db:DB,user:Actor,key:Key,version:int=Query(...,ge=1)):
    row,res,fresh=s.begin(db,mid,user,Version(version=version),key,f'file-delete.{file_id}')
    if fresh:
        f=db.query(MetricFile).filter_by(id=file_id,metric_id=mid,is_deleted=False).first()
        s.check(f is not None,'not_found','Файл недоступен',404)
        f.is_deleted=True;legacy.record(db,row,user,'file_removed',before={'file_id':file_id,'filename':f.filename})
    return s.finish(db,row,user,res)


@router.get('/{mid}/links')
def links(mid:int,db:DB,user:Actor):
    from models import Task,WorkTask
    from services import work_tasks
    legacy.get_metric(db,mid,user);items=[]
    for x in db.query(MetricLink).filter_by(metric_id=mid):
        if x.task_id:
            target=db.get(Task,x.task_id)
            if not target or target.is_deleted or not can_access_task('read',target,user):continue
        else:
            target=db.query(WorkTask).filter(WorkTask.id==x.work_task_id,WorkTask.is_deleted.is_(False),work_tasks.read_scope(user)).first()
            if not target:continue
        items.append(dict(id=x.id,kind='task' if x.task_id else 'work',target_id=target.id,title=target.title,public_id=target.public_id))
    return dict(items=items)


@router.post('/{mid}/links')
def link(mid:int,req:LinkCommand,db:DB,user:Actor,key:Key):
    from models import Task
    from services import work_tasks
    row,res,fresh=s.begin(db,mid,user,req,key,'link')
    if fresh:
        if req.kind=='task':
            target=db.get(Task,req.target_id)
            s.check(target and not target.is_deleted and target.metric_id is None and can_access_task('read',target,user),'not_found','Задача недоступна',404)
        else:target=work_tasks.get_work(db,req.target_id,user)
        values={'task_id':target.id} if req.kind=='task' else {'work_task_id':target.id}
        s.check(not db.query(MetricLink).filter_by(metric_id=mid,**values).first(),'duplicate_link','Связь уже существует',409)
        db.add(MetricLink(metric_id=mid,created_by=user.id,**values));legacy.record(db,row,user,'linked',after=values)
    return s.finish(db,row,user,res)


@router.delete('/{mid}/links/{link_id}')
def unlink(mid:int,link_id:int,db:DB,user:Actor,key:Key,version:int=Query(...,ge=1)):
    row,res,fresh=s.begin(db,mid,user,Version(version=version),key,f'unlink.{link_id}')
    if fresh:
        x=db.query(MetricLink).filter_by(id=link_id,metric_id=mid).first();s.check(x is not None,'not_found','Связь недоступна',404)
        before=s.snapshot(x);db.delete(x);legacy.record(db,row,user,'unlinked',before=before)
    return s.finish(db,row,user,res)


@router.get('/{mid}/reports')
def reports(mid:int,db:DB,user:Actor):
    legacy.get_metric(db,mid,user)
    return dict(items=[s.snapshot(x) for x in db.query(MetricReportingStatus).filter_by(metric_id=mid).order_by(MetricReportingStatus.id.desc())])


@router.post('/{mid}/reports')
def report(mid:int,req:ReportCommand,db:DB,user:Actor,key:Key):
    from models import ReportingMeeting
    row,res,fresh=s.begin(db,mid,user,req,key,'report')
    if fresh:
        p=s.period(db,row,req.period_id)
        meeting=db.query(ReportingMeeting).filter_by(id=req.meeting_id).with_for_update().first()
        s.check(meeting and meeting.state=='planned','invalid_meeting','Выберите запланированную встречу')
        report=db.query(MetricReportingStatus).filter_by(period_id=p.id,meeting_id=meeting.id).first()
        before=s.snapshot(report) if report else {}
        if not report:report=MetricReportingStatus(metric_id=mid,period_id=p.id,meeting_id=meeting.id);db.add(report)
        report.text=req.text;report.author_id=user.id;report.snapshot=s.project_period(db,row,p,user);report.updated_at=datetime.now(timezone.utc)
        legacy.record(db,row,user,'report',before,{'meeting_id':meeting.id,'text':req.text,'snapshot':report.snapshot},period=p)
    return s.finish(db,row,user,res)
