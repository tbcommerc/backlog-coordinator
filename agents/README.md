# Агенты Backlog Coordinator

Имена каталогов отражают роли. Состав согласован и пути обновлены 02.11.2026.

| Роль | Каталог | Python-пакет |
|---|---|---|
| Бизнес-аналитик: написание БТ через чат | [business-analyst](business-analyst/README.md) | `business_analyst` |
| Бизнес-аналитик: экспериментальная версия | [business-analyst-experimental](business-analyst-experimental/README.md) | `business_analyst_experimental` |
| Разбор расшифровок и извлечение задач | Модуль [meeting_task_extractor.py](business-analyst/business_analyst/meeting_task_extractor.py) в сервисе бизнес-аналитика | `business_analyst.meeting_task_extractor` |
| Ассистент по бэклогу | [backlog-assistant](backlog-assistant/README.md) | `backlog_assistant`; служебные `runtime`, `bridge`, `contracts` |
| Оценка Value и Priority score | [value-priority-assessor](value-priority-assessor/README.md) | `value_priority_assessor` |

Пять ролей используют четыре сервиса. Разбор расшифровок не выделяется в отдельный процесс.

## Запуск

Из корня репозитория: `powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1`.

Оценщик по умолчанию выключен; его включает `-IncludeValuePriorityAssessor` (старый псевдоним `-IncludePrioritiser` сохранён). Экспериментальный бизнес-аналитик входит в обычный запуск; новый флаг `-IncludeBusinessAnalystExperimental` имеет прежнюю семантику `-IncludeAgentV2`. Для отключения всех агентных сервисов используется `-WithoutAgents`.

Публичные API, URL страниц, переменные окружения `AGENT_*`, `AGENT_V2_*`, `PRIORITISER_*`, имена БД и внутренних Docker-сервисов сохранены для совместимости. В частности, экспериментальная страница по-прежнему открывается по `#/agent-v2`. Существующие локальные окружения `.venv`, `.venv-agent-v2`, `.venv-prioritiser` остаются в корне; окружение ассистента находится внутри `agents/backlog-assistant/.venv`.

[Подробный каталог ролей](../docs/AGENT_CATALOG.md), [локальный запуск](../docs/LOCAL_DEVELOPMENT.md).
