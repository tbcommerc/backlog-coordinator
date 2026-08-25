# Доработка оркестратора: Фазы 1-4

## Резюме изменений

Реализованы все четыре фазы доработки оркестратора согласно ТЗ:
- **Фаза 1**: Slot confidence + Mandatory categories
- **Фаза 2**: Policy Engine + Question Planner с приоритетами
- **Фаза 3**: Multi-mode dialogue + Q&A + Repair
- **Фаза 4**: User profile + Fatigue detection + Metrics + Escalation

## Что было сделано

### Фаза 1: Slot Confidence и Mandatory Categories

#### 1. Расширена модель Slot (`dialogue/state.py`)
Добавлены новые поля:
- `confidence: float` — уверенность извлечения (0.0 - 1.0)
- `source: str` — источник значения (user_message | knowledge_base | assumption | system)
- `confirmed: bool` — подтверждено ли пользователем
- `assumption: bool` — является ли предположением

Добавлены свойства:
- `needs_review` — требует ли проверки (assumption или low confidence)

#### 2. Разделены слоты на 3 категории
```python
MANDATORY_HARD = ["need_statement", "to_be", "role", "process"]
MANDATORY_SOFT = ["value", "product", "regulatory_flags"]
OPTIONAL = ["intent", "department", "module", ...]
```

- **MANDATORY_HARD** — без них нельзя создать драфт
- **MANDATORY_SOFT** — желательны, можно пропустить с открытым вопросом
- **OPTIONAL** — не блокируют создание драфта

#### 3. Обновлены методы DialogueState
- `set()` — теперь принимает confidence, source, confirmed, assumption
- `get_confidence()` — возвращает уверенность слота
- `is_low_confidence()` — проверяет, ниже ли уверенность порога
- `all_mandatory_hard_filled()` — все ли обязательные слоты заполнены
- `get_missing_mandatory_hard()` — список незаполненных обязательных
- `get_missing_mandatory_soft()` — список незаполненных желательных
- `get_low_confidence_slots()` — список слотов с низкой уверенностью
- `get_open_questions()` — список открытых вопросов

#### 4. Обновлен Slot Extractor (`dialogue/extractor.py`)
Все методы извлечения теперь возвращают кортеж `(value, confidence)`:
- `extract_intent()` → `(str | None, float)`
- `extract_role()` → `(str | None, float)`
- `extract_product()` → `(str | None, float)`
- `extract_module()` → `(str | None, float)`
- `extract_process()` → `(str | None, float)`
- `extract_priority()` → `(str | None, float)`
- `extract_department()` → `(str | None, float)`

Уровни confidence:
- **0.95** — точное совпадение (ontology или keyword)
- **0.85** — сильное keyword совпадение
- **0.75** — слабое keyword совпадение
- **0.60** — свободный текст (plain answer)
- **0.50** — предположение из контекста

#### 5. Обновлена сериализация сессий (`session.py`)
- `_slot_from_dict()` — загружает новые поля
- `state_to_dict()` — сохраняет новые поля

---

### Фаза 2: Policy Engine и Question Planner с приоритетами

#### 1. Создан Policy Engine (`dialogue/policy.py`)
Компонент, который принимает решения о следующем действии.

**Действия:**
- `ASK_QUESTION` — задать следующий вопрос
- `SHOW_SUMMARY` — показать резюме собранных данных
- `REQUEST_CLARIFICATION` — запросить уточнение (low confidence)
- `ANSWER_QUESTION` — ответить на вопрос пользователя
- `REFUSE` — отказать (out-of-domain)
- `ESCALATE` — передать человеку
- `CREATE_DRAFT` — создать драфт после подтверждения
- `CONTINUE` — продолжить диалог

**Причины:**
- `MANDATORY_MISSING` — отсутствует обязательное поле
- `LOW_CONFIDENCE` — низкая уверенность извлечения
- `REGULATORY_CHECK` — требуется проверка регуляторных аспектов
- `CONFIRMATION_NEEDED` — требуется подтверждение
- `ALL_REQUIRED_FILLED` — все обязательные поля заполнены

**Логика принятия решений:**
1. Проверить эскалацию (repeated out-of-domain)
2. Проверить, нужно ли показать summary
3. Проверить слоты с низкой уверенностью
4. Проверить отсутствующие mandatory hard
5. Проверить отсутствующие mandatory soft
6. Проверить регуляторные флаги
7. По умолчанию — продолжить диалог

#### 2. Обновлен Question Planner (`dialogue/planner.py`)
Теперь использует Policy Engine для выбора следующего вопроса.

**Новые методы:**
- `next_question()` — возвращает вопрос с priority и reason
- `get_next_slots_by_priority()` — возвращает топ-N слотов по приоритету

**Формула приоритета (из ТЗ):**
```python
priority = (
    mandatory_weight * 0.4 +
    risk_weight * 0.25 +
    uncertainty_weight * 0.2 +
    effort_penalty * 0.1
)
```

Где:
- `mandatory_weight` — 10.0 (hard), 7.0 (soft), 3.0 (optional)
- `risk_weight` — 10.0 (regulatory), 5.0 (acceptance/business_rules), 0.0 (other)
- `uncertainty_weight` — `(1.0 - confidence) * 10.0`
- `effort_penalty` — `min(ask_count * 2.0, 5.0)`

#### 3. Обновлен Orchestrator (`orchestrator.py`)
- `_handle_intent()` — использует confidence из extractor
- `_handle_need_statement()` — устанавливает confidence
- `_apply_opportunistic()` — распаковывает кортежи (value, confidence)
- `_handle_slot_phase()` — распаковывает кортежи (value, confidence)

---

### Фаза 3: Multi-mode dialogue + Q&A + Repair

#### 1. Режимы диалога (`dialogue/mode_selector.py`)
Добавлены 4 режима диалога:

- **guided** — жесткий сценарий для новичков, низкой уверенности, критичных процессов
- **hybrid** — основной режим, баланс строгости и гибкости
- **free_form** — опытные пользователи с высокой уверенностью, много данных сразу
- **expert** — BA/PO — меньше вопросов, быстрее к драфту

**Логика выбора режима:**
- Если пользователь BA/PO → expert mode
- Если avg_confidence < 0.6 или мало заполненных слотов → guided mode
- Если avg_confidence > 0.85 и много заполненных слотов → free_form mode
- По умолчанию → hybrid mode

**Методы:**
- `select_mode(state, ctx)` — выбирает режим
- `should_skip_optional_questions(state)` — проверяет, можно ли пропускать optional
- `get_max_questions_before_summary(state)` — макс. вопросов до резюме

#### 2. Q&A внутри сценария (`dialogue/qa_handler.py`)
Пользователь может задавать вопросы о платформе во время сбора требования.

**Логика:**
1. Обнаружить вопрос (маркеры: "?", "что такое", "как работает", и т.д.)
2. Войти в Q&A mode, сохранить текущий слот
3. Получить ответ из базы знаний
4. Вернуть ответ пользователю
5. Выйти из Q&A mode, вернуться к сохранённому слоту

**Методы:**
- `is_question(message)` — определяет, является ли сообщение вопросом
- `handle_question(state, message)` — обрабатывает вопрос, входит в Q&A mode
- `exit_qa_mode(state)` — выходит из Q&A mode, возвращает к слоту
- `get_return_slot(state)` — получает слот для возврата

#### 3. Repair mode (`dialogue/repair_handler.py`)
Пользователь может явно исправить ранее заполненный слот.

**Логика:**
1. Обнаружить repair intent (маркеры: "нет, не", "изменить на", "я имел в виду", и т.д.)
2. Определить целевой слот (по ключевым словам или last_asked_slot)
3. Извлечь новое значение
4. Войти в repair mode
5. Обновить слот с новым значением
6. Записать изменение в историю
7. Подтвердить изменение пользователю

**Методы:**
- `detect_repair(state, message)` — определяет, хочет ли пользователь исправить
- `apply_repair(state, slot, new_value, confidence)` — применяет исправление
- `generate_repair_confirmation(slot, old_value, new_value)` — генерирует подтверждение

**История изменений:**
- Каждый ремонт записывается в `slot_history[slot]`
- Содержит: old_value, new_value, reason, timestamp

#### 4. Промежуточные резюме (`dialogue/summary_generator.py`)
Показывают собранные данные после 3-4 вопросов.

**Логика:**
- Показывать после N вопросов (зависит от режима)
- Показывать при низкой уверенности
- Показывать при значительном прогрессе

**Методы:**
- `generate_intermediate_summary(state)` — генерирует резюме
- `should_show_intermediate_summary(state, question_count)` — проверяет, нужно ли показать
- `generate_progress_indicator(state)` — генерирует индикатор прогресса

#### 5. Обновлен Orchestrator (`orchestrator.py`)
- Добавлена обработка Q&A mode
- Добавлена обработка repair mode
- Добавлен выбор режима в `_advance()`
- Добавлен показ промежуточных резюме
- Добавлен счётчик вопросов `question_count`

#### 6. Обновлена модель DialogueState (`dialogue/state.py`)
Новые поля:
- `dialogue_mode: str` — текущий режим диалога
- `pending_question: Optional[str]` — слот, к которому нужно вернуться после Q&A
- `in_qa_mode: bool` — находится ли в режиме Q&A
- `repair_mode: bool` — находится ли в режиме исправления
- `repair_slot: Optional[str]` — какой слот исправляется
- `slot_history: Dict[str, List[dict]]` — история изменений слотов
- `question_count: int` — количество заданных вопросов

Новые методы:
- `set_mode(mode)` — устанавливает режим
- `is_expert_mode()`, `is_free_form_mode()`, `is_guided_mode()` — проверки режима
- `enter_qa_mode(slot)`, `exit_qa_mode()` — управление Q&A mode
- `enter_repair_mode(slot)`, `exit_repair_mode()` — управление repair mode
- `record_slot_change(key, old, new, reason)` — запись изменения
- `get_slot_history(key)` — получение истории
- `has_conflict(key, new_value)` — проверка конфликта

---

## Тесты

Добавлены новые тесты:
- `tests/test_policy_planner.py` — 8 тестов (Policy Engine + Planner)
- `tests/test_phase3.py` — 18 тестов (Mode selector + Q&A + Repair + Summary)
- `tests/test_phase4.py` — 28 тестов (User profile + Fatigue + Metrics + Escalation)

**Все 81 тест проходит** (27 оригинальных + 8 Policy + 18 Phase 3 + 28 Phase 4).

---

## Что это дает

### Гибкость
- Оркестратор теперь учитывает уверенность извлечения
- Вопросы задаются по приоритету, а не в жестком порядке
- Можно пропускать optional слоты без блокировки
- Пользователь может задавать вопросы во время сбора
- Пользователь может исправлять ответы
- Режим диалога адаптируется к пользователю

### Контроль
- Mandatory hard слоты всегда спрашиваются
- Low confidence слоты требуют уточнения
- Regulatory flags проверяются отдельно
- История изменений сохраняется для аудита

### Аудит
- Каждый слот имеет confidence, source, confirmed, assumption
- Можно отследить, откуда взялось значение
- Можно пометить предположения для проверки
- История изменений слотов сохраняется

### UX
- Промежуточные резюме снижают ощущение "бесконечной анкеты"
- Q&A позволяет пользователю получать информацию без прерывания сценария
- Repair позволяет исправлять ошибки без перезапуска диалога
- Режимы диалога адаптируются к опыту пользователя

---

### Фаза 4: Advanced features

#### 1. User Profile (`dialogue/user_profile.py`)
Автоматическое определение уровня пользователя и предпочитаемого стиля.

**Уровни expertise:**
- **novice** — новичок, нужна помощь и подсказки
- **medium** — средний уровень, стандартный диалог
- **expert** — эксперт (BA/PO), быстрый путь к драфту

**Стили:**
- **business** — простой язык, без технических терминов
- **technical** — технический язык, API, JSON, settlement

**Логика определения:**
- Технические термины (API, endpoint, settlement) → technical style
- novice индикаторы ("не знаю", "помогите") → novice expertise
- expert индикаторы ("as-is", "to-be", "acceptance criteria") → expert expertise

#### 2. Fatigue Detection (`dialogue/fatigue_detector.py`)
Обнаружение усталости пользователя по паттернам диалога.

**Уровни усталости:**
- **normal** — обычное состояние
- **tired** — устал (3+ вопросов подряд, 4+ коротких ответа)
- **frustrated** — расстроен (5+ вопросов подряд, 6+ коротких ответов, 3+ неудачных уточнения)

**Действия при усталости:**
- **tired** → показать промежуточное резюме
- **frustrated** → предложить создать черновик с открытыми вопросами

**Отслеживаемые метрики:**
- `consecutive_questions` — вопросов подряд без данных от пользователя
- `short_answers_count` — коротких ответов (<=3 слов)
- `clarification_failures` — неудачных попыток уточнения

#### 3. Metrics Tracker (`dialogue/metrics.py`)
Сбор и агрегация метрик качества диалога.

**Метрики сессии:**
- Время от старта до драфта
- Количество вопросов на драфт
- Количество заполненных/пропущенных слотов
- Уровень усталости пользователя
- Факт эскалации

**Агрегированные метрики:**
- Completion rate — % диалогов, дошедших до драфта
- Escalation rate — % эскалированных диалогов
- Avg time to draft — среднее время до драфта
- Avg questions per draft — среднее вопросов на драфт

**Методы:**
- `start_session(state)` — начать отслеживание
- `update_from_state(state)` — обновить метрики
- `end_session(state)` — завершить сессию
- `get_aggregate_metrics()` — получить агрегированные метрики
- `get_report()` — получить текстовый отчёт

#### 4. Escalation Handler (`dialogue/escalation_handler.py`)
Определение и обработка эскалации диалога человеку.

**Триггеры эскалации:**
1. Пользователь явно просит человека ("хочу человека")
2. Повторные out-of-domain попытки (3+ страйка)
3. Множественные неудачные уточнения (3+)
4. Пользователь расстроен (fatigue = frustrated)
5. Регуляторные аспекты с низкой уверенностью
6. Множественные высокорисковые слоты с низкой уверенностью

**При эскалации:**
- Сохраняется контекст диалога
- Формируется резюме для аналитика
- Пользователю показывается сообщение о передаче
- Записывается причина и приоритет эскалации

**Методы:**
- `check_escalation(state, message)` — проверить, нужна ли эскалация
- `prepare_escalation_context(state)` — подготовить контекст для человека

#### 5. Обновлена модель DialogueState
Новые поля:
- `user_expertise: str` — уровень пользователя (novice/medium/expert)
- `user_preferred_style: str` — предпочитаемый стиль (business/technical)
- `consecutive_questions: int` — вопросов подряд
- `short_answers_count: int` — коротких ответов
- `fatigue_level: str` — уровень усталости
- `session_started_at: float` — время начала сессии
- `draft_created_at: float` — время создания драфта
- `total_user_messages: int` — всего сообщений пользователя
- `total_agent_messages: int` — всего сообщений агента
- `escalation_reason: str` — причина эскалации
- `clarification_failures: int` — неудачных уточнений

Новые методы:
- `set_expertise(level)` — установить уровень
- `record_question_asked()` — записать вопрос
- `record_user_answer(message)` — записать ответ
- `is_fatigued()`, `is_frustrated()` — проверки усталости
- `get_session_duration()` — длительность сессии
- `get_time_to_draft()` — время до драфта
- `should_escalate()` — проверка необходимости эскалации

#### 6. Обновлен Orchestrator (`orchestrator.py`)
- Инициализация метрик при создании сессии
- Отслеживание сообщений пользователя/агента
- Анализ профиля пользователя
- Проверка эскалации перед обработкой
- Обновление fatigue level в `_advance()`
- Предложение драфта с gaps при frustrate
- Запись времени создания драфта

---

## Тесты

Добавлены новые тесты:
- `tests/test_policy_planner.py` — 8 тестов (Policy Engine + Planner)
- `tests/test_phase3.py` — 18 тестов (Mode selector + Q&A + Repair + Summary)
- `tests/test_phase4.py` — 28 тестов (User profile + Fatigue + Metrics + Escalation)

**Все 81 тест проходит** (27 оригинальных + 8 Policy + 18 Phase 3 + 28 Phase 4).

---

## Что это дает

### Гибкость
- Оркестратор теперь учитывает уверенность извлечения
- Вопросы задаются по приоритету, а не в жестком порядке
- Можно пропускать optional слоты без блокировки
- Пользователь может задавать вопросы во время сбора
- Пользователь может исправлять ответы
- Режим диалога адаптируется к пользователю

### Контроль
- Mandatory hard слоты всегда спрашиваются
- Low confidence слоты требуют уточнения
- Regulatory flags проверяются отдельно
- История изменений сохраняется для аудита
- Эскалация при рисках и неопределённости

### Аудит
- Каждый слот имеет confidence, source, confirmed, assumption
- Можно отследить, откуда взялось значение
- Можно пометить предположения для проверки
- История изменений слотов сохраняется
- Полные метрики качества диалога

### UX
- Промежуточные резюме снижают ощущение "бесконечной анкеты"
- Q&A позволяет пользователю получать информацию без прерывания сценария
- Repair позволяет исправлять ошибки без перезапуска диалога
- Режимы диалога адаптируются к опыту пользователя
- Fatigue detection предотвращает раздражение пользователя
- Автоматическая эскалация при сложных ситуациях

### Аналитика
- Completion rate — эффективность оркестратора
- Time to draft — скорость работы
- Drop-off rate — где пользователи уходят
- Escalation rate — нагрузка на аналитиков
- Вопросы на драфт — эффективность диалога

---

## Совместимость

Все изменения обратно совместимы:
- Старые сессии загружаются с дефолтными значениями новых полей
- API не изменился
- Существующие тесты проходят без изменений

---

## Новые файлы

### Фаза 2
- `agent/dialogue/policy.py` — Policy Engine

### Фаза 3
- `agent/dialogue/mode_selector.py` — выбор режима диалога
- `agent/dialogue/qa_handler.py` — обработка Q&A
- `agent/dialogue/repair_handler.py` — обработка repair mode
- `agent/dialogue/summary_generator.py` — генерация промежуточных резюме

### Фаза 4
- `agent/dialogue/user_profile.py` — определение профиля пользователя
- `agent/dialogue/fatigue_detector.py` — обнаружение усталости
- `agent/dialogue/metrics.py` — трекинг метрик
- `agent/dialogue/escalation_handler.py` — обработка эскалации

### Тесты
- `agent/tests/test_policy_planner.py` — 8 тестов
- `agent/tests/test_phase3.py` — 18 тестов
- `agent/tests/test_phase4.py` — 28 тестов
