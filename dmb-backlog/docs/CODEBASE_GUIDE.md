# Путеводитель по кодовой базе — AS-IS

> Статус: проверено по структуре репозитория и точкам входа на 2026-09-01.

## Быстрый маршрут

Приложение `dmb-backlog` состоит из FastAPI backend и SPA без сборщика.

- `backend/main.py` — создание приложения, middleware и регистрация роутеров.
- `backend/models.py` — SQLAlchemy-модели.
- `backend/schemas.py` — входные и выходные Pydantic-схемы.
- `backend/database.py` — SQLAlchemy engine/session; PostgreSQL-схема меняется Alembic.
- `backend/alembic/versions/` — последовательность production-миграций.
- `backend/event_outbox.py`, `idempotency.py`, `worker_lock.py` — гарантии многопользовательского режима.
- `backend/metrics.py`, `telemetry.py`, `audit_context.py` — наблюдаемость и корреляция запросов.
- `backend/routers/` — HTTP-операции по функциональным областям.
- `frontend/index.html` — оболочка SPA.
- `frontend/js/app.js` — инициализация клиента.
- `frontend/js/router.js` — клиентские маршруты.
- `frontend/js/api.js` — HTTP-клиент и обновление сессии.
- `frontend/js/eventStream.js` — авторизованный SSE и переподключение по cursor.
- `frontend/js/taskPublicId.js`, `taskMetrics.js` — единое отображение ID и расчётных метрик задачи.
- `frontend/js/components/` — страницы, таблицы и модальные окна.
- `frontend/css/tokens.css` — дизайн-токены.
- `frontend/css/base.css`, `components.css`, `pages.css`, `responsive.css` — стили.

Подробности по области лучше брать из [навигатора](README.md), а окончательным
источником истины считать исполняемый код, конфигурацию и тесты.

## Запуск

Для штатного локального запуска из корня:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1
```

Backend также раздаёт frontend. Зависимости перечислены в
`backend/requirements.txt`; тестовые — в `backend/requirements-dev.txt`.
У frontend нет `package.json`: его тесты запускаются непосредственно через Node.js.

## Где вносить изменения

- API или бизнес-операция: соответствующий файл `backend/routers/`, затем схемы,
  модели и тесты только при реальной зависимости.
- Поля БД: `backend/models.py` и новая Alembic-ревизия; правила — в
  [SCHEMA_CHANGES.md](SCHEMA_CHANGES.md). `ensure_schema()` не является
  production-механизмом миграции.
- Страница SPA: маршрут в `frontend/js/router.js` и компонент в
  `frontend/js/components/`.
- Общая таблица/фильтры: `taskTable.js`, `teamBacklog.js`, `filterToolbar.js`,
  `tableUtils.js`, `quickEdit.js`.
- Внешний вид: сначала токены, затем наиболее узкий CSS-слой.

## Проверка

- Backend-тесты находятся в `backend/tests/` и используют pytest.
- Frontend-тесты находятся в `frontend/tests/` и запускаются Node.js.
- Актуальный CI описан в `.github/workflows/quality.yml`.
- Перед тестом нужно проверить фикстуры: наборы, создающие пользователей, роли,
  команды или справочники, нельзя направлять на штатную БД.

Точные команды и безопасные границы собраны в [TESTING.md](TESTING.md).

## Ограничение доказательности

Разделы «рекомендуемая архитектура», «будущий CI», предполагаемые сценарии и
обоснования решений не считаются описанием AS-IS без подтверждения кодом,
конфигурацией, тестом или зафиксированным решением пользователя. Историческая
расширенная версия этого файла сохранена только в `docs/archive/legacy/`.
