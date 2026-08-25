# Тестирование — AS-IS

> Статус: проверено по `backend/tests/`, `frontend/tests/`, зависимостям и
> `.github/workflows/quality.yml` на 2026-08-24.

## Наборы тестов

- Backend: pytest-тесты в `backend/tests/`.
- Frontend: Node.js test runner, файлы `frontend/tests/*.test.mjs`.
- Отдельной настроенной E2E-системы с Playwright в репозитории нет.
- Метрики покрытия и обязательный процент coverage в CI не настроены.

## Локальный запуск

Установить backend-зависимости для разработки:

```powershell
python -m pip install -r backend/requirements-dev.txt
```

Из каталога `dmb-backlog/backend`:

```powershell
python -m pytest tests -q -p no:cacheprovider
python -m compileall -q .
```

Из каталога `dmb-backlog`:

```powershell
node --test frontend/tests/*.test.mjs
```

Для проверки синтаксиса отдельного frontend-файла используется
`node --check <путь-к-файлу>`.

## CI

Workflow `Quality Gate` запускается для push в `main`/`master`, pull request и
вручную. Он выполняет:

1. Python 3.12: установку `backend/requirements-dev.txt`, compileall и весь pytest.
2. Node 22: синтаксическую проверку JS/MJS и все frontend-тесты.
3. `pip-audit==2.7.3` для `backend/requirements.txt`.

В backend-job выставлены `RUN_STARTUP_SEED=false`,
`RUN_STARTUP_MAINTENANCE=false`, `RUN_NOTIFICATION_SCHEDULER=false` и отдельный
SQLite-файл `ci-test.db`.

## Безопасность тестовых данных

Многие backend-тесты используют `backend/tests/conftest.py` и создают тестовые
пользователей, роли, команды или справочники. Их допустимо запускать только на
изолированной тестовой БД. Нельзя подменять `DATABASE_URL` на штатную БД или
переносить тестовые SQL/фикстуры в неё.

Для точечной проверки сначала читать сам тест и его фикстуры. Безопасные unit-тесты,
не работающие со штатной БД, предпочтительнее полного локального прогона при
неизвестной конфигурации окружения.

Фактический перечень тестов нужно получать из дерева файлов или командой:

```powershell
rg --files backend/tests frontend/tests
```
