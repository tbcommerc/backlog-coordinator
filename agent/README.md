# DMB AI Business Analyst Assistant

Агентный AI Business Analyst для сбора бизнес-требований к платформе
сопровождения инвестиционных сделок. Агент — самостоятельный FastAPI-сервис;
DMB Backend обращается к нему через HTTP API с секретом `X-Agent-Secret`.

## Принципы

- **Модель управляет диалогом.** Один structured LLM-вызов извлекает факты,
  понимает ответ в контексте и выбирает следующий содержательный вопрос.
  Python отвечает только за безопасность, валидацию, хранение, аудит и workflow.
- **Human-in-the-loop.** Агент никогда не утверждает требование. Он формирует
  `Draft` и отправляет на ревью; финальное решение — за PO/BA.
- **Auditability.** Каждый диалог, отказ, драфт и отправка на ревью пишутся
  в `agent_logs/audit.log`.

## Запуск

```bash
pip install -r requirements.txt
python run.py              # агент на http://127.0.0.1:9000
python -m pytest agent/tests -q
# Отдельный E2E-прогон против уже запущенного сервиса:
python tests/e2e_scenarios.py --quick
```

Конфигурация — `.env` (см. `.env.example`) или переменные окружения:
`LLM_PROVIDER` (`mock` по умолчанию | `openai_compat`),
`AGENT_SECRET`, `AGENT_PORT`, `SESSION_DB`. Полный перечень и значения для
локального запуска приведены в `.env.example`.

## API

Все эндпоинты требуют заголовок `X-Agent-Secret`.

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/agent/chat` | Отправить сообщение пользователя (`session_id`, `message`, `context`) |
| POST | `/api/agent/new-session` | Создать сессию (`user_id`, `context`) |
| POST | `/api/agent/reset` | Удалить сессию (`session_id`) |
| GET  | `/api/agent/session/{session_id}` | Получить текущее состояние сессии |
| GET  | `/api/agent/sessions?user_id=…` | Получить сессии пользователя |
| POST | `/api/agent/session/{session_id}/archive?archived=…` | Архивировать или восстановить сессию |
| POST | `/api/agent/send-for-review` | Подтвердить отправку драфта на ревью (`session_id`, `task_id`, `title`) |
| POST | `/api/agent/edit-draft-section` | Изменить поле готового драфта (`session_id`, `field`, `value`) |
| GET  | `/api/agent/config` | Провайдер, интенты, статистика KB, MCP-серверы, инструменты |

Ответ — `AgentResponse`:
`session_id`, `action`, `message`, `blocks` (draft_preview / actions),
`phase`, `slots`, `progress`, `draft`, `can_generate_draft`.

Действия (`action`): `welcome`, `domain_clarify`, `reflect`, `reflect_correction`,
`question`, `clarify`, `incident_triage`, `summarize`, `edit`, `draft_ready`,
`sent`, `out_of_domain`, `refused`, `ended`.

## Сценарии

- **Основной поток**: свободное описание → извлечение всех фактов из реплики →
  один наиболее полезный контекстный вопрос → резюме → подтверждение →
  `draft_ready` → `send-for-review`.
- **Быстрый путь**: после заполнения минимального ядра пользователь может свободным
  текстом попросить сформировать черновик; остальные пробелы попадут в открытые вопросы.
- **Редактирование**: готовый драфт можно вернуть на правки без создания новой сессии.
- **Инцидент**: короткий путь — описание → триаж → драфт дефекта.
- **Разъяснение**: вопрос из базы знаний → ответ с источниками → «оформить запрос?».
- **Защита**: out-of-domain конфайнмент (3 попытки → эскалация), отказ на
  prompt injection / PII / запрещённые действия.

## Структура

```
agent/
  api/            HTTP API (router, schemas)
  composer/       сборка драфта требования (JSON + markdown)
  dialogue/       state machine, экстрактор, планировщик, генератор, БЗ вопросов
  guardrails/     входной/выходной harness, политики
  kb/             база знаний, онтология, retrieval, история требований
  llm/            фабрика провайдеров (mock, openai_compat)
  mcp/            фреймворк MCP (заглушки)
  tools/          внешние инструменты (заглушки)
  workflow/       ревью-воркфлоу (заглушки)
  kb_seed/        исходные документы БЗ (products, modules, processes, roles, …)
  prompts/        системный промпт для LLM-провайдера
  tests/          pytest (160 проверок)
```

Каталог верхнего уровня `tests/` содержит отдельный live E2E-сценарий. Он не
входит в обычный запуск `pytest` и требует предварительно запущенного сервиса.
