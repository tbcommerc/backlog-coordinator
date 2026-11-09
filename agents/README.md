# Агенты Backlog Coordinator

Имена каталогов отражают роли. Состав согласован и пути обновлены 02.11.2026.

| Роль | Каталог | Python-пакет |
|---|---|---|
| Бизнес-аналитик: написание БТ через чат | [business-analyst](business-analyst/README.md) | `business_analyst` |
| Бизнес-аналитик: экспериментальная версия | [business-analyst-experimental](business-analyst-experimental/README.md) | `business_analyst_experimental` |
| Разбор расшифровок и извлечение задач | [meeting-analyzer](meeting-analyzer/README.md), legacy-совместимость в V1 | `meeting_analyzer` |
| Ассистент по бэклогу | [backlog-assistant](backlog-assistant/README.md) | `backlog_assistant`; служебные `runtime`, `bridge`, `contracts` |
| Оценка Value и Priority score | [value-priority-assessor](value-priority-assessor/README.md) | `value_priority_assessor` |

Пять ролей имеют пять сервисных каталогов. Новый meeting-analyzer работает независимо; legacy-вызов V1 сохранён для дренирования прежних запусков. Полная миграция пяти сервисов ещё не принята; [фактический статус](../docs/dev-testing/agent-services/IMPLEMENTATION.md).

## Запуск

Из корня репозитория: `powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1`.

Оценщик по умолчанию выключен; его включает `-IncludeValuePriorityAssessor` (старый псевдоним `-IncludePrioritiser` сохранён). Экспериментальный бизнес-аналитик входит в обычный запуск; новый флаг `-IncludeBusinessAnalystExperimental` имеет прежнюю семантику `-IncludeAgentV2`. Для отключения всех агентных сервисов используется `-WithoutAgents`.

Публичные API, URL страниц, переменные окружения `AGENT_*`, `AGENT_V2_*`, `PRIORITISER_*`, имена БД и внутренних Docker-сервисов сохранены для совместимости. В частности, экспериментальная страница по-прежнему открывается по `#/agent-v2`. Существующие локальные окружения `.venv`, `.venv-agent-v2`, `.venv-prioritiser` остаются в корне; окружение ассистента находится внутри `agents/backlog-assistant/.venv`.

[Подробный каталог ролей](../docs/AGENT_CATALOG.md), [локальный запуск](../docs/LOCAL_DEVELOPMENT.md).

[Конфигурация, aliases, SDK и владение процессами](CONFIGURATION.md) — проверено 05.11.2026; SDK 1.4.1, поддерживаемая совместимость и открытые части qualification.

Экспорт фактического OpenAPI пяти сервисов (проверено 04.11.2026):
`python scripts/export-agent-openapi.py`; проверка снимков без записи —
`python scripts/export-agent-openapi.py --check`. Каждый импорт изолирован
в собственном окружении; lifespan, БД и модель не вызываются. Снимки находятся
в `contracts/agent.openapi.json` соответствующего сервиса.

## Изолированная проверка образов — 05.11.2026

После сборки образы проверяются без source mounts и установки пакетов при запуске.
Для disposable PostgreSQL `dmb-agent-qualification` и Redis
`dmb-agent-gate-qualification` доступны сценарии:

- `scripts/qualify-v1-container.py`: HTTP chat, настоящий worker, история и идемпотентность; фиксированная модельная fixture.
- `scripts/qualify-v2-container.py`: HTTP document review, два штатных модельных шага на fixture, неизменность документа и запрет автоматического утверждения.
- `scripts/qualify-meeting-container.py`: HTTP/worker и синтетический Go transport.
- `scripts/qualify-assessor-container.py`: явно лёгкий профиль без RAG/аналогии; нехватка входных данных не подменяется расчётом.
- `scripts/qualify-backlog-container.py`: настоящий mTLS и подписанные запросы, worker и повторная авторизация истории; DataPort/runtime — явные fixtures в памяти.

Из корня: `python scripts/qualify-v1-container.py --image <immutable-image-id> --postgres-container-id <full-id> --redis-container-id <full-id> --output .runtime/<new-evidence-dir>/manifest.json`.
Остальные команды принимают те же параметры. Нужны готовые изолированные
контейнеры, рабочие БД не используются; прежний evidence не перезаписывается.
Для генерации одноразового mTLS-сертификата BKL host-интерпретатору нужен
`cryptography`; PEM передаётся по stdin, хранится только в tmpfs контейнера.
Docker socket и ключ провайдера этим сценарием не передаются.
Эти проверки не доказывают production Compose, тяжёлый контейнерный профиль VPA
или физическую изоляцию модельного runtime BKL. Полный offline-корпус запускается
`python scripts/replay-agent-corpus-offline.py --output .runtime/<new-corpus-dir>`.

## Изолированная проверка образов — 05.11.2026

После сборки образы проверяются без source mounts и установки пакетов при запуске.
Для disposable PostgreSQL `dmb-agent-qualification` и Redis
`dmb-agent-gate-qualification` доступны сценарии:

- `scripts/qualify-v1-container.py`: HTTP chat, настоящий worker, история и идемпотентность; фиксированная модельная fixture.
- `scripts/qualify-v2-container.py`: HTTP document review, два штатных модельных шага на fixture, неизменность документа и запрет автоматического утверждения.
- `scripts/qualify-meeting-container.py`: HTTP/worker и синтетический Go transport.
- `scripts/qualify-assessor-container.py`: явно лёгкий профиль без RAG/аналогии; нехватка входных данных не подменяется расчётом.
- `scripts/qualify-backlog-container.py`: настоящий mTLS и подписанные запросы, worker и повторная авторизация истории; DataPort/runtime — явные fixtures в памяти.

Из корня: `python scripts/qualify-v1-container.py --image <immutable-image-id> --postgres-container-id <full-id> --redis-container-id <full-id> --output .runtime/<new-evidence-dir>/manifest.json`.
Остальные команды принимают те же параметры. Нужны готовые изолированные
контейнеры, рабочие БД не используются; прежний evidence не перезаписывается.
Для генерации одноразового mTLS-сертификата BKL host-интерпретатору нужен
`cryptography`; PEM передаётся по stdin, хранится только в tmpfs контейнера.
Docker socket и ключ провайдера этим сценарием не передаются.
Эти проверки не доказывают production Compose, тяжёлый контейнерный профиль VPA
или физическую изоляцию модельного runtime BKL. Полный offline-корпус запускается
`python scripts/replay-agent-corpus-offline.py --output .runtime/<new-corpus-dir>`.
