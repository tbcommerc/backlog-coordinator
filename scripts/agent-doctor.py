"""Service-local, read-only prerequisites. Never performs inference or migrations."""
import argparse
import importlib
import json
import os
import re

PROFILES = {
    "business-analyst": ("business_analyst.config", "SESSION_DATABASE_URL", "OPENAI_MODEL", {"sessions","message_receipts"}),
    "business-analyst-experimental": ("business_analyst_experimental.config", "SESSION_DATABASE_URL", "OPENAI_MODEL", {"sessions","message_receipts"}),
    "meeting-analyzer": ("meeting_analyzer.config", "database_url", "model_name", {"meeting_runs","meeting_events"}),
    "value-priority-assessor": ("value_priority_assessor.config", "db_url", "openai_model", None),
    "backlog-assistant": ("backlog_assistant.config", "ASSISTANT_DATABASE_URL", "ASSISTANT_MODEL", None),
}


def plain(value):
    return value.get_secret_value() if hasattr(value,"get_secret_value") else value


def diagnose(service):
    from dmb_agent_contracts.settings import profile_aliases
    known_names = {name for names in profile_aliases(service).values() for name in names}
    module, database_field, model_field, expected = PROFILES[service]
    report = {"service":service,"status":"unavailable","model_calls":0,"database_writes":0}
    stage = "configuration"
    try:
        config = importlib.import_module(module)
        if service == "backlog-assistant":
            settings = config.environment()
            origins = config.configuration_sources()
            os.environ.update(settings)
            from backlog_assistant.preflight import check
            check()
            from backlog_assistant.store import metadata
            expected = set(metadata.tables) | {"backlog_assistant_migrations"}
            url, model = settings[database_field], settings[model_field]
            backend, provider, protocol, location = (settings.get("ASSISTANT_RUNTIME","opencode"),
                settings.get("ASSISTANT_MODEL_PROVIDER","opencode_go"),settings.get("ASSISTANT_MODEL_PROTOCOL","chat_completions"),
                settings.get("ASSISTANT_RUNTIME_LOCATION","local_isolated"))
        else:
            settings = config.settings if hasattr(config,"settings") else config.Settings()
            if hasattr(config,"validate_runtime_settings"):
                config.validate_runtime_settings()
            elif service == "meeting-analyzer":
                settings.validate_runtime()
            else:
                settings.validate_service_runtime()
            url, model = plain(getattr(settings,database_field)), getattr(settings,model_field)
            origins = settings.configuration_sources()
            backend = getattr(settings,"execution_backend",getattr(settings,"EXECUTION_BACKEND","direct"))
            provider = getattr(settings,"model_provider",getattr(settings,"MODEL_PROVIDER","opencode_go"))
            protocol = getattr(settings,"model_protocol",getattr(settings,"MODEL_PROTOCOL","chat_completions"))
            location = getattr(settings,"runtime_location",getattr(settings,"RUNTIME_LOCATION","none"))
            if service == "value-priority-assessor":
                from value_priority_assessor.core.models import Base
                from value_priority_assessor import remote_tools
                expected = set(Base.metadata.tables) | {"alembic_version"}
        if service in {"business-analyst", "business-analyst-experimental", "value-priority-assessor"}:
            from dmb_agent_contracts.run_store import metadata as run_metadata
            expected = set(expected) | set(run_metadata.tables)
        if service == "backlog-assistant" and (backend,provider,protocol,location) not in (("opencode","opencode_go","chat_completions","local_isolated"),("opencode","opencode_go","chat_completions","remote")):
            raise ValueError("BACKLOG_ASSISTANT_EXECUTION_BACKEND MODEL_PROVIDER MODEL_PROTOCOL RUNTIME_LOCATION")
        if not url.startswith(("postgresql://","postgresql+psycopg://")):
            raise ValueError("database_requires_postgresql")
        if url.startswith("postgresql://"):
            url = "postgresql+psycopg://"+url[len("postgresql://"):]
        from sqlalchemy import create_engine, inspect, text
        from sqlalchemy.pool import NullPool
        stage = "storage"
        engine = create_engine(url,poolclass=NullPool,connect_args={"connect_timeout":3})
        try:
            with engine.connect() as connection:
                connection.execute(text("SET TRANSACTION READ ONLY"))
                connection.execute(text("SELECT 1"))
                tables = set(inspect(connection).get_table_names())
                from dmb_agent_contracts.runtime_records import metadata as runtime_metadata, validate as validate_runtime_schema
                optional = tables & set(runtime_metadata.tables)
                if optional:
                    validate_runtime_schema(engine)
                if tables != expected | optional:
                    raise ValueError("dedicated_storage_schema_not_ready")
                if service == "backlog-assistant":
                    from backlog_assistant.migrate import validate
                    validate(engine)
                elif service == "meeting-analyzer":
                    from meeting_analyzer.migrate import validate
                    validate(engine)
                else:
                    from dmb_agent_contracts.run_migration import validate
                    validate(engine, allowed_existing=expected | optional)
                    if service == "value-priority-assessor":
                        heads = set(connection.execute(text("SELECT version_num FROM alembic_version")).scalars())
                        if heads != {"20261104_03"}:
                            raise ValueError("database_migration_required")
        finally:
            engine.dispose()
        safe_model = model if isinstance(model,str) and re.fullmatch(r"[A-Za-z0-9._/:+\-]{1,100}",model) else "unavailable"
        report.update(status="ready",storage="ready",model=safe_model,configuration_sources=origins,
                      execution_backend=backend,model_provider=provider,model_protocol=protocol,runtime_location=location,
                      model_origin="https://opencode.ai", runtime_contract_version=None if location=="none" else "1.17.13")
    except Exception as error:
        message = str(error)
        # Only known field identifiers are emitted; exception text and values stay private.
        reason = message if message in {"database_requires_postgresql","dedicated_storage_schema_not_ready"} else ("storage_unavailable" if stage=="storage" else "configuration_invalid")
        report.update(reason=reason,fields=sorted(name for name in known_names if name in message))
    return report


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--service",required=True,choices=PROFILES)
    args=parser.parse_args()
    report=diagnose(args.service)
    print(json.dumps(report))
    return 0 if report["status"]=="ready" else 1


if __name__=="__main__":
    raise SystemExit(main())
