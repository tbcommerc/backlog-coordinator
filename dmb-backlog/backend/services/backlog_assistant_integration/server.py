"""Separate private listener: TLS client verification cannot be disabled by a header."""
import ssl
import uvicorn
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
    uvicorn.run(app, host="127.0.0.1", port=9450, access_log=False,
        ssl_certfile=settings.BACKLOG_ASSISTANT_TLS_CERT, ssl_keyfile=settings.BACKLOG_ASSISTANT_TLS_KEY,
        ssl_ca_certs=settings.BACKLOG_ASSISTANT_TLS_CA, ssl_cert_reqs=ssl.CERT_REQUIRED)
