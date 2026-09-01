# AI Business Analyst Agent — запуск и эксплуатация

> AS-IS проверено по `run.py`, `agent/main.py`, `agent/config.py`, Dockerfile,
> корневым Compose/scripts и runtime tests 01.09.2026.

## Поддерживаемые сценарии

Штатный локальный сценарий запускает всю платформу. Standalone-команды Agent
нужны для диагностики и разработки одного сервиса. Поставляемый production
baseline находится в корневом `compose.production.yaml`; systemd/Kubernetes
manifest в репозитории не поддерживается.

## Локальный запуск всей платформы

Из корня проекта на Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1
```

Сценарий:

1. проверяет Docker и поднимает PostgreSQL/Redis;
2. создаёт `.venv` и устанавливает зависимости backlog + Agent;
3. создаёт отдельное `.venv-prioritiser`;
4. применяет Alembic-миграции backlog;
5. запускает Agent на `127.0.0.1:9000`;
6. ждёт `GET /api/agent/health`;
7. запускает Prioritiser и DMB Backend.

Логи Agent: `.runtime/agent.out.log` и `.runtime/agent.err.log`.

## Standalone-диагностика

Из каталога `agent` после установки `requirements.txt`:

```powershell
python run.py
```

Либо явно:

```powershell
python -m uvicorn agent.main:app --host 127.0.0.1 --port 9000
```

Health:

```powershell
Invoke-RestMethod http://127.0.0.1:9000/api/agent/health
```

## Конфигурация

Источник — `agent/.env` или переменные окружения. Шаблон — `.env.example`.

| Группа | Переменные |
|---|---|
| Service | `APP_NAME`, `APP_VERSION`, `DEBUG`, `AGENT_PORT` |
| Security | `AGENT_SECRET` |
| Sessions | `SESSION_DATABASE_URL`, `SESSION_DB`, `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT_SECONDS` |
| LLM | `LLM_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`, `AGENT_DECISION_MAX_TOKENS` |
| Retrieval | `KB_DIR`, `KB_MAX_DOCS`, `KB_MAX_SNIPPETS` |
| Integrations | `MCP_SERVERS_JSON`, `TOOLS_CONFIG_JSON` |
| Telemetry | `OTEL_ENABLED`, `OTEL_SERVICE_NAME`, `OTEL_DEPLOYMENT_ENVIRONMENT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_TRACE_SAMPLE_RATIO`, `OTEL_EXPORT_TIMEOUT_SECONDS`, `OTEL_EXCLUDED_URLS` |

`LLM_PROVIDER` поддерживает `mock` и `openai_compat`. Mock предназначен для
health-check и детерминированных тестов; полный агентный диалог должен
использовать доступный `openai_compat` endpoint.

## Production validation

При `DEBUG=false` startup прекращается, если:

- `AGENT_SECRET` пустой или равен dev-значению;
- `SESSION_DATABASE_URL` отсутствует либо указывает на SQLite;
- `LLM_PROVIDER` не равен `openai_compat`;
- `OPENAI_API_KEY` пустой;
- OpenTelemetry включён без OTLP endpoint;
- sample ratio находится вне диапазона 0–1.

Таким образом production требует PostgreSQL session store и реальный
OpenAI-compatible provider. SQLite (`SESSION_DB`) остаётся только для debug и
изолированных тестов.

## Docker Compose baseline

`compose.production.yaml` собирает `agent/Dockerfile`, запускает две реплики и
подключает их к отдельной PostgreSQL БД `agent_sessions`. Backend обращается к
service name `agent:9000`. Agent не публикуется наружу через Nginx.

Обязательные секреты передаются через внешний env-файл; рабочий `.env` не
коммитится. Общий `AGENT_SECRET` должен совпадать у backlog и Agent.

Статическая проверка production-конфигурации:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/validate-production-config.ps1
```

Полный порядок запуска, rollback и backup —
[../../docs/PRODUCTION_RUNBOOK.md](../../docs/PRODUCTION_RUNBOOK.md).

## Session store и multi-worker

Session store использует SQLAlchemy, CAS-version и PostgreSQL advisory lock.
Mutations одной сессии сериализуются, а `message_id` обеспечивает
идемпотентность повторного HTTP-вызова. Миграция старых SQLite-сессий выполняется
только отдельным проверенным сценарием `scripts/migrate-agent-sessions.py`.

Не направляйте миграционные/тестовые скрипты на рабочую БД без отдельного плана.

## Knowledge Base

Curated Markdown/JSON загружается из `kb_seed/` при старте. Внешние RAG/DB
источники подключаются через `KnowledgeSource`; сетевой клиент, авторизация и
object-level фильтрация остаются обязанностью интеграционного callback.

См. [KB_GUIDE.md](KB_GUIDE.md) и
[KB_SOURCE_ADAPTERS.md](KB_SOURCE_ADAPTERS.md).

## Наблюдаемость

При `OTEL_ENABLED=true` Agent отправляет FastAPI, SQLAlchemy и urllib traces по
OTLP/HTTP. `X-Trace-ID` возвращается вызывающему backend. Endpoint Prometheus у
Agent отсутствует; proxy latency/errors измеряет backlog.

Application logs идут в stdout/stderr. Файловый audit создаёт runtime Agent;
retention и централизованный сбор определяет владелец стенда.

## Сетевая безопасность

- Agent — внутренний service-to-service API.
- Shared secret не заменяет пользовательскую авторизацию backlog.
- TLS завершается на корпоративном ingress; внутренний network policy должен
  запрещать прямой клиентский доступ к 9000.
- CORS и browser cookies Agent не использует.
- Внешний rate limit применяется на ingress/backend.

## Проверки

Из каталога `agent`:

```powershell
..\.venv\Scripts\python.exe -m pytest agent\tests -q -p no:cacheprovider
```

На 01.09.2026 collection содержит 230 тестов. Для многорепличного допуска нужны
отдельные smoke проверки PostgreSQL, повторов `message_id`, trace propagation и
failover; unit-тесты не заменяют стендовую проверку.
