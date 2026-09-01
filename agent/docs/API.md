# AI Business Analyst Agent — API Reference

> AS-IS проверено по `agent/api/router.py`, `agent/api/schemas.py`, session store
> и API-тестам 01.09.2026.

## Назначение и адреса

Agent — внутренний FastAPI-сервис на `127.0.0.1:9000`. DMB Backend обращается к
нему по HTTP; браузер не должен вызывать Agent напрямую.

- Swagger UI: `/docs`;
- OpenAPI: `/openapi.json`;
- health: `GET /api/agent/health`;
- прикладной prefix: `/api/agent`.

Health не требует секрета. Все остальные прикладные endpoint требуют точное
значение `X-Agent-Secret`. В production endpoint Agent публикуется только во
внутреннюю сеть Compose/оркестратора.

## Endpoint registry

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/api/agent/chat` | Обработать сообщение и вернуть состояние диалога |
| `POST` | `/api/agent/new-session` | Создать новую сессию пользователя |
| `POST` | `/api/agent/reset` | Удалить сессию |
| `GET` | `/api/agent/session/{session_id}` | Получить текущее состояние |
| `GET` | `/api/agent/sessions?user_id=…` | Список сессий пользователя |
| `POST` | `/api/agent/session/{session_id}/archive?archived=…` | Архивировать или восстановить сессию |
| `POST` | `/api/agent/send-for-review` | Подтвердить драфт и связать его с request/task |
| `POST` | `/api/agent/reopen-review` | Вернуть отправленный драфт в диалог |
| `POST` | `/api/agent/edit-draft-section` | Изменить разрешённое поле готового драфта |
| `GET` | `/api/agent/config` | Runtime provider, intents, KB и integration registry |

Точный request/response контракт публикуется OpenAPI. Этот документ фиксирует
сквозные правила, которые нельзя надёжно вывести только из списка полей.

## Chat

Минимальный запрос:

```json
{
  "session_id": "session-123",
  "message_id": "client-message-001",
  "message": "Нужно автоматизировать сверку статусов расчётов",
  "context": {
    "user_id": 42
  }
}
```

`message` ограничен 4000 символами, `message_id` — 64. DMB Backend генерирует
стабильный `message_id`: повтор одного сообщения возвращает сохранённый ответ и
не добавляет вторую запись в историю.

Основные поля `AgentResponse`:

- `session_id`, `action`, `message`, `phase`;
- `blocks` — UI-блоки, включая preview и actions;
- `slots`, `progress`, `expected_slot`;
- `draft`, `quality`, `can_generate_draft`;
- `history`, `request_id`.

`action` описывает следующий шаг UI, а не HTTP-статус. Фактический набор
определяет orchestrator и покрывается API-тестами.

## Сессии и конкурентность

Session store использует SQLAlchemy. Для production `SESSION_DATABASE_URL`
обязан указывать на PostgreSQL; SQLite допустим только в debug/изолированных
тестах.

- каждая строка имеет CAS-версию;
- mutation одной сессии сериализуется PostgreSQL advisory lock;
- повтор `message_id` идемпотентен;
- список сессий изолирован по `user_id`;
- archive не удаляет историю.

Эти гарантии позволяют запускать две реплики Agent из
`compose.production.yaml` без process-local состояния диалога.

## Review workflow

`send-for-review` принимает `session_id`, числовой `task_id`, `title` и
необязательный `user_id`. Операция требует готового подтверждённого draft.

`reopen-review` принимает `session_id`, необязательный `user_id` и комментарий
до 5000 символов. Возврат снова делает диалог редактируемым; история и audit
сохраняются.

`edit-draft-section` принимает только разрешённое имя поля и значение до 5000
символов. После правки качество и presentation пересчитываются по текущему
draft.

## Context

`context` преобразуется в `UserContext`. Неизвестные или недоверенные поля не
должны использоваться для повышения прав. Авторизацию пользователя выполняет
DMB Backend; shared secret подтверждает сервисный вызов, а не роль человека.

## Ошибки

- `403` — отсутствующий или неверный `X-Agent-Secret`;
- `404` — сессия не найдена;
- `409` — конфликт версии/состояния, который нельзя безопасно повторить;
- `422` — ошибка Pydantic или нарушенное бизнес-условие endpoint;
- `500` — необработанная ошибка runtime.

DMB Backend преобразует недоступность/timeout Agent в контролируемый ответ proxy.
Секреты, системные промпты и сырые исключения не должны возвращаться клиенту.

## Наблюдаемость

При `OTEL_ENABLED=true` Agent инструментирует FastAPI, SQLAlchemy и urllib,
отправляет OTLP/HTTP traces и добавляет `X-Trace-ID`. Endpoint Prometheus у Agent
не реализован; HTTP-метрики proxy фиксирует DMB Backend. Health исключён из
трассировки по умолчанию.

Agent не настраивает CORS и rate limiting: он не является публичным browser API.
Сетевое ограничение, TLS и внешний rate limit обеспечиваются ingress/backend.

## Проверка

Из каталога `agent`:

```powershell
..\.venv\Scripts\python.exe -m pytest agent\tests -q -p no:cacheprovider
```

На 01.09.2026 collection содержит 230 тестов. Отдельный live E2E запускается
только против заранее поднятого сервиса и фиксирует результат в датированном
отчёте; исторический отчёт не заменяет текущие unit/integration tests.

## Связанные документы

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [PRODUCT_DIALOGUE_SPEC.md](PRODUCT_DIALOGUE_SPEC.md)
- [QUALITY_MODEL.md](QUALITY_MODEL.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
