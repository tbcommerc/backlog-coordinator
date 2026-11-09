"""Explicit user retries link to an owned terminal run."""
from uuid import UUID
from sqlalchemy import select
from .model import AgentError


def canonical_body(body):
    result = dict(body)
    if result.get('retry_of_key') is None:
        result.pop('retry_of_key',None)
    if result.get('retry_of') is None:
        result.pop('retry_of',None)  # Preserve hashes of pre-extension requests.
    return result


def validate_retry(connection, table, caller, actor, body):
    value, previous_key = body.get('retry_of'), body.get('retry_of_key')
    if value is None and previous_key is None:
        return None
    scope = (table.c.caller==caller,table.c.actor==actor)
    if value is not None:
        try:
            identity = str(UUID(str(value)))
        except (ValueError,TypeError,AttributeError):
            raise AgentError('input_validation_failed',422) from None
        previous = connection.execute(select(table).where(*scope,table.c.id==identity)).mappings().first()
        if previous_key is not None and (previous is None or previous['key']!=previous_key):
            raise AgentError('run_not_found',404)
    else:
        if not isinstance(previous_key,str) or not 1<=len(previous_key)<=128:
            raise AgentError('input_validation_failed',422)
        if 'operation' in table.c:
            scope += (table.c.operation==body['operation'],)
        previous = connection.execute(select(table).where(*scope,table.c.key==previous_key)).mappings().first()
        identity = previous['id'] if previous else None
    if previous is None:
        raise AgentError('run_not_found',404)
    if (previous['status'] not in {'completed','failed','interrupted','cancelled'} or
        any(previous['source'].get(name)!=body['source'].get(name) for name in ('kind','ref')) or
        'operation' in table.c and previous['operation']!=body['operation'] or
        'conversation_ref' in table.c and previous['conversation_ref']!=body.get('conversation_ref')):
        raise AgentError('invalid_retry_source',409)
    return identity
