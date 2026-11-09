"""Reproducible 1000/4000/100000 quarterly HTTP benchmark; exact-ID cleanup.

Run from backend using the project venv. Only metric tables are written.
Temporary committed metrics are required for ten independent PostgreSQL readers.
"""
import json
import platform
import statistics
from contextvars import ContextVar
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI,Depends
from fastapi.testclient import TestClient
from sqlalchemy import text,event
from database import engine,SessionLocal,get_db
from models import User,Team
from auth import get_current_user,get_task_action_scope,is_customer_portal_only
from routers.metrics_quarterly_router import router


def run(output):
    assert engine.dialect.name=='postgresql'
    with SessionLocal() as db:
        user=next(u for u in db.query(User).filter_by(is_active=True) if get_task_action_scope(u,'edit')=='all' and not is_customer_portal_only(u))
        uid=user.id;tid=db.query(Team.id).first()[0]
    ids=[];client=None;counter=ContextVar('quarterly_sql_count',default=None)
    allowed={'kr_metrics','kr_periods','kr_measurements','kr_period_plan_revisions','kr_period_fact_revisions','kr_year_settings'}
    def guard(conn,cursor,statement,*args):
        import re
        match=re.match(r'\s*(?:INSERT INTO|UPDATE|DELETE FROM)\s+[\"]?([a-z_]+)',statement,re.I)
        if match:assert match[1] in allowed,'Protected write '+match[1]
        active=counter.get()
        if active is not None:
            active['count']+=1;active['sql_started']=time.perf_counter()
    def measured(conn,cursor,statement,*args):
        active=counter.get()
        if active is not None:
            label='summary' if 'bool_or' in statement else 'periods' if 'FROM kr_periods' in statement else 'metrics' if 'FROM kr_metrics' in statement else 'other'
            active['queries'].append(dict(kind=label,seconds=time.perf_counter()-active['sql_started']))
    event.listen(engine,'before_cursor_execute',guard)
    event.listen(engine,'after_cursor_execute',measured)
    try:
        with engine.begin() as conn:
            ids=list(conn.execute(text("""INSERT INTO kr_metrics(title,team_id,owner_id,unit,source,method,model_version,lifecycle_state,annual_aggregation,created_by)
              SELECT 'DEV-QA-Quarterly-load-20261103-' || i,:tid,:uid,'шт','Synthetic','sum','quarterly_v2','tracking','sum',:uid
              FROM generate_series(1,1000) AS g(i) RETURNING id"""),dict(tid=tid,uid=uid)).scalars())
            conn.execute(text("""INSERT INTO kr_periods(metric_id,label,start_date,end_date,state,direction,target,cadence,model_version,calendar_year,quarter,result_type,source_snapshot,method_snapshot,unit_snapshot)
              SELECT m,'Quarter ' || q, make_date(2025,q*3-2,1),(make_date(2025,q*3-2,1)+interval '3 months'-interval '1 day')::date,
              'active','up',100,'none','quarterly_v2',2025,q,'volume','Synthetic','sum','шт'
              FROM unnest(CAST(:ids AS integer[])) AS m CROSS JOIN generate_series(1,4) AS g(q)"""),dict(ids=ids))
            conn.execute(text("""INSERT INTO kr_year_settings(metric_id,year,expected_quarters,exclusions,aggregation,scale)
              SELECT m,2025,'[1,2,3,4]'::json,'{}'::json,'sum',100 FROM unnest(CAST(:ids AS integer[])) AS m"""),dict(ids=ids))
            conn.execute(text("""INSERT INTO kr_period_plan_revisions(period_id,revision_no,data,author_id,reason)
              SELECT id,1,json_build_object('target','100','result_type','volume','direction','up','unit_snapshot','шт','method_snapshot','sum'),:uid,'benchmark'
              FROM kr_periods WHERE metric_id=ANY(:ids)"""),dict(ids=ids,uid=uid))
            conn.execute(text("""INSERT INTO kr_period_fact_revisions(period_id,revision_no,value,as_of_date,status,source,comment,reason,author_id)
              SELECT id,1,80,end_date,'preliminary','Synthetic','','',:uid FROM kr_periods WHERE metric_id=ANY(:ids)"""),dict(ids=ids,uid=uid))
            conn.execute(text("""UPDATE kr_periods p SET current_plan_revision_id=r.id,current_fact_revision_id=f.id
              FROM kr_period_plan_revisions r,kr_period_fact_revisions f WHERE p.id=r.period_id AND p.id=f.period_id AND p.metric_id=ANY(:ids)"""),dict(ids=ids))
            conn.execute(text("""INSERT INTO kr_measurements(period_id,measured_on,value,source,comment,author_id)
              SELECT p.id,p.start_date+i, i*3,'Synthetic','',:uid FROM kr_periods p CROSS JOIN generate_series(0,24) AS g(i) WHERE p.metric_id=ANY(:ids)"""),dict(ids=ids,uid=uid))
            pg=conn.execute(text('select version()')).scalar()
            for table in allowed:conn.execute(text('ANALYZE '+table))
        print('Prepared 1000 metrics / 4000 periods / 100000 measurements',flush=True)
        application=FastAPI();application.include_router(router,prefix='/api/v2')
        def actor(db=Depends(get_db)):return db.get(User,uid)
        application.dependency_overrides[get_current_user]=actor
        client=TestClient(application);client.__enter__()
        paths={'quarter':'/api/v2/metrics?year=2025&quarter=1&q=DEV-QA-Quarterly-load-20261103',
               'year':'/api/v2/metrics?year=2025&view=year&q=DEV-QA-Quarterly-load-20261103',
               'detail':f'/api/v2/metrics/{ids[0]}?year=2025'}
        def sample(path):
            active={'count':0,'queries':[]};counter.set(active)
            start=time.perf_counter();response=client.get(path);elapsed=time.perf_counter()-start
            assert response.status_code==200,response.text[:200]
            return dict(seconds=elapsed,sql=active['count'],bytes=len(response.content),queries=active['queries'])
        results={}
        for name,path in paths.items():
            for _ in range(3):sample(path)
            with ThreadPoolExecutor(max_workers=10) as pool:
                samples=list(pool.map(sample,[path]*40))
            times=sorted(x['seconds'] for x in samples);p95=times[37]
            results[name]=dict(p95_seconds=p95,median_seconds=statistics.median(times),max_response_bytes=max(x['bytes'] for x in samples),samples=samples,budget_seconds=1.5 if name=='detail' else 1,passed=p95<=(1.5 if name=='detail' else 1))
            print(name,round(p95,3),'seconds p95',flush=True)
        report=dict(machine=platform.platform(),processor=platform.processor(),postgres=pg,readers=10,fixture=dict(metrics=1000,periods=4000,measurements=100000),transport='in-process HTTP ASGI TestClient, real PostgreSQL',results=results)
        Path(output).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        return report
    finally:
        if client:client.__exit__(None,None,None)
        if ids:
            with engine.begin() as conn:
                conn.execute(text('UPDATE kr_periods SET current_plan_revision_id=NULL,current_fact_revision_id=NULL WHERE metric_id=ANY(:ids)'),dict(ids=ids))
                for table in ['kr_period_fact_revisions','kr_measurements','kr_period_plan_revisions']:
                    conn.execute(text(f'DELETE FROM {table} WHERE period_id IN (SELECT id FROM kr_periods WHERE metric_id=ANY(:ids))'),dict(ids=ids))
                for table in ['kr_year_settings','kr_periods']:
                    conn.execute(text(f'DELETE FROM {table} WHERE metric_id=ANY(:ids)'),dict(ids=ids))
                conn.execute(text('DELETE FROM kr_metrics WHERE id=ANY(:ids)'),dict(ids=ids))
            print('Benchmark records removed by exact IDs',flush=True)
        event.remove(engine,'before_cursor_execute',guard)
        event.remove(engine,'after_cursor_execute',measured)


if __name__=='__main__':run(sys.argv[1])
