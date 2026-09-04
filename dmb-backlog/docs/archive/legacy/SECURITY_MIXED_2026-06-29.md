# Безопасность Backlog coordinator

**Версия:** 1.0  
**Дата:** 2026-06-29

---

## 1. Аутентификация

### 1.1 Механизм

Система использует **JWT (JSON Web Token)** с двумя типами токенов:

| Токен | Время жизни | Назначение |
|-------|------------|------------|
| **Access Token** | 60 минут | Доступ к защищённым эндпоинтам |
| **Refresh Token** | 7 дней | Обновление access token |

### 1.2 Хранение

- **Хэши паролей**: bcrypt (через passlib)
- **JWT-ключ**: SECRET_KEY из переменных окружения
- **Токены не хранятся в БД** — проверка через JWT-подпись

### 1.3 Rate Limiting

| Эндпоинт | Лимит | Окно | Хранилище |
|----------|-------|------|-----------|
| `POST /auth/login` | 5 запросов | 60 сек | In-memory (словарь) |
| `POST /auth/refresh` | 10 запросов | 60 сек | In-memory (словарь) |

*In-memory хранилище сбрасывается при перезапуске. Для multi-instance требуется Redis.*

### 1.4 Cookie vs Header

Токены передаются через заголовок `Authorization: Bearer <token>`. Куки не используются (API-first подход).

---

## 2. Авторизация

### 2.1 Ролевая модель

| Роль | Права |
|------|-------|
| **Администратор** (admin:full) | Полный доступ ко всем функциям |
| **Лидер Трайба** (admin:partial) | Всё, кроме создания пользователей |
| **IT PL** (user) | Полный CRUD задач своей команды |
| **PO** (user) | Просмотр + комментирование задач своей команды |
| **BA** (user) | Создание и редактирование задач |
| **Бизнес-заказчик** (user) | Создание задач через портал клиента |

### 2.2 Уровни доступа к задачам

Эндпоинты задач (`/tasks`) проверяют:
1. **Наличие токена** → 401
2. **Права роли** → 403 (низкоуровневые права)
3. **Принадлежность к команде задачи** → 403 (user не из команды задачи)
4. **can_edit / can_delete** (на уровне задачи) → 403 для индивидуальных ограничений

### 2.3 Защищённые операции

| Операция | Требуемая роль | Дополнительная проверка |
|----------|---------------|------------------------|
| Создание пользователя | admin:full | — |
| Создание команды | admin:full, admin:partial | — |
| Bulk-операции | admin:full, admin:partial | — |
| Удаление задачи | admin или создатель задачи | can_delete флаг задачи |
| Редактирование задачи | admin или участник команды | can_edit флаг задачи |
| Просмотр отчётов | admin:full, admin:partial, IT PL | — |

---

## 3. Защита данных

### 3.1 SQL Injection

Все запросы к БД выполняются через **SQLAlchemy ORM** с параметризованными запросами. Прямые SQL-запросы отсутствуют в production-коде.

### 3.2 XSS (Cross-Site Scripting)

- API возвращает только JSON (не HTML)
- Frontend использует Vanilla JS без innerHTML для пользовательского контента
- Поля задач (name, description, comment) экранируются на клиенте перед отображением
- **Рекомендация**: добавить CSP-заголовки через Nginx

### 3.3 CSRF (Cross-Site Request Forgery)

API не использует cookie-аутентификацию, поэтому CSRF-атаки невозможны (токен передаётся в заголовке).

### 3.4 CORS

Настройка CORS задаётся переменной `CORS_ORIGINS`:

```env
# Разработка — несколько источников
CORS_ORIGINS=["http://localhost:5500","http://127.0.0.1:5500"]

# Production — только домен приложения
CORS_ORIGINS=["https://backlog.dmb.ru"]
```

FastAPI middleware проверяет:
- Origin заголовок
- Разрешённые методы: GET, POST, PUT, DELETE, OPTIONS
- Разрешённые заголовки: Authorization, Content-Type
- Credentials: true

### 3.5 Rate Limiting (детали реализации)

Реализован через middleware в `backend/main.py`:

```python
rate_limit_storage: Dict[str, list] = {}

def check_rate_limit(key: str, max_requests: int, window: int) -> bool:
    now = time.time()
    if key not in rate_limit_storage:
        rate_limit_storage[key] = []
    rate_limit_storage[key] = [
        t for t in rate_limit_storage[key]
        if now - t < window
    ]
    if len(rate_limit_storage[key]) >= max_requests:
        return False
    rate_limit_storage[key].append(now)
    return True
```

**Недостатки текущей реализации:**
- Хранилище в памяти — сбрасывается при перезапуске
- Нет персистентности между инстансами
- Рекомендуется заменить на Redis для production

---

## 4. Безопасность БД

### 4.1 Пароли

- Хэшируются bcrypt (cost factor 12)
- Не хранятся в открытом виде
- Не логируются

### 4.2 Seed-данные

При первом запуске создаются тестовые учётные записи:

| Email | Пароль | Действие при деплое |
|-------|--------|---------------------|
| `admin@dmb.ru` | `dmb2026` | **Сменить пароль!** |
| `t.babiak@dmb.ru` | `dmb2026` | **Сменить пароль!** |
| `d.fomin@dmb.ru` | `dmb2026` | **Сменить пароль!** |

### 4.3 Мягкое удаление (Soft Delete)

- Задачи не удаляются физически — устанавливается флаг `is_deleted = True`
- Удалённые задачи исключаются из стандартных запросов (`filter(is_deleted=False)`)
- Администратор может просмотреть/восстановить удалённые задачи

### 4.4 Аудит

**Сбор данных:**
Middleware (`backend/middleware.py`) автоматически логирует:
- Все write-операции (POST, PUT, DELETE, PATCH) к `/api/*`
- IP-адрес запроса
- User ID (из JWT-токена)
- Timestamp
- Path запроса, HTTP-метод, статус-код ответа
- Тип сущности (извлекается из URL: `/api/v1/{entity_type}/...`)
- ID сущности (извлекается из URL: 4-й сегмент пути)

Данные записываются в таблицу `audit_log` в БД.

**Просмотр журнала:**
Администраторы (`admin: read`) могут просматривать журнал аудита через интерфейс `#/audit-log` (отдельная страница в sidebar). Реализованы фильтры:
- По пользователю (select)
- По типу действия: CREATE, UPDATE, DELETE (select)
- По типу сущности: tasks, teams, users, roles и др. (select)
- По диапазону дат (date pickers)
- Пагинация: 50 записей на страницу

**API-эндпоинты:**
- `GET /admin/audit-log` — получение записей с фильтрами и пагинацией
- `GET /admin/audit-log/filters` — получение доступных значений фильтров

**Хранение:**
- Записи хранятся в таблице `audit_log` БД (SQLite)
- Логи приложения — в `backend/logs/`

**Защита:**
- Доступ к просмотру журнала — только для ролей с `admin: read` или `admin: partial`

---

## 5. Инфраструктурная безопасность

### 5.1 HTTPS

**Рекомендация:** настроить HTTPS через Let's Encrypt + Nginx:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d backlog.dmb.ru
```

### 5.2 Firewall

```bash
# Разрешить только необходимые порты
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 80/tcp   # HTTP (редирект на HTTPS)
sudo ufw allow 443/tcp  # HTTPS
sudo ufw allow 22/tcp   # SSH
sudo ufw enable
```

### 5.3 Nginx hardening

```nginx
server {
    listen 443 ssl;
    server_name backlog.dmb.ru;

    # SSL
    ssl_certificate /etc/letsencrypt/live/backlog.dmb.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/backlog.dmb.ru/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Security headers
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;";

    # Ограничение методов
    if ($request_method !~ ^(GET|POST|PUT|DELETE|OPTIONS)$) {
        return 405;
    }

    # Защита от ботов
    location / {
        proxy_pass http://127.0.0.1:8000;
    }

    # Скрыть /docs и /redoc в production (опционально)
    # location /docs { return 403; }
    # location /redoc { return 403; }
    # location /openapi.json { return 403; }
}
```

### 5.4 Обновление зависимостей

```bash
# Проверка уязвимостей (рекомендуется)
pip-audit
pip install --upgrade pip-audit
pip-audit

# Обновление всех зависимостей
pip list --outdated
pip install --upgrade -r requirements.txt
```

---

## 6. Процедуры безопасности

### 6.1 Что делать при утечке SECRET_KEY

1. **Немедленно** сменить SECRET_KEY в .env
2. Перезапустить сервер
3. Все существующие JWT-токены станут невалидными — пользователи должны заново войти
4. Проверить логи на подозрительную активность

### 6.2 Что делать при подозрении на взлом

1. Заблокировать доступ к серверу (ufw deny from <ip>)
2. Сменить все пароли
3. Сменить SECRET_KEY
4. Восстановить БД из последнего бекапа
5. Провести аудит логов
6. Уведомить команду

### 6.3 Регулярные действия

- Еженедельная проверка логов на аномалии
- Ежемесячное обновление зависимостей (pip-audit)
- Ежеквартальный аудит прав пользователей
- Ежегодное обновление SSL-сертификатов
