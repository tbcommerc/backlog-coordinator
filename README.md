# Backlog Coordinator

Платформа управления бэклогом DMB (Digital Merchant Banking) и пять агентов для работы с требованиями, встречами и приоритетами.

[Все реализации находятся в `agents/`](agents/README.md).

## Пять агентов

| Агент | Назначение | Реализация |
|---|---|---|
| Бизнес-аналитик | Написание бизнес-требований (БТ) через чат с заказчиком | [agents/business-analyst/](agents/business-analyst/README.md) |
| Бизнес-аналитик — экспериментальная версия | Экспериментальная версия первого агента | [agents/business-analyst-experimental/](agents/business-analyst-experimental/README.md) |
| Анализ расшифровок и извлечение задач | Предложения задач из текста встречи с проверкой человеком | [Модуль встреч](docs/meeting-capture-agent.md) внутри `agents/business-analyst/` и `dmb-backlog/` |
| Ассистент по бэклогу | Поиск, чтение и анализ данных бэклога через чат | [agents/backlog-assistant/](agents/backlog-assistant/README.md) |
| Оценка Value и Priority score | Оценка ценности и расчёт приоритета задач | [agents/value-priority-assessor/](agents/value-priority-assessor/README.md) |

[Каталог агентов](docs/AGENT_CATALOG.md) объясняет границы ролей, расположение кода и режимы запуска.
Пять ролей не требуют пяти процессов: бизнес-аналитик и разбор расшифровок используют общий сервис `agents/business-analyst/`.

## Структура платформы

- [dmb-backlog/](dmb-backlog/README.md) — backend на FastAPI и SPA-интерфейс, интеграция агентов.
- `scripts/` — запуск, проверка состояния и остановка локального проекта.
- [docs/](docs/index.md) — карта действующей документации; исторические материалы находятся в `archive/`.

Устаревший самостоятельный прототип удалён из кода; [сравнение и сохранённые решения](docs/AGENT_V2_RETIREMENT_2026-11-02.md). Актуальный V2 — `agents/business-analyst-experimental/`.

## Локальный запуск

Из корня репозитория на Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1
```

Скрипт поднимает PostgreSQL, Redis, применяет миграции и запускает backend, бизнес-аналитика V1 и экспериментальный V2. Агент разбора расшифровок работает через сервис V1. Ассистент по бэклогу подключается автоматически при наличии `agents/backlog-assistant/.env`; отдельный флаг — `-IncludeBacklogAssistant`.

Оценщик Value и Priority score по умолчанию выключен из-за расхода памяти. Для его запуска:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1 -IncludeValuePriorityAssessor
```

Адреса после успешного health-check:

- приложение и backend API: `http://127.0.0.1:8000`, документация — `http://127.0.0.1:8000/docs`;
- бизнес-аналитик V1 и разбор встреч: `http://127.0.0.1:9000/docs`;
- бизнес-аналитик V2: `http://127.0.0.1:9300/docs`;
- оценщик при включении: `http://127.0.0.1:9100/docs`;
- логи: `.runtime/`.

Статус и остановка:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/project-status.ps1
powershell -ExecutionPolicy Bypass -File scripts/stop-project.ps1
```

Полный запуск требует Docker и доступную реальную языковую модель. Настройка — по `agents/business-analyst/.env.example`; `LLM_PROVIDER=mock` предназначен для изолированных тестов и не допускается штатным запуском. Секреты и локальные данные в Git не добавляются.

## Документация

- [Каталог пяти агентов](docs/AGENT_CATALOG.md).
- [Карта документации](docs/index.md).
- [Локальное развёртывание](docs/LOCAL_DEVELOPMENT.md).
- [Эксплуатация стенда](docs/PRODUCTION_RUNBOOK.md).
- [Методика и происхождение оценщика](agents/value-priority-assessor/UPSTREAM.md).

Состав агентов и команды запуска сверены с кодом 02.11.2026. Это проверка структуры, а не заявление о производственной приёмке всех агентов.
