FROM python:3.12-slim@sha256:2fe5997d249a808b8eeea52c58a1dbffbba28754dc11699ef5c029f2d818ce79 AS contracts-build
WORKDIR /contracts-build
COPY agents/meeting-analyzer/requirements.lock /tmp/contracts-build.lock
RUN pip install --require-hashes -r /tmp/contracts-build.lock
COPY packages/dmb-agent-contracts /contracts-build/source
RUN pip wheel --no-deps --no-build-isolation --wheel-dir /contracts-wheel /contracts-build/source

FROM python:3.12-slim@sha256:2fe5997d249a808b8eeea52c58a1dbffbba28754dc11699ef5c029f2d818ce79

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY agents/business-analyst/requirements-linux.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock

COPY --from=contracts-build /contracts-wheel /contracts-wheel
RUN pip install --no-index --no-deps /contracts-wheel/dmb_agent_contracts-1.4.1-py3-none-any.whl && rm -rf /contracts-wheel

COPY agents/business-analyst /app

RUN addgroup --system --gid 10001 dmbagent && adduser --system --uid 10001 --ingroup dmbagent dmbagent \
    && chown -R dmbagent:dmbagent /app

ENV DMB_AGENT_SERVICE_ID=business-analyst DMB_AGENT_REQUIRE_LIMITER=true DMB_AGENT_LIMITER_STATE_DIR=/state/agent-limiter
RUN mkdir -p /state/agent-limiter && chown dmbagent:dmbagent /state/agent-limiter

USER dmbagent
EXPOSE 9000

CMD ["python", "-m", "dmb_agent_contracts.entry", "--app", "business_analyst.main:app", "--host", "0.0.0.0", "--port", "9000"]
