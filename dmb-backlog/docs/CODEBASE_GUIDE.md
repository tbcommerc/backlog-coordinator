# Codebase Guide для LLM

Этот документ описывает архитектуру, конвенции и имплицитные знания, необходимые для корректной обработки запросов на доработку DMB Backlog.

---

## 1. Быстрый старт: структура проекта

```
dmb-backlog/
├── backend/                     # FastAPI (Python 3.11+)
│   ├── main.py                  # Точка входа, uvicorn
│   ├── config.py                # Pydantic Settings (DATABASE_URL, SECRET_KEY, CORS)
│   ├── database.py              # SQLAlchemy engine + SessionLocal
│   ├── models.py                # 22 ORM-моделей (нормализованная схема 3NF)
│   ├── schemas.py               # Pydantic схемы
│   ├── auth.py                  # JWT, bcrypt, проверка прав
│   ├── middleware.py            # Logging + Audit middleware
│   ├── seed.py                  # Сидирование (4 роли, 9 команд, 10+ юзеров, 40+ задач)
│   └── routers/
│       ├── auth_router.py       # /api/v1/auth
│       ├── tasks_router.py      # /api/v1/tasks (CRUD, фильтры, bulk, история, аналитика)
│       ├── teams_router.py      # /api/v1/teams
│       ├── users_router.py      # /api/v1/users
│       ├── reports_router.py    # /api/v1/reports
│       └── admin_router.py      # /api/v1/admin
├── frontend/
│   ├── index.html               # SPA entry point (Chart.js, Lucide, xlsx — локально)
│   ├── css/
│   │   ├── tokens.css           # CSS-переменные: цвета, тени, шрифты, отступы, z-index, брейкпоинты
│   │   ├── base.css             # Reset, html/body, .main-wrapper, .main-content, .page-header, responsive (sidebar overlay, hamburger, padding)
│   │   ├── components.css       # Все компоненты: sticky-toolbar, table, btn, badge, card, modal, sidebar, kanban, dropdown, notification, toast, navbar, responsive (toolbar wrap, navbar search, kanban scroll)
│   │   └── pages.css            # Стили специфичных страниц (grid layouts с медиа-запросами для dashboard, analytics, settings)
│   └── js/
│       ├── app.js               # Инициализация: Router, Store, API, Auth, sidebar (тоггл overlay), navbar (гамбургер), backdrop
│       ├── router.js            # Hash-роутер (12 маршрутов)
│       ├── api.js               # API-клиент: fetch + авто-refresh + обработка ошибок
│       ├── auth.js              # Auth класс
│       ├── store.js             # Pub/Sub Store
│       └── components/
│           ├── sidebar.js       # Сайдбар (коллапс, бейдж уведомлений)
│           ├── navbar.js        # Навбар (breadcrumb, глобальный поиск, logout)
│           ├── filterToolbar.js # Единый тулбар: фильтры, сортировка, поиск, column settings
│           ├── taskTable.js     # Бэклог DMB (таблица/карточки)
│           ├── teamBacklog.js   # Бэклог команды
│           ├── kanbanBoard.js   # Канбан-доска (8 колонок, drag-n-drop)
│           ├── modal.js         # Модалка задачи (просмотр/редактирование)
│           ├── reports.js       # Отчёты
│           ├── analytics.js     # Аналитика (Chart.js)
│           ├── notifications.js # Уведомления (экспорт buildNotifications/buildSystemNotifications)
│           ├── settings.js      # Настройки (тема, accent, compact)
│           ├── dashboard.js     # Дашборд (метрики, прогресс квартала, прогресс команд, топ рисков, уведомления, трудозатраты Chart.js)
│           └── admin.js         # Админка (CRUD teams/users/roles/dictionaries/notification-templates)
└── docs/
    ├── SYSTEM_SPEC.md           # Полная спецификация системы
    ├── ARCHITECTURE.md          # Архитектура (стек, схема, компоненты)
    ├── API_SPEC.md              # API-спецификация
    ├── DATA_MODEL.md            # Модели данных (ER-диаграмма)
    ├── DESIGN_SYSTEM.md         # Дизайн-система (цвета, типографика, компоненты)
    ├── PAGE_LOGIC.md            # Логика всех страниц
    └── CODEBASE_GUIDE.md        # ← текущий файл
```

### Важно: нет package.json
Frontend — vanilla JS без npm. Все библиотеки подключены локально в `index.html` через `<script>`:
- `js/lib/chart.min.js` — Chart.js 4.4.0
- `js/lib/lucide.min.js` — Lucide Icons 0.263.0
- `static/js/lib/xlsx.full.min.js` — Excel export

### Запуск
- Backend: `cd backend && uvicorn main:app --reload` (порт 8000)
- Frontend: статический сервер из `frontend/` (порт 5500)
- CORS в `.env` должен совпадать с портом фронта
- Seed данные при первом запуске (lifespan в main.py)

---

## 2. CSS-архитектура

### 2.1 Файлы (4 слоя)
1. **tokens.css** — только CSS-переменные (никаких селекторов)
2. **base.css** — глобальные сбросы, `html/body`, layout-классы (`.main-wrapper`, `.main-content`, `.page-header`)
3. **components.css** — все переиспользуемые компоненты (таблицы, кнопки, модалки, тулбар и т.д.)
4. **pages.css** — стили привязанные к конкретным страницам (dashboard, backlog, team-backlog, kanban и т.д.)

### 2.2 Система CSS-переменных (tokens.css)
- **Цвета**: `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--text-primary`, `--text-secondary`, `--text-muted`, `--border-color` и т.д.
- **Акцент**: `--accent` (меняется пользователем через 10 вариантов)
- **Тема**: тёмная/светлая переключается через класс `.light` на `html`, CSS-переменные меняются
- **Статусы**: 8 цветов для 8 статусов задач
- **Z-index**: `--z-dropdown: 100`, `--z-sticky: 200`, `--z-modal-backdrop: 300`, `--z-modal: 400`, `--z-toast: 500`
- **Отступы**: `--space-1`..`--space-16` (4px..64px)
- **Прочее**: `--navbar-height` (64px / 48px compact), `--sidebar-width` (260px / 60px collapsed), `--content-max-width` (1400px), `--radius-sm`/`--radius-lg`/`--radius-xl`

### 2.3 Sticky-механизм (ключевой паттерн)
```
html { overflow: auto scroll }
body { overflow: visible }
```

**Почему**: `position: sticky` работает только если ни один ancestor не является scroll container (т.е. не имеет `overflow: auto/scroll/clip`). `html { overflow: auto scroll }` делает viewport единственным scroll container, а `body { overflow: visible }` гарантирует что body не перехватывает скролл.

**Иерархия sticky:**
1. `.sticky-toolbar { position: sticky; top: var(--navbar-height); z-index: 25 }` — прилипает под navbar
2. `.table-container thead, .table-container th { position: sticky; top: var(--sticky-thead-offset); z-index: 20 }` — прилипает под тулбаром

**`--sticky-thead-offset`** вычисляется JS-функцией `updateStickyOffsets()` в `filterToolbar.js`:
```javascript
const navbarHeight = parseFloat(getComputedStyle(…).getPropertyValue('--navbar-height'));
const offset = navbarHeight + toolbar.offsetHeight;
```
Вызывается при каждом рендере таблицы и при любом изменении фильтров (через `apply()` внутри `initToolbar`).

**Зазор между тулбаром и thead**: обеспечивается `padding-bottom: var(--space-3)` на `.sticky-toolbar`. Псевдоэлементы или дополнительные элементы НЕ используются. Padding входит в `offsetHeight`, поэтому `--sticky-thead-offset` учитывает его, и thead прилипает сразу под нижней границей padding тулбара.

### 2.4 Ширина контента (`.main-content`)
```css
.main-content {
    flex: 1;
    padding: var(--space-8);
    width: max-content;
    min-width: 100%;
    background: var(--bg-primary);
}
```
`width: max-content; min-width: 100%` — контейнер растягивается под самый широкий дочерний элемент (таблицу). На обычных экранах ширина = 100% родителя. Когда таблица шире экрана, контейнер расширяется, и тулбар (внутри него) становится той же ширины. Горизонтальный скролл на `html` прокручивает их вместе.

**Важно:** в `flex-direction: column` на `.main-wrapper` свойство `flex: 1` на `.main-content` отвечает только за высоту (заполнение вертикального пространства). Ширина управляется `width: max-content; min-width: 100%`.

### 2.5 Таблицы
```css
.table-container {
    border: 1px solid var(--border-color);
    border-top: none;
    border-radius: 0 0 var(--radius-lg) var(--radius-lg);
    overflow: visible;          /* НЕ auto — иначе сломается position: sticky */
}

.table { width: 100%; border-collapse: collapse; }

.table th {
    position: sticky;
    top: var(--sticky-thead-offset);
    z-index: 20;
    background: var(--bg-tertiary);
    ...стили текста...
}

.table thead {
    position: sticky;
    top: var(--sticky-thead-offset);
    z-index: 20;
    background: var(--bg-tertiary);
}
```

### 2.6 Тулбар
```css
.sticky-toolbar {
    position: sticky;
    top: var(--navbar-height);
    z-index: 25;
    padding-top: var(--space-1);
    padding-bottom: var(--space-3);  /* непрозрачный зазор до thead */
    background: var(--bg-primary);
}
```

### 2.7 Responsive layout
- **Брейкпоинты** (tokens.css): `--bp-sm: 640px`, `--bp-md: 768px`, `--bp-lg: 1024px`, `--bp-xl: 1280px`
- **≤768px (мобильные/планшеты)**: sidebar переключается в overlay-режим — `position: fixed`, `transform: translateX(-100%)`, открывается по кнопке-гамбургеру. Добавляется полупрозрачный `.sidebar-backdrop`. Поиск в navbar скрывается (теряет `flex: 1`). Padding `.main-content` уменьшается до `var(--space-4)`.
- **≤480px (узкие экраны)**: padding `.main-content` ещё меньше (`var(--space-3)`).
- **Тулбар**: на малых экранах фильтры переносятся на следующую строку (`flex-wrap: wrap`), а `<select>` с меткой растягивается на всю ширину.
- **Модалки**: на ≤768px занимают 95% ширины.
- **Канбан**: на ≤768px получает горизонтальный скролл, колонки с `min-width: 260px`.

**Sidebar overlay CSS** (base.css):
```css
@media (max-width: 768px) {
    .sidebar {
        transform: translateX(-100%);
        z-index: 50;
        transition: transform var(--transition-normal);
    }
    .sidebar.open { transform: translateX(0); }
    .sidebar-backdrop { display: block; }  /* fixed, z-index: 40 */
}
```

**Гамбургер** (`components.css`): кнопка `.btn-hamburger` — `display: none` по умолчанию, `display: flex` при ≤768px. Добавлена в `navbar` в `renderAppShell()` (app.js). Тоггл класса `.open` на sidebar осуществляется по клику на гамбургер; закрытие — по клику на backdrop. При навигации (router.navigate) sidebar автоматически закрывается.

---

## 3. JS-архитектура

### 3.1 Модули (ES6)
Все компоненты — ES6 модули без фреймворков. Каждый файл экспортирует функции, возвращающие HTML-строки (template literals), и функции инициализации.

### 3.2 Ключевые зависимости между модулями
```
app.js
  ├── router.js
  ├── api.js
  ├── auth.js
  ├── store.js
  ├── sidebar.js
  ├── navbar.js
  └── page-components (вызываются через router)
       ├── dashboard.js ← notifications.js (buildNotifications, buildSystemNotifications)
       ├── taskTable.js ← filterToolbar.js
       ├── teamBacklog.js ← filterToolbar.js
       ├── kanbanBoard.js
       ├── reports.js
       ├── analytics.js
       ├── notifications.js (экспортирует buildNotifications, buildSystemNotifications)
       ├── settings.js
       └── admin.js
```

### 3.3 filterToolbar.js — центральный модуль
Используется taskTable.js и teamBacklog.js.

**Экспортируемые функции:**
- `renderToolbar(scope, opts)` — рендерит HTML тулбара
- `initToolbar(scope, allTasks, onFilterChange)` — инициализирует поиск, сортировку, фильтры; вызывает `apply()` при любом изменении
- `initToolbarControls(scope, opts)` — кнопки column settings, view toggle, export, refresh
- `getFilteredList(scope, allTasks)` — применяет все активные фильтры к массиву задач
- `resetToolbarFilters(scope)` — сброс всех фильтров
- `updateStickyOffsets()` — вычисляет `--sticky-thead-offset`

**Импорт в taskTable.js / teamBacklog.js:**
```javascript
import { renderToolbar, initToolbar, initToolbarControls, getFilteredList as ftFilteredList, resetToolbarFilters, updateStickyOffsets } from './filterToolbar.js';
```

**Вызов `updateStickyOffsets()`** происходит:
1. Внутри `apply()` в `initToolbar` — после каждой смены фильтра/сортировки/поиска
2. В `renderTableView()` / `renderTeamTableView()` — после рендера таблицы

### 3.4 router.js — hash-роутер

```javascript
const routes = {
    '/login': { guard: 'guest', load: () => import('./auth.js') },
    '/dashboard': { guard: 'auth', load: () => import('./components/dashboard.js') },
    '/backlog': { guard: 'auth', load: () => import('./components/taskTable.js') },
    // ... остальные маршруты
};
```

Гварды: `guest` (только без токена), `auth` (только с токеном), `'role:Admin,CL'` (только с ролью).

### 3.5 api.js — HTTP-клиент
- Автоматически добавляет `Authorization: Bearer`
- При 401: попытка refresh через `POST /api/v1/auth/refresh`
- Если refresh не удался — очистка токенов, redirect на `/login`
- Возвращает распарсенный JSON

### 3.6 store.js — Pub/Sub
```javascript
store.get(key)       // получить значение
store.set(key, val)  // установить и оповестить подписчиков
store.subscribe(key, fn)  // подписаться на изменения
```

### 3.7 kanbanBoard.js — Канбан-доска
- Импортирует и использует `renderTaskCard` из `modal.js` для рендеринга карточек (единый формат с Backlog/Team страницами)
- 8 колонок по статусам, drag-and-drop (HTML5 DnD API)
- Карточки получают `draggable="true"` программно после рендера
- CSS-переопределение `.kanban-column-body .task-card` для компактного отображения в узких колонках канбана
```

---

## 4. Типовые задачи и как их решать

### 4.1 Изменение sticky offset
Если тулбар меняет высоту (например, добавляется новая строка), нужно убедиться что `updateStickyOffsets()` вызывается после изменения. Она уже вызывается внутри `apply()` в `initToolbar` и после рендера таблицы, но если изменение происходит в другом месте — добавьте вызов.

### 4.2 Изменение структуры sticky-элементов
**Правило:** ни один ancestor sticky-элемента не должен иметь `overflow: auto/scroll/clip`. Если нужен горизонтальный скролл таблицы — используйте viewport (`html { overflow: auto scroll }`), а не внутренний контейнер. Если внутренний скролл необходим — `position: sticky` на thead работать не будет; придётся использовать JS-костыль (clone + position: fixed).

### 4.3 Компактный режим
В `tokens.css` при наличии `.compact` на `html`:
- `--navbar-height` меняется с 64px на 48px
- `updateStickyOffsets()` нужно вызвать заново

### 4.4 Смена темы / акцентного цвета
Тема: `localStorage.setItem('dmb_theme', 'dark|light|auto')`
Акцент: `localStorage.setItem('dmb_accent', colorName)` — значение из data-attribute `data-accent` на `html`
Компактность: `localStorage.setItem('dmb_compact', 'true|false')`

### 4.5 Добавление новой страницы
1. Создать компонент в `js/components/`
2. Добавить маршрут в `router.js`
3. Добавить стили в `pages.css`
4. Добавить пункт меню в `sidebar.js`
5. Если нужен тулбар — использовать `filterToolbar.js`

### 4.6 Добавление новой колонки в таблицу
1. Добавить поле в `models.py` (Backend)
2. Добавить в `schemas.py` (если нужно в API)
3. Добавить в `database/init.sql` (если используется SQL seed)
4. Добавить метку в `getColumnLabel()` и `getTeamColumnLabel()` (taskTable.js + teamBacklog.js)
5. Добавить в `columnSettings` по умолчанию
6. Если колонка сортируемая — добавить в массив `sortableCols`
7. Добавить рендер в `renderTableRow()` и `renderTeamTableRow()`

---

## 5. Implicit Conventions

### 5.1 Именование
- Файлы: `camelCase.js` для компонентов (кроме `app.js`, `router.js`, `api.js`, `auth.js`, `store.js`)
- Функции: `camelCase`, экспортируемые функции — `renderXxx`, `initXxx`, `getXxx`
- CSS-классы: `kebab-case`
- CSS-переменные: `--kebab-case`
- API-эндпоинты: `/api/v1/resource` + `/api/v1/resource/{id}`

### 5.2 Шаблонизация
Весь HTML генерируется через template literals (`` `${...}` ``). Никаких JSX, Handlebars, etc.
```javascript
function renderSomething(data) {
    return `
        <div class="card">
            <h3>${data.title}</h3>
        </div>
    `;
}
```

### 5.3 Обработка событий
Все слушатели добавляются через `addEventListener` (никаких `onclick` в HTML). Для делегирования используется `e.target.closest('.selector')`.

### 5.4 Стилизация
- `tokens.css` — только переменные
- Стили компонента — в `components.css`
- Стили страницы — в `pages.css`
- Inline-стили — только для динамических значений (ширина прогресс-бара, visibility)
- `!important` — запрещён (исключение: состояния `.sidebar.collapsed`)

### 5.5 Z-index стратификация
```
10-20     — контент (таблицы, карточки)
19-25     — sticky (тулбар 25, thead 20)
40-50     — sidebar overlay (backdrop 40, sidebar 50)
100       — dropdown
200       — sticky-элементы навигации (navbar)
300-400   — модальные окна (backdrop 300, modal 400)
500       — toast-уведомления
```

### 5.6 State management
- Токены: `localStorage.dmb_tokens`
- Настройки: `localStorage.dmb_*`
- Данные сессии: `window.app.store` (pub/sub)
- Адрес: hash-роутер (`window.location.hash`)

### 5.7 Фильтрация
- Все задачи загружаются одним запросом (`per_page=500` или `per_page=1000`)
- Фильтрация полностью клиентская (кроме страниц с серверным поиском типа /admin)
- `getFilteredList()` применяет: полнотекстовый поиск, column filters, сортировку

### 5.8 Права доступа
| Роль | Доступ |
|------|--------|
| Admin | Всё |
| CL (Competence Lead) | Все задачи, read/write |
| PL (Product Lead) | Все задачи, read/write |
| PO (Product Owner) | Своя команда, read/write |
| Developer | Своя команда, read-only |

---

## 6. Известные решения и их обоснование

| Решение | Причина |
|---------|---------|
| `html { overflow: auto scroll }`, `body { overflow: visible }` | `position: sticky` на thead ломается если предок — scroll container. Viewport — единственный scroll container. |
| `width: max-content; min-width: 100%` на `.main-content` | Тулбар и таблица всегда одной ширины. При широкой таблице `.main-content` расширяется, тулбар расширяется вместе с ним. |
| `padding-bottom` на тулбаре вместо `padding-top` на thead | Padding тулбара непрозрачен (bg-primary), padding thead мог быть прозрачным. |
| JS `updateStickyOffsets()` вместо CSS-переменной в статике | Высота тулбара динамическая (зависит от количества фильтров, compact-режима). |
| Все библиотеки локально, нет npm | Упрощение развёртывания, отсутствие внешних зависимостей при запуске. |
| Все фильтры на клиенте | ~500 задач загружаются за один запрос, фильтрация мгновенная без лишних API-вызовов. |
| Sidebar overlay при ≤768px (translateX), гамбургер, backdrop | Фиксированный sidebar на узких экранах закрывает контент; overlay с гамбургером — стандартный мобильный паттерн. |
| `transform: translateX` вместо `display: none/block` для sidebar | Анимация выезда/заезда плавная (transition), элемент всегда в DOM. |

---

## 7. Тестирование

### 7.1 Типы тестов

| Тип | Инструмент | Описание | Расположение |
|-----|-----------|----------|-------------|
| **Юнит-тесты** | pytest | Тестирование отдельных функций (auth, validation) | `backend/tests/test_*.py` |
| **Интеграционные тесты** | pytest + TestClient | Тестирование API-эндпоинтов с реальной БД | `backend/tests/test_*.py` |
| **End-to-end тесты** | — | Не реализованы (планируются) | — |
| **Нагрузочное тестирование** | — | Не реализовано | — |

### 7.2 Запуск тестов

```bash
# Все тесты
cd backend
pytest -v

# Конкретный файл
pytest tests/test_auth.py -v

# С детальным выводом
pytest -v --tb=short

# С coverage
pytest --cov=. --cov-report=term-missing
```

### 7.3 Настройка тестового окружения

- **conftest.py**: создаёт in-memory SQLite `test.db`, переопределяет `get_db` dependency
- **Фикстуры**: `db` (создание/удаление таблиц), `client` (TestClient), `auth_headers` (JWT + роль)
- **Scope**: function (каждый тест — чистая БД)

### 7.4 Структура тестов

**test_auth.py:**
- `test_health_check` — проверка health endpoint
- `test_login_success` — успешный вход с JWT
- `test_login_invalid_credentials` — неверный пароль → 401
- `test_me_requires_auth` — запрос без токена → 401
- `test_me_returns_user` — запрос с токеном → 200 + user data

**test_tasks.py:**
- `test_create_task` — создание задачи → 201
- `test_get_tasks` — список задач с пагинацией
- `test_get_task_by_id` — получение задачи по ID
- `test_update_task` — обновление задачи (title, status)
- `test_delete_task` — мягкое удаление → 200, затем 404
- `test_task_validation_title_too_long` — валидация длины → 422
- `test_task_validation_progress_range` — валидация диапазона → 422

### 7.5 Покрытие кода

- Целевой уровень: **не менее 70%** для backend
- Текущее покрытие: ~40% (только auth и tasks)
- Измерение: `pytest --cov=. --cov-report=html`

---

## 8. CI/CD

### 8.1 Текущий статус

CI/CD **не настроен**. Все изменения проходят ручное тестирование. Рекомендуется настроить следующий пайплайн:

### 8.2 Рекомендуемый CI-пайплайн (GitHub Actions)

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.12'
      - run: pip install -r backend/requirements.txt
      - run: pytest backend/tests/ -v
      - run: pytest --cov=backend --cov-report=term-missing
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.12'
      - run: pip install flake8
      - run: flake8 backend/
```

### 8.3 Этапы перед мержем (рекомендуемые)

1. **Линтинг**: flake8 (PEP8)
2. **Тип-чекер**: mypy (опционально)
3. **Юнит-тесты**: pytest
4. **Интеграционные тесты**: pytest с TestClient
5. **Code Review**: минимум 1 approval

### 8.4 Этапы деплоя (рекомендуемые)

1. **Dev**: после мержа в `develop` — авто-деплой на dev сервер
2. **Staging**: после тегов `v*` — деплой на staging
3. **Production**: после approval — деплой на production через ручной триггер

---

## 9. Обработка ошибок в коде

### 9.1 Исключения и их обработка

| Ситуация | Исключение | Обработка |
|----------|-----------|-----------|
| Неверный токен | `JWTError` (python-jose) | `decode_token()` возвращает None → 401 |
| Недостаточно прав | `HTTPException(403)` | `require_permission()` / `check_permission()` |
| Ресурс не найден | `HTTPException(404)` | `db.query().first()` проверка на None |
| Конфликт данных | `HTTPException(409)` | Проверка уникальности email/code |
| Ошибка валидации | `HTTPException(422)` | Pydantic schema validation |
| Ошибка БД | `SQLAlchemyError` | Не перехватывается → 500 |
| Rate limit | `HTTPException(429)` | `check_rate_limit()` в middleware |

### 9.2 Логирование ошибок

```python
# LoggingMiddleware — логи всех запросов
logger.info(f"{method} {path} - Status: {code} - Duration: {duration}ms")

# AuditMiddleware — все write-операции в audit_log
audit_entry = AuditLog(user_id=..., action=..., entity_type=..., ...)
db.add(audit_entry)

# Middleware не блокирует выполнение — ошибка логирования не влияет на ответ
```

### 9.3 Отказоустойчивость

| Механизм | Описание |
|----------|----------|
| **AuditMiddleware fallback** | Ошибка записи audit_log не прерывает основной запрос |
| **ensure_schema()** | Автомиграция колонок без потери данных |
| **Мягкое удаление** | `is_deleted = True` — данные всегда можно восстановить |
| **Task history** | Каждое изменение фиксируется, можно откатить |
| **Авто-refresh JWT** | При 401 клиент автоматически пробует refresh |

---

## 10. Глоссарий локальных терминов

### 10.1 Сокращения и аббревиатуры

| Термин | Расшифровка | Значение |
|--------|------------|----------|
| PO | Product Owner | Владелец продукта, ведёт бэклог команды |
| PL | Product Leader | Продуктовый лидер |
| IT PL | IT Product Lead | Технический лидер продукта |
| BA | Business Analyst | Бизнес-аналитик |
| CL | Cluster Lead | Руководитель кластера |
| ЛТ | Tribe Leader | Руководитель направления |
| DMB | Digital Merchant Banking | Подразделение цифрового банкинга |
| DOD | Definition of Done | Критерии готовности задачи |
| C/V | Cost/Value | Отношение эффекта к затратам |
| ICE | Impact, Confidence, Ease | Скоринговая метрика |
| SLA | Service Level Agreement | Соглашение об уровне сервиса |
| PIP | Point in Process | Контрольная точка процесса |
| SPA | Single Page Application | Одностраничное приложение |
| API | Application Programming Interface | Интерфейс программирования приложений |
| JWT | JSON Web Token | Токен аутентификации |
| ORM | Object-Relational Mapping | Объектно-реляционное отображение |
| CRUD | Create Read Update Delete | Операции создания/чтения/обновления/удаления |
| FK | Foreign Key | Внешний ключ |
| PK | Primary Key | Первичный ключ |
| 3NF | Third Normal Form | Третья нормальная форма |

### 10.2 Нейминговые конвенции

| Область | Конвенция | Примеры |
|---------|-----------|---------|
| **Python файлы** | snake_case | `tasks_router.py`, `database.py` |
| **JS файлы** | camelCase | `taskTable.js`, `filterToolbar.js` |
| **CSS файлы** | kebab-case | `tokens.css`, `components.css` |
| **Python классы (модели)** | PascalCase | `Task`, `TaskStatus`, `BusinessCustomer` |
| **Python функции** | snake_case | `check_permission()`, `get_password_hash()` |
| **JS функции** | camelCase | `renderToolbar()`, `initToolbar()` |
| **CSS классы** | kebab-case | `.sticky-toolbar`, `.btn-primary` |
| **CSS переменные** | --kebab-case | `--bg-primary`, `--text-secondary` |
| **API эндпоинты** | /api/v1/resource | `/api/v1/tasks`, `/api/v1/auth/login` |
| **Таблицы БД** | snake_case, plural | `tasks`, `statuses`, `audit_log` |
| **Колонки БД** | snake_case | `is_deleted`, `created_at`, `deadline_po_id` |

### 10.3 Специфическая терминология

| Термин | Значение в контексте проекта |
|--------|------------------------------|
| **Backlog DMB** | Полный список задач всего трайба DMB |
| **Backlog команды** | Задачи, отфильтрованные по команде пользователя |
| **Экспресс-оценка** | Процесс оценки трудозатрат по эпикам и историям |
| **Бизнес-заказчик** | Внешний пользователь, создающий задачи |
| **Директорат** | Отчёт для директорской оперативки (ВЫСОКИЙ приоритет) |
| **ДИД** | Департамент информационного развития — отчёт для ДИД |
| **What-If** | Анализ альтернативных сценариев для задачи |
| **Bulk-операции** | Массовые операции над группой задач (закрыть, холд, удалить) |
| **Sticky-механизмы** | Фиксация тулбара и заголовка таблицы при прокрутке |
| **Sidebar overlay** | Режим боковой панели на мобильных устройствах |
| **Hash-роутер** | Маршрутизация через hash (#) в URL |
| **Pub/Sub Store** | Паттерн publish/subscribe для управления состоянием |
| **Template literals** | JavaScript шаблонные строки для генерации HTML |
| **Debounce** | Задержка обработки (поиск 250ms, админка 300ms) |
