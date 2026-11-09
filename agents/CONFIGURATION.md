# Конфигурация самостоятельных агентов

Проверено 05.11.2026. Общий resolver поставляется в wheel
`dmb-agent-contracts==1.4.1`. Предметные модели и ORM в пакет не входят.

Patch 1.4.1 добавляет явную read-only recovery shell и проверяет ownership и уникальность частей remote assistant message
перед сборкой результата. Wheel SHA256:
`3e3f5872c678f42ab8fa4f249751c9e2cd266e325e16b631dc22869396fe5469`.
Сборочный manifest 1.4.0 и прежний wheel сохранены отдельно; исторические
результаты этой версии не выдаются за проверки нового artifact.

## Разрешение настроек

Для V1, V2, встреч и оценщика приоритет: явные параметры Settings → окружение
процесса → собственный `.env` → secret files → значения класса. У ассистента
по бэклогу: окружение процесса → собственный `.env`. Resolver не пишет файлы.
Пустое значение считается заданным и не заменяется значением нижнего источника.
Разные значения aliases в выбранном источнике вызывают отказ с именами полей,
без значений. Конфликт в затенённом нижнем источнике не отменяет явный override.

Исполняемый [каталог aliases](../packages/dmb-agent-contracts/dmb_agent_contracts/profiles.json)
используется Python и PowerShell. Первое имя группы — рекомендуемое;
последующие поддерживаются для совместимости. Python выдаёт FutureWarning
с именем устаревшего параметра. Полный список находится в каталоге, ниже — модель:

| Сервис | Ключ | Endpoint | Модель |
|---|---|---|---|
| business-analyst | AGENT_MODEL_API_KEY | AGENT_MODEL_BASE_URL | AGENT_MODEL_NAME |
| business-analyst-experimental | AGENT_V2_MODEL_API_KEY | AGENT_V2_MODEL_BASE_URL | AGENT_V2_MODEL_NAME |
| meeting-analyzer | MEETING_ANALYZER_MODEL_API_KEY | MEETING_ANALYZER_MODEL_BASE_URL | MEETING_ANALYZER_MODEL_NAME |
| value-priority-assessor | PRIORITISER_MODEL_API_KEY | PRIORITISER_MODEL_BASE_URL | PRIORITISER_MODEL_NAME |
| backlog-assistant | BACKLOG_ASSISTANT_MODEL_API_KEY | BACKLOG_ASSISTANT_MODEL_BASE_URL | BACKLOG_ASSISTANT_MODEL_NAME |

Старые `OPENAI_*` поддерживает только V1. Остальные сервисы не читают их как
общий профиль. Аналогичные группы каталога определяют DB URL и service secret.
Существующие `.env` не нужно массово переименовывать: одновременно задавать
разные значения старого и нового имени нельзя.

`Settings.configuration_sources()` и `backlog_assistant.config.configuration_sources()`
возвращают для критических полей только категорию источника и имя параметра.
Значения ключей/DSN в результат не включаются. Явное наследование V2 остаётся
опцией корневого launcher `AGENT_V2_INHERIT_V1_LLM=true`, действует в памяти
процесса и не записывает модельные реквизиты в соседний файл. Проверено 05.11.2026: root launcher задаёт все process aliases полного профиля и внутреннюю отметку AGENT_V2_EXPLICIT_INHERITANCE. Settings фиксирует source=inheritance/from_service=business-analyst только для унаследованных process-полей. Explicit overrides остаются explicit; смена окружения после создания Settings не меняет сохранённое происхождение. Файлы не записываются.

## Установка

Корневой launcher собирает wheel с закреплёнными setuptools/wheel и устанавливает
его в выбранные окружения без editable/source-path подключения. Кэш находится
в `.runtime/agent-wheels/`; fingerprint исходников и SHA256 wheel проверяются
перед повторным использованием. `-SkipDependencyInstall` требует установленную
версию SDK. Для отдельной установки из корня:

```powershell
scripts/install-agent-contracts.ps1 -BuildPython .venv/Scripts/python.exe -TargetPython @('.venv/Scripts/python.exe','.venv-agent-v2/Scripts/python.exe')
```

Docker build stages устанавливают wheel в образы сервисов. Для SDK 1.4.0
были собраны все пять образов и проверены offline import/отсутствие секретов.
Для текущего wheel 1.4.1 повторная сборка пяти образов ещё не завершена;
промежуточные образы до recovery shell не подтверждают текущую поставку. Самостоятельный runtime не требует соседних
исходников SDK или ручного изменения `sys.path`.

## Unit-режим

`DEBUG=true` больше не отключает проверку настоящего сервиса V1/V2.
Mock/SQLite допускаются только с `AGENT_UNIT_TEST_MODE=true` либо
`AGENT_V2_UNIT_TEST_MODE=true`, одновременно с DEBUG соответствующего сервиса.
Оценщик использует `PRIORITISER_UNIT_TEST_MODE=true` и `PRIORITISER_DEBUG=true`.
Эти флаги предназначены только для изолированных тестовых процессов. Обычный
сервис требует PostgreSQL и настроенный реальный провайдер; V1/V2 требуют
также отдельный непустой service secret, отличающийся от встроенного default.

## Владение процессами

Корневой и независимые launcher используют `.runtime/<service>.process.json`:
PID, время создания, executable и marker модуля. Если Windows venv создаёт
дочерний Python, PID слушателя принимается только после проверки родителя;
родитель также остаётся в записи для очистки. Повторный start проверяет
владение и readiness. Занятый чужой порт и частично работающий запуск вызывают
отказ без завершения найденного процесса. Для ассистента одна запись содержит
Agent API и его Data API; mTLS не отключается.

PID-only записи прежнего launcher недостаточны для остановки: живой процесс
по такой записи сохраняется с предупреждением. Автоматического присвоения
процессов прежнего запуска нет. Новый status читает реестр владения; для ассистента проверяет mTLS
с собственным CA и клиентским сертификатом, без вызова модели.

API получает запрос graceful shutdown через уникальный локальный control-файл;
сетевой management endpoint не открывается. После 15 секунд выполняется
проверенная остановка удерживаемого process handle. Worker встреч завершает
цикл через общий stop event. Синтетический ASGI-тест подтверждает lifespan shutdown.

`start-agent.ps1`, `agent-status.ps1`, `stop-agent.ps1` принимают `-Instance`;
по умолчанию `local`. Для изолированного запуска доступны `-Port` и `-DataPort`.
Каждый экземпляр имеет отдельные record/control/log файлы. Повторный start
проверяет записанные порты, identity и readiness. База данных от instance
автоматически не меняется: отдельный DSN нужно явно передать окружением.

## Модель и диагностика

Независимые настройки `execution_backend`, `model_provider`, `model_protocol`,
`runtime_location`, `runtime_contract_version` разрешаются тем же каталогом.
Локальные прямые сервисы требуют `direct`, `opencode_go`, `chat_completions`,
`none` и разрешённый HTTPS Go origin. Несовместимая конфигурация отклоняется
до запроса. Chat-профиль не подтверждает embeddings: V1/V2 оставляют их
выключенными; включение требует отдельной квалификации capability.

`agent-doctor.ps1` запускается собственным Python из каталога сервиса:
проверяет конфигурацию и существующую схему PostgreSQL в read-only transaction.
Не выполняет миграции, запросы модели, загрузку encoder или изменение `.env`.
В диагностике только имена источников и безопасные коды ошибок.

03.11.2026 по отдельным разрешениям пользователя V2 и оценщику подготовлены
Go-профили на параметрах V1. Применение выполнено после успешного smoke;
прежние файлы сохранены в DPAPI-зашифрованном виде с проверкой восстановления.
Остальные поля файлов сохранены. Это разовая согласованная миграция,
а не автоматическое наследование ключей между сервисами.

Для отдельного платного synthetic transport probe необходимы одновременно
`-LiveModelProbe -MaxCalls 1 -MaxSeconds 45`. По умолчанию doctor его не делает.
Probe использует собственный профиль, один HTTP-вызов без retry и общий
конечный ledger `.runtime/agent-services-evidence/model-budget.json`; резервирует
45 секунд до отправки. Отсутствие остатка бюджета запрещает вызов. Результат
с timestamp и usage сохраняется отдельно и не считается продуктовой приёмкой.
В текущем прогоне эта новая опция не вызывалась, счётчик остаётся 21/40.

Для отдельной cold assets стадии прямого сервиса launcher принимает
`-ReadyTimeoutSeconds` (явное значение не более 1800 секунд). По умолчанию
оценщик ждёт 900 секунд, остальные прямые сервисы — 60. Это не изменение
model deadline или Go-бюджета; mTLS ассистент использует свой preflight.
Два изолированных native-цикла всех пяти сервисов пройдены с подготовленными
ресурсами; полный запуск платформы и продуктивный cutover ещё не квалифицированы.

## Логический контекст — проверено 03.11.2026

SDK 1.3 связывает вложенные ModelRequest одним run_id, сохраняя отдельные
request_id подзапросов. Контекст передаётся в executor F5/F6 отдельными
ContextVar copies; общий thread-safe счётчик расходуется перед фактической
HTTP-попыткой, включая retry. Cache hit не расходует попытку. F5/F6 имеют
отдельные provider-session refs по prompt/schema внутри общего run.

Встречи связывают контекст с долговечными run_id/deadline и лимитом один вызов;
worker/broker бэклога сохраняют прежние четыре вызова и 60 секунд. Для V1/V2 и
оценщика новые числовые пределы не введены: сохранены прежние настройки;
владелец будущего run может явно передать deadline и max_model_attempts.
Вложенный scope сужает пределы, завершённый/cancelled контекст запрещает
последующие запросы и возврат позднего кандидата. HTTP broker не сохраняет
provider body в диагностике. Общий межсервисный Redis operation-limit остаётся
отдельной незавершённой частью; этот счётчик не является глобальным limiter.


## Общий limiter — реализация04.11.2026 (приёмка продолжается)

SDK1.4.0 добавляет Redis logical-operation slots. `start-project.ps1` задаёт
общий global профиль2; `start-agent.ps1` в отдельном процессе по умолчанию
создаёт standalone профиль1 для service/instance. Собственный optional
`<PREFIX>OPERATION_REDIS_URL` (V1:`AGENT_OPERATION_REDIS_URL`) задаёт Redis
standalone-профиля. В global-профиле другой endpoint отклоняется.

В дочерние процессы передаются `DMB_AGENT_LIMITER_MODE`, `REDIS_URL` с полным
префиксом `DMB_AGENT_LIMITER_`, `NAMESPACE`, `EPOCH`, `JOURNAL_DIR`,
`DMB_AGENT_REQUIRE_LIMITER=true`, `DMB_AGENT_SERVICE_ID`. Они не содержат и
не переносят Go-ключи. Epoch/journal находятся в `.runtime/agent-limiter/`;
активные lease не сбрасываются при потере Redis. Старый owned процесс с другим
профилем требуется штатно остановить перед переходом; launcher его не подменяет.
Обычный status показывает фактический mode/limit сохранённого process record.
Контейнерные профили и полная межпроцессная приёмка ещё дополняются.


Проверено 04.11.2026: [управляющий API и общий лимит](RUN_API.md). Штатный
launcher подготавливает Redis-профиль до старта сервиса; отсутствие координатора
в рабочем профиле запрещает допуск операций.


## Compose и remote-профили

`compose.agent-services.yaml` использует общий Redis без host-порта и два
постоянных тома: AOF координатора и журнал аренды. Все процессы подключаются
к одному namespace и одному пути журнала; meeting-worker запускается через
SDK entrypoint. `docker compose config --quiet` проходит; полный Compose cutover
этим не подтверждён. DSN в собственных профилях должны быть доступны из контейнера;
Windows localhost не заменяется автоматически. Схемы V1/V2/оценщика/ассистента
мигрируются явно. Контейнер ассистента требует доверенный deployment adapter
и mTLS/tool/model bridge; штатный native Docker-controller не появляется
автоматически внутри stock service image.

Remote-профили четырёх сервисов включаются собственным `*_REMOTE_ENABLED=true`
вместе с `*_EXECUTION_BACKEND=opencode` и `*_RUNTIME_LOCATION=remote`.
Нужны отдельные `REMOTE_BASE_URL`, абсолютный `REMOTE_CONFIG_FILE`,
`REMOTE_PROVIDER_ID`, `REMOTE_MODEL_ID`, `REMOTE_AGENT` и `REMOTE_CREDENTIAL`.
Префиксы — `AGENT_`, `AGENT_V2_`, `MEETING_ANALYZER_`, `PRIORITISER_`.
По умолчанию аутентификация Basic с `REMOTE_USERNAME=opencode`;
`REMOTE_AUTH_SCHEME=bearer` допускается для явно настроенного proxy.
Inference endpoint не используется как адрес remote runtime.
Перед включением выполняется явная миграция приватных runtime bindings
с проверенной резервной копией и reference preflight. Реальный remote сервер
в текущей локальной проверке отсутствует; S остаётся NOT_RUN.

Для встреч исходный deadline по умолчанию — 600 секунд. Переданный доверенный
DMB deadline может только уменьшить его; повтор доставки не продлевает срок.


### Режим восстановления только для чтения — проверено 05.11.2026

Явные входы `business_analyst.recovery:app`,
`business_analyst_experimental.recovery:app`, `meeting_analyzer.recovery:app`,
`value_priority_assessor.recovery:app` запускаются ASGI-сервером в собственном
окружении сервиса. BKL запускается `python -m backlog_assistant.recovery`
и сохраняет обязательный mTLS. Это отдельное развёртывание; обычный запуск
не включает recovery автоматически. Redis, модель и worker этому режиму не нужны.
Нужна существующая совместимая PostgreSQL-схема: readiness проверяет таблицы,
режим не выполняет DDL, миграции, seed или очистку истории. Изменяющие HTTP
методы получают 503 `recovery_read_only`. У BKL разрешена только техническая
запись nonce для защиты подписанных GET от повторного воспроизведения.

Для V1/V2 перед направлением DMB на recovery-развёртывание включаются соответственно
`AGENT_RECOVERY_READ_ONLY=true` и `AGENT_V2_RECOVERY_READ_ONLY=true` в DMB.
По умолчанию оба флага false; текущие локальные `.env` не изменялись.
Шлюз передаёт `X-Agent-Caller=dmb` и `X-Actor-Ref` только из авторизованного
пользователя. V1/V2 проверяют собственный service secret и владельца истории;
VPA дополнительно требует непустой существующий methodologist secret.
Историю BKL повторно авторизует исходный DataPort; пустой proof не даёт доступ.

Read-only артефакт должен содержать зафиксированный бизнес-код, recovery adapter
и SDK с проверенными хешами; нельзя запускать прежний writable entry point
на новой схеме. Сценарий `scripts/qualify-agent-recovery.py` сохраняет такие
source-артефакты в новом каталоге `.runtime`, проверяет их в отдельных процессах
и использует только точный ID disposable PostgreSQL. Он не активирует откат
на рабочих сервисах. Проверка чтения синтетических данных не заменяет
резервное копирование, проверку настоящей истории двух версий и полный cutover.
