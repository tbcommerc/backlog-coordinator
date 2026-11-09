"""Reject malformed/oversized ingress before queue admission or model setup."""
from types import SimpleNamespace
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from dmb_agent_contracts.body_limit import BodyLimit
from dmb_agent_contracts.run_api import router,install_error_handlers
from test_run_facade import request_body


@pytest.fixture
def client():
    def forbidden(*args,**kwargs):
        raise AssertionError('Invalid wire input reached admission or model configuration')
    app=FastAPI()
    app.add_middleware(BodyLimit)
    install_error_handlers(app)
    app.include_router(router(store=SimpleNamespace(create=forbidden,cancel_key=forbidden),
        authenticate=lambda:('dmb','synthetic'),validate=forbidden,profile=forbidden,
        capabilities=lambda:{}))
    with TestClient(app) as value:
        yield value


@pytest.mark.parametrize('route',['/runs','/runs/cancellations'])
@pytest.mark.parametrize('fault,status,code',[
    ('json',400,'invalid_request'),
    ('unknown',422,'input_validation_failed'),
    ('array',422,'input_validation_failed'),
    ('missing_key',400,'invalid_request'),
    ('oversized',413,'payload_too_large'),
])
def test_wire_input_fails_before_any_dispatch(client,route,fault,status,code):
    body=request_body()
    headers={'Idempotency-Key':'wire-synthetic','Content-Type':'application/json'}
    if fault=='unknown':body['unexpected']='SYNTHETIC_PRIVATE_MARKER'
    if fault=='array':body=[]
    if fault=='missing_key':headers.pop('Idempotency-Key')
    if fault=='oversized':body['input']['text']='SYNTHETIC_PRIVATE_MARKER'+'x'*1048576
    raw=b'{"broken":"SYNTHETIC_PRIVATE_MARKER"' if fault=='json' else json.dumps(body).encode()
    response=client.post('/internal/agent/v1'+route,headers=headers,content=raw)
    assert response.status_code==status
    assert response.json()=={'error':{'code':code,'message':code,'retryable':False,'details':{}}}
    assert 'SYNTHETIC_PRIVATE_MARKER' not in response.text
