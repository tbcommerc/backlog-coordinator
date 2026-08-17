# AI Business Analyst Agent — Deployment Guide

## Обзор

Пошаговая инструкция по развёртыванию AI Business Analyst Agent в production-окружении.

---

## Предварительные требования

### Системные требования

- **OS:** Linux (Ubuntu 20.04+), Windows Server 2019+
- **Python:** 3.10+
- **RAM:** 2 GB minimum, 4 GB recommended
- **Disk:** 1 GB для приложения + место для БД и логов
- **Network:** Доступ к LLM API (OpenAI/Azure), опционально к MCP servers

### Зависимости

- Python 3.10+
- pip
- SQLite (встроен) или PostgreSQL (опционально)
- Доступ к LLM API (OpenAI/Azure OpenAI/vLLM)

---

## Шаг 1: Подготовка окружения

### 1.1. Клонируйте репозиторий

```bash
git clone <repository-url>
cd agent
```

### 1.2. Создайте виртуальное окружение

```bash
python -m venv venv

# Linux/Mac
source venv/bin/activate

# Windows
venv\Scripts\activate
```

### 1.3. Установите зависимости

```bash
pip install -r requirements.txt
```

**requirements.txt:**
```
fastapi>=0.100.0
uvicorn>=0.23.0
pydantic>=2.0.0
pydantic-settings>=2.0.0
```

---

## Шаг 2: Конфигурация

### 2.1. Создайте .env файл

```bash
cp .env.example .env
```

### 2.2. Настройте .env

```ini
# Paths
KB_DIR=kb_seed
SESSION_DB=agent_sessions.db

# Service
APP_NAME=DMB AI Business Analyst Assistant
APP_VERSION=1.0.0
DEBUG=False
AGENT_PORT=9000

# LLM Provider (ВАЖНО для ПРОМ!)
LLM_PROVIDER=openai_compat
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

# Security (ОБЯЗАТЕЛЬНО измените!)
AGENT_SECRET=generate-strong-random-secret-here-32-chars-min

# MCP Servers (опционально)
MCP_SERVERS_JSON=[]

# External Tools (опционально)
TOOLS_CONFIG_JSON=[]

# Domain Policy
ALLOWED_INTENTS=["feature","change","problem","clarification","incident"]
OUT_OF_DOMAIN_MAX_STRIKES=3

# Retrieval
KB_MAX_DOCS=4
KB_MAX_SNIPPETS=6
```

### 2.3. Сгенерируйте сильный AGENT_SECRET

```bash
# Linux/Mac
python -c "import secrets; print(secrets.token_urlsafe(32))"

# Windows PowerShell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

**ВАЖНО:** Сохраните секрет в безопасном месте (password manager, vault).

---

## Шаг 3: Настройка LLM Provider

### Вариант A: OpenAI API

1. Получите API key на https://platform.openai.com/api-keys
2. Настройте .env:
   ```ini
   LLM_PROVIDER=openai_compat
   OPENAI_API_KEY=sk-...
   OPENAI_BASE_URL=https://api.openai.com/v1
   OPENAI_MODEL=gpt-4o-mini
   ```
3. Убедитесь, что есть баланс на аккаунте

### Вариант B: Azure OpenAI

1. Создайте resource в Azure Portal
2. Deploy модель (gpt-4o-mini)
3. Получите API key и endpoint
4. Настройте .env:
   ```ini
   LLM_PROVIDER=openai_compat
   OPENAI_API_KEY=your-azure-key
   OPENAI_BASE_URL=https://your-resource.openai.azure.com
   OPENAI_MODEL=gpt-4o-mini
   ```

### Вариант C: vLLM (self-hosted)

1. Установите vLLM: `pip install vllm`
2. Запустите сервер:
   ```bash
   vllm serve openai-community/gpt-4o-mini --port 8000
   ```
3. Настройте .env:
   ```ini
   LLM_PROVIDER=openai_compat
   OPENAI_API_KEY=not-needed
   OPENAI_BASE_URL=http://localhost:8000/v1
   OPENAI_MODEL=openai-community/gpt-4o-mini
   ```

### Вариант D: Ollama (local)

1. Установите Ollama: https://ollama.ai
2. Запустите модель:
   ```bash
   ollama run llama3.1
   ```
3. Настройте .env:
   ```ini
   LLM_PROVIDER=openai_compat
   OPENAI_API_KEY=not-needed
   OPENAI_BASE_URL=http://localhost:11434/v1
   OPENAI_MODEL=llama3.1
   ```

**Примечание:** Mock provider (по умолчанию) не подходит для ПРОМ — он возвращает шаблонные ответы без реальной генерации.

---

## Шаг 4: Настройка Knowledge Base

### 4.1. Подготовьте данные

Замените seed данные в `kb_seed/` на реальные:

**Обязательные файлы:**
- `manifest.json` — метаданные документов
- `products.md` — инвестиционные продукты
- `modules.md` — модули платформы
- `processes.md` — бизнес-процессы
- `roles.md` — роли пользователей
- `regulations.md` — регуляторные требования
- `requirements_history.json` — история требований

**Формат markdown:**
```markdown
# Заголовок документа

## Entity Name (Aliases)

- **Описание:** ...
- **Жизненный цикл:** ...
- **Особенности сопровождения:** ...
- **Связанные модули:** ...
```

**Формат manifest.json:**
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

### 4.2. Проверьте загрузку KB

```bash
python -c "from agent.kb.loader import kb; print(kb.stats())"
```

**Ожидаемый вывод:**
```
{'documents': 9, 'chunks': 45, 'approved': 45}
```

---

## Шаг 5: Настройка внешних инструментов (опционально)

### 5.1. HTTP Tools

Если нужны интеграции с внешними системами:

```ini
TOOLS_CONFIG_JSON=[
  {
    "name": "trade_registry",
    "description": "Реестр сделок",
    "url": "https://api.bank.internal/trades",
    "mock_response": null
  },
  {
    "name": "customer_data",
    "description": "Данные клиентов",
    "url": "https://api.bank.internal/customers",
    "mock_response": null
  }
]
```

**ВАЖНО:** Убедитесь, что:
- Endpoints доступны из сети агента
- Настроена аутентификация (API keys, certificates)
- Endpoints поддерживают только GET (для безопасности)

### 5.2. MCP Servers

Если нужны MCP tools:

1. Установите MCP package:
   ```bash
   pip install mcp
   ```

2. Настройте servers:
   ```ini
   MCP_SERVERS_JSON=[
     {
       "name": "kb-tools",
       "command": "python",
       "args": ["mcp_server.py"]
     }
   ]
   ```

---

## Шаг 6: Настройка Session Store

### Вариант A: SQLite (по умолчанию)

Не требует дополнительной настройки. Файл создаётся автоматически: `agent_sessions.db`

**Рекомендации:**
- Настроить backups (cron job)
- Настроить retention policy (удаление старых сессий)

### Вариант B: PostgreSQL (для production)

1. Установите PostgreSQL
2. Создайте базу данных:
   ```sql
   CREATE DATABASE agent_sessions;
   CREATE USER agent WITH PASSWORD 'secure-password';
   GRANT ALL PRIVILEGES ON DATABASE agent_sessions TO agent;
   ```

3. Модифицируйте `session.py` для использования PostgreSQL:
   ```python
   import psycopg2
   
   class SessionStore:
       def __init__(self, dsn: str):
           self._conn = psycopg2.connect(dsn)
   ```

4. Настройте .env:
   ```ini
   SESSION_DB=postgresql://agent:secure-password@localhost:5432/agent_sessions
   ```

---

## Шаг 7: Настройка Audit Logging

### 7.1. File-based logging (по умолчанию)

Логи пишутся в `agent_logs/audit.log` (JSON lines).

**Рекомендации для ПРОМ:**
- Настроить log rotation:
  ```bash
  # /etc/logrotate.d/agent-audit
  /path/to/agent/agent_logs/audit.log {
      daily
      rotate 30
      compress
      delaycompress
      missingok
      notifempty
  }
  ```

### 7.2. Centralized logging (опционально)

Интеграция с ELK/Splunk:

1. Модифицируйте `audit.py`:
   ```python
   import logging
   import logstash
   
   logger = logging.getLogger('agent-audit')
   handler = logstash.LogstashHandler('logstash-host', 5000, version=1)
   logger.addHandler(handler)
   ```

2. Настройте Logstash pipeline для приёма логов

---

## Шаг 8: Настройка безопасности

### 8.1. HTTPS

**ВАЖНО:** Все API calls должны идти через HTTPS в production.

**Вариант A: Nginx reverse proxy**

```nginx
server {
    listen 443 ssl;
    server_name agent.bank.internal;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /api/agent/ {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Вариант B: Uvicorn с SSL**

```bash
uvicorn agent.main:app \
  --host 0.0.0.0 \
  --port 9000 \
  --ssl-keyfile /path/to/key.pem \
  --ssl-certfile /path/to/cert.pem
```

### 8.2. Rate Limiting

Добавьте rate limiting через slowapi:

```bash
pip install slowapi
```

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@router.post("/chat")
@limiter.limit("100/minute")
def chat(request: Request, req: ChatRequest):
    ...
```

### 8.3. CORS

Настройте CORS в `main.py`:

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://dmb-backend.bank.internal"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["X-Agent-Secret", "Content-Type"],
)
```

---

## Шаг 9: Запуск сервиса

### 9.1. Development mode

```bash
python run.py
```

### 9.2. Production mode (Uvicorn)

```bash
uvicorn agent.main:app \
  --host 0.0.0.0 \
  --port 9000 \
  --workers 4 \
  --log-level info \
  --access-log
```

### 9.3. Production mode (Systemd)

Создайте `/etc/systemd/system/agent.service`:

```ini
[Unit]
Description=AI Business Analyst Agent
After=network.target

[Service]
Type=simple
User=agent
WorkingDirectory=/opt/agent
Environment="PATH=/opt/agent/venv/bin"
ExecStart=/opt/agent/venv/bin/uvicorn agent.main:app --host 0.0.0.0 --port 9000 --workers 4
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Запустите:
```bash
sudo systemctl daemon-reload
sudo systemctl enable agent
sudo systemctl start agent
sudo systemctl status agent
```

### 9.4. Production mode (Docker)

Создайте `Dockerfile`:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 9000

CMD ["uvicorn", "agent.main:app", "--host", "0.0.0.0", "--port", "9000", "--workers", "4"]
```

Соберите и запустите:
```bash
docker build -t agent:1.0.0 .
docker run -d \
  --name agent \
  -p 9000:9000 \
  --env-file .env \
  -v /path/to/kb_seed:/app/kb_seed \
  -v /path/to/logs:/app/agent_logs \
  agent:1.0.0
```

---

## Шаг 10: Проверка работоспособности

### 10.1. Health check

```bash
curl http://127.0.0.1:9000/api/agent/config \
  -H "X-Agent-Secret: your-secret"
```

**Ожидаемый ответ:**
```json
{
  "provider": "openai_compat",
  "provider_available": true,
  "intents": {...},
  "kb_stats": {"documents": 9, "chunks": 45, "approved": 45},
  "mcp_servers": [],
  "tools": []
}
```

### 10.2. Тестовый диалог

```bash
# Создать сессию
curl -X POST http://127.0.0.1:9000/api/agent/new-session \
  -H "X-Agent-Secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"user_id": 1}'

# Отправить сообщение
curl -X POST http://127.0.0.1:9000/api/agent/chat \
  -H "X-Agent-Secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"session_id": "<session_id>", "message": "Привет"}'
```

### 10.3. Проверка LLM

Если `provider_available: false`:
- Проверьте API key в .env
- Проверьте доступность API endpoint
- Проверьте логи: `tail -f agent_logs/audit.log`

### 10.4. Проверка KB

Если `kb_stats.documents: 0`:
- Проверьте путь KB_DIR в .env
- Проверьте наличие `manifest.json` в kb_seed/
- Проверьте логи загрузки

---

## Шаг 11: Мониторинг

### 11.1. Логи

```bash
# Audit logs
tail -f agent_logs/audit.log

# Application logs (systemd)
journalctl -u agent -f

# Application logs (Docker)
docker logs -f agent
```

### 11.2. Метрики (для ПРОМ)

Добавьте Prometheus exporter:

```bash
pip install prometheus-fastapi-instrumentator
```

```python
from prometheus_fastapi_instrumentator import Instrumentator

Instrumentator().instrument(app).expose(app)
```

Метрики будут доступны на `/metrics`.

### 11.3. Alerting

Настройте alerting на:
- High error rate (>5%)
- High latency (p95 > 5s)
- Low completion rate (<50%)
- High escalation rate (>20%)

---

## Шаг 12: Интеграция с DMB Backend

### 12.1. Настройте DMB Backend

Добавьте переменные окружения:
```ini
AGENT_URL=http://agent-host:9000
AGENT_SECRET=your-secret
```

### 12.2. Проверьте интеграцию

```bash
# Из DMB Backend
curl -X POST http://agent-host:9000/api/agent/new-session \
  -H "X-Agent-Secret: your-secret" \
  -H "Content-Type: application/json" \
  -d '{"user_id": 42}'
```

---

## Шаг 13: Настройка Jira/Confluence (опционально)

### 13.1. Jira Integration

Модифицируйте `workflow/integrations.py`:

```python
import requests

def create_issue(draft: dict, connector: str = "jira") -> dict:
    response = requests.post(
        "https://jira.bank.internal/rest/api/2/issue",
        auth=("user", "api-token"),
        json={
            "fields": {
                "project": {"key": "DMB"},
                "summary": draft["title"],
                "description": to_markdown(draft),
                "issuetype": {"name": "Task"}
            }
        }
    )
    return response.json()
```

### 13.2. Confluence Integration

```python
def publish_draft(draft: dict, space: str = "DMB") -> dict:
    response = requests.post(
        "https://confluence.bank.internal/rest/api/content",
        auth=("user", "api-token"),
        json={
            "type": "page",
            "title": draft["title"],
            "space": {"key": space},
            "body": {"storage": {"value": to_markdown(draft), "representation": "storage"}}
        }
    )
    return response.json()
```

---

## Шаг 14: Backup и Recovery

### 14.1. Backup sessions

```bash
# SQLite
sqlite3 agent_sessions.db ".backup '/backup/agent_sessions_$(date +%Y%m%d).db'"

# PostgreSQL
pg_dump agent_sessions > /backup/agent_sessions_$(date +%Y%m%d).sql
```

### 14.2. Backup audit logs

```bash
tar -czf /backup/agent_logs_$(date +%Y%m%d).tar.gz agent_logs/
```

### 14.3. Recovery

```bash
# SQLite
cp /backup/agent_sessions_20260815.db agent_sessions.db

# PostgreSQL
psql agent_sessions < /backup/agent_sessions_20260815.sql
```

---

## Шаг 15: Troubleshooting

### Проблема: LLM не отвечает

**Симптомы:** `provider_available: false`

**Решение:**
1. Проверьте API key в .env
2. Проверьте доступность API:
   ```bash
   curl https://api.openai.com/v1/models \
     -H "Authorization: Bearer sk-..."
   ```
3. Проверьте логи: `tail -f agent_logs/audit.log`
4. Проверьте баланс на аккаунте OpenAI

---

### Проблема: KB не загружается

**Симптомы:** `kb_stats.documents: 0`

**Решение:**
1. Проверьте путь KB_DIR в .env
2. Проверьте наличие `manifest.json`:
   ```bash
   ls kb_seed/manifest.json
   ```
3. Проверьте валидность JSON:
   ```bash
   python -m json.tool kb_seed/manifest.json
   ```

---

### Проблема: Сессии не сохраняются

**Симптомы:** После перезапуска сессии теряются

**Решение:**
1. Проверьте права на файл:
   ```bash
   ls -la agent_sessions.db
   ```
2. Проверьте путь SESSION_DB в .env
3. Проверьте логи SQLite

---

### Проблема: Out-of-domain ошибки

**Симптомы:** Легитимные запросы классифицируются как out-of-domain

**Решение:**
1. Проверьте ontology: `agent/kb/ontology.py`
2. Добавьте больше domain terms в KB
3. Настройте `OUT_OF_DOMAIN_MAX_STRIKES` в .env

---

## Шаг 16: Performance Tuning

### 16.1. Uvicorn workers

```bash
# Formula: workers = (2 x CPU_CORES) + 1
uvicorn agent.main:app --workers 4
```

### 16.2. LLM caching

Добавьте кэширование для rephrase:

```python
from functools import lru_cache

@lru_cache(maxsize=1000)
def rephrase_cached(text: str) -> str:
    ...
```

### 16.3. KB optimization

- Используйте только approved документы
- Уменьшите KB_MAX_SNIPPETS если KB большая
- Добавьте индексы для PostgreSQL

---

## Checklist перед запуском в ПРОМ

- [ ] LLM provider настроен и протестирован
- [ ] KB загружена с реальными данными
- [ ] AGENT_SECRET сгенерирован (32+ символа)
- [ ] HTTPS настроен
- [ ] Rate limiting добавлен
- [ ] CORS настроен
- [ ] Audit logging настроен (rotation/centralized)
- [ ] Backups настроены
- [ ] Monitoring настроен (Prometheus/Grafana)
- [ ] Alerting настроен
- [ ] Integration с DMB Backend протестирована
- [ ] Integration с Jira/Confluence протестирована (если нужно)
- [ ] Load testing проведено
- [ ] Security audit проведён
- [ ] Documentation для ops подготовлена
- [ ] Runbook для incident response подготовлен

---

## Ссылки

- [ARCHITECTURE.md](ARCHITECTURE.md) — общая архитектура
- [API.md](API.md) — описание API
- [KB_GUIDE.md](KB_GUIDE.md) — руководство по наполнению KB
