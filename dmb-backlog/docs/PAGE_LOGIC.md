---
title: Логика страниц DMB Backlog
scope: as-is
status: verified-index
last_verified: 2026-08-24
source_of_truth:
  - frontend/js/router.js
  - frontend/js/components/
---

# Логика страниц DMB Backlog

Документ является проверенным навигатором по страницам. Детальное поведение каждого элемента определяется соответствующим JS-компонентом и его тестами; оно не дублируется здесь вручную.

## Маршрутизация

SPA использует hash routes. Маршрут по умолчанию — `/dashboard`.

| Route | Render/init компонент | Назначение AS-IS |
|---|---|---|
| `#/dashboard` | `dashboard.js` | сводная страница |
| `#/backlog` | `taskTable.js` | общий backlog |
| `#/team-backlog` | `teamBacklog.js` | командный backlog |
| `#/express-estimate` | `expressEstimate.js` | экспресс-оценка |
| `#/kanban` | `kanbanBoard.js` | Kanban по статусам |
| `#/reports` | `reports.js` | список/страница отчётов |
| `#/reports/detail` | `reports.js` | detail отчёта |
| `#/analytics/tribe` | `analytics.js` | аналитика tribe |
| `#/analytics/po-pl` | `analytics.js` | аналитика PO/PL |
| `#/analytics/it` | `analytics.js` | аналитика IT |
| `#/notifications` | `notifications.js` | уведомления |
| `#/settings` | `settings.js` | пользовательские настройки UI |
| `#/admin` | `admin.js` | администрирование |
| `#/audit-log` | `auditLog.js` | журнал действий |
| `#/customer` | `customerPortal.js` | задачи бизнес-заказчика |
| `#/customer/create` | `agentChat.js` | диалог с AI Agent |
| `#/review` | `reviewPage.js` | очередь review requests |

Динамические маршруты:

- `#/customer/request/{id}`;
- `#/review/{id}`.

На страницах задач deep link поддерживает query `task={id}` и необязательный `tab={name}`.

## Ограничения навигации

- Customer portal only пользователь перенаправляется на `/customer`, если открывает другой статический route.
- `/admin` и `/audit-log` показывают forbidden state при `admin=none`.
- Перед сменой маршрута `onBeforeNavigate` может остановить переход, например при несохранённых изменениях.
- Эти клиентские проверки улучшают UX, но безопасность обеспечивают backend dependencies.

## Общая модель страницы

Router вызывает `render(app)`, вставляет HTML в `#page-content`, активирует Lucide icons и затем вызывает `init(app)`. Компоненты самостоятельно загружают данные, привязывают события и управляют loading/error/empty состояниями.

Нет единого формального контракта состояний для всех страниц. Для конкретной страницы проверяй её `render*`, `init*`, API calls и профильные frontend tests.

## Карточка задачи

Карточка открывается через событие `open-task` и поддерживает deep link. Реализованы просмотр, редактирование, вкладки, version conflict UI, комментарии, вложения и связанные данные. Точный состав полей зависит от response schema, labels и пользовательских прав.

Нельзя считать поле доступным или редактируемым только потому, что оно существует в модели: проверяются component rendering, permissions и request payload.

## Backlog и team backlog

Обе страницы используют общий `filterToolbar.js`, quick filters, table utilities, quick edit и sticky table header. Отличия области данных и разрешений находятся в `taskTable.js`, `teamBacklog.js` и backend task scope.

## Kanban

Kanban отображает 13 колонок и обновляет `status_id` через task PUT. Универсальная backend state machine разрешённых переходов не подтверждена; drag-and-drop не следует документировать как формальное бизнес-правило перехода.

## Admin

Admin объединяет несколько вкладок и API справочников/пользователей/ролей/команд. Реальная доступность действий определяется backend. Защищённые данные не используются для тестовых мутаций документации.

## Customer и review

Customer portal получает задачи текущего заказчика. Создание требования выполняется через Agent chat. Review routes работают с persisted `requirement_requests` и требуют отдельного review access.

## UI-безопасность

Компоненты используют `innerHTML`; недоверенные значения должны проходить `escapeHtml`, `escapeHtmlAttribute`, URL validation или безопасное DOM assignment. Правила и ограничения описаны в `SECURITY.md`.

## Как документировать изменение страницы

1. Сверить route и component.
2. Зафиксировать фактические API calls.
3. Проверить permissions и object scope.
4. Проверить loading, empty, error, conflict и success состояния, которые реально существуют в коде.
5. Добавить/обновить frontend test.
6. Не придумывать альтернативные сценарии, если они не реализованы и не утверждены.

Историческое подробное описание сохранено в `archive/legacy/PAGE_LOGIC_STALE_2026-07-25.md`.
