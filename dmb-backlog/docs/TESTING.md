# Тестирование — AS-IS

> Статус: проверено по `backend/tests/`, `frontend/tests/`, зависимостям и
> корневому `../../.github/workflows/quality.yml` на 2026-09-09.

## Наборы тестов

- Backend: pytest-тесты в `backend/tests/`.
- Frontend: Node.js test runner, файлы `frontend/tests/*.test.mjs`.
- Browser: 9 Playwright spec-файлов в `frontend/e2e/` для Chromium.
- Контракт `localSpellcheck.test.mjs` проверяет автоматическое включение для
  содержательных полей, исключение технических значений, подключение worker и
  наличие локальных файлов русского словаря в frontend-поставке.
- Notification-набор отдельно проверяет pure target resolver для exact/legacy ссылок,
  allowlist и typed targets, ревизионный store, единый контракт center/bell/dashboard,
  reversible read, live invalidation,
  keyboard semantics popup, rollback preferences и отсутствие container opacity у resolved.
- Контракты ИИ-ассистента отдельно проверяют read-only после отправки, безопасное форматирование ответа, прозрачность источников, бесшумное восстановление истории, отдельный live-анонсер, roving-tabindex истории, видимую skip-ссылку и исключение закрытой мобильной навигации из accessibility tree. Потоковый набор проверяет разбор фрагментированных SSE-событий, provider deltas, идемпотентный финальный `result`, backend relay без буферизации и замену не прошедшего инварианты текста. Browser-набор дополнительно проверяет рост ответа из нескольких `delta`, короткий landscape, порядок «документ → блокеры» и раскрытие вторичных действий ответа на desktop.
- Backend unit-тест UX-метрик проверяет фиксированные метки и отсутствие произвольных названий событий; Agent-тест запрещает правку отправленного черновика до `reopen-review`.
- Review regression проверяет независимые фильтры и URL-состояние очереди, ID-поиск, `limit/offset` догрузку, nullable-оценки, immutable revision link/diff, stale-version guard, единичную отправку форм, восстановление черновиков, release/reroute и обязательное customer-уведомление. Playwright-сценарий измеряет overflow на 320/390 px, порядок «содержание → решение», фокус на целевом разделе и отсутствие неразрешённых Lucide-placeholder после рендера.
- Контракт директорской оперативки проверяет выбор только готовых статусов без
  квартального ограничения, выдачу предыдущего статуса и изменение встречного
  маркера показа лидеру трайба. Frontend unit-тест фиксирует фильтры, дедупликацию
  заказчика и ключевые действия новой страницы.
- Backend-регрессии дополнительно покрывают потоковую проверку вложений через
  ClamAV, устойчивость межсервисных вызовов, метаданные workflow и целостность
  снимков редакций требований.
- Playwright 1.63.0 настроен для Chromium в `playwright.config.mjs`. Изолированные
  browser-тесты перехватывают API и не создают пользователей/роли в БД; они
  проверяют согласованность center/bell/dashboard, keyboard Escape, typed target,
  отсутствие персональных полей в UX-событии и фактическую геометрию панели
  фильтров на desktop/tablet ширинах. Каталог `frontend/e2e/fixtures/modalCatalog.html`
  и `modalSystem.spec.mjs` дополнительно фиксируют размеры оболочек, 40/44 px
  hit-area закрытия, отсутствие горизонтального переполнения и отдельную
  workspace-композицию карточки задачи снимками desktop/mobile.
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
npm ci
npx playwright install chromium
npm run test:e2e
```

Для проверки синтаксиса отдельного frontend-файла используется
`node --check <путь-к-файлу>`.

## CI

Workflow `Quality Gate` находится в `D:\Проект\.github\workflows\quality.yml`,
то есть в каталоге, который фактически обнаруживает GitHub Actions для корня
репозитория. Он запускается для push в `main`/`master`, pull request и вручную
и выполняет:

1. Python 3.12: установку hash-locked `backend/requirements-dev.lock`, compileall и весь pytest.
2. Node 22: синтаксическую проверку JS/MJS и все frontend-тесты.
3. Playwright Chromium: browser-сценарии notification surfaces, ИИ-ассистента и
   каталога модальных окон; они измеряют overflow, границы контролов и читаемость
   подписей на целевых desktop, tablet, mobile и коротких landscape viewport.
4. Полный pytest BA agent после установки hash-locked `agent/requirements-dev.lock`.
5. Полный pytest Prioritiser после установки `prioritiser-agent/requirements.lock`,
   с отключённым dense RAG и test-only providers.
6. `pip-audit==2.7.3 --no-deps` для прямых runtime requirements всех трёх Python-сервисов.

В backend-job выставлены `RUN_STARTUP_SEED=false`,
`RUN_STARTUP_MAINTENANCE=false`, `RUN_NOTIFICATION_SCHEDULER=false` и отдельный
SQLite-файл `ci-test.db`.

## Безопасность тестовых данных

Многие backend-тесты используют `backend/tests/conftest.py` и создают тестовые
пользователей, роли, команды или справочники. Согласно корневому `AGENTS.md`
их запуск требует прямого разрешения пользователя на эти операции даже в
изолированной тестовой БД. Нельзя подменять `DATABASE_URL` на штатную БД или
переносить тестовые SQL/фикстуры в неё.

Для точечной проверки сначала читать сам тест и его фикстуры. Безопасные unit-тесты,
не работающие со штатной БД, предпочтительнее полного локального прогона при
неизвестной конфигурации окружения.

Фактический перечень тестов нужно получать из дерева файлов или командой:

```powershell
rg --files backend/tests frontend/tests
```

Проверено 08.09.2026: регрессии сохранности требований запускаются напрямую,
без pytest/conftest, app import, соединения с БД и защищённых фикстур:

```powershell
python -B backend/tests/test_requirement_artifact_integrity.py
node --test frontend/tests/requirementIntegrity.test.mjs
```

Backend-тесты используют настоящие тела функций через AST и подставные
зависимости; дополнительно компилируют DDL только новой миграции в offline
контексте Alembic. Это проверка контракта и ветвей, не многопользовательский E2E.

## Проверочный срез 09.09.2026

- `python -m pytest --collect-only -q -p no:cacheprovider` в `backend/` —
  347 тестов собрано успешно; тестовые тела не выполнялись.
- `node --test frontend/tests/*.test.mjs` — 115 тестов, 115 успешно.
- Аналогичный collection Prioritiser — 347 тестов собрано успешно.
- Локальный collection BA Agent обнаружил 206 тестов до остановки и 8 ошибок
  импорта из-за отсутствующего в текущем глобальном Python пакета `psycopg`.
  Это ограничение локального окружения, а не результат CI: workflow сначала
  устанавливает полный `agent/requirements-dev.lock`.
- Playwright в этом срезе не запускался; наличие 9 spec-файлов и команда запуска
  проверены по `playwright.config.mjs`, `package.json` и workflow.
