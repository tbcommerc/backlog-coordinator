---
title: Паспорт DEV-стенда Backlog coordinator
scope: target-dev-testing
status: ready-to-fill
last_updated: 2026-09-01
---

# Паспорт DEV-стенда

Документ заполняется DevOps перед первым smoke и обновляется при каждом изменении топологии. Секретные значения не указываются: фиксируются только имя secret object, владелец и факт проверки.

## 1. Идентификация

| Поле | Значение |
|---|---|
| Название контура | DEV |
| Внешний URL | |
| Deployment ticket | |
| Git repository | |
| Branch/tag/commit | |
| Дата сборки | |
| Дата развёртывания | |
| Владелец стенда | |
| DevOps contact | |
| QA contact | |

## 2. Топология

| Компонент | Host/namespace | Instance count | Port/internal URL | Runtime/image | Persistent storage |
|---|---|---:|---|---|---|
| Reverse proxy | | | | | |
| DMB backend/frontend | | | `:8000` AS-IS default | | |
| AI agent | | | `:9000` AS-IS default | | |
| Task Prioritiser | | | `:9100` AS-IS default | | |
| Notification scheduler | | | | | |
| Database | | | | | |
| Redis | | | | | |
| Upload storage | | | | | |
| Agent session store | | | | | |
| Log storage | | | | | |

Архитектурные ограничения фиксируются явно. Backlog и Agent на стенде требуют
PostgreSQL; для SQLite prioritiser и local/shared files указываются ограничения
instance/worker count и способ предотвращения конкурентного повреждения.

## 3. Версии

| Компонент | Версия |
|---|---|
| OS/base image | |
| Python | |
| Node.js, если нужен при сборке | |
| Backend application | |
| Agent application | |
| Prioritiser application | |
| Database | |
| Redis | |
| Reverse proxy | |
| LLM provider/model | |
| KB version/hash | |

## 4. Конфигурация без секретов

| Переменная | Backend | Agent | Источник/secret object | Проверено |
|---|---|---|---|---|
| `DEBUG=false` | | | | |
| `DATABASE_URL` | masked target | N/A | | |
| `REDIS_URL` | masked target | N/A | | |
| `SECRET_KEY` | set/not set | N/A | | |
| `AGENT_BASE_URL` | internal URL | N/A | | |
| `AGENT_SECRET` | set/not set | set/not set | | |
| `PRIORITISER_BASE_URL` | internal URL | N/A | | |
| `CORS_ORIGINS` | exact origins | N/A | | |
| `RUN_STARTUP_SEED=false` | | N/A | | |
| `RUN_STARTUP_MAINTENANCE` | | N/A | | |
| `RUN_NOTIFICATION_SCHEDULER=false` | | N/A | | |
| `SESSION_DB` | N/A | persistent path | | |
| `LLM_PROVIDER` | N/A | | | |
| `OPENAI_BASE_URL` | N/A | masked host | | |
| `OPENAI_MODEL` | N/A | | | |
| `OPENAI_API_KEY` | N/A | set/not set | | |
| `KB_DIR` | N/A | read-only path | | |
| `MCP_SERVERS_JSON` | N/A | count/names only | | |
| `TOOLS_CONFIG_JSON` | N/A | count/names only | | |

## 5. Сеть и TLS

| From | To | Protocol/port | Purpose | Rule/proxy | Проверено |
|---|---|---|---|---|---|
| Browser | Reverse proxy | HTTPS/443 | UI/API | | |
| Reverse proxy | Backend | HTTP(S)/8000 | application | | |
| Backend | Agent | HTTP(S)/9000 | agent proxy | | |
| Backend | Prioritiser | HTTP/9100 | Value/priority calculation | internal only | |
| Backend | DB | | persistence | | |
| Backend | Redis | | rate limit | | |
| Agent | LLM | HTTPS/443 | inference | | |

TLS certificate: issuer, hostname, expiry, owner and renewal process.

## 6. Storage, backup и retention

| Data | Path/volume | Size/quota | Backup | Retention | Owner |
|---|---|---:|---|---|---|
| Backlog DB | | | | | |
| Uploads | | | | | |
| Agent sessions | | | | | |
| Prioritiser state/snapshot | | | | | |
| Agent audit | | | | | |
| Application logs | | | | | |
| KB artifact | | | | | |

## 7. Наблюдаемость

| Возможность | URL/system | Retention | Alert | Owner | Статус |
|---|---|---|---|---|---|
| Backend logs | | | | | |
| Agent logs/audit | | | | | |
| Prioritiser logs | | | | | |
| Process health | | | | | |
| DB/Redis health | | | | | |
| LLM errors/latency | | | | | |
| Disk usage | | | | | |

## 8. Известные ограничения и OPEN QUESTIONS

| ID | Ограничение/вопрос | Риск | Владелец | Решение/срок |
|---|---|---|---|---|
| ENV-01 | Production-like СУБД не подтверждена | | | |
| ENV-02 | Health не проверяет зависимости | | | |
| ENV-03 | Horizontal scaling с локальными хранилищами не подтверждён | | | |

## 9. Допуск к smoke

- [ ] Топология заполнена.
- [ ] Commit/tag известен.
- [ ] Нет связи с production data/resources.
- [ ] Секреты находятся вне документации.
- [ ] Startup seed выключен.
- [ ] Тестовые профили подготовлены.
- [ ] Владельцы storage/logs/LLM назначены.
- [ ] Известные ограничения зарегистрированы.
