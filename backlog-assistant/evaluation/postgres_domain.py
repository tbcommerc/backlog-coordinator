"""Real PostgreSQL predicates over temporary work records; no protected rows."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from decimal import Decimal
from sqlalchemy import create_engine, text, func
from sqlalchemy.schema import CreateTable
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool
from dotenv import dotenv_values
root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'dmb-backlog/backend'))
from models import Task
from services.backlog_assistant_integration.query import query

class Role(SimpleNamespace):
    def __getattr__(self,name):
        if name.endswith("_access"):return "none"
        raise AttributeError(name)

def main():
    env=dotenv_values(root/'backlog-assistant/.env')
    url=next(v for k,v in env.items() if 'DATABASE' in k and v)
    engine=create_engine(url,poolclass=NullPool)
    role=Role(customer_portal_only=False,backlog_dmb_access='read',review_access='none')
    actor=SimpleNamespace(id=71,team_id=1,role=role,role_name='',business_customer_id=None)
    scope={'customer':False,'task':list(range(1,1103))}
    checks=[]
    with engine.connect() as c:
        assert c.execute(text('select current_database()')).scalar()=='backlog_assistant'
        ddl=str(CreateTable(Task.__table__,include_foreign_key_constraints=[]).compile(engine)).replace('CREATE TABLE tasks','CREATE TEMPORARY TABLE tasks')
        c.exec_driver_sql(ddl)
        c.execute(Task.__table__.insert(),[dict(id=i,team_id=1 if i<=1001 else 2,title='Synthetic Alpha' if i%2 else 'Synthetic Beta',description=('100x literalXunder' if i==1101 else '100% literal_under')+(' Кэширование котировок' if i==5 else ''),public_id=f'TASK-{i:07}',owner_id=71 if i%2 else None,effort_rub=Decimal(0) if i%2 else None,financial_effect=Decimal('1.5'),is_deleted=i==1102,version=1) for i in range(1,1103)])
        c.commit()
        c.exec_driver_sql('SET TRANSACTION READ ONLY')
        session=Session(bind=c)
        def count(spec,user=actor):return query(session,user,scope,spec).count()
        assert count({})==1101;checks.append('full_selection_1101')
        assert query(session,actor,dict(scope,task=[3,5]),{}).count()==2;checks.append('grant_scope_intersection')
        assert count({'relationship':'my_team'})==1001;checks.append('my_team')
        assert count({'relationship':'mine'})==551;checks.append('mine')
        assert count({'missing':['effort']})==550;checks.append('null_not_zero')
        assert count({'terms':['100%']})==1100;checks.append('escaped_percent')
        assert count({'terms':['literal_under']})==1100;checks.append('escaped_underscore')
        assert count({'terms':['TASK-0000003']})==1;checks.append('public_id')
        assert count({'terms':['котировка']})==1;checks.append('russian_inflection')
        assert count({'terms':['кэшировании котировок']})==1;checks.append('russian_phrase')
        assert count({'terms':['кэширование квот']})==0;checks.append('no_synonym_invention')
        restricted=SimpleNamespace(id=71,team_id=2,role=Role(customer_portal_only=False,backlog_dmb_access='none'),role_name='',business_customer_id=None)
        assert count({},restricted)==100;checks.append('team_acl')
        assert count({'team_ids':[1]},restricted)==0;checks.append('acl_intersection')
        restricted.team_id=None
        assert count({},restricted)==0;checks.append('teamless_acl')
        values=query(session,actor,scope,{}).with_entities(func.sum(Task.effort_rub),func.sum(Task.financial_effect)).order_by(None).one()
        assert values==(Decimal(0),Decimal('1651.50'));checks.append('full_sums')
        session.close();c.rollback()
        # PostgreSQL deliberately allows TEMP writes in READ ONLY transactions.
        # Check a separate empty, uniquely named work table instead.
        import uuid
        probe="eval_readonly_"+uuid.uuid4().hex
        c.exec_driver_sql(f'CREATE TABLE {probe} (id integer)');c.commit()
        try:
            c.exec_driver_sql('SET TRANSACTION READ ONLY')
            try:c.exec_driver_sql(f'UPDATE {probe} SET id=2 WHERE id=1')
            except Exception as exc:
                assert getattr(getattr(exc,'orig',None),'sqlstate',None)=='25006';checks.append('readonly_rejects_write')
            else:raise AssertionError('readonly write accepted')
        finally:
            c.rollback();c.exec_driver_sql(f'DROP TABLE {probe}');c.commit()
    engine.dispose()
    print(json.dumps({'passed':len(checks),'checks':checks,'temporary_records_removed':True}))
if __name__=='__main__':main()
