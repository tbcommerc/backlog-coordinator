# Каталог агентов

Состав согласован пользователем 02.11.2026. Расположение и запуск сверены с кодом на эту дату. Статусы качества и ограничения следует смотреть в профильных документах.

| № | Продуктовое название | Ответственность | Код и документация |
|---|---|---|---|
| 1 | Агент бизнес-аналитик | Написание БТ через чат с заказчиком | [business-analyst](../agents/business-analyst/README.md), `agents/business-analyst/business_analyst/` |
| 2 | Агент бизнес-аналитик — экспериментальная версия | Экспериментальная версия первого: поручения, подготовка и ревью БТ | [business-analyst-experimental](../agents/business-analyst-experimental/README.md), `agents/business-analyst-experimental/business_analyst_experimental/` |
| 3 | Агент анализа расшифровок и извлечения задач | Извлечение предложений из текста встречи, проверка и подтверждение человеком | [Поручения из встреч](meeting-capture-agent.md), [API](../agents/business-analyst/business_analyst/api/router.py), [очередь](../dmb-backlog/backend/services/meeting_analysis.py), [gateway](../dmb-backlog/backend/routers/meeting_capture_router.py) |
| 4 | Агент-ассистент по бэклогу | Чат для поиска, чтения и анализа существующего бэклога | [backlog-assistant](../agents/backlog-assistant/README.md) |
| 5 | Агент оценки Value и Priority score | Оценка ценности и приоритета по методике; числа рассчитывает программное ядро | [value-priority-assessor](../agents/value-priority-assessor/README.md), [методика](../agents/value-priority-assessor/docs/METHODOLOGY.md) |

[Имена каталогов и Python-пакетов](../agents/README.md), [результаты переименования и запуска](AGENT_RENAMING_2026-11-02.md).

## Роли и сервисы

Это пять продуктовых ролей. Для роли № 3 добавлен [meeting-analyzer](../agents/meeting-analyzer/README.md) на порту 9500 с собственной PostgreSQL-очередью. DMB переключает новые задания через MEETING_ANALYZER_ENABLED; старые запуски сохраняют legacy backend V1. Проверка человеком предшествует сохранению поручений. [Полная приёмка миграции пока открыта](dev-testing/agent-services/IMPLEMENTATION.md).

V2 — экспериментальное развитие бизнес-аналитика, а не замена ассистенту по бэклогу. Роль № 4 работает с данными бэклога, роль № 5 отвечает за оценки. Наличие кода или включение в запуск не означает завершённую производственную приёмку.

## Запуск

Источник истины — [start-project.ps1](../scripts/start-project.ps1).

- Обычный запуск работает без агентных сервисов.
- `-IncludeAgents` явно включает бизнес-аналитика V1, meeting-analyzer и экспериментальный V2; помощник по бэклогу добавляется при наличии `agents/backlog-assistant/.env`.
- Task Prioritiser включается только отдельным флагом `-IncludeValuePriorityAssessor`.
- `-WithoutAgents` принудительно оставляет только основной контур и останавливает принадлежащие проекту агентские процессы.

[Полная инструкция](LOCAL_DEVELOPMENT.md) содержит требования к окружению и настройке провайдера модели. Этот каталог не изменяет параметры доступа и не включает сервисы самостоятельно.

## Удалённый прототип

Старый самостоятельный `assistant-v2` удалён из кода и запуска 02.11.2026 после [сравнения возможностей](AGENT_V2_RETIREMENT_2026-11-02.md). Исторические документы находятся в [архиве](archive/assistant-v2/README.md). Флаг `-IncludeAssistantV2`, старые API и конфигурация больше не поддерживаются.

Единственный экспериментальный бизнес-аналитик V2 — `agents/business-analyst-experimental/`. Старый адрес `#/assistant-v2` служит только перенаправлением на `#/agent-v2`.
