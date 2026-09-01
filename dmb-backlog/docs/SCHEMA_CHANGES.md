# Политика изменения схемы базы данных

> Статус: PostgreSQL + Alembic, обновлено 2026-09-01.

## Источник истины

SQLAlchemy-модели в `backend/models.py` описывают целевое состояние схемы, а
версионируемая история находится в `backend/alembic/versions/`. При штатном
запуске `scripts/start-project.ps1` сначала выполняется `alembic upgrade head`,
и только после успешной миграции запускается backend.

## Добавление таблицы или колонки

1. Изменить `backend/models.py`.
2. Проверить совместимость значения по умолчанию и nullable-ограничений с уже
   существующими строками.
3. Из `dmb-backlog/backend/` создать ревизию:
   `..\..\.venv\Scripts\python -m alembic revision --autogenerate -m "описание"`.
4. Обязательно просмотреть сгенерированные `upgrade()` и `downgrade()`.
5. Выполнить `..\..\.venv\Scripts\python -m alembic upgrade head` на пустой
   тестовой PostgreSQL и провести read-only smoke-проверку.

## Ограничения

`ensure_schema()` сохранён только для изолированных legacy/SQLite-сценариев и не
является частью PostgreSQL-развёртывания. Нельзя заменять Alembic автоматическим
`create_all()` или изменением схемы при старте приложения.

## Пользовательский ID задачи

В `tasks.public_id` хранится уникальный ID карточки по маске `TASK-000-001`.
Колонка и индекс создаются Alembic. Backfill существующих значений оформляется
отдельной миграцией данных с планом проверки и восстановления.

Для такого изменения нужен отдельный согласованный план обслуживания: резервная
копия, проверенный одноразовый сценарий, окно выполнения, проверка результата и
процедура восстановления. Выполнение операции с данными требует отдельного явного
разрешения владельца системы.

## Legacy-артефакты

Одноразовые SQLite-скрипты в `backend/migrations/` сохранены только как история и
не должны запускаться против PostgreSQL. Поддерживаемый механизм — только Alembic.
## 2026-08-28 — transactional event outbox

- Alembic revision `c82f7a3e91d4` создаёт `event_outbox` и индексы pending/claim,
  aggregate, audience и event type.
- Миграция аддитивна и не меняет пользователей, роли, команды или справочники.
- Backend новой версии нельзя запускать до достижения этой revision: mapper
  listeners записывают outbox в каждой транзакции изменения задач/уведомлений.

## 2026-08-28 — cross-worker idempotency

- Alembic revision `d9134f28a6bc` создаёт `idempotency_records`.
- Уникальный ключ `(operation, user_id, request_key)` заменяет process-local
  словари дедупликации create/update задач.
- Записи не имеют FK на защищённые сущности и удаляются по технической ретенции.

## 2026-08-28 — multi-user hardening

- Alembic revision `e4c19b7a2d65` добавляет `reports.version` и `reports.updated_at`.
- В `event_outbox` добавляется `dead_lettered_at` с отдельным индексом.
- В `audit_log` добавляется индексируемый `request_id` для корреляции.
- Миграция не изменяет пользователей, роли, команды, их атрибуты или справочники.

## 2026-08-31 — distributed trace correlation

- Alembic revision `f8a0c3d1e942` добавляет nullable `audit_log.trace_id` и индекс
  `ix_audit_log_trace_id`.
- Миграция аддитивна, не выполняет backfill и не изменяет защищённые данные.
- Новые запросы с включённым OpenTelemetry сохраняют 32-символьный W3C trace ID;
  при выключенной трассировке поле остаётся `NULL`.
