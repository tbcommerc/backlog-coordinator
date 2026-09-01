---
title: Программа тестирования DMB Platform на DEV
scope: target-dev-testing
status: draft
last_updated: 2026-09-01
---

# Тестирование DMB Platform на DEV-стенде

Раздел содержит целевую программу испытаний DMB Backlog, AI Business Analyst
Agent и Task Prioritiser после развёртывания на DEV. Программа учитывает
PostgreSQL/Redis, readiness, SSE/outbox и observability. Это рабочий план, а не
описание уже выполненных проверок; датированные отчёты остаются историческими.

## Документы

| Документ | Назначение | Статус |
|---|---|---|
| [`MANUAL_UX_UI.md`](MANUAL_UX_UI.md) | Область, матрица и сценарии ручного UX/UI-тестирования | Черновик baseline |
| [`AGENT_UX_TEST_CASES.md`](AGENT_UX_TEST_CASES.md) | Подробные тест-кейсы критического пути AI-агента | Готовы к первому прогону |
| [`PAGE_COVERAGE_MATRIX.md`](PAGE_COVERAGE_MATRIX.md) | План покрытия страниц по профилям доступа, viewport и видам проверки | Черновик baseline |
| [`TEST_DATA_PASSPORT.md`](TEST_DATA_PASSPORT.md) | Состав, владельцы и правила использования тестовых данных | Готов к заполнению |
| [`DEPLOYMENT_SMOKE.md`](DEPLOYMENT_SMOKE.md) | Проверки после первичного развёртывания и каждого обновления DEV | Готов к первому прогону |
| [`AGENT_GOLDEN_DATASET.md`](AGENT_GOLDEN_DATASET.md) | Эталонные диалоги и обязательные инварианты агента | Baseline v1 |
| [`AGENT_EVALUATION_PROTOCOL.md`](AGENT_EVALUATION_PROTOCOL.md) | Оценка качества, повторяемости и регрессии агента | Готов к применению |
| [`ACCESS_TEST_MATRIX.md`](ACCESS_TEST_MATRIX.md) | Проверка page/action/object scope по профилям доступа | Готова к заполнению |
| [`DEFECT_TEMPLATE.md`](DEFECT_TEMPLATE.md) | Единый формат регистрации и приоритизации дефектов | Готов к использованию |
| [`TEST_SUMMARY_REPORT_TEMPLATE.md`](TEST_SUMMARY_REPORT_TEMPLATE.md) | Итог тестового цикла и решение Go/No-Go | Готов к заполнению |
| [`DEV_ENVIRONMENT_PASSPORT.md`](DEV_ENVIRONMENT_PASSPORT.md) | Фактическая топология, версии и эксплуатационная конфигурация DEV | Готов к заполнению |
| [`INTEGRATION_RESILIENCE.md`](INTEGRATION_RESILIENCE.md) | Ошибки зависимостей, повторы, restart и восстановление функций | Готов к согласованию с DevOps |
| [`PERFORMANCE_TESTING.md`](PERFORMANCE_TESTING.md) | Профили, метрики и этапы нагрузочного тестирования | Черновик baseline |
| [`BACKUP_RESTORE_TESTING.md`](BACKUP_RESTORE_TESTING.md) | Проверка backup, restore и целостности связанных данных | Готов к согласованию с DevOps |
| [`USER_SCENARIOS_PROPOSAL.md`](USER_SCENARIOS_PROPOSAL.md) | Приоритетный перечень пользовательских сценариев | Предварительно утверждён |
| [`IMPORT_TEST_CASES.md`](IMPORT_TEST_CASES.md) | Ручные проверки обязательного сценария импорта | Готовы к первому прогону |
| [`MASTER_TEST_PLAN.md`](MASTER_TEST_PLAN.md) | Этапы, gates, зависимости и порядок выполнения программы | Готов к планированию цикла |
| [`TRACEABILITY_MATRIX.md`](TRACEABILITY_MATRIX.md) | Связь US, тестов, evidence и критерия выхода | Baseline v1 |
| [`PRE_DEPLOYMENT_HANDOFF.md`](PRE_DEPLOYMENT_HANDOFF.md) | Что подготовить до передачи пакета DevOps | Готов к заполнению |
| [`PRODUCT_UAT_SESSION.md`](PRODUCT_UAT_SESSION.md) | Модерируемая бизнес-приёмка агента владельцем продукта | Готов к проведению |
| [`UX_UI_RUN_TEMPLATE.md`](UX_UI_RUN_TEMPLATE.md) | Протокол отдельного ручного прогона | Готов к использованию |

Существующие автоматизированные наборы и безопасные команды запуска описаны в [`../../dmb-backlog/docs/TESTING.md`](../../dmb-backlog/docs/TESTING.md). Качество содержательной работы агента описывается отдельно в [`../../agent/docs/QUALITY_MODEL.md`](../../agent/docs/QUALITY_MODEL.md).

## План развития раздела

До начала полного цикла требуется заполнить и утвердить:

1. паспорт DEV-стенда;
2. сопоставление профилей доступа штатным ролям DEV;
3. пороги качества после baseline-прогона агента;
4. целевые SLA/нагрузочный профиль;
5. RPO/RTO, retention и владельцев backup/restore.

## Правила тестовых данных

В общей DEV-БД запрещено создавать, изменять или удалять пользователей, роли, справочники, состав команд, назначения пользователей и защищённые атрибуты команд (`PO`, `PL`, `CL` и аналоги). Нужные тестовые профили и эталонные справочники должны быть подготовлены уполномоченным владельцем стенда.

Обычные тестовые задачи, комментарии, вложения, диалоги и черновики требований допускается изменять только в выделенной тестовой области и по согласованным правилам очистки.
