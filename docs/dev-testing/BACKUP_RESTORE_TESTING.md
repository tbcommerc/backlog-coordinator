---
title: Проверка backup и restore Backlog coordinator
scope: target-dev-testing
status: ready-for-devops-review
last_updated: 2026-09-01
---

# Проверка резервного копирования и восстановления

Репозиторий содержит `scripts/backup-production.ps1` и
`scripts/verify-backup.ps1`: первый создаёт PostgreSQL custom dumps двух БД и
archive uploads с SHA-256 manifest, второй проверяет checksum и читаемость
форматов. Проверка archive не заменяет restore в отдельные БД/volumes по
сценариям ниже.

## 1. Цель

Подтвердить не наличие backup-файла, а возможность восстановить согласованный
момент и целостный набор связанных данных: backlog DB, uploads, agent sessions,
prioritiser state/snapshot, audit/log metadata и версию KB.

RPO, RTO, retention, encryption и место хранения должны быть утверждены владельцами. До этого результаты являются техническим baseline.

## 2. Безопасность

- восстановление выполняется только в отдельный DEV restore target;
- текущая общая DEV-БД не перезаписывается без отдельного явного согласования;
- production backup не используется;
- секреты не копируются в отчёт;
- защищённые записи проверяются read-only, не корректируются «для совпадения»;
- пути restore заранее разрешаются и проверяются DevOps.

## 3. Контрольный набор

Перед backup создать только обычные записи с уникальным маркером:

- задача TD-TASK-BR с комментарием;
- безопасное вложение TF-01;
- agent session с двумя сообщениями;
- неполный draft;
- при разрешении — одна отправленная тестовая requirement request;
- записать ID, timestamps и checksum файла.

## 4. Сценарии

| ID | Объект | Действие | Критерий |
|---|---|---|---|
| BR-01 | Backlog DB | создать backup, восстановить в отдельную БД | задача, комментарий, история и request согласованы |
| BR-02 | Uploads | восстановить каталог/volume | metadata соответствует файлу; checksum совпадает; download работает |
| BR-03 | Agent sessions | восстановить session store | история, facts, draft и owner сохранены |
| BR-04 | KB | восстановить/смонтировать версию | hash/stats совпадают, approved content доступен |
| BR-05 | Logs/audit | восстановить требуемый период | события сопоставимы по времени/ID, секретов нет |
| BR-06 | Point-in-time boundary | создать запись после backup | post-backup запись отсутствует согласно ожидаемому RPO |
| BR-07 | Application start | запустить backend/agent на restore target | schema/runtime стартуют без несанкционированного seed |
| BR-08 | End-to-end | открыть восстановленную задачу и agent session | UI/API читают согласованные данные; сессию можно продолжить |
| BR-09 | Prioritiser | проверить snapshot и повторить stateless расчёт | версия и детерминированный результат совпадают |

## 5. Последовательность

1. Заполнить паспорт среды и определить restore target.
2. Зафиксировать контрольные ID/checksum/time.
3. Создать backup штатным runbook.
4. Проверить завершение, размер и доступность артефактов.
5. Восстановить в отдельные пути/БД.
6. Запустить сервисы с restore-конфигурацией и `RUN_STARTUP_SEED=false`.
7. Выполнить DS-201–204 и read-only проверки.
8. Сверить контрольный набор.
9. Продолжить восстановленную agent session одним синтетическим сообщением.
10. Зафиксировать фактические RPO/RTO и удалить restore target по согласованной процедуре.

## 6. Проверка целостности

| Проверка | Ожидание | Факт/evidence |
|---|---|---|
| Task ID/title | совпадают | |
| Comment/history | совпадают | |
| Attachment metadata | совпадает | |
| Attachment checksum | совпадает | |
| Requirement owner/status | совпадают | |
| Agent session owner | совпадает | |
| Agent history/facts/draft | совпадают | |
| KB hash/stats | совпадают | |
| Protected reference IDs | доступны read-only и не изменены | |

## 7. Отказные варианты

- отсутствует часть uploads;
- backup DB повреждён/не читается;
- DB и uploads относятся к разным моментам;
- session store backup отсутствует;
- недостаточно прав/места на restore target;
- KB version не совпадает;
- restore запускается с ошибочно включённым seed — запуск остановить.

Каждый вариант должен завершаться диагностируемой ошибкой, а не частичным незамеченным success.

## 8. Результат

| Метрика | Цель | Факт |
|---|---:|---:|
| RPO | OPEN | |
| RTO | OPEN | |
| Backup duration | baseline | |
| Restore duration | baseline | |
| Data discrepancies | 0 | |
| Missing attachments/sessions | 0 | |

Вердикт: `PASS` / `FAIL` / `BLOCKED`.

Runbook/version:

Ограничения и действия:
