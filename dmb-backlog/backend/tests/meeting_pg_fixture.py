"""Technical meeting tables only; external identity FKs use mock DTOs in tests.

Production metadata is never changed. A PostgreSQL test schema omits only FKs
to tables outside this fixture, so no users, teams or dictionaries are created.
"""
from contextlib import contextmanager
import os
from uuid import uuid4

from sqlalchemy import MetaData, create_engine, inspect, text
from sqlalchemy.engine import make_url

ALLOWED={'meeting_captures','meeting_actions','meeting_delivery_intents',
         'meeting_application_receipts','notifications','event_outbox'}


@contextmanager
def technical_engine(tables):
    names={table.name for table in tables}
    if not names or not names<=ALLOWED:
        raise RuntimeError('technical_meeting_table_allowlist_required')
    url=os.environ.get('MEETING_TEST_DATABASE_URL')
    if not url:
        engine=create_engine('sqlite:///:memory:')
        try:
            for table in tables:table.create(engine)
            yield engine
        finally:engine.dispose()
        return
    parsed=make_url(url)
    if parsed.drivername!='postgresql+psycopg' or not (parsed.database or '').startswith('agent_dmb_'):
        raise RuntimeError('explicit_disposable_meeting_postgres_required')
    schema='meeting_fixture_'+uuid4().hex
    admin=create_engine(url,connect_args={'connect_timeout':3})
    engine=None
    created=False
    try:
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        created=True
        engine=create_engine(url,connect_args={'connect_timeout':3,'options':'-csearch_path='+schema})
        metadata=MetaData()
        for table in tables:
            clone=table.to_metadata(metadata)
            for constraint in list(clone.foreign_key_constraints):
                if any(element.target_fullname.split('.')[-2] not in names for element in constraint.elements):
                    clone.constraints.discard(constraint)
                    for element in constraint.elements:
                        clone.foreign_keys.discard(element)
                        element.parent.foreign_keys.discard(element)
        metadata.create_all(engine)
        assert set(inspect(engine).get_table_names())==names
        yield engine
    finally:
        if engine is not None:
            # Never drop unexpected tables, especially protected fixture data.
            actual=set(inspect(engine).get_table_names())
            engine.dispose()
            if not actual<=names:
                admin.dispose()
                raise RuntimeError('unexpected_meeting_fixture_tables_cleanup_refused')
        if created:
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()
