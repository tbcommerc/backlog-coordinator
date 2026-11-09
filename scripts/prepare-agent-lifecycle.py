"""Prepare only disposable technical PostgreSQL histories, without model calls."""
import argparse
import importlib
import os
import runpy
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--service",required=True,choices=["business-analyst","business-analyst-experimental","meeting-analyzer","backlog-assistant","value-priority-assessor"])
    parser.add_argument("--database",required=True)
    args=parser.parse_args()
    prefix=args.service.replace("-","_")+"_lifecycle_"
    if not args.database.startswith(prefix):
        raise RuntimeError("disposable_database_name_required")
    modules={"business-analyst":("business_analyst","SESSION_DATABASE_URL"),
             "business-analyst-experimental":("business_analyst_experimental","SESSION_DATABASE_URL"),
             "meeting-analyzer":("meeting_analyzer","database_url"),
             "backlog-assistant":("backlog_assistant","ASSISTANT_DATABASE_URL"),
             "value-priority-assessor":("value_priority_assessor","db_url")}
    package,field=modules[args.service]
    config=importlib.import_module(package+".config")
    if args.service=="backlog-assistant":
        os.environ.update(config.environment())
        url=os.environ[field]
    else:
        settings=config.settings if hasattr(config,"settings") else config.Settings()
        url=getattr(settings,field)
        if hasattr(url,"get_secret_value"): url=url.get_secret_value()
    parsed=make_url(url)
    if parsed.host!="127.0.0.1" or parsed.username!="postgres" or parsed.password or parsed.database!=args.database:
        raise RuntimeError("disposable_postgres_scope_required")
    if args.service.startswith("business-analyst"):
        module=importlib.import_module(package+".session")
        store=module.SessionStore(database_url=url,initialize=False)
        from sqlalchemy import inspect
        from dmb_agent_contracts.run_migration import migrate as migrate_runs
        if inspect(store.engine).get_table_names():
            raise RuntimeError("fresh_disposable_database_required")
        store.migrate_schema()
        migrate_runs(store.engine, backup_verified=True, allowed_existing=("sessions","message_receipts"))
        state=store.new_session(0)
        state.add_message("user","Synthetic lifecycle history","synthetic-message")
        store.save(state)
        store.cache_response(state.session_id,"synthetic-message",{"message":"Synthetic persisted reply"})
        store.engine.dispose()
    elif args.service=="meeting-analyzer":
        from meeting_analyzer.migrate import migrate
        from meeting_analyzer.store import Store,now
        engine=create_engine(url)
        migrate(engine)
        store=Store(engine)
        row,_=store.create("dmb","synthetic-lifecycle","synthetic-seed",{"input":{"transcript":"Synthetic lifecycle"},
            "source":{"ref":"synthetic","revision":1}},{"model":"synthetic"},300,100)
        assert store.transition(row,"cancelled",finished_at=now())
        engine.dispose()
    elif args.service=="value-priority-assessor":
        from alembic import command
        from alembic.config import Config
        from sqlalchemy.orm import Session
        from sqlalchemy import select,func
        from value_priority_assessor.core.models import AgentRequest,Reference
        command.upgrade(Config("alembic.ini"),"head")
        engine=create_engine(url)
        with Session(engine) as session:
            assert session.scalar(select(func.count()).select_from(Reference))==0
            session.add(AgentRequest(request_id="synthetic-lifecycle-request",cache_key="synthetic-cache",
                request_type="synthetic",task_key="synthetic-task",attributes={"synthetic":True},
                response={"status":"synthetic-history"},llm_calls=0))
            session.commit()
        engine.dispose()
    else:
        from backlog_assistant.migrate import migrate
        from backlog_assistant.store import Store
        from contracts.models import SessionCreate
        migrate(url)
        engine=create_engine(url)
        Store(engine).create("synthetic-lifecycle-owner","synthetic-seed",SessionCreate().model_dump(mode="json"))
        engine.dispose()
    print("Disposable technical history prepared; queued model work=0; protected writes=0")


if __name__=="__main__":
    main()
