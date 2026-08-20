# DMB Platform: документация фактического состояния

Дата актуализации: 19 августа 2026 года. Этот документ описывает **реализованное As-Is**, а не целевую архитектуру.

## Назначение

DMB Platform состоит из двух FastAPI-приложений:

1. `dmb-backlog` — SPA и backend для управления портфелем задач, отчётами, оценкой, уведомлениями и справочниками.
2. `agent` — AI Business Analyst Assistant для диалогового сбора и структурирования требований.

Основной backend проксирует запросы к агенту и хранит связанные requirement requests в своей БД. Agent защищает API общим заголовком `X-Agent-Secret`.

## Контекст и компоненты

```text
Browser SPA
  └─ /api/v1/* → DMB Backlog FastAPI :8000
       ├─ SQLAlchemy → SQLite (dev) / заявленный PostgreSQL
       ├─ filesystem → backend/uploads
       ├─ hourly in-process notification scheduler
       └─ HTTP + X-Agent-Secret → Agent FastAPI :9000
                                   ├─ in-process session store
                                   ├─ local Markdown/JSON knowledge base
                                   ├─ mock или OpenAI-compatible LLM
                                   └─ optional HTTP/MCP integrations
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
- `agent/agent/orchestrator.py` — основной dialogue workflow.
- `agent/agent/dialogue/` — state machine и обработчики.
- `agent/agent/kb/` — загрузка и поиск по базе знаний.
- `agent/agent/llm/` — provider abstraction.

## Фактический runtime backlog

При старте backend:

1. Создаются отсутствующие таблицы.
2. Недостающие колонки добавляются через динамический `ALTER TABLE`.
3. Выполняются seed справочников, пользователей, ресурсов и field labels.
4. Выполняется data migration team FK.
5. Пересчитываются вычисляемые трудозатраты.
6. Синхронизируются стандартные отчёты.
7. Стартует hourly scheduler уведомлений.
8. Монтируются frontend и публичный каталог uploads.

Это важно учитывать: обычный restart не является read-only операцией.

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

Источником подробной схемы запросов остаётся автоматически создаваемый `/docs`, но перед публикацией необходимо устранить дубли маршрутов.

## Основные frontend routes

`#/dashboard`, `#/backlog`, `#/team-backlog`, `#/express-estimate`, `#/kanban`, `#/reports`, `#/analytics/tribe`, `#/analytics/po-pl`, `#/analytics/it`, `#/notifications`, `#/settings`, `#/admin`, `#/audit-log`, `#/customer`, `#/customer/create`, `#/review`.

Доступность пунктов меню вычисляется на клиенте, но безопасность обязана обеспечиваться backend-проверками; скрытие route в SPA не является авторизацией.

## Данные и владение

Ключевые сущности: User, Role, Team, Task, TaskHistory, TaskComment, TaskAttachment, TaskViewer, справочники статуса/приоритета/дедлайна/проекта, Notification, Report, TimelineEvent, Epic, Story и RequirementRequest.

Файлы хранятся отдельно от БД в `backend/uploads/{task_id}`; БД содержит metadata. Нужны согласованный backup и orphan cleanup.

## Аутентификация

1. Login выдаёт access и refresh JWT.
2. SPA хранит оба токена в `localStorage`.
3. API client добавляет access как Bearer.
4. При 401 выполняется refresh и повтор исходного запроса.
5. Logout удаляет локальные токены; серверной revocation нет.

Роли содержат строковые уровни доступа. Применение этих уровней пока не единообразно; актуальные риски описаны в `CODE_REVIEW_2026-08-19.md`.

## Конфигурация

### Backlog

`APP_NAME`, `DEBUG`, `DATABASE_URL`, `SECRET_KEY`, `ALGORITHM`, сроки JWT, `CORS_ORIGINS`, `AGENT_BASE_URL`, `AGENT_SECRET`.

### Agent

`LLM_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `AGENT_PORT`, `DEBUG`, `AGENT_SECRET`, `MCP_SERVERS_JSON`, `TOOLS_CONFIG_JSON`.

Production должен запускаться только с явно заданными уникальными secret’ами и `DEBUG=false`.

## Локальный запуск без изменения production-данных

Создайте отдельную dev БД и не указывайте путь к рабочей SQLite:

```powershell
cd D:\Проект\dmb-backlog\backend
$env:DATABASE_URL = 'sqlite:///./dmb_backlog.dev.db'
$env:SECRET_KEY = '<случайное-dev-значение>'
$env:AGENT_SECRET = '<одинаковое-значение-для-двух-сервисов>'
uvicorn main:app --reload --port 8000
```

Agent:

```powershell
cd D:\Проект\agent
$env:AGENT_SECRET = '<одинаковое-значение-для-двух-сервисов>'
$env:LLM_PROVIDER = 'mock'
python run.py
```

Production worker плановых уведомлений (запускать в одном экземпляре):

```powershell
cd D:\Проект\dmb-backlog\backend
python run_notification_scheduler.py
```

Внимание: даже с отдельной dev БД backlog startup выполняет schema/seed/recalculation.

## Проверки

```powershell
# Agent
python -m pytest D:\Проект\agent\agent\tests -q --basetemp D:\Проект\.test-tmp-agent -p no:cacheprovider

# Backend — запускать только против отдельной тестовой БД
cd D:\Проект\dmb-backlog\backend
pytest tests -v
```

Минимальный будущий pipeline: Python compile + Ruff + pytest, JavaScript syntax/ESLint, browser smoke, authorization matrix, проверка совместимости моделей с чистой и существующей схемой, dependency audit и secret scan.

## Эксплуатационные ограничения As-Is

- SQLite и process-local state не подходят для нескольких workers.
- Scheduler запускается в каждом worker.
- Rate limit хранится в памяти процесса.
- Upload storage локален конкретному host.
- Agent sessions process-local.
- Health endpoint проверяет только процесс, а не DB/agent/storage.
- Нет готовых Docker/Kubernetes/CI manifests в актуальном дереве.
- Observability ограничена файловым логом и stdout.

## Связанные документы

- `CODE_REVIEW_2026-08-19.md` — риски и план исправлений.
- `ARCHITECTURE.md` — расширенное архитектурное описание, частично target-state.
- `API_SPEC.md` — ручная спецификация API.
- `DATA_MODEL.md` и `db-schema.dbml` — модель данных.
- `SECURITY.md` — заявленные security practices.
- `DEPLOYMENT.md` — целевые сценарии развёртывания.
- `TESTING.md` — стратегия тестирования.
- `agent/docs/` — отдельная документация AI-агента.
