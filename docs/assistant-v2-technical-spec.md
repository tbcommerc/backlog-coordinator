# AI-ассистент V2 для BA/PO на базе существующего агента V1

## 1. Статус и назначение документа

| Атрибут | Значение |
|---|---|
| Статус | Целевая спецификация, готова к декомпозиции |
| Дата проверки AS-IS | 19.09.2026 |
| Целевая аудитория | Product Owner, Business Analyst, разработчики, QA, архитекторы, эксплуатация |
| Базовая реализация | существующий сервис agent/ |
| Рекомендуемый каталог V2 | agent-v2/ |
| Стратегия MVP | изолированный fork/copy V1 без общего runtime-кода |
| Основные режимы | assignment_capture и requirement_copilot |

Документ заменяет прежнюю концепцию самостоятельной greenfield-платформы AI Assistant V2.
V2 должен развиваться как экспериментальная BA/PO-ветвь существующего агента V1,
а не как универсальная платформа NeedCase.

Каталог assistant-v2/, присутствующий в рабочем дереве на дату проверки, является
реализацией прежней концепции. Документ
[assistant-v2-implementation.md](assistant-v2-implementation.md) остаётся описанием её
фактического AS-IS, но не задаёт целевую архитектуру. Решение о переносе полезных
элементов, консервации или удалении этого прототипа принимается отдельно; данное ТЗ
не разрешает автоматически менять его данные или код.

Нормативные слова:

- MUST — обязательное требование;
- SHOULD — рекомендуемое решение, отклонение требует ADR;
- MAY — допустимое расширение;
- OUT — не входит в MVP.

## 2. Исправленный продуктовый замысел

### 2.1. Цель

V2 помогает BA и PO преобразовать входящее поручение или существующий рабочий
объект в проверяемый, подробно проработанный артефакт, сохраняя сильные стороны V1:
диалог, состояние, доказательность, контроль качества, версии и передачу на ревью.

V2 не заменяет BA/PO и не принимает управленческих решений. Он:

1. фиксирует происхождение задания;
2. задаёт один наиболее ценный следующий вопрос;
3. отделяет подтверждённые факты от предположений;
4. поддерживает явные пробелы и конфликты;
5. формирует AssignmentPassport или BusinessRequirementDraftV2;
6. предлагает, но не применяет изменения связанного объекта;
7. передаёт результат в существующий human review.

### 2.2. Пользователи

| Актор | Назначение |
|---|---|
| BA | фиксирует поручение, проводит анализ, готовит глубокое требование |
| PO | фиксирует поручение, уточняет ценность и границы, готовит или проверяет требование |
| Бизнес-заказчик | источник поручения; в MVP не обязан работать в V2 |
| Ревьюер | использует существующую очередь RequirementRequest |

V2 MUST использовать текущего аутентифицированного пользователя DMB. Новые роли,
назначения ролей, команды и владельцы в рамках MVP не создаются и не изменяются.
Поле `operator_role` — доверенный контекст диалога `BA` или `PO`, а не
новая RBAC-роль. Его вычисляет DMB gateway из текущего
аутентифицированного профиля; клиент не может назначить себе другую роль.
Полный администратор DMB допускается без pilot allowlist и получает контекст
`operator_role=BA`, не меняя свою RBAC-роль. Для остальных пользователей
неоднозначное соответствие решается только конфигурацией пилота, без изменения
пользователей, ролей или команд.

### 2.3. Два режима

| Режим | Вход | Основной выход | Завершение |
|---|---|---|---|
| assignment_capture | поручение, полученное вне агента | AssignmentPassport | паспорт готов к передаче в проработку |
| requirement_copilot | паспорт, Request, Task, цель или свободный черновик | BusinessRequirementDraftV2 | черновик готов к существующему review |

Переход assignment_capture → requirement_copilot сохраняет provenance и не требует
повторного ввода уже подтверждённых сведений.

## 3. Границы MVP

### 3.1. Входит

- изолированная копия V1 в agent-v2/;
- отдельные entrypoint, процесс, порт 9300, API prefix,
  `AGENT_V2_*`-конфигурация, секрет и БД сессий V2;
- выбор одного из двух режимов при создании сессии;
- контекст оператора BA/PO;
- SourceContext и необязательная привязка к существующему объекту;
- AssignmentPassport;
- расширенный BusinessRequirementDraftV2;
- ручное редактирование разделов и история ревизий;
- ProposedPatch как предложение с preview/diff;
- совместимость с существующей очередью RequirementRequest;
- feature flag, pilot allowlist для BA/PO, автоматический допуск полного
  администратора и независимый kill switch;
- regression, characterization и golden conversation tests.

### 3.2. Не входит

Следующие возможности имеют статус OUT:

- универсальный NeedCase и отдельный case-management workflow;
- enterprise knowledge graph;
- новый compliance/approval workflow;
- outcome analytics и автоматическая оценка бизнес-эффекта;
- автоматическая приоритизация;
- автоматическое согласование или применение изменений;
- изменение RBAC, ролей, команд или справочников;
- расшифровка аудио;
- общий Python-пакет между V1 и V2 в MVP;
- миграция сессий V1 в V2;
- замена V1 до результатов пилота.

### 3.3. Future scope после MVP

Следующие идеи не являются отложенными обязательствами и не должны
влиять на архитектуру MVP:

- выделение shared core после пилота и только при доказанной стабильности
  границ и отдельном плане миграции V1;
- новые linked-object adapters и применение согласованных patch после отдельного
  security и product review;
- дополнительные режимы и группы пользователей, если метрики пилота
  подтвердят ценность.

Universal NeedCase, enterprise graph, auto-priority, auto-approval, compliance
workflow, outcome analytics и audio transcription остаются за границами
и future scope, пока для каждой из этих целей не будет принято новое
отдельное ТЗ.

## 4. Подтверждённый AS-IS V1

Источником истины являются код и тесты. Ключевые подтверждённые точки:

| Возможность V1 | Реализация |
|---|---|
| Entrypoint, порт и runtime config | [agent/run.py](../agent/run.py#L1), [agent/agent/config.py](../agent/agent/config.py#L13) |
| FastAPI и internal prefix | [agent/agent/main.py](../agent/agent/main.py#L48), router под `/api/agent` |
| Browser/DMB gateway | [dmb-backlog/backend/routers/agent_router.py](../dmb-backlog/backend/routers/agent_router.py#L416), в browser доступен под `/api/v1/agent` |
| DTO chat/session/review | [agent/agent/api/schemas.py](../agent/agent/api/schemas.py#L7) |
| Основной runtime | [agent/agent/agentic_orchestrator.py](../agent/agent/agentic_orchestrator.py#L36) |
| Базовая workflow-логика | [agent/agent/orchestrator.py](../agent/agent/orchestrator.py#L97) |
| Персистентные сессии, receipts, locking | [agent/agent/session.py](../agent/agent/session.py#L221), `SessionStore` |
| DialogueState и слоты | [agent/agent/dialogue/state.py](../agent/agent/dialogue/state.py#L180) |
| Активный prompt, structured decision и guards | [agent/agent/dialogue/agentic.py](../agent/agent/dialogue/agentic.py#L34), `SYSTEM`, `TurnDecision`, `AgenticBA` |
| Composer и схема результата | [agent/agent/composer/composer.py](../agent/agent/composer/composer.py#L55) |
| Fingerprint ревизии | [agent/agent/composer/revision.py](../agent/agent/composer/revision.py#L6) |
| Независимая проверка черновика | [agent/agent/composer/reviewer.py](../agent/agent/composer/reviewer.py#L23) |
| Контекст пользователя | [agent/agent/context.py](../agent/agent/context.py#L10) |
| Retrieval hooks | [agent/agent/kb/retrieval.py](../agent/agent/kb/retrieval.py#L8) |
| Audit без текста сообщения | [agent/agent/audit.py](../agent/agent/audit.py#L13) |
| DMB active-session mapping | [dmb-backlog/backend/models.py](../dmb-backlog/backend/models.py#L799), `AgentSession` |
| DMB review entity и revision history | [dmb-backlog/backend/models.py](../dmb-backlog/backend/models.py#L810), `RequirementRequest` |
| Review миграции | [3a886fb49c17_initial_postgresql_schema.py](../dmb-backlog/backend/alembic/versions/3a886fb49c17_initial_postgresql_schema.py#L610), [c1a9e8b7d602_requirement_revision_history.py](../dmb-backlog/backend/alembic/versions/c1a9e8b7d602_requirement_revision_history.py#L17) |
| V1 chat UI и route | [agentChat.js](../dmb-backlog/frontend/js/components/agentChat.js#L112), [router.js](../dmb-backlog/frontend/js/router.js#L131) |
| Review UI | [reviewPage.js](../dmb-backlog/frontend/js/components/reviewPage.js#L219), [requestPresentation.js](../dmb-backlog/frontend/js/components/requestPresentation.js#L135) |

`agent/agent/prompts/system_prompt.md` присутствует в репозитории, но текущий
runtime передаёт модели константу `SYSTEM` из `dialogue/agentic.py`.
Поэтому fork baseline MUST характеризовать именно этот активный prompt;
перенос его в versioned files — отдельная V2-адаптация после baseline gate.

V1 уже умеет:

- хранить DialogueState в PostgreSQL или SQLite;
- сериализовать обработку одной сессии и применять optimistic locking;
- дедуплицировать сообщения через message_id;
- хранить в state копии retrieval results, gaps, assumptions и conflicts;
- задавать один вопрос и сохранять состояние до вызова модели;
- формировать RequirementDraft с field provenance;
- вычислять fingerprint черновика;
- блокировать отправку устаревшей или конфликтной ревизии;
- открывать, возвращать и повторно отправлять review;
- адаптировать стиль по UserContext;
- подключать retrieval через контракт;
- передавать черновик в существующий RequirementRequest.

Следствие: эти механизмы MUST быть исходной точкой V2. Повторная реализация
аналогичного каркаса с нуля запрещена без отдельного ADR.

## 5. Ключевые архитектурные решения

### V2-FORK-001. Изолированный fork

Начальная версия agent-v2/ MUST быть файловой копией agent/ на зафиксированном
commit. Копирование выполняется до функциональных изменений и сопровождается
характеризационными тестами.

### V2-FORK-002. Независимость импортов

- agent/ MUST NOT импортировать agent-v2/;
- agent-v2/ MUST NOT импортировать agent/;
- общие исходники через symlink, PYTHONPATH или runtime mount запрещены;
- обновление одной версии не должно перезапускать другую.

### V2-FORK-003. Без раннего common core

В MVP общий пакет не выделяется. Возможное извлечение shared core рассматривается
только после пилота, когда подтверждены стабильные общие границы и стоимость
синхронизации копий стала измеримой.

### V2-ISO-001. Отдельное выполнение

V2 MUST иметь:

- `agent-v2/run_v2.py` и самостоятельный процесс с health/readiness;
- локальный порт 9300, не занятый V1 (9000), prioritiser (9100) и
  имеющимся greenfield-прототипом (9200);
- internal prefix `/api/agent-v2`, browser gateway prefix `/api/v2/agent`
  и UI route `#/agent-v2`;
- отдельный `AGENT_V2_SESSION_DATABASE_URL`;
- отдельный `AGENT_V2_SECRET`;
- отдельные runtime logs и metrics labels;
- `AGENT_V2_ENABLED=false` по умолчанию, `AGENT_V2_PILOT_USER_IDS`,
  `AGENT_V2_PILOT_EMAILS` и независимый kill switch.

Запуск V2 не должен быть обязательным для штатного V1.

### V2-ISO-002. Отдельные сессии

Сессии V1 и V2 не смешиваются. Даже при размещении на одном PostgreSQL-инстансе
используются отдельная БД или отдельная схема с отдельной ролью. Рекомендуемый
вариант пилота — отдельная БД `agent_v2_sessions` с отдельной DB-ролью.
Внутри неё можно сохранить имена таблиц V1 `sessions` и `message_receipts`:
изоляцию даёт БД, а не новая платформенная схема.

## 6. Структура решения

~~~mermaid
flowchart LR
    UI[DMB UI: Assistant V2] --> GW[DMB V2 gateway]
    GW --> V2[agent-v2 FastAPI]
    V2 --> S2[(V2 session DB)]
    V2 --> KB[V2 retrieval adapters]
    V2 --> GW
    GW --> RR[(Existing RequirementRequest)]
    RR --> REVIEW[Existing review queue]

    V1UI[DMB UI: Assistant V1] --> V1GW[DMB V1 gateway]
    V1GW --> V1[agent FastAPI]
    V1 --> S1[(V1 session DB)]

    V1 -. no imports .- V2
    S1 -. no shared tables .- S2
~~~

Рекомендуемая структура:

~~~text
agent/
  agent/
  tests/
agent-v2/
  agent_v2/
  tests/
  prompts/
  docs/
  FORK_PROVENANCE.json
~~~

Копия сначала фиксируется в неизменном виде для baseline comparison,
затем в том же инкременте выполняется механическое переименование Python-пакета
в `agent_v2`. Env-префикс, логгер и telemetry service name также MUST быть
отдельными. После переименования differential tests повторяются;
отклонение должно быть только механическим.

## 7. Матрица повторного использования V1

Коды действий: `REUSE` — использовать текущий DMB/V1-компонент без
изменения; `COPY` — физически скопировать в `agent-v2/`; `ADAPT` — менять
только V2-копию после baseline gate; `ADD` — добавить изолированный
V2-компонент. `COPY → ADAPT` означает именно эту очерёдность.

| Компонент V1 | Фактический файл/класс | Действие | BA/PO delta | Риск влияния на V1 | Compatibility test |
|---|---|---|---|---|---|
| Entrypoint/config/FastAPI | `agent/run.py`, `config.Settings`, `main.app` | COPY → ADAPT | `run_v2.py`, port 9300, `AGENT_V2_*`, `/api/agent-v2` | общий env или неверный import | import-origin assertion; V1 route/OpenAPI snapshot |
| Service API | `api/router.py`, `api/schemas.py` | COPY → ADAPT | `product_mode`, `operator_role`, source/link/handoff/patch DTO | rename V1 response fields | V1 `test_full_chat_flow`; normalized baseline responses |
| User context | `context.UserContext`, `style_for` | COPY → ADAPT | trusted `operator_role`, capabilities snapshot; dialogue style сохранён | client role spoofing | forged-context negative tests; V1 style cases |
| Session persistence | `session.SessionStore`, `state_to_dict`, `state_from_dict` | COPY → ADAPT | V2 fields и schema version в `state_json`; отдельная DB | запись в V1 DB | DB URL/role assertion; state round-trip |
| Message receipts | `SessionStore.get_cached_response/cache_response` | COPY | нет, isolation даёт V2 DB | replay collision | `test_chat_message_id_is_idempotent`; retention tests |
| Concurrency | `SessionStore.serialized/save` | COPY | нет | lost update при дрейфе копии | `test_session_store_rejects_stale_state_save` |
| Dialogue data | `dialogue/state.py`: `DialogueState`, `Slot`, `Gap` | COPY → ADAPT | product mode, source, link, two artifact slot groups, provenance | serialization drift | V1 fixture → V2 round-trip; safe defaults |
| Active model contract | `dialogue/agentic.py`: `SYSTEM`, `TurnDecision`, `AgenticBA` | COPY → ADAPT | BA/PO facts, explicit provenance operations, mode-specific prompt | ослабление guards/one-question | fail-closed, one-question and security cases |
| Dialogue style | `dialogue/mode_selector.ModeSelector` | COPY | guided/hybrid/free-form/expert remains style, not product mode | смешение двух осей mode | product mode × dialogue mode matrix |
| Product-mode dispatch | нет в V1 | ADD | `assignment_capture` / `requirement_copilot` before slot/readiness policy | fallback в V1 | explicit mode/default-deny tests |
| Next-question policy | `QuestionPlanner`, `PolicyEngine`, `machine.next_slot` | COPY → ADAPT | mode-specific gaps при one-question rule | questionnaire regression | V1 planner characterization; BA/PO golden turns |
| Runtime orchestration | `AgenticOrchestrator`, base `AgentOrchestrator` | COPY → ADAPT | two flows, handoff, linked snapshot, patch preview | review lock/persistence regression | sent-lock tests; differential transcripts |
| Composer/schema | `build_draft`, `RequirementDraft`, `to_markdown` | COPY → ADAPT | `AssignmentPassport` и additive `BusinessRequirementDraftV2` | потеря field provenance | V1 JSON/Markdown snapshot; field mapping tests |
| Quality/gaps/reviewer | `assess_quality`, `synchronize_gaps`, `review_draft` | COPY → ADAPT | two deterministic readiness policies | false ready/block | optional-gap and critical-conflict tests |
| Fingerprint | `composer/revision.draft_fingerprint` | COPY | full JSON обоих артефактов | stale submission | stale-draft-hash test |
| Audit | `log_event/log_dialogue/log_refusal/log_draft` | COPY → ADAPT | mode/artifact/link ids и hashes, без raw content | утечка текста | V1 audit privacy tests |
| Retrieval hooks | `kb/contracts.py`, `RetrievalService`, adapters | COPY | same contracts; scope/filter задаёт V2 orchestration | cross-scope evidence | V1 KB contract/policy cases |
| Input/output guards | `input_harness.py`, `output_harness.py` | COPY → ADAPT | BA/PO vocabulary и new schemas без policy relaxation | injection/schema bypass | V1 malicious/runtime-safety suite + V2 corpus |
| V1 DMB gateway | `backend/routers/agent_router.py` | REUSE | нет; файл не меняется для V2 | любая правка ломает V1 | current backend agent suites unchanged |
| V2 DMB gateway | нет в V1 | ADD | `agent_v2_router.py/service.py`, `/api/v2/agent`, own secret/allowlist | startup coupling | disabled-start smoke; V1 proxy tests; adapter contract |
| V1 active-session mapping | `models.AgentSession` / `agent_sessions` | REUSE | нет | V1 active session overwritten | V1 active-session regression |
| V2 active-session mapping | нет в V1 | ADD | `AgentV2Session` / `agent_v2_sessions` только для UI pointer | protected user/team mutation | migration shape; no protected-field writes |
| Review entity/history | `models.RequirementRequest`, `requirement_artifacts.py` | REUSE | V2 metadata в `draft`, namespaced `agent_session_id` | V1/V2 collision | idempotent retry; queue coexistence |
| Review submission/lifecycle | handlers in `agent_router.py` | REUSE behavior + ADD adapter | confirmed snapshot/compensation/resubmit contract | parallel review workflow | DMB idempotency, compensation, resubmission tests |
| V1 chat UI | `agentChat.js`, `#/customer/create` | REUSE | нет; V1 bundle/route remain unchanged | eager V2 loading | `agentChatWorkflow.test.mjs`, `agentChatUx.test.mjs` |
| V2 UI | нет в V1 | ADD | lazy `#/agent-v2`, mode/source/link/artifact/diff views | router startup regression | feature/allowlist/lazy-load tests |
| Review UI | `reviewPage.js`, `requestPresentation.js` | REUSE → ADAPT minimally | additive V2 sections, V1 fallback | V1 card regression | review/presentation/integrity frontend suites |
| Test patterns | `agent/agent/tests`, backend/frontend suites | COPY baseline + ADD | differential harness, BA/PO golden conversations | volatile-field false differences | normalized comparison with explicit ignore list |

`REUSE` не разрешает рефакторинг V1 ради V2. Если additive integration требует
правки общего DMB-файла (`main.py`, `router.js`, presentation renderer), она
ограничивается feature-gated подключением и покрывается V1 regression.

## 8. Provenance fork и синхронизация исправлений

В корне agent-v2/ MUST находиться FORK_PROVENANCE.json. Он фиксирует:

- исходный Git commit и чистоту source tree в момент fork;
- дату копирования;
- список всех скопированных путей и source/destination mapping;
- source и destination hash каждого критического файла;
- ответственного за V1 и V2;
- список намеренных отклонений;
- набор differential tests;
- журнал перенесённых security fixes.

Для каждого critical/high исправления в V1 владелец обязан в течение согласованного
SLA:

1. классифицировать применимость к V2;
2. перенести исправление или записать обоснование неприменимости;
3. запустить compatibility tests;
4. обновить manifest.

Обратное правило действует для исправлений, найденных в V2. Автоматический merge
между каталогами запрещён.

## 9. AS-IS → V2 delta

| Этап | V1 AS-IS | V2 target |
|---|---|---|
| Старт | `new_session(user_id, UserContext)` создаёт один flow сбора требования | gateway передаёт trusted `operator_role`; пользователь явно выбирает `product_mode` |
| Контекст | `UserContext`: id, name, email, role/team/department, `is_ba` | тот же minimal context + server-derived BA/PO role, `SourceContext`, authorized `LinkedObjectSnapshot` |
| Prompts | runtime использует inline `dialogue.agentic.SYSTEM` | копия V1 prompt как baseline; затем versioned `base_guard` + один mode prompt, загружаемые только V2 |
| Mode selection | `dialogue_mode` = guided/hybrid/free_form/expert адаптирует стиль | ось `dialogue_mode` сохраняется; ортогональная ось `product_mode` выбирает artifact/slots/readiness |
| Слоты | `COLLECTION_SLOTS`, `Slot`, `Gap`, hard/soft/optional categories | сохранить V1 base fields; добавить только assignment- и deep-requirement fields с typed provenance |
| Следующий вопрос | `TurnDecision.focus` + `QuestionPlanner`/`PolicyEngine`; Python guards оставляют один вопрос | тот же contract; priority считает mode readiness, conflict, provenance и linked-object delta |
| Composer | `build_draft` создаёт `RequirementDraft`, provenance, gaps, scores и findings | две V2-операции на том же каркасе: `AssignmentPassport` и additive `BusinessRequirementDraftV2` |
| Validation/readiness | hard minimum, quality assessment, independent `review_draft`; critical finding блокирует send | separate deterministic policy для passport и deep draft; model не устанавливает ready |
| Revision/edit | explicit `edit-draft-section`, state/slot history, canonical fingerprint | то же + immutable artifact revisions и `ProposedPatch` preview; direct apply нет |
| Send for review | DMB получает confirmed snapshot, создаёт/переотправляет `RequirementRequest`, compensates failure | отдельный V2 adapter повторяет contract и пишет в ту же review queue с namespaced session id |
| UI | static V1 route `#/customer/create`, session history, draft editor; shared review pages | lazy V2 route `#/agent-v2`, mode/source/link step, two artifact views, provenance/diff; V1 route не меняется |

## 10. Контекст сессии

### 10.1. Хранилище сессий agent-v2

База — копия `SessionStore` V1, а не новый session framework. В отдельной
V2 DB сохраняются таблицы `sessions` и `message_receipts` с их V1-семантикой:

| Место | Поле | Правило |
|---|---|---|
| `sessions` | `session_id` | уникальный V2 id; не переносится из V1 |
| `sessions` | `user_id` | из trusted DMB envelope |
| `sessions` | `state_json` | сериализованный `DialogueStateV2`, включая `schema_version`, mode, role, lifecycle |
| `sessions` | `version` | optimistic lock; в API projection называется `storage_version` |
| `sessions` | `updated_at`, `last_message_at` | lifecycle и список диалогов |
| `message_receipts` | `session_id`, `message_id`, response, timestamp | тот же idempotency/retention contract |

Новые колонки не добавляются, пока V2-specific load/query не докажет
необходимость. `archived`, `operator_role`, `product_mode` и `schema_version`
в MVP живут в `state_json`, как и большинство lifecycle-полей V1.

### 10.2. DMB active-session mapping

Текущая `AgentSession` и таблица `agent_sessions` остаются только для V1.
Если UI пилота должен помнить активный V2-диалог между устройствами,
добавляется изолированная копия `AgentV2Session` / `agent_v2_sessions`
только с `user_id`, `agent_session_id` и timestamps. Она не хранит роли,
команды или их назначения.

### 10.3. SourceContext

SourceContext отвечает на вопросы откуда пришло поручение и что именно было
получено. Это embedded value object.

~~~json
{
  "source_type": "business_customer",
  "originator": {
    "display_name": "Бизнес-заказчик",
    "external_ref": null
  },
  "channel": "meeting",
  "received_at": "2026-09-19T09:30:00+03:00",
  "source_summary": "Нужно сократить ручную сверку заявок",
  "attachments": [],
  "provenance": [
    {
      "kind": "originator_statement",
      "message_id": "msg-001",
      "recorded_by_user_id": 42
    }
  ]
}
~~~

source_type и channel — controlled application enums V2, но не системные
справочники DMB. Их изменение не создаёт записи в защищённых справочниках.

### 10.4. LinkedObjectSnapshot

Связанный объект в MVP является read-only snapshot:

| Поле | Назначение |
|---|---|
| object_type | request, task, goal, draft |
| object_id | id во внешней системе |
| source_system | dmb или другой allowlisted adapter |
| object_version | версия для optimistic comparison |
| fingerprint | hash нормализованного snapshot |
| title, summary | безопасная проекция |
| allowed_fields | поля, разрешённые для proposal |
| captured_at | время snapshot |

Доступ к snapshot проверяется DMB повторно на каждом чтении. V2 не получает
credentials основной БД.

### 10.5. Минимальная модель данных

| Структура | База | Зачем нужна | MVP storage |
|---|---|---|---|
| `DialogueStateV2` | isolated copy of `DialogueState` | conversation/workflow state | V2 `sessions.state_json` |
| `AssignmentPassport` | V2 artifact schema on composer V1 | handoff from assignment capture | inside state/revision snapshots |
| `BusinessRequirementDraftV2` | additive copy of `RequirementDraft` | deep BA requirement | inside state and `RequirementRequest.draft` after submit |
| `LinkedObjectSnapshot` | new embedded value object | authorized, stable read model | inside V2 state; no DMB credentials |
| `ProposedPatch` | new embedded proposal | preview only | inside V2 state/revision history |
| `AgentV2Session` | isolated variant of DMB `AgentSession` | optional active pointer | DMB table `agent_v2_sessions` |
| `RequirementRequest` | existing DMB entity | existing human review | current `requirement_requests`, no parallel queue |

Отдельные tables для passports, drafts, patches и handoffs не создаются,
пока объём, query patterns и retention не докажут, что `state_json`/
`revision_history` недостаточны.

## 11. DialogueStateV2

DialogueStateV2 создаётся расширением скопированного DialogueState:

~~~text
DialogueStateV2 = DialogueState V1
  + operator_role
  + product_mode
  + source_context
  + linked_object_snapshot
  + assignment_slots
  + requirement_v2_slots
  + artifact_type
  + artifact_revision_history
  + proposed_patch
  + handoff_context
~~~

Существующие поля history, slots, gaps, sources, slot_history,
requirement_conflicts, requirement_assumptions, quality_assessment, draft,
review_status и review_task_id сохраняются.

Новые данные MUST участвовать в state_to_dict/state_from_dict и иметь safe defaults,
чтобы более ранние V2-сессии оставались читаемыми.

### 11.1. Provenance types

Допустимые kind в MVP:

- originator_statement — дословные слова бизнес-заказчика;
- operator_interpretation — интерпретация BA/PO, не выдаваемая за цитату;
- agent_hypothesis — гипотеза агента, всегда неподтверждённая;
- human_decision — решение человека: confirmation, manual_edit,
  review_feedback, patch_accept или patch_reject;
- linked_object_snapshot;
- knowledge_base;
- attachment_excerpt;

`agent_hypothesis` никогда не считается подтверждённым фактом без явного решения
оператором. Для каждого значения хранятся evidence, source reference, confidence,
confirmation status и message/revision id. Превращение гипотезы в факт добавляет
новую provenance-запись `human_decision`, а не переписывает историю.

### 11.2. Конфликты и пробелы

V2 копирует registry V1. Изменения:

- gap получает artifact_type и mode;
- conflict может ссылаться на linked snapshot и новую реплику;
- resolved/deferred не удаляются из истории;
- критический открытый conflict блокирует handoff/review;
- необязательный gap отображается, но не всегда блокирует готовность.

## 12. Режим assignment_capture

### 12.1. Назначение

Режим используется, когда BA/PO получил поручение вне агента: на встрече, в письме,
мессенджере, документе или устно. V2 помогает зафиксировать смысл и границы, но не
требует полного бизнес-требования.

~~~mermaid
flowchart TD
    A[Выбор assignment_capture] --> B[Источник и инициатор]
    B --> C[Суть поручения]
    C --> D[Цель и ожидаемый результат]
    D --> E[Scope, ограничения, сроки]
    E --> F[Участники и исходные материалы]
    F --> G{Критические пробелы?}
    G -- да --> H[Один следующий вопрос]
    H --> G
    G -- нет --> P[AssignmentPassport]
    P --> Q{Продолжить проработку?}
    Q -- да --> R[requirement_copilot с сохранением provenance]
    Q -- нет --> S[Сохранить или передать паспорт]
~~~

### 12.2. Обязательные слоты

Блокирующие:

- source_context.source_type;
- source_context.channel;
- assignment_statement;
- business_goal;
- expected_result;
- scope_in;
- originator или явная отметка unknown;
- deadline_or_urgency или явная отметка not_specified;
- owner_next_step.

Уточняющие:

- scope_out;
- stakeholders;
- constraints;
- dependencies;
- initial_risks;
- source_materials;
- open_questions;
- linked_object.

### 12.3. AssignmentPassport

~~~json
{
  "schema": "assignment-passport.v1",
  "id": "ap_01J8EXAMPLE",
  "title": "Сократить ручную сверку заявок",
  "operator": {
    "user_id": 42,
    "role": "BA"
  },
  "source_context": {
    "source_type": "business_customer",
    "originator_label": "Руководитель процесса",
    "channel": "meeting",
    "received_at": "2026-09-19T09:30:00+03:00"
  },
  "assignment_statement": "Проработать автоматизацию сверки заявок",
  "business_goal": "Снизить время ручной проверки",
  "expected_result": "Согласованный вариант целевого процесса и критерии",
  "scope": {
    "in": ["Сверка реквизитов заявки"],
    "out": ["Изменение справочников"]
  },
  "constraints": ["Не менять действующие роли пользователей"],
  "deadline_or_urgency": "Черновик к 2026-09-30",
  "stakeholders": ["Бизнес-заказчик", "BA", "PO"],
  "assumptions": [],
  "gaps": [],
  "conflicts": [],
  "sources": [
    {
      "kind": "operator_interpretation",
      "message_id": "msg-001"
    }
  ],
  "readiness": {
    "ready": true,
    "blocking_codes": []
  },
  "next_step": "requirement_copilot",
  "revision": 3
}
~~~

### 12.4. Readiness

Паспорт готов, если:

- заполнены или явно помечены unknown/not_specified все блокирующие слоты;
- суть поручения, цель и ожидаемый результат не противоречат друг другу;
- нет открытого critical conflict;
- указан следующий ответственный шаг;
- оператор просмотрел итоговую сводку.

Оценка готовности детерминирована. Модель MAY предложить gap, но не выставляет
ready самостоятельно.

### 12.5. Handoff

Handoff из AssignmentPassport:

- создаёт immutable snapshot паспорта;
- переносит подтверждённые поля и provenance в новую или текущую V2-сессию
  requirement_copilot;
- переносит unresolved gaps и conflicts;
- не создаёт Task;
- не отправляет RequirementRequest без отдельного действия пользователя.

### 12.6. V2-SC-AC-001 — фиксация поручения BA/PO

**Предусловия:** `AGENT_V2_ENABLED=true`; текущий DMB-пользователь
входит в pilot allowlist либо имеет `admin_access=full`; gateway определил
`operator_role=BA|PO`.

**Основной поток:**

1. Оператор открывает `#/agent-v2`, выбирает `assignment_capture` и указывает
   channel, originator и краткие слова заказчика.
2. Gateway создаёт V2-сессию, не изменяя V1 `AgentSession`, и передаёт
   server-derived context. Исходная цитата получает provenance
   `originator_statement`.
3. Forked orchestrator сохраняет user turn до model call, извлекает
   facts и отделяет `operator_interpretation` от `agent_hypothesis`.
4. Deterministic policy выбирает один наиболее ценный вопрос, пока не закрыты
   assignment statement, goal, expected result, scope и next step.
5. Оператор просматривает сводку, исправляет неточности и явно
   подтверждает результат; это создаёт `human_decision`.
6. Composer создаёт ревизию `AssignmentPassport`; validator считает readiness,
   fingerprint и blocking codes.
7. Оператор либо сохраняет/архивирует паспорт, либо запускает explicit handoff
   в `requirement_copilot`. Task и `RequirementRequest` не создаются.

**Альтернативные потоки:**

- A1: срок или originator неизвестен — оператор выбирает `unknown`/
  `not_specified`; gap сохраняется без выдуманного значения.
- A2: оператор привязывает доступный Request/Task — snapshot становится
  дополнительным источником, но не перезаписывает слова заказчика.
- A3: оператор прерывает диалог — state остаётся resumable, паспорт не
  маркируется ready без подтверждения.

**Ошибочные потоки:**

- E1: client подменяет `operator_role` или `user_id` — gateway игнорирует/отклоняет
  client value и не создаёт сессию.
- E2: LLM недоступна или возвратила невалидный JSON — user turn уже сохранён,
  facts не домысливаются, response = controlled unavailable.
- E3: concurrent save на stale `storage_version` — HTTP 409/session conflict; клиент
  перезагружает current state.
- E4: critical conflict или пропущенный blocking slot — passport можно
  просматривать, но handoff disabled с конкретным blocking code.

**Постусловие:** существует versioned `AssignmentPassport` с трассируемыми facts,
gaps/conflicts и без побочных записей в DMB business objects.

## 13. Режим requirement_copilot

### 13.1. Входы

Режим начинается из одного из источников:

1. AssignmentPassport;
2. существующий RequirementRequest;
3. существующая Task;
4. формулировка цели;
5. свободный черновик пользователя.

Если выбран существующий объект, V2 сначала получает authorized
LinkedObjectSnapshot. Недоступный объект не раскрывается и возвращает одинаковый
not_found_or_forbidden.

~~~mermaid
flowchart TD
    A[Выбор requirement_copilot] --> B{Есть исходный объект?}
    B -- паспорт --> C[Импорт подтверждённых фактов]
    B -- Request/Task --> D[Authorized snapshot]
    B -- нет --> E[Свободный ввод]
    C --> F[Coverage и gaps]
    D --> F
    E --> F
    F --> G[Один вопрос с максимальной ценностью]
    G --> H[Обновить state и draft]
    H --> I{Готовность}
    I -- нет --> G
    I -- да --> J[BusinessRequirementDraftV2]
    J --> K[Preview ProposedPatch]
    J --> L[Send for existing review]
~~~

### 13.2. Требуемая глубина

BusinessRequirementDraftV2 MUST включать:

- origin и связь с исходным поручением;
- problem statement и business goal;
- AS-IS;
- TO-BE;
- scope in/out;
- actors и stakeholders;
- основной, альтернативные и исключительные сценарии;
- business rules;
- data and integrations на бизнес-уровне;
- functional requirements;
- relevant non-functional requirements;
- acceptance criteria с проверяемым результатом;
- success metrics, если известны;
- dependencies, constraints и risks;
- assumptions, gaps и conflicts;
- field-level provenance;
- linked object snapshot metadata;
- revision и fingerprint.

V2 не должен выдумывать техническую архитектуру, если пользователь её не задал и
не запросил техническую детализацию.

### 13.3. BusinessRequirementDraftV2

Модель расширяет RequirementDraft V1, сохраняя совместимые поля. Новые поля
добавляются, существующие не переименовываются в MVP.

~~~json
{
  "schema": "business-requirement-draft.v2",
  "id": "br_01J8EXAMPLE",
  "title": "Автоматическая сверка реквизитов заявки",
  "origin": {
    "assignment_passport_id": "ap_01J8EXAMPLE",
    "source_type": "business_customer"
  },
  "linked_object": {
    "object_type": "task",
    "object_id": "812",
    "object_version": "7",
    "fingerprint": "sha256:example"
  },
  "problem_statement": "Ручная сверка увеличивает время обработки",
  "business_goal": "Сократить время и число ошибок",
  "current_process": "Специалист вручную сверяет реквизиты",
  "target_process": "Система подсвечивает расхождения до принятия решения",
  "scope_in": ["Проверка обязательных реквизитов"],
  "scope_out": ["Автоматическое изменение справочников"],
  "actors": ["Специалист процесса"],
  "scenarios": [
    {
      "id": "SC-1",
      "type": "main",
      "steps": ["Открыть заявку", "Запустить сверку", "Просмотреть расхождения"]
    }
  ],
  "business_rules": ["Несовпадение не меняет заявку автоматически"],
  "functional_requirements": ["Показать поле, ожидаемое и фактическое значение"],
  "non_functional_requirements": [],
  "acceptance_criteria": [
    "При несовпадении обязательного реквизита пользователь видит расхождение до подтверждения"
  ],
  "dependencies": [],
  "risks": [],
  "assumptions": [],
  "gaps": [],
  "conflicts": [],
  "field_provenance": {
    "business_goal": {
      "kind": "operator_interpretation",
      "message_id": "msg-004",
      "confirmed": true
    }
  },
  "quality": {
    "ready_for_review": true,
    "blocking_codes": []
  },
  "revision": 5,
  "fingerprint": "sha256:example"
}
~~~

### 13.4. Readiness

Готовность к review требует:

- заполнения V1 hard minimum;
- business goal, scope in/out и минимум одного end-to-end scenario;
- проверяемых acceptance criteria для обязательных сценариев;
- явной фиксации известных rules, dependencies и risks либо none-known;
- отсутствия critical gaps/conflicts;
- валидного provenance для критических полей;
- актуального fingerprint;
- подтверждения пользователем финальной сводки.

Optional gaps не блокируют review, но MUST передаваться в RequirementRequest.

### 13.5. V2-SC-RC-001 — глубокая проработка и review

**Предусловия:** BA в pilot allowlist либо полный администратор; есть ready `AssignmentPassport` или
доступный Request/Task/цель/черновик; V1 продолжает работать независимо.

**Основной поток:**

1. BA выбирает `requirement_copilot` и исходный объект. Для DMB-объекта
   gateway проверяет доступ и возвращает `LinkedObjectSnapshot` с version/fingerprint.
2. Orchestrator импортирует подтверждённые facts и provenance, но не повышает
   confidence и не скрывает противоречия между passport, snapshot и новым вводом.
3. Coverage policy сравнивает state с deep-requirement schema и по одному уточняет
   highest-risk gaps: problem/goal, AS-IS/TO-BE, scope, actors, scenarios, rules,
   data/integrations, acceptance, dependencies/risks.
4. Composer пересобирает `BusinessRequirementDraftV2` после каждого material edit,
   сохраняя history, field provenance и canonical fingerprint.
5. BA просматривает основной, альтернативные и ошибочные сценарии,
   исправляет разделы и подтверждает final summary.
6. Deterministic validator подтверждает readiness. При linked object V2 строит
   `ProposedPatch`; BA принимает/отклоняет operations, но V2 не пишет в object.
7. BA нажимает send-for-review с текущим fingerprint и idempotency key. V2 повторно
   валидирует owner/readiness/fingerprint; DMB транзакционно создаёт или
   переотправляет existing `RequirementRequest`.
8. Отправленная revision блокируется. Existing review UI показывает
   V2 metadata/разделы и применяет те же access/status rules.

**Альтернативные потоки:**

- A1: нет linked object — BA начинает с passport, цели или свободного черновика;
  patch step отсутствует, review доступен.
- A2: optional gap остаётся открыт — draft может быть ready, gap виден
  в artifact и review payload.
- A3: reviewer возвращает request — DMB сохраняет review comment/history,
  explicit reopen создаёт new V2 revision с provenance `human_decision`.
- A4: linked object изменился до экспорта или передачи предложения — patch становится
  stale, BA обновляет snapshot и повторно проходит diff.

**Ошибочные потоки:**

- E1: linked object не существует или недоступен — одинаковый
  `not_found_or_forbidden`, без раскрытия полей и без snapshot.
- E2: открыт critical gap/conflict — readiness false, send-for-review блокируется
  до разрешения gap/conflict в V2.
- E3: patch содержит protected/unknown path — операция отклоняется fail closed
  и пишется в audit metadata.
- E4: draft fingerprint изменился после preview — HTTP 409/revision conflict;
  создания `RequirementRequest` нет.
- E5: DMB commit падает после V2 confirmation — gateway выполняет compensation;
  retry с тем же key не создаёт дубль.
- E6: чужая V2-сессия или request — 404/403 по V1 access pattern, без утечки
  draft metadata.

**Постусловие:** в existing queue есть один immutable V2 snapshot с history,
а V1 sessions, routes, prompts и storage не изменились.

## 14. Политика следующего вопроса

V2 сохраняет structured TurnDecision и deterministic guards V1.

Алгоритм:

1. применить security/domain guards;
2. сохранить сообщение до model call;
3. извлечь факты и provenance;
4. обнаружить конфликты с state или linked snapshot;
5. пересчитать mode-specific gaps/readiness;
6. выбрать один незакрытый вопрос с максимальным ожидаемым снижением риска;
7. проверить, что вопрос соответствует focus и не содержит независимых подвопросов;
8. обновить draft только через явные operations;
9. сохранить state и response receipt.

Приоритет вопросов:

1. безопасность и противоречия;
2. происхождение и смысл поручения;
3. цель, scope и expected result;
4. actor/process/scenario;
5. acceptance criteria;
6. rules/data/dependencies/risks;
7. необязательные уточнения.

Модель не может:

- молча перезаписать подтверждённый факт;
- пометить inference как user-confirmed;
- объявить readiness без deterministic validator;
- применить ProposedPatch;
- отправить документ на review без явного действия.

## 15. Prompt architecture

В fork baseline без изменений копируется активная константа `SYSTEM`
из `dialogue/agentic.py`; characterization tests фиксируют её контракт. Только
после baseline gate V2 переходит на три versioned-слоя:

| Уровень | Содержание |
|---|---|
| base_guard | безопасность, provenance, one-question, запрет выдумывания |
| operator_context | trusted BA/PO role, style и допустимая глубина |
| product_mode | assignment_capture или requirement_copilot |

Промпты MUST храниться как versioned files в agent-v2/prompts/. Версия prompt set
пишется в telemetry и artifact metadata.

В prompt для assignment_capture агент не требует полной спецификации. В prompt для
requirement_copilot агент системно проверяет сценарии, правила, критерии и
трассируемость.

Каждый prompt set имеет immutable version/hash. Изменение prompt требует
BA/PO golden conversations, security corpus и differential check против
последней accepted V2-версии; V1 prompt при этом не меняется.

## 16. Composer, revisions и ручное редактирование

### 16.1. Composer

Скопированный composer V1 разделяется на две публичные операции:

- build_assignment_passport(state, context);
- build_business_requirement_v2(state, context).

Общие функции нормализации, provenance, gaps, conflicts, scores и rendering
сохраняются в пределах agent-v2/.

### 16.2. Revisions

Каждый material edit:

- создаёт новую логическую revision;
- сохраняет before fingerprint;
- хранит author kind: operator, agent_proposal или reviewer; для правки
  добавляет corresponding `human_decision`/`agent_hypothesis` provenance;
- хранит applied operations;
- не удаляет предыдущую подтверждённую историю.

Fingerprint MUST вычисляться детерминированно из нормализованного содержимого,
включая provenance/gaps/conflicts, как в проверках V1.

### 16.3. Edit and diff

Ручное редактирование раздела использует копию edit-draft-section V1. Copilot edit
добавляет ProposedPatch между текущей и предлагаемой ревизией. Пользователь может
принять или отклонить каждую операцию до создания новой revision.

## 17. ProposedPatch

ProposedPatch описывает предложение, а не команду записи.

~~~json
{
  "schema": "proposed-patch.v1",
  "id": "pp_01J8EXAMPLE",
  "session_id": "v2_01J8EXAMPLE",
  "target": {
    "object_type": "task",
    "object_id": "812",
    "base_version": 7,
    "base_fingerprint": "sha256:before"
  },
  "operations": [
    {
      "op": "replace",
      "path": "/description",
      "before": "Краткое описание",
      "after": "Согласованное подробное бизнес-требование",
      "reason": "Принята ревизия BR-5",
      "status": "proposed"
    }
  ],
  "protected_paths": [
    "/owner_id",
    "/team_id",
    "/role_id",
    "/business_customer_id"
  ],
  "status": "awaiting_human_decision",
  "created_from_revision": 5
}
~~~

Требования:

- allowlist полей задаётся сервером;
- protected fields всегда отклоняются;
- snapshot version сверяется перед handoff;
- stale patch требует refresh/rebase;
- MVP не применяет patch напрямую;
- принятие операции меняет только её decision status в V2;
- итог можно экспортировать или использовать для предзаполнения существующей формы
  редактирования; вызов изменяющего DMB endpoint в MVP отсутствует;
- отказ от операции сохраняется в audit metadata.

## 18. Review adapter

### 18.1. Совместимость

V2 MUST использовать существующую очередь RequirementRequest и её статусы.
Отдельный V2 review workflow не создаётся.

Рекомендуемый MVP mapping:

| V2 | RequirementRequest |
|---|---|
| session_id | agent_session_id с префиксом v2: |
| artifact title | title |
| rendered artifact | description |
| full JSON | draft |
| user_id | current authenticated user |
| team_id | trusted UserContext |
| revision history | revision_history |
| status | существующий lifecycle |

В draft.metadata передаются:

- assistant_version: v2;
- product_mode;
- artifact_type;
- schema_version;
- prompt_set_version;
- artifact_revision;
- fingerprint;
- source summary без запрещённого raw content;
- linked object reference, если доступ разрешён.

Префикс v2: предотвращает collision с V1 при неизменной схеме таблицы.

### 18.2. Send-for-review

~~~mermaid
sequenceDiagram
    participant U as BA/PO
    participant G as DMB V2 gateway
    participant A as agent-v2
    participant R as RequirementRequest
    participant Q as Review UI

    U->>G: send-for-review(session, fingerprint)
    G->>A: validate owner/readiness/fingerprint
    A-->>G: confirmed immutable snapshot
    G->>R: create or resubmit transactionally
    R-->>G: request id/version
    G->>A: confirm review binding
    A-->>G: sent/locked
    Q->>R: existing review lifecycle
~~~

Если DMB commit завершается ошибкой, gateway вызывает compensation V2, аналогично
V1. Повтор с тем же idempotency key возвращает тот же результат.

### 18.3. Возврат с review

Review feedback создаёт новую V2 revision с provenance kind `human_decision`
и decision type `review_feedback`. Отправленная
revision остаётся immutable. Сессия снимается с read-only только явной операцией
reopen.

## 19. API

Рекомендуемые префиксы:

- internal service: /api/agent-v2;
- browser gateway: `/api/v2/agent`.

Пути ниже задаются относительно соответствующего префикса. Минимальные endpoints:

| Method | Path | Назначение |
|---|---|---|
| POST | /new-session | создать с `product_mode`; `operator_role` добавляет gateway |
| POST | /chat | обработать реплику идемпотентно |
| POST | /chat-stream | streaming wrapper того же turn |
| GET | /sessions | список V2-сессий пользователя |
| GET | /session/{id} | восстановить state projection |
| POST | /session/{id}/archive | архивировать |
| POST | /session/{id}/handoff | passport → copilot |
| POST | /session/{id}/link-object | получить authorized snapshot |
| POST | /edit-draft-section | ручная правка |
| POST | /proposed-patch | построить preview |
| POST | /send-for-review | existing review adapter |
| POST | /reopen-review | вернуть в редактирование |
| POST | /cancel-review | compensation |
| GET | /config | безопасные UI capabilities |

Все изменяющие endpoints MUST принимать idempotency key или message_id.
Ответ сохраняет совместимые поля AgentResponse V1 и добавляет:

- product_mode;
- operator_role;
- artifact_type;
- assignment_passport;
- linked_object;
- proposed_patch;
- readiness;
- schema_version.

Неизвестные поля response не должны ломать DMB gateway. Breaking rename запрещён.

## 20. UI/UX

V2 доступен отдельным lazy-loaded route `#/agent-v2` и feature flag. V1 route и bundle не
меняются.

Обязательные элементы:

- отображение server-derived role BA/PO и выбор product mode;
- короткое объяснение различия режимов;
- форма SourceContext для assignment_capture;
- поиск/привязка разрешённого Request или Task для copilot;
- чат с одним активным вопросом;
- прогресс по понятным разделам, не по внутренним slot keys;
- карточка provenance по полю;
- явные gaps/conflicts;
- preview AssignmentPassport;
- структурированный BusinessRequirementDraftV2;
- revision history и diff;
- ProposedPatch preview с per-operation decision;
- отдельная кнопка send-for-review;
- read-only state после отправки;
- возврат из review с комментарием.

~~~mermaid
stateDiagram-v2
    [*] --> ModeSelect
    ModeSelect --> Capture: assignment_capture
    ModeSelect --> Copilot: requirement_copilot
    Capture --> PassportReady
    PassportReady --> Copilot: handoff
    PassportReady --> Archived: сохранить
    Copilot --> DraftReady
    DraftReady --> PatchPreview: есть linked object
    PatchPreview --> DraftReady: принять/отклонить операции
    DraftReady --> InReview: send-for-review
    InReview --> Copilot: returned + reopen
    InReview --> Approved
~~~

UI не показывает internal prompt, raw chain of thought, service secrets или
недоступные поля linked object.

## 21. Security, privacy и audit

V2 копирует fail-closed guards V1 и добавляет изоляционные проверки.

Обязательные требования:

- actor identity приходит только от DMB gateway;
- client-supplied `user_id`, `team_id`, `operator_role` и permissions не доверяются;
- доступ к linked object проверяется на стороне DMB;
- agent-v2 не имеет credentials к основной DMB DB;
- raw secrets и токены не пишутся в state, draft, audit или prompt logs;
- audit хранит тип операции, ids, hashes и результат, но не полное сообщение;
- retrieval использует только allowlisted adapters и policy-filtered results;
- prompt injection из attachment/source рассматривается как недоверенный текст;
- protected data нельзя менять через ProposedPatch;
- V2 не создаёт и не изменяет пользователей, credentials, роли, назначения ролей,
  команды, состав команд, справочники и ответственных;
- модель не получает инструмента прямой записи в DMB;
- V1 и V2 secrets различаются и ротируются независимо.

События audit:

- v2_session_started;
- v2_mode_selected;
- v2_source_captured;
- v2_object_linked;
- v2_artifact_revision_created;
- v2_patch_proposed;
- v2_patch_operation_decided;
- v2_review_submitted;
- v2_review_reopened;
- v2_security_refusal.

## 22. Observability и эксплуатация

Метрики V1 копируются с label assistant_version=v2:

- turn latency/error;
- LLM unavailable;
- session count;
- message replay;
- storage conflict;
- readiness blockers;
- draft/revision count;
- review send/compensation;
- stale linked snapshot;
- security refusal;
- token/cost budget.

Readiness V2 проверяет только собственные зависимости. Недоступность V2 не должна
ухудшать health V1 или основного backend.

Kill switch:

- скрывает V2 route UI;
- запрещает новые V2-сессии;
- сохраняет read-only доступ к ранее созданным артефактам по решению эксплуатации;
- не выключает V1.

## 23. Вертикальные инкременты

### Инкремент 0. Fork baseline и доказательство отсутствия влияния на V1

Состав:

- зафиксировать source commit;
- скопировать agent/ в agent-v2/ без product changes;
- переименовать пакет и tests paths;
- добавить FORK_PROVENANCE.json;
- запустить V1 suite;
- запустить скопированный suite;
- сравнить нормализованные ответы V1 и fork на golden transcripts;
- проверить запрет перекрёстных imports.

Gate:

- V1 tests не ухудшились;
- fork baseline эквивалентен по согласованным outputs;
- никакие V1 route/config/storage не изменены.

### Инкремент 1. Отдельные run, routes, UI и session storage

Состав:

- отдельный process/port/prefix/secret/DB/logs;
- feature flag и pilot allowlist;
- отдельный lazy-loaded UI route;
- AgentV2Session и V2 receipts;
- health/readiness/status scripts.

Gate: V2 можно включить и выключить без перезапуска или изменения поведения V1.

### Инкремент 2. BA/PO context и assignment_capture

Состав:

- operator_role;
- product mode selection;
- SourceContext;
- assignment-specific slots/prompt/readiness;
- golden BA и PO conversations.

Gate: пользователь получает сохранённый структурированный state с provenance.

### Инкремент 3. AssignmentPassport и handoff

Состав:

- composer/schema/validator паспорта;
- revision/fingerprint;
- preview;
- handoff в copilot без потери facts/gaps/conflicts.

Gate: passport round-trip и handoff traceability подтверждены тестами.

### Инкремент 4. requirement_copilot на базе composer V1

Состав:

- BusinessRequirementDraftV2 как расширение RequirementDraft;
- deeper slots и readiness;
- ручное редактирование разделов;
- revision diff;
- reuse reviewer.

Gate: golden deep requirement проходит deterministic validator.

### Инкремент 5. Linked object и ProposedPatch

Состав:

- read-only DMB adapter;
- LinkedObjectSnapshot;
- stale detection;
- allowlisted ProposedPatch preview;
- protected-field denylist.

Gate: ни один тест не подтверждает direct write; stale/protected operations fail closed.

### Инкремент 6. V2 review adapter

Состав:

- mapping в RequirementRequest;
- idempotent send/resubmit;
- compensation;
- existing review UI rendering;
- reopen with feedback.

Gate: V1 и V2 карточки одновременно проходят существующий review lifecycle.

### Инкремент 7. Pilot и hardening

Состав:

- ограниченная группа BA/PO;
- operational dashboards;
- privacy/security review;
- load/concurrency;
- usability findings;
- security-fix sync rehearsal.

Gate: согласованы pilot metrics и закрыты critical/high defects.

### Инкремент 8. Решение replace/merge/stop

Варианты:

- сохранить V1 и V2 отдельно;
- постепенно заменить V1 для выбранных пользователей;
- извлечь подтверждённый shared core отдельным проектом;
- остановить V2 и архивировать данные по retention policy.

Решение принимается только по данным пилота и отдельному ADR.

## 24. Стратегия тестирования

### 24.1. Characterization и differential

Перед первым BA/PO изменением один набор входных transcripts выполняется на V1 и
fork baseline. Нормализация исключает session id, timestamps, случайные draft ids и
порядок незначимых metadata. Сравниваются:

- action/phase;
- slots и facts;
- gaps/conflicts;
- readiness;
- draft content;
- fingerprint semantics;
- review lock;
- error/refusal behavior.

### 24.2. V1 regression

После каждого инкремента запускаются неизменённые suites V1:

- agent API/orchestration/state: [test_api.py](../agent/agent/tests/test_api.py),
  [test_orchestrator.py](../agent/agent/tests/test_orchestrator.py),
  [test_agentic_orchestrator.py](../agent/agent/tests/test_agentic_orchestrator.py),
  [test_session_retention.py](../agent/agent/tests/test_session_retention.py);
- composer/quality/audit/KB/runtime:
  [test_composer.py](../agent/agent/tests/test_composer.py),
  [test_artifact_quality_regressions.py](../agent/agent/tests/test_artifact_quality_regressions.py),
  [test_audit_privacy.py](../agent/agent/tests/test_audit_privacy.py),
  [test_audit_dialogue_regressions.py](../agent/agent/tests/test_audit_dialogue_regressions.py),
  [test_kb_contracts.py](../agent/agent/tests/test_kb_contracts.py),
  [test_kb_adapters.py](../agent/agent/tests/test_kb_adapters.py),
  [test_runtime_safety.py](../agent/agent/tests/test_runtime_safety.py),
  [test_draft_ux_workflow.py](../agent/agent/tests/test_draft_ux_workflow.py);
- DMB gateway/review integrity:
  [test_agent_send_for_review_access.py](../dmb-backlog/backend/tests/test_agent_send_for_review_access.py),
  [test_requirement_artifact_integrity.py](../dmb-backlog/backend/tests/test_requirement_artifact_integrity.py);
- frontend chat/review:
  [agentChatWorkflow.test.mjs](../dmb-backlog/frontend/tests/agentChatWorkflow.test.mjs),
  [agentChatUx.test.mjs](../dmb-backlog/frontend/tests/agentChatUx.test.mjs),
  [reviewPage.test.mjs](../dmb-backlog/frontend/tests/reviewPage.test.mjs),
  [requestPresentation.test.mjs](../dmb-backlog/frontend/tests/requestPresentation.test.mjs),
  [requirementIntegrity.test.mjs](../dmb-backlog/frontend/tests/requirementIntegrity.test.mjs).

Изменение V2 не может быть принято при регрессии V1.

### 24.3. Compatibility скопированных компонентов

Обязательные наборы:

- state serialization backward/forward within V2;
- session optimistic locking;
- message idempotency and retention;
- one-question enforcement;
- LLM unavailable fail-closed;
- composer provenance;
- fingerprint stale protection;
- review block on critical conflict;
- retrieval adapter policy;
- audit privacy;
- archive/restore/reopen.

Минимальные именованные контракты baseline: `test_chat_message_id_is_idempotent`,
`test_session_store_rejects_stale_state_save`,
`test_sent_request_can_be_reopened_for_revision`,
`test_submitted_draft_is_read_only_until_explicit_reopen`,
`test_stale_draft_hash_rejects_send_before_review_mutates_snapshot`,
`test_send_for_review_is_blocked_by_independent_critical_review`,
`test_primary_runtime_fails_closed_when_llm_is_unavailable`,
`test_optional_gaps_do_not_block_submission` и
`test_critical_conflict_blocks_both_restore_and_send`. Их копии в V2 проверяют
fork behavior, а исходные тесты продолжают проверять неизменённый V1.

### 24.4. Golden BA/PO conversations

Минимальный corpus:

1. BA фиксирует поручение со встречи;
2. PO фиксирует краткое поручение с неизвестным сроком;
3. handoff паспорта в copilot;
4. BA начинает с существующего Request;
5. PO начинает со свободной цели;
6. связанная Task изменилась во время диалога;
7. пользователь исправляет подтверждённый факт;
8. источник противоречит linked object;
9. необязательный gap не блокирует review;
10. critical conflict блокирует review;
11. review возвращён с комментарием;
12. попытка изменить protected field.

Каждый golden case проверяет output artifact, provenance, следующий вопрос,
readiness, audit metadata и отсутствие записи в DMB.

### 24.5. Security

- prompt injection corpus;
- forged actor/operator_role;
- cross-user session/object access;
- service secret separation;
- protected path bypass;
- stale version and replay;
- sensitive content absent in audit;
- import/dependency boundary.

## 25. Приёмочные критерии

### V2-AC-001. Независимость V1

V1 работает с прежними routes, DB и UI при выключенном, включённом и недоступном V2.

### V2-AC-002. Fork provenance

Для каждого критического скопированного файла известны source commit, hash,
отклонение и compatibility test.

### V2-AC-003. Assignment capture

BA и PO могут получить AssignmentPassport с source, scope, gaps, provenance и
readiness без создания Task или RequirementRequest.

### V2-AC-004. Handoff

Подтверждённые факты, gaps и conflicts из паспорта доступны в copilot без
семантической потери.

### V2-AC-005. Deep requirement

Copilot формирует BusinessRequirementDraftV2 требуемой глубины и не выдаёт
предположения за факты.

### V2-AC-006. Safe linked object

V2 читает только разрешённый snapshot, обнаруживает stale version и не меняет
объект напрямую.

### V2-AC-007. ProposedPatch

Пользователь видит before/after/reason, может принять или отклонить операции;
решение сохраняется только в V2 и не изменяет linked object. Protected fields
невозможно предложить или применить.

### V2-AC-008. Existing review

V2-артефакт отображается в существующей очереди, проходит действующие status/access
rules и возвращается в V2 на доработку.

### V2-AC-009. Reliability

Повтор message/send-for-review не создаёт дубликаты; concurrent update даёт
контролируемый conflict; stale fingerprint блокируется.

### V2-AC-010. Privacy

Audit не содержит текст пользовательского сообщения или secrets; provenance и
artifact content доступны только в разрешённых хранилищах.

## 26. Риски и меры

| Риск | Мера |
|---|---|
| Дрейф двух копий | provenance manifest, security-fix SLA, differential tests |
| Незаметная регрессия V1 | запрет shared runtime, обязательный V1 suite |
| Смешение product mode и dialogue style | отдельные поля и тестовая матрица |
| Слишком ранний handoff | deterministic mode readiness |
| Выдуманные факты | typed provenance и explicit confirmation |
| Устаревший linked object | version/fingerprint check |
| Обход protected fields | server allowlist + denylist + tests |
| Дубли review | idempotency и v2 session namespace |
| Чрезмерная глубина диалога | one-question policy, progress, explicit stop |
| Бесконечная fork-синхронизация | инкремент 8 и метрики стоимости |

## 27. Открытые решения до production

| ID | Решение | Владелец |
|---|---|---|
| V2-OPEN-001 | production DNS/port allocation; local default зафиксирован как 9300, env prefix — `AGENT_V2_*` | Tech Lead |
| V2-OPEN-002 | production topology отдельной DB/DB-role; в пилоте используется отдельная DB | Architect/Ops |
| V2-OPEN-003 | mapping текущих RBAC-ролей и pilot config в trusted `operator_role` BA/PO | Product/Security |
| V2-OPEN-004 | allowlist linked object types/fields | Product/DMB owners |
| V2-OPEN-005 | retention V2 sessions/artifacts | Product/Legal |
| V2-OPEN-006 | pilot users и success metrics | Product |
| V2-OPEN-007 | review rendering новых V2 sections | UX/Review owners |
| V2-OPEN-008 | судьба текущего assistant-v2/ prototype | Architect/Product |
| V2-OPEN-009 | SLA переноса security fixes между V1/V2 | Security/Tech Lead |
| V2-OPEN-010 | критерии shared-core refactor после пилота | Architect |

Открытые решения не отменяют обязательные границы: V1 независим, protected data не
меняются, direct apply отсутствует.

## 28. Definition of Ready

Инкремент готов к разработке, когда:

- указан владелец;
- перечислены затрагиваемые скопированные компоненты;
- определён V1 compatibility set;
- есть UI/API/data contract;
- описаны negative/security cases;
- подтверждено отсутствие изменения protected data;
- перечислены документация и operational checks.

## 29. Definition of Done

Изменение V2 завершено, когда:

- implementation соответствует этому ТЗ или имеет ADR;
- V2 tests зелёные;
- V1 regression зелёный;
- differential drift объяснён;
- fork manifest обновлён;
- local Markdown links валидны;
- API/data/run docs обновлены;
- migration и rollback проверены, если менялось storage;
- нет direct DMB write и изменений protected data;
- pilot flag может безопасно выключить feature.

## 30. Трассировка требований

| Группа | Реализация | Проверка |
|---|---|---|
| V2-FORK | agent-v2 copy + manifest | import boundary, differential |
| V2-ISO | process/config/storage | kill-switch, DB isolation |
| V2-CTX | UserContextV2, SourceContext | forged context tests |
| V2-MODE | mode selector и prompts | golden BA/PO |
| V2-STATE | DialogueStateV2 | serialization tests |
| V2-COMP | два composers/schemas | artifact snapshots |
| V2-PATCH | LinkedObjectSnapshot, ProposedPatch | stale/protected tests |
| V2-REVIEW | DMB adapter | review lifecycle tests |
| V2-UI | lazy V2 route | frontend fixture/e2e |
| V2-SEC | guards, no direct write | security corpus |
| V2-OPS | metrics, flag, kill switch | operational smoke |

## Приложение A. Пример NewSessionV2

~~~json
{
  "product_mode": "assignment_capture",
  "source_context": {
    "source_type": "business_customer",
    "channel": "meeting",
    "received_at": "2026-09-19T09:30:00+03:00"
  },
  "linked_object": null
}
~~~

## Приложение B. Пример DialogueStateV2 projection

~~~json
{
  "session_id": "v2_01J8EXAMPLE",
  "user_id": 42,
  "operator_role": "BA",
  "product_mode": "assignment_capture",
  "artifact_type": "assignment_passport",
  "schema_version": 1,
  "phase": "collecting",
  "last_asked_slot": "expected_result",
  "gaps": [],
  "conflicts": [],
  "review_status": "",
  "storage_version": 4
}
~~~

## Приложение C. Пример fork provenance manifest

~~~json
{
  "schema": "agent-v2-fork-provenance.v1",
  "source": {
    "path": "agent/",
    "git_commit": "TO_BE_FIXED_AT_FORK",
    "source_tree_clean": true,
    "copied_at": "2026-09-19T00:00:00Z"
  },
  "destination": "agent-v2/",
  "critical_files": [
    {
      "source_path": "agent/agent/session.py",
      "destination_path": "agent-v2/agent_v2/session.py",
      "source_sha256": "TO_BE_COMPUTED",
      "destination_sha256": "TO_BE_COMPUTED",
      "action": "copy_then_adapt",
      "compatibility_tests": [
        "test_session_store_rejects_stale_state_save",
        "test_chat_message_id_is_idempotent"
      ]
    }
  ],
  "intentional_deltas": [],
  "security_fix_sync": []
}
~~~

## Приложение D. Запреты реализации

Реализация считается несоответствующей ТЗ, если выполняется хотя бы одно:

- V2 импортирует runtime-код V1 или наоборот;
- V2 и V1 пишут в одну таблицу sessions;
- V2 вводит NeedCase как обязательный доменный aggregate;
- V2 создаёт собственную параллельную review queue;
- V2 прямо применяет patch или вызывает изменяющий DMB endpoint;
- V2 меняет роли, команды, справочники или ответственных;
- readiness определяется только моделью;
- provenance теряется при handoff;
- изменение V2 требует изменения V1 для запуска;
- fork создан без baseline differential tests.
