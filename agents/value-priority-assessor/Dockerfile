FROM python:3.12-slim@sha256:2fe5997d249a808b8eeea52c58a1dbffbba28754dc11699ef5c029f2d818ce79 AS contracts-build
WORKDIR /contracts-build
COPY agents/meeting-analyzer/requirements.lock /tmp/contracts-build.lock
RUN pip install --require-hashes -r /tmp/contracts-build.lock
COPY packages/dmb-agent-contracts /contracts-build/source
RUN pip wheel --no-deps --no-build-isolation --wheel-dir /contracts-wheel /contracts-build/source

FROM python:3.12-slim@sha256:2fe5997d249a808b8eeea52c58a1dbffbba28754dc11699ef5c029f2d818ce79

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN addgroup --system --gid 10001 prioritiser \
    && adduser --system --uid 10001 --ingroup prioritiser --home /nonexistent --no-create-home prioritiser \
    && mkdir -p /data \
    && chown prioritiser:prioritiser /data

COPY agents/value-priority-assessor/requirements-linux.lock /app/requirements.lock
RUN pip install --no-cache-dir --require-hashes --extra-index-url https://download.pytorch.org/whl/cpu -r /app/requirements.lock

ARG RAG_EMBEDDING_MODEL=intfloat/multilingual-e5-base
ARG RAG_EMBEDDING_REVISION=d13f1b27baf31030b7fd040960d60d909913633f
ENV PRIORITISER_RAG_EMBEDDING_MODEL=${RAG_EMBEDDING_MODEL} \
    PRIORITISER_RAG_EMBEDDING_REVISION=${RAG_EMBEDDING_REVISION} \
    PRIORITISER_RAG_MODEL_CACHE_DIR=/opt/huggingface \
    PRIORITISER_RAG_LOCAL_FILES_ONLY=true
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${RAG_EMBEDDING_MODEL}', revision='${RAG_EMBEDDING_REVISION}', cache_folder='/opt/huggingface')"

COPY --from=contracts-build /contracts-wheel /contracts-wheel
RUN pip install --no-index --no-deps /contracts-wheel/dmb_agent_contracts-1.4.1-py3-none-any.whl && rm -rf /contracts-wheel

COPY --chown=prioritiser:prioritiser agents/value-priority-assessor /app

EXPOSE 9100

ENV DMB_AGENT_SERVICE_ID=value-priority-assessor DMB_AGENT_REQUIRE_LIMITER=true DMB_AGENT_LIMITER_STATE_DIR=/state/agent-limiter
RUN mkdir -p /state/agent-limiter && chown 10001:10001 /state/agent-limiter

USER 10001:10001

CMD ["python", "-m", "dmb_agent_contracts.entry", "--app", "value_priority_assessor.api.main:app", "--host", "0.0.0.0", "--port", "9100"]
