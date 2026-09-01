# DMB Backlog

Корпоративная система управления бэклогом задач для банковского подразделения DMB (Digital & Mobile Banking).
Обеспечивает централизованное управление задачами, канбан-доску, аналитику для руководителей, ролевой доступ и отчёты.

## Технологический стек

- **Backend**: Python 3.11+, FastAPI, SQLAlchemy 2.0, PostgreSQL 16 + Alembic
- **Frontend**: Vanilla JavaScript (ES6 modules), CSS Custom Properties (dark/light theme)
- **Auth**: JWT (HS256, access + refresh tokens), bcrypt
- **Библиотеки**: Chart.js 4.4.0 (локально), Lucide Icons 0.263.0 (локально)
- **Rate Limiting**: Redis в штатном runtime, process-local fallback только для разработки
- **Тестирование**: pytest + httpx

## Структура проекта

```
dmb-backlog/
├── backend/               # FastAPI приложение
│   ├── main.py            # Точка входа, lifespan, CORS, роутеры
│   ├── config.py          # Pydantic Settings (из .env)
│   ├── database.py        # SQLAlchemy engine и session
│   ├── alembic/           # production-миграции PostgreSQL
│   ├── models.py          # ORM-схема (45 таблиц metadata на 01.09.2026)
│   ├── schemas.py         # Pydantic схемы (request/response)
│   ├── auth.py            # JWT, password hashing, permission check
│   ├── middleware.py       # request ID, logging, audit и metrics middleware
│   ├── event_outbox.py     # transactional outbox → Redis Stream
│   ├── idempotency.py      # cross-worker идемпотентность
│   ├── telemetry.py        # OpenTelemetry tracing
│   ├── seed.py            # Инициализация тестовых данных
│   ├── requirements.txt
│   ├── routers/
│   │   ├── auth_router.py      # /api/v1/auth
│   │   ├── tasks_router.py     # /api/v1/tasks (CRUD, analytics, reports)
│   │   ├── teams_router.py     # /api/v1/teams
│   │   ├── users_router.py     # /api/v1/users
│   │   ├── reports_router.py   # /api/v1/reports
│   │   ├── reporting_meetings_router.py # календарь отчётных встреч
│   │   ├── prioritiser_router.py # вызов Task Prioritiser
│   │   ├── events_router.py    # авторизованный SSE
│   │   └── admin_router.py     # /api/v1/admin
│   └── logs/              # Файлы логов
├── frontend/              # SPA на ванильном JS
│   ├── index.html
│   ├── css/
│   │   ├── tokens.css     # CSS-переменные (цвета, отступы, шрифты)
│   │   ├── base.css       # Базовые стили, keyframes, сброс
│   │   ├── components.css # Общие компоненты (кнопки, карточки, модалки и т.д.)
│   │   └── pages.css      # Стили специфичных страниц (admin tabs и др.)
│   └── js/
│       ├── app.js         # Точка входа, App класс, инициализация
│       ├── api.js         # HTTP клиент (fetch + JWT)
│       ├── auth.js        # JWT helpers
│       ├── router.js      # Hash-based SPA роутер + breadcrumb
│       ├── store.js       # State manager (pub/sub)
│       ├── lib/           # Локальные библиотеки
│       │   ├── lucide.min.js
│       │   └── chart.min.js
│       └── components/    # Компоненты страниц
│           ├── sidebar.js      # Боковая панель (сворачиваемая)
│           ├── modal.js        # Развёрнутая карточка задачи, модалки
│           ├── filterToolbar.js# Единая панель фильтрации/сортировки
│           ├── taskTable.js    # Бэклог DMB (все задачи)
│           ├── teamBacklog.js  # Бэклог команды
│           ├── kanbanBoard.js  # Канбан-доска (drag & drop)
│           ├── dashboard.js    # Главная (метрики, прогресс команд, квартал, риски, трудозатраты)
│           ├── reports.js      # Статусы для встреч
│           ├── analytics.js    # Аналитика Tribe/PO-PL
│           ├── notifications.js# Уведомления (авто + системные, buildNotifications/buildSystemNotifications)
│           ├── admin.js        # Администрирование
│           ├── settings.js     # Настройки
│           └── navbar.js       # Навбар
├── docs/                  # Документация (v3.0)
│   ├── ARCHITECTURE.md    # Архитектура (C4, безопасность, деплой, мониторинг)
│   ├── API_SPEC.md        # API (OpenAPI, rate limiting, примеры ошибок)
│   ├── DATA_MODEL.md      # Модели данных (ER-диаграмма, индексы, сохранность)
│   ├── DESIGN_SYSTEM.md   # Дизайн-система (состояния компонентов, микро-взаимодействия)
│   ├── PAGE_LOGIC.md      # Логика страниц (состояния, сценарии, ошибки)
│   ├── SYSTEM_SPEC.md     # Системная спецификация (жизненный цикл, статусы, ошибки)
│   ├── BUSINESS_REQUIREMENTS.md  # Бизнес-требования (критерии приемки)
│   ├── CODEBASE_GUIDE.md  # Гайд по коду (тесты, CI/CD, глоссарий)
│   ├── DEPLOYMENT.md      # Развертывание (dev/staging/prod, Docker, Nginx)
│   ├── TESTING.md         # Тестирование (стратегия, план, примеры)
│   └── SECURITY.md        # Безопасность (auth, CORS, инфраструктура)
└── .env.example
```

## Быстрый старт

### 1. Клонирование и настройка

Откройте терминал в корне `dmb-backlog`.

### 2. Установка зависимостей

```bash
pip install -r backend/requirements.txt
```

### 3. Настройка окружения

Скопируйте корневой `.env.example` в корневой `.env` и при необходимости измените
настройки. Backend всегда читает этот файл независимо от текущего каталога.

PowerShell:

```powershell
Copy-Item .env.example .env
```

bash:

```bash
cp .env.example .env
```

Штатные значения PostgreSQL и Redis уже приведены в `.env.example`.

### 4. Запуск

Из корня репозитория:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1
```

Сценарий поднимает PostgreSQL, Redis, применяет Alembic, запускает AI-агента,
Task Prioritiser и backend. Автоматический seed защищённых данных выключен. Подробности находятся в
`docs/LOCAL_DEVELOPMENT.md`.

### 5. Доступ

- **Frontend**: http://localhost:8000/
- **API**: http://localhost:8000/api/v1/
- **Swagger**: http://localhost:8000/docs

### 6. Учётные записи

Штатный запуск не создаёт и не изменяет пользователей, роли, команды и
справочники. Доступы выдаются владельцем конкретного окружения; в документации
не фиксируются рабочие логины и пароли.

## API Endpoints (все под `/api/v1`)

| Prefix | Описание |
|--------|----------|
| `/auth` | Login, refresh, me, logout |
| `/tasks` | CRUD задач, поиск, статистика, отчёты, аналитика, bulk |
| `/teams` | CRUD команд |
| `/users` | CRUD пользователей |
| `/reports` | CRUD отчётов, выполнение |
| `/reporting-meetings` | Календарь и проведение отчётных встреч |
| `/notifications` | Уведомления и пользовательские настройки |
| `/events` | Авторизованный SSE поток инвалидаций |
| `/agent` | Proxy к AI Business Analyst и persisted requests |
| `/admin` | Управление ролями, командами, пользователями, справочниками, шаблонами уведомлений |

Полная спецификация: [docs/API_SPEC.md](docs/API_SPEC.md)

## Ролевая модель

Права задаются полями роли и object-level scope, а не только названием роли.
Точную матрицу определяют `backend/auth.py`, dependencies роутеров и security
tests; клиентское меню не является авторизацией.

Подробнее: [docs/SYSTEM_SPEC.md](docs/SYSTEM_SPEC.md)

## Документация

| Документ | Описание |
|----------|----------|
| [PROJECT_OVERVIEW_AS_IS.md](docs/PROJECT_OVERVIEW_AS_IS.md) | Актуальная карта фактически реализованной системы (As-Is) |
| [CODE_REVIEW_2026-08-19.md](docs/archive/reviews/CODE_REVIEW_2026-08-19.md) | Исторический аудит: ошибки, безопасность, недоделки и UX/UI на 19.08.2026 |
| [SYSTEM_SPEC.md](docs/SYSTEM_SPEC.md) | Системная спецификация: жизненный цикл, обработка ошибок, роли |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Архитектура: C4-диаграммы, безопасность, деплой, мониторинг |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Модели данных: ER-диаграмма, 20+ таблиц, индексы, сохранность |
| [API_SPEC.md](docs/API_SPEC.md) | API: OpenAPI, rate limiting, пагинация, примеры ошибок |
| [PAGE_LOGIC.md](docs/PAGE_LOGIC.md) | Логика страниц: состояния загрузки/ошибки/пусто, сценарии |
| [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | Дизайн-система: состояния компонентов, микро-взаимодействия |
| [STICKY_BACKLOG_TABLES.md](docs/STICKY_BACKLOG_TABLES.md) | Закрепление панелей и заголовков таблиц: инварианты, координаты, типовые поломки и чек-лист |
| [BUSINESS_REQUIREMENTS.md](docs/BUSINESS_REQUIREMENTS.md) | Бизнес-требования: функциональные/нагрузочные критерии приемки |
| [CODEBASE_GUIDE.md](docs/CODEBASE_GUIDE.md) | Гайд по коду: тестирование, CI/CD, обработка ошибок, глоссарий |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Развертывание: dev/staging/prod, Docker, Nginx, backup |
| [TESTING.md](docs/TESTING.md) | Тестирование: стратегия, план расширения, примеры |
| [SECURITY.md](docs/SECURITY.md) | Безопасность: JWT, CORS, XSS, rate limiting, процедуры |

## Статусы задач (13 состояний)

Каталог содержит 13 упорядоченных статусов, но backend не задаёт единую строгую
state machine для обычного обновления задачи. Актуальные коды и локальные
правила специализированных операций описаны в [docs/SYSTEM_SPEC.md](docs/SYSTEM_SPEC.md).

Подробная диаграмма переходов: [docs/SYSTEM_SPEC.md](docs/SYSTEM_SPEC.md)

## Основные функции

- **Dashboard** — ключевые метрики, прогресс квартала, прогресс команд, топ рисков, уведомления (сверху), трудозатраты по типам (кольцевая диаграмма с переключателями команда/трайб × квартал/сНГ)
- **Бэклог DMB** — все задачи платформы: таблица/карточки, единая панель фильтров (поиск 250ms debounce, сортировка, фильтры, column settings drag-and-drop)
- **Бэклог команды** — управление задачами своей команды, bulk-операции, открытие задачи в развёрнутой карточке
- **Канбан-доска** — drag & drop по статусам, клик по карточке → развёрнутая карточка задачи
- **Аналитика Tribe Leader** — CV-анализ, риски по командам, здоровье портфеля (5 графиков Chart.js)
- **Аналитика PO/PL** — загрузка команд, соблюдение сроков, дефицит атрибутов (4 графика Chart.js)
- **Отчёты** — стандартные (3 предустановленных) + дополнительные отчёты (directorate, did, projects, reg-directors)
- **Развёрнутая карточка задачи** — просмотр/редактирование, 4 тематические секции, sticky header + footer, кнопки «Редактировать»/«Сохранить»/«Отмена»
- **Уведомления** — 5 типов (overdue, effort, update, attrs, deadline) + 4 системных напоминания (заполнить статусы, подготовить отчёт, проверить дедлайны); табы «Все», «Просрочено», «Без оценки», «Обновления», «Атрибуты»; KPI-карточки кликабельны
- **Admin: шаблоны уведомлений** — CRUD шаблонов (name, text, recipients, deadline_days, repeat_frequency, repeat_day, is_active) на вкладке «Уведомления»
- **Полнотекстовый поиск** — по всем значимым полям (title, description, owner, status, team_name, project, business_customer)
- **Настройки** — тёмная/светлая тема, 10 акцентных цветов, компактный режим
- **Admin** — управление командами, пользователями, ролями, справочниками (вкладки icon-on-top)
- **Сворачиваемая боковая панель** — до иконок, состояние сохраняется в localStorage
- **Breadcrumb** — динамический, кликабельный, промежуточные сегменты
- **Аудит** — лог всех write-операций + история изменений задач

## Примечания по разработке

- `uvicorn --reload` отслеживает только `backend/`. После изменений JS-файлов требуется **Ctrl+Shift+R** (жёсткое обновление без кэша).
- Lucide Icons и Chart.js — локальные копии (не CDN). Версии: lucide 0.263.0, chart.js 4.4.0.
- Inter и Unbounded подключены локально из `frontend/fonts/`; OFL-лицензии хранятся рядом с файлами шрифтов.
- API возвращает задачи в формате `{ items: [...] }`.

## Изменение схемы базы данных

Целевую схему описывает `backend/models.py`, а поддерживаемую историю изменений —
`backend/alembic/versions/`. Любое изменение модели требует новой проверенной
Alembic-ревизии. `database.ensure_schema()` оставлен только для изолированной
SQLite-совместимости и не заменяет миграции PostgreSQL.

Подробнее: [docs/SCHEMA_CHANGES.md](docs/SCHEMA_CHANGES.md).

## Тесты

```bash
cd backend
pip install -r requirements-dev.txt
pytest tests/ -v
```

При push и pull request workflow `.github/workflows/quality.yml` автоматически
проверяет компиляцию и тесты backend, синтаксис и security unit tests frontend, а
также известные уязвимости Python-зависимостей. Startup seed, maintenance и scheduler
в CI явно отключены; используется только временная SQLite-база runner'а.
