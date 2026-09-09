---
title: Интеграционные и отказные испытания
scope: target-dev-testing
status: ready-for-devops-review
last_updated: 2026-09-07
---

# Интеграционные и отказные испытания

## 1. Правила

Fault injection выполняется только DevOps в DEV, согласованным обратимым способом. Нельзя повреждать общую БД, защищённые данные или production-интеграции. Перед сценарием фиксируются исходное состояние, способ восстановления и ответственный.

## 2. Матрица зависимостей

| Связь | Проверяемые отказы | Ожидаемое поведение |
|---|---|---|
| Browser → Backend | timeout, 401, 403, 404, 5xx | понятная ошибка, отсутствие бесконечного retry/дублей |
| Backend → DB | unavailable, timeout, connection exhaustion | контролируемая 5xx, recovery после возврата DB |
| Backend → Redis | unavailable | fail-fast либо документированный fallback; без утечки ключей |
| Backend → Agent | timeout, 403, 5xx | сообщение пользователю, сохранение его ввода, retry |
| Backend → Prioritiser | timeout, 422, 5xx | контролируемая ошибка; task/version не меняются частично |
| Agent → LLM | 429, 503, timeout, invalid output | fail-closed, карта не меняется |
| Backend → uploads | read-only/full/unavailable | понятная ошибка, DB metadata не остаётся ложным success |
| Scheduler → DB | DB error/restart | сессия закрыта, нет дублирования после восстановления |

## 3. Сценарии

| ID | Fault | Действие пользователя | Проверки | Восстановление |
|---|---|---|---|---|
| IR-01 | Agent остановлен | отправить сообщение | loading завершается; ввод сохранён; понятная ошибка; нет новых фактов | запустить agent, retry один раз |
| IR-02 | Неверный backend→agent secret | открыть/создать сессию | 403 не раскрывает secret; UI не показывает чужие данные | вернуть secret object, restart/rollout |
| IR-03 | LLM 429 | отправить сообщение | bounded retry; нет дублей; итог понятен | снять stub/лимит |
| IR-04 | LLM 503/timeout | отправить сообщение | `unavailable`; карта/драфт неизменны | восстановить endpoint, retry |
| IR-05 | Invalid structured output | отправить богатое сообщение | fail-closed; факты не применены | вернуть валидный provider |
| IR-06 | DB unavailable | открыть backlog/изменить обычную задачу | нет ложного success; UI восстанавливается после DB | вернуть DB |
| IR-07 | Redis unavailable | login/refresh в согласованном объёме | поведение соответствует runtime policy; logs понятны | вернуть Redis |
| IR-08 | Upload storage read-only | загрузить TF-01 | ошибка без созданного ложного attachment | вернуть права |
| IR-09 | Upload storage full/quota | загрузить boundary file | контролируемая ошибка; процесс не падает | освободить согласованную квоту |
| IR-10 | Backend restart во время чтения | refresh route | повторный вход/refresh предсказуем | дождаться ready |
| IR-11 | Agent restart после ответа | открыть сессию | session сохранена на persistent volume | дождаться agent |
| IR-13 | Prioritiser остановлен/timeout | рассчитать Value/приоритет | backend возвращает контролируемую ошибку; задача не меняется | запустить prioritiser, повторить с актуальной version |
| IR-14 | Недостаточные атрибуты prioritiser | вызвать расчёт | `422` без ложного Value/priority | заполнить обычные рабочие поля и повторить |
| IR-12 | Двойной click/retry send-for-review | отправить один драфт | одна requirement request; идемпотентный результат | не требуется |
| IR-13 | Access token истёк при сохранении | сохранить обычное изменение | refresh rotation и один повтор, без дубля | не требуется |
| IR-14 | KB отсутствует/manifest invalid | вызвать config/clarification | startup/config диагностичны; выдуманного KB-ответа нет | вернуть утверждённую KB |
| IR-15 | Scheduler restart | дождаться/вызвать тестовый цикл | нет дублей уведомлений; один экземпляр | штатный restart |
| IR-16 | Commit backend падает после успешного send-for-review | отправить готовый draft | request отсутствует; Agent получил `cancel-review` для того же task ID; повтор доступен | убрать fault, повторить отправку |

## 4. Evidence

Для каждого IR-сценария фиксировать:

- build и конфигурацию;
- точное окно fault injection;
- пользовательский request/session ID;
- UI screenshot/video;
- HTTP status/timing без секретов;
- backend/agent log correlation;
- состояние данных до/после;
- время восстановления;
- подтверждение, что fault полностью снят.

## 5. Критерии

- ни один отказ не приводит к чужому доступу, раскрытию секрета или ложной отправке;
- retry не создаёт дублей обычных записей, сообщений и requirements;
- unavailable LLM не меняет факты;
- после восстановления новый запрос успешен без ручного исправления БД;
- нет бесконечного loading/retry loop;
- fault injection не оставляет стенд в изменённой конфигурации.
