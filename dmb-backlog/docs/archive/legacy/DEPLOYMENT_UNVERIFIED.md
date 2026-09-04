# Развертывание Backlog coordinator

**Версия:** 1.0  
**Дата:** 2026-06-29

---

## 1. Требования к окружению

| Компонент | Минимальная версия | Рекомендуемая версия |
|-----------|-------------------|---------------------|
| Python | 3.11 | 3.12+ |
| pip | 21.0 | 24.0+ |
| SQLite (dev) | 3.x | 3.x |
| PostgreSQL (prod) | 15 | 16+ |
| Операционная система | — | Ubuntu 22.04 / Debian 12 |

### Зависимости Python

Перечислены в `backend/requirements.txt`:
- FastAPI 0.100+
- SQLAlchemy 2.0
- uvicorn
- python-jose (JWT)
- passlib[bcrypt] (хэширование паролей)
- pydantic-settings
- pytest (для тестов)

---

## 2. Переменные окружения

Файл `.env` в `backend/`:

| Переменная | Обязательная | Значение по умолчанию | Описание |
|-----------|-------------|----------------------|----------|
| `DATABASE_URL` | Да | `sqlite:///./dmb_backlog.db` | URL подключения к БД (SQLite для dev, PostgreSQL для prod) |
| `SECRET_KEY` | Да | `your-secret-key-change-in-production-dmb2026` | Ключ подписи JWT (обязательно изменить в production) |
| `ALGORITHM` | Нет | `HS256` | Алгоритм JWT |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Нет | `60` | Время жизни access token (минуты) |
| `REFRESH_TOKEN_EXPIRE_DAYS` | Нет | `7` | Время жизни refresh token (дни) |
| `CORS_ORIGINS` | Да | `["http://localhost:5500","http://127.0.0.1:5500","http://localhost:8080"]` | Разрешённые CORS-источники (JSON-массив) |
| `APP_NAME` | Нет | `Backlog coordinator` | Название приложения |
| `APP_VERSION` | Нет | `1.0.0` | Версия приложения |
| `DEBUG` | Нет | `True` | Режим отладки (выключить в production) |

### Пример `.env` для разработки

```env
DATABASE_URL=sqlite:///./dmb_backlog.db
SECRET_KEY=dev-secret-key
CORS_ORIGINS=["http://localhost:5500","http://127.0.0.1:5500"]
DEBUG=True
```

### Пример `.env` для production (PostgreSQL)

```env
DATABASE_URL=postgresql://dmb_user:securepassword@pg-host:5432/dmb_backlog
SECRET_KEY=production-secret-key-64-chars-minimum
CORS_ORIGINS=["https://backlog.dmb.ru"]
DEBUG=False
```

---

## 3. Процесс развертывания

### 3.1 Разработка (dev)

```bash
# Клонирование
git clone <repository-url>
cd dmb-backlog

# Конфигурация хранится в корне проекта
cp .env.example .env
python -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/Mac: source .venv/bin/activate
pip install -r backend/requirements.txt
cd backend
uvicorn main:app --reload --port 8000

# Frontend (отдельно, опционально):
# Открыть frontend/index.html через Live Server на порту 5500
```

Backend доступен: `http://localhost:8000`
Swagger UI: `http://localhost:8000/docs`

### 3.2 Тестовое окружение (staging)

```bash
# 1. Установка Python и зависимостей
sudo apt update && sudo apt install -y python3.12 python3-pip
cd /opt/dmb-backlog
python3.12 -m venv venv
source venv/bin/activate
pip install -r backend/requirements.txt

# 2. Настройка PostgreSQL
sudo apt install -y postgresql-15
sudo -u postgres createdb dmb_backlog
sudo -u postgres createuser dmb_user -P
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE dmb_backlog TO dmb_user;"

# 3. Настройка корневого .env
cp .env.example .env
# Редактировать DATABASE_URL, SECRET_KEY, CORS_ORIGINS

# 4. Запуск через systemd
sudo tee /etc/systemd/system/dmb-backlog.service << EOF
[Unit]
Description=Backlog coordinator API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/dmb-backlog/backend
ExecStart=/opt/dmb-backlog/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable dmb-backlog
sudo systemctl start dmb-backlog
```

### 3.3 Продуктивное окружение (production)

```bash
# 1. Nginx reverse proxy
sudo tee /etc/nginx/sites-available/dmb-backlog << 'EOF'
server {
    listen 80;
    server_name backlog.dmb.ru;
    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /static/ {
        alias /opt/dmb-backlog/frontend/;
        expires 7d;
    }

    # Gzip
    gzip on;
    gzip_types text/plain application/json text/css application/javascript;
}
EOF

sudo ln -sf /etc/nginx/sites-available/dmb-backlog /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 2. Настройка firewall
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp  # если используется HTTPS

# 3. SSL (рекомендуется Let's Encrypt)
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d backlog.dmb.ru
```

---

## 4. Docker

### 4.1 Dockerfile

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 4.2 docker-compose.yml

```yaml
version: '3.8'
services:
  backend:
    build: .
    ports:
      - "8000:8000"
    env_file:
      - ./backend/.env
    volumes:
      - ./backend/dmb_backlog.db:/app/backend/dmb_backlog.db
      - ./backend/logs:/app/backend/logs
    restart: unless-stopped

  # Для production с PostgreSQL:
  # db:
  #   image: postgres:15
  #   environment:
  #     POSTGRES_DB: dmb_backlog
  #     POSTGRES_USER: dmb_user
  #     POSTGRES_PASSWORD: ${DB_PASSWORD}
  #   volumes:
  #     - pgdata:/var/lib/postgresql/data
  #   restart: unless-stopped
```

### 4.3 Сборка и запуск Docker

```bash
# Сборка образа
docker build -t dmb-backlog .

# Запуск
docker run -d -p 8000:8000 --env-file backend/.env dmb-backlog

# Или через docker-compose
docker-compose up -d
```

---

## 5. Настройка после развертывания

### 5.1 Проверка работоспособности

```bash
# Health check
curl http://localhost:8000/api/v1/health
# {"status": "ok", "version": "1.0.0"}

# Проверка Swagger UI
curl -s http://localhost:8000/docs | head -5
```

### 5.2 Создание администратора

Система автоматически создаёт seed-данные при первом запуске (если таблица `users` пуста):

| Email | Пароль | Роль |
|-------|--------|------|
| `admin@dmb.ru` | `dmb2026` | Администратор |
| `t.babiak@dmb.ru` | `dmb2026` | Лидер Трайба |
| `d.fomin@dmb.ru` | `dmb2026` | PO |

**Важно:** немедленно сменить пароли после первого входа.

### 5.3 Настройка интеграций

Интеграции настраиваются через интерфейс администрирования (`#/admin`):

- **Jira**: только ссылки (link_jira), прямой интеграции нет
- **Excel**: экспорт через клиентскую библиотеку xlsx.js
- **Email**: не интегрирован (план)

### 5.4 Загрузка начальных данных

Seed-данные создаются автоматически:
- 6 ролей (Администратор, ЛТ, IT PL, PO, BA, Бизнес-заказчик)
- 10 команд (Pre-trade, Post-Trade, IB, Core, Delivery и др.)
- 18 пользователей
- 44 задачи с полным набором атрибутов
- 56 записей справочников
- 4 стандартных отчёта

### 5.5 Настройка backup

```bash
# SQLite backup (cron: ежедневно в 02:00)
0 2 * * * sqlite3 /opt/dmb-backlog/backend/dmb_backlog.db ".backup /backups/dmb_backlog_$(date +\%Y\%m\%d).db"

# PostgreSQL backup (cron)
0 2 * * * pg_dump -U dmb_user dmb_backlog > /backups/dmb_backlog_$(date +\%Y\%m\%d).sql
```

### 5.6 Рекомендации по безопасности

- [ ] Заменить `SECRET_KEY` на уникальное длинное значение (≥ 64 символа)
- [ ] Настроить HTTPS (Let's Encrypt)
- [ ] Сменить пароли seed-пользователей
- [ ] Включить `DEBUG=False`
- [ ] Настроить firewal (открыть только 80/443)
- [ ] Настроить регулярные backup
- [ ] Ограничить доступ к `/docs` и `/redoc` в production
