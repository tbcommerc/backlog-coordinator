> Исторический документ удалённого прототипа. Команды и API ниже больше не действуют; актуальный V2 находится в `agent-v2/`.

# ADR-0001: изоляция процесса и запуска

Статус: принято для dev/synthetic контура 19.09.2026.

Assistant V2 — отдельный FastAPI-процесс на `127.0.0.1:9200`, отдельная роль и
PostgreSQL DB `assistant_v2`, отдельный Alembic и отдельное Python-окружение.
Browser обращается только к DMB gateway `/api/v2/assistant`. V2 не получает URL
или credentials основной DMB DB. Единственный доступ к DMB — versioned adapter.

Kill switch — `ASSISTANT_V2_ENABLED=false`; при нём DMB не импортирует и не
регистрирует V2 gateway/adapter, frontend bundle не загружается. Запуск opt-in:
`-IncludeAssistantV2`. DMB readiness показывает V2 как non-blocking dependency.
Rollback не выполняет downgrade: выключается flag и процесс, данные сохраняются.

Production topology, SLO и release approval остаются открытыми и не следуют из
этого dev-решения.
