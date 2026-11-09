# Meeting Analyzer

Проверено 03.11.2026. Самостоятельный сервис извлечения предложений из текстовых
расшифровок. Не импортирует DMB, V1 или V2. Порт API — 9500, отдельный worker,
PostgreSQL-очередь. Назначения пользователей и подтверждение поручений остаются в DMB.

## Установка и запуск

Из корня проекта:

```powershell
.venv/Scripts/python.exe -m pip install --require-hashes -r agents/meeting-analyzer/requirements.lock
.venv/Scripts/python.exe -m pip install --no-deps --no-build-isolation ./packages/dmb-agent-contracts ./agents/meeting-analyzer
Push-Location agents/meeting-analyzer
try { ../../.venv/Scripts/python.exe -m meeting_analyzer.migrate } finally { Pop-Location }
powershell -ExecutionPolicy Bypass -File scripts/start-agent.ps1 -Agent meeting-analyzer
powershell -ExecutionPolicy Bypass -File scripts/agent-status.ps1 -Agent meeting-analyzer
powershell -ExecutionPolicy Bypass -File scripts/stop-agent.ps1 -Agent meeting-analyzer
```

Предварительно подготовить отдельную PostgreSQL-БД и заполнить собственный `.env`
по [.env.example](.env.example). Пустые настройки не дают запустить сервис.
Launcher не создаёт инфраструктурные credentials и не копирует ключи соседей.
Установленный wheel читает `.env` из рабочего каталога сервиса, а не из
`site-packages`. Корневой launcher выполняет миграцию в том же каталоге,
что API и worker; переменные процесса имеют приоритет над файлом.
Разовая настройка локального профиля выполнена по указанию пользователя; секреты
не входят в Git. SQLite доступен исключительно явным изолированным тестам.

Без PowerShell: `python -m uvicorn meeting_analyzer.api:app --host 127.0.0.1 --port 9500`
и отдельный `python -m meeting_analyzer.worker`. Миграция выполняется до обоих процессов.

## API

`/health/live`, `/health/ready`, `/docs`. Внутренний префикс `/internal/agent/v1`:
capabilities; POST runs; GET runs/{id}, result, events; POST cancel,
acknowledgements. Заголовки: `X-Agent-Secret`, `X-Agent-Caller: dmb`,
`X-Actor-Ref` от доверенного gateway; при создании также `Idempotency-Key`.
Browser напрямую не получает service secret.

Вход — `meeting.extract`, contract_version 1.0, source с revision и SHA-256
исходного transcript, input с transcript и необязательной meeting_date.
Идентичный повтор возвращает прежний run, иной вход с тем же ключом — 409.
События имеют монотонный sequence и Last-Event-ID; поток status-only,
конечный snapshot, клиент переподключается для следующего чтения.

Доставка модели не повторяется автоматически. После deadline неопределённое
исполнение становится interrupted. Отмена запрещает публикацию; физическое
завершение уже отправленного Go-запроса не гарантируется.

Проверено 03.11.2026: временный input очищается не позднее 24 часов после
завершения; result — после ack или не позднее семи суток. События и metadata
имеют отдельное окно (по умолчанию семь суток), минимальный tombstone
идемпотентности — 14 суток. Политика задаётся собственными Settings;
`capabilities` возвращает фактические окна. Повтор ключа после очистки result
и SSE cursor удалённого события возвращают 410. После обоих окон tombstone
удаляется; активные запуски не удаляются. Очистка result использует CAS и
увеличивает версию, чтобы не перезаписать конкурентный результат.

## Испытания и ограничения

```powershell
.venv/Scripts/python.exe -m pytest agents/meeting-analyzer/tests packages/dmb-agent-contracts/tests -q
```

PostgreSQL integration расположены отдельно в `integration/`, требуют явного
`MEETING_TEST_POSTGRES_URL` на disposable БД. Live-suite запускается только
явно: [test-meeting-service-live.py](../../scripts/test-meeting-service-live.py).

Четыре синтетических предметных live Go-сценария пройдены; это не полная
приёмка [ТЗ](../../docs/AGENT_SERVICES_MIGRATION_SPEC_2026-11-02.md).
Глобальный Redis limiter, полный rollback drill и UI-приёмка ещё не завершены.
Общий статус миграции: [отчёт](../../docs/dev-testing/agent-services/IMPLEMENTATION.md).

Образ собирается из корня: `docker build -f agents/meeting-analyzer/Dockerfile -t meeting-analyzer:1.0.0 .`.
Запуск образа не требует repository mount или установки зависимостей.
Контейнерный DSN следует задать отдельно: localhost контейнера не является
Windows-хостом. [Compose](../../compose.agent-services.yaml) — отдельные
профили сборки; не подтверждение готовности полной контейнерной платформы.

Проверено 03.11.2026: [логический контекст SDK 1.3](../CONFIGURATION.md). Вложенные вызовы и retries учитываются в одном run; числовые
лимиты текущего профиля сохранены. Полная миграционная приёмка ещё открыта.

### Границы входа и deadline — проверено 03.11.2026

`POST /internal/agent/v1/runs` принимает доверенный `X-Agent-Deadline` с timezone:
эффективный deadline равен минимуму этого значения и собственного лимита.
Повтор idempotency key не продлевает ранее сохранённое время.
`MEETING_ANALYZER_REQUEST_BODY_LIMIT_BYTES` (по умолчанию 1 MiB; 1 KiB–4 MiB)
ограничивает фактически принятые байты до разбора JSON, включая chunked body.
Превышение — 413, malformed JSON/header — 400, ошибка схемы — 422; исходный
ввод в ошибку не включается. `capabilities` показывает фактическую границу.
PostgreSQL integration: 12 PASS, в том числе persisted deadline и настоящий
GoModel с MockTransport внутри контекста worker; живые Go-вызовы не нужны.

Проверено 03.11.2026: `POST /internal/agent/v1/runs/cancellations` принимает
тот же CreateRun envelope, caller/actor и Idempotency-Key для отмены неизвестного
исхода create. Атомарно создаёт cancelled tombstone или отменяет существующий
run после проверки source/input. Поздний create получает тот же cancelled run;
очередь и модель не запускаются. Profile changes не мешают отмене существующего
run с теми же source/input. Tenant scope, hash/body limits и schema validation
сохраняются. PostgreSQL create/cancel race PASS; 20 unit +13 integration PASS.

Контейнерный API/worker прогон проверен 03.11.2026:
[scripts/qualify-meeting-container.py](../../scripts/qualify-meeting-container.py)
принимает ID собственного disposable PostgreSQL и готовый `--image`, создаёт
новую техническую БД и запускает образ read-only, без source mounts/registry.
Проверяет настоящий HTTP, queue/worker/result/SSE/ACK и late-create cancellation
с явным MockTransport: live Go0. 20 последовательных admission p95=83ms.
Это не global limiter workload, не production Compose и не live quality replay.
