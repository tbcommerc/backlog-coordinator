# API Спецификация DMB Backlog

**Версия:** 3.0  
**Дата:** 2026-06-29

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
      "last_updated": "2026-06-20",
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

**Request:**
```json
{
  "team_id": 1,
  "title": "Интеграция с API ЦБ",
  "description": "Описание задачи...",
  "date_received": "2026-06-01",
  "business_customer": "ДИД",
  "project": "API Integration",
  "task_type": "Feature",
  "priority": "Высокий",
  "status": "Сбор требований",
  "deadline": "3Q 26",
  "effort_days": 10,
  "effort_rub": 2.5,
  "financial_effect": 15.0,
  "progress": 0,
  "key_project": false
}
```

**Response 201:** объект задачи

### PUT /tasks/{id}
Обновить задачу (передаются только изменяемые поля). Автоматически создаётся запись в `task_history` для каждого изменённого поля.

**Response 200:** обновлённый объект задачи

### DELETE /tasks/{id}
Мягкое удаление задачи (ставит `is_deleted = True`).

**Response 200:**
```json
{
  "message": "Task deleted"
}
```

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

### POST /reports
Создать пользовательский отчёт.

### GET /reports/{id}/execute
Выполнить отчёт с его фильтрами.

**Response 200:**
```json
{
  "total": 25,
  "items": [
    {
      "id": 1,
      "title": "Задача 1",
      "team": "Pre-trade",
      "priority": "Высокий",
      "status": "В работе",
      "deadline": "3Q 26",
      "progress": 45,
      "financial_effect": 15.0,
      "estimate_cost": null,
      "value_score": null
    }
  ]
}
```

### PUT /reports/{id} — обновить отчёт (TODO)

---

## ADMIN (Dictionaries + Notification Templates)

### GET /admin/priorities
### GET /admin/statuses
### GET /admin/task-types
### GET /admin/business-customers

**Response 200:**
```json
[
  {
    "id": 1,
    "dict_type": "priority",
    "name": "Высокий",
    "code": "high",
    "color": "#f43f5e",
    "sort_order": 1,
    "is_active": true,
    "created_at": "2026-01-15T10:00:00Z"
  }
]
```

POST/PUT/DELETE для каждого справочника (требуют `admin: partial`).

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
| 422 | Ошибка валидации | `{ "detail": [...] }` |

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
