# Запуск и развёртывание — подтверждённое состояние

> Статус: обновлено 2026-09-01. Локальный запуск описан ниже; воспроизводимая
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
