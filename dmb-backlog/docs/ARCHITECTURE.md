# Архитектура DMB Backlog

**Версия:** 3.0  
**Дата:** 2026-06-29

---

## 1. Технологический стек

| Слой | Технология | Версия |
|------|-----------|--------|
| Backend | Python + FastAPI | 3.12+ / 0.100+ |
| ORM | SQLAlchemy | 2.0 |
| Frontend | Vanilla JS (ES6 modules) | — |
| Стили | CSS Custom Properties | — |
| Иконки | Lucide Icons (локально) | 0.263.0 |
| Графики | Chart.js (локально) | 4.4.0 |
| Экспорт | xlsx (локально) | — |
| БД (dev) | SQLite | 3 |
| БД (prod target) | PostgreSQL | 15+ |
| Auth | JWT HS256 + bcrypt | — |

---

## 2. Архитектурная схема

```
┌──────────────────────────────────────────────────────────────┐
│                    Frontend (SPA)                             │
│  index.html → router.js (hash) → store.js (pub/sub)         │
│  Компоненты: sidebar, navbar, dashboard, taskTable,          │
│  kanbanBoard, modal, filterToolbar, admin, analytics,        │
│  customerPortal, customerChat, customerReport, reports,      │
│  notifications, settings, teamBacklog                        │
└──────────────────────┬───────────────────────────────────────┘
                       │ REST API (JSON) /api/v1/*
┌──────────────────────▼───────────────────────────────────────┐
│                    FastAPI Backend                            │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│  │  Routers  │  │  Middleware  │  │  Auth (JWT/bcrypt)   │ │
│  │  (7 шт.)  │  │  Log + Audit│  │  Dependencies        │ │
│  └─────┬─────┘  └──────────────┘  └──────────────────────┘ │
│        │                                                      │
│  ┌─────▼────────────────────────────────────────────────┐   │
│  │  Business Logic (inline в routers)                    │   │
│  └─────┬────────────────────────────────────────────────┘   │
│        │                                                      │
│  ┌─────▼────────────────────────────────────────────────┐   │
│  │  Data Access Layer (SQLAlchemy ORM)                  │   │
│  │  22 models: User, Team, Role, Task, TaskHistory,      │   │
│  │  Project, Notification, NotificationTemplate,         │   │
│  │  Report, AuditLog, DictionaryItem,                    │   │
│  │  Channel, Deadline, Department, Priority, Status,     │   │
│  │  TaskType, TeamType, ProjectStatus, Tag,              │   │
│  │  IssueTag, ProjectTag                                 │   │
│  └─────┬────────────────────────────────────────────────┘   │
└────────┼──────────────────────────────────────────────────────┘
         │
┌────────▼──────────────────────────────────────────────────────┐
│                    Database (SQLite)                           │
│  22 tables, полностью нормализованная схема (3NF)             │
│  auto-migration через ensure_schema() при каждом запуске     │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Backend-компоненты

### 3.1 Роутеры (префикс /api/v1)

| Роутер | Эндпоинты | Назначение |
|--------|-----------|------------|
| `auth_router` | `/auth/login`, `/auth/refresh`, `/auth/me`, `/auth/logout` | Аутентификация, JWT |
| `tasks_router` | `/tasks` (GET/POST/PUT/DELETE), `/tasks/report/{kind}`, `/tasks/analytics`, `/tasks/stats`, `/tasks/bulk` | CRUD задач, отчёты, аналитика |
| `teams_router` | `/teams` | CRUD команд |
| `users_router` | `/users` | CRUD пользователей |
| `reports_router` | `/reports` | CRUD отчётов |
| `customer_router` | `/customer/tasks`, `/customer/tasks/{id}` | Портал бизнес-заказчика |
| `admin_router` | `/admin/roles`, `/admin/teams`, `/admin/users`, `/admin/{dict-type}`, `/admin/notification-templates`, `/admin/team-types-ref` | Администрирование |

### 3.2 Middleware

- `LoggingMiddleware` — логирование всех request/response (файл + stdout)
- `AuditMiddleware` — запись write-операций в `audit_log`
- `CORSMiddleware` — настройки CORS

### 3.3 Auth

- `get_current_user` — валидация JWT, загрузка пользователя
- `get_current_user_optional` — опциональная аутентификация
- `require_permission(permission, level)` — dependency проверки прав
- `check_permission(user, permission, level)` — иерархическая проверка (0-3)
- `require_role(allowed_roles)` — проверка по названию роли

### 3.4 Автомиграция схемы

`database.py:ensure_schema()` — при каждом запуске:
1. `Base.metadata.create_all()` — создаёт отсутствующие таблицы
2. `inspector.get_columns()` — сравнивает колонки моделей с БД
3. `ALTER TABLE ADD COLUMN` — добавляет недостающие колонки
4. Не изменяет и не удаляет существующие данные

---

## 4. Frontend-архитектура

### 4.1 Компоненты (16 модулей)

| Модуль | Назначение |
|--------|-----------|
| `router.js` | Hash-роутер, breadcrumbs, ленивая загрузка страниц |
| `store.js` | State manager (pub/sub), кеширование данных |
| `api.js` | HTTP-клиент поверх fetch, авто-JWT, обработка 401 |
| `auth.js` | Логин, логаут, refresh token |
| `sidebar.js` | Боковая панель с проверкой прав доступа |
| `navbar.js` | Верхняя панель с поиском и логаутом |
| `dashboard.js` | Главная страница: квартальный прогресс-бар, KPI, уведомления, риски, график |
| `taskTable.js` | Таблица задач бэклога DMB |
| `teamBacklog.js` | Бэклог команды с bulk-операциями |
| `kanbanBoard.js` | Канбан-доска (13 колонок, drag-and-drop) |
| `modal.js` | Карточка задачи (просмотр/редактирование, sticky header) |
| `filterToolbar.js` | Панель фильтрации, поиска, сортировки, настройки колонок |
| `analytics.js` | Аналитика Tribe и PO/PL (графики Chart.js) |
| `reports.js` | Статус-отчёты для встреч |
| `customerPortal.js` | Портал бизнес-заказчика: мои задачи |
| `customerChat.js` | Портал бизнес-заказчика: создание задачи |
| `customerReport.js` | Отчёт бизнес-заказчика |
| `notifications.js` | Уведомления (системные + авто-генерируемые) |
| `settings.js` | Настройки UI (тема, цвет, компактность) |
| `admin.js` | Администрирование: команды, пользователи, роли, справочники |

### 4.2 Sticky-механизмы

**Тулбар + заголовок таблицы (Бэклог):**
- `.sticky-toolbar { position: sticky; top: var(--navbar-height); z-index: 25 }`
- `thead th { position: sticky; top: var(--sticky-thead-offset); z-index: 20 }`
- `--sticky-thead-offset` вычисляется через `updateStickyOffsets()` в `filterToolbar.js`

**Админка:**
- Вкладки: `position: sticky; top: var(--navbar-height); z-index: 30`
- Кнопки/поиск: перемещаются в sticky-блок через `pullStickyBars()`
- Заголовки таблиц: клон `thead` с `position: fixed` через `initAdminStickyThead()` (IntersectionObserver)

### 4.3 Поток данных

1. Пользователь вводит логин/пароль → `POST /api/v1/auth/login`
2. Backend проверяет bcrypt, возвращает JWT + permissions + user data
3. Frontend сохраняет в `localStorage.dmb_tokens` и `store`
4. API Client добавляет `Authorization: Bearer <token>` ко всем запросам
5. Backend `get_current_user` валидирует токен и права
6. Данные возвращаются в JSON, UI обновляется
7. При 401: попытка refresh → при неудаче logout

### 4.4 Проверка прав на фронтенде

- `sidebar.js:initSidebar()` — читает `user.permissions` из store, скрывает пункты меню с `none`
- Доступные разрешения: `backlog_dmb`, `backlog_team`, `reports`, `analytics`, `customer`, `settings`, `admin`

---

## 5. База данных — нормализованная схема

### 5.1 Все таблицы (22 шт.)

**Справочники (8):** channels, deadlines, departments, priorities, statuses, task_types, team_types, project_statuses

**Основные (5):** teams, roles, users, projects, tasks

**История и аудит (2):** task_history, audit_log

**Уведомления (2):** notifications, notification_templates

**Отчёты (1):** reports

**Словари (1):** dictionary_items

**Связи (3):** tags, issue_tags, project_tags

### 5.2 Внешние ключи (ключевые)

```
tasks.team_id           → teams.id
tasks.channel_id        → channels.id
tasks.department_id     → departments.id
tasks.project_id        → projects.id
tasks.task_type_id      → task_types.id
tasks.priority_id       → priorities.id
tasks.status_id         → statuses.id
tasks.deadline_id       → deadlines.id
tasks.deadline_po_id    → deadlines.id
tasks.owner_id          → users.id
tasks.responsible_po_id → users.id
tasks.business_analyst_id → users.id
tasks.it_product_lead_id  → users.id
tasks.created_by        → users.id
teams.team_type_id      → team_types.id
users.team_id           → teams.id
users.role_id           → roles.id
projects.status_id      → project_statuses.id
projects.responsible_pl → users.id
task_history.task_id    → tasks.id
task_history.changed_by → users.id
notifications.user_id   → users.id
notifications.task_id   → tasks.id
issue_tags.issue_id     → tasks.id
issue_tags.tag_id       → tags.id
project_tags.project_id → projects.id
project_tags.tag_id     → tags.id
```

---

## 6. Версионирование и аудит

- **task_history** — каждое изменение поля задачи фиксируется (task_id, changed_by, changed_at, field_name, old_value, new_value)
- **audit_log** — все write-операции (user_id, action, entity_type, entity_id, details, ip_address)
- **Мягкое удаление** — задачи (is_deleted), справочники (is_active)

---

## 7. Seed-данные

При первом запуске (пустая БД):
- 6 ролей, 10 команд, 18 пользователей
- 44 задачи с полным набором атрибутов
- 56 записей справочников (dictionary_items)
- Нормализованные таблицы (channels, deadlines, departments и др.)
- 4 стандартных отчёта

При повторных запусках:
- `seed_dict_always()` — добавляет отсутствующие записи справочников (upsert по dict_type+code)
- `seed_initial_data()` — пропускается (User.count > 0)

---

## 8. C4-диаграммы

### 8.1 Контекст системы (Level 1)

```
┌────────────────────────────────────────────────────────────────────┐
│                      DMB Backlog System                            │
│                                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │    Tribe     │  │  PO / PL /   │  │   Business   │             │
│  │    Leader    │  │   BA / IT PL │  │   Customer   │             │
│  │  (стратег)   │  │  (команда)   │  │  (заказчик)  │             │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘             │
│         │                 │                 │                      │
│         └─────────────────┼─────────────────┘                      │
│                           │                                         │
│                    ┌──────▼──────┐                                  │
│                    │     SPA    │                                  │
│                    │  Frontend   │                                  │
│                    │ (Browser)   │                                  │
│                    └──────┬──────┘                                  │
│                           │ HTTP/JSON                              │
│                    ┌──────▼──────┐                                  │
│                    │   FastAPI   │    ┌──────────────┐             │
│                    │   Backend   │◄──►│   Database   │             │
│                    │             │    │  (SQLite/    │             │
│                    │             │    │  PostgreSQL) │             │
│                    └─────────────┘    └──────────────┘             │
│                                                                    │
│  Внешние системы:                                                  │
│    ┌──────────────────┐                                            │
│    │ Jira (ссылки)    │  ─── ─── ─── ───  (не интегрировано,     │
│    └──────────────────┘                   только ссылки)          │
└────────────────────────────────────────────────────────────────────┘
```

**Акторы:**
- **Tribe Leader** — стратегическое управление, аналитика, просмотр всех команд
- **PO/PL/BA/IT PL** — операционное управление задачами своей команды
- **Business Customer** — создание и отслеживание своих задач
- **Administrator** — управление системой (пользователи, роли, справочники)

### 8.2 Контейнеры (Level 2)

```
┌──────────────────────────────────────────────────────────────────┐
│                    DMB Backlog — Container Diagram               │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐      │
│  │                 Frontend (SPA)                        │      │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │      │
│  │  │  Router  │  │  Store   │  │    API Client    │   │      │
│  │  │ (hash)   │  │ (pub/sub)│  │ (fetch + JWT)    │   │      │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │      │
│  │                                                      │      │
│  │  ┌──────────────────────────────────────────────┐   │      │
│  │  │        Page Components (16 шт.)              │   │      │
│  │  │  dashboard  taskTable  kanbanBoard  modal    │   │      │
│  │  │  analytics  reports    admin  notifications  │   │      │
│  │  │  customerPortal  settings  teamBacklog ...   │   │      │
│  │  └──────────────────────────────────────────────┘   │      │
│  └──────────────────────┬───────────────────────────────┘      │
│                         │ REST API /api/v1/*                   │
│  ┌──────────────────────▼───────────────────────────────┐      │
│  │                 Backend (FastAPI)                     │      │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │      │
│  │  │ Routers  │  │Middleware│  │  Auth (JWT +     │   │      │
│  │  │ (8 шт.)  │  │Log+Audit │  │  bcrypt)         │   │      │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │      │
│  │  ┌──────────────────────────────────────────────┐   │      │
│  │  │           SQLAlchemy ORM (22 models)         │   │      │
│  │  └──────────────────┬───────────────────────────┘   │      │
│  └─────────────────────┼───────────────────────────────┘      │
│                        │                                      │
│  ┌─────────────────────▼───────────────────────────────┐      │
│  │              Database (SQLite / PostgreSQL)          │      │
│  │    22 tables, нормализованная схема (3NF)           │      │
│  │    Auto-migration: ensure_schema()                  │      │
│  └─────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────┘
```

### 8.3 Компоненты (Level 3)

**Backend компоненты:**

| Компонент | Файл | Назначение | Зависимости |
|-----------|------|-----------|-------------|
| Auth Router | `routers/auth_router.py` | Login, refresh, logout, me | auth.py, User |
| Tasks Router | `routers/tasks_router.py` | CRUD задач, отчёты, аналитика, bulk | models, schemas, auth |
| Teams Router | `routers/teams_router.py` | CRUD команд | models, auth |
| Users Router | `routers/users_router.py` | CRUD пользователей | models, auth |
| Reports Router | `routers/reports_router.py` | CRUD отчётов | models, auth |
| Admin Router | `routers/admin_router.py` | Роли, команды, пользователи, справочники, проекты | models, schemas, auth |
| Customer Router | `routers/customer_router.py` | Портал заказчика | models, schemas, auth |
| Express Router | `routers/express_router.py` | Экспресс-оценка (эпики, истории) | models, schemas, auth |
| Config | `config.py` | Pydantic Settings, переменные окружения | python-dotenv |
| Database | `database.py` | Engine, SessionLocal, ensure_schema() | SQLAlchemy |
| Auth | `auth.py` | JWT, bcrypt, проверка прав | python-jose, passlib |
| Middleware | `middleware.py` | Logging + Audit middleware | FastAPI |
| Seed | `seed.py` | Инициализация данных | models |

**Frontend компоненты:**

| Компонент | Файл | Назначение |
|-----------|------|-----------|
| app.js | Инициализация | Router, Store, API, Auth, sidebar, navbar |
| router.js | Роутер | Hash-based routing, lazy loading |
| api.js | HTTP-клиент | Fetch + JWT + auto-refresh |
| auth.js | Аутентификация | Login, logout, token management |
| store.js | Состояние | Pub/sub state management |
| sidebar.js | Навигация | Меню, проверка прав |
| navbar.js | Верхняя панель | Breadcrumbs, поиск, logout |
| dashboard.js | Главная | KPI, прогресс-бар, графики |
| taskTable.js | Бэклог DMB | Таблица/карточки задач |
| teamBacklog.js | Бэклог команды | Таблица + bulk-операции |
| kanbanBoard.js | Канбан | 13 колонок, drag-and-drop |
| modal.js | Карточка задачи | Просмотр/редактирование |
| filterToolbar.js | Тулбар | Поиск, фильтры, сортировка |
| analytics.js | Аналитика | Chart.js графики |
| reports.js | Отчёты | Статус-отчёты |
| notifications.js | Уведомления | Системные + авто-уведомления |
| settings.js | Настройки | Тема, цвет, компактность |
| admin.js | Администрирование | CRUD пользователи/роли/команды |

### 8.4 Код (Level 4) — ключевые модули

**Модели SQLAlchemy (models.py):**
- `Task` — центральная модель (~50 атрибутов), FK к 10 справочным таблицам
- `Team` — команда с руководителями (PL, PO, CL, IT PL)
- `User` — пользователь с правами и ролью
- `Role` — роли с правами доступа к 7 разделам
- `Epic` / `Story` — иерархия декомпозиции задачи
- `TaskHistory` / `AuditLog` — аудит изменений

**Ключевые функции:**
- `auth.py:check_permission()` — иерархическая проверка прав (0-3)
- `database.py:ensure_schema()` — автомиграция колонок
- `routers/tasks_router.py:task_to_response()` — преобразование ORM в Pydantic + расчёт C/V
- `routers/tasks_router.py:get_task_stats()` — агрегация статистики
- `routers/admin_router.py:get_dict_items()` — универсальный CRUD справочников

---

## 9. Безопасность

### 9.1 Аутентификация

- **JWT (JSON Web Token)**: алгоритм HS256, access token (60 мин), refresh token (7 дней)
- **Пароли**: bcrypt (через passlib CryptContext), никогда не хранятся в plain text
- **HTTP Bearer Token**: все защищённые эндпоинты требуют `Authorization: Bearer <token>`
- **Авто-refresh**: при 401 клиент (api.js) автоматически пытается обновить токен через `/auth/refresh`
- **Rate Limiting**: login — 5 запросов/мин, refresh — 10 запросов/мин (in-memory на уровне приложения)

### 9.2 Авторизация

Ролевая модель (6 ролей) с правами на 7 разделов:
- Проверка через `require_permission(permission, level)` — dependency FastAPI
- Иерархия уровней: none(0) → read(1) → write(2) → write_all(3)
- Индивидуальные права: `can_edit`, `can_delete`, `can_export`
- На фронтенде: `sidebar.js:initSidebar()` скрывает недоступные пункты меню

### 9.3 Защита от атак

| Мера | Реализация |
|------|-----------|
| **CORS** | `CORSMiddleware` с настройкой `allow_origins` из `.env` |
| **SQL-инъекции** | SQLAlchemy ORM — параметризованные запросы (no raw SQL) |
| **XSS** | Content-Type: JSON (не HTML), авто-экранирование шаблонов (template literals) |
| **CSRF** | JWT в заголовке Authorization (не cookie), SameSite политика |
| **Validation** | Pydantic схемы с Type Hints, Field validation (min/max length, regex) |
| **Brute-force** | Rate limiting на /login и /refresh |
| **Sensitive data** | Пароли в bcrypt, JWT не содержит sensitive data |

### 9.4 Безопасность на уровне кода

- `get_current_user()` — каждая защищённая ручка проверяет токен
- `check_permission()` — каждая операция проверяет права
- `update_role()` — защита от само-лишения admin_access
- `delete_team()` — проверка на связанные пользователи/задачи
- Мягкое удаление (`is_deleted`) — данные не теряются физически
- `audit_log` — все write-операции логируются с IP-адресом

---

## 10. Деплоймент и окружения

### 10.1 Требования к окружению

| Компонент | Разработка (dev) | Тестирование (staging) | Продуктив (production) |
|-----------|-----------------|----------------------|----------------------|
| Python | 3.11+ | 3.11+ | 3.12+ |
| Database | SQLite (файл) | PostgreSQL 15+ | PostgreSQL 15+ |
| OS | Windows/Mac/Linux | Linux (Ubuntu 22.04) | Linux (Ubuntu 22.04) |
| Server | uvicorn (dev) | uvicorn + gunicorn | uvicorn + gunicorn + nginx |
| Frontend | Встроен в backend | nginx | nginx |

### 10.2 Переменные окружения

| Переменная | Назначение | Пример |
|-----------|-----------|--------|
| `DATABASE_URL` | URL подключения к БД | `sqlite:///./dmb_backlog.db` или `postgresql://user:pass@host/db` |
| `SECRET_KEY` | Ключ подписи JWT (изменить в production) | `your-secret-key-change-in-production` |
| `ALGORITHM` | Алгоритм JWT | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Время жизни access token | `60` |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Время жизни refresh token | `7` |
| `CORS_ORIGINS` | Разрешённые CORS-источники | `["http://localhost:5500"]` |
| `APP_NAME` | Название приложения | `DMB Backlog` |
| `APP_VERSION` | Версия приложения | `1.0.0` |
| `DEBUG` | Режим отладки | `True` |

### 10.3 Процесс сборки и развертывания

**Dev окружение:**
```bash
cd dmb-backlog
pip install -r requirements.txt
cd backend
uvicorn main:app --reload --port 8000
```
Фронтенд доступен по `http://localhost:8000` (встроен в FastAPI).

**Production (Linux):**
```bash
# 1. Установка зависимостей
pip install -r requirements.txt

# 2. Настройка .env
cp .env.example .env
# редактировать DATABASE_URL, SECRET_KEY, CORS_ORIGINS

# 3. Запуск через gunicorn + uvicorn
gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:8000

# 4. Nginx reverse proxy
# /etc/nginx/sites-available/dmb-backlog
server {
    listen 80;
    server_name backlog.dmb.ru;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 10.4 Docker

Dockerfile (рекомендуемый):
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## 11. Мониторинг и логирование

### 11.1 Логирование

- **LoggingMiddleware**: JSON-логи всех HTTP-запросов (метод, путь, статус, длительность, IP)
- **Файловые логи**: `backend/logs/` — ротация по дням
- **stdout**: одновременно вывод в консоль (для Docker/k8s)
- **Audit Log**: `audit_log` таблица БД для compliance

Формат лога:
```json
{
  "timestamp": "2026-06-29T10:00:00Z",
  "method": "GET",
  "path": "/api/v1/tasks",
  "status": 200,
  "duration_ms": 45,
  "ip": "192.168.1.1"
}
```

### 11.2 Метрики (планируемые)

| Метрика | Источник | Назначение |
|---------|----------|-----------|
| RPS | Nginx/uvicorn | Нагрузка на систему |
| P95 latency | API-логи | Производительность |
| Error rate (4xx/5xx) | API-логи | Качество работы |
| DB query time | SQLAlchemy (планируется) | Производительность БД |
| Active users | `GET /auth/me` | Активность пользователей |
| Tasks by status | `GET /tasks/stats` | Health портфеля |

### 11.3 Алерты (рекомендуемые)

- **Error rate > 5%** за 5 мин — проблема в backend
- **P95 latency > 2 сек** — деградация производительности
- **DB connection pool exhausted** — утечка соединений
- **Disk space < 10%** — заполнение диска (SQLite файл)

---

## 12. Масштабирование

### 12.1 Текущие ограничения

| Компонент | Узкое место | Почему |
|-----------|------------|--------|
| SQLite | Однопользовательский доступ | SQLite не поддерживает конкурентные записи |
| Клиентская фильтрация | ~500 задач загружаются целиком | При росте > 2000 задач latency увеличится |
| In-memory rate limiter | Сбрасывается при рестарте | Не подходит для multi-instance |
| Vanilla JS SPA | Нет code splitting | Весь JS загружается при старте |

### 12.2 Стратегия масштабирования

**Горизонтальное масштабирование (бэкенд):**
- Переход на PostgreSQL — конкурентный доступ, репликация read-only
- Gunicorn с несколькими workers (4+)
- При необходимости — несколько инстансов за nginx load balancer

**База данных:**
- PostgreSQL с read replicas для отчётов и аналитики
- Индексы для частых запросов (см. DATA_MODEL.md → Индексы и оптимизация)
- Partitioning по дате для `task_history` и `audit_log` при росте > 1M записей

**Фронтенд:**
- Серверная пагинация (уже реализована: page/per_page)
- Lazy loading компонентов роутером (уже реализовано: dynamic imports)
- Code splitting при росте JS-бандла

**Кеширование:**
- Redis для session store (если потребуется)
- Кеш частых запросов (GET /tasks/stats, GET /tasks/analytics)
- Кеширование справочников на фронтенде

**Rate Limiting:**
- Переход на Redis-based rate limiter для multi-instance
- Настройка rate limiting на уровне Nginx

### 12.3 Capacity Planning (ориентировочно)

| Метрика | Текущая | Target (год) |
|---------|---------|-------------|
| Задачи | ~150 | ~2000 |
| Пользователи | ~18 | ~100 |
| Команды | ~10 | ~20 |
| API RPS | < 10 | ~100 |
| Размер БД | < 10 MB | ~1 GB |
