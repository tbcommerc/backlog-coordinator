# Запуск и развёртывание — подтверждённое состояние

> Статус: обновлено 2026-09-19. Локальный запуск описан ниже; воспроизводимая
> стендовая топология находится в `../../compose.production.yaml`, полный
> операторский порядок — в `../../docs/PRODUCTION_RUNBOOK.md`.

## Подтверждённый локальный запуск

Из `dmb-backlog`:

```powershell
python -m pip install -r backend/requirements.txt
Set-Location backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Backend раздаёт API с префиксом `/api/v1`, health endpoint `/api/v1/health`,
Swagger UI `/docs` и frontend как статические файлы. Основной frontend-маршрут
обслуживается тем же приложением.

## Конфигурация

`Settings` читает корневой `.env`. Актуальный шаблон — `.env.example`.
Ключевые переменные:

Fork-based Assistant V2 включается отдельными `AGENT_V2_*`: feature flag,
kill switch, base URL, secret, pilot user IDs/emails и списки имён ролей BA/PO.
Штатный локальный launcher запускает его только с `-IncludeAgentV2` на порту
9300 и с отдельной БД `agent_v2_sessions`; без флага DMB gateway не регистрируется.

- `DEBUG`
- `DATABASE_URL`
- `SECRET_KEY`, `ALGORITHM`, сроки access/refresh token
- `AGENT_SECRET`
- `CORS_ORIGINS`
- `RUN_STARTUP_SEED`
- `RUN_STARTUP_MAINTENANCE`
- `RUN_NOTIFICATION_SCHEDULER`
- `REDIS_URL`, `EVENT_STREAM_NAME`, `EVENT_STREAM_MAXLEN`
- `OUTBOX_BATCH_SIZE`, `OUTBOX_CLAIM_TIMEOUT_SECONDS`, `OUTBOX_RETENTION_DAYS`,
  `OUTBOX_MAX_ATTEMPTS`, `OUTBOX_DEAD_LETTER_RETENTION_DAYS`
- `IDEMPOTENCY_RETENTION_DAYS`
- `ATTACHMENT_STORAGE_DIR`
- `OTEL_ENABLED`, `OTEL_SERVICE_NAME`, `OTEL_DEPLOYMENT_ENVIRONMENT`,
  `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_TRACE_SAMPLE_RATIO`

При `DEBUG=false` запуск отклоняет пустой, стандартный или короче 32 символов
`SECRET_KEY`, пустой или стандартный `AGENT_SECRET`, SQLite, отсутствие Redis,
локальное хранилище вложений, а также включённые seed/startup maintenance.
Seed и maintenance по умолчанию выключены; только notification scheduler при
отсутствующем значении наследует `DEBUG`.

Для окружения без dev-мутаций следует явно задавать:

```env
DEBUG=false
RUN_STARTUP_SEED=false
RUN_STARTUP_MAINTENANCE=false
RUN_NOTIFICATION_SCHEDULER=false
```

Перед каждым выпуском применяется `python -m alembic upgrade head`. Web workers
могут параллельно запускать outbox dispatcher. Планировщик рекомендуется запускать
командой `python run_notification_scheduler.py`; advisory lock допускает standby,
но не допускает двух активных исполнителей.

Reverse proxy обязан отключить buffering для `/api/v1/events/stream`, разрешить
долгие ответы и иметь idle timeout больше 15 секунд. Балансировщик использует
`/api/v1/health` для liveness и `/api/v1/health/ready` для readiness.
Проверяемый пример Nginx находится в `../../infrastructure/nginx/dmb.conf.example`.

Prometheus должен скрейпить `/metrics` каждого backend instance напрямую, а не
через балансируемый endpoint. Стартовые правила алертов находятся в
`../../infrastructure/observability/dmb-alerts.yml`. `X-Request-ID` и
`X-Trace-ID` из ответа следует сохранять в reverse-proxy/application logs для
корреляции с `audit_log` и OpenTelemetry trace.

При появлении dead-letter события оператор сначала фиксирует `id`, `event_type`,
`payload` и `last_error`, устраняет причину, а затем переотправляет только эту
строку. Безопасная операция повторной постановки: очистить `dead_lettered_at`,
`claim_token`, `claimed_at` и `last_error`, сбросить `attempts` в `0`, установить
`available_at=NOW()`. Массовая очистка dead letter запрещена: событие может быть
невалидным по данным, и без исправления оно снова заблокирует доставку.
Для replay используется страница `#/outbox-dead-letters`, API
`POST /api/v1/admin/outbox/dead-letters/{id}/requeue` либо `manage_outbox.py`.

Секреты и адрес БД должны задаваться владельцем окружения; реальные значения в
документацию и репозиторий не помещаются.

## Стендовая поставка и внешние решения

В репозитории есть Dockerfile обоих Python-сервисов,
`compose.production.yaml`, Nginx, Prometheus/alerts, OpenTelemetry Collector,
Jaeger и read-only smoke/load/failover/backup scripts. Compose предназначен для
воспроизводимого стенда и запускает по две реплики backend и agent.

Корпоративные домен/TLS, secret store, HA PostgreSQL/Redis, RPO/RTO, retention,
централизованное хранилище трасс и итоговые capacity-параметры остаются решениями
целевой инфраструктуры. Их нельзя считать закрытыми наличием Compose baseline.

Изменение структуры БД регулирует [SCHEMA_CHANGES.md](SCHEMA_CHANGES.md), а
проверки перед выпуском — [TESTING.md](TESTING.md).

Assistant V2 не входит в стандартный или production Compose baseline. Локально
он запускается только корневым `scripts/start-project.ps1 -IncludeAssistantV2`,
который создаёт отдельную DB/роль, применяет отдельный Alembic и поднимает порт
9200. Real-data/provider/production gates остаются закрытыми; operator runbook:
[`../../assistant-v2/docs/OPERATIONS.md`](../../assistant-v2/docs/OPERATIONS.md).

## Feature flag канбана — проверено 21.10.2026

`WORK_TASK_BOARD_ENABLED` по умолчанию `false`; локальный пилот включён через `.env`. После изменения требуется штатный перезапуск backend. При `true` доступен новый вид рабочих задач и старый внутренний `#/kanban` перенаправляется на него. При `false` остаются список/сводка и прежний канбан, API новой доски возвращает 404. Откат флага не удаляет задачи или историю и не требует downgrade БД. Полная нагрузочная приёмка перед внешним выпуском остаётся отдельной проверкой: [WORK_BOARD.md](WORK_BOARD.md).
