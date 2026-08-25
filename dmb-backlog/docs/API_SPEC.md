---
title: API DMB Backlog
scope: as-is
status: verified-index
last_verified: 2026-08-24
source_of_truth:
  - FastAPI app.routes
  - /openapi.json
evidence:
  - backend/main.py
  - backend/routers/
  - backend/schemas.py
  - backend/tests/test_route_uniqueness.py
---

# API DMB Backlog

Машиночитаемый источник фактического контракта — OpenAPI, который создаёт запущенное приложение:

- Swagger UI: `/docs`;
- OpenAPI JSON: `/openapi.json`;
- базовый префикс прикладного API: `/api/v1`.

Этот файл служит навигатором и фиксирует сквозные правила. Он намеренно не копирует вручную все request/response поля: такое дублирование уже привело к расхождению старой спецификации с кодом.

## Проверенный реестр

На 24.08.2026 FastAPI registry содержит 189 method/path регистраций под `/api/`. Распределение:

| Группа | Регистраций | Основной файл |
|---|---:|---|
| `/api/v1/auth` | 4 | `routers/auth_router.py` |
| `/api/v1/tasks` | 33 | `tasks_router.py`, `task_collaboration_router.py`, `task_analytics_router.py` |
| `/api/v1/teams` | 8 | `teams_router.py` |
| `/api/v1/users` | 5 | `users_router.py` |
| `/api/v1/reports` | 8 | `reports_router.py` |
| `/api/v1/admin` | 83 | `admin_router.py` |
| `/api/v1/customer` | 1 | `customer_router.py` |
| `/api/v1/quick-estimate` | 13 | `express_router.py` |
| `/api/v1/notifications` | 9 | `notifications_router.py` |
| `/api/v1/timeline` | 7 | `timeline_router.py` |
| `/api/v1/agent` | 17 | `agent_router.py` |
| `/api/v1/health` | 1 | `main.py` |

Количество является снимком registry, а не стабильным API-обязательством. Перед использованием конкретного endpoint сверяй OpenAPI текущего запуска.

## Группы API

### Authentication

- `POST /auth/login`;
- `POST /auth/refresh`;
- `GET /auth/me`;
- `POST /auth/logout`.

Login возвращает access-токен и устанавливает refresh cookie. Refresh и logout используют cookie path `/api/v1/auth`; детали описаны в `SECURITY.md`.

### Tasks

Группа содержит:

- список, поиск, статистику, reference data и detail;
- создание, PUT/PATCH update и soft delete;
- PIP decision и обновление ссылок;
- history и documents;
- bulk preview/action;
- import;
- locks и viewers;
- comments и attachments;
- analytics и отчёты по задачам.

Объектная авторизация находится в `backend/auth.py`. Форматы задач — в `backend/schemas.py` и OpenAPI.

### Teams и users

Обычные `/teams` и `/users` endpoints существуют отдельно от admin endpoints. Team resources доступны через `/teams/{team_id}/resources`. Наличие endpoint не означает разрешение его вызова любой роли.

### Reports

Поддерживаются registry/CRUD отчётов, выполнение сохранённого отчёта и специализированные directorate/DID operational reports.

### Admin

Admin API включает:

- роли, команды и пользователей;
- справочники и workspace/batch операции;
- dictionary locks;
- competency costs;
- проекты и теги;
- notification templates;
- display settings и labels;
- audit log и deletion impact.

Справочники, пользователи, роли и ответственные команд являются защищёнными данными. Их endpoints нельзя использовать для автоматической проверки документации или тестовых мутаций.

### Customer portal

`GET /customer/tasks` возвращает задачи в области текущего бизнес-заказчика. Создание и диалоговый сбор требований выполняются через Agent API, а не отдельный customer POST endpoint.

### Quick estimate

Группа `/quick-estimate` обслуживает epics, stories, task efforts, сортировку, завершение оценки и импорт backlog task в оценку.

### Notifications

Поддерживаются list, unread count, summary, read/read-all, delete, resolve и пользовательские preferences.

### Timeline

Есть чтение timeline и year view, а также admin CRUD событий.

### Agent proxy

Backlog proxy поддерживает chat, сессии, reset, send-for-review, редактирование draft section и persisted requirement requests. Внешний контракт Agent описан отдельно в `../../agent/docs/API.md`.

### Health

`GET /api/v1/health` возвращает только `status` и версию приложения. Проверки DB, Agent, Redis и storage отсутствуют.

## Аутентификация

Большинство внутренних групп подключено с backend dependencies, исключающими customer-only пользователя. Отдельные роутеры добавляют более точные permission и object-level проверки.

Access JWT передаётся в `Authorization: Bearer`. Refresh cookie применяется только на auth endpoints. Полная модель — `SECURITY.md`.

## Ошибки

Фактические ответы формируются FastAPI, Pydantic и явными `HTTPException` в роутерах. Типовые статусы включают:

- `400` — некорректная операция или конфликт бизнес-условий;
- `401` — отсутствующая/недействительная аутентификация;
- `403` — недостаточно прав или недоверенный Origin;
- `404` — сущность не найдена;
- `409` — конфликт версии/блокировки или другое явно реализованное столкновение;
- `422` — ошибка валидации request schema;
- `429` — rate limit;
- `5xx` — необработанная ошибка или недоступная зависимость.

Единой пользовательской error envelope для всех endpoints не подтверждено. Для конкретной операции используй OpenAPI, код router и соответствующий тест.

## Конкурентное редактирование

Для задач и части admin-справочников реализованы version/lock механизмы. Семантика различается по endpoint; нельзя распространять поведение одного ресурса на все остальные без проверки кода.

## Изменение API

При изменении endpoint:

1. изменить router и Pydantic schema;
2. обновить/добавить профильный тест;
3. проверить `/openapi.json`;
4. обновить этот индекс только при изменении группы или сквозного контракта;
5. обновить профильный документ (`IMPORT_SPEC.md`, `error-codes.md` и т. п.), если его поведение затронуто.

Историческая ручная спецификация сохранена в `archive/legacy/API_SPEC_STALE_MANUAL.md`; она не является источником текущего контракта.
