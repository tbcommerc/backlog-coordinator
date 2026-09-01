---
title: Матрица UX/UI-покрытия страниц DMB Platform
scope: target-dev-testing
status: draft-baseline
last_updated: 2026-08-25
catalog_reviewed: 2026-09-01
sources:
  - ../../dmb-backlog/docs/PAGE_LOGIC.md
  - MANUAL_UX_UI.md
---

# Матрица UX/UI-покрытия страниц

## 1. Назначение

Матрица определяет минимальную глубину ручной проверки страниц на DEV. Она не утверждает фактические права штатных ролей: перед прогоном владелец стенда должен сопоставить профили доступа подготовленным тестовым пользователям.

Обозначения:

- `FULL` — основной сценарий, состояния и responsive-поведение;
- `SMOKE` — открытие, базовая навигация, layout и отсутствие блокирующих ошибок;
- `VISUAL` — визуальная устойчивость без полного бизнес-сценария;
- `A11Y` — критический клавиатурный путь, focus и семантика;
- `N/A` — комбинация не входит в baseline;
- `OPEN` — требуется продуктовое решение.

## 2. Профили доступа

| Код | Профиль | Назначение в тестах |
|---|---|---|
| AP-01 | Обычный пользователь с доступом к общему backlog | Основные рабочие страницы и карточка задачи |
| AP-02 | Пользователь с доступом к командному backlog | Командная область и scoped actions |
| AP-03 | Бизнес-заказчик | Customer portal и создание требования через агента |
| AP-04 | Ревьюер | Очередь и detail отправленных требований |
| AP-05 | Пользователь с доступом к аналитике/отчётам | Отчёты и разрешённые analytics routes |
| AP-06 | Администратор | Admin и audit log без тестовых мутаций защищённых данных |
| AP-07 | Пользователь без доступа к целевой странице | Forbidden, redirect и отсутствие ложных действий |

Один штатный пользователь может соответствовать нескольким профилям. Точное соответствие фиксируется в паспорте DEV без изменения пользователей, ролей, команд и назначений.

## 3. Покрытие страниц

| Route/область | Профиль | Приоритет | Широкое окно VP-07/08 | Среднее VP-04–06 | Узкое VP-01–03 | Keyboard | Theme/zoom | Основной фокус |
|---|---|---:|---|---|---|---|---|---|
| Login | любой | P0 | FULL | SMOKE | FULL | A11Y | FULL | validation, ошибки, submit, overflow |
| App shell/sidebar | AP-01–06 | P0 | FULL | FULL | FULL | A11Y | FULL | desktop/icon/drawer, active route |
| `#/dashboard` | AP-01 | P2 | FULL | SMOKE | VISUAL | A11Y | SMOKE | cards, loading, empty, графики |
| `#/backlog` | AP-01 | P0 | FULL | FULL | SMOKE | A11Y | FULL | toolbar, filters, sticky table, task modal |
| `#/team-backlog` | AP-02 | P0 | FULL | FULL | SMOKE | A11Y | FULL | scope, sticky table, quick edit |
| Task modal/deep link | AP-01/02 | P0 | FULL | FULL | FULL | A11Y | FULL | tabs, scroll, edit, errors, conflict |
| `#/express-estimate` | пользователь с доступом | N/A | N/A | N/A | N/A | N/A | N/A | исключено из первого цикла |
| `#/kanban` | пользователь с доступом | N/A | N/A | N/A | N/A | N/A | N/A | исключено из первого цикла |
| `#/reports` | AP-05 | P1 | FULL | SMOKE | VISUAL | A11Y | FULL | filters, table/chart, empty/error |
| `#/reports/detail` | AP-05 | P1 | FULL | SMOKE | VISUAL | A11Y | FULL | deep link, long result, export actions |
| `#/analytics/tribe` | AP-05 | P2 | FULL | VISUAL | N/A | SMOKE | FULL | legends, tooltip, responsive charts |
| `#/analytics/po-pl` | AP-05 | P2 | FULL | VISUAL | N/A | SMOKE | FULL | legends, tooltip, responsive charts |
| `#/analytics/it` | AP-05 | P2 | FULL | VISUAL | N/A | SMOKE | FULL | legends, tooltip, responsive charts |
| `#/notifications` | AP-01–05 | P1 | FULL | SMOKE | FULL | A11Y | SMOKE | unread/read, empty, transition to object |
| `#/settings` | AP-01–06 | P1 | FULL | SMOKE | FULL | A11Y | FULL | theme, accent, compact, persistence |
| `#/admin` | AP-06 | P1 | FULL | SMOKE | OPEN | A11Y | FULL | tabs, sticky header, read-only checks |
| `#/audit-log` | AP-06 | P1 | FULL | SMOKE | VISUAL | A11Y | SMOKE | filters, long entries, read-only behavior |
| `#/customer` | AP-03 | P0 | FULL | FULL | FULL | A11Y | FULL | own records, empty state, create CTA |
| `#/customer/request/{id}` | AP-03 | P0 | FULL | FULL | FULL | A11Y | FULL | detail, status, long requirement |
| `#/customer/create` | AP-03 | P0 | FULL | FULL | FULL | A11Y | FULL | полный критический путь агента |
| `#/review` | AP-04 | P0 | FULL | FULL | SMOKE | A11Y | FULL | queue, statuses, empty/error |
| `#/review/{id}` | AP-04 | P0 | FULL | FULL | SMOKE | A11Y | FULL | requirement detail и доступные действия |
| Import modal в backlog | AP-02/разрешённый профиль | P1 | FULL | FULL | SMOKE | A11Y | FULL | CSV/XLS/XLSX, preview/result/errors |
| Forbidden/redirect | AP-07 | P0 | FULL | SMOKE | SMOKE | A11Y | SMOKE | отсутствие flash закрытого содержимого |
| 404/unknown route | любой | P2 | FULL | SMOKE | SMOKE | A11Y | SMOKE | понятное восстановление навигации |

## 4. Срезы обязательного прогона

### Критический P0-путь

1. Login и app shell.
2. Backlog или team backlog и task modal.
3. Customer portal.
4. Agent chat: новая сессия → диалог → драфт → редактирование → подтверждение → отправка.
5. Review queue и detail.
6. Forbidden/redirect пользователем без доступа.

Этот путь выполняется полностью на VP-01, VP-03, VP-04, VP-05 и VP-07. В узком desktop-окне для task/backlog допускается SMOKE, но agent и customer остаются `FULL`.

### Responsive smoke

На всех VP-01–VP-08 открыть:

- login;
- shell/sidebar;
- backlog;
- task modal;
- agent chat;
- review detail.

### Визуальные варианты

- dark: VP-05;
- light: VP-07;
- compact: VP-04 и VP-05;
- zoom 200%: login, shell, task modal, agent и review;
- reduced motion: shell, modal и agent typing/loading.

## 5. Обязательные состояния

| Состояние | Где обязательно проверить |
|---|---|
| Loading | dashboard, backlog, reports, agent, review |
| Empty | backlog, notifications, customer, session history, review |
| Error с повтором | backlog/report request, agent message, session history |
| Disabled | forms, agent send, confirm/send for review |
| Forbidden | admin, audit, review или другой реально закрытый route |
| Long content | task, table, notification, chat message, draft, review detail |
| Validation | login, task edit, draft edit, review confirmation |
| Concurrent/retry | task conflict и повтор agent/review action |
| Refresh/deep link | task, customer request, review detail, active agent session |

## 6. Критерий полноты матрицы

Матрица считается выполненной, когда для каждой обязательной ячейки есть ссылка на протокол, доказательство либо зарегистрированный дефект. `BLOCKED`, `N/A` и отклонение от baseline должны иметь причину и владельца решения.

## 7. Открытые решения

1. Сопоставить AP-01–AP-07 штатным тестовым пользователям DEV.
2. Определить минимальную поддерживаемую ширину окна: текущий baseline — 640 px.
3. Определить обязательность Admin в узком окне либо достаточно smoke.

Массовые операции подтверждены как расширенная проверка и не входят в обязательный первый цикл.
