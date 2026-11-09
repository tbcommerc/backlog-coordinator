# Локальный запуск Backlog coordinator

> AS-IS проверено по `scripts/start-project.ps1`, status/stop scripts и
> `compose.yaml` 03.11.2026. Полная приёмка нового состава открыта;
> [фактический статус миграции](dev-testing/agent-services/IMPLEMENTATION.md).

## Что запускается

Единый сценарий по умолчанию поднимает основной локальный контур:

- PostgreSQL 16 для Backlog coordinator на `127.0.0.1:5432/dmb_backlog`;
- отдельную PostgreSQL-базу сессий AI-агента `agent_sessions`;
- Redis на `127.0.0.1:6379`;
- Alembic-миграции основной схемы;
- AI-агента на `http://127.0.0.1:9000`;
- backend и frontend на `http://127.0.0.1:8000`.

Старый самостоятельный прототип удалён из кода и запуска 02.11.2026. Единственный экспериментальный V2 — `agents/business-analyst-experimental/`; [результаты сравнения](AGENT_V2_RETIREMENT_2026-11-02.md).

Целевой fork-based Assistant V2 обязателен при стандартном запуске. Скрипт создаёт отдельную PostgreSQL DB/роль `agent_v2_sessions` /
`agent_v2`, окружение `.venv-agent-v2` и процесс на порту 9300. Он не заменяет
Старый самостоятельный прототип удалён из кода.

Агент приоритизации по умолчанию не запускается, чтобы локальная embedding-модель
не исчерпывала память рабочей станции. Его можно явно добавить флагом
`-IncludeValuePriorityAssessor`.

Для анализа встреч добавлен самостоятельный [meeting-analyzer](../agents/meeting-analyzer/README.md)
на порту 9500 с собственным профилем и PostgreSQL-БД. Новый стандартный launcher
включает его и DMB delivery adapter. Старые capture runs сохраняют legacy backend;
они не переотправляются новому исполнителю. Перед стартом необходимы настройки
сервиса и техническая миграция. UI остаётся `#/meeting-capture`.
Миграция, API и worker запускаются из `agents/meeting-analyzer`: установленный
wheel загружает собственный `.env` из рабочего каталога. Переменные процесса
имеют приоритет. Встроенные default service secrets V1/V2 не проходят runtime
проверку: локальные профили агентов и DMB должны содержать согласованные
непустые межсервисные секреты, отличные от default.

Frontend не требует отдельного процесса: FastAPI отдаёт его вместе с backend.

## Предварительные требования

Проверено 12.10.2026: локальный скрипт создаёт отсутствующий
`AUTH_RATE_HMAC_KEY` в `dmb-backlog/.env` из 32 случайных байтов и сохраняет
существующий ключ. Новому модулю авторизации необходимы этот ключ и Redis;
без них вход возвращает 503. Обновление схемы само по себе не активирует
старые учётные записи: переход на новую авторизацию требует отдельного
согласованного переноса пользователей через `backend/account_operator.py`.
Его операция `cutover` сбрасывает старые пароли; автоматически её не запускать.

Для согласованного восстановления прежнего входа без сброса паролей добавлен
отдельный режим `AUTH_ALLOW_LEGACY_PASSWORDS=true` (по умолчанию `false`).
После миграции `c8f4b0e2d653` оператор запускает
`python account_operator.py preserve-passwords --apply --reason "approved restoration"`
из `dmb-backlog/backend` в интерактивном терминале. Команда проверяет уникальность
нормализованных email и наличие поддерживаемых хешей, заполняет только новые
поля авторизации и резервирует логины. Старые поля пользователей, пароли, роли
и команды сохраняются; повторный перенос блокируется. Вход остаётся по прежнему
email и паролю. bcrypt проверяется без нормализации и автоматического перехеширования;
новые пароли по-прежнему создаются с Argon2id. После изменения `.env` нужен
перезапуск backend. Проверено 12.10.2026: локально перенесены 19 пользователей
с проверкой неизменности всех прежних полей; успешный вход проверен на синтетическом
пароле с подменой БД, реальный пароль пользователя не запрашивался.

1. Windows PowerShell 5.1 или PowerShell 7.
2. Python 3.12, доступный командой `python`.
3. Docker Desktop с поддержкой `docker compose`.
4. Интернет при первом запуске для загрузки Docker-образов и Python-пакетов.

## Запуск

Запуск без всех отдельных AI-сервисов (проверено 22.10.2026):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1 -WithoutAgents
```

Флаг отключает запуск V1, V2, legacy Assistant V2, Task Prioritiser и помощника
по бэклогу, включая его автоматическое включение по наличию `.env`.
PostgreSQL, Redis, миграции и backend со встроенным frontend запускаются;
ранее запущенные процессы агентов останавливаются штатным stop-скриптом.
Флаг имеет приоритет над `-Include*`. AI-функции без сервисов недоступны.

Из корня проекта:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1
```

Полный запуск, включая Task Prioritiser:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1 -IncludeValuePriorityAssessor
```

Стандартный запуск включает целевой fork-based Assistant V2 для BA/PO:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1
```

Настройка LLM V2 проверена 02.11.2026: собственные provider/key/base/model
сохраняются. Наследование V1 включается только явным `AGENT_V2_INHERIT_V1_LLM=true`
и происходит в памяти процесса без записи в `.env`. Пустое значение означает
отсутствие наследования. Нужны `AGENT_V2_LLM_PROVIDER`, `AGENT_V2_OPENAI_API_KEY`,
`AGENT_V2_OPENAI_BASE_URL`, `AGENT_V2_OPENAI_MODEL`.
[Эксплуатация V2](../agents/business-analyst-experimental/docs/OPERATIONS.md).

Пункт меню и UI `#/agent-v2` видны всегда. Полный администратор получает доступ
автоматически с trusted context BA. Для доступа остальных BA/PO пользователь
должен быть явно включён через `AGENT_V2_PILOT_USER_IDS` или
`AGENT_V2_PILOT_EMAILS`.
`AGENT_V2_KILL_SWITCH=true` немедленно закрывает gateway после перезапуска, не влияя на V1 и
DMB; страница V2 при этом показывает локальный статус недоступности.

Старый URL `#/assistant-v2` перенаправляется на `#/agent-v2`. Диагностический legacy-сервис и его флаг удалены.

При первом запуске сценарий:

1. создаёт `dmb-backlog/.env` и `agents/business-analyst/.env`, если их ещё нет;
2. фиксирует в них PostgreSQL и Redis как локальный стек;
3. запускает Docker-контейнеры и ждёт их health-check;
4. создаёт основное Python-окружение `.venv` и устанавливает зависимости;
5. выполняет `alembic upgrade head`;
6. запускает AI-агента и Backlog coordinator в скрытых фоновых процессах;
7. проверяет их HTTP health endpoint.


При `-IncludeValuePriorityAssessor` сценарий также создаёт `agents/value-priority-assessor/.env`,
подготавливает `.venv-prioritiser`, запускает сервис на порту 9100 и ждёт его
readiness. Без флага сценарий записывает `PRIORITISER_ENABLED=false` в
`dmb-backlog/.env`: readiness backend помечает интеграцию как `disabled`, а
ручной вызов расчёта сразу возвращает `503` без сетевого таймаута.

HTTP-проверка принимает стандартные состояния `ok`, `ready` и `healthy` и
завершается сразу после готовности сервиса. Стандартный таймаут — 60 секунд;
при явном запуске Task Prioritiser предусмотрено до 900 секунд на загрузку модели
эмбеддингов.

Первичная установка зависимостей агента приоритизации занимает больше времени:
его стек включает локальную модель эмбеддингов. Изолированное окружение исключает
конфликт версий FastAPI и Pydantic с основным backend.
Модель сохраняется в проектном runtime-кэше `.runtime/hf-cache`, чтобы запуск не
зависел от свободного места в системном пользовательском кэше.

Проверено 03.11.2026: оценщик при `-IncludeValuePriorityAssessor` читает
собственный профиль. Launcher не копирует ключи из V1 в его `.env`.
Обязательны собственные PostgreSQL DSN, service secret и Go Chat Completions.
[Имена aliases и lifecycle](../agents/CONFIGURATION.md). Согласованная разовая
миграция V2/оценщика на параметры V1 выполнена отдельно с проверкой и откатом;
она не включает автоматическую синхронизацию последующих запусков.

Повторный запуск использует существующие Docker volumes и не переустанавливает
зависимости, пока не изменятся файлы `requirements.txt`.

## Адреса

- приложение: `http://127.0.0.1:8000`;
- Swagger backend: `http://127.0.0.1:8000/docs`;
- Swagger AI-агента: `http://127.0.0.1:9000/docs`;
- Swagger агента приоритизации: `http://127.0.0.1:9100/docs`;
- Swagger Assistant V2: `http://127.0.0.1:9200/docs` (только при opt-in);
- Swagger fork-based Assistant V2: `http://127.0.0.1:9300/docs` (обязательный сервис);
- health backend: `http://127.0.0.1:8000/api/v1/health`;
- health AI-агента: `http://127.0.0.1:9000/api/agent/health`;
- health агента приоритизации: `http://127.0.0.1:9100/health`.
- readiness Assistant V2: `http://127.0.0.1:9200/ready`.
- readiness fork-based Assistant V2: `http://127.0.0.1:9300/api/agent-v2/ready`.

Логи и PID-файлы находятся в `.runtime/`.

## Статус и остановка

```powershell
powershell -ExecutionPolicy Bypass -File scripts/project-status.ps1
powershell -ExecutionPolicy Bypass -File scripts/stop-project.ps1
```

Скрипт статуса выводит отдельно состояние процесса (`process`) и результат
HTTP-проверки (`health`): наличие живого PID само по себе не считается готовностью.

Остановка сохраняет PostgreSQL-данные в Docker volume. Для остановки только
Python-сервисов с сохранением запущенной инфраструктуры используется:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop-project.ps1 -KeepInfrastructure
```

## Данные после перехода

Первичная Alembic-миграция создаёт пустую PostgreSQL-схему. Старый SQLite-файл не
импортируется автоматически. Startup seed принудительно выключен, потому что он
создаёт и изменяет пользователей, роли, справочники и команды — защищённые данные
проекта.

Перенос таких записей должен выполняться отдельно владельцем данных или DBA по
проверенному сценарию. После импорта явных числовых ID необходимо синхронизировать
PostgreSQL sequences. Обычные рабочие данные можно переносить только после того,
как в целевой базе уже существуют необходимые защищённые ссылки.

## Изменение схемы

Схема PostgreSQL изменяется только через Alembic. Полный порядок описан в
`dmb-backlog/docs/SCHEMA_CHANGES.md`. `backend/migrations/` содержит старые
SQLite-скрипты и не используется.

## Типовые ошибки

- `Docker не установлен` — установить Docker Desktop и повторить запуск.
- `Docker Engine недоступен` — дождаться полного старта Docker Desktop.
- Порт `5432`, `6379`, `8000`, `9000`, `9100`, `9200` или `9300` занят — остановить конфликтующий сервис.
- Ошибка Alembic — посмотреть вывод запуска и не запускать backend поверх
  частично применённой схемы.
- Ошибка Python-сервиса — проверить `.runtime/backend.err.log` или
  `.runtime/agent.err.log`; для агента приоритизации —
  `.runtime/prioritiser.err.log`.
  Для fork-based Assistant V2 — `.runtime/agent-v2.err.log`.


## Переход учётных записей — 12.10.2026

После обновления auth-кода необходим контролируемый переход существующих
пользователей; обычный старт не создаёт приглашения и не подбирает логины.
Задайте отдельный `AUTH_RATE_HMAC_KEY`, `AUTH_ORIGINS`, `AUTH_ALLOWED_HOSTS` и
контакт поддержки. Без Redis/HMAC чувствительные операции дают 503.
[Порядок миграции, активации первого администратора и проверки](../dmb-backlog/docs/ACCOUNT_SECURITY.md).
Рабочая БД и настройки стенда в рамках реализации не изменялись.

## Опциональный помощник по бэклогу

Проверено 14.10.2026. Флаг `-IncludeBacklogAssistant` добавляет Agent API 9400 и отдельный Data API 9450. Оба требуют mTLS; необходимы отдельная PostgreSQL БД, secrets, сертификаты и закреплённый Docker image. Предварительная проверка выполняется до стандартного запуска. При наличии `agents/backlog-assistant/.env` оба сервиса автоматически включаются обычной командой; флаг нужен для явной проверки ещё не настроенной установки. [Подготовка и настройки](../agents/backlog-assistant/docs/OPERATIONS.md).

## Канбан рабочих задач — проверено 21.10.2026

Для локального пилота в `dmb-backlog/.env` включён `WORK_TASK_BOARD_ENABLED=true`; в шаблоне конфигурации значение по умолчанию `false`. После смены значения перезапусти проект штатными скриптами из корня. Вход: `http://127.0.0.1:8000/#/work-tasks?display=board`. Новая миграция не нужна; seed и Task Prioritiser для доски не требуются. Для отката достаточно `false` и перезапуска, данные задач сохраняются. [Контракт и результаты проверок](../dmb-backlog/docs/WORK_BOARD.md).

## Самостоятельные сервисы — проверено 03.11.2026

[Aliases, SDK и lifecycle](../agents/CONFIGURATION.md): корневой start использует
тот же реестр владения, что start-agent/stop-agent. Повторный запуск не завершает
все сервисы; живой owned process проверяется на readiness, чужой занятый порт
вызывает отказ. Старый файл только с PID не даёт права завершать процесс.
Существующий legacy launch не присваивается автоматически.

Логи независимых API: `.runtime/business-analyst.api.err.log`,
`.runtime/business-analyst-experimental.api.err.log`,
`.runtime/meeting-analyzer.api.err.log`,
`.runtime/value-priority-assessor.api.err.log`; backend — `backend.err.log`,
ассистент — `backlog-assistant.err.log` и `backlog-assistant-data.err.log`.
Полный повторный старт и mTLS lifecycle после изменения ещё не квалифицированы;
результаты и оставшиеся пункты — в [отчёте](dev-testing/agent-services/IMPLEMENTATION.md).
