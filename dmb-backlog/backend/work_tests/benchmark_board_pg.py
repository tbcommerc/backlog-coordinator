"""Manual DEV benchmark: ten connection-private 10k WorkTask sets, always rolled back.

Run from backend: python work_tests/benchmark_board_pg.py.
Requires an existing ordinary DEV-QA-BOARD-* work task to select a QA actor.
Does not create/update users, roles, teams, dictionaries or persistent work data.
Measures service and serialization, not network/authentication latency.
"""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from time import perf_counter
from pathlib import Path
import json
import os
import platform
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from sqlalchemy import text, event
from sqlalchemy.orm import Session
from fastapi.encoders import jsonable_encoder
from database import engine
from models import WorkTask, User
from services.work_board import read
from services.work_query import Filters
from config import settings


def main():
    if engine.dialect.name != 'postgresql': raise RuntimeError('PostgreSQL required')
    settings.WORK_TASK_BOARD_ENABLED=True
    barrier=Barrier(10)
    with Session(engine) as db:
        source=db.query(WorkTask).filter(WorkTask.title.like('DEV-QA-BOARD-%')).order_by(WorkTask.id.desc()).first()
        if not source: raise RuntimeError('Existing board QA task required')
        uid,team=source.requester_id,source.requester_team_id
        version=db.execute(text('select version()')).scalar().split(',')[0]

    def worker(index):
        with engine.connect() as conn:
            transaction=conn.begin()
            try:
                conn.execute(text('CREATE TEMP TABLE work_tasks (LIKE public.work_tasks INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP'))
                conn.execute(text('CREATE TEMP TABLE work_history (LIKE public.work_history INCLUDING DEFAULTS) ON COMMIT DROP'))
                conn.execute(text("""INSERT INTO work_tasks(id,title,description,work_direction,requester_id,requester_team_id,
                    execution_team_id,assignee_id,acceptor_id,created_by,status,assignment_state,acceptance_required,
                    result_text,version,is_deleted,priority,checklist,due_date)
                    SELECT 1000000+n,repeat('Тестовая работа ',16),'Результат','organizational',:uid,:team,:team,:uid,:uid,:uid,
                    (ARRAY['new','ready','in_progress','in_acceptance','done'])[1+n%5],'accepted',true,'Проверено',1,false,
                    (ARRAY['low','normal','high','urgent'])[1+n%4],'[]'::json,current_date+(n%30)
                    FROM generate_series(1,10000) n"""),{'uid':uid,'team':team})
                conn.execute(text('ANALYZE work_tasks'))
                with Session(bind=conn) as db:
                    user=db.get(User,uid)
                    _=user.role
                    barrier.wait(timeout=60)
                    elapsed=[];sizes=[];counts=[]
                    for iteration in range(3):
                        statements=[]
                        listener=lambda *args:statements.append(1)
                        event.listen(conn,'before_cursor_execute',listener)
                        start=perf_counter()
                        data=read(db,user,Filters(view='all',status='active_done',sort='priority'))
                        payload=json.dumps(jsonable_encoder(data),ensure_ascii=False).encode()
                        elapsed.append((perf_counter()-start)*1000);sizes.append(len(payload));counts.append(len(statements))
                        event.remove(conn,'before_cursor_execute',listener)
                        assert data['total']==10000 and all(x['id']>=1000000 for c in data['columns'] for x in c['items'])
                    return {'ms':elapsed,'bytes':max(sizes),'sql':max(counts)}
            finally:
                transaction.rollback()
    with ThreadPoolExecutor(max_workers=10) as pool:
        results=list(pool.map(worker,range(10)))
    measurements=sorted(x for r in results for x in r['ms'])
    print(json.dumps({'kind':'PostgreSQL board service + serialization; excludes HTTP/auth',
        'rows_per_reader':10000,'concurrent_readers':10,'samples':len(measurements),
        'p95_ms':round(measurements[int(len(measurements)*.95)-1],1),'max_ms':round(max(measurements),1),
        'max_sql':max(r['sql'] for r in results),'max_response_bytes':max(r['bytes'] for r in results),
        'postgres':version,'cpu_logical':os.cpu_count(),'platform':platform.platform(),'persistent_writes':0},ensure_ascii=False))


if __name__=='__main__':main()
