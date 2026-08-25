# Путеводитель по кодовой базе — AS-IS

> Статус: проверено по структуре репозитория и точкам входа на 2026-08-24.

## Быстрый маршрут

Приложение `dmb-backlog` состоит из FastAPI backend и SPA без сборщика.

- `backend/main.py` — создание приложения, middleware и регистрация роутеров.
- `backend/models.py` — SQLAlchemy-модели.
- `backend/schemas.py` — входные и выходные Pydantic-схемы.
- `backend/database.py` — подключение БД и `ensure_schema()`.
- `backend/routers/` — HTTP-операции по функциональным областям.
- `frontend/index.html` — оболочка SPA.
- `frontend/js/app.js` — инициализация клиента.
- `frontend/js/router.js` — клиентские маршруты.
- `frontend/js/api.js` — HTTP-клиент и обновление сессии.
- `frontend/js/components/` — страницы, таблицы и модальные окна.
- `frontend/css/tokens.css` — дизайн-токены.
- `frontend/css/base.css`, `components.css`, `pages.css`, `responsive.css` — стили.

Подробности по области лучше брать из [навигатора](README.md), а окончательным
источником истины считать исполняемый код, конфигурацию и тесты.

## Запуск

Из `dmb-backlog/backend`:

```powershell
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Backend также раздаёт frontend. Зависимости перечислены в
`backend/requirements.txt`; тестовые — в `backend/requirements-dev.txt`.
У frontend нет `package.json`: его тесты запускаются непосредственно через Node.js.

## Где вносить изменения

- API или бизнес-операция: соответствующий файл `backend/routers/`, затем схемы,
  модели и тесты только при реальной зависимости.
- Поля БД: сначала `backend/models.py`, затем осторожно `database.ensure_schema()`;
  правила — в [SCHEMA_CHANGES.md](SCHEMA_CHANGES.md).
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
