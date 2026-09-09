FROM python:3.12-slim@sha256:2fe5997d249a808b8eeea52c58a1dbffbba28754dc11699ef5c029f2d818ce79

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app/backend

COPY dmb-backlog/backend/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock

COPY dmb-backlog/backend /app/backend
COPY dmb-backlog/frontend /app/frontend

RUN addgroup --system dmb && adduser --system --ingroup dmb dmb \
    && mkdir -p /data/attachments /app/backend/logs \
    && chown -R dmb:dmb /data/attachments /app/backend/logs

USER dmb
EXPOSE 8000

CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
