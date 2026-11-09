FROM python:3.12-slim@sha256:2fe5997d249a808b8eeea52c58a1dbffbba28754dc11699ef5c029f2d818ce79 AS build
WORKDIR /build
COPY agents/meeting-analyzer/requirements.lock /build/requirements.lock
RUN pip install --require-hashes -r requirements.lock
COPY packages/dmb-agent-contracts /build/contracts
COPY agents/meeting-analyzer /build/meeting
RUN pip wheel --no-deps --no-build-isolation --wheel-dir /wheels /build/contracts /build/meeting

FROM python:3.12-slim@sha256:2fe5997d249a808b8eeea52c58a1dbffbba28754dc11699ef5c029f2d818ce79
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY agents/meeting-analyzer/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock \
    && rm -f /tmp/requirements.lock \
    && useradd --system --uid 10001 agent
COPY --from=build /wheels /wheels
RUN pip install --no-index --no-deps /wheels/*.whl && rm -rf /wheels
ENV DMB_AGENT_SERVICE_ID=meeting-analyzer DMB_AGENT_REQUIRE_LIMITER=true DMB_AGENT_LIMITER_STATE_DIR=/state/agent-limiter
RUN mkdir -p /state/agent-limiter && chown 10001:10001 /state/agent-limiter

USER agent
EXPOSE 9500
CMD ["python", "-m", "dmb_agent_contracts.entry", "--app", "meeting_analyzer.api:app", "--host", "0.0.0.0", "--port", "9500"]
