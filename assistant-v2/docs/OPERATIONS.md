# Operations runbook AI Assistant V2

Статус: AS-IS для локального dev/synthetic контура, 19.09.2026.

## Start, status, stop

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1 -IncludeAssistantV2
powershell -ExecutionPolicy Bypass -File scripts/project-status.ps1
powershell -ExecutionPolicy Bypass -File scripts/stop-project.ps1
```

Сценарий создаёт/проверяет отдельные роль и DB, окружение
`.venv-assistant-v2`, выполняет Alembic и ждёт `http://127.0.0.1:9200/ready`.
Логи: `.runtime/assistant-v2.out.log` и `.runtime/assistant-v2.err.log`.

## Readiness и наблюдаемость

- `/health` — liveness и состояние kill switch;
- `/ready` — отдельные DB, migration head и manual/provider mode;
- `/metrics` — bounded labels `method`, route template и status class; IDs,
  email, source, prompt и body в labels отсутствуют;
- DMB `/api/v1/health/ready` показывает `assistant_v2`, но не становится `503`
  только из-за него.

## Kill switch и degraded mode

Установить `ASSISTANT_V2_ENABLED=false` в DMB и V2, перезапустить процессы.
Основные V1 routes, DB, agent на 9000 и frontend продолжают работать. При
недоступном V2 gateway возвращает bounded `503`. При выключенном provider V2
работает в manual-safe режиме и не совершает внешние LLM-вызовы.

## Backup/restore и production stop gate

Для локального dev backup допустим штатным `pg_dump` DB `assistant_v2`, restore —
в новую пустую DB с последующей проверкой Alembic head и digest/lineage тестами.
RPO/RTO, encrypted backup storage, expiry, alert thresholds и drills не
утверждены. До их утверждения и документированного restore drill production и
real-data pilot запрещены конфигурационными gates.
