---
title: API Backlog coordinator
scope: as-is
status: verified-index
last_verified: 2026-09-09
source_of_truth:
  - FastAPI app.routes
  - /openapi.json
evidence:
  - backend/main.py
  - backend/routers/
  - backend/schemas.py
  - backend/tests/test_route_uniqueness.py
---

# API Backlog coordinator

Машиночитаемый источник фактического контракта — OpenAPI, который создаёт запущенное приложение:

- Swagger UI: `/docs`;
- OpenAPI JSON: `/openapi.json`;
- базовый префикс прикладного API: `/api/v1`.

Этот файл служит навигатором и фиксирует сквозные правила. Он намеренно не копирует вручную все request/response поля: такое дублирование уже привело к расхождению старой спецификации с кодом.

Для `TaskResponse` поле `progress` всегда выдаётся целым числом от 0 до 100.
Унаследованные записи БД с `NULL` нормализуются в `0` на границе API, поэтому
одна такая запись не прерывает выдачу всего списка задач.

## Проверенный реестр

На 08.09.2026 OpenAPI содержит 222 method/path операции под `/api/` и 223
включая корневой endpoint `/`. Распределение прикладного API:

| Группа | Регистраций | Основной файл |
|---|---:|---|
| `/api/v1/auth` | 4 | `routers/auth_router.py` |
| `/api/v1/tasks` | 40 | `tasks_router.py`, `task_collaboration_router.py`, `task_analytics_router.py`, `task_reporting_router.py`, `prioritiser_router.py` |
| `/api/v1/teams` | 8 | `teams_router.py` |
| `/api/v1/users` | 5 | `users_router.py` |
| `/api/v1/reports` | 14 | `reports_router.py` |
| `/api/v1/reporting-meetings` | 7 | `reporting_meetings_router.py` |
| `/api/v1/admin` | 88 | `admin_router.py` |
| `/api/v1/customer` | 1 | `customer_router.py` |
| `/api/v1/quick-estimate` | 13 | `express_router.py` |
| `/api/v1/notifications` | 12 | `notifications_router.py` |
| `/api/v1/timeline` | 7 | `timeline_router.py` |
| `/api/v1/agent` | 19 | `agent_router.py` |
| `/api/v1/health` | 2 | `main.py` |
| `/api/v1/events` | 1 | `events_router.py` |

Количество является снимком registry, а не стабильным API-обязательством. Перед использованием конкретного endpoint сверяй OpenAPI текущего запуска.

## Группы API

### Reporting meetings

- `GET /reporting-meetings` — календарь, состояния и полнота заполнения; поддерживает фильтры `kind`, `state`, `date_from`, `date_to`, параметр `include_completeness=false` для облегчённой выдачи без расчёта полноты и признак доступности подготовки;
- `POST /reporting-meetings` — добавить новый будущий экземпляр встречи; требуется `admin=full`, дата директорской должна приходиться на понедельник, ДИД — на вторник;
- `GET /reporting-meetings/{id}/history` — полная история действий с датами, причиной и автором;
- `GET /reporting-meetings/{id}/preparation` — срез статусов к встрече: проектный офис с `admin=full` видит и может редактировать задачи всех команд, PO/PL/CL и BA/участник команды — только задачи своей команды; доступность изменения каждой записи передаётся признаком `can_edit`, а для директорской возвращается встречный маркер `directorate_attention`;
- `POST /reporting-meetings/{id}/schedule` — назначить дату или перенести встречу;
- `POST /reporting-meetings/{id}/complete` — подтвердить факт проведения назначенной встречи в её дату или позднее; неполные статусы не блокируют операцию и не требуют отдельного подтверждения;
- `POST /reporting-meetings/{id}/cancel` — отменить с обязательной причиной;
- `GET /tasks/{id}/reporting-statuses/context` — ближайшая и предыдущая встречи со статусами задачи;
- `PUT /tasks/{id}/reporting-statuses/{meeting_id}` — сохранить текст, признак `is_ready`, директорский маркер и версию отдельно от карточки задачи; готовность можно подтвердить только при непустом тексте, а его изменение снимает подтверждение; изменять статус могут назначенные PO/PL/CL, а также пользователи ролей `PO/PL/CL` и `BA/Участник команды` в границах своей ответственной команды;
- `PUT /tasks/{id}/reporting-statuses/{meeting_id}/directorate-attention` — изменить только маркер «Требует показа лидеру трайба» для готового непустого статуса ближайшей директорской встречи с optimistic locking. Маркер существует только в контексте отчётной встречи и не является полем задачи.

Управляющие команды требуют полного admin-доступа. Заполнение разрешено PO/PL/CL и BA/участнику своей ответственной команды; проектный офис статус не заполняет, даже если администратор одновременно привязан к команде.

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

Ответ `GET /api/v1/tasks/analytics/po-pl-reports` содержит каталог `periods`,
идентификатор `active_period` и `period_ids` каждой задачи для клиентской
фильтрации отчётов по сроку.

Объектная авторизация находится в `backend/auth.py`. Форматы задач — в `backend/schemas.py` и OpenAPI.

CSV import принимает не более 10 MiB и 10 000 строк; каждая валидная строка
сохраняется в отдельном savepoint, поэтому конфликт одной строки не ломает
транзакционное состояние следующих. При ошибке итогового commit `task_ids`
очищается. Вложения пишутся потоково с лимитом 50 MiB, блокировкой активных
исполняемых расширений и проверкой сигнатур распространённых бинарных форматов.

Расчёты из карточки задачи:

- `POST /tasks/{id}/prioritiser/value` — рассчитать финансовый эффект;
- `POST /tasks/{id}/prioritiser/priority` — рассчитать и сохранить приоритет;

Оба endpoint принимают `{ "version": <текущая версия задачи> }` и используют те
же права, блокировки и optimistic locking, что и обычное редактирование. Value
возвращается как предложение и записывается в основные поля только отдельным
`POST /tasks/{id}/prioritiser/value/approve`. Приоритет записывается в
`priority_score` (шкала 0–100) и `priority_justification` только специализированным
endpoint prioritiser. Обычные create/PATCH задачи не принимают legacy-поля
`financial_effect_ai*` и agent-managed поля приоритета. Карточка не использует
старые AI-поля как fallback. Недостаточные входные данные возвращаются как `422`,
недоступность сервиса или нарушение им контракта — как `502`.
Backend передаёт во внутренний Prioritiser capability header
`X-Prioritiser-Secret`; его значение задаётся `PRIORITISER_SECRET` и в
production не может оставаться локальным default.
Создание комментария принимает необязательный `client_request_id`. Upload
вложения принимает его как multipart form field, удаление вложения — как query
parameter. Повтор с тем же ключом и payload возвращает исходный результат без
создания дубля; повтор ключа с иными данными возвращает `409`.

### Teams и users

Обычные `/teams` и `/users` endpoints существуют отдельно от admin endpoints. Team resources доступны через `/teams/{team_id}/resources`. Наличие endpoint не означает разрешение его вызова любой роли.

### Reports

Поддерживаются registry/CRUD отчётов, выполнение сохранённого отчёта и специализированные directorate/DID operational reports.
Directorate report выбирает доступные пользователю неудалённые задачи с непустым
подтверждённым (`is_ready=true`) статусом ближайшей незавершённой директорской
встречи. Квартал и срок задачи на выборку не влияют. Источником текста, готовности
и маркера показа лидеру трайба служит `TaskReportingStatus`, а не поля задачи.
Ответ также содержит статус предыдущей проведённой директорской встречи и право
пользователя изменять маркер текущего среза. Массив `teams` содержит все команды,
доступные пользователю по области чтения задач, включая команды без готовых
статусов (`total=0`, `tasks=[]`).
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

`GET /customer/tasks` возвращает задачи в области текущего бизнес-заказчика. `GET /customer/tasks/{task_id}` возвращает ограниченную read-only customer-проекцию (`id`, `public_id`, название, описание, прогресс, даты, команда, статус и срок), если задача находится в `business_customer_id` текущего пользователя либо связана с его собственным `RequirementRequest`. Удалённая или не входящая ни в одну из этих областей задача получает `404`; внутренние оценки, финансовые и lock-поля в detail-ответ не входят. Создание и диалоговый сбор требований выполняются через Agent API, а не отдельный customer POST endpoint.

Ответы с задачами содержат внутренний числовой `id` для совместимости маршрутов и связей, а также пользовательский `public_id` по маске `TASK-000-001`. В интерфейсе и экспортах следует показывать `public_id`; `id` остаётся техническим ключом.

### Quick estimate

Группа `/quick-estimate` обслуживает epics, stories, task efforts, сортировку, завершение оценки и импорт backlog task в оценку.

### Notifications

Поддерживаются list, атомарный snapshot, unread count, summary, read/unread/read-all,
delete, restore, UX events и пользовательские preferences. `read-all` возвращает `changed_ids`,
чтобы клиент мог отменить массовую отметку через `/notifications/unread`. Лента, счётчики и сводка
возвращают только категории `assignment`, `reporting`, `mention`, `comment`, `request`;
исторические записи других категорий из БД не удаляются, но в активный центр не
попадают. В `NotificationResponse.type` возвращается стабильный код события.
Из настроек доступен только `comment`; назначения, упоминания, решения по запросам и напоминания по
отчётным встречам обязательны. Категория `request` использует type `request.review.<status>` и allowlisted target `#/customer/request/{id}`. Отдельного endpoint ручного `resolve` нет:
напоминание о статусах закрывается доменными изменениями встречи/статусов.
Незакрытое обязательное `reporting` нельзя скрыть: DELETE возвращает `409`.
Task-linked записи повторно фильтруются по текущему object-level read scope; после
отзыва доступа содержимое уведомления не возвращается.

`GET /notifications/snapshot` возвращает одну ревизию outbox, сводку, пять
приоритетных элементов общего списка для колокольчика и dashboard, а также пять
незакрытых `reporting` для фильтра «Требуют действия». Общий список сортируется по
обязательности действия, важности, непрочитанности и свежести. Все поверхности
используют этот ответ как единый согласованный срез и повторяют
чтение, если ревизия изменилась во время сборки. Каждый `NotificationResponse`
содержит серверный `target` с фиксированным `kind` и allowlisted внутренним
`url`; legacy `action_url` сохраняется для совместимости. Внешние URL,
неизвестные маршруты и лишние query-параметры заменяются безопасным fallback.

`POST /notifications/ux-events` принимает только фиксированные event/surface,
категорию, состояние и ограниченную длительность. Заголовок, текст, user ID и
произвольные метки endpoint не принимает; данные агрегируются в Prometheus.

`GET /events/stream` — авторизованный `text/event-stream`. Клиент передаёт cursor
через query `after` либо `Last-Event-ID`. События `task.*`, `requirement.*` и
`report.*` являются сигналом
инвалидации и содержат только ID, версию и названия изменённых полей; актуальные
данные клиент получает штатным GET. Персональные `notification.*` доступны
только получателю.

### Timeline

Есть чтение timeline и year view, а также admin CRUD событий.

### Agent proxy

Backlog proxy поддерживает JSON `POST /agent/chat`, потоковый
`POST /agent/chat-stream`, сессии, reset, send-for-review, редактирование draft
section и persisted requirement requests. Внешний контракт Agent описан
отдельно в `../../agent/docs/API.md`. Потоковый endpoint ретранслирует
`text/event-stream` без накопления полного ответа и запрещает proxy buffering.
События `delta` содержат отображаемый текст, а завершающий `result` — полный
структурированный ответ.

Каждое chat-сообщение передаёт стабильный `message_id`: повтор одного
HTTP-запроса возвращает сохранённый ответ и не изменяет историю второй раз.
После клиентской отмены тот же идентификатор позволяет безопасно восстановить
уже завершённый сервером результат.

`GET /agent/session`, `GET /agent/session/{id}` и элементы `GET /agent/sessions` дополняются workflow-метаданными `request_id`, `request_status`, `request_version`, `request_url`, если с диалогом связан request текущего пользователя. `POST /agent/ux-event` принимает только фиксированный набор событий и outcomes, опционально `duration_ms`; текст диалога и другие высококардинальные данные endpoint не принимает и не сохраняет.

Review-ответы `GET /agent/requests`, `GET /agent/requests/review` и `GET /agent/requests/{id}` дополнительно содержат вычисленные сервером поля `review_deadline`, `stage_started_at`, `is_overdue` и `available_actions`. `review_deadline` берётся только из отдельного одноимённого атрибута draft и не подменяется ожидаемой датой результата или сроком связанной задачи. `stage_started_at` определяется по последнему событию текущего статуса с fallback на `updated_at/created_at`. `GET /agent/requests/review` принимает `limit` 1–500 (по умолчанию 250) и `offset`, сортировка стабильна по убыванию `created_at`. `available_actions` — источник истины для UI: `claim` доступен только для `submitted`, а `approve`, `return`, `reject` и `release` — назначенному ревьюеру в `in_review`; глобальный ревьюер дополнительно получает `reroute`. Статус `returned` ожидает повторной отправки заказчиком.

Метаданные восстановления также содержат `request_team_id`, `request_team_name`
и `review_comment`. Они позволяют показать фактический маршрут и замечание при
возврате с ревью. Успешная отправка и повторная отправка возвращают
`request_status` и `request_version`. При повторной отправке сохраняются ID
запроса и исходная команда, увеличивается версия. Если команда не выбрана при
первой отправке, используется команда профиля автора, а при её отсутствии —
общая очередь. Описание запроса и создаваемой задачи сохраняет все поля draft,
включая риски, зависимости, замечания и доказательства происхождения.

Проверено по коду и изолированным регрессионным тестам 08.09.2026:
`POST /agent/send-for-review` принимает `expected_draft_hash` просмотренной
редакции. Backend сверяет его со снимком агента и передаёт хеш агенту для
повторной проверки внутри блокировки сессии. В БД записывается подтверждённый
`draft` из ответа агента. Изменённый черновик или отличающаяся уже отправленная
редакция возвращают 409; идемпотентный успех допускается только для того же
снимка. Для совместимости поле необязательно у прежних API-клиентов; SPA его
передаёт. Ответ содержит `draft_revision` — SHA-256 canonical JSON полного draft
(`sort_keys`, UTF-8, разделители `,`/`:`, без NaN).

Карточки запросов возвращают `revision_history` (снимок, хеш, номер редакции,
автор, время отправки) и `status_history` (решение, комментарий, актор, редакция,
время). Счётчик `version` по-прежнему служит optimistic locking и отличается
от номера отправленной редакции. История прежних запросов начинается с явно
помеченного `legacy_snapshot`; неизвестная дата прежнего решения не выдумывается.

Клиент проверяет `action` и `success` даже при HTTP 200: `error`,
`validation_error` и `sent_locked` не являются подтверждением сохранения.
Для отказов HTTP 409 отображается бизнес-пояснение backend.

`GET /agent/teams/{team_id}/ba` доступен только пользователю с правом ревью выбранной команды и возвращает только её активных участников с ролью `BA/Участник команды` или `BA/Бизнес-аналитик`. То же ограничение проверяет `PUT /agent/requests/{id}/status` при переводе в `in_progress`; передать запрос пользователю без допустимой BA-роли нельзя. Status command дополнительно принимает ограниченные `action_reason`, `finding_resolutions` и `team_id`: причина обязательна для возврата `in_review → submitted`; сменить команду может только глобальный ревьюер. Событие истории сохраняет причину и результаты рассмотрения findings. При создании задачи `link_requirements` содержит ссылку на принятую редакцию request.

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


## Бэклог для бизнес-заказчиков ДИД — проверено 04.09.2026

Все пути ниже имеют префикс `/api/v1` и требуют внутреннего пользователя с доступом к отчётам.

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/reports/did-backlog?quarter=3Q%202026` | Девять атрибутов, ID, признаки пробелов и сводка |
| GET | `/reports/did-backlog/quarters` | Доступные кварталы и текущий квартал |
| GET / PUT / DELETE | `/reports/did-backlog/preferences` | Прочитать, сохранить, сбросить свои настройки |
| POST | `/reports/did-backlog/export/xlsx` | XLSX: имя файла и base64-содержимое |
| POST | `/reports/did-backlog/export/pdf` | HTML для стандартного диалога печати |
| GET / POST | `/admin/customer-references/{kind}` | Список / создание справочной записи, `admin=full` |
| PUT | `/admin/customer-references/{kind}/{id}` | Изменение с проверкой исходного снимка `expected`, `admin=full` |

`kind`: `did-client-groups`. Контактное лицо берётся из существующего `/admin/business-customers`; отдельный endpoint справочника контактов не создаётся. Настройки и экспорт принимают
`quarter`, `filters`, `sortField`, `sortDir`, `widths`; экспорт дополнительно принимает
`ordered_ids` видимых задач. `user_id` в команде запрещён. Экспорт проверяет одновременно
`user.can_export` и `role.can_export`; видимость задач ограничивается общей task-policy.
При изменении состава выборки перед экспортом возвращается 409. Новый nullable FK `did_client_group_id` задачи
включён в создание, PATCH, массовое изменение, ответы и `/tasks/reference`.
Полный контракт поведения и ограничение применения миграции — [отчёт ДИД](DID_BACKLOG_REPORT.md).
