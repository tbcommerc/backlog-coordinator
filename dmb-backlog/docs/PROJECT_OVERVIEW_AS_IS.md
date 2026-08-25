# DMB Platform: документация фактического состояния

Дата проверки: 24 августа 2026 года. Статус: **AS-IS VERIFIED** в пределах перечисленных ниже источников. Документ описывает реализованное состояние, а не целевую архитектуру.

Основные источники проверки: `backend/main.py`, `backend/config.py`, `backend/models.py`, `backend/routers/`, `backend/rate_limit.py`, `frontend/js/`, `agent/agent/`, профильные тесты и `.github/workflows/quality.yml`. При расхождении с кодом приоритет имеет исполняемая реализация.

## Назначение

DMB Platform состоит из двух FastAPI-приложений:

1. `dmb-backlog` — SPA и backend для управления портфелем задач, отчётами, оценкой, уведомлениями и справочниками.
2. `agent` — AI Business Analyst Assistant для диалогового сбора и структурирования требований.

Основной backend проксирует запросы к агенту и хранит связанные requirement requests в своей БД. Agent защищает API общим заголовком `X-Agent-Secret`.

## Контекст и компоненты

```text
Browser SPA
  └─ /api/v1/* → DMB Backlog FastAPI :8000
       ├─ SQLAlchemy → DATABASE_URL (SQLite по умолчанию)
       ├─ filesystem → backend/uploads
       ├─ опциональный hourly notification scheduler
       └─ HTTP + X-Agent-Secret → Agent FastAPI :9000
                                   ├─ локальный SQLite session store
                                   ├─ local Markdown/JSON knowledge base
                                   ├─ mock или OpenAI-compatible LLM
                                   └─ реестры HTTP/MCP-интеграций; активность зависит от конфигурации
```

## Технологии

| Слой | Реализация |
|---|---|
| Web API | FastAPI 0.109, Pydantic 2.5 |
| Persistence | SQLAlchemy 2.0; SQLite по умолчанию |
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

- `agent/run.py` — локальный запуск.
- `agent/agent/main.py` — FastAPI assembly.
- `agent/agent/api/router.py` — internal API.
- `agent/agent/agentic_orchestrator.py` — основной model-driven dialogue runtime.
- `agent/agent/orchestrator.py` — legacy runtime и общие детерминированные операции workflow.
- `agent/agent/dialogue/agentic.py` — structured model decision и применение фактов.
- `agent/agent/dialogue/` — agentic-компоненты и модули legacy rollback.
- `agent/agent/kb/` — загрузка и поиск по базе знаний.
- `agent/agent/llm/` — provider abstraction.

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

`LLM_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`, `AGENT_DIALOGUE_ENGINE`, `SESSION_DB`, `AGENT_PORT`, `DEBUG`, `AGENT_SECRET`, `MCP_SERVERS_JSON`, `TOOLS_CONFIG_JSON`.

Production должен запускаться только с явно заданными уникальными secret’ами и `DEBUG=false`.

## Локальный запуск без изменения production-данных

Создайте отдельную dev БД и не указывайте путь к рабочей SQLite:

```powershell
cd D:\Проект\dmb-backlog\backend
$env:DATABASE_URL = 'sqlite:///./dmb_backlog.dev.db'
$env:SECRET_KEY = '<случайное-dev-значение>'
$env:AGENT_SECRET = '<одинаковое-значение-для-двух-сервисов>'
$env:RUN_STARTUP_SEED = 'false'
$env:RUN_STARTUP_MAINTENANCE = 'false'
$env:RUN_NOTIFICATION_SCHEDULER = 'false'
uvicorn main:app --reload --port 8000
```

Agent:

```powershell
cd D:\Проект\agent
$env:AGENT_SECRET = '<одинаковое-значение-для-двух-сервисов>'
$env:LLM_PROVIDER = 'mock'
python run.py
```

Отдельный production worker плановых уведомлений (запускать в одном экземпляре при `DEBUG=false` и безопасной конфигурации):

```powershell
cd D:\Проект\dmb-backlog\backend
python run_notification_scheduler.py
```

Внимание: создание таблиц и добавление отсутствующих колонок выполняются всегда. Seed, maintenance и встроенный scheduler отключаются указанными выше флагами.

## Проверки

```powershell
# Agent
python -m pytest D:\Проект\agent\agent\tests -q --basetemp D:\Проект\.test-tmp-agent -p no:cacheprovider

# Backend — запускать только против отдельной тестовой БД
cd D:\Проект\dmb-backlog\backend
pytest tests -v
```

Фактический GitHub Actions workflow `.github/workflows/quality.yml` выполняет Python compile, backend pytest, проверку синтаксиса JavaScript, frontend unit tests и `pip-audit`. Ruff, ESLint, browser smoke и secret scan в этом workflow не подтверждены.

## Эксплуатационные ограничения As-Is

- SQLite-файлы backlog и agent session store ограничивают безопасное горизонтальное масштабирование и требуют отдельной оценки многопроцессного режима.
- Встроенный scheduler запускается в каждом worker, если `RUN_NOTIFICATION_SCHEDULER=true`; для production предусмотрен отдельный worker.
- Rate limit использует Redis при заданном `REDIS_URL`, иначе process-local memory fallback.
- Upload storage локален конкретному host.
- Agent sessions сохраняются в локальном SQLite-файле `SESSION_DB`.
- Health endpoint проверяет только процесс, а не DB/agent/storage.
- Есть GitHub Actions quality workflow; Docker/Kubernetes manifests в проверенном дереве не найдены.
- Observability ограничена файловым логом и stdout.

## Связанные документы

- `archive/reviews/CODE_REVIEW_2026-08-19.md` — исторический аудит рисков и исправлений на 19.08.2026.
- `ARCHITECTURE.md` — расширенное архитектурное описание; утверждения сверять с реализацией.
- `API_SPEC.md` — ручная спецификация API.
- `DATA_MODEL.md` и `db-schema.dbml` — модель данных.
- `SECURITY.md` — заявленные security practices.
- `DEPLOYMENT.md` — локальные и целевые сценарии развёртывания.
- `TESTING.md` — стратегия тестирования.
- `agent/docs/` — отдельная документация AI-агента.
