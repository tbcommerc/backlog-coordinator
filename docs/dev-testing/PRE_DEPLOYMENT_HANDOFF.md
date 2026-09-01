---
title: Чек-лист передачи приложения DevOps
scope: target-dev-testing
status: ready-to-fill
last_updated: 2026-09-01
---

# Чек-лист перед передачей DevOps

## 1. Поставка от разработки

- [ ] Указан repository и доступ DevOps.
- [ ] Зафиксирован branch/tag/commit.
- [ ] Есть краткий release note и известные ограничения.
- [ ] Указаны команды сборки/запуска backend, agent и Task Prioritiser.
- [ ] Указаны dependency files и версии Python.
- [ ] Автотесты выполнены на изолированной тестовой БД.
- [ ] Нет секретов в repository/release note.
- [ ] Решено, кто готовит Docker/systemd/platform manifests.

## 2. Решения владельца продукта

- [x] Desktop-only.
- [x] Chrome-only для первого цикла.
- [x] Viewport 640×700–2560×1440.
- [x] US-01–10 предварительно P0.
- [x] US-11–18 и импорт US-22 обязательны.
- [x] Kanban и Express estimate исключены.
- [x] Bulk — расширенная проверка.
- [x] Владелец продукта выполняет бизнес-UAT агента и review.

## 3. Требуется от владельцев до начала тестов

- [ ] Подготовлены AP-01–AP-07 либо согласован уменьшенный набор.
- [ ] Подготовлена существующая команда для отправки requirement.
- [ ] Подтверждены read-only справочники для импорта.
- [ ] Выделена область обычных тестовых задач.
- [ ] Назначен владелец очистки.
- [ ] Утверждена версия KB.
- [ ] Предоставлен реальный тестовый LLM provider/model.

## 4. Материалы для DevOps

- [ ] [`DEV_ENVIRONMENT_PASSPORT.md`](DEV_ENVIRONMENT_PASSPORT.md).
- [ ] [`DEPLOYMENT_SMOKE.md`](DEPLOYMENT_SMOKE.md).
- [ ] Список переменных окружения без значений секретов.
- [ ] Сетевая схема browser→backend→agent→LLM и backend→prioritiser.
- [ ] Persistent volumes: DB/uploads/sessions/logs.
- [ ] Правило scheduler: web=false, отдельный instance при необходимости.
- [ ] План backup/restore.
- [ ] Fault-injection slot и ответственный.

## 5. Неизвестное допустимо перед передачей

Поля SLA, RPO/RTO, точной производительности и retention могут оставаться `OPEN`, если назначены владелец и срок решения. Не могут оставаться неизвестными:

- commit/tag;
- DEV/production boundary;
- место секретов;
- DB/storage targets;
- startup seed mode;
- внешний URL/CORS;
- agent URL/secret coupling;
- prioritiser internal URL, timeout и запрет публикации порта без service auth;
- владелец тестовых профилей и данных.

## 6. Протокол передачи

| Поле | Значение |
|---|---|
| Дата | |
| Пакет/version | |
| Передал | |
| Принял DevOps | |
| Deployment ticket | |
| Blockers | |
| Плановая дата smoke | |

Решение: `READY FOR DEVOPS` / `READY WITH OPEN ITEMS` / `NOT READY`.
