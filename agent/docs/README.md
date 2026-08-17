# AI Business Analyst Agent — Документация

## Обзор

Полная документация по AI Business Analyst Agent — диалоговому агенту для сбора бизнес-требований к платформе сопровождения инвестиционных сделок.

---

## Документы

### 📐 [ARCHITECTURE.md](ARCHITECTURE.md)

**Основной архитектурный документ.**

Содержит:
- Компонентную архитектуру (PlantUML диаграммы)
- Поток обработки сообщения (sequence diagram)
- Состояния диалога (state machine)
- Описание всех компонентов с пояснениями
- Seed data структуру
- **Заглушки для ПРОМ** с чеклистом доработок
- Deployment checklist
- Glossary

**Для кого:** Архитекторы, разработчики, tech leads.

---

### 🔌 [API.md](API.md)

**Справочник по HTTP API.**

Содержит:
- Описание всех endpoints
- Request/Response примеры
- User Context структура
- Error responses
- Примеры использования (curl)
- Безопасность API
- Тестирование API

**Для кого:** Backend разработчики, интеграционные команды.

---

### 🚀 [DEPLOYMENT.md](DEPLOYMENT.md)

**Пошаговая инструкция по деплою.**

Содержит:
- Предварительные требования
- Настройка окружения
- Конфигурация LLM Provider (OpenAI/Azure/vLLM/Ollama)
- Настройка Knowledge Base
- Настройка внешних инструментов
- Настройка Session Store (SQLite/PostgreSQL)
- Настройка Audit Logging
- Настройка безопасности (HTTPS, Rate Limiting, CORS)
- Запуск сервиса (Uvicorn/Systemd/Docker)
- Проверка работоспособности
- Мониторинг и alerting
- Интеграция с DMB Backend
- Интеграция с Jira/Confluence
- Backup и Recovery
- Troubleshooting
- Performance Tuning
- **Checklist перед запуском в ПРОМ**

**Для кого:** DevOps, системные администраторы, release инженеры.

---

### 📚 [KB_GUIDE.md](KB_GUIDE.md)

**Руководство по наполнению базы знаний.**

Содержит:
- Структура KB
- Формат manifest.json
- Формат markdown документов
- Формат requirements_history.json
- Как добавить новый документ
- Как обновить существующий документ
- Как изменить статус/приоритет
- Best Practices
- Проверка KB
- Troubleshooting
- Автоматизация обновления KB (экспорт из Jira)

**Для кого:** Бизнес-аналитики, контент-менеджеры, предметные эксперты.

---

## Быстрый старт

### 1. Установка

```bash
cd agent
python -m venv venv
source venv/bin/activate  # или venv\Scripts\activate на Windows
pip install -r requirements.txt
```

### 2. Конфигурация

```bash
cp .env.example .env
# Отредактируйте .env:
# - LLM_PROVIDER=openai_compat
# - OPENAI_API_KEY=sk-...
# - AGENT_SECRET=<сгенерируйте сильный секрет>
```

### 3. Запуск

```bash
python run.py
```

Агент запустится на `http://127.0.0.1:9000`

### 4. Проверка

```bash
curl http://127.0.0.1:9000/api/agent/config \
  -H "X-Agent-Secret: your-secret"
```

---

## Структура проекта

```
agent/
├── agent/                    # Основной код агента
│   ├── api/                  # HTTP API (router, schemas)
│   ├── composer/             # Сборка драфта требования
│   ├── dialogue/             # Dialogue subsystem (12 компонентов)
│   │   ├── state.py          # Dialogue State
│   │   ├── machine.py        # State Machine
│   │   ├── extractor.py      # Slot Extractor
│   │   ├── planner.py        # Question Planner
│   │   ├── policy.py         # Policy Engine
│   │   ├── mode_selector.py  # Mode Selector
│   │   ├── qa_handler.py     # Q&A Handler
│   │   ├── repair_handler.py # Repair Handler
│   │   ├── summary_generator.py
│   │   ├── user_profile.py   # User Profile Detector
│   │   ├── fatigue_detector.py
│   │   ├── metrics.py        # Metrics Tracker
│   │   └── escalation_handler.py
│   ├── guardrails/           # Input/Output validation
│   ├── kb/                   # Knowledge Base
│   ├── llm/                  # LLM Integration
│   ├── mcp/                  # MCP Integration
│   ├── tools/                # External Tools
│   ├── workflow/             # Review Workflow
│   ├── orchestrator.py       # Dialogue Orchestrator
│   ├── session.py            # Session Store
│   ├── config.py             # Configuration
│   ├── context.py            # User Context
│   ├── audit.py              # Audit Logger
│   └── main.py               # FastAPI app
├── kb_seed/                  # Knowledge Base seed data
├── agent_logs/               # Audit logs
├── docs/                     # Документация (вы здесь)
├── tests/                    # Тесты (81 тест passing)
├── .env                      # Конфигурация
├── requirements.txt          # Зависимости
└── run.py                    # Точка входа
```

---

## Ключевые принципы

1. **Детерминированный управляющий контур** — весь контроль на Python, LLM только перефразирует
2. **Human-in-the-loop** — агент не утверждает требования, только формирует драфт
3. **Auditability** — все события логируются
4. **Grounded generation** — ответы только на основе KB

---

## Заглушки для ПРОМ

**ВАЖНО:** Перед запуском в production необходимо заменить заглушки:

| Компонент | Текущее состояние | Для ПРОМ |
|---|---|---|
| LLM Provider | MockProvider (шаблонные ответы) | Real LLM (OpenAI/Azure/vLLM) |
| Knowledge Base | Seed данные (пример) | Реальные данные о платформе |
| External Tools | Stubs (mock responses) | Реальные endpoints banking systems |
| MCP Servers | Не подключены | Настроить real MCP servers |
| Workflow Integrations | Stubs (fake issue keys) | Real Jira/Confluence API |
| Session Store | SQLite file | PostgreSQL (опционально) |
| Audit Logging | File-based | Centralized logging (ELK/Splunk) |
| Security | Hardcoded secret | Production-grade security |

Подробности в [ARCHITECTURE.md](ARCHITECTURE.md#заглушки-и-доработки-для-пром).

---

## Тестирование

```bash
# Все тесты (81 passing)
python -m pytest agent/tests -v

# Конкретный модуль
python -m pytest agent/tests/test_orchestrator.py -v

# С покрытием
python -m pytest agent/tests --cov=agent --cov-report=html
```

---

## Мониторинг

**Текущее состояние:** MetricsTracker собирает метрики, но нет экспорта.

**Для ПРОМ:**
- Добавить Prometheus exporter
- Настроить Grafana dashboards
- Добавить alerting на:
  - High escalation rate
  - Low completion rate
  - High latency

Подробности в [DEPLOYMENT.md](DEPLOYMENT.md#шаг-11-мониторинг).

---

## Поддержка

- **Документация:** `docs/` (вы здесь)
- **Архитектура:** `docs/ARCHITECTURE.md`
- **API:** `docs/API.md`
- **Деплой:** `docs/DEPLOYMENT.md`
- **KB:** `docs/KB_GUIDE.md`
- **Улучшения оркестратора:** `ORCHESTRATOR_IMPROVEMENTS.md`

---

## Версия

- **Версия:** 1.0.0
- **Дата:** 2026-08-15
- **Статус:** Development (не production-ready)

---

## Changelog

### v1.0.0 (2026-08-15)

- Реализованы все 4 фазы доработки оркестратора
- Фаза 1: Slot confidence + Mandatory categories
- Фаза 2: Policy Engine + Question Planner с приоритетами
- Фаза 3: Multi-mode dialogue + Q&A + Repair
- Фаза 4: User profile + Fatigue detection + Metrics + Escalation
- 81 тест passing
- Полная документация
