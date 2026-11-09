"""Trusted request identity and explicit gateway fences for read-only recovery."""
from contextvars import ContextVar
import re
from fastapi import Depends,HTTPException,Request
from auth import get_current_user
from config import settings

_actor=ContextVar('trusted_agent_gateway_actor',default=None)


async def bind_actor(current_user=Depends(get_current_user)):
    token=_actor.set(int(current_user.id))
    try:yield
    finally:_actor.reset(token)


def trusted_headers():
    actor=_actor.get()
    return {} if actor is None else {'X-Agent-Caller':'dmb','X-Actor-Ref':str(actor)}


def _deny():
    raise HTTPException(503,detail={'code':'agent_recovery_read_only',
        'message':'Сервис временно доступен только для просмотра истории.'})


def guard_v1(request:Request):
    if not getattr(settings,'AGENT_RECOVERY_READ_ONLY',False) or request.method in {'GET','HEAD'}:return
    tail=request.url.path.split('/agent/',1)[-1]
    if (tail in {'new-dialog','chat','chat-stream','send-for-review','edit-draft-section','reset'} or
            re.fullmatch(r'session/[^/]+/archive|requests/[^/]+/resume',tail)):
        _deny()


def guard_v2(request:Request):
    if getattr(settings,'AGENT_V2_RECOVERY_READ_ONLY',False) and request.method not in {'GET','HEAD'}:
        _deny()
