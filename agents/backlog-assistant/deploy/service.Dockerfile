FROM docker:27.5.1-cli@sha256:851f91d241214e7c6db86513b270d58776379aacc5eb9c4a87e5b47115e3065c AS docker-cli
FROM python:3.12-slim@sha256:2fe5997d249a808b8eeea52c58a1dbffbba28754dc11699ef5c029f2d818ce79 AS contracts-build
WORKDIR /contracts-build
COPY agents/meeting-analyzer/requirements.lock /tmp/contracts-build.lock
RUN pip install --require-hashes -r /tmp/contracts-build.lock
COPY packages/dmb-agent-contracts /contracts-build/source
RUN pip wheel --no-deps --no-build-isolation --wheel-dir /contracts-wheel /contracts-build/source

FROM python:3.12-slim@sha256:2fe5997d249a808b8eeea52c58a1dbffbba28754dc11699ef5c029f2d818ce79
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY agents/backlog-assistant/requirements.lock /tmp/requirements.lock
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.lock
COPY --from=contracts-build /contracts-wheel /contracts-wheel
RUN pip install --no-index --no-deps /contracts-wheel/dmb_agent_contracts-1.4.1-py3-none-any.whl && rm -rf /contracts-wheel

COPY agents/backlog-assistant/backlog_assistant /app/backlog_assistant
COPY agents/backlog-assistant/runtime /app/runtime
COPY agents/backlog-assistant/bridge /app/bridge
COPY agents/backlog-assistant/contracts /app/contracts
COPY agents/backlog-assistant/fixtures /app/fixtures
RUN useradd --system --uid 10001 agent
ENV DMB_AGENT_SERVICE_ID=backlog-assistant DMB_AGENT_REQUIRE_LIMITER=true DMB_AGENT_LIMITER_STATE_DIR=/state/agent-limiter
RUN mkdir -p /state/agent-limiter && chown 10001:10001 /state/agent-limiter
RUN mkdir -p /state/instances && chown 10001:10001 /state/instances

USER agent
CMD ["python", "-m", "dmb_agent_contracts.entry", "--module", "backlog_assistant.bootstrap"]
