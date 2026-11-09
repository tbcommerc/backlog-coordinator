# Удалённые инструменты оценщика, контракт 1.0

Проверено 04.11.2026 по HTTP router, Python-ядру, JavaScript bridge и PostgreSQL
suite. Это готовность сетевых tools. Полная квалификация remote OpenCode runtime
и настоящего сервера по-прежнему не заявлена.

## Граница ответственности

Доверенный coordinator создаёт grant для конкретных run UUID, subject, задачи
и роли `strategy-analyst` либо `dependency-analyst`. Browser и модель не получают
coordinator/admin secret. Runtime получает только короткоживущий tool token.
Для разных ролей нужны изолированные runtime; общая среда с двумя токенами
не является границей безопасности.

Публичные `/agent/value*`, `/agent/priority*` сохраняются. Инструменты доступны
под `/internal/tools/v1`, с прежней service authentication на управляющих
операциях и отдельным Bearer token на `/call`.

## Контракт

1. Coordinator получает `GET /snapshots/{task_key}` с `X-Prioritiser-Secret`.
   Ответ содержит только task_key, source_hash и contract_version.
2. `POST /grants` с тем же service credential: run_id, subject, role, task_key,
   ожидаемый source_hash, allowed_evidence. Родительский run обязан существовать,
   иметь статус running, действующий deadline, того же actor/subject и source.ref
   задачи. При чужом контексте — 403, неактивном parent или изменившемся входе — 409.
3. Ответ содержит grant_id, token, expires_at и разрешённые операции. Token
   возвращается только здесь, в БД хранится SHA-256 digest. TTL — не более 180 секунд и не позже deadline родителя.
4. Runtime вызывает `POST /call` с `Authorization: Bearer <scoped-token>`:
   run_id, call_id, operation и строго типизированные аргументы.
5. `POST /grants/{grant_id}/revoke` требует coordinator secret и идемпотентен.
   Отзыв немедленно закрывает дальнейшие вызовы и чтение receipts.

| Tool | Роль | Аргументы | Результат / ядро |
|---|---|---|---|
| rubric-read | F5/F6 | Необязательный свой factor | Только рубрика роли / get_reference |
| assessments-read | F5/F6 | Необязательная привязанная task_key | Существующие оценки / assessment_summary |
| strategy-assess | Только F5 | answers, rationale, evidence | score_strategy; staged candidate и receipt |
| dependency-assess | Только F6 | teams, rationale, evidence | score_dependencies; staged candidate и receipt |

Схемы и соответствие функций зафиксированы в
[manifest](../.opencode/remote-tools.manifest.json). `attribution-run`, изменение
справочников, произвольные shell/SQL/URL/пути/identity и чтение K3 в этот профиль
не входят. Чужие run/task/factor/evidence отклоняются сервером, независимо от prompt.

## Повторы, изменения и транзакции

Grant ограничен source_hash входных атрибутов задачи и hash рубрики. Изменившийся
вход/рубрика дают 409 до применения; повтор receipt тоже перепроверяет доступ.
F5 grant не может записать F6. Историю предыдущих оценок сохраняет существующий store.

Tool-транзакция блокирует grant, родительский run и task; сохраняет только
проверенного кандидата и receipt `(grant_id, call_id)`, возвращая `status=staged`.
Активные FactorAssessment, поля Task и производный приоритет на этом шаге
не меняются. Один call_id с тем же нормализованным запросом возвращает прежний
результат; с другим телом — 409. После отмены parent запрещены и поздние вызовы,
и публикация уже подготовленного кандидата.

Внутренний `promote_staged` вызывается работником в одной транзакции с финальным
CAS родительского запуска. Он повторно проверяет parent, срок и отзыв grant,
source_hash и рубрику, пересчитывает оценку тем же ядром и только затем сохраняет
активный фактор и приоритет. Ошибка или проигранный финальный CAS откатывают
предметные изменения; исходная staged-квитанция остаётся для диагностики.
Модель и внешний tool token не имеют операции публикации. Отзыв grants выполняется
после публикации либо при отказе/отмене; отозванный кандидат не публикуется.
Лимит — 12 успешных вызовов
на grant; повтор существующего receipt не расходует ещё один слот.

CLI и HTTP используют общий `recompute_factor_priority`: те же `score_task`,
ScoringContext и правила истории. Factor-only операция не пересчитывает Value,
не вызывает модель/оценку соседнего фактора и не строит embeddings/AnalogyIndex.
Это устраняет прежний побочный путь `recompute_task(use_llm=False)`, который
не запрещал вложенную оценку отсутствующего фактора.

## Подготовка и запуск

Перед запуском обычного сервиса требуется собственный PostgreSQL DSN и явная
`python -m alembic upgrade head` из каталога оценщика. Новая revision
`20261102_01` добавляет только технические grants/receipts, без seed и правок
справочников. Downgrade не удаляет историю: откат — совместимым приложением.
Корневой launcher выполняет миграцию только при `-IncludeValuePriorityAssessor`.

Обычный сервис отвергает SQLite/mock до startup. Исключение — явно включённый
`PRIORITISER_UNIT_TEST_MODE=true` совместно с DEBUG=true для изолированных tests.
Production не принимает известные default service/methodologist secrets.

Для HTTP-режима существующих OpenCode tools controller задаёт в изолированном
runtime `PRIORITISER_TOOL_MODE=http`, `PRIORITISER_TOOL_BASE_URL`,
`PRIORITISER_TOOL_TOKEN`, `PRIORITISER_TOOL_RUN_ID`. Token/run не сохраняются
в общем `.env`. Межхостовый base URL требует HTTPS; HTTP разрешён только loopback.
Redirect запрещён. Ошибка HTTP не включает fallback к CLI. `cli` остаётся
явным режимом совместимости; остальные команды в HTTP-профиле отклоняются.
Полный Python-проект рядом с OpenCode не требуется.

## Проверки и оставшаяся работа

```powershell
python -m pytest tests/test_remote_tools.py tests/test_factor_priority.py tests/test_runtime_configuration.py tests/test_state_migration.py --noconftest -q
node --test tests/remote-tools.test.mjs
python -m pytest remote_tool_tests --noconftest -q
```

PostgreSQL suite требует явный `ASSESSOR_TOOL_TEST_DATABASE_URL` на disposable
БД и создаёт только случайные `tool_test_*` схемы с техническими/рабочими
таблицами. Protected fixtures и seed не вызываются. CI использует отдельный
минимальный `requirements-tools-test.lock`, без torch и embeddings.

Ещё требуются подключение grants к controller жизненного цикла агента,
полный reference emulator/runtime профиль с tools и retention grants/receipts.
Реальный сервер — `not_verified`. Эта поставка не изменяет ключи/модель Go
оценщика и не устраняет ранее зафиксированный HTTP 429.


## Перенос собственной истории SQLite → PostgreSQL

Команда `python -m value_priority_assessor.migrate_state --source <old.db>
--verified-backup-file <verified.db> --output <safe-report.json> --apply`
получает target DSN только через `PRIORITISER_MIGRATION_TARGET_URL`, не argv.
Без `--apply` выполняется read-only план. Target schema готовится отдельной
Alembic-командой. Источник открыт read-only; исходный SQLite не удаляется.

Переносятся только task, priority_history, factor_assessment, llm_call,
agent_request, attribution_run. Справочники никогда не копируются: несовпадение
их снимков блокирует перенос до записи. Непустая чужая/отличающаяся целевая БД
отклоняется; идентичная история распознаётся как replay. В одной транзакции
сверяются counts и нормализованные hashes, сохраняются IDs/JSON/audit и
продолжаются PostgreSQL serial sequences. Схемы с чужими таблицами и превышение
row budget отклоняются. Проверка backup сравнивает содержимое, а не только размер.

На синтетической истории пройден PostgreSQL drill с равенством расчётов
score_task до/после, hash replay и выдачей следующего ID. Изменения protected
records для тестирования не требовались. Полный rollback/restore всех пяти
сервисов остаётся отдельной открытой проверкой.

## Проверено 03.11.2026: профиль транспорта и cache

Активный адаптер использует ModelRequest/Result SDK 1.2, разделяет usage и
соблюдает общий deadline повторов. Cache разделяется по transport profile,
модели, purpose и schema; ошибки аудита сохраняют безопасный code/type.
Go-профиль подготовлен на параметрах V1 по отдельному разрешению пользователя
и применён после smoke с DPAPI-зашифрованным откатом. Старый профиль был
вне разрешённого Go origin; исторический 429 не является Go-квалификацией.
Linux-образ использует отдельный CPU lock torch с hashes. Encoder model/revision
сохранены; ключ background cache включает revision/cache/offline.
Эти unit-проверки не заменяют полную retrieval qualification и связывание
HTTP grants с lifecycle серверного runtime.

### Изолированное хранение индекса — 03.11.2026

`PRIORITISER_RAG_INDEX_DIR` задаёт writable каталог vector index независимо
от immutable корпуса и encoder cache. Без настройки сохраняется прежний
`data/index`. Metadata schema 3 включает model/revision/cache/offline; старый
или несовпадающий профиль требует пересборки. Тесты cache fence проверяют
каждое измерение без torch и обращения к модели. Алгоритм BM25/FAISS/RRF
не изменён. Native lifecycle drill использует отдельный `.runtime` index,
CPU `OMP_NUM_THREADS=2`/`MKL_NUM_THREADS=2` и запрещает K3 только в своём
процессе; это явный тестовый профиль, не изменение рабочего `.env`.

Обычный профиль по умолчанию использует `rag_local_files_only=true`: отсутствие
подготовленного encoder даёт неготовность, не неявную загрузку из registry.
Подготовка public pinned encoder выполняется отдельной стадией сборки/экспорта.

FAISS binary index сериализуется/десериализуется в памяти, а пути открывает
Python: это поддерживает кириллицу в рабочем каталоге Windows. Настоящий FAISS
round-trip на синтетическом векторе в `D:/Проект/.runtime` проверен без encoder
и модельных API. Девять minimal regression tests также PASS.

Аналогии используют тот же `PRIORITISER_RAG_INDEX_DIR`; cache signature включает
encoder profile и все поля входного passage, в том числе description. Оба
индекса открываются через Python bytes API для поддержки Unicode paths.
Readiness отклоняет отказ настроенного dense/analogy index, сохраняя безопасный
тип ошибки. Формула Value/Priority и алгоритм BM25/FAISS/RRF не менялись.

Cold build 604 фрагментов на измеренном CPU-профиле почти исчерпал 900 секунд.
Для отдельной стадии подготовки локальных assets можно явно задать
`start-agent.ps1 -Agent value-priority-assessor -Instance assets -Port 19100 -ReadyTimeoutSeconds 1800`
и затем остановить этот instance. Encoder предварительно экспортируется из
закреплённого образа командой `scripts/export-assessor-encoder-cache.py` в новый
каталог `.runtime`; model cache/index/offline параметры передаются собственными
`PRIORITISER_RAG_MODEL_CACHE_DIR`, `PRIORITISER_RAG_INDEX_DIR`,
`PRIORITISER_RAG_LOCAL_FILES_ONLY=true`. Нужны собственные PostgreSQL и secrets;
команды подготовки проверяют только health, не выполняют Go-запросов.
Default timeout не изменён; готовые индексы повторно используются только при
совпадении profile/corpus. После изменения корпуса подготовка выполняется снова.
Два native цикла с подготовленными assets проверены, история и `.env` сохранены.
