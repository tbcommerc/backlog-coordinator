FROM python:3.12-slim@sha256:2fe5997d249a808b8eeea52c58a1dbffbba28754dc11699ef5c029f2d818ce79

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY agent/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock

COPY agent /app

RUN addgroup --system dmbagent && adduser --system --ingroup dmbagent dmbagent \
    && chown -R dmbagent:dmbagent /app

USER dmbagent
EXPOSE 9000

CMD ["python", "-m", "uvicorn", "run:app", "--host", "0.0.0.0", "--port", "9000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
