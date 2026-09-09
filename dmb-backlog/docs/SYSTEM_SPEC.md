---
title: Системная спецификация Backlog coordinator
scope: as-is
status: verified
last_verified: 2026-09-08
evidence:
  - backend/main.py
  - backend/models.py
  - backend/auth.py
  - backend/routers/
  - backend/seed.py
  - frontend/js/router.js
  - frontend/js/components/
  - backend/tests/
  - frontend/tests/
---

# Системная спецификация Backlog coordinator

Документ описывает подтверждённые возможности системы. Он не является утверждённым BRD и не добавляет бизнес-правила, которых нет в реализации.

## Назначение и границы

Backlog coordinator объединяет:

- внутренний backlog задач;
- командный backlog и Kanban;
- карточку задачи, комментарии, вложения и историю;
- экспресс-оценку через epics/stories;
- аналитику и отчёты;
- уведомления и timeline;
- отчётные встречи и версионируемые статусы задач для них;
- AI-расчёт финансового эффекта и приоритета через Task Prioritiser;
- портал бизнес-заказчика;
- административный интерфейс;
- proxy к отдельному AI Business Analyst Agent.

Архитектурные границы описаны в `ARCHITECTURE.md`, API — в `API_SPEC.md`, данные — в `DATA_MODEL.md`.

## Пользовательские области

Фактический frontend регистрирует маршруты:

- dashboard;
- общий и командный backlog;
- quick estimate;
- Kanban;
- reports и analytics;
- notifications и settings;
- admin и audit log;
- customer portal;
- AI assistant и review requests.
- dead-letter outbox для полного администратора.

Доступность определяется сочетанием role permissions, специальных role flags и object-level task scopes. Точную матрицу следует получать из `backend/auth.py`, router dependencies и security tests; названия ролей сами по себе не гарантируют права.

## Задача

Центральная сущность содержит:

- описание и классификацию;
- команду, заказчика, проект и ответственных;
- плановые и фактические оценки;
- приоритет, эффекты и justification;
- статус, progress и forecast;
- ссылки и статусы для разных аудиторий;
- optimistic version и edit lock;
- soft-delete marker и timestamps.

Связанные сущности: history, comments, attachments, viewers, Jira links, tags, epics и stories.

## Каталог статусов

Seed и Kanban используют 13 значений:

| Порядок | Code | Название |
|---:|---|---|
| 1 | `new` | НОВАЯ ЗАДАЧА |
| 2 | `team_assigned` | НАЗНАЧЕНА КОМАНДА |
| 3 | `requirements` | СБОР ТРЕБОВАНИЙ |
| 4 | `check_requirements` | ПРОВЕРКА ТРЕБОВАНИЙ |
| 5 | `clarify_requirements` | УТОЧНЕНИЕ ТРЕБОВАНИЙ |
| 6 | `quick_estimate` | ЭКСПРЕСС-ОЦЕНКА |
| 7 | `decision` | ПРИНЯТИЕ РЕШЕНИЯ |
| 8 | `in_progress` | ПРИНЯТА В РАБОТУ |
| 9 | `rejected` | ОТКЛОНЕНА |
| 10 | `irrelevant` | НЕ АКТУАЛЬНА |
| 11 | `done` | ВЫПОЛНЕНА |
| 12 | `escalation` | ЭСКАЛАЦИЯ НА ЛТ |
| 13 | `hold` | ХОЛД |

Это упорядоченный каталог, а не подтверждённая строгая state machine. Обычный update задачи принимает существующий `status_id`; универсальная таблица разрешённых переходов в backend не найдена. Kanban отправляет новый status через `PUT /tasks/{id}`.

Специализированные bulk/PIP операции могут устанавливать конкретные статусы и progress. Их правила локальны соответствующим endpoint и не образуют общего lifecycle-контракта.

## Совместное редактирование

- optimistic locking использует поле `version`;
- временная блокировка задачи использует `lock_owner_id` и `lock_until`;
- viewers показывают присутствие пользователей;
- comments поддерживают parent comment и mentions;
- attachments сохраняются на filesystem и доступны через авторизованные endpoints;
- task history записывает изменения отдельных полей.

Конкретная семантика конфликтов описывается кодом tasks router и frontend conflict UI; она не должна переноситься на другие сущности автоматически.

## Экспресс-оценка

Quick estimate использует `epics` и `stories`, оценки по компетенциям, порядок элементов и импорт существующей backlog task. Endpoint `complete` завершает операцию согласно текущей реализации router.

## Отчёты и аналитика

Система содержит:

- task statistics и analytics endpoints;
- tribe dashboard и LT reports;
- directorate и DID operational reports;
- сохраняемые `reports` с filters/fields/group/sort;
- frontend-компоненты reports и analytics.

Наличие отчёта не подтверждает формальную бизнес-методику расчёта вне реализованного запроса. Формулы следует проверять в `reports_router.py` и `services/task_analytics.py`.

Директорский операционный отчёт использует готовые статусы ближайшей
незавершённой директорской встречи без квартального ограничения, группирует их по
командам и проектам и показывает текущий и предыдущий статус. Маркер показа
лидеру трайба относится к конкретному статусу встречи и доступен только в
поверхностях директорского отчёта; общая модель и карточка задачи его не содержат.

## Уведомления

Personal inbox содержит ровно четыре рабочих сценария:

- назначение пользователя исполнителем задачи;
- напоминание PO/PL/CL и BA/участникам команды о незаполненных статусах к регулярной встрече;
- `@mention` активного пользователя, которому доступна задача;
- новый комментарий в задаче основной команды получателя.

Автор комментария и упомянутые не получают дублирующее командное уведомление.
Назначения, напоминания о статусах и упоминания не отключаются; отключить можно только
командные комментарии. В ленте нет рисков, эскалаций на ЛТ, квартальных дедлайнов, смен статуса,
признаков редактирования, express/request/system событий и напоминаний о неполных атрибутах.
Исторические записи этих категорий скрыты, но не удаляются. Доставка, открытая лента и счётчик синхронизируются через
transactional outbox/SSE. Ручного `resolve` нет; actionable-статус есть только у отчётных напоминаний и
закрывается по состоянию встречи/заполнению статусов. Незакрытое обязательное напоминание нельзя dismiss;
resolved автоматически исключается из unread. Task-linked содержимое повторно проверяется по текущему read scope.
Продуктовое решение и каталог
событий зафиксированы в `proposals/NOTIFICATION_SERVICE_TOP_DOWN.md`.

Для подготовки встречи используется отдельная командная поверхность быстрого заполнения:
она доступна из бэклога команды, отчёта и действия в напоминании, показывает только задачи
своей команды и сохраняет статусы по одной задаче или пакетом.

## Портал заказчика и Agent

Customer-only пользователь ограничен portal/agent API. Customer task list фильтруется backend. Диалоговый сбор требований выполняется отдельным Agent через backlog proxy; persisted `requirement_requests` проходят review workflow.

## Администрирование

Admin API обслуживает роли, пользователей, команды, справочники, проекты, теги, labels, display settings, templates и audit log. Фактические права задаются dependencies и role fields.

Справочники, пользователи, роли, состав и ответственные команд являются защищёнными данными и не изменяются в ходе документирования или автоматической проверки.

## Ошибки

Система использует FastAPI/Pydantic validation и явные `HTTPException`. Единой error envelope для всех endpoints не подтверждено. Для конкретного сценария источниками являются OpenAPI, router и тест.

## Нефункциональные свойства

Подтверждено:

- JWT access + server-side refresh sessions;
- audit/logging middleware;
- Redis/memory rate limiting;
- soft delete задач;
- optimistic version и locks;
- cross-worker idempotency для критичных изменяющих операций;
- transactional outbox, Redis Stream и авторизованный SSE;
- readiness, Prometheus-метрики и OpenTelemetry trace correlation;
- backend/frontend tests и CI quality workflow.

Не подтверждено как утверждённый контракт:

- SLA/SLO и latency percentiles;
- допустимое число пользователей или RPS;
- browser support matrix;
- RTO/RPO;
- production topology и disaster recovery.

Историческая смешанная спецификация сохранена в `archive/legacy/SYSTEM_SPEC_MIXED.md`.
