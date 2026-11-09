"""Two independent HTTP sessions on PostgreSQL, with exact-ID cleanup."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from fastapi import FastAPI,Depends
from fastapi.testclient import TestClient
from sqlalchemy import event,text
from database import engine,SessionLocal,get_db
from models import User,Team
from auth import get_current_user,get_task_action_scope,is_customer_portal_only
from routers.metrics_quarterly_router import router


def test_concurrent_fact_and_replay():
    assert engine.dialect.name=='postgresql'
    with SessionLocal() as db:
        uid=next(u.id for u in db.query(User).filter_by(is_active=True) if get_task_action_scope(u,'edit')=='all' and not is_customer_portal_only(u))
        tid=db.query(Team.id).first()[0]
    app=FastAPI();app.include_router(router,prefix='/api/v2')
    def actor(db=Depends(get_db)):return db.get(User,uid)
    app.dependency_overrides[get_current_user]=actor
    allowed={'kr_metrics','kr_periods','kr_history','kr_period_plan_revisions','kr_period_fact_revisions','kr_year_settings','idempotency_records'}
    def guard(conn,cursor,statement,*args):
        import re
        found=re.match(r'\s*(?:INSERT INTO|UPDATE|DELETE FROM)\s+[\"]?([a-z_]+)',statement,re.I)
        if found:assert found[1] in allowed,'Protected write '+found[1]
    event.listen(engine,'before_cursor_execute',guard)
    mid=None;prefix='qa-concurrency-'+uuid4().hex
    try:
        with TestClient(app) as client:
            response=client.post('/api/v2/metrics',headers={'Idempotency-Key':prefix},json=dict(title='DEV-QA-quarterly-concurrency',team_id=tid,owner_id=uid,unit='шт',source='Synthetic',year=2025,expected_quarters=[1],preferred_result_type='volume',save_mode='start',plans=[dict(quarter=1,target='100')]))
            assert response.status_code==201,response.text
            metric=response.json();mid=metric['id'];pid=metric['periods'][0]['id'];path=f'/api/v2/metrics/{mid}/periods/{pid}/fact'
            def write(value):return client.put(path,headers={'Idempotency-Key':prefix+'-'+value},json=dict(version=metric['version'],value=value,as_of_date='2025-03-31'))
            with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(write,['10','20']))
            assert sorted(r.status_code for r in responses)==[200,409]
            winner=next(r.json() for r in responses if r.status_code==200)
            value=winner['periods'][0]['fact']['value'];again=write(value)
            assert again.status_code==200 and again.json()['version']==winner['version']
            with SessionLocal() as db:
                assert db.execute(text('select count(*) from kr_period_fact_revisions where period_id=:pid'),{'pid':pid}).scalar()==1
    finally:
        if mid:
            with engine.begin() as conn:
                conn.execute(text('UPDATE kr_periods SET current_plan_revision_id=NULL,current_fact_revision_id=NULL WHERE metric_id=:mid'),{'mid':mid})
                conn.execute(text('DELETE FROM kr_history WHERE metric_id=:mid'),{'mid':mid})
                for table in ['kr_period_fact_revisions','kr_period_plan_revisions']:
                    conn.execute(text(f'DELETE FROM {table} WHERE period_id IN (SELECT id FROM kr_periods WHERE metric_id=:mid)'),{'mid':mid})
                for table in ['kr_year_settings','kr_periods']:
                    conn.execute(text(f'DELETE FROM {table} WHERE metric_id=:mid'),{'mid':mid})
                conn.execute(text("DELETE FROM idempotency_records WHERE resource_type='metric' AND resource_id=:mid"),{'mid':mid})
                conn.execute(text('DELETE FROM kr_metrics WHERE id=:mid'),{'mid':mid})
        event.remove(engine,'before_cursor_execute',guard)
