# Карта проекта DMB Platform

> Статус: активная карта AS-IS, сверена с рабочим деревом 01.09.2026.

Проект состоит из трёх самостоятельных сервисов:

- `dmb-backlog/` — система управления бэклогом: FastAPI backend и SPA на vanilla JavaScript.
- `agent/` — AI Business Analyst Assistant: отдельный FastAPI-сервис для диалогового сбора требований.
- `prioritiser-agent/` — агент расчёта финансового эффекта и приоритета задач.

Полный локальный запуск всей платформы описан в `docs/LOCAL_DEVELOPMENT.md`.
Из корня используется `powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1`.
Проверки перед многопользовательским стендом собраны в `docs/MULTIUSER_ROLLOUT.md`.
Воспроизводимая production-топология и операторские команды описаны в
`docs/PRODUCTION_RUNBOOK.md`.

## DMB Backlog

Основные точки входа:

- `dmb-backlog/backend/main.py` — запуск backend, подключение middleware и роутеров.
- `dmb-backlog/backend/models.py` — SQLAlchemy-модели и источник схемы БД.
- `dmb-backlog/backend/schemas.py` — Pydantic-схемы API.
- `dmb-backlog/backend/database.py` — подключение и обслуживание БД.
- `dmb-backlog/backend/routers/` — API по функциональным областям.
- `dmb-backlog/frontend/index.html` — оболочка SPA.
- `dmb-backlog/frontend/js/app.js` — инициализация frontend.
- `dmb-backlog/frontend/js/components/` — страницы и UI-компоненты.
- `dmb-backlog/frontend/css/` — дизайн-токены и стили.

Тесты:

- `dmb-backlog/backend/tests/` — pytest.
- `dmb-backlog/frontend/tests/` — Node.js-тесты frontend.

Документацию выбирай по задаче:

- `dmb-backlog/docs/README.md` — навигатор, классификация документов и правила доказательности.
- `dmb-backlog/docs/PROJECT_OVERVIEW_AS_IS.md` — фактически реализованная система.
- `dmb-backlog/docs/ARCHITECTURE.md` — архитектура.
- `dmb-backlog/docs/API_SPEC.md` — API.
- `dmb-backlog/docs/DATA_MODEL.md` — модель данных.
- `dmb-backlog/docs/PAGE_LOGIC.md` — логика страниц.
- `dmb-backlog/docs/DESIGN_SYSTEM.md` — визуальные правила.
- `dmb-backlog/docs/TESTING.md` — тестирование.
- `dmb-backlog/docs/SCHEMA_CHANGES.md` — изменение схемы БД.

Штатный локальный запуск выполняется единым корневым сценарием; отдельный запуск backend оставлен только для диагностики.

## AI Business Analyst Assistant

Основные точки входа:

- `agent/run.py` — запуск сервиса на порту 9000.
- `agent/agent/main.py` — приложение и API агента.
- `agent/agent/agentic_orchestrator.py` — оркестрация диалога.
- `agent/agent/prompts/system_prompt.md` — системный промпт.
- `agent/agent/workflow/` — этапы workflow.
- `agent/agent/tools/` — инструменты агента.
- `agent/kb_seed/` — исходные материалы базы знаний.
- `agent/agent/tests/` — pytest.

Документация:

- `agent/docs/ARCHITECTURE.md` — архитектура сервиса.
- `agent/docs/API.md` — API.
- `agent/docs/KB_GUIDE.md` — база знаний.
- `agent/docs/PRODUCT_DIALOGUE_SPEC.md` — логика диалога.
- `agent/docs/QUALITY_MODEL.md` — модель качества.

## Task Prioritiser

Основные точки входа:

- `prioritiser-agent/app/api/main.py` — FastAPI-приложение на порту 9100.
- `prioritiser-agent/app/api/contract.py` — входной и выходной контракт агента.
- `prioritiser-agent/app/service/scenarios.py` — идемпотентные сценарии запрос-ответ для Координатора.
- `prioritiser-agent/app/core/value.py` — расчёт финансового эффекта.
- `prioritiser-agent/app/core/scoring.py` — расчёт факторов и приоритета P1–P5.
- `prioritiser-agent/app/cli.py` — CLI детерминированного ядра.
- `prioritiser-agent/AGENTS.md` и `agent-prompts/` — контракт и промпты агентного слоя.
- `prioritiser-agent/UPSTREAM.md` — источник и зафиксированная версия внешнего проекта.
- `prioritiser-agent/graphify-out/` — локальный граф знаний по коду агента; каталог не включается в Git.

## Тестирование на DEV-стенде

- `docs/dev-testing/README.md` — программа и состав материалов по испытаниям на DEV.
- `docs/dev-testing/MANUAL_UX_UI.md` — план ручного UX/UI-тестирования системы и интерфейса AI-агента.
- `docs/dev-testing/AGENT_UX_TEST_CASES.md` — подробные ручные тест-кейсы критического пути AI-агента.
- `docs/dev-testing/PAGE_COVERAGE_MATRIX.md` — матрица UX/UI-покрытия страниц, экранов и профилей доступа.
- `docs/dev-testing/TEST_DATA_PASSPORT.md` — паспорт и правила подготовки тестовых данных.
- `docs/dev-testing/DEPLOYMENT_SMOKE.md` — smoke-проверка после развёртывания на DEV.
- `docs/dev-testing/AGENT_GOLDEN_DATASET.md` — эталонные сценарии содержательной проверки агента.
- `docs/dev-testing/AGENT_EVALUATION_PROTOCOL.md` — методика оценки и сравнения прогонов агента.
- `docs/dev-testing/ACCESS_TEST_MATRIX.md` — функциональная матрица проверки доступа.
- `docs/dev-testing/DEFECT_TEMPLATE.md` — шаблон и правила регистрации дефектов.
- `docs/dev-testing/TEST_SUMMARY_REPORT_TEMPLATE.md` — шаблон итогового отчёта и решения Go/No-Go.
- `docs/dev-testing/DEV_ENVIRONMENT_PASSPORT.md` — паспорт конфигурации и топологии DEV-стенда.
- `docs/dev-testing/INTEGRATION_RESILIENCE.md` — интеграционные, негативные и отказные сценарии.
- `docs/dev-testing/PERFORMANCE_TESTING.md` — программа нагрузочных испытаний.
- `docs/dev-testing/BACKUP_RESTORE_TESTING.md` — программа проверки резервного копирования и восстановления.
- `docs/dev-testing/USER_SCENARIOS_PROPOSAL.md` — предложенный перечень пользовательских сценариев для утверждения.
- `docs/dev-testing/IMPORT_TEST_CASES.md` — обязательные ручные сценарии импорта CSV/XLS/XLSX.
- `docs/dev-testing/MASTER_TEST_PLAN.md` — сводный порядок подготовки и проведения тестового цикла.
- `docs/dev-testing/TRACEABILITY_MATRIX.md` — связь пользовательских сценариев, проверок и доказательств.
- `docs/dev-testing/PRE_DEPLOYMENT_HANDOFF.md` — чек-лист готовности пакета перед передачей DevOps.
- `docs/dev-testing/PRODUCT_UAT_SESSION.md` — сценарий пользовательской приёмки владельцем продукта.
- `docs/dev-testing/UX_UI_RUN_TEMPLATE.md` — шаблон протокола ручного прогона.

Исторические E2E-отчёты сохраняют дату и результаты конкретного прогона и не
актуализируются как описание текущей реализации. `graphify-out/`, локальные
экспорты и прототипы также не являются пользовательской документацией.

## Правила экономного исследования

1. Сначала определить, к какому из трёх сервисов относится задача.
2. Читать только соответствующие точки входа и один профильный документ.
3. Расширять область поиска только при наличии конкретной зависимости.
4. Не читать без необходимости резервные копии БД, тестовые выгрузки, отчёты прошлых прогонов, библиотеки из `frontend/**/lib/` и референсные HTML-файлы.
5. Ограничения на изменения защищённых данных находятся в корневом `AGENTS.md`.
