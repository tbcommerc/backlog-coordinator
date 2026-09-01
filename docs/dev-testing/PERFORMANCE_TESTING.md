---
title: Программа нагрузочного тестирования DMB Platform
scope: target-dev-testing
status: draft-baseline
last_updated: 2026-09-01
---

# Нагрузочное тестирование

## 1. Цель и ограничения

Определить baseline latency, throughput, error rate и ресурсные ограничения DEV, отдельно для обычного API и LLM-зависимых операций. Результаты DEV не выдаются за production capacity без сопоставимой топологии.

Нагрузочные тесты запускаются только после smoke и функциональной регрессии, на выделенных обычных данных. Создание/изменение защищённых пользователей, ролей, команд и справочников запрещено.

## 2. До начала необходимо утвердить

- ожидаемое число одновременных пользователей;
- пиковые RPS и длительность пика;
- долю операций чтения/записи;
- размер backlog, отчётов и вложений;
- дневное/пиковое число agent turns;
- квоты и стоимость LLM;
- SLA/p95/p99 и допустимый error rate;
- целевую topology/worker count.

До утверждения используются только baseline-измерения без заявления о соответствии SLA.

Исполняемый read-only профиль находится в
`infrastructure/load/k6-readonly.js`. Он не создаёт и не меняет пользователей,
роли, команды, справочники или обычные записи. Пример запуска приведён в
`docs/PRODUCTION_RUNBOOK.md`; фактические параметры и evidence прикладываются к
этому протоколу.

## 3. Профили

| ID | Профиль | Операции | Данные |
|---|---|---|---|
| PF-01 | Auth | login → me → refresh → logout с безопасной частотой | подготовленные профили, без brute force |
| PF-02 | Backlog read | list, filters, detail, history | TD-BACKLOG-01/обычные записи |
| PF-03 | Backlog write | comment/разрешённое поле на выделенных задачах | уникальные записи на worker |
| PF-04 | Reports | открыть/фильтровать стандартные отчёты | синтетический объём |
| PF-05 | Attachments | upload/download безопасных файлов | отдельные задачи/TF files |
| PF-06 | Agent sessions | create/list/open session | отдельный user/session pool |
| PF-07 | Agent turns | chat message → LLM response | ограниченный golden subset |
| PF-08 | Review | list/detail/send idempotency | отдельные draft/session IDs |
| PF-09 | Prioritiser Value/priority | stateless full request through backend | synthetic ordinary tasks, no protected mutations |
| PF-09 | Scheduler | один тестовый цикл при объёме обычных записей | отдельный запуск, один instance |

PF-07 не смешивается с PF-02–05 при первичном baseline: latency LLM и приложения измеряются раздельно.

## 4. Этапы нагрузки

1. **Single-user baseline:** по 10–20 повторов операции.
2. **Ramp-up:** ступени 1 → 5 → 10 → согласованный target users.
3. **Steady state:** 30–60 минут на target, если квоты позволяют.
4. **Peak:** короткий согласованный пик.
5. **Soak:** 2–4 часа после устранения утечек/ошибок baseline.
6. **Recovery:** прекращение нагрузки и возврат latency/resources к baseline.

Числа являются стартовым планом и уточняются владельцем инфраструктуры.

## 5. Метрики

| Слой | Метрики |
|---|---|
| Client | request rate, success/error, p50/p95/p99, timeout |
| Backend | CPU, RAM, workers, event loop/request queue, DB pool |
| DB | connections, lock/busy errors, query latency, file/volume I/O |
| Redis | latency, errors, connections, evictions |
| Agent | turns, session latency, unavailable rate, process resources |
| Prioritiser | Value/priority latency, SQLite busy/errors, process resources |
| LLM | provider latency, 429/5xx, retries, tokens/cost при доступности |
| Storage | throughput, latency, capacity/errors |
| Business | successful draft/send, duplicate rate, lost update rate |

## 6. Предварительные ориентиры для обсуждения

Не являются утверждённым SLA:

- обычный API p95 ≤ 1 s;
- тяжёлые отчёты p95 ≤ 3 s;
- agent turn p95 ≤ 10 s либо отдельный согласованный LLM SLA;
- technical error rate < 1%;
- 0 потерянных/смешанных сессий;
- 0 дублей requirement requests при повторе;
- после нагрузки система восстанавливается без restart.

## 7. Особые проверки текущей архитектуры

- PostgreSQL: pool wait, locks/deadlocks и slow queries;
- Prioritiser SQLite volume: latency, lock/busy errors и отсутствие параллельных writers;
- локальный agent session store: session isolation и persistence;
- локальные uploads: привязка к instance и поведение после rollout;
- memory/Redis rate limiter: фактический backend mode;
- scheduler: ровно один instance;
- LLM: bounded retry и соблюдение provider quotas.

## 8. Протокол результата

| Profile | Users/RPS | Duration | Success % | p50 | p95 | p99 | Errors | Resource max | Verdict |
|---|---:|---:|---:|---:|---:|---:|---|---|---|
| | | | | | | | | | |

Отдельно приложить workload script/version, data volume, topology, timestamps и dashboards. Тест признаётся недействительным, если во время него менялась конфигурация или использовались общие изменяемые записи без изоляции.
