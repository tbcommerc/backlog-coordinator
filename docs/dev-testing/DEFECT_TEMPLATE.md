---
title: Шаблон дефекта DEV-тестирования
scope: target-dev-testing-template
status: active-template
last_updated: 2026-09-01
---

# Шаблон дефекта

## Заголовок

Формат:

`[Компонент][Платформа/viewport][Условие] Наблюдаемое отклонение`

Примеры:

- `[Agent][Окно 640px][Responsive] Кнопка отправки перекрыта`;
- `[Access][Requirement] Другой заказчик открывает чужую сессию`;
- `[Backlog][Chrome][Zoom 200%] Toolbar закрывает заголовок таблицы`.

## Карточка

| Поле | Значение |
|---|---|
| ID | |
| Заголовок | |
| Приоритет | P0 / P1 / P2 / P3 |
| Тип | Functional / UX / UI / Access / Security / Agent quality / Performance / Deployment |
| Статус | New / Confirmed / In progress / Ready for retest / Closed / Rejected / Deferred |
| Build/commit | |
| DEV URL | |
| Компонент | Frontend / Backend / Agent / Prioritiser / LLM / KB / Infrastructure |
| Роль/AP-профиль | |
| Тест-кейс | |
| Browser/version | |
| OS/device | |
| Viewport/zoom/scaling | |
| Theme/compact | |
| Повторяемость | always / intermittent / once |
| Владелец | |

## Описание

**Предусловия:**

**Шаги воспроизведения:**

1. 
2. 
3. 

**Ожидаемый результат:**

**Фактический результат:**

**Влияние на пользователя/бизнес:**

**Обходной путь:**

## Доказательства

- screenshot/video:
- безопасный request/session ID:
- method/path/status:
- console error:
- network timing/response fragment:
- log correlation ID:

Не прикладывать пароли, access/refresh tokens, `X-Agent-Secret`, LLM keys, полный персональный контекст или содержимое чужой сессии. При security-дефекте минимизировать доказательство и ограничить доступ к нему.

## Приоритизация

| Приоритет | Критерий |
|---|---|
| P0 | потеря/чужое раскрытие данных, обход доступа, раскрытие секрета, невозможен критический путь для всех, неконтролируемая отправка |
| P1 | основной сценарий заблокирован для поддерживаемой роли/платформы, потеря ввода, устойчивый LLM/инфраструктурный отказ без восстановления |
| P2 | сценарий возможен с существенным обходом, вводящий в заблуждение UX, частичное ухудшение качества без hard fail |
| P3 | локальный визуальный/текстовый дефект без потери функции |

Severity и priority можно разделять в трекере, но решение о выпуске принимает priority с учётом охвата и обхода.

## Retest

| Поле | Значение |
|---|---|
| Fix build/commit | |
| Дата | |
| Исполнитель | |
| Исходный сценарий | PASS / FAIL |
| Соседняя регрессия | PASS / FAIL / NOT RUN |
| Viewport/browser | |
| Evidence | |
| Итог | Closed / Reopen |
