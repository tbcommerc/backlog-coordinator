---
title: API DMB Backlog
scope: as-is
status: verified-index
last_verified: 2026-09-01
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

На 01.09.2026 FastAPI registry содержит 207 method/path регистраций под `/api/`. Распределение:

| Группа | Регистраций | Основной файл |
|---|---:|---|
| `/api/v1/auth` | 4 | `routers/auth_router.py` |
| `/api/v1/tasks` | 39 | `tasks_router.py`, `task_collaboration_router.py`, `task_analytics_router.py`, `task_reporting_router.py`, `prioritiser_router.py` |
| `/api/v1/teams` | 8 | `teams_router.py` |
| `/api/v1/users` | 5 | `users_router.py` |
| `/api/v1/reports` | 8 | `reports_router.py` |
| `/api/v1/reporting-meetings` | 6 | `reporting_meetings_router.py` |
| `/api/v1/admin` | 85 | `admin_router.py` |
| `/api/v1/customer` | 1 | `customer_router.py` |
| `/api/v1/quick-estimate` | 13 | `express_router.py` |
| `/api/v1/notifications` | 10 | `notifications_router.py` |
| `/api/v1/timeline` | 7 | `timeline_router.py` |
| `/api/v1/agent` | 18 | `agent_router.py` |
| `/api/v1/health` | 2 | `main.py` |
| `/api/v1/events` | 1 | `events_router.py` |

Количество является снимком registry, а не стабильным API-обязательством. Перед использованием конкретного endpoint сверяй OpenAPI текущего запуска.

## Группы API

### Reporting meetings

- `GET /reporting-meetings` — календарь, состояния и полнота заполнения; поддерживает фильтры `kind`, `state`, `date_from`, `date_to` и признак доступности подготовки;
- `GET /reporting-meetings/{id}/history` — полная история действий с датами, причиной и автором;
- `GET /reporting-meetings/{id}/preparation` — read-only срез статусов и журнал их версий для проектного офиса; требуется `admin=full`;
- `POST /reporting-meetings/{id}/schedule` — назначить дату или перенести встречу;
- `POST /reporting-meetings/{id}/complete` — подтвердить факт проведения; при незаполненных задачах требуется явный `force=true`;
- `POST /reporting-meetings/{id}/cancel` — отменить с обязательной причиной;
- `GET /tasks/{id}/reporting-statuses/context` — ближайшая и предыдущая встречи со статусами задачи;
- `PUT /tasks/{id}/reporting-statuses/{meeting_id}` — сохранить статус и версию отдельно от карточки задачи; изменять статус могут только назначенные PO/PL/CL ответственной команды.

Управляющие команды требуют полного admin-доступа. Заполнение разрешено участнику ответственной команды; проектный офис статус не заполняет, даже если администратор одновременно привязан к команде.

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

Расчёты из карточки задачи:

- `POST /tasks/{id}/prioritiser/value` — рассчитать финансовый эффект;
- `POST /tasks/{id}/prioritiser/priority` — рассчитать приоритет и, когда ручной
  эффект отсутствует, сохранить также рассчитанный AI-эффект.

Оба endpoint принимают `{ "version": <текущая версия задачи> }`, используют те
же права, блокировки и optimistic locking, что и обычное редактирование, и
возвращают обновлённую задачу. Финансовый результат записывается в
`financial_effect_ai` и `financial_effect_ai_justification`, приоритет — в
`priority_score` (шкала 0–100) и `priority_justification`. Недостаточные входные
данные возвращаются как `422`, недоступность внешнего сервиса — как `502`.
Создание комментария принимает необязательный `client_request_id`. Upload
вложения принимает его как multipart form field, удаление вложения — как query
parameter. Повтор с тем же ключом и payload возвращает исходный результат без
создания дубля; повтор ключа с иными данными возвращает `409`.

### Teams и users

Обычные `/teams` и `/users` endpoints существуют отдельно от admin endpoints. Team resources доступны через `/teams/{team_id}/resources`. Наличие endpoint не означает разрешение его вызова любой роли.

### Reports

Поддерживаются registry/CRUD отчётов, выполнение сохранённого отчёта и специализированные directorate/DID operational reports.
`POST` принимает необязательный `client_request_id`; `PUT` требует `version` и
также поддерживает idempotency key; `DELETE` требует query `version` и принимает
query `client_request_id`. Конфликт конкурентного изменения возвращает `409` с
кодом `report_version_conflict`.

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

Элементы `GET /admin/audit-log` содержат `request_id`; поиск журнала также
проверяет это поле. Значение совпадает с ответным `X-Request-ID` и идентификатором
в backend-логах.

Справочники, пользователи, роли и ответственные команд являются защищёнными данными. Их endpoints нельзя использовать для автоматической проверки документации или тестовых мутаций.

### Customer portal

`GET /customer/tasks` возвращает задачи в области текущего бизнес-заказчика. Создание и диалоговый сбор требований выполняются через Agent API, а не отдельный customer POST endpoint.

Ответы с задачами содержат внутренний числовой `id` для совместимости маршрутов и связей, а также пользовательский `public_id` по маске `TASK-000-001`. В интерфейсе и экспортах следует показывать `public_id`; `id` остаётся техническим ключом.

### Quick estimate

Группа `/quick-estimate` обслуживает epics, stories, task efforts, сортировку, завершение оценки и импорт backlog task в оценку.

### Notifications

Поддерживаются list, unread count, summary, read/read-all, delete, resolve и пользовательские preferences.

`GET /events/stream` — авторизованный `text/event-stream`. Клиент передаёт cursor
через query `after` либо `Last-Event-ID`. События `task.*`, `requirement.*` и
`report.*` являются сигналом
инвалидации и содержат только ID, версию и названия изменённых полей; актуальные
данные клиент получает штатным GET. Персональные `notification.*` доступны
только получателю.

### Timeline

Есть чтение timeline и year view, а также admin CRUD событий.

### Agent proxy

Backlog proxy поддерживает chat, сессии, reset, send-for-review, редактирование draft section и persisted requirement requests. Внешний контракт Agent описан отдельно в `../../agent/docs/API.md`.
Каждое chat-сообщение передаёт стабильный `message_id`: повтор одного HTTP-запроса возвращает сохранённый ответ и не изменяет историю второй раз.

### Health

`GET /api/v1/health` возвращает liveness и версию приложения.
`GET /api/v1/health/ready` возвращает `200` при доступных DB, Redis и общем
хранилище вложений; иначе `503`. Ответ также содержит `outbox_pending`,
`outbox_oldest_seconds` и `outbox_dead_lettered`.

`GET /metrics` отдаёт Prometheus text exposition. На стенде endpoint должен
скрейпиться напрямую с каждого backend instance и быть закрыт сетевой политикой.

### Операционный outbox

`GET /admin/outbox/dead-letters` доступен только с permission `admin=full` и
возвращает пагинированные dead-letter события. Поиск проверяет тип события,
aggregate и текст последней ошибки.

`POST /admin/outbox/dead-letters/{event_id}/requeue` требует
`expected_attempts` и `client_request_id`. Несовпадение attempts возвращает
`409`; успешная операция сбрасывает claim/error/attempts и пишет audit в той же
транзакции. Массовый replay отсутствует.

Ответы backend содержат `X-Request-ID`; при включённом OpenTelemetry также
`X-Trace-ID`. Полный audit admin API возвращает оба идентификатора и позволяет
поиск по ним.

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

Изменяющие операции над задачей передают текущий `version`, включая quick estimate,
PIP, ссылки, удаление и bulk-операции. Устаревшая версия возвращает `409` с кодом
конфликта и актуальной версией. Отсутствующая обязательная версия возвращает
`422` для body-схем или `428` для query/bulk-контрактов.

Переход статуса requirement request также требует `version`. Допустимые переходы
проверяются как конечный автомат; решение может принять закреплённый ревьюер.
Версия заявки и создаваемая при передаче в проработку задача фиксируются одной
транзакцией.

Edit lock задачи является атомарной lease-блокировкой с heartbeat. Она улучшает
UX, но источником целостности остаётся optimistic lock по `version`.

`client_request_id` в create/update задачи является идемпотентным ключом на всех
backend workers. Повтор того же ключа и payload не повторяет изменение. Повтор
ключа с иным payload возвращает `409` с кодом `idempotency_key_reused`.

## Изменение API

При изменении endpoint:

1. изменить router и Pydantic schema;
2. обновить/добавить профильный тест;
3. проверить `/openapi.json`;
4. обновить этот индекс только при изменении группы или сквозного контракта;
5. обновить профильный документ (`IMPORT_SPEC.md`, `error-codes.md` и т. п.), если его поведение затронуто.

Историческая ручная спецификация сохранена в `archive/legacy/API_SPEC_STALE_MANUAL.md`; она не является источником текущего контракта.
