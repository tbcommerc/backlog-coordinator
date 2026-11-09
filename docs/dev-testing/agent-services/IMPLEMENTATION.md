# Выделение сервисов: фактический результат

Проверено 05.11.2026. **AS-IS PARTIAL. Реализация всего ТЗ не завершена.**
Ни `accepted_local`, ни общий `prepared_contract_tested` пока не присвоены.
Настоящий сервер: `not_verified`, `real_remote=NOT_RUN`.

## Внесённые изменения

- [Технический пакет](../../../packages/dmb-agent-contracts/pyproject.toml):
  ModelRequest/Result, RuntimePort, безопасные ошибки, Go transport, alias resolver,
  pinned snapshot OpenCode 1.17.13 и ограниченный HTTP remote adapter без tools.
- [Сервис встреч](../../../agents/meeting-analyzer/README.md): собственная конфигурация,
  PostgreSQL queue, API/worker, CAS, lease deadline, события, cancel/ack,
  стабильные результаты, точные цитаты, отдельные миграция и Docker-образ.
- [Доставка DMB](../../../dmb-backlog/backend/services/meeting_service_delivery.py):
  существующий capture intent используется как долговечная запись доставки;
  сервис владеет исполнением; версия capture защищает применение;
  результат и признак pending ack коммитятся до отправки ack.
- Расширяющая миграция DMB `d6b901c72e30` сохраняет backend старых запусков:
  старые queued/running не отправляются новому исполнителю автоматически.
- V1/V2 не выполняют DDL при импорте глобального session store; команды
  `python -m business_analyst.migrate` и `python -m business_analyst_experimental.migrate`
  проверяют существующую схему. Изменение старой неполной схемы требует
  `--verified-backup-file`; автоматического удаления истории нет.
- Launcher сохраняет существующие значения, не копирует ключи в соседние `.env`,
  не выбирает SQLite оценщику. Наследование V2 — только явно включённое,
  в памяти процесса. Go-клиенты используют собственные User-Agent;
  V1/V2 запрещают provider redirects. Разговоры V1 получили отдельные
  непрозрачные Go session IDs.
- Добавлены независимые start/status/stop/doctor scripts, build profiles и CI
  нового сервиса. Владение независимым процессом проверяется по PID,
  start time, executable и marker командной строки.

## Подтверждённые проверки

| Suite | Результат | Граница доказательства |
|---|---:|---|
| Регрессия V1 | 343 PASS | Полная unit-suite, включая запрет неподтверждённых embeddings; без модели |
| Регрессия V2 | 436 PASS | Без обращения к модели |
| SDK 1.2 | 59 PASS | Unit и настоящий локальный HTTP emulator; isolated config imports пяти сервисов |
| PostgreSQL очередь | 10 PASS | Отдельный временный PostgreSQL, только technical tables |
| DMB встречи | 26 PASS | Изолированные capture/action/notification/outbox; без protected rows |
| Транспорт оценщика | 6 PASS | Без conftest, создающего справочники |
| Явные миграции V1/V2 | 6 новых PASS | Только технические session/receipt fixtures, неизвестная схема отклоняется до DDL |
| Docker meeting-analyzer | PASS | Образ собран, зависимости и wheel включены |
| Live встречи | 4 PASS / 4 | Поручение, пустой результат, договорённость, injection; реальный Go |
| Live V1 transport | 4 PASS / 4 | Транспорт и простой structured JSON, не полный продуктовый сценарий |
| Live V2 transport | Исторический BLOCKED; cutover smoke PASS | Новый Go-профиль применён по отдельному разрешению, полный продуктовый replay не выполнен |
| Live оценщик transport | Исторический BLOCKED; cutover smoke PASS | Прежний профиль вне Go origin; новый Go-профиль проверен и применён по разрешению |
| Real remote | NOT_RUN | Вне текущей поставки |

Бюджет пользователя: максимум 40 model calls и 20 минут. Израсходовано или
зарезервировано 21 calls: прежние 18, успешный smoke оценщика, recheck V2
(401), успешный smoke нового V2. Прежние отказы сохранены; они не заменены
успешными результатами задним числом. По отдельным разрешениям пользователя
V2 и оценщику применены Go-параметры V1 после smoke, с DPAPI-зашифрованным
откатом старых файлов. Это не полная продуктовая live-приёмка.
Safe JSON evidence находится в `.runtime/agent-services-evidence/` и исключён
из Git. В нём нет transcripts, provider bodies, keys, DSN, cookies или JWT.

## Открытая реализация и приёмка

Это существенные оставшиеся работы, а не только отсутствие доступа к серверу:

1. W01: корпус v1 из 60 синтетических случаев зафиксирован с SHA256 и
   assertions; структурная проверка PASS. Полный offline replay и baseline/candidate
   live сравнение 4×5 ещё не выполнены. Ретроспективный baseline не заявляется.
2. W03–W04, W09–W12: SDK 1.2 подключён к активным ModelPort V1/V2/встреч/оценщика
   и AsyncRuntimePort ассистента; независимые dimensions профиля разрешаются
   общим resolver. Остаётся единый долговечный lifecycle операций всех сервисов.
3. W05: корневой и независимые launcher теперь используют общий реестр
   владения, включая backlog-assistant/Data API и backend. Реализованы
   graceful API drain, worker stop event и mTLS status; отдельная изолированная
   двухцикловая native-приёмка V1/V2/встреч/ассистента PASS. Остаются
   live full-project cutover и qualification worker failure. Legacy PID-only процессы автоматически не присваиваются.
4. W08: полный application receipt/outbox lifecycle, конфликт источника и
   повторная авторизация всех путей, UI приёмка и rollback/cutover drill.
5. W11: привязка готовых HTTP tools/grants к controller lifecycle, кэш и
   retrieval qualification. HTTP tools F5/F6, PostgreSQL drill и перенос
   собственной разрешённой истории реализованы; подробности ниже.
6. W13: remote profiles с tools, provisioning/cleanup identity и janitor;
   полная независимая failure suite, проверка всех fixtures по snapshot.
   Сейчас квалифицировано только ограниченное подмножество без tools.
7. W14–W15: полные API/worker smoke пяти контейнеров без source mounts
   и полный production Compose. Сборка и offline import/FS пяти образов PASS. Новый service Dockerfile ассистента и отдельный
   Compose — подготовка; Linux bridge/Docker controller ещё не квалифицированы.
8. W16–W18: полный управляющий API/SSE пяти сервисов, UI resume/ошибки,
   глобальный Redis limiter, observability, retention остальных сервисов (встречи реализованы),
   нагрузка, backup/restore и rollback.
9. Прежние credential/endpoint блокеры V2 и оценщика устранены согласованными
   профилями. Полный продуктовый baseline/candidate требует отдельного runner
   и достаточного остатка бюджета: остаётся 19 вызовов, а минимум двух фаз — 40
   без вложенных вызовов/retries. Бюджет автоматически не расширяется.

Новые сервисные таблицы не являются копией предметной БД. Пользователи,
учётные данные приложения, справочники, роли и состав команд не изменялись.
По прямому указанию пользователя подготовлены только инфраструктурная БД,
DB role и конфигурация нового сервиса; они отделены от пользовательских ролей DMB.

Исходное [ТЗ](../../AGENT_SERVICES_MIGRATION_SPEC_2026-11-02.md) и
[каталог испытаний](../../AGENT_SERVICES_MIGRATION_TEST_PLAN_2026-11-02.md)
сохраняют обязательный объём. Неупомянутые проверки не считаются PASS.

Полный знаменатель каталога: [test-matrix.json](test-matrix.json). 134 сценария: 19 PASS, 115 NOT_RUN. Отдельные suites не заменяют этот знаменатель.


## Продолжение: HTTP tools оценщика — 02.11.2026

Реализован [контракт tools 1.0](../../../agents/value-priority-assessor/docs/REMOTE_TOOLS.md):
четыре разрешённых операции, opaque token с TTL 180 секунд, server-side scope
run/task/роль/evidence, отзыв, source/rubric hash, 12 вызовов на grant,
атомарный factor/priority/receipt и стабильный повтор call_id. Административные
операции, arbitrary SQL/URL/identity и K3 исключены. Замороженная миграция
20261102_01 не меняет protected records. Launcher применяет её только при
явно включённом оценщике.

CLI/HTTP factor operations теперь вызывают общий recompute_factor_priority.
Формулы score_task сохранены; отсутствуют незапрошенная оценка соседнего фактора,
изменение Value, model IO и инициализация retrieval. Новые операции не исправляют
внешний 429 и не включают оценщика в стандартный запуск.

Проверены настоящий Node→HTTP→Python вызов без Python в runtime, повторы,
запрет чужого фактора/run/task/evidence, строгая схема, истечение/отзыв,
rollback после flush и восьмикратная конкурентная доставка на PostgreSQL.
Полный remote OpenCode профиль с tools остаётся открытым; real_remote=NOT_RUN.


Итог проверок этого продолжения: минимальное окружение tools без torch/
embeddings — 40 PASS; PostgreSQL на замороженной migration и перенос SQLite —
5 PASS; JavaScript HTTP/redirect — 2 PASS; прежняя transport suite оценщика —
6 PASS. Новых Go calls нет, накопленный расход/резерв остаётся 18 из 40.
Первичные отказы временных fixtures связаны с WinError 5; итоговый прогон в
новом workspace temp с разрешённым файловым доступом прошёл. Protected seed
не применялся. Отдельный временный PostgreSQL не связан с рабочей БД.

### PostgreSQL оценщика и сохранность истории

Собственная история оценщика перенесена: agent_request — 23, llm_call — 8;
task/factor_assessment/priority_history/attribution_run — 0. Справочников в
источнике не было; protected_reference_writes=0. Исходный SQLite оставлен,
создана и проверена native backup-копия в игнорируемой `.runtime/`. Target —
отдельные PostgreSQL database/role, revision `20261102_01`, обе tool tables готовы.
Независимая повторная сверка подтвердила counts. В `.env` оценщика изменён только
DSN; прежние модель, endpoint и ключ сохранены. Тяжёлый сервис не запускался.

В репозитории доступна `value_priority_assessor.migrate_state`: source read-only,
проверка содержимого backup, allowlist рабочих таблиц, отказ несовпадающим
protected reference snapshots/чужой target schema, row budget, транзакционный
copy/hash verification/replay, сохранение IDs и настройка sequences.
Синтетический PostgreSQL drill подтвердил также равенство score_task до/после
и следующий serial ID. Четыре unit migration tests пройдены. Первый запуск
PostgreSQL fixture был заблокирован ACL общего pytest temp; повтор в новом
каталоге внутри workspace прошёл. Это инфраструктурный отказ до запуска теста,
не замаскированный дефект сохранности.

Safe evidence: `.runtime/agent-services-evidence/assessor-storage-plan.json`
и `assessor-state-migration.json`. Они содержат только counts/hashes;
DSN, credentials, prompts и ответы в evidence не записываются. Model calls
в продолжении по-прежнему 0; общий расход/резерв остаётся 18 из 40.


### CI и границы legacy suite

Основной job оценщика и отдельный tools job используют минимальный pinned lock
и явные `--noconftest` suites. Старый общий `tests/conftest.py` создаёт записи
справочников через seed; он не используется. Его legacy suites явно отмечаются
`NOT_RUN` в CI до перевода fixtures на разрешённые mocks. Поэтому зелёный
изолированный job не является полной регрессией оценщика или приёмкой L/C.

Завершение временного контейнера `dmb-assessor-tool-test` не подтверждено:
Docker Engine перестал отвечать уже после успешных испытаний. Ограниченная
попытка stop завершилась по timeout; рабочие сервисы и Docker Engine не
перезапускались. Зависшие собственные CLI helper обрабатывались отдельно.

## Продолжение: конфигурация, wheel и lifecycle — 03.11.2026

Общий [resolver и эксплуатационный контракт](../../../agents/CONFIGURATION.md)
подключён к пяти сервисам. Один packaged JSON задаёт canonical/legacy aliases
для Python и PowerShell. Выбранный источник проверяется на конфликт; пустой
ключ сохраняет приоритет. Ошибки и metadata содержат имена полей/источников,
без значений. Подпроцессы из собственных service roots проверили новые имена,
отказ конфликту и неизменность файлов конфигурации. В V1/V2 mock/SQLite теперь
требуют явного unit mode: DEBUG сам по себе не снимает service validation.

SDK 1.1.0 собран как wheel, установлен без editable в пять локальных окружений.
Launcher кэширует source fingerprint и wheel SHA256; SkipDependencyInstall
проверяет установленную версию. Новые build stages V1/V2/оценщика/ассистента
включают wheel. Их Docker rebuild и полный artifact smoke в этом продолжении
NOT_RUN. Возможность импортировать отдельные configs не объявляется проверкой
всех production dependencies образа. CI дополнен Windows config/lifecycle job;
сам удалённый CI в этом чате не запускался.

Корневой запуск больше не останавливает весь проект перед стартом. V1/V2/
оценщик используют независимый start-agent, backend получил process record,
ассистент хранит API и Data API в едином реестре. Запись фиксирует PID, start
identity, executable и module marker; Windows listener принимается только как
проверенный процесс или его ребёнок. Остановка удерживает process handle,
чтобы PID reuse не переключил цель. Чужой порт, несовпадающая запись и частичный
owned launch вызывают отказ без завершения чужого процесса. Живые legacy
PID-only записи сохраняются с предупреждением, а не автоматически усыновляются.

Синтетический HTTP-процесс подтвердил identity, stale start time, marker,
executable, отказ занятому порту и остановку собственного процесса. Рабочие
сервисы не останавливались, полный start-project не запускался. Graceful drain
console API/worker остаётся открытым: текущий stop применяет проверенную
принудительную остановку. Status ассистента пока не выполняет mTLS probe.

Итог профильных suites: V1 339 PASS; V2 431 PASS; SDK/встречи 49 PASS;
оценщик 40 PASS без protected conftest; backlog-assistant 48 PASS — всего
907 Python tests. PowerShell config, synthetic lifecycle и syntax checks PASS.
В runtime-venv V2 не было pytest: его полная suite пройдена тестовым parent
интерпретатором из собственного service root; production-venv проверен отдельным
config subprocess и импортом установленного SDK. Первый config PS прогон
выявил семантику пустых env в современном PowerShell; fixture исправлен на
явное удаление переменных, итоговый прогон PASS. Первый V1 запуск дал только
предупреждение cache ACL; все 339 тестов прошли.

Новых Go calls, DB migrations или protected writes в этом продолжении нет.
Model budget остаётся 18 из 40. Полная матрица 134 сценариев не пересчитывается
по числу unit-тестов; статусы accepted_local/prepared_contract_tested не получены.

T-L05 переведён в PASS после проверки конфликта aliases в пяти реальных
config-классах/модулях и PowerShell. T-L06 и T-O01/O02 остаются NOT_RUN:
синтетическая проверка helper не заменяет двукратный запуск всей платформы.


## Продолжение 03.11.2026: конфигурация, transport и native lifecycle

SDK wheel 1.2.0 устанавливается независимо от соседних исходников. Typed Chat
boundary разделяет usage, отвергает неполный результат, сохраняет абсолютный
таймаут retries; HTTP/SSE ограничены размером и общим deadline. V1/V2 embeddings
по умолчанию выключены: chat capability не подтверждает embedding endpoint.
Mock-фабрики требуют явного unit-режима. В оценщике cache разделён транспортным
профилем, schema/purpose и encoder revision/cache/offline; ошибка аудита не
содержит тела провайдера. Для Linux закреплён отдельный CPU torch lock с hashes;
модель encoder и revision сохранены. Полная retrieval эквивалентность ещё открыта.

Встречи удаляют input/result/events/metadata в отдельных конечных окнах;
минимальный idempotency tombstone также имеет конечный срок. DMB повторно
проверяет право перед dispatch/poll и не применяет поздний результат после
отзыва. Исчезнувший result/ack даёт конечный outcome без создания нового run
и без потери ручного черновика. Изолированные DMB tests: 26 PASS.

Синтетический ASGI graceful test и Windows ownership test PASS. Отдельная
native-приёмка `qualification-ac36c1d8`: V1, V2, встречи и ассистент — два цикла
start/start/status/stop/stop PASS с совпадением fingerprints истории и `.env`.
Оценщик не прошёл prerequisite экспорта encoder в пределах 180 секунд;
выборочная повторная проверка подготовлена с конечным пределом 900 секунд.
Ни один такой цикл не вызывает Go и не изменяет защищённые данные DMB.
Результат не равен full-project cutover, контейнерной или предметной приёмке.

Проверка артефактов `artifacts-final`: все пять build/offline import/final FS
и sentinel PASS, SDK 1.2.0; T-O05 переведён в PASS. Это не T-O06: запуск
полных API/worker контейнеров без registry/source mounts ещё не проверен.
Реальный pg_dump/pg_restore (`storage-restore-20261103`) четырёх disposable
БД V1/V2/встреч/ассистента PASS: fingerprint истории совпал, исходные БД
сохранились. Оценщик в этот drill не входил; общий DB-09 пока не закрыт.
Последняя полная регрессия: V1 343, V2 436, SDK 59, встречи 22 (включая
10 PostgreSQL), ассистент 49 PASS. Изменённые Markdown: 284 локальные
ссылки проверены, отсутствующих нет.


### Дальнейшая проверка 03.11.2026

- `storage-restore-five`: pg_dump/pg_restore пяти disposable БД PASS. Оценщик
  создан явными Alembic-миграциями, содержит одну synthetic agent_request;
  reference пуста и проверяется до восстановления. Никакие рабочие защищённые
  записи не копируются и не создаются. Это DB-09 на синтетических данных,
  но не полный rollback приложения T-O11.
- Operator probe: десять синтетических тестов пяти сервисов PASS: reserve
  предшествует созданию транспорта/одному вызову; при исчерпании ledger вызова
  нет. Проверка отсутствующего явного CLI-бюджета PASS до inference. Реальный
  probe не запускался: суммарный ledger остаётся 21 вызов / 639 секунд резерва.
- Cache metadata RAG включает frozen encoder profile. Дополнительно устранён
  Windows Unicode FAISS fopen: сериализованный индекс читает/пишет Python.
  Девять minimal cache-тестов PASS и настоящий FAISS Unicode round-trip PASS
  на синтетическом векторе без encoder или Go. Новейший образ оценщика:
  `artifacts-assessor-unicode-final`, build/offline import/FS PASS.
- Оценщик native: один цикл `qualification-95a7bcdf` PASS, второй прерван
  для применения Unicode-исправления. Полный двухцикловый повтор
  `qualification-c22f82aa` ещё выполняется; T-O01 пока NOT_RUN.
- Сравнение Windows/Linux CPU encoder выполняется отдельно на трёх synthetic
  документах и двух запросах. Это не полный retrieval корпус и не Go-приёмка.
  До завершения runner качество/эквивалентность не объявляются PASS.

Offline encoder Windows/Linux CPU: PASS (`encoder-cpu-equivalence.json`).
Для frozen model/revision ранжирование двух запросов по трём synthetic
документам совпало; maximum cosine delta 1.5632e-7 при допуске 1e-4.
Windows torch 2.13 CPU, Linux torch 2.14 CPU. Это не проверка полного корпуса
и не разрешение менять model/revision. Go budget при сравнении не расходовался.


### Итог текущей native-приёмки — 03.11.2026

T-O01 PASS: `qualification-ac36c1d8` подтверждает два цикла V1/V2/встреч/
ассистента; `qualification-09e8a2e9` — два цикла оценщика с подготовленными
encoder и индексами. API PID и listener проверены, повторный start не создаёт
дублей, stop/stop завершает только owned процессы. История и `.env` совпадают
по fingerprints до/после; у оценщика сохранены 23 agent_request и 8 llm_call.
Все test instances остановлены. Это не full-project cutover и не product live.

Cold build 604 RAG chunks занял почти 900-секундный предел: прежний неуспешный
прогон сохранён. Выявлены/исправлены Unicode FAISS IO обоих индексов, отдельный
writable каталог и cache profile; analog cache также учитывает description.
Включённый dense index и доступный analogy snapshot теперь должны реально
подготовиться до ready. Завершение background future само по себе недостаточно.
Подготовка assets может использовать явный `-ReadyTimeoutSeconds` до 1800;
обычные defaults launcher не увеличены. Cold-start SLA не объявляется PASS.

Два цикла не подтверждают ещё открытые общий run API/SSE пяти сервисов,
global Redis operation slots, remote tools provisioning/cleanup, полный
production Compose, UI/cutover/rollback и baseline/candidate replay.
Полная реализация ТЗ по-прежнему не завершена; accepted_local не присвоен.


## SDK 1.3: контекст операции — 03.11.2026

Активные V1/V2/оценщик/встречи и broker бэклога связаны общим логическим
контекстом, actual HTTP-attempt counter и запретом late model call после
завершения владельца. F5/F6 передают ContextVar в executor, сохраняя отдельные
provider-session refs. Долговечные владельцы встреч и бэклога задают существующие
лимиты 1/4; новые числовые лимиты V1/V2/оценщика до baseline не вводились.
Это не общий Redis limiter и не долговечная очередь V1/V2/оценщика.

Повторная регрессия: V1 345, V2 438, SDK+meeting unit 94, бэклог 49,
безопасный набор оценщика 62 PASS. Обычный Go ledger не изменился (21 calls).
Wheel SDK 1.3.0 установлен во все runtime Python; новые Docker pins обновлены,
повторная сборка пяти образов выполняется отдельно. Ранее подтверждённые
артефакты SDK 1.2 остаются историческим доказательством, не сборкой SDK 1.3.


## Доставка встреч и актуальные артефакты — 03.11.2026

Все пять SDK 1.3 образов имеют PASS build/offline import/FS;
`current-verified-artifacts.json` объединяет `artifacts-sdk-13` и свежие сборки
`artifacts-receipts-20261103` (встречи/V1/оценщик). Это не полный container API drill.

Добавлены доверенный deadline и byte limit до JSON в meeting API, безопасная
передача typed auth/quota/deadline через legacy V1 и gateway, состояния quota/
service configuration в UI. Playwright mock API 23 и frontend unit 4 PASS;
PostgreSQL meeting integration 12 PASS. Отдельный UI CI job использует порт4197.
Новый REMOTE_TOOLS operational doc исключён из methodology corpus оценщика;
регрессия неизменности корпуса при правке этого документа PASS.

DMB receipts вынесены из перезаписываемой строки capture в отдельную техническую
таблицу: решение применения и draft CAS атомарны, ACK переживает новый анализ,
lost ACK response и restart, имеет bounded retry backoff; detached accepted run
восстанавливается для cancel/ACK. Миграция d251c98e30f7 проверяется на отдельном
PostgreSQL, рабочая БД пока не обновлялась. Это ещё не полная приёмка W08: pre-dispatch intent реализован ниже,
сквозная живая приёмка и полный fault/restart drill остаются открытыми. Общий run API пяти сервисов, Redis limiter, remote tools
provisioning/cleanup, полноценный replay, cutover/rollback остаются NOT_RUN/не реализованы.
Go ledger не изменялся: 21/40 calls, 639/1200 reserved seconds.


### Immutable intent и cancellation tombstone — 03.11.2026

W08 дополнен `meeting_delivery_intents`: постановка analyze и envelope атомарны,
unknown dispatch сохраняется до IO, retry использует исходный source/input.
Detached unknown outcome закрывается отдельной атомарной отменой по ключу:
create/cancel сериализуются одним PostgreSQL advisory lock; cancelled tombstone
не попадает в worker queue и возвращается позднему create. Определённый отказ
первой отправки не вызывает cleanup retry; ранее неизвестный исход сохраняется.
Cleanup backoff 2–60s, временный envelope до24h, terminal receipt и ACK отдельны.

Проверки: DMB 50 PASS (только технические/обычные таблицы, без protected rows),
meeting 20 unit +13 PG integration PASS. Общая SDK+meeting suite до последнего
добавления cancel-key имела102 PASS; её старый итог не является полным новым
прогоном. Последний meeting image строится отдельно в `artifacts-intents-20261103`;
предыдущий verified image не содержит новой cancellation API. Не считать его
актуальной сборкой до PASS manifest. Рабочая миграция ещё не применялась.

Последняя расширенная регрессия retention/backoff: 52 offline PASS; повтор
PostgreSQL migration test не прошёл из-за connect timeout после повторной
потери Docker Engine (ранее migration PASS). Новая сборка meeting остановлена
на registry metadata; PASS для cancellation API image не присвоен.
Запрошено восстановление Docker; рабочие контейнеры не останавливались.
Локальные ссылки обновлённых документов: 150 проверены, missing0.


### Восстановленная контейнерная проверка встреч — 03.11.2026

Docker восстановлен. Повторный DMB-набор 53 PASS, включая настоящую migration
в технической PostgreSQL-схеме. Новый image `3024d8f1…` содержит cancel-key API;
`artifacts-intents-restored-retry-20261103/manifest.json` PASS build/import/FS,
агрегат `current-verified-artifacts.json` обновлён. Исторические timeout не удалены.

`meeting-container-functional-20261103/manifest.json`: PASS actual HTTP API,
PostgreSQL queue, worker через GoModel с MockTransport, result hash/actor scope,
SSE, ACK/retention, cancellation tombstone и late create. Образ запускается
read-only/non-root с tmpfs, без source mounts/registry/package installation.
Внутри новый технический database, 21 run, один mock model call, live Go0.
На 20 последовательных admission p95=0.0832s; это измерение отдельного сервиса,
не полный NFR workload с глобальным limiter. Production Compose и real_remote
этой проверкой не подтверждаются. Runner добавлен в meeting-build CI job.
Рабочая DMB migration ещё не применялась; полный статус ТЗ остаётся PARTIAL.


## В работе: SDK1.4 и общий Redis limiter — 04.11.2026

Реализован отдельный Redis logical-operation coordinator: global limit2,
standalone limit1, FIFO pending queue64/actor8, max queue wait15s. Вложенные
вызовы и F5/F6 делят контекст и слот. Active ownership не истекает по TTL;
потеря epoch/profile/active state запрещает новые операции. Protocol2 хранит
независимый active counter: eviction одного hash не открывает лишние слоты.
Приватный filesystem journal предшествует acquire; unknown responses сохраняют
владение. Cleanup receipt восстанавливается после возврата Redis; PID+birth
позволяет вернуть только direct lease завершившегося собственного процесса.
Изолированный runtime сохраняет слот до подтверждения domain janitor.

Подключены operation_scope, retries, shared launch profiles/ownership records,
readiness guard. Meeting/backlog могут defer только недиспетчеризованный claim;
backlog сохраняет исходные15s queue +60s execution и heartbeat во время ожидания.
Рабочие API-процессы пока не перезапускались; ранее запущенные процессы без
limiter record больше не переиспользуются как процессы нового профиля.

Изолированный Redis container c80a477d… (порт62152) создан из закреплённого
локального Redis image. 32 SDK coordinator/context checks PASS, включая10
конкурентных операций, реальную смерть child process, missing epoch, unknown
acquire/release, partial active hash loss, readiness503. Backlog regression51
и SDK/context/meeting subset45 PASS до последних проверок integrity.
SDK version1.4.0 закреплён в artifacts/pins; wheel обновляется после правок
coordinator. Межпроцессный runner пяти собственных Python-сред добавлен, его
приёмка выполняется отдельно. Это ещё не полный NFR acceptance и не завершение ТЗ.

Исторические manifests SDK1.3 не являются актуальной квалификацией SDK1.4.
Новые run API V1/V2/оценщика, remote runtime, полный replay и cutover/rollback
остаются открытыми; работа продолжается без итогового закрытия по промежуточным
проверкам. Go ledger21/40 calls,639/1200sec не изменялся.


## Продолжение 04.11.2026

- SDK 1.4.0: общий Redis-лимит логических операций, неистекающие активные аренды,
  журнал до отправки, проверка поколения Redis, подтверждённое восстановление,
  абсолютный deadline HTTP и удержание слота до физического закрытия запроса.
- Десять процессов пяти сервисов с синтетическим провайдером: максимум две
  операции одновременно, после завершения active/queued=0; 0 live Go calls.
  Реальный Redis RDB rollback: новые операции запрещены до подтверждённой очистки.
- [Управляющие фасады](../../../agents/RUN_API.md) V1/V2, оценщика и ассистента;
  общий технический run-store/API/worker без предметных импортов в SDK.
- Реальный PostgreSQL: отмена во время незакоммиченной продуктовой записи
  откатывает запись; история оценщика присоединена к финальному CAS.
  V1/V2: состояние диалога и квитанция откатываются вместе с отменённой публикацией.
- Ассистент сохраняет mTLS/подписанный контекст, прежние квоты и повторную проверку
  источников. Автономная регрессия с новыми сценариями фасада: 55 PASS.
- Подготовленный remote tools adapter использует отдельную аренду от внешнего
  provisioning interface, проверяет идентичность запуска, конфигурацию,
  manifest инструментов и сетевые направления. Эмулятор не считается real_remote.

Эти результаты не заменяют полный предметный replay, gateway cutover, актуальную
контейнерную приёмку SDK 1.4.0 и повторную проверку rollback. Матрица полной
приёмки пока не закрыта; старые артефакты SDK 1.3.0 остаются историческими.


### Дополнительная проверка 04.11.2026: lifecycle, восстановление, remote cleanup

В изолированных собственных PostgreSQL-базах все пять сервисов прошли по два
цикла native start/reuse/status/stop с глобальным Redis-координатором. V1/V2 и
meeting: `qualification-79147971`; backlog-assistant: `qualification-76b75e72`;
оценщик с закреплённым CPU encoder и подготовленным RAG:
`qualification-733e2a40`. Вызовов модели и записей защищённых данных — 0.
Это проверка запуска, а не предметного качества.

Повторный dump/restore текущих технических схем всех пяти сервисов — PASS:
`.runtime/agent-services-evidence/storage-20261104/manifest.json`. Проверены
4/4/2/9/12 таблиц соответственно V1/V2/meeting/backlog/оценщик. Хеши содержимого
после восстановления совпали; исходные базы не изменились; справочник оценщика
пустой. Проверка относится к disposable базам, а не к рабочему cutover DMB.

Для remote-профилей четырёх сервисов подключён janitor приватных bindings:
он требует terminal fence, идентифицируемого умершего локального владельца,
совпадения профиля и положительного подтверждения удаления своей сессии.
Неопределённый create ищется по сохранённой metadata; повторный create/submit
запрещён. Пустой поиск, чужая metadata и отказ удаления оставляют cleanup pending.
Слот освобождается только после очистки всех bindings этого run. Старые bindings
без доказательства владельца автоматически не принимаются.

Исправлена очистка после cancel/deadline: bounded abort/delete продолжаются
в отдельном cleanup scope с сохранением физического счётчика и занятого слота;
исходная операция остаётся отменённой. No-tools preflight проверяет также
resolved permissions фактического агента, а не только глобальную конфигурацию.
Результаты HTTP-эмулятора не являются серверной приёмкой S.


### Дополнение 04.11.2026: ключи, совместимость и предметный runner

Область общего ключа расширена до caller/actor/operation/key. Явная миграция
проверена на отдельных PostgreSQL и SQLite: строки, ID, request_hash и события
сохраняются; без подтверждённой резервной копии старая схема отклоняется.
Схема оценщика — Alembic `20261104_03`, ассистента — версия 4.
Срок идемпотентности фиксируется для каждого ключа; изменение настройки не
уменьшает уже выданный срок, прежние записи без отметки удерживаются 90 дней.
Старые cleaner/ограничения уникальности не считаются совместимым rollback.

Полный SDK-набор после изменения — 185 PASS, без пропусков, с отдельными
PostgreSQL/Redis (`sdk-operation-full-20261104.junit.xml`). Дополнительная проверка
wire ingress — 10 PASS (`run-wire-20261104.junit.xml`): malformed JSON, неизвестные
поля, неверный тип тела, отсутствие ключа и превышение 1 MiB отвергаются до
admission/profile/model и не отражают содержимое входа в ошибке.

Native runtime ассистента прошёл подготовку без модели и подтверждённую очистку
(`backlog-runtime-start-20261104d`). Предметный низкоуровневый replay сохранил
все 8 исходов (`backlog-native-retest-20261104`); отдельный воспроизводимый прогон
записанного Go-ответа без платных вызовов обнаружил превышение 16 000 байт на
втором запросе. Низкоуровневый runner пропускал существующий fallback Worker,
поэтому эти результаты считаются диагностикой runtime, а не полной приёмкой
предметного поведения. Runner исправлен на настоящий Worker + Store;
доказательства предыдущих попыток сохранены без перезаписи.

Для контейнерного контроллера подготовлены явная сеть, проверка принадлежности
bridge IP самому контроллеру и передача ограниченной конфигурации дочернему
runtime без host-path bind. Docker CLI закреплён digest. Добавление socket и
группы 0 в Compose отклонено автоматической проверкой; требуется отдельное
разрешение пользователя на полномочия управления Docker/хостом. До него эта
топология не запускается и не считается принятой. Модельный runtime сокет и
provider key не получает. Контрактные тесты новой привязки сети — 7 PASS
(`controller-network-20261104.junit.xml`), это не контейнерная функциональная
приёмка.


Минимальная предметная живая проверка T-L12 теперь PASS для всех пяти сервисов:
`live-minimum-semantic-review-20261104.json` содержит пять выбранных реальных
Go-сценариев, хеши исходных отчётов и проверки содержимого. Это не завершение
всего baseline/candidate корпуса. Настоящий Worker ассистента сохранён в
`backlog-worker-live-20261104`: candidate normal — серверный partial, clarification
— completed, duplicate — полный модельный answer; defense — failed без evidence
и без неподтверждённой публикации. Последний исход не превращён в успешный
предметный ответ. Все восемь записей и затраты сохранены. Общий накопительный
расход после прогона — 89/100 обращений, 3085/3600 секунд по согласованному
учёту transport/reservations.

Автономный корпус ассистента — 12 PASS (`backlog-corpus4-20261104.junit.xml`),
вся его suite — 82 PASS (`backlog-full-20261104.junit.xml`). Тип доказательства —
синтетические product Worker/Store и HTTP boundary fixtures, не качество модели
и не реальная изоляция двух Docker-хостов. Вместе с прежними meeting/assessor
покрыты 36 из 60 offline случаев; V1/V2 ещё не выданы за пройденный replay.
Все пять образов текущего SDK собраны, offline import/filesystem PASS:
`artifacts-controller-20261104/manifest.json` и
`artifacts-operation-keys-20261104/manifest.json`. Функциональные container,
Compose, UI и rollback проверки не заменены проверкой импорта.


### Дополнение 05.11.2026: протокол, usage и границы завершения

Общий remote adapter допускает штатный StructuredOutput finish=tool-calls только
со structured object; результат затем проходит точную схему. Неизвестный finish,
truncated JSON и незавершённый вывод отклоняются без повторного submit.
`structured-finish-20261105.junit.xml`: 38 PASS; отдельный актуальный wire набор
`structured-wire-20261105.junit.xml`: 26 PASS. Это contract_emulator, не S.
Usage разделяет reported cost и Go allowance, запрещает bool/string/negative/
NaN/Infinity и сохраняет null с причиной отсутствия; `provider-usage-20261105.junit.xml`:
47 PASS. Актуальный установленный SDK wheel SHA256 (до последнего cleanup fix):
`bb20373709a9ac7dfd5860e901c6af0856d1ec0be66a007f810e920fcf9a0ee4`.

SDK offline suite: 190 PASS, 24 SKIP (`sdk-offline-final-20261105.junit.xml`);
пропущенные Redis/PostgreSQL integration не выданы за PASS. Предыдущие 185 PASS
без пропусков относятся к отдельному PostgreSQL/Redis прогону 04.11.2026.
Дополнительные актуальные legacy проверки — 3 PASS (`legacy-expiry-20261105.junit.xml`):
optional старые ключи принимаются, стабильные повторы разделены по operation,
истёкшая legacy квитанция возвращает 410 до сравнения очищенного payload.
Новые run endpoints по-прежнему требуют ключ. Hash-lock ассистента закрепляет
прежние 32 версии и добавляет hashes; факт сохранения версий —
`backlog-hash-lock-20261105.json`. Изменён runtime entrypoint, для него закреплён LF.

[ADR-01–10](../../adr/AGENT_SERVICES_MIGRATION.md) фиксирует технические решения и
открытые последствия. [Инвентарь](requirement-trace.json) содержит все 292
нумерованных пункта и все 134 испытания; family links не объявляются точным
доказательством реализации. `check-agent-requirements.py` проверяет полноту и
дрифт. 152 локальные ссылки в девяти профильных документах — PASS
(`markdown-links-20261105.json`).

Рабочие HTTP health-check 05.11.2026 были недоступны, Docker status вернул 500;
свободная RAM измерена около 0.48 GiB. Позднее bounded docker version снова
ответил успешно (Server API 1.56, minimum 1.40), что не доказывает здоровье UI
или полного стека. Тяжёлая функциональная приёмка, миграция рабочей БД, полный
application rollback и 24 offline случая V1/V2 остаются открытыми. Разрешение
на socket контейнерного контроллера ожидается отдельно; отклонённая конфигурация
Compose не была записана или запущена.


Свежая регрессия после исправления позднего cleanup: **217 PASS, 0 SKIP** на
отдельных PostgreSQL/Redis (`sdk-final-integrated-20261105.junit.xml`). Последний
SDK wheel SHA256 — `434491f79abd9e9c63d34fe46ae80a8ee892e78705472c4c93d01e05641c5365`.
Пять актуальных образов: `artifacts-cleanup-release-20261105/manifest.json`, все
build/offline import/filesystem PASS. Это проверенные immutable IDs, а не обещание
функциональной готовности каждого контейнерного deployment.

Meeting image `sha256:74d6753077d86a1e6754a1abc4df153157f0bb48580e13dcc3d1a79254b14f29`
повторно прошёл настоящий container HTTP + PostgreSQL + worker + standalone Redis
на MockGo: 21 run, 20 admission samples, p95 0.028581s, 0 live calls, без source
mounts/runtime installs (`meeting-container-final-20261105/manifest.json`).
Production Compose/global profile этим не проверены.

Закрыта маркировка explicit inheritance V2: root launcher выставляет полный
набор process aliases, Settings фиксирует inheritance/from_service, сохраняя
приоритет explicit overrides; после создания Settings происхождение неизменно.
`explicit-inheritance-20261105.junit.xml` и PowerShell config suite — PASS.
Текущая матрица содержит 34 PASS/1 FAIL/99 NOT_RUN из 134; это честная незавершённая
приёмка, а не 134 успешных испытания.

### Актуализация 05.11.2026: полный offline replay

`corpus-offline-all-20261105/manifest.json`: **60/60 PASS**, пять отдельных
продуктовых процессов, внешний сетевой доступ запрещён, заблокированных попыток
нет, live-бюджет не изменился. Прежний пробел 24 offline-случаев V1/V2 закрыт.
Авторские модельные fixtures и проверенные проекции Go-результатов подтверждают
инварианты, но не качество модели и не являются сырыми HTTP-записями.
Консервативная классификация V1 в случае 06 явно сохранена. Replay V1/V2/VPA
добавлен в product CI с запретом внешних соединений.

Повторный meeting-02 baseline/candidate после утраты прежнего output прошёл:
`meeting-lost-output-review-20261105.json`; старый отчёт не удалён. Повтор BKL
defense с допустимыми task:1001/task:1002 отражён в
`backlog-valid-refs-review-20261105.json` и подтверждает безопасность только
выбранного сценария.

`v1-instrumentation-retest-20261105/manifest.json`: baseline заполнил role/as_is,
candidate только role. Исходные цитаты CSV/пятницы и текущего состояния сохранены
в истории/предположениях, но полнота активных слотов не принята. Модель добавила
неподтверждённую автоматизацию и экономию, прежний grounding guard отклонил эти
формулировки. Параметры обоих запросов одинаковы (temperature 0.2, max_tokens 3072,
модель и JSON format). Один стохастический прогон не устанавливает причину
расхождения; бизнес-проверки ради PASS не ослаблялись. T-Q03 остаётся открытым.

По новому разрешению пользователя общий предел **100 вызовов / 4500 секунд**,
все прошлые затраты сохранены. Расход после последнего V1: **96 / 3119**,
активных резервов нет, остаток 4 вызова / 1381 секунда.
`ui-readonly3-20261105.json`: навигация пяти экранов PASS без модельных вызовов
и защищённых изменений; это не функциональная UI-приёмка. После освобождения
памяти четыре запущенных HTTP health ответили 200. Контейнерный BKL controller
с Docker socket не активирован; отдельное разрешение на полномочия Docker/хоста
пока не получено.

Итоговый `scripts/summarize-agent-acceptance.py` сверяет полный набор ID с
каталогом и сохраняет четыре статуса. Отсутствующие/повторные ID, неизвестный
SKIP, PASS без evidence и незакрытый случай без причины отклоняются;
`acceptance-summary-20261105.junit.xml`: 6 PASS (T-Q05).
Браузерные fixture-тесты meeting UI повторены: 23 PASS, 0 SKIP/FAIL,
`meeting-ui-fixture-20261105.json`. Проверены восстановление, потеря acceptance,
смена run в другой вкладке, quota/auth failure; gateway/live/protected writes
не использованы. Это отдельное дополнение к readonly-навигации.

`go-contracts-20261105.junit.xml`: 15 PASS на синтетическом transport. T-L08
проверяет отказ Responses/Messages до сети; T-L09 — собственный User-Agent и
разделение session между разговорами; T-L10 — нормализацию 401/403/429/302/500,
ровно одну попытку, отсутствие redirect и секрета в ошибке. Live-бюджет не расходуется.

`lifecycle-all-five-20261105.json`: пять сервисов, десять настоящих native
start/status/stop циклов на свежих технических PostgreSQL БД — PASS (T-O01).
Повторный start сохраняет PID, stop не оставляет owned listener/worker;
хеши истории и собственных конфигураций не изменены. VPA использует настоящий
CPU encoder и подготовленный RAG, миграция доведена до 20261104_03.
Первый отчёт `qualification-2ac755c3` с ошибкой указанного пути RAG сохранён;
успешный повтор VPA — `qualification-673a54f6`. Модельных вызовов и защищённых
изменений нет. Эти циклы не доказывают запуск всех пяти в production Compose.

`storage-final-20261105/manifest.json`: dump/restore всех пяти свежих схем PASS,
4/4/2/9/12 таблиц, source/restored fingerprints совпадают, исходные БД неизменны,
reference rows=0. Это не проверка application rollback на старый artifact.

`v1-guard-diagnostic-20261105.json` подтверждает полное равенство wire payload
baseline/candidate и SHA256 прикладных guard/orchestrator файлов. Разные модельные
решения сами по себе не устанавливают изменение бизнес-политики миграцией.
Неуспех обязательных предметных assertions остаётся в матрице.

### Функциональные проверки готовых образов — 05.11.2026

V1 `v1-container-functional-20261105/manifest.json` и V2
`v2-container-functional3-20261105/manifest.json` — PASS: настоящий HTTP,
PostgreSQL и durable worker без source mounts/runtime installs. V1 сохраняет
обоснованный факт и возвращает прежний ответ на повтор; изменённый body получает
409. V2 выполняет штатные transfer+review шаги (две авторские модельные fixture),
не изменяет документ и не утверждает его; повтор не создаёт второй run,
чужой owner получает 404. Два предыдущих V2 отчёта с неверным ожиданием одного
модельного шага сохранены, продуктовый бюджет/алгоритм не менялся.

VPA `assessor-container-functional-20261105/manifest.json` — PASS только для
явно лёгкого профиля без RAG/аналогии: настоящий HTTP/worker возвращает
insufficient_data вместо выдуманного приоритета, результат стабилен, чужой actor
не читает его; task/reference/llm_call остаются пустыми. Тяжёлый native профиль
прошёл отдельно, тяжёлый контейнерный профиль не проверен.

BKL `backlog-container-functional3-20261105/manifest.json` — PASS: настоящее
mTLS, отказ без клиентского сертификата, подписанная attestation, PostgreSQL,
Worker, стабильный message/run и повторная проверка доступа истории. DataPort
и runtime здесь являются явными in-memory fixtures; модельное качество и
физическая Docker-изоляция этим не проверены. Socket/provider key отсутствуют.
Ошибки первых двух попыток были в harness (генератор сертификата и поле run_id),
их отчёты не удалены. Вместе с meeting проверены HTTP/worker пути пяти images,
но полный production Compose и application rollback остаются открытыми.

### Gateway и клиентская регрессия — 05.11.2026

`dmb-receipts-final-20261105.junit.xml`: 55 PASS, 0 SKIP на изолированных
технических таблицах; PostgreSQL migration test использует новую БД и откатывает
свою схему. Проверены потеря ack, detached intent, смена source revision,
повтор применения и человеческое подтверждение; users/roles/teams/reference
не создавались, conftest и seed отключены. Полная рабочая миграция DMB этим
не выполнялась.

`agent-ui-remaining-20261105/report.json`: 22 PASS, 0 SKIP/FAIL/flaky — browser
fixtures V1 и BKL. Вместе с 23 meeting browser cases это 45 успешных проверок;
данные синтетические, реальная рабочая сессия/модель не используется.
`agent-ui-unit-20261105/node-test.log`: ещё 26 PASS клиентских инвариантов
V1/V2/BKL. CI теперь выполняет эти unit и три browser suites. Каталог результатов
выделен в собственный `.runtime/agent-services-evidence`, чтобы не очищать
результаты других задач. Полная живая UI/ACL-приёмка остаётся открытой.

Дополнительный разбор исторического VPA baseline: JSON body в случае 01 совпадает
с успешным candidate; старый transport выставлял официальный CLI User-Agent
и x-opencode-client=cli, текущий — собственный User-Agent/session. Это выявленное
различие транспорта, но не установленная причина HTTP 400: прежний отчёт сохранил
только response hash. Новый live probe не отправлялся; расход 96/3119 неизменен.

### Остановка qualification suite и части remote-ответа — 05.11.2026

Исправлен учёт досрочно остановленной live-suite: весь выбранный denominator
сохраняется с начала, неотправленные случаи получают NOT_RUN с причиной до
создания следующей БД/worker. Перед child launch атомарно фиксируется неизвестный
исход (BLOCKED/attempted); после обрыва controller этот случай не переигрывается
автоматически. Continuation отличает явно неотправленные случаи от попыток.
Отчёты пишутся через fsync/replace, неизвестный transport сохраняет полный резерв.
`replay-stop2-20261105.junit.xml`: 14 PASS на настоящем controller/transport wrapper
с синтетическими workers и частным ledger, без реального Go (T-Q04).
Старые отчёты и общий live ledger не переписаны. Прежние prepared capsules
не принимают изменённый runner; перед будущим запуском нужна свежая подготовка.

В remote adapter добавлена проверка ownership каждого message part по sessionID
и assistant messageID, непустых уникальных part IDs и формы массива. Чужие части
не попадают в JSON, даже если верхний assistant envelope выглядит допустимым.
`remote-part-20261105.junit.xml`: 56 PASS через HTTP emulator, включая положительный
текстовый ответ, проверенный по pinned OpenAPI. Исправление выпускается как SDK
1.4.1; прежние доказательства SDK 1.4.0 остаются историческими, не заменяются.


### Последовательная приёмка и read-only recovery — 05.11.2026

Текущая матрица: **41 PASS / 1 FAIL / 1 BLOCKED / 91 NOT_RUN из 134**.
Предыдущие числа выше относятся к датированным этапам. T-Q03 остаётся FAIL:
полная живая baseline/candidate-приёмка качества не закрыта. T-O07 BLOCKED:
при свободных 566 МБ RAM из 7,77 ГБ и CPU 100% Redis не выдерживает штатный
таймаут 10 конкурентных операций; пользователь пока не может освободить ресурсы.
Тяжёлые сборки и повтор этой нагрузки отложены, deadlines не увеличены.

Добавлены доказательства: `dmb-delivery-pg-20261105.junit.xml` — 9 PASS,
`dmb-intent-pg-20261105.junit.xml` — 3 PASS на настоящем disposable PostgreSQL;
`dmb-fixture-regression-20261105.junit.xml` — 55 PASS в обычном fixture-режиме.
Создаются только разрешённые технические таблицы, внешние identity/справочники
представлены mock DTO, строки защищённых сущностей не создаются.
`assessor-light-parts-20261105.junit.xml` — 78 PASS лёгкого профиля;
`assessor-formula-comparison-20261105/manifest.json` — совпадение шести
фиксированных расчётов baseline/candidate, без БД и модели.
`v1-correction-restart-20261105.junit.xml` — 1 PASS сохранения исправления
и provenance после повторного открытия хранилища.

Новый recovery entry point каждого сервиса сохраняет GET-контракты и авторизацию,
исключает старый lifespan, workers, модель, миграции и очистку. Изменяющие методы
возвращают 503; derived display V1/V2 меняется только в памяти запроса.
`recovery-all-20261105.junit.xml`: 12 PASS (пять продуктов в новых процессах
и семь проверок shell). `recovery-gateway-20261105.junit.xml`: 6 PASS,
включая изоляцию actor context параллельных запросов и запрет AI-действий до
бизнес-зависимостей шлюза. После этих проверок добавлено распознавание
безопасного SELECT FOR UPDATE; итоговая проверка артефактов ниже включает его.

`application-recovery-artifacts-20261105/manifest.json`: 5 PASS на собственных
новых PostgreSQL БД, по две истории, без моделей. Четыре reader используют
зафиксированный прежний бизнес-код ce713019 с явным текущим adapter; для
нового meeting-сервиса используется текущий read-only bridge. Артефакты вместе
с SDK сохранены и хешированы отдельно от рабочего дерева. Сверены fingerprint
всех таблиц до/после, чужой владелец получает 404, изменяющие запросы — 503;
BKL сохраняет повторную проверку источников и nonce-защиту. Подготовлены
синтетические истории текущим writer: это совместимость чтения новых данных,
а не полный drill с настоящей историей, созданной двумя релизами. T-O11/ACC-L12
целиком не повышаются до PASS. Рабочие процессы/профили не переключались.

В CI проверки recovery распределены по собственным окружениям сервисов;
общий SDK job не пытается импортировать все пять продуктов. Новые флаги DMB
описаны в [конфигурации](../../../agents/CONFIGURATION.md), default false.
Живой бюджет остаётся 96 из 100 вызовов, 3119 из 4500 секунд.


Итоговый установленный SDK 1.4.1 после добавления recovery shell:
wheel SHA256 `3e3f5872c678f42ab8fa4f249751c9e2cd266e325e16b631dc22869396fe5469`.
Прежний checkpoint `cfc36f64...` сохранён отдельно, не выдаётся за этот wheel.
CheckOnly сверил исходники и установленный пакет во всех четырёх окружениях.
`recovery-wheel-final-20261105.junit.xml`: 71 PASS — recovery, remote wire,
Go contract, stop-reporting и acceptance-summary; живые вызовы отсутствуют.
Два промежуточных образа SDK 1.4.1 были собраны ДО recovery shell;
они не являются финальными образами текущего кода. Новая сборка пяти образов
и полная нагрузочная приёмка остаются открыты из-за доступных ресурсов.
`markdown-links-recovery-20261105.json`: 169 локальных ссылок в шести
профильных документах, 0 broken; anchors отдельно не проверялись.


Дополнение: `application-recovery-two-releases-20261105/manifest.json` —
успешный последовательный drill всех пяти reader. У V1/V2/VPA/BKL старая
история действительно записана frozen baseline writer, затем сделан dump
и проверено его восстановление по counts/hashes; текущий writer добавил новую
историю, обе доступны старому бизнес-коду через сохранённый read-only adapter.
У нового meeting-сервиса прежнего standalone writer нет: проверен текущий bridge.
Далее отдельно проверяется восстановление объединённой истории после новой записи.

`corpus-offline-recovery-20261105/manifest.json` — повтор всех **60/60 PASS**
на итоговом установленном SDK 1.4.1; внешняя сеть запрещена, попыток внешних
соединений нет. Общий live ledger не изменился (96/3119).


### Итог синтетического rollback drill — 05.11.2026

`application-recovery-restored-20261105/manifest.json`: **5 PASS**.
Объединённая история после новой записи выгружена, восстановлена в отдельные
свежие PostgreSQL БД, counts/hashes совпали. Все пять сохранённых read-only
приложений открыли восстановленные данные с контролем доступа, без модельных
вызовов и изменений бизнес-истории. Исходные БД не изменились; protected
справочники пусты, seed не запускался. Проверены именно application readers,
а не только чтение SQL-таблиц. BKL nonce остаётся явным техническим исключением.

Это закрывает **T-O11** в разрешённом ТЗ варианте совместимого read-only adapter.
Старая и новая история четырёх существовавших сервисов создана двумя writer
версиями; для нового standalone meeting-сервиса используется read-only bridge.
Предыдущие ограничения T-O11 выше относятся к промежуточным этапам.
Рабочее переключение, writable rollback старого релиза и финальные Docker-образы
этим не подтверждаются. Матрица теперь: **42 PASS / 1 FAIL / 1 BLOCKED /
90 NOT_RUN из 134**, локальная приёмка целиком всё ещё не завершена.

Воспроизведение на разрешённой disposable инфраструктуре:
`python scripts/qualify-agent-recovery.py --two-releases --prepared .runtime/<capsule> --output .runtime/<new-dir> --postgres-container-id <full-id>`;
затем `python scripts/qualify-agent-recovery-restores.py --source .runtime/<new-dir>/manifest.json --output .runtime/<new-restore-dir> --postgres-container-id <full-id>`.
Ни одна команда не принимает рабочий DSN, не удаляет БД и не останавливает сервисы.


### Границы результата и gateway attestation — 05.11.2026

`meeting-boundaries-final-20261105.junit.xml`: **27 PASS**, T-M06.
Проверены 60000/60001 символов, 60/61 пункт до дедупликации (в том числе
61 одинаковый пункт), точная граница и +1 для title/description/owner_text/
due_text/quote. Невалидный пункт отклоняет весь candidate; quote не обрезается.
`backlog-attestation-final-20261105.junit.xml`: **3 PASS**, T-S05.
Настоящий ASGI auth path на явной синтетической технической SQLite-fixture:
повтор nonce, неверный подписанный audience и истёкший attestation получают 401.
Вызовов инструментов/runtime нет; неверный audience/expiry не создают nonce.
Рабочие identity/пользователи и данные DMB не затрагиваются.

Матрица после этих проверок: **44 PASS / 1 FAIL / 1 BLOCKED / 88 NOT_RUN**
из 134. Тяжёлые сборки и конкурентная приёмка по-прежнему открыты;
полное ТЗ и локальная приёмка не объявлены завершёнными. Обнаруженная задержка
возврата управления инструментом почти 25 минут не являлась временем тестов:
meeting suite выполнилась за 3,46 секунды, бюджет модели не изменился.
