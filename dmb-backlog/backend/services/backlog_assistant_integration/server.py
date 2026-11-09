"""Separate private listener: TLS client verification cannot be disabled by a header."""
import ssl
import os
from dmb_agent_contracts.serve import serve
from fastapi import FastAPI
from config import settings
from routers.backlog_assistant_data_router import router

app = FastAPI(title="DMB Backlog Assistant Data API", version="1.0.0")
app.include_router(router, prefix="/internal/backlog-assistant/v1")


@app.get("/health")
def health():
    from database import engine
    from sqlalchemy import text
    with engine.connect() as connection:
        connection.execute(text("SELECT 1 FROM backlog_assistant_integration LIMIT 1"))
    return {"status": "ok"}

if __name__ == "__main__":
    try:
        port=int(os.environ.get("BACKLOG_ASSISTANT_DATA_API_PORT","9450"))
        if not 1<=port<=65535: raise ValueError()
    except ValueError:
        raise ValueError("invalid_BACKLOG_ASSISTANT_DATA_API_PORT") from None
    serve(app, host="127.0.0.1", port=port, access_log=False,
        ssl_certfile=settings.BACKLOG_ASSISTANT_TLS_CERT, ssl_keyfile=settings.BACKLOG_ASSISTANT_TLS_KEY,
        ssl_ca_certs=settings.BACKLOG_ASSISTANT_TLS_CA, ssl_cert_reqs=ssl.CERT_REQUIRED)
