# Тестирование Backlog coordinator

**Версия:** 1.0  
**Дата:** 2026-06-29

---

## 1. Стратегия тестирования

Проект использует **пирамиду тестирования** с тремя уровнями:

```
      /\
     /e2e\
    /------\
   /integration\
  /--------------\
 /   unit tests   \
/------------------\
```

### Уровни

| Уровень | Инструмент | Покрытие | Скорость |
|---------|-----------|----------|----------|
| **Unit** | pytest + unittest.mock | Отдельные функции, хэлперы, валидация | Мгновенно |
| **Integration** | pytest + TestClient (FastAPI) | API-эндпоинты, БД (SQLite :memory:) | < 1 мин |
| **E2E** | — (планируется Playwright) | Полные пользовательские сценарии через UI | — |

---

## 2. Настройка тестового окружения

### 2.1 Установка

```bash
# Из корня dmb-backlog
pip install -r backend/requirements-dev.txt
cd backend
```

### 2.2 Запуск тестов

```bash
# Все тесты
pytest -v

# С coverage
pytest --cov=. --cov-report=term-missing

# Конкретный файл
pytest tests/test_auth.py -v

# Конкретный тест
pytest tests/test_auth.py::test_login_success -v

# Параллельный запуск (требуется pytest-xdist)
pytest -n auto -v
```

### 2.3 Конфигурация

Файл `backend/pytest.ini` или `pyproject.toml`:

```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_functions = test_*
```

---

## 3. Существующие тесты

### 3.1 Тесты аутентификации (`tests/test_auth.py`)

| Тест | Описание |
|------|----------|
| `test_login_success` | Вход с валидными email/паролем → 200 + токены |
| `test_login_invalid_email` | Неверный формат email → 422 |
| `test_login_wrong_password` | Неверный пароль → 401 |
| `test_refresh_success` | Обновление токена → 200 |
| `test_refresh_invalid_token` | Невалидный refresh токен → 401 |
| `test_me_authenticated` | GET /auth/me с валидным токеном → 200 |
| `test_me_unauthenticated` | GET /auth/me без токена → 401 |

### 3.2 Тесты задач (`tests/test_tasks.py`)

| Тест | Описание |
|------|----------|
| `test_get_tasks` | GET /tasks → 200 + пагинация |
| `test_create_task` | POST /tasks → 201 |
| `test_get_task` | GET /tasks/{id} → 200 |
| `test_update_task` | PUT /tasks/{id} → 200 |
| `test_delete_task` | DELETE /tasks/{id} → 200 |

### 3.3 Фикстуры (`tests/conftest.py`)

| Фикстура | Описание |
|----------|----------|
| `client` | TestClient с FastAPI приложением |
| `test_db` | SQLite in-memory + создание таблиц |
| `token` | JWT-токен для тестового пользователя |
| `task_id` | ID созданной тестовой задачи |

---

## 4. Добавление новых тестов

### 4.1 Структура теста

```python
def test_feature(client, token):
    """Описание того, что тестируем."""
    response = client.get(
        "/api/v1/tasks",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
```

### 4.2 Пример теста с параметризацией

```python
import pytest

@pytest.mark.parametrize("status_code,expected_count", [
    ("NEW", 10),
    ("WORK", 5),
    ("DONE", 3),
])
def test_filter_by_status(client, token, status_code, expected_count):
    response = client.get(
        f"/api/v1/tasks?status={status_code}",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    assert len(response.json()["items"]) == expected_count
```

### 4.3 Тестирование ошибок

Для каждого эндпоинта должен быть тест, проверяющий:
- **401** — без токена
- **403** — без прав
- **404** — несуществующий ресурс
- **422** — невалидные данные
- **200/201** — успех

---

## 5. План по расширению тестов

### 5.1 Приоритет 1 — Критические сценарии

- [ ] **Ролевая модель**: тесты для всех 6 ролей (админ, ЛТ, PL, PO, BA, заказчик)
- [ ] **Workflow**: проход задачи через все 13 статусов
- [ ] **Bulk-операции**: массовое закрытие, холд, удаление
- [ ] **Фильтрация**: полный набор комбинаций фильтров
- [ ] **Пагинация**: граничные случаи (page=0, per_page=1001, page>pages)

### 5.2 Приоритет 2 — Интеграционные сценарии

- [ ] **Команды**: CRUD + проверка зависимостей (нельзя удалить команду с задачами)
- [ ] **Пользователи**: создание, обновление ролей, дубликаты email/name
- [ ] **Роли**: создание, обновление, удаление занятой роли
- [ ] **Экспресс-оценка**: создание эпика, истории, привязка к задаче
- [ ] **Клиентский портал**: создание задачи от бизнес-заказчика

### 5.3 Приоритет 3 — Граничные случаи

- [ ] **Rate Limiting**: превышение лимита на login/refresh
- [ ] **Отчёты**: пустые данные, большие объёмы
- [ ] **Мягкое удаление**: восстановление задачи
- [ ] **Concurrency**: одновременное обновление задачи двумя пользователями

### 5.4 Unit-тесты

- [ ] **Расчёт C/V**: проверка формул с разными входными данными
- [ ] **Валидация статусов**: разрешённые/запрещённые переходы
- [ ] **Форматирование дат**: корректный расчёт времени в работе
- [ ] **JWT**: проверка срока действия, валидация подписи

---

## 6. Метрики качества

| Метрика | Цель | Текущее значение |
|---------|------|-----------------|
| **Code coverage** | ≥ 80% | — |
| **Unit tests** | ≥ 50 | 12 |
| **Integration tests** | ≥ 30 | 0 |
| **E2E tests** | ≥ 10 | 0 |
| **Время прогона** | < 2 мин | — |
