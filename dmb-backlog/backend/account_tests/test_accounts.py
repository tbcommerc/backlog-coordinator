"""No database fixtures: pure contracts and in-memory doubles only."""
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from services.credentials import normalize_login, validate_password, hash_password, verify_password
from services import auth_sessions as sessions, auth_challenges as challenges
from account_schemas import PasswordChange, PasswordSetup
from schemas import LoginRequest, UserCreate
from auth import create_access_token, decode_token

@pytest.mark.parametrize('value,expected', [(' Ivan.Petrov ', 'ivan.petrov'),('Ivan@Bank','ivan@bank'),('petrov_01','petrov_01')])
def test_login_normalization(value,expected):
    assert normalize_login(value)==expected

@pytest.mark.parametrize('value',['иван','ab','foo bar','foo\u200bbar','@bank','a'*255])
def test_login_rejects_ambiguous_identifiers(value):
    with pytest.raises(HTTPException): normalize_login(value)

def test_password_unicode_and_no_truncation():
    value='  длинная секретная фраза  '
    encoded=hash_password(validate_password(value))
    assert encoded.startswith('$argon2id$v=19$m=19456,t=2,p=1$')
    assert verify_password(value,encoded)
    assert not verify_password(value.strip(),encoded)
    assert not verify_password('x'*100+'a',hash_password('x'*100+'b'))
    assert verify_password('е\u0308'*15,hash_password('ё'*15))

@pytest.mark.parametrize('value',['short','a'*129,'длинный пароль\x00xx','passwordpassword'])
def test_password_policy(value):
    with pytest.raises(HTTPException): validate_password(value)

def test_legacy_and_corrupt_hash_fail_closed():
    assert not verify_password('dmb2026','$2b$12$broken')
    assert not verify_password('something','$argon2id$invalid')
    assert not verify_password('something',None)

@pytest.mark.parametrize('schema,data',[(PasswordChange,{'current_password':'x','new_password':'y','user_id':1}),
    (PasswordSetup,{'token':'x','new_password':'y','role_id':1}),
    (LoginRequest,{'email':'a@bank','password':'x'}),
    (UserCreate,{'login':'person','name':'Person','reauth_token':'x','password':'dmb2026'})])
def test_dto_rejects_credential_bypass(schema,data):
    with pytest.raises(ValidationError): schema(**data)

def test_jwt_required_session_and_strict_subject():
    import uuid
    data={'sub':'1','sid':str(uuid.uuid4()),'auth_version':1}
    assert decode_token(create_access_token(data))['sub']=='1'
    for extra in [{'sub':'bad'},{'sub':'-1'},{'sub':'1.0'},{'sid':'bad'},{'auth_version':True}]:
        assert decode_token(create_access_token(dict(data,**extra))) is None
    assert decode_token(create_access_token({'sub':'1'})) is None

def session_double(**changes):
    row=SimpleNamespace(id='s',auth_version=2,revoked_at=None,absolute_expires_at=sessions.now()+timedelta(hours=1),last_activity_at=sessions.now())
    for k,v in changes.items():setattr(row,k,v)
    db=MagicMock();db.query.return_value.filter.return_value.populate_existing.return_value.first.return_value=row
    user=SimpleNamespace(id=1,is_active=True,credential_state='ready',auth_version=2,role=None)
    return db,user,row

@pytest.mark.parametrize('changes',[{'revoked_at':sessions.now()},{'auth_version':1},{'absolute_expires_at':sessions.now()-timedelta(seconds=1)},{'last_activity_at':sessions.now()-timedelta(minutes=31)}])
def test_session_revocation_and_expiry(changes):
    db,user,_=session_double(**changes)
    with pytest.raises(HTTPException) as error:sessions.check_session(db,user,'s',2)
    assert error.value.status_code==401

def test_session_ready_and_version():
    db,user,row=session_double()
    assert sessions.check_session(db,user,'s',2) is row
    user.credential_state='reset_required'
    with pytest.raises(HTTPException):sessions.check_session(db,user,'s',2)

def test_challenge_target_binding_and_one_use():
    row=SimpleNamespace(user_id=1,purpose='reauth:invitation',auth_version=2,session_id='s',target_user_id=7,used_at=None,revoked_at=None,expires_at=sessions.now()+timedelta(minutes=1))
    db=MagicMock();db.query.return_value.filter.return_value.with_for_update.return_value.first.return_value=row
    user=SimpleNamespace(id=1,auth_version=2)
    with pytest.raises(HTTPException):challenges.consume(db,'code',user,row.purpose,'s',8)
    challenges.consume(db,'code',user,row.purpose,'s',7)
    with pytest.raises(HTTPException):challenges.consume(db,'code',user,row.purpose,'s',7)

@pytest.mark.parametrize('case',['unknown','disabled','invited','reset_required','concurrent_reset'])
def test_login_denials_do_not_issue_tokens(monkeypatch,case):
    import asyncio
    from unittest.mock import AsyncMock
    from starlette.requests import Request
    from starlette.responses import Response
    from importlib import import_module
    auth_router = import_module("routers.auth_router")
    from services import auth_limits
    user = None if case=='unknown' else SimpleNamespace(id=1,password_hash='encoded',auth_version=1,is_active=case!='disabled',credential_state=case if case in {'invited','reset_required'} else 'ready')
    db=MagicMock();db.query.return_value.filter.return_value.first.return_value=user
    monkeypatch.setattr(auth_limits,'limit',AsyncMock())
    monkeypatch.setattr(auth_router,'verify_password',lambda *args: case!='unknown')
    monkeypatch.setattr(__import__('services.credentials',fromlist=['needs_rehash']),'needs_rehash',lambda _:False)
    def locked(*args):
        if case=='concurrent_reset':user.auth_version=2
        return user
    monkeypatch.setattr(sessions,'lock_user',locked)
    issued=MagicMock();monkeypatch.setattr(auth_router,'issue_refresh_session',issued)
    req=Request({'type':'http','method':'POST','path':'/api/v1/auth/login','headers':[(b'origin',b'http://127.0.0.1:8000')],'client':('127.0.0.1',1)})
    with pytest.raises(HTTPException) as error:
        asyncio.run(auth_router.login(req,Response(),LoginRequest(login='person',password='bad password'),db))
    assert error.value.status_code==401
    assert error.value.detail=='INVALID_CREDENTIALS'
    issued.assert_not_called()

def test_wrong_current_password_never_invalidates(monkeypatch):
    from importlib import import_module
    auth_router = import_module("routers.auth_router")
    db=MagicMock();user=SimpleNamespace(id=1,password_hash='hash')
    monkeypatch.setattr(auth_router.credentials,'verify_password',lambda *args:False)
    invalidate=MagicMock();monkeypatch.setattr(sessions,'invalidate',invalidate)
    with pytest.raises(HTTPException):auth_router.password_change(PasswordChange(current_password='bad',new_password='new'),db,user)
    invalidate.assert_not_called()
    assert user.password_hash=='hash'

@pytest.mark.parametrize('changes',[{'used_at':sessions.now()},{'revoked_at':sessions.now()},{'expires_at':sessions.now()-timedelta(seconds=1)},{'purpose':'reauth:invitation'},{'auth_version':99}])
def test_setup_invalid_codes_are_uniform_and_never_hash(monkeypatch,changes):
    from importlib import import_module
    auth_router = import_module("routers.auth_router")
    row=SimpleNamespace(id='c',user_id=1,purpose='invitation',auth_version=1,used_at=None,revoked_at=None,expires_at=sessions.now()+timedelta(minutes=5))
    for key,value in changes.items():setattr(row,key,value)
    user=SimpleNamespace(id=1,is_active=True,credential_state='invited',auth_version=1,login_normalized='person')
    db=MagicMock();db.query.return_value.filter.return_value.first.side_effect=[row,user]
    hasher=MagicMock();monkeypatch.setattr(auth_router.credentials,'hash_password',hasher)
    with pytest.raises(HTTPException) as error:auth_router.password_setup(PasswordSetup(token='code',new_password='valid long password'),db)
    assert error.value.detail=='SETUP_TOKEN_INVALID'
    hasher.assert_not_called()

def test_last_admin_and_self_are_protected():
    from services.accounts import protect
    db=MagicMock();db.query.return_value.join.return_value.filter.return_value.count.return_value=0
    admin=SimpleNamespace(id=1)
    target=SimpleNamespace(id=2,role=SimpleNamespace(admin_access='full'),is_active=True,credential_state='ready')
    with pytest.raises(HTTPException) as error:protect(db,admin,target,True)
    assert error.value.detail=='LAST_READY_ADMIN'
    target.id=1
    with pytest.raises(HTTPException) as error:protect(db,admin,target,True)
    assert error.value.detail=='CANNOT_RESTRICT_SELF'

@pytest.mark.parametrize('age,code',[(1,409),(11,401)])
def test_refresh_rotation_window_and_replay(monkeypatch,age,code):
    import refresh_sessions
    user=SimpleNamespace(id=1,auth_version=2)
    session=SimpleNamespace(id='s',revoked_at=None,revoke_reason=None)
    row=SimpleNamespace(auth_session_id='s',token_hash=challenges.digest('token'),revoked_at=sessions.now()-timedelta(seconds=age),rotated_to_jti='next')
    db=MagicMock();db.query.return_value.filter.return_value.with_for_update.return_value.first.return_value=row
    monkeypatch.setattr(refresh_sessions,'decode_token',lambda _:dict(sub='1',type='refresh',sid='s',jti='j',auth_version=2))
    monkeypatch.setattr(refresh_sessions,'lock_user',lambda *args:user)
    monkeypatch.setattr(refresh_sessions,'check_session',lambda *args:session)
    issuer=MagicMock();monkeypatch.setattr(refresh_sessions,'issue_refresh_session',issuer)
    with pytest.raises(HTTPException) as error:refresh_sessions.rotate_refresh_session(db,'token')
    assert error.value.status_code==code
    assert bool(session.revoked_at)==(age>10)
    issuer.assert_not_called()

def test_rate_limit_outage_never_falls_back(monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock
    from services import auth_limits
    monkeypatch.setattr(auth_limits.settings,'REDIS_URL','redis://unused')
    monkeypatch.setattr(auth_limits.settings,'AUTH_RATE_HMAC_KEY','separate-test-key')
    redis=SimpleNamespace(eval=AsyncMock(side_effect=ConnectionError('unavailable')))
    monkeypatch.setattr(auth_limits,'_client',redis)
    with pytest.raises(HTTPException) as error:asyncio.run(auth_limits.limit('login','person',5,300))
    assert error.value.status_code==503

def test_rate_limit_key_is_hmac_and_single_atomic_call(monkeypatch):
    import asyncio
    from unittest.mock import AsyncMock
    from services import auth_limits
    monkeypatch.setattr(auth_limits.settings,'REDIS_URL','redis://unused')
    monkeypatch.setattr(auth_limits.settings,'AUTH_RATE_HMAC_KEY','separate-test-key')
    redis=SimpleNamespace(eval=AsyncMock(return_value=[1,300]));monkeypatch.setattr(auth_limits,'_client',redis)
    asyncio.run(auth_limits.limit('login-account','private.login',5,300))
    redis.eval.assert_awaited_once()
    assert 'private.login' not in str(redis.eval.call_args)

def test_validation_response_never_echoes_secrets():
    import asyncio,json
    from main import private_validation_error
    from fastapi.exceptions import RequestValidationError
    error=RequestValidationError([{'loc':('body','new_password'),'type':'value_error','msg':'contains secret','input':'secret-password','ctx':{'error':'secret-password'}}])
    response=asyncio.run(private_validation_error(None,error))
    assert b'secret-password' not in response.body
    assert b'contains secret' not in response.body
    assert response.status_code==422
