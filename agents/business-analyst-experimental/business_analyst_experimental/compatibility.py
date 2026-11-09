"""Legacy chat uses the same durable queue as the run API."""
import hashlib
from uuid import uuid4
from fastapi import HTTPException
from pydantic import ValidationError
from dmb_agent_contracts.compatibility import wait_result
from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts.run_store import fingerprint
from .session import session_store


def chat_request(request, *, on_status=None):
    from .api.router import _to_ctx
    from .runs import store, profile, validate
    context = _to_ctx(request.context)
    if context is None or context.user_id <= 0:
        raise HTTPException(404, 'Session not found')
    if not request.message_id:
        # Preserve the legacy optional DTO. Only a client-supplied stable ID
        # can identify a retry after a lost response.
        request = request.model_copy(update={'message_id':uuid4().hex})
    actor, trusted = str(context.user_id), context.model_dump(mode="json")
    key = 'legacy-chat:' + hashlib.sha256((request.session_id+'\0'+request.message_id).encode()).hexdigest()
    with session_store.serialized(request.session_id):
        state = session_store.get(request.session_id)
        if state is None or state.user_id != context.user_id:
            raise HTTPException(404, 'Session not found')
        old = store.find_key('dmb', actor, key, 'dialogue.message')
        if old is not None and old['result_expired']:
            raise AgentError('result_expired',410)
        if old is None:
            cached = session_store.get_cached_response(request.session_id,request.message_id)
            if cached is not None:
                return cached
        content = {'message':request.message}
        if old is not None and old['input'] != content:
            raise AgentError('idempotency_conflict', 409)
        body = {'contract_version':'1.0','operation':'dialogue.message',
            'conversation_ref':request.session_id,
            'source':old['source'] if old else {'kind':'dialogue','ref':request.session_id,
                'revision':state._storage_version,'snapshot_hash':'sha256:'+fingerprint(content)},
            'input':content}
        try:
            validate(body)
        except ValidationError:
            raise AgentError("input_validation_failed",422) from None
        row, _ = store.create('dmb',actor,key,body,old['profile'] if old else profile(),150,64,trusted_context=trusted)
    return wait_result(store,row,on_status=on_status)


def document_request(request):
    from .runs import store, profile, validate
    if request.user_id <= 0:
        raise HTTPException(404, 'Session not found')
    if not request.idempotency_key:
        request = request.model_copy(update={'idempotency_key':uuid4().hex})
    actor = str(request.user_id)
    key = 'legacy-document:' + hashlib.sha256((request.session_id+'\0'+
        request.idempotency_key).encode()).hexdigest()
    content = {name:getattr(request,name) for name in ('action','expected_draft_hash','instruction','field')}
    with session_store.serialized(request.session_id):
        state = session_store.get(request.session_id)
        if state is None or state.user_id != request.user_id:
            raise HTTPException(404, 'Session not found')
        old = store.find_key('dmb',actor,key, 'document.review' if request.action=='review' else 'document.generate')
        if old is not None and old['result_expired']:
            raise AgentError('result_expired',410)
        if old is None:
            from .api.router import _cached_bound_action
            cached = _cached_bound_action(request.session_id,'document_'+request.action,request)
            if cached is not None:
                return cached
        if old is not None and old['input'] != content:
            raise AgentError('idempotency_conflict',409)
        body = {'contract_version':'1.0',
            'operation':'document.review' if request.action=='review' else 'document.generate',
            'conversation_ref':request.session_id,'input':content,
            'source':old['source'] if old else {'kind':'dialogue','ref':request.session_id,
                'revision':state._storage_version,'snapshot_hash':'sha256:'+fingerprint(content)}}
        try:
            validate(body)
        except ValidationError:
            raise AgentError("input_validation_failed",422) from None
        row,_ = store.create('dmb',actor,key,body,old['profile'] if old else profile(),150,64)
    return wait_result(store,row)
