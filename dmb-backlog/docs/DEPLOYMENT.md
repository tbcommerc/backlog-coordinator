# Запуск и развёртывание — подтверждённое состояние

> Статус: проверено по `backend/config.py`, `backend/main.py`, `.env.example`,
> зависимостям и CI на 2026-08-24. Production-топология в репозитории не задана.

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

При `DEBUG=false` запуск отклоняет пустой, стандартный или короче 32 символов
`SECRET_KEY`, а также пустой или стандартный `AGENT_SECRET`. Если три флага
`RUN_*` не заданы явно, каждый наследует значение `DEBUG`.

Для окружения без dev-мутаций следует явно задавать:

```env
DEBUG=false
RUN_STARTUP_SEED=false
RUN_STARTUP_MAINTENANCE=false
RUN_NOTIFICATION_SCHEDULER=false
```

Секреты и адрес БД должны задаваться владельцем окружения; реальные значения в
документацию и репозиторий не помещаются.

## Что не подтверждено

В репозитории нет поддерживаемых `Dockerfile`, `docker-compose.yml`, Kubernetes-
манифестов, systemd unit или Nginx-конфигурации. Не зафиксированы production ОС,
домен, reverse proxy, TLS, backup-процедура, staging-среда и поддерживаемая СУБД
помимо фактической конфигурации через SQLAlchemy URL.

Поэтому команды создания инфраструктуры, production-учётные данные и обещания
совместимости с PostgreSQL не должны выводиться из этого документа. Перед реальным
развёртыванием нужен отдельный согласованный runbook, проверенный в целевом
окружении.

Изменение структуры БД регулирует [SCHEMA_CHANGES.md](SCHEMA_CHANGES.md), а
проверки перед выпуском — [TESTING.md](TESTING.md).
