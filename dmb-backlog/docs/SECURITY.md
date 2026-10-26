---
title: Безопасность Backlog coordinator
scope: as-is
status: verified
last_verified: 2026-10-12
evidence:
  - backend/auth.py
  - backend/routers/auth_router.py
  - backend/refresh_sessions.py
  - backend/rate_limit.py
  - backend/middleware.py
  - backend/idempotency.py
  - backend/event_outbox.py
  - backend/telemetry.py
  - backend/config.py
  - backend/attachment_scanner.py
  - frontend/js/api.js
  - frontend/js/auth.js
  - frontend/js/htmlUtils.js
  - backend/tests/test_security_contracts.py
  - backend/tests/test_auth_cookie_policy.py
  - backend/routers/agent_v2_router.py
  - backend/routers/requirement_reviews_router.py
  - backend/services/requirement_reviews.py
  - backend/tests/test_requirement_reviews_domain.py
  - backend/tests/test_agent_v2_document_boundary.py
  - frontend/tests/htmlUtils.test.mjs
---

# Безопасность Backlog coordinator

Fork-based Assistant V2 применяет отдельный shared secret и pilot allowlist
для BA/PO. Существующий `admin_access=full` допускает пользователя как BA без
allowlist; feature flag и kill switch сохраняют приоритет. DMB gateway вычисляет
роль по серверному RBAC и перезаписывает клиентские actor/context-поля. Связанные
объекты проходят обычную проверку read access. Preview patch не имеет операции
применения к DMB и исключает защищённые сущности/поля.

Документ фиксирует реализованные механизмы. Он не подтверждает внешнюю инфраструктуру, регламенты организации или production-процессы, которых нет в репозитории.

## Документы и согласование Agent V2 — проверено по коду 09.10.2026

- Generic gateway проверяет закрытый список HTTP method/path до формирования
  URL привилегированного upstream. После URL-decoding не допускаются произвольные
  сегменты, встроенные query/fragment и обход в служебные команды перехода ревью.
  В query и JSON actor ID заменяется серверным; shared secret не передаётся SPA.
- Клиент не создаёт авторитетный linked snapshot. Gateway получает Task/Request
  после текущей объектной авторизации, а V2 отдельно проверяет владельца сессии.
  Доступ повторно проверяется для восстановленных сессий, document actions,
  списков и возвращаемых JSON snapshot, в том числе из кеша идемпотентности.
  Существующий связанный документ нельзя перепривязать к другому объекту.
- Пакет `RequirementReview` создаётся только из состояния, полученного backend
  у V2. Произвольный draft, `creator_id` или reviewer из browser payload не
  используются. Fingerprint связывает полный снимок с показанной редакцией;
  пакет AI-проверки и источники сохраняются отдельно. Ошибка или недоступность
  AI-проверки не трактуется как успешная проверка: degraded-передача требует
  явного подтверждения и сохраняет эту пометку.
- Доступ к `/api/requirement-reviews` требует аутентификации и допуска к общей
  внутренней поверхности (customer-only роли исключены mount dependency).
  Чтение связанных пакетов следует текущему read scope Task/Request. Для
  самостоятельного документа это автор либо допустимая область ревью BA/PO.
  Право читать пакет не даёт права его согласовать.
- Claim и решение требуют текущей BA/PO роли и review scope соответствующей
  команды либо глобального scope. Решение принимает закреплённый ревьюер;
  автору запрещено согласовывать собственное БТ, в том числе full admin.
  Изменение существующих ролей или создание отдельного права самоутверждения
  в этом инкременте не выполняется.
- API решения требует актуальную `review.version`; повтор ключа с иным payload
  отклоняется. Неизменяемые поля защищены ORM listener; изменение документа
  оформляется новым пакетом. Unique active marker ограничивает число активных
  пакетов одним на artifact, а явная замена выполняется атомарно.
- Публикация и решение заново читают значимые исходные поля с `FOR UPDATE`,
  удерживая обычный объект до commit; порядок блокировок — source, затем review.
  Для Request сравнивается и структурный draft, для Task — ссылки на БТ.
  Изменённый контекст блокирует новое согласование; возврат/отзыв остаются
  возможны при наличии соответствующих прав.
- Новый lifecycle не изменяет Request, Task, пользователей, роли, команды,
  их атрибуты/назначения или справочники. Поля автора/команды в новой рабочей
  записи только ссылаются на существующие данные. Legacy intake endpoint
  повторно проверяет источник и не принимает linked-документ вместо нового
  согласования редакции БТ.

Доказательства: [domain tests](../backend/tests/test_requirement_reviews_domain.py)
и [gateway boundary tests](../backend/tests/test_agent_v2_document_boundary.py).
Это изолированные проверки без backend conftest, живой БД и защищённых fixture
записей. Они не являются подтверждением live PostgreSQL-гонок, внешней защиты
инфраструктуры или допуска в ПРОМ. Миграция новой таблицы в рабочей БД в рамках
проверки не выполнялась.

## Аутентификация

- Новые пароли хэшируются Argon2id; legacy bcrypt требует проверенной активации.
- Access JWT подписывается `SECRET_KEY` алгоритмом `ALGORITHM` (`HS256` по умолчанию).
- Срок access-токена задаёт `ACCESS_TOKEN_EXPIRE_MINUTES`.
- Access-токен хранится только в памяти SPA и передаётся как `Authorization: Bearer`.
- Refresh-токен хранится в cookie `dmb_refresh`, недоступной JavaScript (`HttpOnly`).
- Cookie имеет `SameSite=Strict`, path `/api/v1/auth` и `Secure` при `DEBUG=false`.
- Refresh-сессии хранятся в таблице `refresh_sessions`; токены ротируются, а семейство может быть отозвано при повторном использовании старого токена.
- Logout отзывает серверную AuthSession целиком и удаляет cookie.

Login, refresh и logout вызывают `_require_trusted_origin`. При `DEBUG=false` запрос должен иметь HTTPS Origin из `AUTH_ORIGINS`; отсутствие или несовпадение Origin отклоняется.

## Защита конфигурации

При `DEBUG=false` `validate_runtime_settings()` останавливает запуск, если:

- `SECRET_KEY` отсутствует, равен известному dev-значению или короче 32 символов;
- `AGENT_SECRET` отсутствует или равен известному dev-значению;
- `PRIORITISER_SECRET` отсутствует или равен известному dev-значению;
- не настроен `REDIS_URL`;
- `DATABASE_URL` указывает на SQLite;
- каталог вложений остался локальным `backend/uploads` вместо общего хранилища;
- не задан `CLAMAV_HOST`.

Файл `.env` исключён из Git. Реальный процесс управления и ротации секретов вне репозитория не подтверждён.

## Rate limiting

| Операция | Ключи | Лимит |
|---|---|---|
| Login | IP и HMAC канонического логина | 120/IP/мин; 5 ошибок/логин/5 мин |
| Refresh | IP и sid | 600/IP/мин и 60/sid/мин |

Auth-ключи используют отдельный HMAC-секрет; логин и IP не записываются открытым текстом. После превышения применяется увеличивающийся период блокировки до 15 минут.

Auth-операции требуют Redis и AUTH_RATE_HMAC_KEY: при отсутствии или отказе — 503 без memory fallback. Общий rate_limit.py сохраняется для остальных подсистем.

## Авторизация

Backend использует несколько уровней проверок:

- `get_current_user` валидирует access JWT и загружает активного пользователя;
- `require_permission` проверяет разрешения разделов;
- `require_non_business_customer_access` и `require_backlog_page_access` разделяют портал заказчика и внутренний интерфейс;
- `authorize_task` выполняет объектную проверку чтения, редактирования, комментирования и удаления задачи;
- bulk-операции имеют отдельную проверку области доступа;
- admin endpoints используют собственные dependencies и проверки.

Точная матрица ролей не фиксируется здесь вручную: источниками являются `backend/auth.py`, зарегистрированные dependencies роутеров и `backend/tests/test_security_contracts.py`. Клиентское скрытие меню и маршрутов не является авторизацией.

Межсервисные вызовы разделены по capability secrets: BA agent проверяет
`X-Agent-Secret`, Prioritiser — `X-Prioritiser-Secret`, а его `/admin/*` требует
независимый `X-Methodologist-Secret`. Production-запуск backend отклоняет
локальные значения секретов; `/health` Prioritiser остаётся публичным только
внутри закрытой app network.

## Refresh cookie и CSRF

Система использует cookie только для refresh-токена, поэтому утверждение «cookie не используются» неверно. Риск CSRF для auth endpoints снижается сочетанием:

- `SameSite=Strict`;
- ограниченного cookie path;
- проверки доверенного HTTPS Origin при `DEBUG=false`;
- требования access Bearer для остальных защищённых API.

Отдельный универсальный CSRF token не реализован.

## CORS

`CORSMiddleware` использует `CORS_ORIGINS` и разрешает credentials. В текущем коде разрешены все методы и заголовки (`allow_methods=["*"]`, `allow_headers=["*"]`), а не только вручную перечисленный набор.

CORS не заменяет backend-авторизацию и не является защитой для не-браузерных клиентов.

## XSS и недоверенный HTML

Frontend активно использует `innerHTML`, поэтому нельзя утверждать, что XSS исключён архитектурно. Для недоверенных значений предусмотрены `escapeHtml`, `escapeHtmlAttribute`, безопасная установка через `textContent` и проверка внешних URL.

Наличие экранирования подтверждается unit-тестами, включая `frontend/tests/htmlUtils.test.mjs` и контрактные проверки модулей. При добавлении нового HTML-шаблона каждое динамическое значение должно быть явно экранировано или назначено через безопасное DOM API.

Production Nginx задаёт `frame-ancestors 'none'`, `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'`, а также `nosniff`, `DENY`,
`same-origin` Referrer-Policy и запрет camera/microphone/geolocation.

## SQL и схема БД

Прикладные операции преимущественно используют SQLAlchemy ORM. Утверждение об полном отсутствии raw SQL неверно: `database.ensure_schema()` формирует аддитивный `ALTER TABLE ADD COLUMN` для обслуживания схемы.

Изменение схемы ограничено правилами `SCHEMA_CHANGES.md`. Защита данных также зависит от корректной объектной авторизации, а не только от параметризации запросов.

## Вложения

- Файлы сохраняются под сгенерированным именем в `backend/uploads/{task_id}`.
- Размер загрузки ограничен 50 MiB и контролируется при потоковой записи чанками 1 MiB.
- Активные исполняемые расширения запрещены; для PDF, PNG, JPEG и ZIP/Office
  проверяется сигнатура содержимого.
- Скачивание выполняется через авторизованный endpoint с проверкой доступа к задаче.
- Путь скачивания нормализуется и проверяется через `os.path.commonpath`.
- MIME type остаётся метаданными клиента и не заменяет сигнатурные проверки.
- При заданном `CLAMAV_HOST` файл до фиксации метаданных передаётся в ClamAV по
  протоколу INSTREAM; `FOUND`, неожиданный ответ и недоступность сканера прерывают
  загрузку. В production `CLAMAV_HOST` обязателен, в локальном DEBUG-контуре
  отсутствие адреса явно отключает внешний сканер.

## Аудит и журналы

`AuditMiddleware` обрабатывает изменяющие `/api/` запросы и создаёт `AuditLog` со следующими данными:

- user ID из Bearer-токена, если он доступен;
- метод, путь, HTTP status и признак успеха;
- тип и ID сущности, извлечённые из URL;
- список имён изменённых полей без значений;
- IP-адрес и timestamp.

Чувствительные имена полей (`password`, токены, secret, authorization) исключаются из списка changed fields. Ошибка записи аудита логируется, но не отменяет основной запрос; поэтому аудит является best-effort, а не гарантированной транзакционной записью.

`LoggingMiddleware` пишет метод, путь, статус, длительность и IP в `backend/logs/app.log` и stderr. Централизованное хранение, retention и защита журналов вне процесса не подтверждены.

## Подтверждённые ограничения

- CSP задаётся production Nginx; при обходе этого ingress заголовки отсутствуют.
- Эффективность антивирусной проверки зависит от внешнего ClamAV; его базы,
  обновление сигнатур и эксплуатационный мониторинг находятся вне приложения.
- Memory rate limiter не подходит для multi-instance.
- Audit middleware не атомарен с бизнес-транзакцией.
- `/api/v1/health` намеренно является liveness без зависимостей;
  `/api/v1/health/ready` проверяет БД, Redis, общее хранилище, BA Agent и Prioritiser.
- Nginx, firewall, TLS termination, SIEM, backup и incident-response процессы не представлены исполняемой конфигурацией репозитория.

## Проверки

Основные security-тесты находятся в:

- `backend/tests/test_security_contracts.py`;
- `backend/tests/test_auth.py`;
- `backend/tests/test_auth_cookie_policy.py`;
- `backend/tests/test_rate_limit.py`;
- `backend/tests/test_admin_safety.py`;
- `backend/tests/test_attachment_scanner.py`;
- `frontend/tests/htmlUtils.test.mjs`;
- `frontend/tests/moduleContracts.test.mjs`.

Исторический документ со смешанными реализованными и рекомендуемыми мерами сохранён в `archive/legacy/SECURITY_MIXED_2026-06-29.md` и не является источником текущего состояния.

## Legacy Assistant V2 boundary — проверено 19.09.2026

`ASSISTANT_V2_ALLOW_REAL_DATA=false` является отдельным fail-closed stop-gate:
он блокирует создание и чтение `approved_real` cases, authorized DMB snapshots,
ProposedDiff, rebase и apply intent. Synthetic UI явно предупреждает не вводить
реальные данные.

Pilot доступ не создаёт новых ролей: после обычной DMB-аутентификации
автоматически допускается `admin=full`, а для остальных используется env allowlist
ID/email. Глобальный feature flag остаётся приоритетным stop-gate и блокирует V2
также для админа. Signed actor envelope ограничен issuer/audience/TTL,
содержит jti и проверяется на replay; adapter дополнительно требует отдельный
service secret, заново загружает активного DMB user и применяет object policy.
Diff allowlist исключает users, roles, teams, dictionaries, owners и lifecycle
поля. Остаточные production-риски и stop gates перечислены в
[`../../assistant-v2/docs/THREAT_MODEL.md`](../../assistant-v2/docs/THREAT_MODEL.md).


Контракт, проверки и границы приёмки: [ACCOUNT_SECURITY.md](ACCOUNT_SECURITY.md). Проверено 12.10.2026; cutover рабочей БД не выполнялся.



## Рабочие задачи — проверено 16.10.2026

WorkTask применяет общий SQL scope для списка, прямого чтения, уведомлений и SSE. Принадлежность к поручению не открывает Task. Customer получает только проекцию явно связанного результата; файлы требуют права чтения WorkTask.

Фактический scope, API, миграция и ограничения: [Рабочие задачи](WORK_TASKS.md).


### Этап 5 рабочих задач — проверено 16.10.2026

Реализованы атомарное разбиение запросов, отдельный отчёт с доступными агрегатами
и неизменяемые снимки встреч. PostgreSQL обновлён до `a1b2c3d4e517`; интеграционный
прогон выполнен без записи защищённых данных. [Контракты, поведение и проверки](WORK_TASKS.md#этап-5-разбиение-и-отчётность).
