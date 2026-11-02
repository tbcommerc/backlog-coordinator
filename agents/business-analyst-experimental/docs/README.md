# Документация Assistant V2

Краткое описание сервиса, запуск, API верхнего уровня и границы находятся в
[`../README.md`](../README.md). Это изолированный fork V1; скопированные ниже V1-профили
служат baseline для совместимости, а текущие V2 границы описаны отдельно.

Ссылки FACT_STATE и QUALITY_MODEL исправлены 17.10.2026 на `agent_v2/`. Даты V1 baseline не означают повторную проверку V2. Исторические отчёты V1 хранятся в общем архиве `agents/business-analyst/docs/archive/`; 17.10.2026 удалены только побайтово идентичные копии. Активные baseline-профили V2 сохранены. Незакрытая приёмка: [единый список задач](../../../docs/OPEN_TASKS.md).

## Основные документы

| Задача | Документ |
|---|---|
| Архитектура, компоненты и поток обработки | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| HTTP API и интеграция с DMB Backend | [`API.md`](API.md) |
| Пилот, kill switch, запуск и откат | [`OPERATIONS.md`](OPERATIONS.md) |
| Изоляционные и регрессионные проверки | [`TESTING.md`](TESTING.md) |
| Продуктовая логика диалога | [`PRODUCT_DIALOGUE_SPEC.md`](PRODUCT_DIALOGUE_SPEC.md) |
| Сохранность фактов, операции, происхождение и память диалога | [`FACT_STATE.md`](FACT_STATE.md) |
| Критерии качества требований | [`QUALITY_MODEL.md`](QUALITY_MODEL.md) |
| Определение домена и пограничные запросы | [`DOMAIN_CLASSIFICATION.md`](DOMAIN_CLASSIFICATION.md) |
| Устройство и наполнение базы знаний | [`KB_GUIDE.md`](KB_GUIDE.md) |
| Подключение внешних RAG/DB-источников | [`KB_SOURCE_ADAPTERS.md`](KB_SOURCE_ADAPTERS.md) |
| V1 baseline развёртывания | [`DEPLOYMENT.md`](DEPLOYMENT.md) |

## Ревью и результаты проверок

| Назначение | Документ |
|---|---|
| Историческое ревью V1 от 21.08.2026 | [`FRONTEND_AI_ASSISTANT_REVIEW.md`](../../business-analyst/docs/archive/reviews/FRONTEND_AI_ASSISTANT_REVIEW.md) |
| Исторические результаты E2E-прогонов | [`archive/e2e/`](../../business-analyst/docs/archive/e2e) |
| Историческое описание legacy-оркестратора | [`archive/legacy/`](../../business-analyst/docs/archive/legacy) |

## Диаграммы

Скопированные V1 baseline-диаграммы находятся в [`diagrams/`](diagrams):

- `high_level_architecture_explained.puml` — подробная техническая AS-IS архитектура со статусами реализации;
- `ai_assistant_architecture_full.puml` — полная актуальная схема agentic runtime: у каждого компонента указаны реализация, назначение и связи;
- `high_level_architecture_business.puml` — компактная схема текущей архитектуры для нетехнической аудитории;
- `high_level_architecture.puml` — исходная расширенная схема, включающая legacy- и целевые компоненты;
- `component_architecture.puml` — компоненты;
- `message_flow.puml` — обработка сообщения;
- `state_machine.puml` — состояния диалога.

## Правило чтения

Не загружай всю документацию сразу. Начинай с `../README.md`, затем открывай один профильный документ. Исторические отчёты читай только при разборе конкретного E2E-прогона.

Навигатор и V2-профили проверены 19.09.2026; даты сверки остальных
активных документов указаны в самих документах. Каталоги `archive/` и файлы
`e2e_report_*` фиксируют исторический результат и не описывают текущее AS-IS.
