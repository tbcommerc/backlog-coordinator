---
title: Дизайн-система DMB Backlog
scope: as-is
status: verified-index
last_verified: 2026-08-24
source_of_truth:
  - frontend/css/tokens.css
  - frontend/css/base.css
  - frontend/css/components.css
  - frontend/css/pages.css
  - frontend/css/responsive.css
  - frontend/js/components/
---

# Дизайн-система DMB Backlog

Фактическая дизайн-система реализована CSS и JS-компонентами. Этот документ объясняет структуру источников и устойчивые контракты, не копируя сотни значений, которые следует брать непосредственно из CSS.

## Источники

| Файл | Ответственность |
|---|---|
| `css/tokens.css` | цвета, типографика, spacing, radii, shadows, transitions, z-index, layout, accents, themes |
| `css/base.css` | reset и базовые элементы |
| `css/components.css` | переиспользуемые UI-компоненты |
| `css/pages.css` | стили конкретных страниц |
| `css/responsive.css` | responsive overrides |
| `css/analytics-lt.css` | специализированная аналитика |
| `css/fonts.css` | локальные шрифты |

При расхождении документа и CSS приоритет имеет CSS текущей ветки.

## Токены

`tokens.css` определяет:

- neutral/background, border и text colors;
- accent и semantic colors;
- typography scale и weights;
- spacing scale;
- radii, shadows и transitions;
- z-index levels;
- sidebar/navbar/layout размеры;
- 10 accent variants;
- compact mode;
- light theme overrides.

CSS custom properties с названиями breakpoint существуют как reference values, но CSS media queries не могут автоматически использовать custom property в условии. Фактические breakpoints нужно проверять в `responsive.css`.

## Темы и настройки

Настройки применяются через data attributes:

- `data-theme="light"` для светлой темы;
- `data-accent` для выбранного акцента;
- `data-compact="true"` для компактного режима.

Сохранение и применение настроек выполняет `components/settings.js` и код инициализации приложения.

## Компоненты

Реализованы классы и шаблоны для buttons, cards, tables, badges, forms, modals, toolbar, sidebar, navbar, notifications, state pages и специализированных страниц.

Единого независимого component package или Storybook нет. Контракт компонента определяется совокупностью CSS class, HTML template в JS и frontend test.

## Модальные окна

Карточка задачи, admin dialogs, import preview и conflict UI имеют отдельные структуры. Нельзя распространять layout одной модалки на все остальные. Общие accessibility helpers находятся в `modalAccessibility.js`; покрытие каждой модалки нужно проверять отдельно.

## Sticky layout

Backlog/team backlog используют сложный механизм toolbar + quick edit + cloned table header. Его контракт вынесен в `STICKY_BACKLOG_TABLES.md` и защищён frontend tests.

Admin использует отдельную реализацию sticky tabs/header в `admin.js`; это другой механизм.

## Responsive

Responsive поведение определяется `responsive.css` и contract tests. В частности, меняются sidebar overlay, toolbar positioning, paddings и layout страниц. Полная browser/device support matrix не утверждена.

## Иконки, графики и шрифты

- Lucide, Chart.js, ECharts и SheetJS хранятся локально.
- Inter и Unbounded подключены локальными font files.
- Версию сторонней библиотеки следует проверять по самому vendored file; документация не должна угадывать её по имени файла.

## Безопасный HTML

Использование визуального компонента не делает динамический HTML безопасным. Все недоверенные значения должны экранироваться; см. `SECURITY.md` и `htmlUtils.js`.

## Правило изменения

1. Переиспользовать существующий token/class, если контракт подходит.
2. Проверить dark/light, compact и responsive варианты, которые реально поддерживает компонент.
3. Не описывать hover/focus/loading/empty/error state, если он не реализован.
4. Добавить контрактный или визуально проверяемый тест для критичного layout.
5. Обновить этот документ только при изменении общей системы, а не каждой локальной детали.

Исторический каталог значений и предполагаемых состояний сохранён в `archive/legacy/DESIGN_SYSTEM_STALE.md`.
