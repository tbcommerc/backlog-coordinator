"""Old coordinator response shape over the durable execution queue."""
from uuid import uuid4
from dmb_agent_contracts.compatibility import wait_result
from dmb_agent_contracts.model import AgentError
from dmb_agent_contracts.run_store import fingerprint


def estimate(task, kind, *, caller='', actor='', key='', revision=0):
    from .runs import store, profile, validate
    if caller or actor:
        if caller != 'dmb' or not actor or len(actor)>128 or not key or len(key)>128:
            raise AgentError('operation_forbidden',403)
    else:
        # Existing authenticated operator clients identify their service
        # principal, never an invented human. DMB always supplies its actor/key.
        caller,actor,key = 'legacy-coordinator','coordinator-service',key or str(uuid4())
    content = task.model_dump(mode='json')
    body = {'contract_version':'1.0','operation':kind+'.estimate','conversation_ref':None,
        'source':{'kind':'work_item','ref':task.task_id,'revision':revision,
            'snapshot_hash':'sha256:'+fingerprint(content)},'input':content}
    validate(body)
    old = store.find_key(caller,actor,key,body['operation'])
    if old is not None and old['result_expired']:
        raise AgentError('result_expired',410)
    row,_ = store.create(caller,actor,key,body,old['profile'] if old else profile(),180,64)
    return wait_result(store,row)
