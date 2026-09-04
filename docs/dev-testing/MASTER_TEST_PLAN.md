---
title: Master Test Plan Backlog coordinator DEV
scope: target-dev-testing
status: ready-for-scheduling
last_updated: 2026-09-01
---

# Master Test Plan

## 1. Цель цикла

Подтвердить готовность Backlog coordinator, AI Business Analyst Agent и Task
Prioritiser к дальнейшей опытной эксплуатации на DEV: корректность
развёртывания, критические бизнес-сценарии, доступ, UX/UI в Chrome при окне
640×700–2560×1440, качество агентов, импорт, отказоустойчивость и сохранность данных.

## 2. Утверждённая область первого цикла

Обязательно:

- US-01–US-10;
- US-11–US-18;
- US-22 импорт;
- Chrome;
- desktop/notebook, разные размеры окна;
- deployment smoke;
- автоматизированная регрессия;
- page/action/object access;
- agent golden dataset;
- controlled restart и сохранение данных.

Расширенно и не блокирует первый цикл:

- US-21 массовые операции;
- US-23 Admin/audit read-only;
- US-24 длинные/граничные данные;
- performance, resilience и backup/restore в объёме, согласованном с DevOps.

Не входит в первый цикл:

- Kanban;
- Express estimate;
- другие браузеры;
- смартфоны, планшеты и touch UX;
- изменение защищённых пользователей, ролей, справочников, команд и ответственных.

## 3. Последовательность gates

| Gate | Содержание | Вход | Выход |
|---|---|---|---|
| G0 | Готовность поставки | commit/tag, release note, инструкции | пакет принят DevOps |
| G1 | Готовность стенда | заполнен паспорт, секреты/сеть/storage | разрешён deployment smoke |
| G2 | Deployment smoke | сервисы развёрнуты | базовые HTTP/auth/agent/prioritiser/restart PASS |
| G3 | Автоматизированная регрессия | отдельные test stores | backend/frontend/agent/prioritiser tests PASS |
| G4 | P0 функциональность и доступ | профили и данные готовы | US-01–10 и ownership PASS |
| G5 | P1, импорт и UX/UI | стабильный стенд | US-11–18/22 и matrix выполнены |
| G6 | Качество агента/UAT | реальная LLM/KB | baseline, hard fail=0, решение владельца |
| G7 | Resilience/performance/restore | согласован DevOps slot | выполненный объём и ограничения |
| G8 | Регрессия исправлений | defects ready for retest | P0=0, P1 приняты/закрыты |
| G9 | Test Summary | evidence собраны | GO/CONDITIONAL GO/NO-GO |

Переход через gate фиксируется, а `BLOCKED` не считается `PASS`.

## 4. Рекомендуемый календарь первого цикла

Относительный план после готовности стенда:

| День | Работы |
|---|---|
| D0 | передача пакета, заполнение паспорта, подготовка профилей/данных |
| D1 | deployment smoke, исправление блокеров стенда |
| D2 | автотесты, P0 backlog/auth/access |
| D3 | P0 агент, драфт, отправка, review |
| D4 | импорт, P1 функциональность, responsive Chrome |
| D5 | golden dataset и продуктовая UAT-сессия |
| D6 | resilience/restart, согласованный performance baseline |
| D7 | retest и итоговый отчёт |

План рассчитан на стабильный DEV и может быть растянут при обнаружении P0/P1 или отсутствии внешних владельцев.

## 5. Роли

| Роль | Ответственность |
|---|---|
| Владелец продукта | утверждение области, UAT агента, остаточные UX/бизнес-риски |
| QA | выполнение и evidence, дефекты, итоговая рекомендация |
| Разработка | анализ/исправление, unit/integration regression |
| DevOps | deployment, fault injection, logs, restart, performance, restore |
| Владелец данных | готовые профили/справочники/команда без тестовых мутаций |
| Владелец LLM/KB | модель, квоты, KB version, диагностика provider |

Один человек может совмещать роли, но продуктовая приёмка и технический PASS фиксируются отдельно.

## 6. Daily status

| Показатель | Значение |
|---|---|
| Build | |
| Текущий gate | |
| Planned/Passed/Failed/Blocked | |
| Open P0/P1 | |
| Главный blocker | |
| Изменения стенда | |
| Решение на следующий день | |

## 7. Stop conditions

Тестовый прогон приостанавливается при:

- связи с production data/resource;
- включённом startup seed в общей DEV-БД;
- раскрытом секрете;
- повреждении или смешивании данных пользователей;
- неизвестной версии deployment;
- неисправности стенда, делающей большинство результатов недостоверными.

## 8. Exit criteria

- deployment smoke PASS;
- автоматизированная регрессия PASS либо отклонения приняты с доказательством;
- US-01–10, US-11–18, US-22 выполнены;
- Chrome/viewport baseline выполнен;
- 100% ownership/isolation invariants;
- agent hard fails = 0;
- открытых P0 нет;
- P1 закрыты либо явно приняты без security/data риска;
- создан Test Summary Report;
- обычные тестовые записи очищены или назначен владелец/срок.
