# DMB Platform

Платформа управления бэклогом задач и AI-ассистент для сбора бизнес-требований банковского подразделения DMB (Digital & Mobile Banking).

## Структура

| Папка | Описание |
|-------|----------|
| `agent/` | AI Business Analyst Assistant — FastAPI-сервис для диалогового сбора требований |
| `dmb-backlog/` | Система управления бэклогом — FastAPI backend + SPA frontend |
| `prioritiser-agent/` | Агент расчёта финансового эффекта и приоритета задач |

## Быстрый старт всей платформы

Штатный локальный запуск выполняется из корня на Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1
```

Сценарий поднимает PostgreSQL и Redis, применяет Alembic-миграции, создаёт два
изолированных Python-окружения и запускает три сервиса. После health-check:

- приложение и backend API: `http://127.0.0.1:8000`;
- AI Business Analyst API: `http://127.0.0.1:9000/docs`;
- Task Prioritiser API: `http://127.0.0.1:9100/docs`;
- логи: `.runtime/`.

Статус и остановка:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/project-status.ps1
powershell -ExecutionPolicy Bypass -File scripts/stop-project.ps1
```

Локально `LLM_PROVIDER=mock` допустим для health-check и детерминированных
тестов; полноценному агентному диалогу нужен доступный LLM. Для
реального OpenAI-compatible endpoint заполните `agent/.env` по
`agent/.env.example`; стартовый сценарий передаст те же параметры
prioritiser.

Отдельные команды запуска сервисов в их README предназначены для диагностики.
Полная инструкция и требования Docker находятся в
[docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md).

## Документация

- [Agent README](agent/README.md) — API, архитектура, структура
- [DMB Backlog README](dmb-backlog/README.md) — полная документация Backend + Frontend
- [Карта документации](docs/index.md) — актуальные документы и источники истины
- [Task Prioritiser README](prioritiser-agent/README.md) — методика, API и агентный слой
- [Prioritiser upstream](prioritiser-agent/UPSTREAM.md) — источник и версия интегрированного агента
- [Локальный запуск всей платформы](docs/LOCAL_DEVELOPMENT.md) — единый сценарий для трёх сервисов
- [Production runbook](docs/PRODUCTION_RUNBOOK.md) — многорепличный стенд, smoke, observability и backup

Документация сверена с текущим рабочим деревом 01.09.2026. Исторические отчёты
и материалы в каталогах `archive/` не переписываются при актуализации AS-IS.
