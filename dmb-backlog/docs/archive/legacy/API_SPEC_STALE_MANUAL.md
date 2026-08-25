# API Спецификация DMB Backlog

**Версия:** 3.1  
**Дата:** 2026-07-25

---

## OpenAPI-спецификация

Спецификация API генерируется автоматически из кода FastAPI (Pydantic-схемы + route декораторы) и доступна в интерактивном виде:

| Инструмент | URL |
|-----------|-----|
| **Swagger UI** (документация + тестирование) | `http://localhost:8000/docs` |
| **ReDoc** (альтернативная документация) | `http://localhost:8000/redoc` |
| **OpenAPI JSON** (machine-readable) | `http://localhost:8000/openapi.json` |

---

## Base URL

```
http://localhost:8000/api/v1
```

## Аутентификация

Все защищённые эндпоинты требуют заголовок:
```
Authorization: Bearer <access_token>
```

Access Token: 60 минут. Refresh Token: 7 дней.

---

## Rate Limiting

Ограничения на количество запросов реализованы на уровне middleware (in-memory):

| Эндпоинт | Лимит | Окно |
|----------|-------|------|
| `POST /auth/login` | 5 запросов | 60 секунд |
| `POST /auth/refresh` | 10 запросов | 60 секунд |
| Все остальные | Не ограничены | — |

При превышении лимита возвращается:
```json
{
  "detail": "Rate limit exceeded"
}
```
с HTTP-статусом **429 Too Many Requests**.

Ограничения сбрасываются при перезапуске сервера (in-memory хранилище). Для multi-instance рекомендуется Redis.

---

## Версионирование API

API версионируется через префикс пути: `/api/v1/`.

**Правила версионирования:**
- Новая мажорная версия (`/api/v2/`) — при breaking changes (изменение формата ответа, удаление полей)
- Минорные изменения — добавляются в текущую версию (добавление полей, новых эндпоинтов)
- **Обратная совместимость**: новые поля добавляются в response без удаления старых
- **Deprecation**: старые эндпоинты помечаются заголовком `X-API-Deprecated: true` и удаляются через 2 мажорных релиза

Текущая версия: **v1**.

---

## Пагинация

Все эндпоинты, возвращающие списки, поддерживают пагинацию.

### Параметры запроса

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|-------------|----------|
| `page` | int | 1 | Номер страницы (≥ 1) |
| `per_page` | int | 100 | Количество элементов на странице (1-1000) |

### Формат ответа

```json
{
  "items": [ ... ],
  "total": 150,
  "page": 1,
  "per_page": 100,
  "pages": 2
}
```

### Правила работы с пагинацией

- При `page=1` возвращаются первые `per_page` записей
- При `page > pages` возвращается пустой массив `items`
- Максимальное значение `per_page` — 1000
- Значение `total` не зависит от фильтрации — общее количество записей, удовлетворяющих фильтрам
- Для получения всех записей используйте `per_page=1000` (на текущий момент ~150 задач)

---

## AUTH

### POST /auth/login
Вход в систему.

**Request:**
```json
{
  "email": "t.babiak@dmb.ru",
  "password": "dmb2026"
}
```

**Response 200:**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {
    "id": 1,
    "name": "Т. Бабиак",
    "email": "t.babiak@dmb.ru",
    "role": "Лидер Трайба",
    "team": "Pre-trade"
  }
}
```

**Response 401:**
```json
{
  "detail": "Invalid email or password"
}
```

### POST /auth/refresh
Обновление access token.

**Request:**
```json
{
  "refresh_token": "eyJ..."
}
```

**Response 200:** аналогично `/login`

### POST /auth/logout
Инвалидация refresh token (на стороне клиента).

**Response 200:**
```json
{
  "message": "Logged out successfully"
}
```

### GET /auth/me
Текущий пользователь.

**Response 200:**
```json
{
  "id": 1,
  "email": "t.babiak@dmb.ru",
  "name": "Т. Бабиак",
  "position": "PO · Pre-trade",
  "team": "Pre-trade",
  "role_id": 2,
  "is_active": true,
  "last_login": "2026-06-23T09:42:00Z",
  "created_at": "2026-01-15T10:00:00Z",
  "role_name": "Лидер Трайба",
  "team_name": "Pre-trade"
}
```

---

## TASKS

### GET /tasks
Получить список задач с фильтрацией.

**Query params:**
- `team_id` (int, optional)
- `status` (string, optional)
- `priority` (string, optional)
- `key_project` (bool, optional)
- `search` (string, optional) — полнотекстовый поиск по title, description, owner, status, team_name, project, business_customer
- `sort_by` (string, optional): id|priority|deadline|progress|...
- `sort_order` (string, optional): asc|desc
- `page` (int, default 1)
- `per_page` (int, default 100)

**Response 200:**
```json
{
  "items": [
    {
      "id": 1,
      "team_id": 1,
      "title": "Интеграция с API Центрального Банка",
      "description": "Подключение к новому API ЦБ...",
      "date_received": "2026-06-01",
      "source_channel": "Поручение ДИД",
      "business_customer": "ДИД",
      "customer_department": "Департамент развития",
      "project": "Alfa-Trading",
      "task_type": "Feature",
      "involved_teams": "Risk,Compliance",
      "priority": "Высокий",
      "status": "В работе",
      "deadline": "3Q 26",
      "effort_days": 10,
      "effort_rub": 2.5,
      "financial_effect": 15.0,
      "cv": 6.0,
      "progress": 45,
      "status_comment": null,
      "tags": "backend,data",
      "owner": "Фомин Д.",
      "key_project": true,
      "key_project_status": "В работе",
      "created_by": 1,
      "created_at": "2026-06-01T10:00:00Z",
      "updated_at": "2026-06-20T14:30:00Z",
      "team_name": "Pre-trade"
    }
  ],
  "total": 150,
  "page": 1,
  "per_page": 100,
  "pages": 2
}
```

### GET /tasks/search
Поиск задач по названию, владельцу, полям (полнотекстовый поиск).

**Query params:** `q` (string, min 1 символ)

**Response 200:** массив `TaskResponse` (макс. 10 результатов)

### GET /tasks/stats
Агрегированная статистика по задачам.

**Response 200:**
```json
{
  "total": 150,
  "active": 120,
  "risk": 8,
  "key_projects": 12,
  "no_estimate": 5,
  "by_status": {
    "Сбор требований": 20,
    "Экспресс-оценка": 15,
    "В работе": 45
  },
  "by_priority": {
    "Высокий": 30,
    "Средний": 80,
    "Низкий": 40
  },
  "by_team": {
    "Pre-trade": {"total": 20, "active": 15, "avg_progress": 45.0}
  },
  "total_financial_effect": 1250.0,
  "avg_progress": 42.5
}
```

### GET /tasks/report/{kind}
Сгенерировать отчёт по типу.

**Path params:** `kind` = `directorate` | `did` | `projects` | `reg-directors`

**Response 200:** содержит поля `kind`, `total` и `groups` (группировка по проекту/заказчику/команде).

### GET /tasks/analytics
Аналитические агрегации.

**Query params:** `type` = `tribe` | `po-pl`

**tribe response:** `high_cv_tasks`, `low_cv_tasks`, `risk_by_team`, `portfolio_health`, `team_financial_effect`

**po-pl response:** `workload_by_team`, `deadline_compliance`, `key_projects_progress`, `missing_attributes`

### GET /tasks/{id}
Получить одну задачу.

**Response 200:** объект задачи (см. GET /tasks)

**Response 404:**
```json
{
  "detail": "Task not found"
}
```

### POST /tasks
Создать задачу (требует `backlog_team: write_own`).

**Обязательные поля:** `title` (min_length=1), `team_id`, `priority_id`

**Опциональные поля:** `description`, `date_received`, `business_customer`, `project_id`, `task_type_id`, `channel_id`, `department_id`, `deadline_id`, `effort_days`, `effort_rub`, `financial_effect`, `progress` (default: 0), `key_project`, `is_from_leadership`, `is_regular`, `ice_impact`, `ice_confidence`, `ice_ease`, `link_mockups`, `link_jira`, `comment`

**Бизнес-логика:**
- `status_id` устанавливается в 1 (НОВАЯ ЗАДАЧА) по умолчанию
- `cv` = `financial_effect / effort_rub` (если оба заполнены и effort_rub > 0)
- `ice_score` = `(ice_impact × ice_confidence × ice_ease) / 10` (если все три заполнены)
- `actual_effort_days` = сумма полей ФТЗ (`actual_effort_designee`, `actual_effort_analytics`, `actual_effort_be`, `actual_effort_python_be`, `actual_effort_fe`, `actual_effort_test`, `actual_effort_test_auto`, `actual_effort_delivery`); входящее значение игнорируется
- Создаётся запись в `task_history` для обязательных + заполненных полей
- Создаётся запись в `audit_log` (action=create, entity_type=task)
- `created_by` устанавливается из JWT-токена текущего пользователя

**Request:**
```json
{
  "team_id": 1,
  "title": "Интеграция с API ЦБ",
  "description": "Описание задачи...",
  "priority_id": 1,
  "date_received": "2026-06-01",
  "business_customer": "ДИД",
  "project_id": 2,
  "task_type_id": 1,
  "channel_id": 1,
  "effort_days": 10,
  "effort_rub": 2500000,
  "financial_effect": 15000000,
  "ice_impact": 8,
  "ice_confidence": 7,
  "ice_ease": 6
}
```

**Response 201:** объект задачи с вычисленными `cv`, `ice_score`, `status_id = 1`

### POST /tasks/import
Импорт задач из CSV-файла (требует `backlog_team: write_own`).

**Content-Type:** `multipart/form-data`

**Параметры:**
- `file` (UploadFile) — CSV-файл (обязательное)

**Бизнес-логика:**
- Разделитель определяется автоматически: точка с запятой (`;`) или запятая (`,`)
- Декодирование: UTF-8-SIG (BOM) → Windows-1251
- Заголовки CSV сопоставляются с полями БД по русским меткам из `field_labels` (fallback — прямые DB-ключи)
- Колонка «ID задачи» / `id` трактуется как `external_id` (внешний идентификатор задачи)
- Обязательные поля: `title`, `team_id` (помечены `is_required=1` в `field_labels`)
- Справочные поля (team_id, channel_id, business_customer_id, department_id, project_id, task_type_id, priority_id, deadline_id, status_id) — поиск по `name` без учёта регистра; если не найдено — строка пропускается с ошибкой
- Поле `owner_id` — если исполнитель не найден, строка импортируется, поле пропускается (не fatal)
- Дубликаты по `external_id` (в файле или в БД) — строка пропускается
- Множественные ссылки Jira записываются в `task_jira_links` (нормализованная таблица) и синхронизируются с JSON-колонкой `tasks.link_jira` (двойная запись)
- Для каждой созданной задачи записывается `task_history` (обязательные + заполненные поля) и `audit_log` (action=import, entity_type=task)
- Ошибочные строки пропускаются, валидные импортируются. Ошибки не прерывают обработку файла.

**Response 200:**
```json
{
  "total": 10,
  "created": 8,
  "skipped": 2,
  "errors": [
    {
      "row": 3,
      "field": "team_id",
      "field_label": "Ответственная команда",
      "value": "НетТакойКоманды",
      "type": "team_not_found",
      "message": "Команда \"НетТакойКоманды\" не найдена в справочнике команд",
      "fatal": true
    },
    {
      "row": 5,
      "field": "title",
      "field_label": "Название задачи",
      "value": "",
      "type": "required_missing",
      "message": "Поле \"Название задачи\" обязательно для заполнения",
      "fatal": true
    }
  ],
  "task_ids": [101, 102, 103, 104, 105, 106, 107, 108]
}
```

**Типы ошибок (16 типов):**
- `team_not_found`, `channel_not_found`, `business_customer_not_found`, `department_not_found`, `project_not_found`, `task_type_not_found`, `priority_not_found`, `deadline_not_found`, `status_not_found` — справочник не найден (fatal)
- `owner_not_found` — исполнитель не найден (не fatal, строка импортируется)
- `required_missing` — обязательное поле не заполнено (fatal)
- `invalid_date` — неверный формат даты (fatal)
- `invalid_number` — неверный числовой формат (fatal)
- `invalid_progress` — прогресс вне диапазона 0-100 (fatal)
- `duplicate_external_id` — дубликат внешнего ID (fatal)
- `unknown_error` — неизвестная ошибка (fatal)

**Response 400:** Файл пуст / не CSV
**Response 403:** Нет прав
**Response 500:** Ошибка импорта

### PUT /tasks/{id}
Обновить задачу (передаются только изменяемые поля). Автоматически создаётся запись в `task_history` для каждого изменённого поля.

**Параметры запроса:**
- Все поля из TaskUpdate (опциональные)
- `version` (int) — текущая версия задачи для optimistic lock. Если передана и не совпадает с текущей версией в БД — 409 Conflict.
- `force_save` (bool, default: false) — принудительное сохранение. Если true — игнорирует проверку version и перезаписывает данные. Используется при разрешении конфликта версий.

**Блокировка:** Если задача заблокирована другим пользователем — ответ 423 (Locked). Если заблокирована текущим пользователем — обновление разрешено (блокировка сохраняется).

**Оптимистическая блокировка:** Если `version` в запросе не совпадает с `version` в БД — ответ 409 Conflict с текущим состоянием задачи для разрешения конфликта.

**Бизнес-логика при обновлении:**
- Если изменены `financial_effect` или `effort_rub` — пересчитывается `cv`
- Если изменены `ice_impact`, `ice_confidence` или `ice_ease` — пересчитывается `ice_score`
- Если изменено любое поле ФТЗ (`actual_effort_*` по 8 компетенциям) — пересчитывается `actual_effort_days` = их сумма; входящее значение `actual_effort_days` игнорируется
- Все изменения записываются в `task_history` (field_name, old_value, new_value)

**Response 200:** обновлённый объект задачи

**Response 409:** Версия задачи изменилась (optimistic lock conflict)
```json
{
  "detail": {
    "message": "Задача была изменена другим пользователем. Пожалуйста, обновите страницу и повторите изменения.",
    "current_version": 5,
    "submitted_version": 3,
    "task": { "id": 1, "version": 5, "..." : "..." }
  }
}
```

### DELETE /tasks/{id}
Мягкое удаление задачи (ставит `is_deleted = True`).

**Response 200:**
```json
{
  "message": "Task deleted"
}
```

### GET /tasks/{id}/lock
Получить статус блокировки задачи.

**Response 200:**
```json
{
  "locked": true,
  "lock_owner_id": 3,
  "lock_owner_name": "Иванов И.И.",
  "lock_until": "2026-07-27T15:30:00Z",
  "is_mine": false
}
```

### POST /tasks/{id}/lock
Захватить блокировку (15 минут). Если уже заблокирована другим пользователем — 423. Если заблокирована текущим пользователем — продлевает.

**Response 200:**
```json
{
  "locked": true,
  "lock_owner_id": 3,
  "lock_owner_name": "Иванов И.И.",
  "lock_until": "2026-07-27T15:45:00Z",
  "is_mine": true
}
```

**Response 423:**
```json
{
  "detail": "Задача в данный момент редактируется пользователем Петров П.П."
}
```

### DELETE /tasks/{id}/lock
Снять блокировку (только владелец). Fire-and-forget на клиенте.

**Response 200:** `{ "message": "Lock released" }`

### POST /tasks/{id}/viewers
Зарегистрировать текущего пользователя как «смотрящего». Если уже зарегистрирован — обновляет `last_seen_at`.

**Response 200:**
```json
{
  "user_id": 3,
  "user_name": "Иванов И.И.",
  "last_seen_at": "2026-07-27T15:30:00Z"
}
```

### GET /tasks/{id}/viewers
Получить список активных «смотрящих» (кроме текущего пользователя). Автоматически удаляет записи старше 10 минут.

**Response 200:**
```json
{
  "viewers": [
    {
      "user_id": 5,
      "user_name": "Петров П.П.",
      "last_seen_at": "2026-07-27T15:28:00Z"
    }
  ]
}
```

### DELETE /tasks/{id}/viewers
Удалить текущего пользователя из списка «смотрящих». Вызывается при закрытии модалки задачи.

**Response 200:** `{ "message": "ok" }`

### POST /tasks/bulk
Массовые операции.

**Request:**
```json
{
  "action": "close|hold|delete",
  "task_ids": [1, 2, 3]
}
```

**Response 200:**
```json
{
  "message": "Action 'close' applied to 3 tasks"
}
```

### GET /tasks/{id}/comments
Получить комментарии задачи (древовидная структура: корневые + вложенные ответы).

**Response 200:**
```json
{
  "items": [
    {
      "id": 1,
      "task_id": 10,
      "user_id": 3,
      "user_name": "Иванов И.И.",
      "text": "Нужно ускорить реализацию",
      "mentioned_user_ids": [5, 7],
      "parent_id": null,
      "replies": [
        {
          "id": 2,
          "task_id": 10,
          "user_id": 5,
          "user_name": "Петров П.П.",
          "text": "Принято, начну завтра",
          "mentioned_user_ids": null,
          "parent_id": 1,
          "replies": [],
          "created_at": "2026-07-24T16:00:00Z"
        }
      ],
      "created_at": "2026-07-24T15:30:00Z"
    }
  ],
  "total": 5
}
```

Корневые комментарии (`parent_id=null`) содержат массив `replies` с вложенными ответами. `total` — общее количество комментариев (включая ответы всех уровней).

### POST /tasks/{id}/comments
Добавить комментарий к задаче. Поддерживает ответы на другие комментарии через `parent_id`.
Автоматически создаёт:
- запись в `task_history` (field="comment")
- уведомления типа `mention` для каждого @упомянутого пользователя

**Request:**
```json
{
  "text": "Начать завтра, @petrov посодействовать",
  "parent_id": 1
}
```
```

**Синтаксис @-упоминаний:** `@login` — ищет пользователя по логину (без пробелов). При вводе `@` появляется выпадающий список пользователей для выбора.

**Response 201:** созданный комментарий

**Response 422:** `"Комментарий не может быть пустым"`

---

## ВЛОЖЕНИЯ (ATTACHMENTS)

### GET /tasks/{task_id}/attachments
Список файловых вложений задачи.

**Headers:** `Authorization: Bearer <token>`

**Response 200:**
```json
{
  "items": [
    {
      "id": 1,
      "task_id": 44,
      "user_id": 2,
      "user_name": "Иван Иванов",
      "filename": "a1b2c3d4.pdf",
      "original_name": "specification.pdf",
      "mime_type": "application/pdf",
      "file_size": 1048576,
      "download_url": "/uploads/44/a1b2c3d4.pdf",
      "created_at": "2026-07-24T15:00:00"
    }
  ],
  "total": 1
}
```

---

### POST /tasks/{task_id}/attachments
Загрузка файла к задаче.

**Headers:** `Authorization: Bearer <token>`, `Content-Type: multipart/form-data`

**Body (form-data):**
| Поле | Тип | Описание |
|------|-----|----------|
| file | File | Файл (макс. 50 МБ) |

**Response 201:** созданный объект вложения (см. GET response item)

**Response 413:** `"File too large (max 50 MB)"`

**Side effects:**
- Файл сохраняется в `uploads/{task_id}/{uuid}.{ext}`
- Создаётся запись в `task_history` (field="attachment", new_value="Загружен файл: name.ext")

---

### DELETE /tasks/{task_id}/attachments/{attachment_id}
Удаление вложения.

**Headers:** `Authorization: Bearer <token>`

**Response 200:**
```json
{"success": true, "detail": null}
```

**Side effects:**
- Файл удаляется с диска
- Создаётся запись в `task_history` (field="attachment", old_value="Удалён файл: name.ext")

---

### PUT /tasks/{task_id}/links
Обновление ссылок на макеты и Jira.

**Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`

**Body:**
```json
{
  "link_mockups": "https://figma.com/file/abc123",
  "link_jira": "https://jira.example.com/PROJ-123"
}
```

Оба поля опциональны. Переданные значения заменяют текущие. Пустая строка или `null` очищает поле.

**Response 200:** обновлённая задача (TaskResponse)

**Side effects:**
- Для каждого изменённого поля создаётся запись в `task_history`

---

## TEAMS

### GET /teams
Список всех команд.

**Response 200:**
```json
[
  {
    "id": 1,
    "name": "Pre-trade",
    "color": "indigo",
    "domain": "Pre-trade",
    "description": "Pre-trade системы и аналитика",
    "pl": "М. Первак",
    "po": "Д. Фомин",
    "cl": null,
    "members": null,
    "created_at": "2026-01-15T10:00:00Z",
    "member_count": 0
  }
]
```

### GET /teams/{id}
Команда по ID.

### POST /teams
Создать команду (требует `admin: partial`).

### PUT /teams/{id}
Обновить команду (требует `admin: partial`).

### DELETE /teams/{id}
Удалить команду (требует `admin: full`).

---

## USERS

### GET /users
Список активных пользователей.

**Response 200:**
```json
[
  {
    "id": 1,
    "email": "t.babiak@dmb.ru",
    "name": "Т. Бабиак",
    "position": "PO · Pre-trade",
    "team": "Pre-trade",
    "role_id": 2,
    "is_active": true,
    "last_login": "2026-06-23T09:42:00Z",
    "created_at": "2026-01-15T10:00:00Z",
    "role_name": "Лидер Трайба",
    "team_name": "Pre-trade"
  }
]
```

### GET /users/{id}
Пользователь по ID.

### POST /users
Создать пользователя (требует `admin: partial`).

**Request:**
```json
{
  "email": "new.user@dmb.ru",
  "password": "secure_password",
  "name": "New User",
  "position": "Developer",
  "team": "Core",
  "role_id": 3,
  "is_active": true
}
```

**Response 201:** объект пользователя (без password_hash)

**Response 400:**
```json
{
  "detail": "Email already registered"
}
```

### PUT /users/{id}
Обновить пользователя (требует `admin: partial`).

### DELETE /users/{id}
Деактивировать пользователя (is_active = false) (требует `admin: full`).

---

## ROLES

### GET /roles

**Response 200:**
```json
[
  {
    "id": 1,
    "name": "Администратор",
    "status": "active",
    "description": null,
    "backlog_dmb_access": "read_write",
    "backlog_team_access": "write_all",
    "reports_access": "read_write",
    "settings_access": "available",
    "admin_access": "full",
    "can_edit_tasks": true,
    "can_delete_tasks": true,
    "can_export": true,
    "created_at": "2026-01-15T10:00:00Z"
  }
]
```

### POST /roles — создать роль (требует `admin: partial`)
### PUT /roles/{id} — обновить роль (требует `admin: partial`)
### DELETE /roles/{id} — удалить роль (требует `admin: partial`)

---

## REPORTS

### GET /reports
Список отчётов (стандартные + пользовательские текущего пользователя + публичные).

**Response 200:**
```json
[
  {
    "id": 1,
    "name": "Статус для оперативки DMB",
    "description": "Приоритет Высокий + риски · все команды",
    "type": "standard",
    "filters": "[{\"field\":\"priority\",\"operator\":\"equals\",\"value\":\"Высокий\"}]",
    "fields": null,
    "group_by": null,
    "sort_by": null,
    "sort_order": "asc",
    "is_public": true,
    "created_by": null,
    "created_at": "2026-01-15T10:00:00Z"
  }
]
```

### GET /reports/{id}
Получить отчёт по ID.

**Response 200:** объект отчёта (аналогично элементу списка)

**Response 404:** `{ "detail": "Report not found" }`

### POST /reports
Создать пользовательский отчёт.

**Request:**
```json
{
  "name": "Мои задачи команды",
  "description": "Задачи моей команды в статусе В РАБОТЕ",
  "type": "custom",
  "filters": "[{\"field\":\"team_name\",\"operator\":\"equals\",\"value\":\"Pre-trade\"},{\"field\":\"status_name\",\"operator\":\"equals\",\"value\":\"ПРИНЯТА В РАБОТУ\"}]",
  "fields": "[\"title\",\"priority_name\",\"status_name\",\"progress\",\"owner_name\"]",
  "group_by": "status_name",
  "sort_by": "priority_name",
  "sort_order": "desc",
  "is_public": false
}
```

**Response 201:** созданный объект отчёта

### PUT /reports/{id}
Обновить отчёт (передаются только изменяемые поля).

**Request:** аналогично POST (любая комбинация полей)

**Response 200:** обновлённый объект отчёта

**Response 404:** `{ "detail": "Report not found" }`

### DELETE /reports/{id}
Удалить отчёт.

**Response 200:** `{ "message": "Report deleted" }`

**Response 404:** `{ "detail": "Report not found" }`

### GET /reports/{id}/execute
Выполнить отчёт с его фильтрами, группировкой и сортировкой.

**Бизнес-логика:**
- Применяет фильтры из JSON (поддержка операторов: equals, not_equals, contains, in, gt, lt)
- Для строковых фильтров (team_name, status_name, priority_name, project_name) выполняет JOIN со справочниками
- Применяет сортировку (sort_by + sort_order: asc/desc)
- Если указана группировка (group_by) — группирует результаты

**Response 200 (без группировки):**
```json
{
  "total": 25,
  "items": [
    {
      "id": 1,
      "title": "Задача 1",
      "team_name": "Pre-trade",
      "priority_name": "Высокий",
      "status_name": "ПРИНЯТА В РАБОТУ",
      "progress": 45,
      "financial_effect": 15.0,
      "owner_name": "Фомин Д."
    }
  ],
  "grouped": false
}
```

**Response 200 (с группировкой):**
```json
{
  "total": 25,
  "grouped": true,
  "group_field": "status_name",
  "groups": [
    {
      "name": "ПРИНЯТА В РАБОТУ",
      "count": 15,
      "items": [ ... ]
    },
    {
      "name": "ВЫПОЛНЕНА",
      "count": 10,
      "items": [ ... ]
    }
  ]
}
```

---

## ADMIN (Dictionaries + Notification Templates)

### GET /admin/priorities
### GET /admin/statuses
### GET /admin/task-types
### GET /admin/business-customers
### GET /admin/competency-costs

Историчный справочник стоимости компетенций (таблица `competency_cost_history`): каждая запись — пара «компетенция × год» со ставкой в руб/день. При расчёте стоимости задачи берётся ставка года её дедлайна; при отсутствии дедлайна/года — ставка последнего (актуального) года.

**Response 200:**
```json
[
  {
    "id": 1,
    "competency": "Разработка FE",
    "year": 2026,
    "rate": 13000,
    "is_active": true,
    "created_at": "2026-01-15T10:00:00Z",
    "updated_at": "2026-01-15T10:00:00Z"
  }
]
```

PUT/POST/DELETE требуют `admin: partial` и проверяют блокировку — HTTP 423 если справочник заблокирован другим пользователем.

### POST /admin/competency-costs

Создание записи ставки: `{ "competency": "Разработка FE", "year": 2027, "rate": 14000 }`. Если пара компетенция×год уже существует — запись реактивируется и ставка обновляется.

### PUT /admin/competency-costs/{competency}/{year}

Обновление ставки (upsert): `{ "rate": 14000 }`. После изменения автоматически пересчитываются `effort_rub` (и `cv`) всех задач с заполненными ЭО по ролям — ставки берутся по году дедлайна каждой задачи.

### DELETE /admin/competency-costs/{competency}/{year}

Soft-delete записи (`is_active=false`) с последующим пересчётом `effort_rub`/`cv` задач.

### GET /admin/dict-locks
Статус блокировки всех справочников (для отображения индикаторов на карточках).

**Response 200:**
```json
{
  "priority": {
    "locked": true,
    "lock_owner_id": 1,
    "lock_owner_name": "Иванов И.И.",
    "lock_until": "2026-07-27T12:15:00Z",
    "is_mine": false,
    "version": 3
  },
  "status": { "locked": false, "is_mine": false, "version": 0 }
}
```

### POST /admin/{dict_type}/lock
Захватить блокировку справочника на 15 минут (требует `admin: partial`). Если заблокирован другим — HTTP 423.

**Response 200:**
```json
{
  "locked": true,
  "lock_owner_id": 1,
  "lock_owner_name": "Иванов И.И.",
  "lock_until": "2026-07-27T12:15:00Z",
  "is_mine": true,
  "version": 3
}
```

### DELETE /admin/{dict_type}/lock
Снять блокировку (при сохранении или закрытии модалки). Срабатывает даже если владелец другой — для fire-and-forget.

**Response 200:** DictLockResponse (locked: false)

### GET /admin/notification-templates
Список всех шаблонов уведомлений.

**Response 200:**
```json
[
  {
    "id": 1,
    "name": "Напоминание о статусах",
    "text": "Не забудьте обновить статусы перед оперативкой",
    "recipients": ["PO", "PL"],
    "deadline_days": 2,
    "repeat_frequency": "weekly",
    "repeat_day": 5,
    "is_active": true,
    "created_at": "2026-06-25T10:00:00Z"
  }
]
```

### POST /admin/notification-templates
Создать шаблон уведомления (требует `admin: partial`).

### PUT /admin/notification-templates/{id}
Обновить шаблон (требует `admin: partial`).

### DELETE /admin/notification-templates/{id}
Удалить шаблон (требует `admin: partial`).

---

## AUDIT LOG

### GET /admin/audit-log
Журнал аудита действий с фильтрацией и пагинацией (требует `admin: read`).

**Query Parameters:**

| Параметр | Тип | По умолчанию | Описание |
|----------|-----|-------------|----------|
| `page` | int | 1 | Номер страницы |
| `per_page` | int | 50 | Записей на страницу (1-200) |
| `user_id` | int | — | Фильтр по ID пользователя |
| `action` | string | — | Фильтр по типу действия: `create`, `update`, `delete` |
| `entity_type` | string | — | Фильтр по типу сущности: `tasks`, `teams`, `users`, `roles` и др. |
| `date_from` | date | — | Начальная дата диапазона (YYYY-MM-DD) |
| `date_to` | date | — | Конечная дата диапазона (YYYY-MM-DD) |

**Response 200:**
```json
{
  "items": [
    {
      "id": 1,
      "user_id": 1,
      "user_name": "Администратор",
      "action": "create",
      "entity_type": "tasks",
      "entity_id": 42,
      "details": "{\"method\": \"POST\", \"path\": \"/api/v1/tasks\", \"status_code\": 201}",
      "ip_address": "192.168.1.100",
      "created_at": "2026-07-25T14:30:00"
    }
  ],
  "total": 1500,
  "page": 1,
  "per_page": 50,
  "pages": 30
}
```

### GET /admin/audit-log/filters
Получить доступные значения для фильтров (требует `admin: read`).

**Response 200:**
```json
{
  "actions": ["create", "update", "delete"],
  "entity_types": ["tasks", "teams", "users", "roles", "projects"],
  "users": [
    { "id": 1, "name": "Администратор" },
    { "id": 2, "name": "Т. Бабиак" }
  ]
}
```

---

## Приоритеты

| Приоритет | code |
|-----------|------|
| Высокий | high |
| Средний | medium |
| Низкий | low |

---

## Статусы задач (13 шт.)

| Статус | Код | Группа |
|--------|-----|--------|
| НОВАЯ ЗАДАЧА | NEW | backlog |
| НАЗНАЧЕНА КОМАНДА | TEAM_ASSIGNED | backlog |
| СБОР ТРЕБОВАНИЙ | COLLECT | backlog |
| ПРОВЕРКА ТРЕБОВАНИЙ | CHECK_REQUIREMENTS | backlog |
| УТОЧНЕНИЕ ТРЕБОВАНИЙ | CLARIFY_REQUIREMENTS | backlog |
| ЭКСПРЕСС-ОЦЕНКА | ESTIMATE | backlog |
| ПРИНЯТИЕ РЕШЕНИЯ | DECISION | backlog |
| ПРИНЯТА В РАБОТУ | WORK | active |
| ВЫПОЛНЕНА | DONE | closed |
| ОТКЛОНЕНА | REJECTED | closed |
| НЕ АКТУАЛЬНА | NOT_RELEVANT | closed |
| ХОЛД | HOLD | frozen |
| ЭСКАЛАЦИЯ НА ЛТ | ESCALATION | frozen |

---

## Примеры ошибок по эндпоинтам

### POST /auth/login
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 200 | Успешный вход | `{ access_token, refresh_token, user }` |
| 422 | Невалидный email | `{ "detail": [{"loc":["body","email"],"msg":"value is not a valid email"}] }` |
| 401 | Неверный email или пароль | `{ "detail": "Invalid email or password" }` |
| 429 | Превышен лимит попыток | `{ "detail": "Rate limit exceeded" }` |

### POST /auth/refresh
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 200 | Токен обновлён | `{ access_token, refresh_token, user }` |
| 401 | Невалидный refresh token | `{ "detail": "Invalid token" }` |
| 429 | Превышен лимит | `{ "detail": "Rate limit exceeded" }` |

### GET /auth/me
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 200 | Данные пользователя | Объект пользователя |
| 401 | Нет токена | `{ "detail": "Invalid or expired token" }` |

### GET /tasks
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 200 | Список задач | `{ items, total, page, per_page, pages }` |
| 401 | Нет токена | `{ "detail": "Invalid or expired token" }` |
| 403 | Нет прав | `{ "detail": "Permission denied" }` |
| 422 | Невалидные параметры | `{ "detail": [...] }` |

### GET /tasks/{id}
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 200 | Задача найдена | Объект задачи |
| 401 | Нет токена | `{ "detail": "Invalid or expired token" }` |
| 403 | Нет прав на команду задачи | `{ "detail": "Permission denied" }` |
| 404 | Задача не найдена | `{ "detail": "Task not found" }` |

### POST /tasks
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 201 | Задача создана | Объект задачи |
| 401 | Нет токена | `{ "detail": "Invalid or expired token" }` |
| 403 | Нет прав на создание | `{ "detail": "Permission denied" }` |
| 422 | Ошибка валидации | `{ "detail": [...] }` |

### PUT /tasks/{id}
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 200 | Задача обновлена | Обновлённый объект задачи |
| 401 | Нет токена | `{ "detail": "Invalid or expired token" }` |
| 403 | Нет прав | `{ "detail": "Permission denied" }` |
| 404 | Задача не найдена | `{ "detail": "Task not found" }` |
| 409 | Конфликт версий | `{ "detail": { "message", "current_version", "submitted_version", "task" } }` |
| 422 | Ошибка валидации | `{ "detail": [...] }` |

### Conflict Resolution Flow

Клиентская логика разрешения конфликта версий (frontend):

1. При получении 409 → открывается модалка «Конфликт версий» с таблицей diff
2. Пользователь выбирает radio-кнопки для каждого конфликтного поля (сервер / ваше)
3. **«Сохранить выбранные»** — собираются данные из формы + значения с сервера для выбранных серверных полей → `PUT /tasks/{id}` с `version` = серверная версия
4. **«Принудительно сохранить»** — `PUT /tasks/{id}` с `force_save: true`, все данные берутся из формы
5. **«Обновить с сервера»** — `GET /tasks/{id}` → перезагрузка карточки
6. При повторном 409 (шаг 3) — модалка пересоздаётся с актуальными данными

### DELETE /tasks/{id}
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 200 | Задача мягко удалена | `{ "message": "Task deleted" }` |
| 401 | Нет токена | `{ "detail": "Invalid or expired token" }` |
| 403 | Нет прав | `{ "detail": "Permission denied" }` |
| 404 | Задача не найдена | `{ "detail": "Task not found" }` |

### POST /tasks/bulk
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 200 | Операция выполнена | `{ "message": "Action 'close' applied to 3 tasks" }` |
| 401 | Нет токена | `{ "detail": "Invalid or expired token" }` |
| 403 | Нет прав | `{ "detail": "Permission denied" }` |
| 422 | Невалидный action | `{ "detail": [...] }` |

### GET /teams
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 200 | Список команд | Массив команд |
| 401 | Нет токена | `{ "detail": "Invalid or expired token" }` |

### POST /teams, PUT /teams/{id}
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 200/201 | Успех | Объект команды |
| 401 | Нет токена | `{ "detail": "Invalid or expired token" }` |
| 403 | Нет прав (admin:partial) | `{ "detail": "Permission denied" }` |
| 404 | Команда не найдена | `{ "detail": "Team not found" }` |

### DELETE /teams/{id}
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 200 | Команда удалена | `{ "message": "Team deleted" }` |
| 400 | Есть пользователи | `{ "detail": "Cannot delete team with N existing users" }` |
| 400 | Есть задачи | `{ "detail": "Cannot delete team with N existing tasks" }` |
| 403 | Нет прав | `{ "detail": "Permission denied" }` |
| 404 | Не найдена | `{ "detail": "Team not found" }` |

### POST /users
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 201 | Пользователь создан | Объект пользователя |
| 400 | Email уже зарегистрирован | `{ "detail": "Email already registered" }` |
| 400 | Имя уже существует | `{ "detail": "User with this name already exists" }` |
| 403 | Нет прав | `{ "detail": "Permission denied" }` |

### POST /roles
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 201 | Роль создана | Объект роли |
| 400 | Имя роли существует | `{ "detail": "Role name already exists" }` |
| 403 | Нет прав | `{ "detail": "Permission denied" }` |

### PUT /roles/{id}
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 200 | Роль обновлена | Объект роли |
| 400 | Нельзя лишить себя admin | `{ "detail": "Cannot revoke your own admin access" }` |
| 403 | Нет прав | `{ "detail": "Permission denied" }` |
| 404 | Не найдена | `{ "detail": "Role not found" }` |

### DELETE /roles/{id}
| Код | Ситуация | Ответ |
|-----|----------|-------|
| 200 | Роль удалена | `{ "message": "Role deleted" }` |
| 400 | Роль назначена пользователям | `{ "detail": "Cannot delete role assigned to users" }` |
| 403 | Нет прав | `{ "detail": "Permission denied" }` |
| 404 | Не найдена | `{ "detail": "Role not found" }` |

---

## Формат ошибок

```json
{
  "detail": "Описание ошибки"
}
```

### Для ошибок валидации (422):
```json
{
  "detail": [
    {
      "loc": ["body", "progress"],
      "msg": "Input should be less than or equal to 100",
      "type": "less_than_equal"
    }
  ]
}
```
