FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY agent/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY agent /app

RUN addgroup --system dmbagent && adduser --system --ingroup dmbagent dmbagent \
    && chown -R dmbagent:dmbagent /app

USER dmbagent
EXPOSE 9000

CMD ["python", "-m", "uvicorn", "run:app", "--host", "0.0.0.0", "--port", "9000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
