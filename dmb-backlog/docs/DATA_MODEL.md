---
title: Модель данных Backlog coordinator
scope: as-is
status: verified
last_verified: 2026-10-21
source_of_truth: backend/models.py
evidence:
  - backend/models.py
  - backend/database.py
  - backend/schemas.py
---

# Модель данных Backlog coordinator

## Рабочие задачи: второй этап — 21.10.2026

Миграция `d7f3b1c50e42` добавляет `work_tasks.priority` (обычный по умолчанию),
`checklist` (JSON, пустой список) и `work_task_templates` (владелец, название,
JSON-содержание, версия, признак удаления, даты). Применена к PostgreSQL.
[Контракты и проверки](WORK_TASKS.md#второй-этап-рабочего-места--проверено-21102026).

## Фоновый анализ встреч — проверено 17.10.2026

`MeetingCapture` дополнен `analysis_status` (String(16), NOT NULL, default idle,
индекс), `analysis_run_id` (UUID строкой), requested/started/finished datetime
полями с префиксом `analysis_`, `analysis_error_code` (String(32)). Состояние
анализа (`idle/queued/running/completed/failed`) отделено от человеческого
`status=draft/saved`. Ошибка-пояснение вычисляется по whitelist кодов, сырой
ответ провайдера не хранится. Пустой completed отличим от незапущенного idle.
Захват и публикация результата используют ID запуска/версию; active блокирует
PUT/confirm. Новых таблиц и защищённых записей нет. Миграция `b6f4c2d9e821`
применена к локальному PostgreSQL. [Контракт](../../docs/meeting-capture-agent.md).

## CUSTOMER-03: единое состояние прочтения — проверено 17.10.2026

Новых таблиц, колонок и миграций нет. Источник состояния — Notification.is_read/read_at; категория request и точный action_url связывают уведомление с запросом, user_id ограничивает получателя. Отдельный last_viewed_at и клиентское хранилище прочтения не вводятся. Прочтение в центре уведомлений и в customer-карточке использует одни записи. Скрытые уведомления не участвуют в отметке новых событий. [API](API_SPEC.md).

## CUSTOMER-01: результат legacy-задачи — проверено 17.10.2026

Миграция не требуется: используются существующие status (String(20)), version, updated_at и status_history в RequirementRequest, Notification и EventOutbox. Автоматические статусы: completed, not_relevant, task_rejected, task_deleted; при переоткрытии — in_progress. История содержит source=task_result, task_id, previous_status и request_version; автор события — «Система». Ключ уведомления: request-task:{request_id}:{version}:{outcome}. Идемпотентность обеспечивается проверкой перехода и optimistic version запроса, а не объединением уведомлений по состоянию read/dismissed. Повторное завершение после возврата в работу — новое событие.

Session.before_flush охватывает ORM-изменения Task.status_id/is_deleted и смену task_id существующего запроса. Прямые SQL/bulk DML вне ORM не поддерживают этот контракт. Исторические несогласованные записи массово не исправлялись: рабочие БД не изменялись. Это не автоматическое подтверждение WorkResolution. [Контракт API](API_SPEC.md).

## Read-only проекция customer queue — 17.10.2026

CUSTOMER-02 не добавляет таблиц, колонок или миграций. `QueueItem`/`QueueResponse` в [customer_queue.py](../backend/services/customer_queue.py) — типизированные модели ответа, не ORM-сущности. Проекция объединяет существующие RequirementRequest/Task и метаданные сессий агента; даты приводятся к UTC datetime/null на границе API. Она не записывает вычисленный этап обратно в RequirementRequest и не заменяет WorkResolution. [Контракт API](API_SPEC.md).


## Разборы встреч — проверено 09.10.2026

`MeetingCapture` / `meeting_captures` хранит приватный источник и JSON
черновых пунктов с версией. `MeetingAction` / `meeting_actions` хранит только
подтверждённые поручения/договорённости и необязательную FK на `tasks.id`.
Уникальность `(capture_id, item_id)`, транзакционное подтверждение и optimistic
locking защищают от дублей и потерянных правок. Это отдельные сущности,
не реализация будущей универсальной рабочей задачи.
Миграция `b7e3a9d1c542` применена к локальной PostgreSQL 09.10.2026.
[Поля, доступ и границы](../../docs/meeting-capture-agent.md#хранение-и-доступ).

Единственный поддерживаемый источник физической схемы — `backend/models.py`. На дату проверки в моделях объявлено 49 таблиц. Этот документ объясняет назначение и связи; точные типы, nullable, defaults, unique constraints и индексы следует читать из моделей.

## Границы достоверности

- `db-schema.dbml` является производным представлением и может отставать от моделей.
- Pydantic-схемы описывают API, но не заменяют ORM-схему.
- Наличие поля не доказывает, что оно используется каждым UI-сценарием.
- Seed-значения не являются частью физической модели.
- PostgreSQL DDL и Alembic offline SQL проверены; live smoke требует запущенного Docker/PostgreSQL.

## Группы таблиц

| Область | Таблицы |
|---|---|
| Пользователи и доступ | `users`, `roles`, `auth_sessions`, `auth_challenges`, `security_events`, `login_reservations`, `refresh_sessions`, `business_customers` |
| Команды и ресурсы | `teams`, `team_types`, `team_competency_resources` |
| Задачи | `tasks`, `task_history`, `task_comments`, `task_attachments`, `task_viewers`, `task_jira_links` |
| Декомпозиция | `epics`, `stories` |
| Справочные данные | `channels`, `deadlines`, `departments`, `priorities`, `statuses`, `task_types`, `project_statuses`, `dictionary_items`, `competency_cost_history` |
| Проекты и теги | `projects`, `tags`, `issue_tags`, `project_tags` |
| Уведомления | `notifications`, `notification_templates`, `user_notification_preferences` |
| События и идемпотентность | `event_outbox`, `idempotency_records` |
| Отчётные встречи | `reporting_meetings`, `task_reporting_statuses`, `task_reporting_status_revisions`, `reporting_meeting_history` |
| Отчёты и интерфейс | `reports`, `display_settings`, `field_labels`, `column_labels` |
| AI Agent | `agent_sessions`, `requirement_requests`, `requirement_reviews` |
| Аудит и календарь | `audit_log`, `timeline_events` |

## Пользователи и доступ

### `users`

Хранит учётную запись, профиль и связи:

- `role_id → roles.id`;
- `team_id → teams.id`;
- `business_customer_id → business_customers.id`.

Также содержит nullable Argon2id hash пароля, признаки активности и индивидуальные флаги `can_edit`, `can_delete`, `can_export`. Реальная авторизация определяется совместно данными роли и функциями `backend/auth.py`.

### `roles`

Хранит разрешения разделов и области task-действий:

- `*_access` для backlog, reports, analytics, customer, settings и admin;
- `customer_portal_only`, `review_access`, `pip_decision_access`;
- `task_edit_scope`, `task_comment_scope`, `task_delete_scope`;
- legacy/дополнительные флаги task-действий.

Назначение ролей и сами записи относятся к защищённым данным и не должны изменяться автоматическими проверками документации.

### `refresh_sessions`

Серверное состояние refresh-токенов: `jti`, family ID, hash токена, срок действия, отзыв и ссылка на следующий rotated JTI. Связь: `user_id → users.id`.

### `business_customers`

Справочник бизнес-заказчиков с необязательной связью `department_id → departments.id`. Пользователь портала может ссылаться на запись через `users.business_customer_id`.

## Команды и ресурсы

### `teams`

Команда содержит тип, цвет, домен, описание, сокращение и legacy-текстовые поля состава. Нормализованные ответственные:

- `team_type_id → team_types.id`;
- `pl_id`, `po_id`, `cl_id`, `it_pl_id → users.id`.

Поля состава и ответственных команд являются защищёнными данными.

### `team_competency_resources`

Ресурсная модель команды по компетенции: количества senior/middle/junior, отпускные и рабочие дни. Связь: `team_id → teams.id`.

## Центральная сущность `tasks`

`tasks` связывает бизнес-описание, классификацию, приоритизацию, оценки, статусы и аудит изменений.

У задачи два идентификатора: внутренний числовой `id` используется в связях и URL API, а стабильный пользовательский `public_id` хранится в БД, уникален и отображается в карточках по маске `TASK-000-001` (две группы по три цифры). Значение детерминированно формируется из внутреннего `id`.

Основные связи:

- `team_id → teams.id`;
- `channel_id → channels.id`;
- `business_customer_id → business_customers.id`;
- `department_id → departments.id`;
- `project_id → projects.id`;
- `task_type_id → task_types.id`;
- `priority_id → priorities.id`;
- `status_id`, `previous_status_id → statuses.id`;
- `deadline_id → deadlines.id`;
- `start_shift_id → start_shifts.id`;
- `owner_id`, `created_by`, `lock_owner_id → users.id`.

Группы полей:

- идентификация: `public_id`, `title`, `description`, даты и ссылки;
- оценки: плановые и фактические трудозатраты по компетенциям;
- эффект и приоритет: финансовые эффекты, justification, scores, CV;
- исполнение: progress, `progress_updated_at`, отложенный старт, forecast, статусы ключевого проекта/дирекции/ДИД;
- метрики: KR plan/fact/unit;
- техническое состояние: `is_deleted`, optimistic-lock `version`, lock owner/until, timestamps.

`involved_teams` хранится как поле задачи, а не отдельная таблица связи. Значение и формат следует проверять в схемах и роутерах перед изменением.

`start_shifts` — фиксированный справочник начала участия задачи в календарном плане
квартала: M1, M2 или M3. `tasks.start_shift_id = NULL` совместим с прежними данными
и трактуется как M1. `tasks.progress_updated_at` фиксирует именно фактическое
обновление процента выполнения и используется для напоминаний об актуализации.

## История и совместная работа

| Таблица | Назначение | Ключевые связи |
|---|---|---|
| `task_history` | изменения отдельных полей | task, changed user |
| `task_comments` | комментарии и ответы | task, user, parent comment |
| `task_attachments` | metadata файлов | task, user |
| `task_viewers` | присутствие/последний просмотр | task, user |
| `task_jira_links` | нормализованные Jira URL | task |

Физические файлы вложений находятся вне БД в `backend/uploads/{task_id}`.

## Декомпозиция

- `epics.task_id → tasks.id`;
- `stories.epic_id → epics.id`.

Обе таблицы содержат описание, порядок и оценки по компетенциям. Каскадное поведение нужно проверять по ORM relationships и endpoint реализации, а не предполагать по внешнему ключу.

## Проекты и теги

### `projects`

Проект имеет code, name, description, status и ответственного PL:

- `status_id → project_statuses.id`;
- `responsible_pl → users.id`.

### Теги

- `tags` — справочник тегов с optimistic lock и creator;
- `issue_tags` — связь task ↔ tag;
- `project_tags` — связь project ↔ tag.

## Справочные таблицы

Отдельные таблицы используются для каналов, дедлайнов, подразделений, приоритетов, статусов задач, типов задач, типов команд и статусов проектов. `dictionary_items` обслуживает дополнительные типизированные словари.

Некоторые справочники имеют `is_active`, `version`, `lock_owner_id`, `lock_until`; точный набор отличается по таблицам. Справочники и их записи являются защищёнными данными.

`competency_cost_history` хранит ставку по паре competency/year с признаком активности и timestamps.

## Уведомления

- `notifications` — пользовательские уведомления, category/type, содержимое, action URL, группировка и состояния read/dismissed/resolved. Активные category: `assignment`, `reporting`, `mention`, `comment`, `request`; активные type: `task.assigned`, `meeting.status_update.required`, `comment.user_mentioned`, `task.comment.added`, `request.review.<status>`. Повтор по открытому `group_key` обновляет target/importance/timestamp, увеличивает `group_count` и возвращает карточку в unread. Domain resolve автоматически делает запись read; незакрытый `reporting` нельзя dismiss;
- `notification_templates` — legacy-хранилище шаблонов; административная вкладка скрыта, а runtime активных сценариев не читает эту таблицу;
- `user_notification_preferences` — JSON preferences пользователя; в активном контракте сохраняется только логический флаг `comment`.

`notifications.user_id → users.id`, опциональная задача — `task_id → tasks.id`.
Наличие строки не гарантирует её выдачу: list/count/summary повторно применяют
текущий task read scope и скрывают task-linked содержимое после отзыва доступа.

## Отчёты и настройки интерфейса

### Отчётные встречи и статусы

- `reporting_meetings` хранит конкретные экземпляры четырёх типов встреч (`team_weekly`, `directorate`, `did`, `key_projects`), плановую и исходную даты, состояние `date_pending/planned/held/cancelled`, причину изменения, версии и отметки отправленных уведомлений. `team_weekly` создаётся автоматически на понедельник каждой ISO-недели.
- `task_reporting_statuses` хранит один статус задачи на одну встречу (`meeting_id + task_id` уникальны), явный признак подтверждённой готовности `is_ready`, встречный маркер `directorate_attention` для показа лидеру трайба, признак демо ДИД, источник переноса и отдельную optimistic-lock версию. Для `team_weekly` дополнительно сохраняются JSON `weekly_payload` (`signal`, `next_step`, `next_step_due`, `decision_request`), `progress_snapshot` и `task_status_snapshot`.
- `task_reporting_status_revisions` сохраняет историю изменений текста, признака демо и структурированного недельного payload.
- `reporting_meeting_history` фиксирует назначения, переносы, проведение и отмену встреч.

После подтверждения факта встречи её статусы становятся предыдущими. При отмене заполненные статусы переносятся в следующую встречу того же типа без перезаписи уже существующих данных.

- `reports` — определение отчёта, JSON filters/fields, группировка, сортировка и автор;
- `display_settings` — JSON-настройки по странице;
- `field_labels` — подписи и порядок полей;
- `column_labels` — подписи колонок.

Наличие JSON-поля означает schema-on-read: допустимая структура определяется потребляющим кодом, а не ограничениями БД.

## AI Agent

- `agent_sessions` связывает пользователя backlog с идентификатором сессии внешнего Agent;
- `requirement_requests` хранит черновик требования, статус, Agent session и связи с автором, командой, reviewer и assignee.
- Проверено 08.09.2026: `revision_history` (JSON-массив) хранит отдельные отправленные снимки draft, их SHA-256, автора, время и последовательный номер редакции; `status_history` хранит решения, комментарии, актора, редакцию и опциональные структурированные метаданные (например, результаты рассмотрения findings). Backend дополняет историю новыми записями, сохраняя прежние снимки при повторной отправке. Техническая `version` отдельно защищает конкурентные изменения. Поля добавляет миграция `c1a9e8b7d602`; на рабочих БД в рамках этой доработки она не выполнялась.
- Для существующего запроса при первом изменении сохраняется доступный `legacy_snapshot`; неизвестные прошлые редакции не реконструируются. У прежнего комментария `legacy_event=true`, `created_at=null`, а `observed_at` обозначает момент сохранения доступного свидетельства, не дату решения.

Связи `user_id`, `reviewer_id`, `assignee_id → users.id`; `team_id → teams.id`.

### Согласование редакции БТ V2 — проверено 09.10.2026

`requirement_reviews` — отдельный предмет общей очереди ревью. Он не является
пользовательским запросом и не запускает intake lifecycle `RequirementRequest`.
Согласование или возврат БТ не создают Task и не меняют статус исходного запроса.

- `artifact_id`, `artifact_revision`, `artifact_fingerprint` адресуют точный
  документ; `artifact_snapshot` хранит полный неизменяемый JSON без изменения
  canonical fingerprint, включая неизвестные поля.
- `review_report` отдельно сохраняет пакет AI-проверки, замечаний, источников и
  решений аналитика. `source_metadata` содержит снимок связанного Task/Request,
  версию и значимые исходные поля. Для Request учитывается структурный `draft`,
  для Task — `link_requirements`; смена иных атрибутов задачи не обесценивает БТ.
- `creator_id`, `reviewer_id` и `source_request_author_id` ссылаются на существующих
  пользователей. Исходный автор запроса сохраняется и для задачи, созданной из
  запроса. Эти связи не изменяют пользователей, роли, команды или назначения.
- Nullable `target_type` + `target_id` задают Task/Request либо самостоятельный
  документ. Полиморфная связь проверяется сервисом при каждом чтении/решении;
  удаление или отзыв доступа к исходному объекту закрывают доступ к снимку.
- Состояния: `submitted`, `returned`, `approved`, `withdrawn`. Claim назначает
  ревьюера без смены `submitted`. Автор не может согласовать своё БТ даже с
  `admin_access=full`; отдельное полномочие самоутверждения в MVP отсутствует.
- Nullable unique `active_artifact_id` вместе с CHECK гарантирует максимум одно
  активное согласование на документ. Новая рабочая редакция не отзывает снимок;
  явная замена проверяет версию старого review и атомарно отзывает его вместе
  с созданием нового пакета.
- `version` защищает решения от гонок; уникальный `(creator_id, idempotency_key)`
  и `submission_hash` защищают отправку. `events` содержит решения и ключи действий,
  ограниченные актором и payload. Повтор чужого ключа не даёт чужие права.
- Публикация и решение обновляют ранее прочитанный source snapshot и удерживают
  `FOR UPDATE` исходной Task/Request до commit. Порядок блокировок един: источник,
  затем review; проверка не использует устаревший объект из identity map сессии.
- Снимок, пакет проверки и исходные метаданные нельзя переписать через ORM;
  исправление требует нового согласования. Решение относится к `review.version`,
  независимо от текущего рабочего черновика.

DDL добавляет миграция `a6d2f8c0b431`. Проверены изолированные доменные тесты и
PostgreSQL offline SQL; миграция на рабочую БД в этой доработке не применялась.

## Аудит и timeline

- `audit_log` — транзакционный журнал ORM-изменений HTTP-команд с actor,
  request ID, типом/ID сущности и перечнем изменённых полей без значений
  защищённых атрибутов;
- `timeline_events` — календарные события с типом, датой, периодом, visibility и creator; возможна связь с проектом.

## Создание и изменение схемы

Целевое состояние задаётся SQLAlchemy-моделями, а изменения применяются
версионируемыми миграциями из `backend/alembic/versions/`. Исторические SQLite-
скрипты из `backend/migrations/` не являются поддерживаемым workflow. Политика
описана в `SCHEMA_CHANGES.md`.

## Что не подтверждено

- Полное соответствие 3NF.
- Production-ready PostgreSQL deployment.
- Retention и автоматическое архивирование записей.
- Автоматический backup/restore.
- Автоматическая синхронизация `db-schema.dbml` с SQLAlchemy metadata.

Историческое ручное описание старой схемы сохранено в `archive/legacy/DATA_MODEL_STALE_2026-06-29.md`.
## Транзакционный outbox

`event_outbox` хранит минимальные доменные и персональные события до публикации в
Redis Stream. Основные поля: тип и ID агрегата, версия, необязательный получатель,
JSON payload, время доступности, claim token/time, число попыток, ошибка, время
успешной обработки и `dead_lettered_at`. Таблица не хранит снимок задачи и не является источником
актуального состояния.

Индексы `ix_event_outbox_pending` и `ix_event_outbox_claim` обслуживают конкурентный
claim/retry. Обработанные записи имеют ограниченную ретенцию; Redis Stream также
ограничен `EVENT_STREAM_MAXLEN`.

Ошибки Redis остаются retryable. Событие, которое Redis отклоняет как некорректное,
после `OUTBOX_MAX_ATTEMPTS` переводится в dead letter и удерживается отдельно до
`OUTBOX_DEAD_LETTER_RETENTION_DAYS`.

## Идемпотентные команды

`idempotency_records` имеет уникальность `(operation, user_id, request_key)` и
хранит fingerprint запроса вместе с ID/версией результата. Резервирование ключа
и бизнес-изменение коммитятся одной транзакцией. Механизм используется для задач,
комментариев, вложений и CRUD сохранённых отчётов. Повтор того же payload возвращает
существующий результат; повтор ключа с иным payload возвращает `409`.

## Отчёт ДИД — проверено 04.09.2026

Миграция `a9246d1c7e30` добавляет `did_client_groups` (код, название, порядок, активность), nullable FK `tasks.did_client_group_id` и таблицу `user_report_prefs` с уникальной парой пользователь/отчёт и JSON настроек. Контактное лицо использует существующий `tasks.business_customer_id` → `business_customers`, связанный с `departments`. Отдельный справочник контактов исключён по уточнению владельца продукта от 04.09.2026. Миграция применена локально 04.09.2026 с разрешения владельца продукта; справочник не наполнен. Подробности — [отчёт ДИД](DID_BACKLOG_REPORT.md).

## Граница данных legacy Assistant V2 — проверено 19.09.2026

В отдельной V2 DB `NeedCase.data_classification` сохраняет `synthetic` либо
`approved_real`. При закрытом real-data gate записи `approved_real` не попадают
в list projection и недоступны через case API; authorized DMB snapshot создаёт
только `approved_real` case.

Legacy `assistant-v2/` не добавляет таблиц или FK в основную DMB DB. Это описание
сохранённого прототипа, а не нового домена `agent-v2/` выше. Authorized snapshots Task,
Request и goal формируются adapter по текущей DMB policy и содержат только
allowlisted projection, version, digest и policy metadata. V2 хранит копию в
отдельной DB `assistant_v2`; её 22 таблицы и Alembic описаны в
`../../assistant-v2/app/models.py` и `../../assistant-v2/migrations/`.


## Учётные записи — изменение от 12.10.2026

[Текущий контракт управления учётными записями](ACCOUNT_SECURITY.md) описывает
API, модель сессий, интерфейсы, конфигурацию, миграцию и границы проверки.
Код реализован; миграция и массовый переход рабочих пользователей в этом чате
не выполнялись. По уточнению пользователя проверено сохранение текущего входа
администратора; подробности и границы подтверждения — в профильном документе.

## Помощник по бэклогу — 14.10.2026

Добавлена отключённая по умолчанию интеграция самостоятельного сервиса. Gateway `/api/v1/backlog-assistant` обслуживает sessions/messages/runs/cancel/results/feedback; приватный Data API вынесен в отдельный mTLS listener 9450. Страница `#/backlog-assistant` и контекстная панель используют общие разговоры. Миграция `e8f1b2c3d405` создаёт только `backlog_assistant_integration`; очередь и история находятся в отдельной PostgreSQL БД агента.

[Контракты и хранение](../../backlog-assistant/docs/API.md), [эксплуатация](../../backlog-assistant/docs/OPERATIONS.md), [подтверждённые проверки и ограничения пилота](../../backlog-assistant/docs/TESTING.md).


## Рабочие задачи — проверено 16.10.2026

Восемь новых таблиц WorkTask/истории/комментариев/файлов, решений и связей запросов, зависимостей и внешних ссылок; notifications получает отдельный nullable work_task_id. Task не получает новых атрибутов.

Фактический scope, API, миграция и ограничения: [Рабочие задачи](WORK_TASKS.md).


### Этап 5 рабочих задач — проверено 16.10.2026

Реализованы атомарное разбиение запросов, отдельный отчёт с доступными агрегатами
и неизменяемые снимки встреч. PostgreSQL обновлён до `a1b2c3d4e517`; интеграционный
прогон выполнен без записи защищённых данных. [Контракты, поведение и проверки](WORK_TASKS.md#этап-5-разбиение-и-отчётность).

## Доска WorkTask — проверено 21.10.2026

Третий этап не добавляет сущности или статусы: доска является представлением существующих WorkTask. Порядок карточек вычисляется запросом, ручные позиции не сохраняются. Курсоры подписываются, контекст прокрутки хранится только в браузерной сессии. Новых миграций и индексов нет; модель приоритетов, чек-листов и шаблонов этапа 2 сохранена. [Реализация и проверки](WORK_BOARD.md).
