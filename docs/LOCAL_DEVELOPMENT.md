# Локальный запуск Backlog coordinator

> AS-IS проверено по `scripts/start-project.ps1`, status/stop scripts и
> `compose.yaml` 12.10.2026.

## Что запускается

Единый сценарий по умолчанию поднимает основной локальный контур:

- PostgreSQL 16 для Backlog coordinator на `127.0.0.1:5432/dmb_backlog`;
- отдельную PostgreSQL-базу сессий AI-агента `agent_sessions`;
- Redis на `127.0.0.1:6379`;
- Alembic-миграции основной схемы;
- AI-агента на `http://127.0.0.1:9000`;
- backend и frontend на `http://127.0.0.1:8000`.

Legacy greenfield-прототип `assistant-v2/` по умолчанию не запускается и не имеет
отдельной страницы в пользовательском интерфейсе. Диагностический флаг
`-IncludeAssistantV2` добавляет отдельную PostgreSQL DB/роль `assistant_v2`,
собственный Alembic, окружение `.venv-assistant-v2` и процесс на порту 9200.

Целевой fork-based Assistant V2 обязателен при стандартном запуске. Скрипт создаёт отдельную PostgreSQL DB/роль `agent_v2_sessions` /
`agent_v2`, окружение `.venv-agent-v2` и процесс на порту 9300. Он не заменяет
и не запускает каталог `assistant-v2/`.

Агент приоритизации по умолчанию не запускается, чтобы локальная embedding-модель
не исчерпывала память рабочей станции. Его можно явно добавить флагом
`-IncludePrioritiser`.

Агент «Поручения из встреч» входит в обязательный сервис `agent` на порту 9000.
Отдельного процесса или флага не требует; страница `#/meeting-capture`.
С 17.10.2026 backend также запускает встроенный обработчик фонового анализа:
очередь и результат хранятся в PostgreSQL, UI можно закрыть/обновить. Нужна
миграция `b6f4c2d9e821` (`alembic upgrade head` в штатном запуске); отдельный
worker-процесс, Redis-очередь и новые переменные окружения не требуются.
Локальный V1, включая разбор встреч, настроен на OpenCode Go
(`OPENAI_BASE_URL=https://opencode.ai/zen/go/v1`, `OPENAI_MODEL=glm-5.3-flash`);
ключ хранится в `agent/.env`. Проверено 12.10.2026 реальным извлечением через API.

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
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1 -IncludePrioritiser
```

Диагностический запуск legacy-прототипа Assistant V2:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1 -IncludeAssistantV2
```

Стандартный запуск включает целевой fork-based Assistant V2 для BA/PO:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1
```

Настройка LLM V2 проверена 09.10.2026: по умолчанию launcher копирует
provider/key/base/model из `agent/.env`. Чтобы сохранить отдельный ключ и модель,
задайте в `agent-v2/.env` `AGENT_V2_INHERIT_V1_LLM=false` и четыре
`AGENT_V2_LLM_PROVIDER` / `AGENT_V2_OPENAI_API_KEY` / `AGENT_V2_OPENAI_BASE_URL` /
`AGENT_V2_OPENAI_MODEL`. Пример OpenCode Go и безопасная проверка подключения —
[эксплуатация V2](../agent-v2/docs/OPERATIONS.md#opencode-go-через-api-ключ).

Пункт меню и UI `#/agent-v2` видны всегда. Полный администратор получает доступ
автоматически с trusted context BA. Для доступа остальных BA/PO пользователь
должен быть явно включён через `AGENT_V2_PILOT_USER_IDS` или
`AGENT_V2_PILOT_EMAILS`.
`AGENT_V2_KILL_SWITCH=true` немедленно закрывает gateway после перезапуска, не влияя на V1 и
DMB; страница V2 при этом показывает локальный статус недоступности.

Флаги можно сочетать, но legacy-сервис не добавляет второй пункт меню:
`#/assistant-v2` перенаправляется на канонический `#/agent-v2`.
`ASSISTANT_V2_PILOT_USER_IDS`, `ASSISTANT_V2_PILOT_EMAILS` и автоматический
допуск `admin=full` относятся только к диагностическому API legacy-прототипа.
Пустой allowlist не блокирует основной запуск; legacy V2 API возвращает `403`
не-админу вне allowlist. Launcher
принудительно оставляет
`ASSISTANT_V2_ALLOW_REAL_DATA=false` и `ASSISTANT_V2_PROVIDER_ENABLED=false`:
до закрытия privacy/provider решений допустим только synthetic manual-safe режим.

При первом запуске сценарий:

1. создаёт `dmb-backlog/.env` и `agent/.env`, если их ещё нет;
2. фиксирует в них PostgreSQL и Redis как локальный стек;
3. запускает Docker-контейнеры и ждёт их health-check;
4. создаёт основное Python-окружение `.venv` и устанавливает зависимости;
5. выполняет `alembic upgrade head`;
6. запускает AI-агента и Backlog coordinator в скрытых фоновых процессах;
7. проверяет их HTTP health endpoint.

При `-IncludeAssistantV2` сценарий также идемпотентно создаёт отдельные роль и
DB для существующего Docker volume, устанавливает зависимости в изолированное
окружение, выполняет V2 Alembic и ждёт отдельный `/ready`.

При `-IncludePrioritiser` сценарий также создаёт `prioritiser-agent/.env`,
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

Провайдер, ключ, endpoint и модель LLM для агента приоритизации при запуске с
`-IncludePrioritiser` синхронизируются из `agent/.env`. Поэтому оба агента используют
одни и те же `LLM_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` и
`OPENAI_MODEL`; отдельная настройка ключа приоритизатора не требуется.
`LLM_PROVIDER` обязателен; значение `mock` отклоняется полным стартовым
сценарием и остаётся доступным только изолированным тестам.

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
  Для Assistant V2 — `.runtime/assistant-v2.err.log`.
  Для fork-based Assistant V2 — `.runtime/agent-v2.err.log`.


## Переход учётных записей — 12.10.2026

После обновления auth-кода необходим контролируемый переход существующих
пользователей; обычный старт не создаёт приглашения и не подбирает логины.
Задайте отдельный `AUTH_RATE_HMAC_KEY`, `AUTH_ORIGINS`, `AUTH_ALLOWED_HOSTS` и
контакт поддержки. Без Redis/HMAC чувствительные операции дают 503.
[Порядок миграции, активации первого администратора и проверки](../dmb-backlog/docs/ACCOUNT_SECURITY.md).
Рабочая БД и настройки стенда в рамках реализации не изменялись.

## Опциональный помощник по бэклогу

Проверено 14.10.2026. Флаг `-IncludeBacklogAssistant` добавляет Agent API 9400 и отдельный Data API 9450. Оба требуют mTLS; необходимы отдельная PostgreSQL БД, secrets, сертификаты и закреплённый Docker image. Предварительная проверка выполняется до стандартного запуска. При наличии `backlog-assistant/.env` оба сервиса автоматически включаются обычной командой; флаг нужен для явной проверки ещё не настроенной установки. [Подготовка и настройки](../backlog-assistant/docs/OPERATIONS.md).

## Канбан рабочих задач — проверено 21.10.2026

Для локального пилота в `dmb-backlog/.env` включён `WORK_TASK_BOARD_ENABLED=true`; в шаблоне конфигурации значение по умолчанию `false`. После смены значения перезапусти проект штатными скриптами из корня. Вход: `http://127.0.0.1:8000/#/work-tasks?display=board`. Новая миграция не нужна; seed и Task Prioritiser для доски не требуются. Для отката достаточно `false` и перезапуска, данные задач сохраняются. [Контракт и результаты проверок](../dmb-backlog/docs/WORK_BOARD.md).
