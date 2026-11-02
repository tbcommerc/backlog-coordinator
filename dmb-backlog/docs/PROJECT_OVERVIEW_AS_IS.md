# Backlog coordinator: документация фактического состояния

Состав сервисов и схема подключений сверены по коду и скриптам 17.10.2026. Статус: **AS-IS PARTIAL**. Остальные разделы сохраняют baseline от 01.09.2026 и требуют адресной сверки; эта редакция не является повторной проверкой всех API, версий зависимостей и сценариев. Открытая работа: [DOC-01](../../docs/OPEN_TASKS.md).

Основные источники проверки: `backend/main.py`, `backend/config.py`, `backend/models.py`, `backend/routers/`, `backend/rate_limit.py`, `frontend/js/`, `agents/business-analyst/business_analyst/`, профильные тесты и корневой `../../.github/workflows/quality.yml`. При расхождении с кодом приоритет имеет исполняемая реализация.

## Назначение

Репозиторий содержит следующие сервисы:

| Каталог | Назначение | Локальный запуск |
|---|---|---|
| `dmb-backlog/` | FastAPI backend и встроенная раздача SPA | Стандартный запуск, порт 8000 |
| `agents/business-analyst/` | AI Business Analyst Assistant V1 | Стандартный запуск, порт 9000 |
| `agents/business-analyst-experimental/` | Целевой fork V1: подготовка и ревью БТ | Обязателен в start-project.ps1, порт 9300; UI `#/agent-v2` |
| `agents/backlog-assistant/` | Самостоятельный помощник с OpenCode runtime и ограниченным Data API | `-IncludeBacklogAssistant`; скрипт также включает его при наличии agents/backlog-assistant/.env |
| `agents/value-priority-assessor/` | Финансовый эффект и приоритет | Только явный `-IncludeValuePriorityAssessor`, порт 9100 |

Режим запуска сервиса не заменяет его настройки доступа и allowlist. Основной backend хранит рабочие сущности и проксирует разрешённые запросы к агентам. Новые контуры включают рабочие задачи/проекты, согласование редакций БТ, поручения встреч и безопасность учётных записей.

## Контекст и компоненты

```text
Browser SPA → DMB FastAPI :8000
  ├─ PostgreSQL / SQLAlchemy / Alembic
  ├─ shared attachment storage
  ├─ transactional outbox → Redis Stream → SSE
  ├─ Agent V1 :9000
  ├─ Agent V2 :9300 (gateway /api/v2/agent)
  ├─ Backlog Assistant (gateway /api/v1/backlog-assistant; OpenCode runtime)
  ├─ Task Prioritiser :9100 (opt-in)
  └─ legacy Assistant V2 :9200 (opt-in; gateway /api/v2/assistant)
```

Источники сверки: [backend/main.py](../backend/main.py), [router.js](../frontend/js/router.js), [start-project.ps1](../../scripts/start-project.ps1). Подробные действующие контракты: [WORK_TASKS](WORK_TASKS.md), [ACCOUNT_SECURITY](ACCOUNT_SECURITY.md), [Agent V2](../../agents/business-analyst-experimental/README.md), [помощник по бэклогу](../../agents/backlog-assistant/README.md). Локальная эксплуатация: [LOCAL_DEVELOPMENT](../../docs/LOCAL_DEVELOPMENT.md).

## Технологии

| Слой | Реализация |
|---|---|
| Web API | FastAPI 0.109, Pydantic 2.5 |
| Persistence | SQLAlchemy 2.0; PostgreSQL 16; Alembic |
| Auth | JWT HS256, bcrypt, access + refresh |
| Frontend | Vanilla ES modules, hash router, CSS custom properties |
| Visualization | Chart.js, ECharts |
| Import/export | CSV backend, SheetJS frontend |
| Agent LLM | mock или OpenAI-compatible HTTP API |
| Tests | pytest/httpx |

## Точки входа

### Backlog backend

- `dmb-backlog/backend/main.py` — приложение, middleware, routers, static files, scheduler.
- `dmb-backlog/backend/config.py` — окружение.
- `dmb-backlog/backend/database.py` — engine/session и auto-schema.
- `dmb-backlog/backend/models.py` — ORM.
- `dmb-backlog/backend/schemas.py` — transport schemas.
- `dmb-backlog/backend/routers/` — API по доменам.

### Frontend

- `dmb-backlog/frontend/index.html` — shell.
- `frontend/js/app.js` — bootstrap/auth/layout.
- `frontend/js/router.js` — hash routes.
- `frontend/js/api.js` — fetch/JWT refresh.
- `frontend/js/components/` — страницы и крупные UI-компоненты.
- `frontend/css/` — tokens/base/components/pages.

### Agent

- `agents/business-analyst/run.py` — локальный запуск.
- `agents/business-analyst/business_analyst/main.py` — FastAPI assembly.
- `agents/business-analyst/business_analyst/api/router.py` — internal API.
- `agents/business-analyst/business_analyst/agentic_orchestrator.py` — основной model-driven dialogue runtime.
- `agents/business-analyst/business_analyst/orchestrator.py` — legacy runtime и общие детерминированные операции workflow.
- `agents/business-analyst/business_analyst/dialogue/agentic.py` — structured model decision и применение фактов.
- `agents/business-analyst/business_analyst/dialogue/` — agentic-компоненты и модули legacy rollback.
- `agents/business-analyst/business_analyst/kb/` — загрузка и поиск по базе знаний.
- `agents/business-analyst/business_analyst/llm/` — provider abstraction.

## Фактический runtime backlog

При каждом старте backend:

1. Создаются отсутствующие таблицы.
2. Недостающие колонки добавляются через динамический `ALTER TABLE`.
3. Проверяется целостность схемы БД.
4. Монтируется frontend.

Дополнительные операции управляются настройками:

- `RUN_STARTUP_SEED` — seed справочников, пользователей, ресурсов, field labels и миграция team FK;
- `RUN_STARTUP_MAINTENANCE` — пересчёт вычисляемых трудозатрат и синхронизация стандартных отчётов;
- `RUN_NOTIFICATION_SCHEDULER` — встроенный hourly scheduler уведомлений.

Если соответствующий флаг не задан, каждая операция наследует значение `DEBUG`: включена в dev-режиме и выключена при `DEBUG=false`. Поэтому dev-restart по умолчанию не является read-only. Каталог uploads не публикуется как static: скачивание выполняется через авторизованный API endpoint.

## API-группы backlog

| Prefix | Назначение |
|---|---|
| `/api/v1/auth` | login, refresh, me, logout |
| `/api/v1/tasks` | задачи, locks/viewers, comments, attachments, import, bulk, analytics |
| `/api/v1/teams` | команды и ресурсы |
| `/api/v1/users` | пользователи |
| `/api/v1/reports` | отчёты и выполнение |
| `/api/v1/admin` | роли, пользователи, справочники, display settings, audit |
| `/api/v1/customer` | customer portal/chat |
| `/api/v1/quick-estimate` | задачи, эпики и stories экспресс-оценки |
| `/api/v1/notifications` | уведомления и preferences |
| `/api/v1/timeline` | события timeline |
| `/api/v1/agent` | proxy и persisted requirement requests |

Источником фактической схемы запросов остаётся автоматически создаваемый `/docs`. Отсутствие дублирующихся method/path пар admin-router контролируется `backend/tests/test_route_uniqueness.py`.

## Основные frontend routes

`#/dashboard`, `#/backlog`, `#/team-backlog`, `#/express-estimate`, `#/kanban`, `#/reports`, `#/analytics/tribe`, `#/analytics/po-pl`, `#/analytics/it`, `#/notifications`, `#/settings`, `#/admin`, `#/audit-log`, `#/customer`, `#/customer/create`, `#/review`.

Доступность пунктов меню вычисляется на клиенте, но безопасность обязана обеспечиваться backend-проверками; скрытие route в SPA не является авторизацией.

## Данные и владение

Ключевые сущности: User, Role, RefreshSession, Team, Task, TaskHistory, TaskComment, TaskAttachment, TaskViewer, справочники статуса/приоритета/дедлайна/проекта, Notification, Report, TimelineEvent, Epic, Story и RequirementRequest.

Файлы хранятся отдельно от БД в `backend/uploads/{task_id}`; БД содержит metadata. Нужны согласованный backup и orphan cleanup.

## Аутентификация

1. Login возвращает короткоживущий access JWT и устанавливает refresh-токен в cookie `dmb_refresh`.
2. Access-токен хранится только в памяти SPA; в `localStorage` сохраняется профиль пользователя, но не действующие токены.
3. Refresh cookie имеет `HttpOnly`, `SameSite=Strict`, ограниченный path `/api/v1/auth` и `Secure` при `DEBUG=false`.
4. API client добавляет access-токен как Bearer.
5. При 401 выполняются rotation серверной refresh-сессии, получение нового access-токена и повтор исходного запроса.
6. Logout отзывает текущую refresh-сессию в БД и удаляет cookie.

Роли содержат строковые уровни доступа. Применение этих уровней пока не единообразно; риски на дату аудита описаны в `archive/reviews/CODE_REVIEW_2026-08-19.md`.

## Конфигурация

### Backlog

`APP_NAME`, `APP_VERSION`, `DEBUG`, `RUN_STARTUP_SEED`, `RUN_STARTUP_MAINTENANCE`, `RUN_NOTIFICATION_SCHEDULER`, `DATABASE_URL`, `REDIS_URL`, `SECRET_KEY`, `ALGORITHM`, сроки JWT, `CORS_ORIGINS`, `AGENT_BASE_URL`, `AGENT_SECRET`.

### Agent

`LLM_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`, `SESSION_DATABASE_URL`, `SESSION_DB`, `AGENT_PORT`, `DEBUG`, `AGENT_SECRET`, `MCP_SERVERS_JSON`, `TOOLS_CONFIG_JSON`.

Production должен запускаться только с явно заданными уникальными secret’ами и `DEBUG=false`.

## Локальный запуск без изменения production-данных

Используйте единый безопасный сценарий из корня проекта:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1
```

Agent:

```powershell
cd D:\Проект\agent
$env:AGENT_SECRET = '<одинаковое-значение-для-двух-сервисов>'
$env:LLM_PROVIDER = 'mock'
python run.py
```

Отдельный production worker плановых уведомлений (рекомендуемый активный процесс;
standby безопасен благодаря PostgreSQL advisory lock):

```powershell
cd D:\Проект\dmb-backlog\backend
python run_notification_scheduler.py
```

Внимание: PostgreSQL-схема изменяется только Alembic. Автоматический `create_all`
сохранён для SQLite-совместимости. Seed и maintenance в production запрещены.

## Проверки

```powershell
# Agent
python -m pytest D:\Проект\agents\business-analyst\agent\tests -q --basetemp D:\Проект\.test-tmp-agent -p no:cacheprovider

# Backend — запускать только против отдельной тестовой БД
cd D:\Проект\dmb-backlog\backend
pytest tests -v
```

Фактический GitHub Actions workflow `../../.github/workflows/quality.yml` выполняет Python compile, backend pytest, проверку синтаксиса JavaScript, frontend unit tests и `pip-audit`. Ruff, ESLint, browser smoke и secret scan в этом workflow не подтверждены.

## Эксплуатационные ограничения As-Is

- Production-конфигурация требует отдельные PostgreSQL БД для backlog и agent.
- Scheduler использует PostgreSQL advisory lock; failover требует стендового smoke.
- Rate limit использует Redis при заданном `REDIS_URL`, иначе process-local memory fallback.
- Production требует общий `ATTACHMENT_STORAGE_DIR` для всех backend instances.
- Agent sessions в production сохраняются в PostgreSQL и сериализуются advisory lock.
- `/health` проверяет процесс; `/health/ready` — DB, Redis, storage и outbox.
- Task/notification invalidations доставляются через transactional outbox,
  Redis Stream и авторизованный SSE; polling остаётся fallback.
- Есть GitHub Actions quality workflow, Dockerfile каждого сервиса, локальный
  Compose для data services и `compose.production.yaml` для стендового baseline.
- Observability включает stdout/file logs, `X-Request-ID`, `/metrics`, базовые
  alert rules и OpenTelemetry-трассы backend/agent с `X-Trace-ID` и корреляцией
  в `audit_log`.

## Связанные документы

- `archive/reviews/CODE_REVIEW_2026-08-19.md` — исторический аудит рисков и исправлений на 19.08.2026.
- `ARCHITECTURE.md` — расширенное архитектурное описание; утверждения сверять с реализацией.
- `API_SPEC.md` — ручная спецификация API.
- `DATA_MODEL.md` и `db-schema.dbml` — модель данных.
- `SECURITY.md` — заявленные security practices.
- `DEPLOYMENT.md` — локальные и целевые сценарии развёртывания.
- `TESTING.md` — стратегия тестирования.
- `agents/business-analyst/docs/` — отдельная документация AI-агента.
