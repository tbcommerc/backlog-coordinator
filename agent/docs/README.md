# Документация AI Business Analyst Agent

Краткое описание сервиса, запуск, API верхнего уровня и структура кода находятся в [`../README.md`](../README.md). Здесь собраны профильные документы; выбирай только документ, относящийся к текущей задаче.

## Основные документы

| Задача | Документ |
|---|---|
| Архитектура, компоненты и поток обработки | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| HTTP API и интеграция с DMB Backend | [`API.md`](API.md) |
| Продуктовая логика диалога | [`PRODUCT_DIALOGUE_SPEC.md`](PRODUCT_DIALOGUE_SPEC.md) |
| Критерии качества требований | [`QUALITY_MODEL.md`](QUALITY_MODEL.md) |
| Определение домена и пограничные запросы | [`DOMAIN_CLASSIFICATION.md`](DOMAIN_CLASSIFICATION.md) |
| Устройство и наполнение базы знаний | [`KB_GUIDE.md`](KB_GUIDE.md) |
| Подключение внешних RAG/DB-источников | [`KB_SOURCE_ADAPTERS.md`](KB_SOURCE_ADAPTERS.md) |
| Развёртывание и эксплуатация | [`DEPLOYMENT.md`](DEPLOYMENT.md) |

## Ревью и результаты проверок

| Назначение | Документ |
|---|---|
| Ревью интерфейса ассистента | [`FRONTEND_AI_ASSISTANT_REVIEW.md`](FRONTEND_AI_ASSISTANT_REVIEW.md) |
| Исторические результаты E2E-прогонов | [`archive/e2e/`](archive/e2e/) |
| Историческое описание legacy-оркестратора | [`archive/legacy/`](archive/legacy/) |

## Диаграммы

Исходники PlantUML находятся в [`diagrams/`](diagrams/):

- `high_level_architecture_explained.puml` — подробная техническая AS-IS архитектура со статусами реализации;
- `ai_assistant_architecture_full.puml` — полная актуальная схема agentic runtime: у каждого компонента указаны реализация, назначение и связи;
- `high_level_architecture_business.puml` — компактная схема текущей архитектуры для нетехнической аудитории;
- `high_level_architecture.puml` — исходная расширенная схема, включающая legacy- и целевые компоненты;
- `component_architecture.puml` — компоненты;
- `message_flow.puml` — обработка сообщения;
- `state_machine.puml` — состояния диалога.

## Правило чтения

Не загружай всю документацию сразу. Начинай с `../README.md`, затем открывай один профильный документ. Исторические отчёты читай только при разборе конкретного E2E-прогона.

Активные документы сверены с кодом 01.09.2026. Каталоги `archive/` и файлы
`e2e_report_*` фиксируют исторический результат и не описывают текущее AS-IS.
