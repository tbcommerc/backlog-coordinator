# Карта проекта DMB Platform

Проект состоит из двух самостоятельных сервисов:

- `dmb-backlog/` — система управления бэклогом: FastAPI backend и SPA на vanilla JavaScript.
- `agent/` — AI Business Analyst Assistant: отдельный FastAPI-сервис для диалогового сбора требований.

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

Запуск: из `dmb-backlog/backend/` выполнить `python -m uvicorn main:app --host 0.0.0.0 --port 8000`.

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

## Правила экономного исследования

1. Сначала определить, к какому из двух сервисов относится задача.
2. Читать только соответствующие точки входа и один профильный документ.
3. Расширять область поиска только при наличии конкретной зависимости.
4. Не читать без необходимости резервные копии БД, тестовые выгрузки, отчёты прошлых прогонов, библиотеки из `frontend/**/lib/` и референсные HTML-файлы.
5. Ограничения на изменения защищённых данных находятся в корневом `AGENTS.md`.
