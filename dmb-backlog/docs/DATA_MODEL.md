---
title: Модель данных Backlog coordinator
scope: as-is
status: verified
last_verified: 2026-09-08
source_of_truth: backend/models.py
evidence:
  - backend/models.py
  - backend/database.py
  - backend/schemas.py
---

# Модель данных Backlog coordinator

Единственный поддерживаемый источник физической схемы — `backend/models.py`. На дату проверки SQLAlchemy metadata содержит 45 таблиц. Этот документ объясняет назначение и связи; точные типы, nullable, defaults, unique constraints и индексы следует читать из моделей.

## Границы достоверности

- `db-schema.dbml` является производным представлением и может отставать от моделей.
- Pydantic-схемы описывают API, но не заменяют ORM-схему.
- Наличие поля не доказывает, что оно используется каждым UI-сценарием.
- Seed-значения не являются частью физической модели.
- PostgreSQL DDL и Alembic offline SQL проверены; live smoke требует запущенного Docker/PostgreSQL.

## Группы таблиц

| Область | Таблицы |
|---|---|
| Пользователи и доступ | `users`, `roles`, `refresh_sessions`, `business_customers` |
| Команды и ресурсы | `teams`, `team_types`, `team_competency_resources` |
| Задачи | `tasks`, `task_history`, `task_comments`, `task_attachments`, `task_viewers`, `task_jira_links` |
| Декомпозиция | `epics`, `stories` |
| Справочные данные | `channels`, `deadlines`, `departments`, `priorities`, `statuses`, `task_types`, `project_statuses`, `dictionary_items`, `competency_cost_history` |
| Проекты и теги | `projects`, `tags`, `issue_tags`, `project_tags` |
| Уведомления | `notifications`, `notification_templates`, `user_notification_preferences` |
| События и идемпотентность | `event_outbox`, `idempotency_records` |
| Отчётные встречи | `reporting_meetings`, `task_reporting_statuses`, `task_reporting_status_revisions`, `reporting_meeting_history` |
| Отчёты и интерфейс | `reports`, `display_settings`, `field_labels`, `column_labels` |
| AI Agent | `agent_sessions`, `requirement_requests` |
| Аудит и календарь | `audit_log`, `timeline_events` |

## Пользователи и доступ

### `users`

Хранит учётную запись, профиль и связи:

- `role_id → roles.id`;
- `team_id → teams.id`;
- `business_customer_id → business_customers.id`.

Также содержит bcrypt hash пароля, признаки активности и индивидуальные флаги `can_edit`, `can_delete`, `can_export`. Реальная авторизация определяется совместно данными роли и функциями `backend/auth.py`.

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
- `owner_id`, `created_by`, `lock_owner_id → users.id`.

Группы полей:

- идентификация: `public_id`, `title`, `description`, даты и ссылки;
- оценки: плановые и фактические трудозатраты по компетенциям;
- эффект и приоритет: финансовые эффекты, justification, scores, CV;
- исполнение: progress, forecast, статусы ключевого проекта/дирекции/ДИД;
- метрики: KR plan/fact/unit;
- техническое состояние: `is_deleted`, optimistic-lock `version`, lock owner/until, timestamps.

`involved_teams` хранится как поле задачи, а не отдельная таблица связи. Значение и формат следует проверять в схемах и роутерах перед изменением.

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

- `reporting_meetings` хранит конкретные экземпляры трёх типов встреч, плановую и исходную даты, состояние `date_pending/planned/held/cancelled`, причину изменения, версии и отметки отправленных уведомлений.
- `task_reporting_statuses` хранит один статус задачи на одну встречу (`meeting_id + task_id` уникальны), явный признак подтверждённой готовности `is_ready`, встречный маркер `directorate_attention` для показа лидеру трайба, признак демо ДИД, источник переноса и отдельную optimistic-lock версию. Маркер не переносится в модель задачи и используется только формой подготовки и директорским отчётом.
- `task_reporting_status_revisions` сохраняет историю изменений текста и признака демо.
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
