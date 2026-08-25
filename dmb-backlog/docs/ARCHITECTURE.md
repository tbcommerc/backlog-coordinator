---
title: Архитектура DMB Backlog
scope: as-is
status: verified
last_verified: 2026-08-24
evidence:
  - backend/main.py
  - backend/config.py
  - backend/database.py
  - backend/models.py
  - backend/routers/
  - backend/rate_limit.py
  - frontend/js/
  - .github/workflows/quality.yml
---

# Архитектура DMB Backlog

Документ описывает только подтверждённую реализацию. Модель данных, поля API и пользовательские сценарии вынесены в профильные документы и должны сверяться с кодом отдельно.

## Контекст

DMB Backlog — браузерная SPA и FastAPI backend для работы с задачами и связанными данными. Backend также проксирует запросы к отдельному сервису AI Business Analyst Agent и сохраняет `RequirementRequest` в своей БД.

```text
Browser SPA
    ↓ HTTP/JSON, /api/v1/*
FastAPI backend :8000
    ├── routers + auth dependencies
    ├── logging/audit middleware
    ├── SQLAlchemy ORM → DATABASE_URL
    ├── filesystem → backend/uploads
    ├── optional notification scheduler
    └── HTTP + X-Agent-Secret → AI Agent :9000
```

Подтверждённая внешняя граница — HTTP-взаимодействие с AI Agent. Ссылки Jira хранятся как данные; полноценная Jira-интеграция в проверенной реализации не подтверждена.

## Runtime-контейнеры

### Browser SPA

- `frontend/index.html` — HTML-оболочка.
- `frontend/js/app.js` — инициализация приложения.
- `frontend/js/router.js` — hash routing.
- `frontend/js/api.js` — HTTP-клиент и обновление access-токена.
- `frontend/js/auth.js` — login/logout и профиль пользователя.
- `frontend/js/store.js` — клиентское состояние.
- `frontend/js/components/` — страницы и UI-компоненты.
- `frontend/css/` — токены, базовые стили и стили компонентов/страниц.

Frontend обслуживается самим FastAPI через `/static`; корневой маршрут возвращает `frontend/index.html`.

### FastAPI backend

- `backend/main.py` — lifecycle, middleware, роутеры, health endpoint и frontend static files.
- `backend/config.py` — настройки из `dmb-backlog/.env` и переменных окружения.
- `backend/database.py` — SQLAlchemy engine/session и аддитивное выравнивание схемы.
- `backend/models.py` — источник ORM-схемы.
- `backend/schemas.py` — транспортные Pydantic-схемы.
- `backend/routers/` — API и значительная часть бизнес-логики.
- `backend/import_service.py` — импорт задач.
- `backend/services/task_analytics.py` — выделенная аналитическая логика.

### AI Business Analyst Agent

Backlog вызывает Agent по `AGENT_BASE_URL` и передаёт `X-Agent-Secret`. Agent является отдельным приложением и процессом; его архитектура описана в `../../agent/docs/ARCHITECTURE.md`.

## API-границы

В `backend/main.py` зарегистрированы группы:

- `/api/v1/auth`;
- `/api/v1/tasks`;
- `/api/v1/teams`;
- `/api/v1/users`;
- `/api/v1/reports`;
- `/api/v1/admin`;
- `/api/v1/customer`;
- `/api/v1/quick-estimate`;
- `/api/v1/notifications`;
- `/api/v1/timeline`;
- `/api/v1/agent`.

Фактический контракт генерируется FastAPI в `/docs`. Ручной `API_SPEC.md` является вспомогательным документом и должен сверяться с OpenAPI и роутерами. Уникальность method/path пар admin-router проверяется тестом `backend/tests/test_route_uniqueness.py`.

## Данные

`backend/models.py` — единственный поддерживаемый источник схемы. По умолчанию `DATABASE_URL` указывает на локальную SQLite в `backend/dmb_backlog.db`.

`database.ensure_schema()`:

1. создаёт отсутствующие таблицы через SQLAlchemy metadata;
2. сравнивает колонки существующих таблиц с моделями;
3. добавляет отсутствующие колонки;
4. не выполняет переименование, удаление или преобразование колонок.

Подробности и ограничения находятся в `SCHEMA_CHANGES.md`. PostgreSQL указан в старых целевых документах, но готовый production-контур и PostgreSQL driver в проверенных runtime-зависимостях не подтверждены.

Вложения сохраняются в `backend/uploads/{task_id}`. Метаданные хранятся в `TaskAttachment`; загрузка и скачивание выполняются через авторизованные task endpoints. Каталог uploads не опубликован как static.

## Аутентификация и авторизация

- Пароли проверяются через bcrypt/passlib.
- Access JWT использует HS256 и передаётся как Bearer.
- Access-токен хранится в памяти SPA.
- Refresh-токен хранится в `HttpOnly`, `SameSite=Strict` cookie с path `/api/v1/auth`.
- Refresh-сессии сохраняются в таблице `refresh_sessions`, ротируются при refresh и отзываются при logout.
- Backend применяет auth dependencies и task-level authorization; скрытие маршрутов в SPA не является границей безопасности.
- Login и refresh используют Redis rate limiter при заданном `REDIS_URL`, иначе process-local memory fallback.

При `DEBUG=false` startup validation требует нестандартные `SECRET_KEY`, `AGENT_SECRET` и настроенный `REDIS_URL`. Refresh cookie в этом режиме получает флаг `Secure`.

## Startup lifecycle

При каждом старте:

1. проверяется runtime-конфигурация;
2. выполняется `init_db()` и аддитивное выравнивание схемы;
3. проверяется доступность/структура БД;
4. подключаются роутеры и frontend.

Дополнительные операции управляются флагами:

| Флаг | Операция | Значение при отсутствии флага |
|---|---|---|
| `RUN_STARTUP_SEED` | seed и team FK migration | наследует `DEBUG` |
| `RUN_STARTUP_MAINTENANCE` | пересчёт трудозатрат и синхронизация стандартных отчётов | наследует `DEBUG` |
| `RUN_NOTIFICATION_SCHEDULER` | встроенный hourly scheduler | наследует `DEBUG` |

В dev-режиме эти операции по умолчанию включены. Для production предусмотрен отдельный `run_notification_scheduler.py`; встроенный scheduler не следует одновременно запускать в нескольких workers.

## Наблюдаемость и поставка

- `LoggingMiddleware` пишет сведения о запросах в журнал и stdout.
- `AuditMiddleware` обслуживает аудит изменяющих запросов.
- `/api/v1/health` возвращает статус процесса и версию, но не проверяет БД, Agent или файловое хранилище.
- `.github/workflows/quality.yml` выполняет compile backend, pytest, JavaScript syntax checks, frontend unit tests и `pip-audit`.
- Dockerfile, docker-compose и Kubernetes manifests в проверенном дереве не найдены.
- Prometheus, distributed tracing и настроенные alert rules не подтверждены.

## Подтверждённые ограничения

- SQLite backlog и SQLite session store агента требуют отдельной оценки перед многопроцессным/многоузловым запуском.
- Файлы uploads локальны конкретному host.
- Memory rate limiter не разделяет состояние между процессами; для production конфигурация требует Redis.
- Встроенный scheduler может дублировать работу при нескольких workers.
- Значительная часть бизнес-логики находится непосредственно в роутерах.
- Автомиграция поддерживает только аддитивные изменения схемы.

## Связанные документы

- `PROJECT_OVERVIEW_AS_IS.md` — краткая карта фактической системы.
- `API_SPEC.md` — ручная спецификация API.
- `DATA_MODEL.md` — подробное описание данных.
- `PAGE_LOGIC.md` — поведение интерфейса.
- `SECURITY.md` — отдельная проверяемая модель безопасности.
- `DEPLOYMENT.md` — локальные и целевые сценарии поставки.
- `archive/legacy/ARCHITECTURE_MIXED_2026-06-29.md` — исторический документ со смешанными AS-IS и TO-BE утверждениями; не использовать как источник текущего состояния.
