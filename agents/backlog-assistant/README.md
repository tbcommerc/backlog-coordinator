# Помощник по бэклогу

Роль: агент-ассистент по бэклогу. [Каталог агентов](../../docs/AGENT_CATALOG.md).

Проверено 17.10.2026. Самостоятельный сервис версии 0.1.0; локально настроены отдельная PostgreSQL БД, mTLS и модель V1/V2; доступ включён для существующего пользователя из локального allowlist. В шаблоне конфигурации интеграция выключена. Реализованы собственная очередь PostgreSQL, API разговоров, OpenCode Runtime Adapter, контролируемый доступ к модели и инструментам, gateway/Data API и страница с контекстной панелью.

Интерфейс — чат с историей, восстановлением разговора после перезагрузки, отменой и контекстной панелью. Полная производственная приёмка пока не заявляется. Сквозной браузерный сценарий на пяти разрешённых задачах пройден: ответ, уточнение, история, карточка и отмена. Выполнена [оценка на 80 фиксированных примерах](docs/EVALUATION_80_2026-10-15.md): 80/80 функциональных проверок; 72 запуска реальной модели и восемь внедрённых отказов. Полные модельные циклы и резервные ответы разделены в отчёте. Свободные утверждения модели в DMB пока заменяются проверенными серверными данными и краткими числовыми сводками. Ограничения перечислены в [TESTING.md](docs/TESTING.md).

## Документация

- [Архитектура и границы](docs/ARCHITECTURE.md).
- [API, схемы и хранение](docs/API.md).
- [Запуск, конфигурация и остановка](docs/OPERATIONS.md).
- [Проверки и оставшиеся условия пилота](docs/TESTING.md).
- [Продуктовый проект](../../docs/backlog-assistant-design.md) и [контракт OpenCode](../../docs/backlog-assistant-opencode.md) остаются целевыми требованиями.

## Установка и автономные проверки

Из этого каталога, Python 3.12:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pip install --no-deps -e .
.\.venv\Scripts\python.exe -m pytest tests -q
```

Тесты не импортируют DMB. SQLite используется только как явный in-memory fixture unit-тестов собственной очереди; сервис требует PostgreSQL и не подменяет его SQLite.

```powershell
.\.venv\Scripts\python.exe -m tests.probe_postgres
docker build -f deploy/runtime.Dockerfile -t backlog-assistant-runtime:1.17.13 .
$imageId = docker image inspect backlog-assistant-runtime:1.17.13 --format '{{.Id}}'
.\.venv\Scripts\python.exe -m tests.probe_isolation --image $imageId
```

Живой smoke использует только синтетические данные и модель `glm-5.3-flash`, как V1/V2. Ключ не выводится и не передаётся OpenCode. Установка native binary нужна только для диагностического CLI; рабочий runtime — Docker.

```powershell
npm ci
.\.venv\Scripts\python.exe -m tests.probe_opencode --binary node_modules/opencode-windows-x64-baseline/bin/opencode.exe --provider-env ../business-analyst/.env --docker-image $imageId
```

`--full-catalog` проверяет все десять tools; без флага smoke ограничен поиском и чтением задачи. `--broker-only` проверяет только доступность модели, `--preflight` — OpenCode/config. Ни один из этих режимов не включает пилот DMB.


17.10.2026 исправлены составные подсчёты по команде, статусу и кварталу: разрешение статуса и русских форм названий, обязательное сохранение фильтров, отдельное представление итогового подсчёта и уточнение при неразрешённых фильтрах. Проверки и ограничения повторного прогона приведены в [TESTING.md](docs/TESTING.md).
