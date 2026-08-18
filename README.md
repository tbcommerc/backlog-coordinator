# DMB Platform

Платформа управления бэклогом задач и AI-ассистент для сбора бизнес-требований банковского подразделения DMB (Digital & Mobile Banking).

## Структура

| Папка | Описание |
|-------|----------|
| `agent/` | AI Business Analyst Assistant — FastAPI-сервис для диалогового сбора требований |
| `dmb-backlog/` | Система управления бэклогом — FastAPI backend + SPA frontend |

## Быстрый старт (Agent)

### 1. Установка зависимостей

```bash
cd agent
pip install -r requirements.txt
```

### 2. Настройка API ключа

Скопируйте шаблон конфигурации и впишите свой API ключ:

```bash
cd agent
cp .env.example .env
```

Откройте файл `agent/.env` и укажите ваш ключ:

```env
LLM_PROVIDER=openai_compat
OPENAI_API_KEY=sk-ваш-ключ-здесь
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

> Без ключа агент работает в режиме mock (без реального LLM).

### 3. Запуск

```bash
cd agent
python run.py
```

Агент доступен на http://127.0.0.1:9000

## Быстрый старт (DMB Backlog)

Подробная инструкция: [dmb-backlog/README.md](dmb-backlog/README.md)

```bash
cd dmb-backlog/backend
cp .env.example .env
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Frontend: http://localhost:8000

## Документация

- [Agent README](agent/README.md) — API, архитектура, структура
- [DMB Backlog README](dmb-backlog/README.md) — полная документация Backend + Frontend
