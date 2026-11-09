"""Container mTLS API/PG/Worker with explicit in-memory data/runtime fixtures.

No Docker socket or provider credential is mounted. This does not qualify the
separate trusted-controller topology or physical model-runtime isolation.
"""
from pathlib import Path
import runpy

HARNESS = r'''
import json,os,threading,time,ssl,ipaddress
from pathlib import Path
from datetime import datetime,timedelta,timezone
database=os.environ['QUALIFICATION_DATABASE']
assert database.startswith('backlog_container_') and database.replace('_','').isalnum()
url='postgresql+psycopg://postgres@127.0.0.1:5432/'+database
os.environ.update(DMB_AGENT_SERVICE_ID='backlog-assistant',DMB_AGENT_LIMITER_MODE='standalone',
 DMB_AGENT_LIMITER_REDIS_URL=os.environ['QUALIFICATION_REDIS_URL'],
 DMB_AGENT_LIMITER_STATE_DIR='/tmp/limiter',DMB_AGENT_LIMITER_NAMESPACE=database)
from dmb_agent_contracts.entry import prepare_runtime
prepare_runtime()
from backlog_assistant.migrate import migrate
migrate(url)
from sqlalchemy import create_engine
from backlog_assistant.store import Store
from backlog_assistant.app import create_app
from backlog_assistant.security import sign,Identity
from contracts.models import Context
from fixtures.data import FakeData
from runtime.fake import FakeRuntime
engine=create_engine(url)
store,data,runtime=Store(engine),FakeData(),FakeRuntime()
secret='synthetic-container-only-'+'x'*32
app=create_app(store,data,runtime,secret,fixture_registration=data.register)
import sys
pem=json.load(sys.stdin)
cert_file=Path('/tmp/fixture-certificate.pem');key_file=Path('/tmp/fixture-key.pem')
cert_file.write_text(pem['certificate'])
key_file.write_text(pem['private_key'])
del pem
key_file.chmod(0o600)
context=ssl.create_default_context(cafile=str(cert_file));context.load_cert_chain(str(cert_file),str(key_file))
import uvicorn,httpx
server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=19000,log_level='warning',
 ssl_certfile=str(cert_file),ssl_keyfile=str(key_file),ssl_ca_certs=str(cert_file),ssl_cert_reqs=ssl.CERT_REQUIRED))
thread=threading.Thread(target=server.run,daemon=True);thread.start()
try:
    with httpx.Client(base_url='https://127.0.0.1:19000',verify=context,timeout=20,trust_env=False) as client:
        for _ in range(100):
            try:
                if client.get('/health/ready').status_code==200:break
            except httpx.TransportError:pass
            time.sleep(.1)
        else:raise AssertionError('container_not_ready')
        def send(method,path,body=None,actor='one',key=''):
            raw=json.dumps(body,ensure_ascii=False).encode() if body is not None else b''
            token=sign(secret,actor,method,path,raw,key)
            return client.request(method,path,content=raw,headers={'X-Gateway-Attestation':token,
              'Idempotency-Key':key,'X-Read-Proof':'synthetic-current-read','Content-Type':'application/json'})
        assert client.get('/v1/sessions').status_code==401
        created=send('POST','/v1/sessions',{},key='stable-session')
        assert created.status_code==201,created.text
        sid=created.json()['id']
        execution=send('POST','/fixtures/executions').json()['execution_ref']
        body={'text':'Найди синтетическую работу','context_revision':1,
          'context':Context().model_dump(mode='json'),'execution_ref':execution}
        path='/v1/sessions/'+sid+'/messages'
        accepted=send('POST',path,body,key='stable-message')
        assert accepted.status_code==202,accepted.text
        rid=accepted.json()['run_id']
        assert send('POST',path,body,key='stable-message').json()['run_id']==rid
        for _ in range(100):
            result=send('GET','/v1/runs/'+rid)
            if result.json()['status'] in ('completed','failed','cancelled','interrupted'):break
            time.sleep(.1)
        assert result.json()['status']=='completed',result.text
        assert result.json()['answer']['verified_blocks'][0]['total']==1
        assert not runtime.instances and data.executions[execution]['revoked']
        assert send('GET','/v1/sessions/'+sid,actor='two').status_code==404
        data.revoked_owners.add(Identity('dmb','one').owner)
        assert send('GET','/v1/runs/'+rid).json()['answer'] is None
        without_client=ssl.create_default_context(cafile=str(cert_file))
        try:
            with httpx.Client(verify=without_client,trust_env=False,timeout=3) as anonymous:
                anonymous.get('https://127.0.0.1:19000/health/ready')
        except httpx.TransportError:pass
        else:raise AssertionError('mtls_client_certificate_not_required')
        report={'status':'PASS','scope':'backlog_container_real_mtls_pg_worker_fixture_runtime',
          'checks':['real_mtls','no_client_certificate_denied','signed_attestation_required',
          'actual_worker','stable_message_run','verified_server_evidence','owned_fixture_cleanup',
          'foreign_owner_404','history_access_revalidated'],
          'data_port':'in_memory_fixture','runtime':'explicit_fake_contract_fixture',
          'physical_model_runtime':'NOT_TESTED','docker_socket_mounted':False,
          'source_mounts':0,'runtime_package_installs':0,'live_model_calls':0,
          'protected_writes':0,'real_remote':'NOT_RUN','production_compose':'NOT_TESTED'}
finally:
    server.should_exit=True;thread.join(15);engine.dispose()
assert not thread.is_alive(),'lifespan_shutdown_incomplete'
print(json.dumps(report),flush=True)
'''


def certificate_fixture():
    # Generated in host memory and transferred on stdin, never argv/logs or mounts.
    import ipaddress
    import json
    from datetime import datetime,timedelta,timezone
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes,serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID,ExtendedKeyUsageOID
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    subject=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'synthetic-container-qualification')])
    now=datetime.now(timezone.utc)
    certificate=(x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
      .public_key(key.public_key()).serial_number(x509.random_serial_number())
      .not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(minutes=30))
      .add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True)
      .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False)
      .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH,ExtendedKeyUsageOID.CLIENT_AUTH]),critical=False)
      .sign(key,hashes.SHA256()))
    return json.dumps({'certificate':certificate.public_bytes(serialization.Encoding.PEM).decode(),
      'private_key':key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,
      serialization.NoEncryption()).decode()})


if __name__=='__main__':
    helper=runpy.run_path(str(Path(__file__).with_name('qualify-v1-container.py')))
    helper['main'](harness=HARNESS,prefix='backlog_container_',label='backlog',runtime_input=certificate_fixture())
