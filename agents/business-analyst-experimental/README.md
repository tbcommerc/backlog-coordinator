# Агент бизнес-аналитик — экспериментальная версия

Роль: бизнес-аналитик V2 — экспериментальная версия первого агента. [Каталог агентов](../../docs/AGENT_CATALOG.md).

> Документный цикл проверен по коду и изолированным тестам 09.10.2026;
> выполнен синтетический LLM-smoke генерации и ревью; полный цикл на рабочем стенде не перепроверен.
> Исправления аудита: [результаты](../../docs/dev-testing/AGENT_V2_UX_UI_FIXES_2026-10-09.md).

Изолированный fork сервиса `agents/business-analyst/` для пилотной работы BA/PO. V1 не импортируется во время выполнения; V2 использует собственную БД.
Старый самостоятельный прототип удалён 02.11.2026; [сравнение](../../docs/AGENT_V2_RETIREMENT_2026-11-02.md).

Два продуктовых режима:

- `assignment_capture` — фиксирует исходное поручение и выпускает
  `AssignmentPassport`;
- `requirement_copilot` — написание БТ по источникам, предложения правок,
  независимое AI-ревью и доработка `BusinessRequirementDraftV2`.

Человеческое согласование фиксирует отдельную неизменяемую редакцию
`RequirementReview` в DMB, доступную в общей очереди на вкладке «Редакции БТ».
Оно не создаёт повторный запрос или задачу. Недоступность модели помечается
`degraded`, решения и применение предложенных правок остаются за человеком.
Состав MVP и границы: [реализация](../../docs/agent-v2-implementation.md).

## Границы безопасности

- в конфигурации сервиса исходно `AGENT_V2_ENABLED=false`; стандартный launcher обязательно включает и запускает V2 (проверено 12.10.2026);
- отдельные kill switch, pilot allowlist, secret, порт `9300` и PostgreSQL DB;
- доверенные `user_id` и роль BA/PO формирует только DMB gateway;
- связанный объект передаётся как авторизованный read-only snapshot;
- `ProposedPatch` — только preview с решением человека по каждой операции;
- прямого клиента записи в DMB в пакете нет;
- пользователи, роли, команды, справочники и назначения не изменяются.

## Запуск

Из корня репозитория:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1
```

После health-check доступны:

- UI: `http://127.0.0.1:8000/#/agent-v2`;
- OpenAPI сервиса: `http://127.0.0.1:9300/docs`;
- health: `http://127.0.0.1:9300/api/agent-v2/health`;
- readiness: `http://127.0.0.1:9300/api/agent-v2/ready`.

Пункт «ИИ-ассистент V2» и отдельная страница `#/agent-v2` видны всегда.
Если сервис выключен или профиль не допущен, страница показывает статус и
не вызывает gateway. Полный администратор допускается автоматически и получает
trusted context BA без изменения своей RBAC-роли. Для доступа остальных BA/PO
нужно явно добавить пользователя в `AGENT_V2_PILOT_USER_IDS` или
`AGENT_V2_PILOT_EMAILS` файла `dmb-backlog/.env`.

Изолированный диагностический запуск из `agents/business-analyst-experimental/`:

```powershell
python -m pip install -r requirements.txt
python run.py
python -m pytest business_analyst_experimental/tests -q -p no:cacheprovider
```

## API и документация

Подключение OpenCode Go по API-ключу, выбор модели и проверка реального JSON-ответа
описаны в [эксплуатации](docs/OPERATIONS.md#opencode-go-через-api-ключ).
Для отдельных настроек V2 используйте `AGENT_V2_INHERIT_V1_LLM=false`,
чтобы корневой launcher не заменял их настройками V1.

Внутренний API сервиса расположен под `/api/agent-v2`; браузер обращается
только к аутентифицированному gateway `/api/v2/agent` DMB backend.

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/API.md`](docs/API.md)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- [`docs/TESTING.md`](docs/TESTING.md)
- [`FORK_PROVENANCE.json`](FORK_PROVENANCE.json)

Скопированные документы V1 в `docs/` являются baseline fork и не заменяют
перечисленные выше V2-профили.
