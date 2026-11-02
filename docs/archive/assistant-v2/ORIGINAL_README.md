> Исторический документ удалённого прототипа. Команды и API ниже больше не действуют; актуальный V2 находится в `agent-v2/`.

# DMB AI Assistant V2 — legacy-прототип

Статус: устаревший прототип; в согласованные пять агентов не входит. Экспериментальный бизнес-аналитик V2 реализован в `agent-v2/`. [Каталог агентов](../../AGENT_CATALOG.md).

Изолированный opt-in контур для фиксации поручений, подготовки бизнес-требований
и human-approved предложений изменений DMB. Сервис не импортирует V1, не имеет
credentials к основной базе DMB и не изменяет DMB напрямую.

## Безопасный локальный режим

По умолчанию сервис выключен. Полный локальный запуск выполняется из корня:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1 -IncludeAssistantV2
```

Проверено по маршрутизатору и скрипту запуска 17.10.2026: отдельной пользовательской страницы этого прототипа нет; `#/assistant-v2` перенаправляется на `#/agent-v2` — [целевой fork](../../../agents/business-analyst-experimental/README.md). Флаг выше запускает диагностический legacy-сервис, а не отдельный UI.

Доступ к legacy API ограничивают `ASSISTANT_V2_PILOT_USER_IDS` или
`ASSISTANT_V2_PILOT_EMAILS` в `dmb-backlog/.env`. Пустой allowlist
возвращает `403`. Реальные данные и LLM provider по умолчанию запрещены; до
закрытия privacy/provider решений доступен deterministic manual-safe режим.

Адреса при opt-in запуске:

- сервис: `http://127.0.0.1:9200`;
- OpenAPI: `http://127.0.0.1:9200/docs`;
- readiness: `http://127.0.0.1:9200/ready`;
- public browser API: `http://127.0.0.1:8000/api/v2/assistant`.

## Проверки

```powershell
cd legacy/assistant-v2
..\..\.venv-assistant-v2\Scripts\python.exe -m pytest -q
```

Схема меняется только собственным Alembic. Из корня репозитория:

```powershell
Push-Location legacy/assistant-v2
try {
    ..\..\.venv-assistant-v2\Scripts\python.exe -m alembic -c alembic.ini upgrade head
} finally {
    Pop-Location
}
```

Документы: [`docs/OPERATIONS.md`](docs/OPERATIONS.md),
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md),
[`docs/PILOT_PROTOCOL.md`](docs/PILOT_PROTOCOL.md) и
[Описание реализации](IMPLEMENTATION.md).
