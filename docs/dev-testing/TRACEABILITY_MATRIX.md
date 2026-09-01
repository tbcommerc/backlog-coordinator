---
title: Матрица трассировки тестирования
scope: target-dev-testing
status: baseline-v1
last_updated: 2026-08-25
catalog_reviewed: 2026-09-01
---

# Матрица трассировки

Матрица показывает, чем подтверждается каждый пользовательский сценарий. В колонке Evidence при реальном цикле указывается ссылка на протокол, defect или отчёт.

| US | Приоритет/область | Основной документ/кейсы | Дополнительная проверка | Evidence | Exit |
|---|---|---|---|---|---|
| US-01 Auth | P0 | DS-301–307 | AC-01–06, UX-SHELL-01 | | PASS |
| US-02 Просмотр backlog | P0 | UX-BACKLOG-01 | page matrix, access scope | | PASS |
| US-03 Изменение задачи | P0 | UX-TASK-01 | DS-501–503, task access | | PASS |
| US-04 Создание требования | P0 | TC-AUX-001–003 | GD-01/02 | | PASS |
| US-05 Исправление агента | P0 | TC-AUX-004 | GD-07 | | PASS |
| US-06 Драфт/редактирование | P0 | TC-AUX-007/008 | GD-08/09/10 | | PASS |
| US-07 Отправка | P0 | TC-AUX-009 | IR-12, agent access | | PASS |
| US-08 Review | P0 | UX-REVIEW-01 | AP-04 object scope | | PASS |
| US-09 Размер окна | P0 | TC-AUX-012 | VP-01–08, UX-AGENT-03 | | PASS |
| US-10 Ошибка/retry | P0 | TC-AUX-010 | IR-01/03/04/05 | | PASS |
| US-11 Сессии/архив | P1 | TC-AUX-006 | agent isolation | | PASS |
| US-12 Комментарий/файл | P1 | UX-TASK-01 | DS-504–506, IR-08/09 | | PASS |
| US-13 Уведомления | P1 | PAGE_COVERAGE_MATRIX | IR-15/scheduler | | PASS |
| US-14 Отчёты | P1 | PAGE_COVERAGE_MATRIX | PF-04 при нагрузке | | PASS |
| US-15 Доступ | P1, hard invariant | ACCESS_TEST_MATRIX | GD-15, AC-01–06 | | PASS 100% |
| US-16 Конфликт | P1 | UX-TASK-01 + TD-TASK-04 | task conflict tests | | PASS |
| US-17 Настройки | P1 | UX-VISUAL-01 | theme/compact persistence | | PASS |
| US-18 Keyboard/200% | P1 | UX-A11Y-01, TC-AUX-011 | import TC-IMP-15 | | PASS |
| US-21 Bulk | extended | ACCESS_TEST_MATRIX/PF-03 | отдельный протокол | | optional |
| US-22 Import | P1 mandatory | TC-IMP-01–15 | import backend regression | | PASS |
| US-23 Admin/audit | extended read-only | page/access matrix | audit evidence | | optional |
| US-24 Long data | extended | TC-AUX-005 | VP/window matrix | | optional |

Отдельные технические требования:

| Requirement | Проверка | Evidence | Exit |
|---|---|---|---|
| Версия/топология известны | DEV_ENVIRONMENT_PASSPORT, DS-001 | | PASS |
| Startup seed выключен | DS-003 | | PASS |
| Persistency после restart | DS-601–607 | | PASS |
| LLM fail-closed | GD-14, IR-04/05 | | PASS |
| Backup/restore | BR-01–08 | | agreed scope |
| Performance baseline | PF-01–09 | | agreed scope |
| Protected data untouched | TEST_DATA_PASSPORT/journal | | PASS |

Правило закрытия: обязательная строка не закрывается без evidence; `BLOCKED` переносится в Test Summary как риск.
