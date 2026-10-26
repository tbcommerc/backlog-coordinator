---
title: UX/UI-аудит карточки задачи
scope: dated-audit
status: verified
last_verified: 2026-09-10
source_of_truth:
  - frontend/js/components/modal.js
  - frontend/js/taskCardMarkdown.js
  - frontend/js/components/taskComments.js
  - frontend/js/components/taskAttachments.js
  - frontend/js/router.js
  - backend/routers/tasks_router.py
  - backend/routers/task_collaboration_router.py
  - backend/routers/customer_router.py
---

# UX/UI-аудит карточки задачи

> Это датированный аудит и план улучшений, а не описание будущего
> AS-IS. Статусы внедрения ниже подтверждаются кодом и тестами.

## Цель и ограничения

Карточка должна давать быстрый ответ на три вопроса: «что это», «что с ней
происходит» и «что я могу сделать сейчас». При этом ни один атрибут задачи не
удаляется. Разрешено только устранять повторный вывод одного и того же значения.

В проверку вошли desktop и узкие рабочие окна, light/dark, view/edit/inline edit, optimistic
locking, offline/error/conflict, отчётные статусы, комментарии, файлы, AI-расчёты,
прямые ссылки и customer read-only проекция.

## Полнота атрибутов

Целевая компоновка сохраняет:

- идентичность: public ID, название, описание, внутренний комментарий;
- исполнение: статус, приоритет, срок, прогресс, исполнитель;
- оценку: общие трудозатраты, вес, прогноз, Hard/Soft, плановые и фактические
  трудозатраты по восьми компетенциям, ставки, стоимость и отклонение;
- заказчика: бизнес-заказчик, подразделение, клиент ДИД, канал и дату получения;
- классификацию: команду, вовлечённые команды, проект, тип, теги и метрический KR;
- ценность: финансовый эффект, обоснование, C/V, Priority Score и обоснование агента;
- отчётность: три вида статуса, предыдущее значение/дату, демо для ДИД;
- артефакты: макеты, Jira, бизнес-требования, вложения;
- совместную работу: комментарии, ответы, упоминания, зрителей и lock;
- системные данные: автор, даты создания/изменения, version и лог.

Компактные status/priority/type в header и их поля в «Паспорте» привязаны к одному
источнику. Header работает как ориентир, а не как вторая форма.

## Предложенная архитектура карточки

1. Sticky header: ID, тип, статус, приоритет, полное название, copy link и close.
2. «Основное»: название/описание/внутренний комментарий; bento-группы «Исполнение»,
   «Оценка и прогноз», «Команда», «Заказчик», «Классификация»; KPI и disclosure
   по трудозатратам.
3. «Отчётные статусы»: три карточки встреч с раздельными draft/save/version.
4. «Комментарии»: feed, replies, mentions, адресуемая цель уведомления и защита черновика.
5. «Ссылки и файлы»: макеты, Jira, требования, upload/download/delete и системные метаданные.
6. «Лог изменений»: последнее PI-решение и полная история.
7. Sticky footer: автор/даты в view; число изменений, Cancel и Save в edit; отдельный
   индикатор черновиков отчётности.

Desktop использует максимум ширины без потери сканируемости; на узкой ширине та же
карточка адаптируется в одну колонку, сохраняет полное название и локализует
горизонтальную прокрутку вкладок и таблиц. Отдельной мобильной версии нет.

## Дефекты и решения

| ID | Приоритет | Наблюдение | Решение / статус |
|---|---:|---|---|
| TC-01 | P0 | Customer list использовал полный `TaskResponse`, detail — ограниченный. | Единая `CustomerTaskResponse` для list/detail; внедрено, contract 4/4. |
| TC-02 | P1 | Ключ вкладки `sys`, а загрузка файлов ждала `files`. | Канонический `sys` + legacy alias `files→sys`; внедрено. |
| TC-03 | P1 | V30 не показывал/не редактировал comment, effort days, weight, forecast. | Возвращены view/edit/diff/payload; внедрено, runtime 4/4. |
| TC-04 | P1 | `open-task` терял `detail.tab`, были гонки и duplicate overlay. | Коалессинг, latest-wins, валидация и очистка route; внедрено, routing 11/11. |
| TC-05 | P1 | Вкладки и drop-zone не имели полной keyboard/ARIA-семантики. | Tablist/tab/tabpanel, roving tabindex, arrows/Home/End, Enter/Space upload; внедрено. |
| TC-06 | P1 | Один `cardState.dirty` смешивал task edit и все reporting drafts; save одного стирал остальные. | Раздельные drafts по kind/meeting, независимое сохранение и общий guard; внедрено. |
| TC-07 | P1 | Черновик комментария не защищён; reply/mentions могли перетечь между задачами; `comment` deep-link не фокусировал цель. | Draft-session изолирована по task, закрытие защищено; feed/listbox/deep-link имеют стабильную семантику, фокус и подсветку; внедрено. |
| TC-08 | P1 | Frontend всегда брал последнюю ставку, backend — год дедлайна; decimal financial effect округлялся. | Общий resolver ставки по году дедлайна и decimal payload без округления; внедрено. |
| TC-09 | P1 | Edit/comment/upload affordances не учитывали explicit task scope до ответа 403. | `task_edit/task_comment` применяются fail-closed и в UI, и перед запросом; read-only runtime проверен; внедрено. |
| TC-10 | P1 | Закрытие/повторное открытие во время AI-запроса допускало stale result; realtime banner искал legacy container. | Request identity/abort, task/session guards и текущий `mbody`; внедрено. |
| TC-11 | P2 | Узкое окно: крупные inset, обрезание title, overflow вкладок/таблиц. | One-column, полный title, локальный scroll и runtime на 390 px в dark theme; внедрено. |
| TC-12 | P2 | Nested dialog и modal могли одновременно обработать Escape. | Родительская карточка игнорирует Escape при открытом дочернем dialog; conflict dialog закрывается сам и останавливает всплытие; внедрено. |
| TC-13 | P0 | Markdown в описании показывался как сырой текст; длинный текст вытеснял паспорт и KPI. | Ограниченный безопасный Markdown без raw HTML, allow-list ссылок, сворачивание на 240 px, fade и «Показать полностью / Свернуть»; внедрено. |
| TC-14 | P0 | При переполнении вкладок не было явного признака скрытого содержимого. | Градиенты по доступным направлениям, кнопки прокрутки и автоматический пересчёт на resize; внедрено без отдельной mobile-компоновки. |
| TC-15 | P2 | Подписи 10–10,5 px и множество одинаковых рамок ухудшали сканирование. | Подписи полей увеличены до 12 px, значения — до 14 px, капс оставлен смысловым заголовкам; пассивные вложенные рамки ослаблены, focus/edit-границы сохранены; внедрено. |

## Пользовательские пути и оракулы

| Путь | Ожидаемый исход |
|---|---|
| Открыть из backlog/team backlog/kanban/dashboard/report | Один overlay, та же задача, фокус в dialog; после close фокус возвращается. |
| Deep-link `?task=&tab=` | Валидные task/tab открываются, latest request wins; невалидные очищаются без цикла. |
| View и inline edit | Все атрибуты видимы; Enter/Space включает точечное edit при наличии прав. |
| Full edit → save/cancel | Diff содержит каждое изменение; payload не округляет decimal; cancel/close/navigation не теряют черновик без явного выбора. |
| Conflict/offline/lock/realtime | Поля сохранены, 409 даёт compare/merge, 423 — read-only, offline — retry, external version — неагрессивный banner. |
| Отчётность | Можно изменить несколько drafts; save одного не стирает остальные. |
| Комментарии/ответы/mentions | Draft защищён; mention listbox управляется клавиатурой; notification фокусирует/подсвечивает коммент. |
| Ссылки/файлы | Валидные external URL, upload mouse/keyboard/drop, скачивание и delete confirmation; write-actions только с `task_edit`. |
| AI value/priority → accept/reject | Проверка prerequisites, busy/таймаут, stale result не применяется к новой session, accept с optimistic version. |
| Customer read-only | List/detail имеют одинаковую ограниченную проекцию; внутренних оценок и действий нет. |

## Критерии приёмки

- В runtime-fixture заполнены все persisted-атрибуты; каждая из пяти вкладок открывается.
- На 390 px нет overflow вьюпорта; важные hit-area не меньше 40×40 px; title доступен полностью.
- Light/dark сохраняют контраст, focus ring и семантические цвета.
- В dialog ровно один accessible name; в tablist ровно один `tabindex=0` и `aria-selected=true`.
- Описание не исполняет raw HTML и небезопасные URL-схемы; длинный Markdown раскрывается
  и сворачивается без перехода в режим редактирования.
- Все изменяемые атрибуты попадают в diff/payload; read-only атрибуты явно обозначены.
- Проверки выполняют код и DOM, а не только ищут строки в source.

## Итоговая доказательная база

На 10.09.2026 получены:

- customer contract: 4/4;
- полный frontend unit/contract run: 203/203;
- actual-DOM Playwright карточки: 10/10;
- из них: пять вкладок, ARIA-клавиатура, файлы, legacy route, deep-link комментария,
  сохранение comment draft, полный и read-only режимы, безопасный Markdown с disclosure,
  desktop и 390 px dark theme с градиентами/стрелками вкладок;
- проверка `git diff --check` выполняется перед передачей результата.

Runtime-проверки используют изолированную fixture и не создают и не изменяют защищённые
справочники, пользователей, роли, команды или ответственных.
