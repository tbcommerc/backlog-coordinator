"""Versioned quarterly aggregate; reuse the existing authorization policy."""
from datetime import datetime, timezone, timedelta
from decimal import Decimal, localcontext
from fastapi import HTTPException
from sqlalchemy import func
from auth import can_access_task
from models import User
from metric_models import MetricPeriod, MetricMeasurement
from metric_quarterly_models import PlanRevision, FactRevision, ClosureRevision, YearSettings, PauseInterval
from services import metric_service as legacy
from services.metric_rules import today, due_dates
from services.metric_quarterly_rules import canonical, quarter_dates, validate_plan, result, annual, RULES_VERSION
from idempotency import reserve_idempotency


def check(ok, code, message, status=422, **extra):
    if not ok:
        field={'invalid_decimal':'value','missing_source':'source','reason_required':'reason','invalid_components':'denominator'}.get(code)
        fields=extra.pop('fields',({field:message} if field else {}))
        raise HTTPException(status, dict(code=code, message=message, fields=fields, **extra))


def snapshot(row):
    def encode(v):
        if isinstance(v, Decimal): return canonical(v)
        if hasattr(v, 'isoformat'): return v.isoformat()
        return v
    return {c.name: encode(getattr(row, c.name)) for c in row.__table__.columns}


def owner(row, user):
    check(row.owner_id == user.id and can_access_task('edit', row, user), 'owner_required', 'Подтверждение доступно владельцу с правом изменения', 403)


def begin(db, mid, user, req, key, operation, allow_archived=False):
    row = legacy.get_metric(db, mid, user, lock=True)
    check(can_access_task('edit', row, user), 'forbidden', 'Нет права изменения', 403)
    check(allow_archived or not row.is_archived, 'invalid_transition', 'Метрика в архиве', 409)
    check(row.model_version != 'legacy_v1', 'migration_required', 'Сначала подтвердите переход прежней модели', 409)
    reservation, fresh = reserve_idempotency(db, operation='q2.'+operation, user_id=user.id, request_key=key,
        request_data={'metric_id': mid, **req.model_dump(mode='json')})
    if not fresh:
        return row, reservation, False
    check(row.version == req.version, 'version_conflict', 'Данные изменились; сравните с актуальной версией', 409, current_version=row.version)
    return row, reservation, True


def finish(db, row, user, reservation, year=None):
    db.flush()
    if reservation:
        reservation.resource_type='metric'; reservation.resource_id=row.id; reservation.resource_version=row.version
    legacy.commit(db)
    return detail(db, row, user, year or today().year)


def period(db, row, pid):
    p = legacy.get_period(db, row, pid)
    check(p.model_version == 'quarterly_v2', 'migration_required', 'Период использует прежнюю модель', 409)
    return p


PLAN_FIELDS = ('result_type', 'direction', 'target', 'upper', 'baseline', 'baseline_date', 'cadence', 'interval_days', 'first_due_date', 'source_snapshot', 'method_snapshot', 'unit_snapshot')


def plan_data(p):
    data = snapshot(p)
    return {k: data[k] for k in PLAN_FIELDS}


def validate(db, row, p, active=True):
    try: validate_plan(p, today(), active)
    except ValueError as e:
        message=str(e)
        field='baseline_date' if 'Дата базы' in message else 'baseline' if 'баз' in message else 'upper' if 'границ' in message else 'target'
        check(False, 'invalid_plan', message, fields={field:message})
    if not active: return
    legacy.validate_refs(db, {'owner_id': row.owner_id})
    check(bool(row.owner_id and row.unit.strip() and row.source.strip()), 'incomplete_passport', 'Укажите владельца, единицу и источник')
    check(p.cadence == 'none' or p.first_due_date is not None, 'invalid_schedule', 'Укажите первый срок замера')
    check(p.cadence != 'interval' or p.interval_days is not None, 'invalid_schedule', 'Укажите интервал')
    check(not p.first_due_date or p.start_date <= p.first_due_date <= p.end_date, 'invalid_date', 'Срок замера вне квартала')


def save_plan(db, row, p, user, reason):
    previous = db.get(PlanRevision, p.current_plan_revision_id) if p.current_plan_revision_id else None
    revision = PlanRevision(period_id=p.id, revision_no=previous.revision_no+1 if previous else 1,
        previous_revision_id=previous.id if previous else None, data={**plan_data(p),'approval_state':p.state}, author_id=user.id, reason=reason)
    db.add(revision); db.flush(); p.current_plan_revision_id=revision.id
    return revision


def upsert_plan(db, row, user, year, req, force_draft=False, closed=False, allow_legacy_overlap=False):
    p = db.query(MetricPeriod).filter_by(metric_id=row.id, calendar_year=year, quarter=req.quarter).first()
    new = p is None
    if new:
        start, end = quarter_dates(year, req.quarter)
        overlap = db.query(MetricPeriod.id).filter_by(metric_id=row.id, model_version='legacy_v1').filter(MetricPeriod.start_date <= end, MetricPeriod.end_date >= start).first()
        check(not overlap or allow_legacy_overlap, 'migration_required', 'Пересечение с прежним периодом требует явного перехода', 409)
        p = MetricPeriod(metric_id=row.id, calendar_year=year, quarter=req.quarter, start_date=start, end_date=end,
            label=f'{req.quarter} квартал {year}', model_version='quarterly_v2', state='draft')
        db.add(p)
    check(p.state != 'cancelled', 'invalid_transition', 'Сначала восстановите отменённый период', 409)
    check(p.state != 'completed' or closed, 'invalid_transition', 'Закрытый план пересматривается отдельно', 409)
    before = plan_data(p) if not new else {}
    original_state=p.state
    if p.state == 'completed':
        owner(row,user); check(req.confirm_revision, 'confirmation_required', 'Подтвердите пересмотр закрытого плана')
    kind = req.result_type or p.result_type or row.preferred_result_type
    direction = req.direction or p.direction or row.default_direction or ('range' if kind == 'range' else 'up')
    has_data = p.current_fact_revision_id or (not new and db.query(MetricMeasurement.id).filter_by(period_id=p.id).first())
    if not new and (has_data or p.state == 'completed' or (p.state!='draft' and p.start_date <= today())):
        check(p.result_type == kind and p.direction == direction, 'invalid_transition', 'Изменение типа требует новой метрики', 409)
    for key in PLAN_FIELDS:
        if hasattr(req,key): setattr(p,key,getattr(req,key))
    p.result_type=kind; p.direction=direction
    if new or p.state == 'draft':
        p.source_snapshot=row.source; p.method_snapshot=row.method; p.unit_snapshot=row.unit
    approve = not force_draft and (req.approve or p.state != 'draft')
    validate(db,row,p,approve)
    if not new and original_state!='draft' and before==plan_data(p):return p
    if original_state!='draft':check(bool(req.reason), 'reason_required', 'Укажите причину пересмотра')
    if approve and p.state == 'draft': p.state='active'
    db.flush()
    revision=save_plan(db,row,p,user,req.reason)
    legacy.record(db,row,user,'plan_created' if new else 'plan_revised',before,{**plan_data(p),'revision_id':revision.id},req.reason,p)
    if p.state == 'completed': close_snapshot(db,row,p,user,req.reason)
    return p


def write_fact(db,row,p,user,req,final=False):
    check(p.state == ('completed' if final and p.state == 'completed' else 'active'), 'invalid_transition', 'Факт недоступен в этом состоянии',409)
    check(p.start_date <= req.as_of_date <= p.end_date and req.as_of_date <= today(), 'invalid_date', 'Дата факта должна быть внутри квартала и не в будущем')
    check(p.result_type != 'volume' or req.value >= 0, 'invalid_decimal', 'Объём не может быть отрицательным')
    source=req.source or p.source_snapshot
    check(bool(source and source.strip()), 'missing_source', 'Укажите источник')
    check((req.numerator is None) == (req.denominator is None), 'missing_components', 'Укажите обе исходные величины')
    if req.denominator is not None:
        settings=db.query(YearSettings).filter_by(metric_id=row.id,year=p.calendar_year).one()
        check(settings.aggregation == 'ratio' and req.denominator > 0, 'invalid_components', 'Компоненты доступны для ratio; знаменатель должен быть положительным')
        with localcontext() as ctx:
            ctx.prec=60
            check(abs(req.value-req.numerator/req.denominator*settings.scale) <= Decimal('0.0000000001'), 'invalid_components', 'Факт не совпадает с отношением компонентов')
    previous=db.get(FactRevision,p.current_fact_revision_id) if p.current_fact_revision_id else None
    values={k:getattr(req,k) for k in ('value','as_of_date','comment','numerator','denominator','source_measurement_id')}
    values.update(source=source,status='final' if final else 'preliminary')
    measurement_snapshot=None
    if previous and not req.source_measurement_id and req.value==previous.value and req.as_of_date==previous.as_of_date and source==previous.source:
        values['source_measurement_id']=previous.source_measurement_id
        measurement_snapshot=previous.source_measurement_snapshot
    if req.source_measurement_id:
        measurement=db.query(MetricMeasurement).filter_by(id=req.source_measurement_id,period_id=p.id).first()
        check(measurement is not None,'not_found','Замер недоступен',404)
        measurement_snapshot={k:snapshot(measurement)[k] for k in ('value','measured_on','source')}
        check(req.value == measurement.value or bool(req.comment), 'comment_required', 'Объясните отличие от замера')
    if previous and all(getattr(previous,k)==v for k,v in values.items()) and previous.source_measurement_snapshot==measurement_snapshot:
        return previous
    if previous and (previous.status=='final' or (req.as_of_date<=previous.as_of_date and (req.value!=previous.value or req.as_of_date!=previous.as_of_date))):
        check(bool(req.reason),'reason_required','Укажите причину исправления')
    revision=FactRevision(period_id=p.id,revision_no=previous.revision_no+1 if previous else 1,
        previous_revision_id=previous.id if previous else None,author_id=user.id,reason=req.reason,
        source_measurement_snapshot=measurement_snapshot,**values)
    db.add(revision);db.flush();p.current_fact_revision_id=revision.id
    legacy.record(db,row,user,'fact_corrected' if previous and req.reason else 'fact_updated' if previous else 'fact_recorded',
        snapshot(previous) if previous else {},snapshot(revision),req.reason,p)
    if measurement_snapshot: legacy.record(db,row,user,'measurement_used_as_fact',after={'revision_id':revision.id,'measurement_id':req.source_measurement_id},period=p)
    return revision


def observations(db,p):
    query=db.query(MetricMeasurement).filter_by(period_id=p.id)
    count,latest=query.with_entities(func.count(MetricMeasurement.id),func.max(MetricMeasurement.measured_on)).one()
    violations=[]
    if p.result_type=='range' and p.target is not None and p.upper is not None:
        violations=[d.isoformat() for d, in query.with_entities(MetricMeasurement.measured_on).filter((MetricMeasurement.value<p.target)|(MetricMeasurement.value>p.upper)).order_by(MetricMeasurement.measured_on)]
    return dict(count=count,latest_date=latest.isoformat() if latest else None,violation_count=len(violations) if p.result_type=='range' else None,violation_dates=violations)


def close_snapshot(db,row,p,user,comment):
    fact=db.get(FactRevision,p.current_fact_revision_id)
    data=dict(result=result(p,fact.value,True),observations=observations(db,p),rules_version=RULES_VERSION,
        confirmed_as_of_date=fact.as_of_date.isoformat(),early_date_confirmed=fact.as_of_date<p.end_date)
    closure=ClosureRevision(period_id=p.id,plan_revision_id=p.current_plan_revision_id,fact_revision_id=fact.id,
        previous_revision_id=p.closure_revision_id,author_id=user.id,snapshot=data,comment=comment)
    db.add(closure);db.flush();p.closure_revision_id=closure.id
    p.closed_at=p.closed_at or datetime.now(timezone.utc);p.state='completed';p.outcome=data['result']['outcome']
    legacy.record(db,row,user,'period_closed',after={'closure_revision_id':closure.id,**data},reason=comment,period=p)


def project_period(db,row,p,user,cache=None):
    fact=cache['facts'].get(p.current_fact_revision_id) if cache is not None else db.get(FactRevision,p.current_fact_revision_id) if p.current_fact_revision_id else None
    t=today();edit=can_access_task('edit',row,user) and not row.is_archived
    availability=p.state if p.state!='active' else 'planned' if t<p.start_date else 'awaiting_close' if t>p.end_date else 'active'
    caps=dict(write_fact=edit and p.state=='active' and t>=p.start_date,
        add_measurement=edit and p.state=='active' and t>=p.start_date,
        close=edit and row.owner_id==user.id and p.state=='active' and t>p.end_date,
        correct_final=edit and row.owner_id==user.id and p.state=='completed')
    reasons={k:('owner_required' if row.owner_id!=user.id and k in ('close','correct_final') else 'period_not_ended' if k=='close' and t<=p.end_date else 'operation_unavailable') for k,v in caps.items() if not v}
    mismatch=False
    if fact and fact.source_measurement_id:
        original=cache['sources'].get(fact.source_measurement_id) if cache is not None else db.get(MetricMeasurement,fact.source_measurement_id)
        mismatch=not original or {k:snapshot(original)[k] for k in ('value','measured_on','source')}!=fact.source_measurement_snapshot
    data=dict(id=p.id,year=p.calendar_year,quarter=p.quarter,state=p.state,availability=availability,model_version=p.model_version,
        start_date=p.start_date.isoformat(),end_date=p.end_date.isoformat(),plan={'revision_id':p.current_plan_revision_id,**plan_data(p)},
        fact=snapshot(fact) if fact else None,result=result(p,fact.value if fact else None,p.state=='completed'),
        observations=cache['observations'][p.id] if cache is not None else observations(db,p),capabilities=caps,disabled_reasons=reasons,source_measurement_changed=mismatch,
        closure_revision_id=p.closure_revision_id,closed_at=p.closed_at.isoformat() if p.closed_at else None)
    data['cancellation_reason']=p.closing_note if p.state=='cancelled' else None
    data['schedule']=schedule(db,row,p,cache)
    return data


def schedule(db,row,p,cache=None):
    if p.cadence=='none':return dict(missed_count=0,overdue=False,next_due=None)
    pauses=cache['pauses'].get(row.id,[]) if cache is not None else db.query(PauseInterval).filter_by(metric_id=row.id).all()
    dates=cache['dates'].get(p.id,[]) if cache is not None else [d for d, in db.query(MetricMeasurement.measured_on).filter_by(period_id=p.id)]
    missed=[];upcoming=[];previous=p.start_date-timedelta(days=1)
    for due in due_dates(p):
        excluded=any(x.start_date<=due and (x.end_date is None or due<=x.end_date) for x in pauses)
        covered=any(previous<d<=due for d in dates)
        if not excluded and not covered:
            (missed if due<today() else upcoming).append(due)
        previous=due
    control=row.lifecycle_state=='tracking' and p.state=='active' and p.start_date<=today() and not row.is_archived
    resumed=max((x.end_date for x in pauses if x.end_date is not None),default=None)
    current_missed=[d for d in missed if resumed is None or d>resumed]
    return dict(missed_count=len(missed),overdue=control and bool(current_missed),
        next_due=(current_missed or upcoming)[0].isoformat() if control and (current_missed or upcoming) else None)


def detail(db,row,user,year,period_id=None):
    selected=legacy.get_period(db,row,period_id) if period_id else None
    if selected and selected.model_version=='quarterly_v2': year=selected.calendar_year
    data=batch_details(db,[row],user,year)[0]
    data['selected_period_id']=period_id
    data['legacy']=legacy.legacy_materials(db,row)
    pids=[p['id'] for p in data['periods']]
    plans=db.query(PlanRevision).filter(PlanRevision.period_id.in_(pids)).order_by(PlanRevision.revision_no).all()
    closures=db.query(ClosureRevision).filter(ClosureRevision.period_id.in_(pids)).order_by(ClosureRevision.id).all()
    for p in data['periods']:
        p['original_plan']=next((snapshot(x) for x in plans if x.period_id==p['id'] and x.data.get('approval_state','active')!='draft'),None)
        p['closures']=[snapshot(x) for x in closures if x.period_id==p['id']]
        last=next((x for x in reversed(closures) if x.period_id==p['id']),None)
        p['observations_corrected_after_closure']=bool(last and db.query(MetricMeasurement.id).filter(MetricMeasurement.period_id==p['id'],MetricMeasurement.updated_at>last.created_at).first())
    return data


def batch_details(db,rows,user,year,compact=False,quarter=None):
    """Bounded page projection. No per-metric/per-period SQL or value history scan."""
    from collections import defaultdict
    from sqlalchemy import or_,case
    from metric_models import Metric
    from models import Team,Project
    if not rows:return []
    ids=[row.id for row in rows]
    # Share locks allow concurrent readers, while preventing writers changing pointers.
    if not compact:
        rows=db.query(Metric).filter(Metric.id.in_(ids)).order_by(Metric.id).with_for_update(read=True).populate_existing().all()
        rows.sort(key=lambda row:ids.index(row.id))
    period_query=db.query(MetricPeriod).filter(MetricPeriod.metric_id.in_(ids),MetricPeriod.calendar_year==year if compact else or_(MetricPeriod.calendar_year==year,MetricPeriod.model_version=='legacy_v1'))
    if compact and quarter:period_query=period_query.filter(MetricPeriod.quarter==quarter)
    if compact:
        pairs=period_query.add_entity(FactRevision).outerjoin(FactRevision,FactRevision.id==MetricPeriod.current_fact_revision_id).order_by(MetricPeriod.start_date).all()
        periods=[p for p,f in pairs];facts={f.id:f for p,f in pairs if f}
    else:
        periods=period_query.order_by(MetricPeriod.start_date).all()
    modern=[p for p in periods if p.model_version=='quarterly_v2'];pids=[p.id for p in modern]
    if not compact:facts={f.id:f for f in db.query(FactRevision).filter(FactRevision.id.in_([p.current_fact_revision_id for p in modern if p.current_fact_revision_id]))}
    source_ids=[f.source_measurement_id for f in facts.values() if f.source_measurement_id] if not compact else []
    sources={m.id:m for m in db.query(MetricMeasurement).filter(MetricMeasurement.id.in_(source_ids))} if source_ids else {}
    settings={m.id:m._quarterly_settings for m in rows if m._quarterly_settings} if compact else {y.metric_id:y for y in db.query(YearSettings).filter(YearSettings.metric_id.in_(ids),YearSettings.year==year)}
    pauses=defaultdict(list)
    if any(p.cadence!='none' for p in modern):
        for x in db.query(PauseInterval).filter(PauseInterval.metric_id.in_(ids)):pauses[x.metric_id].append(x)
    stats={p.id:dict(count=0,latest_date=None,violation_count=0 if p.result_type=='range' else None,violation_dates=[]) for p in modern}
    query=db.query(MetricMeasurement.period_id,func.count(MetricMeasurement.id),func.max(MetricMeasurement.measured_on),
        func.sum(case(((MetricMeasurement.value<MetricPeriod.target)|(MetricMeasurement.value>MetricPeriod.upper),1),else_=0)))
    if not compact:
        for pid,count,latest,violations in query.join(MetricPeriod,MetricPeriod.id==MetricMeasurement.period_id).filter(MetricMeasurement.period_id.in_(pids)).group_by(MetricMeasurement.period_id):
            stats[pid].update(count=count,latest_date=latest.isoformat(),violation_count=violations if stats[pid]['violation_count'] is not None else None)
    dates=defaultdict(list)
    scheduled=[p.id for p in modern if p.cadence!='none']
    if scheduled:
        for pid,day in db.query(MetricMeasurement.period_id,MetricMeasurement.measured_on).filter(MetricMeasurement.period_id.in_(scheduled)):dates[pid].append(day)
    if not compact and any(p.result_type=='range' for p in modern):
        for pid,day in db.query(MetricMeasurement.period_id,MetricMeasurement.measured_on).join(MetricPeriod).filter(MetricMeasurement.period_id.in_(pids),MetricPeriod.result_type=='range',or_(MetricMeasurement.value<MetricPeriod.target,MetricMeasurement.value>MetricPeriod.upper)):
            stats[pid]['violation_dates'].append(day.isoformat())
    names={}
    for model,field in [(User,'owner_id'),(Team,'team_id'),(Project,'project_id')]:
        if compact:
            names[field]={getattr(m,field):m._quarterly_names[field] for m in rows}
        else:
            refs=[getattr(m,field) for m in rows if getattr(m,field)]
            names[field]={x.id:x.name for x in db.query(model).filter(model.id.in_(refs))} if refs else {}
    cache=dict(facts=facts,sources=sources,observations=stats,pauses=pauses,dates=dates)
    result_rows=[]
    for row in rows:
        if compact:
            edit=can_access_task('edit',row,user) and not row.is_archived
            data={k:getattr(row,k) for k in ('id','title','unit','owner_id','model_version','lifecycle_state','is_archived','display_precision')}
            data.update(public_id=f'MET-{row.id:03d}',owner=names['owner_id'].get(row.owner_id),team=names['team_id'].get(row.team_id),project=names['project_id'].get(row.project_id),permissions={'edit':edit})
            y=settings.get(row.id);expected=y.expected_quarters if y else [];by_quarter={};at=today()
            for p in modern:
                if p.metric_id!=row.id:continue
                f=facts.get(p.current_fact_revision_id)
                availability=p.state if p.state!='active' else 'planned' if at<p.start_date else 'awaiting_close' if at>p.end_date else 'active'
                by_quarter[p.quarter]=dict(id=p.id,quarter=p.quarter,state=p.state,availability=availability,
                    plan={'target':canonical(p.target),'upper':canonical(p.upper),'result_type':p.result_type,'direction':p.direction,'baseline':canonical(p.baseline),'unit_snapshot':p.unit_snapshot,'method_snapshot':p.method_snapshot},
                    fact=dict(value=canonical(f.value),as_of_date=f.as_of_date.isoformat(),status=f.status,numerator=canonical(f.numerator),denominator=canonical(f.denominator)) if f else None,
                    result=result(p,f.value if f else None,p.state=='completed'),capabilities={'write_fact':edit and p.state=='active' and at>=p.start_date})
            if quarter:data['period']=by_quarter.get(quarter)
            else:data['quarters']=[by_quarter.get(q,dict(quarter=q,availability='unplanned' if q in expected and (not y or str(q) not in y.exclusions) else 'outside_scope')) for q in range(1,5)]
            if not quarter:
                data['annual']=annual(by_quarter,expected,y.aggregation if y else 'none',y.scale if y else 100,y.exclusions if y else {})
                data['annual_aggregation']=y.aggregation if y else 'none'
            result_rows.append(data);continue
        data=snapshot(row);data.pop('legacy_snapshot',None)
        data.update(public_id=f'MET-{row.id:03d}',owner=names['owner_id'].get(row.owner_id),team=names['team_id'].get(row.team_id),project=names['project_id'].get(row.project_id),permissions={a:can_access_task(a,row,user) for a in ['edit','comment','delete']})
        scoped=[p for p in modern if p.metric_id==row.id]
        y=settings.get(row.id);expected=y.expected_quarters if y else []
        by_quarter={p.quarter:project_period(db,row,p,user,cache) for p in scoped}
        data.update(year=year,periods=list(by_quarter.values()),quarters=[by_quarter.get(q,dict(quarter=q,availability='unplanned' if q in expected and (not y or str(q) not in y.exclusions) else 'outside_scope')) for q in range(1,5)],
            annual=annual(by_quarter,expected,y.aggregation if y else 'none',y.scale if y else 100,y.exclusions if y else {}),year_settings=snapshot(y) if y else None,
            legacy_periods=[snapshot(p) for p in periods if p.metric_id==row.id and p.model_version=='legacy_v1'],business_date=today().isoformat())
        result_rows.append(data)
    return result_rows
