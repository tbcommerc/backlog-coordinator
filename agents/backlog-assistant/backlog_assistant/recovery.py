"""History-only mTLS application: attestation and current-source rechecks remain."""
import os
import ssl
from sqlalchemy import create_engine
from dmb_agent_contracts.recovery import readonly_app
from dmb_agent_contracts.serve import serve
from .app import create_app
from .data_client import HTTPDataPort
from .store import Store,metadata


def create_recovery_app(store=None,data=None,secret=None):
    if store is None:
        from .config import environment
        os.environ.update(environment())
        if not os.environ['ASSISTANT_DATABASE_URL'].startswith('postgresql+psycopg://'):
            raise ValueError('recovery_requires_existing_postgresql')
        store=Store(create_engine(os.environ['ASSISTANT_DATABASE_URL'],pool_pre_ping=True))
        data=HTTPDataPort(os.environ['DMB_DATA_API_URL'],os.environ['ASSISTANT_SERVICE_TOKEN'],
            verify=os.environ['ASSISTANT_TLS_CA'],cert=(os.environ['ASSISTANT_TLS_CERT'],os.environ['ASSISTANT_TLS_KEY']))
        secret=os.environ['ASSISTANT_GATEWAY_SECRET']
    legacy=create_app(store,data,None,secret,run_workers=False)
    return readonly_app(legacy,engines=[store.engine],service_id='backlog-assistant',
        auth_nonce_tables=('backlog_assistant_nonces',),required_tables=tuple(metadata.tables))


if __name__=='__main__':
    from .config import environment,service_port
    os.environ.update(environment())
    serve(create_recovery_app(),host='127.0.0.1',port=service_port('ASSISTANT_PORT',9400),access_log=False,
        ssl_keyfile=os.environ['ASSISTANT_TLS_KEY'],ssl_certfile=os.environ['ASSISTANT_TLS_CERT'],
        ssl_ca_certs=os.environ['ASSISTANT_TLS_CA'],ssl_cert_reqs=ssl.CERT_REQUIRED)
