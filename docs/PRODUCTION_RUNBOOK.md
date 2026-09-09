# Production runbook многопользовательского стенда

> Стендовый baseline проверен по Compose, Nginx, observability и operator scripts
> 07.09.2026. Фактический запуск на целевом стенде подтверждается отдельным протоколом.

Production Compose использует три отдельные PostgreSQL-БД: `dmb_backlog`,
`agent_sessions` и `prioritiser`. Схема Prioritiser накатывается одноразовым
`prioritiser-migration` через Alembic. Вложения проходят ClamAV до создания
записи в БД; недоступный сканер блокирует загрузку с 503.

`/api/v1/health` — liveness. `/api/v1/health/ready` дополнительно проверяет БД,
Redis, общее хранилище и readiness BA Agent/Prioritiser (`/api/agent/ready`,
`/ready`).

## Назначение

Этот runbook описывает поставляемую в репозитории Docker Compose-топологию для
стенда: две реплики backend, две реплики agent, отдельный scheduler, PostgreSQL,
Redis, Nginx, Prometheus, OpenTelemetry Collector и Jaeger. TLS завершается на
внешнем корпоративном ingress/load balancer; Nginx из Compose по умолчанию
слушает только `127.0.0.1:8080`.

Топология является воспроизводимым стендовым baseline, а не заменой
корпоративных HA PostgreSQL/Redis, secret storage, encrypted backup storage и
централизованной observability-платформы.

## 1. Предпосылки

- Docker Engine и Docker Compose v2;
- внешний HTTPS origin и TLS ingress;
- согласованные PostgreSQL/Redis пароли и URL с percent-encoded credentials;
- уникальные `SECRET_KEY`, общий `AGENT_SECRET`, `DMB_PRIORITISER_SECRET` и
  отдельный `DMB_PRIORITISER_METHODOLOGIST_SECRET`;
- реальный OpenAI-compatible LLM endpoint/model/key;
- каталог вне репозитория для env-файла и зашифрованное backup-хранилище;
- заранее заведённые владельцем системы пользователи/роли/команды.
- закрытая внутренняя сеть для `agent:9000` и `prioritiser:9100`; service secrets
  дополняют сетевую изоляцию, но не заменяют TLS ingress и корпоративную identity.

Проект не создаёт и не изменяет пользователей, роли, команды и справочники при
развёртывании. `RUN_STARTUP_SEED=false` и `RUN_STARTUP_MAINTENANCE=false`
зафиксированы в manifest.

## 2. Конфигурация и валидация

Использовать `.env.production.example` только как перечень полей. Рабочий файл
с секретами хранить вне repository, например `C:\secure\dmb-production.env`.
В `DMB_DATABASE_URL`, `DMB_AGENT_SESSION_DATABASE_URL` и `DMB_REDIS_URL`
зарезервированные символы credentials должны быть percent-encoded.

Статическая проверка Compose, Nginx и OpenTelemetry Collector:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/validate-production-config.ps1
```

Сценарий использует только временные validation-значения в окружении процесса и
не пишет секреты на диск. Для проверки контейнерных конфигураций Docker Engine
должен быть доступен.

## 3. Запуск и обновление

Из корня проекта:

```powershell
docker compose --env-file C:\secure\dmb-production.env -f compose.production.yaml build
docker compose --env-file C:\secure\dmb-production.env -f compose.production.yaml up -d
docker compose --env-file C:\secure\dmb-production.env -f compose.production.yaml ps
```

Одноразовый сервис `migration` выполняет `alembic upgrade head`; backend не
стартует до его успешного завершения. Каждый контейнер приложения содержит один
Uvicorn worker, а параллелизм обеспечивается репликами Compose. Это позволяет
балансировщику и оркестратору независимо проверять и заменять экземпляры.

Доступы по умолчанию:

- приложение через ingress к `127.0.0.1:8080`;
- Prometheus — `127.0.0.1:9090`;
- Jaeger UI — `127.0.0.1:16686`.

Prometheus и Jaeger нельзя публиковать наружу без отдельной аутентификации.

## 4. Smoke и нагрузка без мутаций

Публичный read-only smoke:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify-multiuser-stand.ps1 `
  -BaseUrl https://dmb.example.internal `
  -ConcurrentRequests 50 `
  -ReportPath C:\evidence\multiuser-smoke.json
```

Для проверки областей доступа передать заранее выданные access-токены разных
профилей через `-AccessTokens`. Сценарий вызывает только GET и не меняет данные.

Read-only k6 baseline:

```powershell
$env:BASE_URL='https://dmb.example.internal'
$env:ACCESS_TOKENS='token-profile-a,token-profile-b'
$env:TARGET_VUS='20'
k6 run infrastructure/load/k6-readonly.js
```

Без токенов профиль нагружает readiness; с токенами — чтение списка задач в
области каждого профиля. Целевые VU, длительность и SLA утверждаются владельцем
стенда, а не выводятся из локального теста.

Проверка доступности при отказе одной backend-реплики:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test-backend-failover.ps1 `
  -EnvFile C:\secure\dmb-production.env `
  -BaseUrl http://127.0.0.1:8080
```

Сценарий штатно останавливает одну реплику, выполняет readiness-запросы через
Nginx и обязательно запускает реплику обратно в `finally`.

## 5. Наблюдаемость

Backend и agent передают трассы по OTLP/HTTP в Collector. Collector отправляет
их в persistent single-node Jaeger и одновременно пишет краткую debug-сводку.
Backend автоматически инструментирует FastAPI, SQLAlchemy и вызовы agent через
urllib. `trace_id` возвращается в `X-Trace-ID`, сохраняется в `audit_log` и
доступен в полном admin-журнале вместе с `X-Request-ID`.

Prometheus через DNS service discovery скрейпит все backend-реплики напрямую.
Правила `infrastructure/observability/dmb-alerts.yml` должны быть подключены к
Alertmanager целевого стенда. Jaeger/Prometheus volumes обеспечивают переживание
перезапуска, но retention/capacity и внешний archival остаются настройками
владельца инфраструктуры.

## 6. Dead-letter outbox

Полный администратор видит `#/outbox-dead-letters`. Перед replay необходимо
устранить причину `last_error`, затем повторить только одну строку. API требует
текущее число `attempts`, ставит row lock, очищает claim/error, сбрасывает
attempts и пишет audit в одной транзакции. Повтор устаревшего запроса получает
`409`.

CLI для аварийного доступа из backend-контейнера:

```powershell
docker compose --env-file C:\secure\dmb-production.env -f compose.production.yaml exec backend python manage_outbox.py list --limit 50
docker compose --env-file C:\secure\dmb-production.env -f compose.production.yaml exec backend python manage_outbox.py requeue 123 --expected-attempts 10 --yes
```

Массовое удаление или replay не предусмотрены намеренно.

## 7. Backup и проверка

Создание согласованного набора PostgreSQL dumps, uploads archive и archive
остановленного volume Prioritiser:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/backup-production.ps1 `
  -EnvFile C:\secure\dmb-production.env `
  -OutputDirectory E:\encrypted-backups\dmb `
  -QuiesceApplications
```

Проверка SHA-256 и читаемости форматов без восстановления:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify-backup.ps1 `
  -ManifestPath E:\encrypted-backups\dmb\manifest_YYYYMMDDTHHMMSSZ.json
```

Сценарий сначала останавливает Nginx, Prioritiser и все writers, а в `finally`
запускает их обратно; это даёт согласованный cross-database/uploads/Prioritiser
момент ценой короткого
окна недоступности. Online snapshot требует отдельной реализации на целевой
storage-платформе. Backup содержит рабочие данные и должен немедленно переноситься в encrypted
storage с ограниченным доступом. Полноценный restore drill выполняется только в
изолированных БД/volumes по `docs/dev-testing/BACKUP_RESTORE_TESTING.md`: live
БД не является допустимой restore target. Факт `pg_restore --list` не заменяет
проверку RPO/RTO и запуска восстановленного приложения.

## 8. Остановка и откат

Остановка приложений без удаления volumes:

```powershell
docker compose --env-file C:\secure\dmb-production.env -f compose.production.yaml stop
```

`docker compose down -v` запрещён для стенда: он удаляет persistent volumes.
Откат приложения выполняется предыдущим immutable image/tag только после
проверки совместимости текущей Alembic revision. Downgrade миграции не выполняют
автоматически.

## 9. Внешние release gates

Репозиторий не может выбрать вместо владельца стенда:

- домен, TLS и сетевые политики;
- secret store и ротацию секретов;
- HA/репликацию PostgreSQL и Redis;
- RPO/RTO, backup retention и off-site storage;
- число пользователей, целевой VU/RPS и SLA;
- реальные тестовые профили доступа и безопасную область обычных данных;
- production LLM model, квоты и бюджет.

До закрытия этих решений и фактических smoke/load/failover/restore прогонов
пользовательский допуск остаётся `NO-GO`, даже если unit-тесты зелёные.
