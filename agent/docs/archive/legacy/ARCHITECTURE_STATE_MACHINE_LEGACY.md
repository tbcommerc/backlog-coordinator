# AI Business Analyst Agent — Архитектура и документация

## Обзор системы

AI Business Analyst Agent — детерминированный диалоговый агент для сбора бизнес-требований к платформе сопровождения инвестиционных сделок. Агент работает как самостоятельный FastAPI-сервис, к которому обращается DMB Backend через HTTP API.

### Ключевые принципы

1. **Детерминированные гарантии + ограниченный LLM-анализ** — Python управляет состояниями, безопасностью, подтверждением и созданием драфта. LLM может перефразировать ответы и предлагать семантически извлечённые значения слотов; кандидаты проходят строгую валидацию и не управляют workflow.
2. **Human-in-the-loop** — агент никогда не утверждает требование. Он формирует Draft и отправляет на ревью; финальное решение за PO/BA.
3. **Auditability** — каждый диалог, отказ, драфт и отправка на ревью пишутся в audit.log.
4. **Grounded generation** — ответы основаны только на курируемой базе знаний (kb_seed/).

---

## Архитектурные диаграммы

### Высокоуровневая архитектура

> **Файл:** [`../../diagrams/high_level_architecture.puml`](../../diagrams/high_level_architecture.puml)

Эта диаграмма показывает общую структуру системы с оркестратором в центре, MCP агентами, Knowledge Base и внешними интеграциями.

```plantuml
!include ../../diagrams/high_level_architecture.puml
```

**Ключевые компоненты:**
- **Оркестратор** — центр управления диалогом, координирует все компоненты
- **MCP агенты** — внешние агенты, предоставляющие инструменты и навыки через Model Context Protocol
- **Knowledge Base** — база знаний с онтологией, поиском и историей требований
- **LLM** — языковая модель для генерации естественных ответов
- **Guardrails** — система безопасности (input/output validation, policies)
- **Dialogue Subsystem** — компоненты для управления диалогом (policy, planner, extractor, mode selector, Q&A, repair, fatigue, escalation)
- **Composer** — сборка черновика требования с оценкой полноты и уверенности
- **Session Store** — хранилище состояния диалога (SQLite)
- **Audit Logger** — логирование всех событий
- **Workflow** — интеграция с ревьюерами (PO/BA) и внешними системами (Jira/Confluence)

---

### Детальная компонентная архитектура

> **Файл:** [`../../diagrams/component_architecture.puml`](../../diagrams/component_architecture.puml)

Эта диаграмма показывает все внутренние компоненты с их связями.

```plantuml
!include ../../diagrams/component_architecture.puml
```

---

## Поток обработки сообщения

> **Файл:** [`../../diagrams/message_flow.puml`](../../diagrams/message_flow.puml)

```plantuml
!include ../../diagrams/message_flow.puml
```

---

## Состояния диалога (State Machine)

> **Файл:** [`../../diagrams/state_machine.puml`](../../diagrams/state_machine.puml)

```plantuml
!include ../../diagrams/state_machine.puml
```

---

## Компоненты системы

### 1. API Layer (`agent/api/`)

#### `router.py` — HTTP Router

**Назначение:** Точка входа для DMB Backend.

**Что делает:**
- Принимает HTTP запросы с заголовком `X-Agent-Secret`
- Маршрутизирует к Orchestrator
- Возвращает `AgentResponse`

**Endpoints:**

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/agent/chat` | Отправить сообщение пользователя |
| POST | `/api/agent/new-session` | Создать сессию |
| POST | `/api/agent/reset` | Удалить сессию |
| GET | `/api/agent/session/{id}` | Получить состояние сессии |
| GET | `/api/agent/sessions` | Список сессий пользователя |
| POST | `/api/agent/send-for-review` | Подтвердить отправку на ревью |
| GET | `/api/agent/config` | Конфигурация агента |

**Реализация:** FastAPI router с dependency injection для проверки секрета.

---

#### `schemas.py` — Pydantic Schemas

**Назначение:** Валидация request/response.

**Что делает:** Определяет структуру `ChatRequest`, `AgentResponse`, `ConfigResponse`.

**Ключевые поля AgentResponse:**
- `session_id` — ID сессии
- `action` — действие агента (welcome, question, summarize, draft_ready, etc.)
- `message` — текст ответа
- `blocks` — UI блоки (chips, draft_preview, actions)
- `phase` — текущая фаза диалога
- `slots` — заполненные слоты
- `progress` — прогресс заполнения
- `draft` — черновик требования (если создан)
- `can_generate_draft` — можно ли создать драфт

---

### 2. Core Engine

#### `orchestrator.py` — Dialogue Orchestrator

**Назначение:** Центр управления диалогом.

**Что делает:**
1. Принимает сообщение пользователя
2. Применяет input guardrails
3. Определяет intent и извлекает слоты
4. Обновляет dialogue state
5. Выбирает следующий шаг (Policy Engine)
6. Формирует ответ
7. Применяет output guardrails
8. Записывает в audit log

**Реализация:** Детерминированный state machine с гибкой логикой выбора вопросов.

**Ключевые методы:**
- `handle_message()` — основной цикл обработки сообщения
- `_advance()` — переход к следующему шагу
- `_handle_slot_phase()` — обработка ответа на вопрос
- `_handle_confirm()` — подтверждение резюме
- `confirm_and_send()` — отправка на ревью

**Интеграция с Phase 3-4:**
- Q&A mode — обработка вопросов пользователя о платформе
- Repair mode — обработка исправлений слотов
- Mode selection — адаптивный выбор режима диалога
- Fatigue detection — обнаружение усталости пользователя
- Escalation — передача диалога человеку

---

#### `session.py` — Session Store

**Назначение:** Хранение состояния диалога.

**Что делает:**
- Сохраняет `DialogueState` в SQLite
- Сериализация через JSON
- Поддержка list/get/save/delete

**Реализация:** SQLite таблица `sessions` с JSON state.

**Структура таблицы:**
```sql
CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER,
    state_json TEXT,
    updated_at TEXT
);
```

---

### 3. Dialogue Subsystem (`agent/dialogue/`)

#### `state.py` — Dialogue State

**Назначение:** Модель состояния диалога.

**Что делает:** Хранит все слоты, фазы, историю, метрики.

**Ключевые структуры:**

**Slot:**
```python
@dataclass
class Slot:
    key: str
    value: Optional[str] = None
    status: str = "empty"  # empty | filled | skipped
    confidence: float = 0.0  # 0.0 - 1.0
    source: str = ""  # user_message | knowledge_base | assumption
    confirmed: bool = False
    assumption: bool = False
```

**Категории слотов:**
- `MANDATORY_HARD` — без них нельзя создать драфт (need_statement, to_be, role, process)
- `MANDATORY_SOFT` — желательны, можно пропустить (value, product, regulatory_flags)
- `OPTIONAL` — не блокируют (department, module, scenarios, etc.)

**DialogueState:**
```python
@dataclass
class DialogueState:
    session_id: str
    user_id: int
    phase: str
    dialogue_mode: str  # guided | hybrid | free_form | expert
    slots: Dict[str, Slot]
    history: List[dict]
    
    # Phase 3
    pending_question: Optional[str]
    in_qa_mode: bool
    repair_mode: bool
    slot_history: Dict[str, List[dict]]
    
    # Phase 4
    user_expertise: str  # novice | medium | expert
    fatigue_level: str  # normal | tired | frustrated
    session_started_at: float
    draft_created_at: float
```

---

#### `machine.py` — State Machine

**Назначение:** Детерминированные переходы между фазами.

**Что делает:** Вычисляет текущую фазу на основе заполненности слотов.

**Фазы:**
```
WELCOME → IDENTIFY_INTENT → NEED_STATEMENT → BUSINESS_CONTEXT → 
AS_IS_TO_BE → ROLES_SCENARIOS → BUSINESS_RULES → DATA_INTEGRATIONS → 
VALUE_PRIORITY → SUMMARIZE → CONFIRM → DRAFT_READY → SENT_FOR_REVIEW
```

**Ключевые функции:**
- `compute_phase(state)` — вычисляет текущую фазу
- `next_slot(state)` — возвращает следующий слот для заполнения

---

#### `extractor.py` — Slot Extractor

**Назначение:** Извлечение сущностей из текста.

**Что делает:**
- Opportunistic extraction — извлекает все упомянутые сущности
- Targeted extraction — извлекает значение для конкретного слота
- Возвращает `(value, confidence)`

**Уровни confidence:**
- 0.95 — точное совпадение (ontology match)
- 0.85 — сильное keyword совпадение
- 0.75 — слабое keyword совпадение
- 0.60 — свободный текст
- 0.50 — предположение

**Реализация:** Keyword matching + ontology matching + light Russian stemmer.

---

#### `planner.py` — Question Planner

**Назначение:** Выбор следующего вопроса.

**Что делает:**
- Использует Policy Engine для решения
- Рассчитывает приоритет по формуле:
  ```
  priority = mandatory_weight * 0.4 + 
             risk_weight * 0.25 + 
             uncertainty_weight * 0.2 + 
             effort_penalty * 0.1
  ```
- Возвращает вопрос с chips (быстрые ответы)

**Ключевые методы:**
- `next_question(state, ctx, force_slot)` — возвращает следующий вопрос
- `get_next_slots_by_priority(state, limit)` — топ-N слотов по приоритету

---

#### `policy.py` — Policy Engine

**Назначение:** Принятие решений о следующем действии.

**Что делает:**
- Определяет: задать вопрос, показать резюме, уточнить, отказать, эскалировать
- Учитывает: mandatory缺失, confidence, risk flags, fatigue

**Действия:**
- `ASK_QUESTION` — задать следующий вопрос
- `SHOW_SUMMARY` — показать резюме
- `REQUEST_CLARIFICATION` — запросить уточнение
- `ESCALATE` — передать человеку
- `CREATE_DRAFT` — создать драфт
- `CONTINUE` — продолжить диалог

**Логика принятия решений:**
1. Проверить эскалацию (repeated out-of-domain)
2. Проверить, нужно ли показать summary
3. Проверить слоты с низкой уверенностью
4. Проверить отсутствующие mandatory hard
5. Проверить отсутствующие mandatory soft
6. Проверить регуляторные флаги
7. По умолчанию — продолжить диалог

---

#### `mode_selector.py` — Dialogue Mode Selector

**Назначение:** Выбор режима диалога.

**Что делает:** Адаптирует режим к пользователю.

**Режимы:**
- `guided` — новичок, низкий confidence, жесткий сценарий
- `hybrid` — основной режим, баланс строгости и гибкости
- `free_form` — опытный, много данных сразу
- `expert` — BA/PO, меньше вопросов, быстрее к драфту

**Логика выбора:**
- Если пользователь BA/PO → expert mode
- Если avg_confidence < 0.6 или мало заполненных слотов → guided mode
- Если avg_confidence > 0.85 и много заполненных слотов → free_form mode
- По умолчанию → hybrid mode

---

#### `qa_handler.py` — Q&A Handler

**Назначение:** Обработка вопросов пользователя о платформе.

**Что делает:**
- Распознаёт вопросы (маркеры: "?", "что такое", "как работает")
- Входит в Q&A mode, сохраняет текущий слот
- Получает ответ из KB
- Возвращается к сбору требования

**Ключевые методы:**
- `is_question(message)` — определяет, является ли сообщение вопросом
- `handle_question(state, message)` — обрабатывает вопрос
- `exit_qa_mode(state)` — выходит из Q&A mode

---

#### `repair_handler.py` — Repair Handler

**Назначение:** Обработка исправлений слотов.

**Что делает:**
- Распознаёт repair intent ("нет, не", "изменить на", "я имел в виду")
- Определяет целевой слот
- Обновляет значение
- Записывает в историю изменений

**Ключевые методы:**
- `detect_repair(state, message)` — определяет, хочет ли пользователь исправить
- `apply_repair(state, slot, new_value)` — применяет исправление
- `generate_repair_confirmation()` — генерирует подтверждение

---

#### `summary_generator.py` — Summary Generator

**Назначение:** Генерация промежуточных резюме.

**Что делает:** Показывает "Что я понял" после 3-4 вопросов.

**Ключевые методы:**
- `generate_intermediate_summary(state)` — генерирует резюме
- `should_show_intermediate_summary(state, question_count)` — проверяет, нужно ли показать
- `generate_progress_indicator(state)` — генерирует индикатор прогресса

---

#### `user_profile.py` — User Profile Detector

**Назначение:** Определение уровня пользователя.

**Что делает:**
- Анализирует сообщения на технические термины
- Определяет expertise: novice/medium/expert
- Определяет style: business/technical

**Индикаторы:**
- Технические термины (API, endpoint, settlement) → technical style
- Novice индикаторы ("не знаю", "помогите") → novice expertise
- Expert индикаторы ("as-is", "to-be", "acceptance criteria") → expert expertise

---

#### `fatigue_detector.py` — Fatigue Detector

**Назначение:** Обнаружение усталости пользователя.

**Что делает:**
- Отслеживает: consecutive questions, short answers, clarification failures
- Уровни: normal/tired/frustrated
- Рекомендации: показать резюме, предложить драфт с gaps

**Триггеры:**
- 3+ вопросов подряд → tired
- 5+ вопросов подряд → frustrated
- 4+ коротких ответов → tired
- 6+ коротких ответов → frustrated
- 3+ неудачных уточнений → frustrated

---

#### `metrics.py` — Metrics Tracker

**Назначение:** Сбор метрик качества.

**Что делает:**
- Per-session: время до драфта, вопросы, слоты
- Aggregate: completion rate, escalation rate, avg time to draft

**Метрики сессии:**
- `started_at`, `draft_created_at`, `ended_at`
- `total_user_messages`, `total_agent_messages`
- `questions_asked`, `slots_filled`, `slots_skipped`
- `user_expertise`, `fatigue_level`, `escalated`

**Агрегированные метрики:**
- `completion_rate` — % диалогов, дошедших до драфта
- `escalation_rate` — % эскалированных диалогов
- `avg_time_to_draft` — среднее время до драфта
- `avg_questions_per_draft` — среднее вопросов на драфт

---

#### `escalation_handler.py` — Escalation Handler

**Назначение:** Передача диалога человеку.

**Что делает:**
- Триггеры: repeated OOD, clarification failures, frustrated, regulatory low confidence
- Готовит контекст для аналитика
- Устанавливает приоритет: low/normal/high/urgent

**Триггеры эскалации:**
1. Пользователь явно просит человека
2. Повторные out-of-domain попытки (3+ страйка)
3. Множественные неудачные уточнения (3+)
4. Пользователь расстроен (fatigue = frustrated)
5. Регуляторные аспекты с низкой уверенностью

---

#### `question_bank.py` — Question Bank

**Назначение:** Каталог вопросов для каждого слота.

**Что делает:** Хранит шаблоны вопросов в стилях business/technical + chips.

**Структура:**
```python
QUESTIONS = {
    "role": {
        "business": "Кто является основным пользователем?",
        "technical": "Определите основную пользовательскую роль.",
        "chips": [
            {"label": "Бэк-офицер", "value": "бэк-офицер"},
            {"label": "Риск-менеджер", "value": "риск-менеджер"},
        ]
    }
}
```

---

#### `generator.py` — Response Generator

**Назначение:** Генерация текстов для не-slot фаз.

**Что делает:** Шаблоны для welcome, reflect, summarize, clarify, incident_triage.

---

#### `confinement.py` — Conversation Confinement

**Назначение:** Удержание в домене.

**Что делает:** 3 страйка out-of-domain → эскалация.

---

### 4. Knowledge Base (`agent/kb/`)

#### `loader.py` — KB Loader

**Назначение:** Загрузка документов из kb_seed/.

**Что делает:**
- Читает manifest.json
- Парсит markdown файлы
- Разбивает на chunks по секциям (## headers)
- Тегирует метаданными

**Структура Chunk:**
```python
@dataclass
class Chunk:
    doc_id: str
    doc_title: str
    domain: str
    status: str  # approved | draft
    priority: int
    section: str
    text: str
```

---

#### `ontology.py` — Domain Ontology

**Назначение:** Формализованная модель предметной области.

**Что делает:**
- Хранит entities: products, modules, processes, roles
- Каждый entity имеет aliases
- Используется для domain classification и slot extraction

**Реализация:** Загрузка из kb_seed/ + stem matching.

---

#### `search.py` — Search Engine

**Назначение:** Поиск по базе знаний.

**Что делает:**
- BM25-like scoring
- Ontology entity boost
- Optional embedding similarity (если LLM доступен)
- Только approved документы

---

#### `retrieval.py` — Retrieval Service

**Назначение:** Grounded answers для clarification.

**Что делает:** Обёртка над search engine для Q&A.

---

#### `requirements_history.py` — Requirements History

**Назначение:** Поиск дубликатов и prior decisions.

**Что делает:**
- Загружает из requirements_history.json
- Token-based similarity search
- Используется для duplicate detection в драфте

---

### 5. Guardrails (`agent/guardrails/`)

#### `input_harness.py` — Input Harness

**Назначение:** Валидация входящих сообщений.

**Что делает:**
- Domain classification (in_domain / possibly_in_domain / out_of_domain)
- Prompt injection detection
- PII / bank secrecy detection
- Prohibited requests detection

**Вердикты:**
- `in_domain` — запрос относится к домену
- `possibly_in_domain` — возможно относится
- `out_of_domain` — вне домена
- `malicious_or_policy_violation` — нарушение политики

---

#### `output_harness.py` — Output Harness

**Назначение:** Валидация ответов агента.

**Что делает:**
- Проверка forbidden phrases
- Validation draft schema
- Assumption marking

---

#### `policies.py` — Policies

**Назначение:** Политики доступа и отказов.

**Что делает:**
- Allowed roles check
- Refusal templates
- Domain restrictions

---

### 6. Composer (`agent/composer/`)

#### `composer.py` — Requirement Composer

**Назначение:** Сборка драфта требования.

**Что делает:**
- Собирает слоты в `RequirementDraft`
- Добавляет open questions, assumptions, regulatory flags
- Проверяет дубликаты
- Рассчитывает completeness/confidence

---

#### `schema.py` — Draft Schema

**Назначение:** Pydantic модель драфта.

**Что делает:** Определяет структуру `RequirementDraft`.

**Ключевые поля:**
- title, intent, problem_statement, target_process
- user_roles, product, module, scenarios
- business_rules, acceptance_criteria, data_integrations
- open_questions, dependencies, risks, assumptions
- regulatory_flags, priority, duplicates, sources
- completeness_score, confidence, status

---

#### `scores.py` — Scoring

**Назначение:** Расчёт полноты и уверенности.

**Что делает:**
- Completeness: взвешенная сумма заполненных слотов
- Confidence: low/medium/high на основе completeness и open questions

**Веса слотов:**
```python
COMPLETENESS_WEIGHTS = [
    ("need_statement", 15),
    ("to_be", 15),
    ("role", 10),
    ("process", 10),
    ("product", 10),
    ("acceptance_criteria", 15),
    ("module", 10),
    ("value", 10),
    ("regulatory_flags", 5),
]
```

---

### 7. LLM Integration (`agent/llm/`)

#### `factory.py` — LLM Factory

**Назначение:** Выбор LLM провайдера.

**Что делает:** Возвращает mock или openai_compat в зависимости от конфига.

---

#### `base.py` — LLM Provider Protocol

**Назначение:** Абстракция LLM провайдера.

**Что делает:** Определяет интерфейс: `available()`, `chat()`, `embed()`.

---

#### `mock.py` — Mock Provider ⚠️ ЗАГЛУШКА

**Назначение:** Offline provider для demo/tests.

**Что делает:** Возвращает шаблонный ответ без API calls.

**Для ПРОМ:** Заменить на real LLM (OpenAI/Azure/vLLM).

---

#### `openai_compat.py` — OpenAI Compatible Provider

**Назначение:** Клиент для OpenAI/Azure/vLLM/Ollama.

**Что делает:**
- Chat completions API
- Embeddings API (optional)
- Использует только stdlib (urllib)

---

#### `rephrase.py` — Rephrase Service

**Назначение:** Перефразирование шаблонных ответов.

**Что делает:**
- Пропускает ответы через LLM для естественности
- Fallback на оригинальный текст при ошибке
- Не меняет смысл, факты, структуру

---

### 8. External Tools (`agent/tools/`)

#### `base.py` — Tool Registry ⚠️ ЗАГЛУШКА

**Назначение:** Фреймворк для внешних инструментов.

**Что делает:**
- Регистрирует tools
- Поддерживает stub tools (mock responses)
- Инициализация из конфига

**Для ПРОМ:** Настроить реальные endpoints.

---

#### `http_tool.py` — HTTP Tool ⚠️ ЗАГЛУШКА

**Назначение:** GET-only доступ к внешним системам.

**Что делает:**
- Если mock_response — возвращает его
- Иначе делает GET запрос
- Только GET для безопасности

**Для ПРОМ:** Настроить реальные banking systems endpoints.

---

### 9. MCP Integration (`agent/mcp/`)

#### `registry.py` — MCP Registry

**Назначение:** Реестр MCP skills и tools.

**Что делает:**
- Хранит built-in skills
- Подключает MCP servers
- Экспонирует через /config

**Built-in skills:**
- `collect_business_requirement`
- `classify_request`
- `search_knowledge_base`

---

#### `client.py` — MCP Client ⚠️ ЗАГЛУШКА

**Назначение:** Клиент для MCP stdio servers.

**Что делает:**
- Подключается к MCP server
- Получает список tools
- Graceful degradation при недоступности

**Для ПРОМ:** Установить MCP package, настроить servers.

---

### 10. Workflow (`agent/workflow/`)

#### `review.py` — Review Workflow

**Назначение:** Human-in-the-loop guarantee.

**Что делает:**
- Определяет необходимых ревьюеров (PO, BA, Комплаенс, Архитектор)
- Устанавливает review status

---

#### `integrations.py` — Integrations ⚠️ ЗАГЛУШКА

**Назначение:** Экспорт в Jira/Confluence.

**Что делает:**
- `create_issue()` — stub для Jira
- `publish_draft()` — stub для Confluence

**Для ПРОМ:** Интегрировать с реальным Jira/Confluence API.

---

### 11. Supporting Components

#### `config.py` — Configuration

**Назначение:** Настройки приложения.

**Что делает:** Pydantic settings из .env.

**Ключевые настройки:**
- Paths (KB_DIR, SESSION_DB)
- LLM provider (mock/openai_compat)
- Security (AGENT_SECRET)
- MCP servers, tools config
- Domain policy

---

#### `context.py` — User Context

**Назначение:** Минимальный контекст пользователя.

**Что делает:**
- `UserContext` model (user_id, role_name, is_ba, department)
- `style_for()` — определяет business/technical стиль

---

#### `audit.py` — Audit Logger

**Назначение:** Логирование всех событий.

**Что делает:**
- JSON lines в agent_logs/audit.log
- События: dialogue, refusal, draft, escalation

---

## Seed Data (kb_seed/)

### Структура

```
kb_seed/
├── manifest.json              # Метаданные документов
├── business_context.md        # Бизнес-контекст подразделения
├── products.md                # Инвестиционные продукты (9 продуктов)
├── modules.md                 # Модули платформы
├── processes.md               # Бизнес-процессы
├── roles.md                   # Роли пользователей
├── regulations.md             # Регуляторные требования
├── architecture.md            # Системная архитектура
├── settlement_statuses.md     # Статусы расчётов
└── requirements_history.json  # История требований (7 записей)
```

### manifest.json

**Назначение:** Метаданные документов KB.

**Структура:**
```json
{
  "documents": [
    {
      "id": "products",
      "title": "Инвестиционные продукты",
      "domain": "products",
      "status": "approved",
      "priority": 100,
      "products": ["all"]
    }
  ]
}
```

### Markdown файлы

**Назначение:** Курируемые знания о платформе.

**Структура:**
```markdown
# Заголовок документа

## Entity Name (Aliases)

- **Описание:** ...
- **Жизненный цикл:** ...
- **Особенности сопровождения:** ...
- **Связанные модули:** ...
```

### requirements_history.json

**Назначение:** История требований для duplicate detection.

**Структура:**
```json
[
  {
    "id": "REQ-4521",
    "title": "Экран списка несостоявшихся расчётов",
    "intent": "feature",
    "product": "Облигации",
    "module": "Расчёты",
    "status": "approved",
    "decision": "Принято в бэклог"
  }
]
```

---

## Заглушки и доработки для ПРОМ

### 1. LLM Provider ⚠️

**Текущее состояние:**
- По умолчанию используется `MockProvider` (шаблонные ответы)
- `OpenAICompatProvider` готов, но требует API key

**Для ПРОМ:**
- [ ] Настроить real LLM (OpenAI/Azure OpenAI/vLLM)
- [ ] Получить API key
- [ ] Настроить `.env`:
  ```
  LLM_PROVIDER=openai_compat
  OPENAI_API_KEY=sk-...
  OPENAI_BASE_URL=https://api.openai.com/v1
  OPENAI_MODEL=gpt-4o-mini
  ```
- [ ] Протестировать rephrase service
- [ ] Настроить embeddings для semantic search

**Файлы:** `agent/llm/mock.py`, `agent/llm/openai_compat.py`

---

### 2. Knowledge Base ⚠️

**Текущее состояние:**
- Seed данные в `kb_seed/` — пример (9 продуктов, 7 требований)
- Загружается из markdown файлов

**Для ПРОМ:**
- [ ] Загрузить реальные данные о продуктах платформы
- [ ] Загрузить реальные модули и процессы
- [ ] Интегрировать с реальной историей требований (Jira export)
- [ ] Настроить процесс обновления KB при изменениях
- [ ] Добавить больше документов (regulations, architecture details)
- [ ] Настроить status: approved для всех документов

**Файлы:** `kb_seed/*.md`, `kb_seed/requirements_history.json`

---

### 3. External Tools ⚠️

**Текущее состояние:**
- `StubTool` возвращает mock responses
- `HttpTool` готов, но не настроен

**Для ПРОМ:**
- [ ] Настроить реальные endpoints banking systems
- [ ] Добавить authentication для внешних API
- [ ] Настроить `.env`:
  ```
  TOOLS_CONFIG_JSON=[
    {"name": "trade_registry", "url": "https://...", "mock_response": null}
  ]
  ```
- [ ] Протестировать real HTTP calls
- [ ] Добавить error handling и timeout

**Файлы:** `agent/tools/base.py`, `agent/tools/http_tool.py`

---

### 4. MCP Servers ⚠️

**Текущее состояние:**
- MCP package опционален
- `McpClient` готов, но не подключен

**Для ПРОМ:**
- [ ] Установить MCP package: `pip install mcp`
- [ ] Настроить MCP servers (если нужны)
- [ ] Настроить `.env`:
  ```
  MCP_SERVERS_JSON=[
    {"name": "kb-tools", "command": "python", "args": ["server.py"]}
  ]
  ```
- [ ] Протестировать подключение

**Файлы:** `agent/mcp/client.py`, `agent/mcp/registry.py`

---

### 5. Workflow Integrations ⚠️

**Текущее состояние:**
- `create_issue()` возвращает fake issue key
- `publish_draft()` возвращает fake page

**Для ПРОМ:**
- [ ] Интегрировать с реальным Jira API
- [ ] Интегрировать с реальным Confluence API
- [ ] Настроить authentication
- [ ] Добавить error handling
- [ ] Настроить маппинг полей draft → Jira issue

**Файлы:** `agent/workflow/integrations.py`

---

### 6. Session Store ⚠️

**Текущее состояние:**
- SQLite файл `agent_sessions.db`

**Для ПРОМ:**
- [ ] Рассмотреть PostgreSQL для production
- [ ] Настроить backups
- [ ] Добавить retention policy (удаление старых сессий)
- [ ] Настроить monitoring

**Файлы:** `agent/session.py`

---

### 7. Audit Logging ⚠️

**Текущее состояние:**
- JSON lines в `agent_logs/audit.log`

**Для ПРОМ:**
- [ ] Настроить log rotation
- [ ] Интегрировать с centralized logging (ELK, Splunk)
- [ ] Добавить structured logging
- [ ] Настроить alerting на критические события

**Файлы:** `agent/audit.py`

---

### 8. Security ⚠️

**Текущее состояние:**
- `AGENT_SECRET` в `.env` (hardcoded default)
- Role check в `policies.py`

**Для ПРОМ:**
- [ ] Сгенерировать сильный `AGENT_SECRET`
- [ ] Настроить HTTPS для API
- [ ] Добавить rate limiting
- [ ] Настроить CORS
- [ ] Добавить authentication для DMB Backend
- [ ] Провести security audit

**Файлы:** `agent/config.py`, `agent/guardrails/policies.py`

---

### 9. Testing ⚠️

**Текущее состояние:**
- 126 тестов passing
- Покрытие: orchestrator, dialogue, composer, guardrails

**Для ПРОМ:**
- [ ] Добавить integration tests с real LLM
- [ ] Добавить load testing
- [ ] Добавить E2E tests с frontend
- [ ] Настроить CI/CD pipeline
- [ ] Добавить test coverage reporting

**Файлы:** `agent/tests/`

---

### 10. Monitoring & Metrics ⚠️

**Текущее состояние:**
- `MetricsTracker` собирает метрики
- Нет экспорта метрик

**Для ПРОМ:**
- [ ] Добавить Prometheus exporter
- [ ] Настроить Grafana dashboards
- [ ] Добавить alerting на:
  - High escalation rate
  - Low completion rate
  - High latency
- [ ] Настроить health checks

**Файлы:** `agent/dialogue/metrics.py`

---

## Deployment Checklist

### Pre-production

- [ ] Настроить LLM provider (OpenAI/Azure)
- [ ] Загрузить реальные KB данные
- [ ] Настроить external tools endpoints
- [ ] Настроить MCP servers (если нужны)
- [ ] Интегрировать с Jira/Confluence
- [ ] Настроить PostgreSQL (опционально)
- [ ] Настроить HTTPS
- [ ] Сгенерировать сильный AGENT_SECRET
- [ ] Настроить log rotation
- [ ] Добавить monitoring

### Production

- [ ] Настроить CI/CD pipeline
- [ ] Настроить backups (sessions, audit logs)
- [ ] Настроить alerting
- [ ] Провести load testing
- [ ] Провести security audit
- [ ] Настроить documentation для ops
- [ ] Настроить runbook для incident response

---

## Glossary

| Термин | Определение |
|---|---|
| **Draft** | Черновик требования, сгенерированный агентом |
| **Slot** | Поле требования (role, process, product, etc.) |
| **Phase** | Фаза диалога (identify_intent, collect_details, etc.) |
| **Intent** | Тип обращения (feature, change, problem, clarification, incident) |
| **Confidence** | Уверенность извлечения слота (0.0 - 1.0) |
| **Guardrails** | Ограничения и проверки безопасности |
| **Grounded generation** | Генерация ответов только на основе KB |
| **Human-in-the-loop** | Финальное решение всегда за человеком |
| **MCP** | Model Context Protocol — стандарт для external tools |
| **Ontology** | Формализованная модель предметной области |
| **BM25** | Алгоритм текстового поиска |
| **Rephrase** | Перефразирование шаблонных ответов через LLM |

---

## Контакты и поддержка

- **Разработка:** AI Business Analyst team
- **Документация:** `ORCHESTRATOR_IMPROVEMENTS.md`
- **Тесты:** `python -m pytest agent/tests -v`
- **Запуск:** `python run.py` (порт 9000)
