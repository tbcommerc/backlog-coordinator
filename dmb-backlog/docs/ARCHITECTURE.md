---
title: Архитектура Backlog coordinator
scope: as-is
status: verified
last_verified: 2026-09-02
evidence:
  - backend/main.py
  - backend/config.py
  - backend/database.py
  - backend/models.py
  - backend/routers/
  - backend/rate_limit.py
  - backend/event_outbox.py
  - backend/idempotency.py
  - backend/telemetry.py
  - backend/metrics.py
  - frontend/js/
  - .github/workflows/quality.yml
---

# Архитектура Backlog coordinator

Документ описывает только подтверждённую реализацию. Модель данных, поля API и пользовательские сценарии вынесены в профильные документы и должны сверяться с кодом отдельно.

## Контекст

Backlog coordinator — браузерная SPA и FastAPI backend для работы с задачами и связанными данными. Backend проксирует запросы к AI Business Analyst Agent, сохраняет `RequirementRequest` и вызывает отдельный агент расчёта финансового эффекта и приоритета.

```text
Browser SPA
    ↓ HTTP/JSON, /api/v1/*
FastAPI backend :8000
    ├── routers + auth dependencies
    ├── logging/audit middleware
    ├── SQLAlchemy ORM → DATABASE_URL
    ├── shared filesystem → ATTACHMENT_STORAGE_DIR
    ├── optional notification scheduler
    ├── transactional outbox → Redis Stream → authorized SSE
    ├── Prometheus metrics + OpenTelemetry traces
    ├── HTTP + X-Agent-Secret → AI Agent :9000
    └── HTTP/JSON → Task Prioritiser :9100
```

Подтверждённые внешние границы — HTTP-взаимодействие с AI Agent и Task Prioritiser. Ссылки Jira хранятся как данные; полноценная Jira-интеграция в проверенной реализации не подтверждена.

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

### Task Prioritiser

Backlog вызывает сервис по `PRIORITISER_BASE_URL`. Кнопка финансового эффекта
использует `/agent/value/full`, кнопка приоритета — `/agent/priority/full`.
Backend преобразует карточку задачи во внешний контракт и строго проверяет
ответ prioritiser. Некорректный или неполный ответ не заменяется локальными
значениями и возвращается как ошибка интеграции. Value сначала показывается как
предложение и попадает в основные поля только после явного принятия пользователем.
Приоритет сохраняется в `priority_score` (0–100) и `priority_justification` только
через endpoint prioritiser. Legacy-поля `financial_effect_ai*` не участвуют в
отображении и не служат fallback для пустого финансового эффекта.
OpenAI-compatible провайдер, endpoint, модель и учётные данные совпадают с
настройками AI Business Analyst Agent; локальный launcher синхронизирует их из
`agent/.env`, а production Compose передаёт обоим сервисам одинаковые `DMB_*`
переменные.

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

`backend/models.py` описывает целевую схему, а Alembic хранит её версионируемую
историю. Штатный `DATABASE_URL` указывает на локальную PostgreSQL из `compose.yaml`.

Перед запуском backend единый стартовый сценарий применяет `alembic upgrade head`.
`database.ensure_schema()` оставлен только для изолированной SQLite-совместимости.

Подробности и ограничения находятся в `SCHEMA_CHANGES.md`. PostgreSQL driver
зафиксирован в runtime-зависимостях. При `DEBUG=false` backend отклоняет SQLite;
размер пула задаётся через `DB_POOL_SIZE`, `DB_MAX_OVERFLOW` и
`DB_POOL_TIMEOUT_SECONDS`.

Вложения сохраняются в `${ATTACHMENT_STORAGE_DIR}/{task_id}`. В production этот
путь обязан быть общим persistent volume для всех экземпляров backend; локальный
`backend/uploads` отклоняется startup-валидацией. Метаданные хранятся в
`TaskAttachment`; загрузка и скачивание выполняются через авторизованные task
endpoints. Каталог не опубликован как static.

## Аутентификация и авторизация

- Пароли проверяются через bcrypt/passlib.
- Access JWT использует HS256 и передаётся как Bearer.
- Access-токен хранится в памяти SPA.
- Refresh-токен хранится в `HttpOnly`, `SameSite=Strict` cookie с path `/api/v1/auth`.
- Refresh-сессии сохраняются в таблице `refresh_sessions`, ротируются при refresh и отзываются при logout.
- Backend применяет auth dependencies и task-level authorization; скрытие маршрутов в SPA не является границей безопасности.
- Login и refresh используют Redis rate limiter при заданном `REDIS_URL`, иначе process-local memory fallback.

При `DEBUG=false` startup validation требует нестандартные `SECRET_KEY`,
`AGENT_SECRET`, настроенный `REDIS_URL`, PostgreSQL и общий каталог вложений.
Refresh cookie в этом режиме получает флаг `Secure`.

## Startup lifecycle

При каждом старте:

1. проверяется runtime-конфигурация;
2. выполняется `init_db()` и аддитивное выравнивание схемы;
3. проверяется доступность/структура БД;
4. подключаются роутеры и frontend.

Дополнительные операции управляются флагами:

| Флаг | Операция | Значение при отсутствии флага |
|---|---|---|
| `RUN_STARTUP_SEED` | seed и team FK migration | `false` |
| `RUN_STARTUP_MAINTENANCE` | пересчёт трудозатрат и синхронизация стандартных отчётов | `false` |
| `RUN_NOTIFICATION_SCHEDULER` | встроенный hourly scheduler | наследует `DEBUG` |

Seed и startup maintenance включаются только явно. При `DEBUG=false` они
дополнительно запрещены runtime-валидацией. Для production
предусмотрен отдельный `run_notification_scheduler.py`; PostgreSQL advisory lock
оставляет активным ровно один scheduler и позволяет standby подхватить работу.

## Транзакционные события и live-обновления

Mapper-события `Task`, `TaskComment`, `TaskAttachment`, `Notification`, `Report`
и `RequirementRequest` записывают
минимальные события в `event_outbox` тем же DB connection и в той же транзакции,
что и доменное изменение. Внешний publish до commit отсутствует.

Outbox dispatcher безопасно работает в нескольких backend workers: claim
выполняется через `FOR UPDATE SKIP LOCKED`, зависшие claims возвращаются в очередь,
ошибки получают retry/backoff. Некорректное событие после ограниченного числа
попыток переходит в dead letter. События публикуются в ограниченный Redis Stream,
обработанные DB-строки удаляются после `OUTBOX_RETENTION_DAYS`.

Повторяемые task create/update, comment/attachment commands и report CRUD используют таблицу `idempotency_records`, а не
process-local cache. Уникальная DB-запись резервируется в той же транзакции;
одинаковый ключ с другим payload отклоняется как конфликт.

Авторизованный `/api/v1/events/stream` использует SSE и cursor replay. Долгая
SSE-сессия не удерживает connection из SQLAlchemy pool. Персональные события
сопоставляются с пользователем; task, requirement и report events проходят
соответствующую серверную проверку области доступа. Polling уведомлений раз в
60 секунд остаётся fallback.

## Наблюдаемость и поставка

- `LoggingMiddleware` пишет сведения о запросах в журнал и stdout.
- `AuditMiddleware` передаёт request/actor context SQLAlchemy hook; audit row
  коммитится и откатывается вместе с бизнес-изменением.
- `/api/v1/health` является liveness; `/api/v1/health/ready` проверяет БД, Redis,
  общий каталог вложений и возвращает размер/возраст pending outbox.
- `.github/workflows/quality.yml` выполняет compile backend, pytest, JavaScript syntax checks, frontend unit tests и `pip-audit`.
- Локальные PostgreSQL и Redis описаны в корневом `compose.yaml`; стендовая
  multi-replica топология Python-сервисов — в `compose.production.yaml`.
- `/metrics` отдаёт Prometheus-метрики HTTP, DB pool, outbox, SSE, scheduler и
  backend→agent. Базовые alert rules находятся в `infrastructure/observability/`.
- OpenTelemetry трассирует FastAPI, SQLAlchemy и backend→agent urllib-вызовы.
  OTLP Collector отправляет spans в Jaeger; `X-Trace-ID` и `audit_log.trace_id`
  связывают трассу, HTTP-запрос и транзакционный аудит.

## Подтверждённые ограничения

- Live PostgreSQL smoke зависит от наличия Docker Desktop в локальной среде.
- Файлы uploads локальны конкретному host.
- Memory rate limiter не разделяет состояние между процессами; для production конфигурация требует Redis.
- Реальный failover scheduler и SSE под несколькими процессами требуют стендовой
  проверки с PostgreSQL и Redis.
- Значительная часть бизнес-логики находится непосредственно в роутерах.
- Каждое изменение схемы требует новой проверенной Alembic-ревизии.

## Связанные документы

- `PROJECT_OVERVIEW_AS_IS.md` — краткая карта фактической системы.
- `API_SPEC.md` — ручная спецификация API.
- `DATA_MODEL.md` — подробное описание данных.
- `PAGE_LOGIC.md` — поведение интерфейса.
- `SECURITY.md` — отдельная проверяемая модель безопасности.
- `DEPLOYMENT.md` — локальные и целевые сценарии поставки.
- `archive/legacy/ARCHITECTURE_MIXED_2026-06-29.md` — исторический документ со смешанными AS-IS и TO-BE утверждениями; не использовать как источник текущего состояния.
