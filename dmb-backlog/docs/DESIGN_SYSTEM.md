# Дизайн-система DMB Backlog

**Версия:** 3.0  
**Дата:** 2026-06-29

---

## 1. Философия дизайна
- **Enterprise-grade**: строгий, профессиональный интерфейс
- **Data-dense**: компактное отображение информации с возможностью расширения
- **Dark-first**: тёмная тема по умолчанию (следует за системой)
- **Accent-color driven**: акцентный цвет настраивается пользователем (10 вариантов)

## 2. Цветовая палитра

### 2.1 Нейтральные (основа)
```css
--bg-primary: #0f0f23;      /* Основной фон */
--bg-secondary: #1a1a2e;    /* Карточки, сайдбар */
--bg-tertiary: #16213e;     /* Элементы внутри карточек */
--bg-elevated: #232342;    /* Модальные окна, dropdown */
--border-color: #2a2a4a;   /* Границы */
--border-hover: #3a3a5a;   /* Границы при hover */

--text-primary: #ffffff;    /* Основной текст */
--text-secondary: #a0a0b0; /* Второстепенный */
--text-muted: #6b6b80;    /* Placeholder, disabled */
--text-inverse: #0f0f23;  /* Текст на светлом фоне */
```

### 2.2 Акцентные цвета (выбираются пользователем)

| Цвет | Код | Переменная |
|------|-----|-----------|
| Индиго (default) | `#6366f1` | `--accent` |
| Изумруд | `#10b981` | `--accent-emerald` |
| Янтарь | `#f59e0b` | `--accent-amber` |
| Роза | `#f43f5e` | `--accent-rose` |
| Небо | `#0ea5e9` | `--accent-sky` |
| Фиолет | `#8b5cf6` | `--accent-violet` |
| Циан | `#06b6d4` | `--accent-cyan` |
| Оранж | `#f97316` | `--accent-orange` |
| Бирюза | `#14b8a6` | `--accent-teal` |
| Пурпур | `#a855f7` | `--accent-purple` |

### 2.3 Семантические цвета
```css
--success: #10b981;
--warning: #f59e0b;
--danger: #ef4444;
--info: #3b82f6;

--priority-high: #ef4444;
--priority-medium: #f59e0b;
--priority-low: #6b7280;
```

### 2.4 Цвета статусов (8 шт.)
```css
/* Этапы выполнения */
--status-requirements: #6366f1;   /* Сбор требований */
--status-estimate: #8b5cf6;       /* Экспресс-оценка */
--status-decision: #f59e0b;       /* Принятие решения */
--status-progress: #10b981;       /* В работе */

/* Финальные статусы */
--status-done: #22c55e;           /* Выполнена */
--status-rejected: #ef4444;       /* Отклонена */
--status-irrelevant: #94a3b8;     /* Не актуальна */
--status-hold: #f43f5e;          /* Холд */
```

## 3. Типографика

### 3.1 Шрифт
```css
--font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

### 3.2 Размеры
```css
--text-xs: 0.75rem;    /* 12px */
--text-sm: 0.875rem;   /* 14px */
--text-base: 1rem;     /* 16px */
--text-lg: 1.125rem;   /* 18px */
--text-xl: 1.25rem;    /* 20px */
--text-2xl: 1.5rem;    /* 24px */
--text-3xl: 1.875rem;  /* 30px */
```

### 3.3 Веса
```css
--font-normal: 400;
--font-medium: 500;
--font-semibold: 600;
--font-bold: 700;
```

## 4. Отступы и размеры (Spacing Scale)
```css
--space-1: 0.25rem;  /* 4px */
--space-2: 0.5rem;   /* 8px */
--space-3: 0.75rem;  /* 12px */
--space-4: 1rem;     /* 16px */
--space-5: 1.25rem;  /* 20px */
--space-6: 1.5rem;   /* 24px */
--space-8: 2rem;     /* 32px */
--space-10: 2.5rem;  /* 40px */
--space-12: 3rem;    /* 48px */
--space-16: 4rem;    /* 64px */
```

## 5. Компоненты

### 5.0 Sticky Toolbar и заголовок таблицы
```css
/* Тулбар */
.sticky-toolbar {
    position: sticky;
    top: var(--navbar-height);
    z-index: 25;
    padding-top: var(--space-1);
    padding-bottom: var(--space-3);  /* непрозрачный зазор */
    background: var(--bg-primary);
}

/* Заголовок таблицы */
.table-container thead,
.table-container th {
    position: sticky;
    top: var(--sticky-thead-offset);  /* вычисляется JS */
    z-index: 20;
    background: var(--bg-tertiary);
}
```

**Условия работы `position: sticky`:**
- `html { overflow: auto scroll }` — viewport единственный scroll container
- `body { overflow: visible }` — body НЕ scroll container
- Ни один ancestor sticky-элемента не должен иметь `overflow: auto/scroll/clip`

**`--sticky-thead-offset`** устанавливается через `updateStickyOffsets()` в `filterToolbar.js`:
```
--sticky-thead-offset = --navbar-height + toolbar.offsetHeight
```

### 5.1 Кнопки
```css
.btn-primary {
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 20px;
}

.btn-danger {
  background: var(--danger);
  color: white;
}

.btn-sm { padding: 6px 12px; font-size: var(--text-sm); }
.btn-lg { padding: 14px 28px; font-size: var(--text-lg); }
```

### 5.2 Карточки
```css
.card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: var(--space-6);
}

.card-hover:hover {
  border-color: var(--accent);
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
}
```

### 5.3 Таблицы
```css
.table { width: 100%; border-collapse: collapse; }
.table th {
  background: var(--bg-tertiary);
  padding: 12px 16px; text-align: left; font-weight: 500;
  color: var(--text-secondary); font-size: var(--text-sm);
  border-bottom: 1px solid var(--border-color);
}
.table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
}
.table tr:hover { background: var(--bg-tertiary); }
```

### 5.4 Бейджи
```css
.badge {
  display: inline-flex; align-items: center;
  padding: 2px 8px; border-radius: 9999px;
  font-size: var(--text-xs); font-weight: 500;
}
.badge-high { background: rgba(239,68,68,0.15); color: var(--priority-high); }
.badge-medium { background: rgba(245,158,11,0.15); color: var(--priority-medium); }
.badge-low { background: rgba(107,114,128,0.15); color: var(--priority-low); }
```

### 5.5 Инпуты
```css
.input {
  width: 100%; background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 8px; padding: 10px 14px;
  color: var(--text-primary); font-size: var(--text-sm);
}
.input:focus {
  outline: none; border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-light);
}
```

### 5.6 Модальные окна
```css
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  z-index: var(--z-modal-backdrop);
}
.modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-xl);
  max-width: 600px; width: 90%; max-height: 85vh;
  overflow-y: auto;
}

/* Развёрнутая карточка задачи — flexbox со sticky header/footer */
.modal.modal-lg { max-width: 800px; }
#task-detail-modal {
  display: flex; flex-direction: column;
  max-height: 85vh; overflow: hidden;
}
#task-detail-modal > div:first-child { flex-shrink: 0; }  /* sticky header */
#modal-body-content { flex: 1; overflow-y: auto; }         /* scrollable body */
#task-detail-modal > div:last-child { flex-shrink: 0; }    /* sticky footer */
```

## 5.7 Состояния компонентов

### 5.7.1 Кнопки

| Состояние | btn-primary | btn-secondary | btn-danger | btn-sm / btn-lg |
|-----------|-------------|---------------|------------|-----------------|
| **Default** | `background: var(--accent); color: white` | `background: transparent; color: var(--text-secondary); border: 1px solid var(--border-color)` | `background: var(--danger); color: white` | Соответствующие padding и font-size |
| **Hover** | `filter: brightness(1.1); transform: translateY(-1px)` | `border-color: var(--accent); color: var(--text-primary)` | `filter: brightness(1.1)` | Аналогично |
| **Focus** | `outline: 2px solid var(--accent); outline-offset: 2px` | `outline: 2px solid var(--accent)` | `outline: 2px solid var(--danger)` | Аналогично |
| **Active/Pressed** | `transform: translateY(0); filter: brightness(0.95)` | `transform: translateY(0)` | `transform: translateY(0)` | Аналогично |
| **Disabled** | `opacity: 0.5; cursor: not-allowed; pointer-events: none` | `opacity: 0.5; cursor: not-allowed` | `opacity: 0.5; cursor: not-allowed` | Аналогично |
| **Loading** | Спиннер вместо текста кнопки, `pointer-events: none` | Спиннер вместо текста | Спиннер вместо текста | Аналогично |
| **Error** | `border: 1px solid var(--danger); animation: shake 0.3s` | `border: 1px solid var(--danger)` | Не применимо | Аналогично |

### 5.7.2 Карточки (Card)

| Состояние | Внешний вид |
|-----------|------------|
| **Default** | `background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; padding: var(--space-6)` |
| **Hover** (`.card-hover`) | `border-color: var(--accent); box-shadow: 0 4px 20px rgba(0,0,0,0.3); cursor: pointer` |
| **Focus** | `outline: 2px solid var(--accent); outline-offset: 2px` |
| **Active/Pressed** | `transform: scale(0.98)` |
| **Disabled** | `opacity: 0.6; pointer-events: none` |
| **Loading** | Скелетон-контент внутри карточки (серые прямоугольники с анимацией pulse) |
| **Error** | `border-color: var(--danger)` + иконка ошибки в заголовке |

### 5.7.3 Таблицы

| Состояние | Внешний вид |
|-----------|------------|
| **Default** | `background: transparent; th: bg-tertiary; td: border-bottom` |
| **Hover (row)** | `background: var(--bg-tertiary); cursor: pointer` |
| **Focus (row)** | `outline: 2px solid var(--accent); outline-offset: -2px` |
| **Active (row)** | `background: var(--bg-elevated)` |
| **Loading** | 10 строк-скелетонов с анимацией pulse, тулбар disabled |
| **Empty** | Сообщение «Задачи не найдены» на всю ширину таблицы |
| **Error** | Сообщение «Ошибка загрузки» + кнопка «Повторить» |

### 5.7.4 Бейджи (Badge)

| Состояние | Внешний вид |
|-----------|------------|
| **Default** | `display: inline-flex; padding: 2px 8px; border-radius: 9999px; font-size: var(--text-xs)` |
| **Hover** | `filter: brightness(1.2)` |
| **Active** | `filter: brightness(0.9)` |
| **Disabled** | `opacity: 0.5` |

**Цветовые варианты:**
- `.badge-high` — красный (`--priority-high`)
- `.badge-medium` — жёлтый (`--priority-medium`)
- `.badge-low` — серый (`--priority-low`)
- `.badge-status` — динамический цвет из `--status-*`

### 5.7.5 Инпуты (Input/Select/Textarea)

| Состояние | Внешний вид |
|-----------|------------|
| **Default** | `background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px 14px; color: var(--text-primary)` |
| **Hover** | `border-color: var(--border-hover)` |
| **Focus** | `outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-light)` |
| **Active** | `border-color: var(--accent)` |
| **Disabled** | `opacity: 0.5; pointer-events: none; background: var(--bg-secondary)` |
| **Error** | `border-color: var(--danger); box-shadow: 0 0 0 3px rgba(239,68,68,0.15)` |
| **Loading** | Спиннер внутри инпута (справа) при асинхронной валидации |

### 5.7.6 Модальные окна

| Состояние | Внешний вид |
|-----------|------------|
| **Opening** | `@keyframes fadeIn` (overlay) + `@keyframes slideUp` (modal body), длительность 0.2s |
| **Default (open)** | `backdrop-filter: blur(4px); background: rgba(0,0,0,0.7); modal centered` |
| **Closing** | `@keyframes fadeOut` + `@keyframes slideDown`, opacity → 0, transform → translateY(20px) |
| **Loading** | Спиннер в заголовке модалки, тело пустое |
| **Error** | Тост-уведомление, модалка закрывается |
| **Fullscreen** (≤768px) | `width: 95%; max-height: 90vh` |

### 5.7.6a Модалка конфликта версий (conflict-modal--wide)

| Элемент | Внешний вид |
|---------|------------|
| **Overlay** | `.conflict-overlay`: `position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,0.5); backdrop-filter: blur(2px)` |
| **Модалка** | `.conflict-modal--wide`: `max-width: 680px; border-radius: 12px; padding: 28px 32px` |
| **Заголовок** | Иконка предупреждения (28×28, amber) + название + подзаголовок |
| **Версии** | `.conflict-versions`: жёлтый баннер с номерами версий |
| **Diff-таблица** | `.diff-table--selectable`: двухколоночный diff с radio-кнопками |
| **Radio-кнопки** | 2 колонки: «Сервер» / «Ваше». Акцентный цвет при выборе |
| **Подсветка** | Выбранная колонка: сервер — `background: #dcfce7; color: #166534`, ваше — `background: #dbeafe; color: #1e40af` |
| **Действия** | `.conflict-actions--row`: горизонтальный ряд 4 кнопок (primary / danger / secondary / ghost) |
| **Прокрутка** | `.conflict-diff-wrap`: `max-height: 360px; overflow-y: auto` |

### 5.7.7 Sidebar

| Состояние | Внешний вид |
|-----------|------------|
| **Default (expanded)** | `width: 260px; position: fixed; left: 0; top: 0; height: 100vh` |
| **Collapsed** | `width: 60px; .sidebar-label { display: none }` |
| **Hover (item)** | `background: var(--bg-tertiary); color: var(--text-primary)` |
| **Active (item)** | `background: var(--accent-light); color: var(--accent)` |
| **Mobile (≤768px)** | `transform: translateX(-100%); .open { transform: translateX(0) }` с backdrop |
| **Loading** | Скелетон-пункты меню (серые полосы) |

### 5.7.8 Тулбар (Toolbar)

| Состояние | Внешний вид |
|-----------|------------|
| **Default** | `sticky; top: var(--navbar-height); z-index: 25; background: var(--bg-primary)` |
| **Loading** | Все фильтры и кнопки disabled, спиннер вместо иконки поиска |
| **Filter active** | Активные фильтры подсвечены акцентным цветом, кнопка «Сбросить фильтры» видна |
| **Error** | Не применимо (тулбар всегда доступен) |

### 5.7.9 Навбар (Navbar)

| Состояние | Внешний вид |
|-----------|------------|
| **Default** | `height: var(--navbar-height); background: var(--bg-secondary); border-bottom: 1px solid var(--border-color)` |
| **Compact** | `height: 48px` (вместо 64px) |
| **Mobile (≤768px)** | Поиск скрыт, гамбургер виден |

### 5.7.10 Карточка задачи (Task Card)

| Состояние | Внешний вид |
|-----------|------------|
| **Default** | Компактная карточка: ID, название, статус, приоритет |
| **Hover** | `border-color: var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,0.2)` |
| **Dragging (канбан)** | `opacity: 0.5; transform: rotate(3deg)` |
| **Drag over** | Подсветка целевой колонки (акцентный border) |

### 5.7.11 Skeleton / Placeholder

| Тип | Внешний вид |
|-----|------------|
| **Text line** | `height: 14px; width: 100%; background: var(--bg-tertiary); border-radius: 4px; animation: pulse 1.5s infinite` |
| **Card** | Прямоугольник `height: 100px; border-radius: 12px; background: var(--bg-tertiary)` с pulse |
| **Circle/Avatar** | Круг `width: 40px; height: 40px; border-radius: 50%; background: var(--bg-tertiary)` с pulse |
| **Table row** | 5-6 серых полос разной ширины с pulse + 1 полоса для чекбокса |
| **Chart** | Прямоугольник размером графика с серым фоном и pulse |

```css
@keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.7; }
}
```

---

## 6. Layout

### 6.1 Sidebar
```css
.sidebar {
  width: 260px; background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  height: 100vh; position: fixed; left: 0; top: 0;
  display: flex; flex-direction: column;
  padding: var(--space-4);
  transition: width var(--transition-normal);
}
.sidebar.collapsed { width: 60px; }
.sidebar-item {
  display: flex; align-items: center; gap: var(--space-3);
  padding: 10px 14px; border-radius: 8px;
  color: var(--text-secondary);
  white-space: nowrap; overflow: hidden;
}
.sidebar-item:hover { background: var(--bg-tertiary); color: var(--text-primary); }
.sidebar-item.active { background: var(--accent-light); color: var(--accent); }
.sidebar.collapsed .sidebar-item { justify-content: center; padding: 10px 0; }
.sidebar.collapsed .sidebar-label { display: none; }
.sidebar-toggle { position: absolute; right: -12px; top: 20px; }
```

### 6.2 Main Content
```css
.main-content {
    flex: 1;
    padding: var(--space-8);
    width: max-content;
    min-width: 100%;
    background: var(--bg-primary);
}
```
**Пояснение**: `width: max-content; min-width: 100%` — контейнер как минимум на всю ширину родителя (`min-width: 100%`), но если дочерний контент (широкая таблица) требует больше — расширяется. Тулбар и таблица всегда одной ширины. Горизонтальный скролл при переполнении — на `html { overflow: auto scroll }`.

## 7. Иконки
- Lucide Icons (SVG, 20x20px по умолчанию)
- Цвет наследуется от текста

## 8. Анимации и переходы
```css
--transition-fast: 0.15s ease;
--transition-normal: 0.2s ease;
--transition-slow: 0.3s ease;
```

## 9. Responsive Breakpoints

```css
--bp-sm: 640px;
--bp-md: 768px;
--bp-lg: 1024px;
--bp-xl: 1280px;
```

### Поведение по брейкпоинтам

| Брейкпоинт | Sidebar | Navbar | Toolbar | Modal | Main Content |
|------------|---------|--------|---------|-------|-------------|
| >768px | Fixed, 260px | Полный | Все фильтры в ряд | Полная | padding: var(--space-8) |
| ≤768px | Overlay (translateX, гамбургер, backdrop) | Скрыть поиск | flex-wrap, select 100% | 95% ширины | padding: var(--space-4) |
| ≤480px | Overlay | — | — | — | padding: var(--space-3) |

### Sidebar overlay (≤768px)
```css
.sidebar {
    position: fixed;
    transform: translateX(-100%);
    z-index: 50;
    transition: transform var(--transition-normal);
}
.sidebar.open { transform: translateX(0); }
.sidebar-backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,0.5); display: none; }
@media (max-width: 768px) {
    .sidebar-backdrop { display: block; }
}
```

### Гамбургер
```css
.btn-hamburger {
    display: none;  /* скрыт на десктопе */
}
@media (max-width: 768px) {
    .btn-hamburger { display: flex; }
}
```

## 10. Компактный режим
При включении:
- Padding карточек уменьшается на 25%
- Размер шрифта таблиц уменьшается на 1px
- Отступы между элементами сокращаются
- Иконки уменьшаются до 16px

## 10.5 Виджеты дашборда (dashboard-grid-custom)
```css
.dashboard-grid-custom {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-5);
}
.widget {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    display: flex;
    flex-direction: column;
    min-height: 0;
}
.widget-colspan-2 { grid-column: span 2; }
.widget-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--border-color);
    flex-wrap: wrap; gap: var(--space-2);
}
.widget-body { padding: var(--space-4) var(--space-5); flex: 1; min-height: 0; overflow-y: auto; }

/* Quarter progress compact bar */
.dash-top-row { margin-bottom: var(--space-4); }
.dash-quarter-bar { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-4); background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-lg); }
.dash-quarter-bar-track { flex: 1; height: 6px; background: var(--bg-tertiary); border-radius: 999px; overflow: hidden; min-width: 80px; }
.dash-quarter-bar-fill { height: 100%; background: var(--accent); border-radius: 999px; transition: width 0.5s ease; }

/* Notification top banner */
.dash-notif-top { margin-bottom: var(--space-5); background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-lg); overflow: hidden; }
.dash-notif-top-header { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-4); font-size: var(--text-xs); font-weight: var(--font-semibold); border-bottom: 1px solid var(--border-color); background: var(--bg-hover); }
.dash-notif-top-items { display: flex; flex-wrap: wrap; }
.dash-notif-top-item { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-4); flex: 1 0 33.33%; min-width: 0; border-right: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color); }
.dash-notif-top-item:hover { background: var(--bg-hover); }

/* Compact team progress */
.tp-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-1-5) 0; border-bottom: 1px solid var(--border-color); }
.tp-name { flex: 0 0 90px; font-size: var(--text-xs); font-weight: var(--font-medium); }
.tp-bar { height: 4px; background: var(--bg-tertiary); border-radius: 999px; overflow: hidden; }
.tp-fill { height: 100%; border-radius: 999px; transition: width 0.4s ease; }
.tp-val { flex: 0 0 36px; text-align: right; font-size: var(--text-xs); font-weight: var(--font-semibold); }

/* Risk items */
.risk-item { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3); border-radius: var(--radius-md); cursor: pointer; }
.risk-item:hover { background: var(--bg-hover); }

/* Effort chart controls */
.effort-controls { display: flex; gap: var(--space-2); align-items: center; }
.effort-toggle-group { display: flex; gap: 2px; background: var(--bg-tertiary); border-radius: var(--radius-md); padding: 2px; }
.effort-toggle { padding: 3px 8px; font-size: 11px; border: none; border-radius: 5px; background: transparent; color: var(--text-muted); cursor: pointer; font-family: inherit; white-space: nowrap; }
.effort-toggle.active { background: var(--bg-elevated); color: var(--text-primary); font-weight: var(--font-semibold); box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
```

## 11. Темы
Пользователь может выбрать:
- **Тёмная тема** / **Светлая тема** / **Авто** (следует за системой)
- **10 акцентных цветов** (см. п.2.2)
- **Компактный режим** (вкл/выкл)

Настройки сохраняются в localStorage.

---

## 12. Микро-взаимодействия (анимации и переходы)

### 12.1 Переменные времени

```css
--transition-fast: 0.15s ease;
--transition-normal: 0.2s ease;
--transition-slow: 0.3s ease;
```

### 12.2 Анимации компонентов

| Компонент | Тип анимации | Длительность | Easing | Описание |
|-----------|-------------|--------------|--------|----------|
| **Модальное окно** | Fade + Slide Up | 0.2s | ease-out | Overlay: fade in; Modal body: translateY(20px) → 0 |
| **Sidebar collapse** | Width transition | 0.2s | ease | 260px ⟷ 60px с плавным изменением ширины |
| **Sidebar mobile** | TranslateX | 0.2s | ease | translateX(-100%) ⟷ 0 с backdrop fade |
| **Прогресс-бар** | Width transition | 0.5s | ease-out | Плавное изменение ширины fill |
| **Переключение вкладок** | Opacity + TranslateY | 0.15s | ease | Контент вкладки: opacity 0→1, translateY(5px)→0 |
| **Тост-уведомление** | Slide In + Fade Out | 0.3s in, 0.3s out | ease | SlideInRight (0.3s), задержка 3s, FadeOut (0.3s) |
| **Accordion/Collapse** | Max-Height transition | 0.25s | ease-in-out | max-height: 0 → 500px |
| **Sort arrow** | Rotate | 0.15s | ease | Стрелка сортировки поворачивается на 180° |
| **Drag-and-drop (канбан)** | Opacity + Scale | 0.15s | ease | Карточка: opacity 0.5, scale 1.05 при захвате |
| **Hover карточки** | Border-color + Shadow | 0.2s | ease | border-color и box-shadow плавно меняются |
| **Hover кнопки** | Brightness + TranslateY | 0.15s | ease | filter: brightness(1.1), transform: translateY(-1px) |
| **Скелетон (pulse)** | Opacity pulse | 1.5s | ease-in-out | opacity 0.4 ⟷ 0.7, бесконечно |
| **Dropdown меню** | Opacity + TranslateY | 0.15s | ease | translateY(-5px) → 0, opacity 0 → 1 |
| **Spinner** | Rotate | 0.8s | linear | Бесконечное вращение 360° |
| **Страница загрузки** | Content fade-in | 0.3s | ease | После завершения загрузки контент плавно появляется |

### 12.3 CSS-анимации (ключевые кадры)

```css
@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
}

@keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
}

@keyframes slideDown {
    from { transform: translateY(0); opacity: 1; }
    to { transform: translateY(20px); opacity: 0; }
}

@keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
}

@keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

@keyframes pulse {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 0.7; }
}
```

### 12.4 Z-index стратификация (гарантирует корректное наложение анимированных элементов)

```
10-20     — Контент (таблицы, карточки)
19-25     — Sticky элементы (тулбар 25, thead 20)
30        — Navbar (200)
40-50     — Sidebar overlay (backdrop 40, sidebar 50)
100       — Dropdown-меню
200       — Sticky-элементы навигации
300-400   — Модальные окна (backdrop 300, modal 400)
500       — Toast-уведомления
10000     — Модалка конфликта версий (z-index: 10000)
```

## 13. Conflict Resolution UI

### 13.1 Компоненты

| Компонент | Класс | Описание |
|-----------|-------|----------|
| Overlay | `.conflict-overlay` | Затемнённый фон модалки конфликта |
| Модалка | `.conflict-modal--wide` | Расширенная модалка (680px) с diff-таблицей |
| Diff-таблица | `.diff-table--selectable` | Таблица с radio-кнопками для выбора значений |
| Radio-ячейка | `.diff-radio-cell` | Ячейка с radio-кнопкой (28px) |
| Radio | `.diff-radio` | Радио-кнопка с accent-color |
| Строка diff | `.diff-row` | Строка таблицы с hover-эффектом |
| Обёртка таблицы | `.conflict-diff-wrap` | Контейнер с прокруткой (max-height: 360px) |
| Гorizontalный ряд | `.conflict-actions--row` | Ряд кнопок действий (flex-direction: row) |

### 13.2 Цвета выбора

| Выбор | Цвет фона | Цвет текста | Описание |
|-------|-----------|-------------|----------|
| Сервер (по умолчанию) | `#dcfce7` | `#166534` | Зелёный — серверное значение |
| Ваше | `#dbeafe` | `#1e40af` | Синий — ваше значение |
