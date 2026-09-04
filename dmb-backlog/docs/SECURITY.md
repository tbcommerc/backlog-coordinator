---
title: Безопасность Backlog coordinator
scope: as-is
status: verified
last_verified: 2026-09-01
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
  - frontend/js/api.js
  - frontend/js/auth.js
  - frontend/js/htmlUtils.js
  - backend/tests/test_security_contracts.py
  - backend/tests/test_auth_cookie_policy.py
  - frontend/tests/htmlUtils.test.mjs
---

# Безопасность Backlog coordinator

Документ фиксирует реализованные механизмы. Он не подтверждает внешнюю инфраструктуру, регламенты организации или production-процессы, которых нет в репозитории.

## Аутентификация

- Пароли хэшируются и проверяются через passlib/bcrypt.
- Access JWT подписывается `SECRET_KEY` алгоритмом `ALGORITHM` (`HS256` по умолчанию).
- Срок access-токена задаёт `ACCESS_TOKEN_EXPIRE_MINUTES`.
- Access-токен хранится только в памяти SPA и передаётся как `Authorization: Bearer`.
- Refresh-токен хранится в cookie `dmb_refresh`, недоступной JavaScript (`HttpOnly`).
- Cookie имеет `SameSite=Strict`, path `/api/v1/auth` и `Secure` при `DEBUG=false`.
- Refresh-сессии хранятся в таблице `refresh_sessions`; токены ротируются, а семейство может быть отозвано при повторном использовании старого токена.
- Logout отзывает текущую refresh-сессию и удаляет cookie.

Login, refresh и logout вызывают `_require_trusted_origin`. При `DEBUG=false` запрос должен иметь HTTPS Origin из `CORS_ORIGINS`; отсутствие или несовпадение Origin отклоняется.

## Защита конфигурации

При `DEBUG=false` `validate_runtime_settings()` останавливает запуск, если:

- `SECRET_KEY` отсутствует, равен известному dev-значению или короче 32 символов;
- `AGENT_SECRET` отсутствует или равен известному dev-значению;
- не настроен `REDIS_URL`.
- `DATABASE_URL` указывает на SQLite.

Файл `.env` исключён из Git. Реальный процесс управления и ротации секретов вне репозитория не подтверждён.

## Rate limiting

| Операция | Ключи | Лимит |
|---|---|---|
| Login | IP и хэш нормализованного email | 5 запросов за 60 секунд |
| Refresh | IP | 10 запросов за 60 секунд |

Ключи хэшируются SHA-256, поэтому email и IP не записываются в ключ rate limiter открытым текстом. После превышения применяется увеличивающийся период блокировки до 15 минут.

При наличии `REDIS_URL` используется Redis. Без него включается ограниченный process-local memory fallback, предназначенный для разработки.

## Авторизация

Backend использует несколько уровней проверок:

- `get_current_user` валидирует access JWT и загружает активного пользователя;
- `require_permission` проверяет разрешения разделов;
- `require_non_business_customer_access` и `require_backlog_page_access` разделяют портал заказчика и внутренний интерфейс;
- `authorize_task` выполняет объектную проверку чтения, редактирования, комментирования и удаления задачи;
- bulk-операции имеют отдельную проверку области доступа;
- admin endpoints используют собственные dependencies и проверки.

Точная матрица ролей не фиксируется здесь вручную: источниками являются `backend/auth.py`, зарегистрированные dependencies роутеров и `backend/tests/test_security_contracts.py`. Клиентское скрытие меню и маршрутов не является авторизацией.

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

Политика CSP в приложении не подтверждена. Пример Nginx из исторического документа не является реализованной защитой.

## SQL и схема БД

Прикладные операции преимущественно используют SQLAlchemy ORM. Утверждение об полном отсутствии raw SQL неверно: `database.ensure_schema()` формирует аддитивный `ALTER TABLE ADD COLUMN` для обслуживания схемы.

Изменение схемы ограничено правилами `SCHEMA_CHANGES.md`. Защита данных также зависит от корректной объектной авторизации, а не только от параметризации запросов.

## Вложения

- Файлы сохраняются под сгенерированным именем в `backend/uploads/{task_id}`.
- Размер загрузки ограничен 50 MiB.
- Скачивание выполняется через авторизованный endpoint с проверкой доступа к задаче.
- Путь скачивания нормализуется и проверяется через `os.path.commonpath`.
- MIME type берётся из данных загрузки; антивирусная проверка содержимого не подтверждена.

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

- Нет универсального CSP в коде приложения.
- Нет подтверждённого antivirus/content scanning для вложений.
- Memory rate limiter не подходит для multi-instance.
- Audit middleware не атомарен с бизнес-транзакцией.
- Health endpoint не проверяет зависимости.
- Nginx, firewall, TLS termination, SIEM, backup и incident-response процессы не представлены исполняемой конфигурацией репозитория.

## Проверки

Основные security-тесты находятся в:

- `backend/tests/test_security_contracts.py`;
- `backend/tests/test_auth.py`;
- `backend/tests/test_auth_cookie_policy.py`;
- `backend/tests/test_rate_limit.py`;
- `backend/tests/test_admin_safety.py`;
- `frontend/tests/htmlUtils.test.mjs`;
- `frontend/tests/moduleContracts.test.mjs`.

Исторический документ со смешанными реализованными и рекомендуемыми мерами сохранён в `archive/legacy/SECURITY_MIXED_2026-06-29.md` и не является источником текущего состояния.
