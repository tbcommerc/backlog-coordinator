---
title: Модель данных DMB Backlog
scope: as-is
status: verified
last_verified: 2026-08-24
source_of_truth: backend/models.py
evidence:
  - backend/models.py
  - backend/database.py
  - backend/schemas.py
---

# Модель данных DMB Backlog

Единственный поддерживаемый источник физической схемы — `backend/models.py`. На дату проверки SQLAlchemy metadata содержит 39 таблиц. Этот документ объясняет назначение и связи; точные типы, nullable, defaults, unique constraints и индексы следует читать из моделей.

## Границы достоверности

- `db-schema.dbml` является производным представлением и может отставать от моделей.
- Pydantic-схемы описывают API, но не заменяют ORM-схему.
- Наличие поля не доказывает, что оно используется каждым UI-сценарием.
- Seed-значения не являются частью физической модели.
- PostgreSQL-совместимость всей схемы не подтверждена отдельным прогоном.

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

- идентификация: `title`, `description`, даты и ссылки;
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

- `notifications` — пользовательские уведомления, category/type, содержимое, action URL, группировка и состояния read/dismissed/resolved;
- `notification_templates` — шаблоны и расписание повторения;
- `user_notification_preferences` — JSON preferences пользователя.

`notifications.user_id → users.id`, опциональная задача — `task_id → tasks.id`.

## Отчёты и настройки интерфейса

- `reports` — определение отчёта, JSON filters/fields, группировка, сортировка и автор;
- `display_settings` — JSON-настройки по странице;
- `field_labels` — подписи и порядок полей;
- `column_labels` — подписи колонок.

Наличие JSON-поля означает schema-on-read: допустимая структура определяется потребляющим кодом, а не ограничениями БД.

## AI Agent

- `agent_sessions` связывает пользователя backlog с идентификатором сессии внешнего Agent;
- `requirement_requests` хранит черновик требования, статус, Agent session и связи с автором, командой, reviewer и assignee.

Связи `user_id`, `reviewer_id`, `assignee_id → users.id`; `team_id → teams.id`.

## Аудит и timeline

- `audit_log` — best-effort журнал HTTP write-операций с user, action, entity, details и IP;
- `timeline_events` — календарные события с типом, датой, периодом, visibility и creator; возможна связь с проектом.

## Создание и изменение схемы

`database.ensure_schema()` вызывает `Base.metadata.create_all()` и добавляет отсутствующие колонки через `ALTER TABLE ADD COLUMN`. Механизм не удаляет и не переименовывает колонки, не преобразует типы и не переносит данные.

Ручной Alembic и исторические scripts из `backend/migrations/` не являются текущим поддерживаемым workflow. Политика описана в `SCHEMA_CHANGES.md`.

## Что не подтверждено

- Полное соответствие 3NF.
- Production-ready PostgreSQL deployment.
- Retention и автоматическое архивирование записей.
- Автоматический backup/restore.
- Гарантированная атомарность `audit_log` с бизнес-транзакциями.
- Автоматическая синхронизация `db-schema.dbml` с SQLAlchemy metadata.

Историческое ручное описание старой схемы сохранено в `archive/legacy/DATA_MODEL_STALE_2026-06-29.md`.
