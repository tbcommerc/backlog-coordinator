# Агент оценки Value и Priority score

Проверено 05.11.2026: [конфигурация SDK 1.4.1, Go-профиль и CPU lock](docs/REMOTE_TOOLS.md). Полная миграционная приёмка ещё не завершена.

Локальный профиль оценщика переведён на отдельный PostgreSQL 02.11.2026: сохранены 23 запроса и 8 записей модельного аудита, SQLite оставлен. [Перенос и проверки](docs/REMOTE_TOOLS.md). Оценщик по-прежнему запускается только явно.

Удалённые инструменты F5/F6, проверено 04.11.2026:
[HTTP tools 1.0](docs/REMOTE_TOOLS.md). Run/task/role-scoped grants, транзакционные
receipts, общий лёгкий пересчёт CLI/HTTP, без локального Python рядом с runtime.
Это не приёмка настоящего серверного OpenCode.

Прототип агента, который для каждой задачи Единого бэклога трайба инноваций
вычисляет приоритет **P1–P5** и, если поле Value не заполнено вручную,
рассчитывает финансовый эффект по единой методике.

В production сервис использует PostgreSQL и запускается после
`python -m alembic upgrade head`; автосоздание таблиц допускается только в явно
изолированном unit-test режиме. Обычный сервис отклоняет SQLite/mock до startup. `/health` — liveness, `/ready` проверяет БД,
LLM-конфигурацию, локальную модель эмбеддингов и готовность индексов RAG/аналогий
без блокирующей загрузки в HTTP-запросе. При старте модель и включённые индексы
прогреваются по одному разу в фоне; пока прогрев не закончен, `/ready` быстро
возвращает `503` и статус `loading`. Модель
`intfloat/multilingual-e5-base` закреплена по revision
`d13f1b27baf31030b7fd040960d60d909913633f`, загружается при сборке образа и
открывается в production с `local_files_only=true`.

Методика зафиксирована в ТЗ v2.0 и прошла четыре итерации согласования. Конспект —
[docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## Что уже работает

* Загрузка слепка Единого бэклога (446 строк → 440 уникальных задач) с
  нормализацией неразрывных пробелов, кварталов и чисел.
* Расчёт `value_internal`: аналогия с задачами, где Value заполнил человек
  (точнее формулы в пять раз по замеру), либо доходный метод и метод экономии
  времени с дисконтированием на 3 года и автоматическим уровнем уверенности.
* Cost, C/V и свёртка восьми факторов в приоритет с настраиваемыми весами и
  правилами-овверрайдами. Полный пересчёт бэклога — **23 с** при норме 264 с.
* Стратегическое соответствие и зависимости между командами оценивают
  собственные субагенты по рубрике: отвечают на критерии, балл считает код,
  суждение хранится с обоснованием и источниками.
* Диапазон рядом с оценкой Value: границы, в которые истинное значение
  попадает в 95% случаев, откалиброванные на фактических ошибках.
* Подсказка под полем Value: метод, вводные, уверенность, что уточнить.
* Ex-post атрибуция `value_external` для обслуживающих команд от факта дохода
  фронта, с защитой от двойного счёта.
* LLM-адаптер с переключением `openai_compat | anthropic | gigachat | gigacode`,
  кэшем классификации и оценок F5/F6 по хешу промпта, журналом токенов и
  переиспользованием HTTP-соединений. `mock` доступен только при явном выборе
  в тестах и никогда не включается как аварийная подмена.
* Гибридный RAG (BM25 + FAISS, RRF) на 1263 фрагментах: закрытый пакет знаний
  банка, знания о трайбе, 440 исторических задач и методика. Качество
  проверяется на 25 размеченных запросах из пакета.
* **Сервис для Backlog coordinator:** два сценария запрос-ответ без доступа к
  базе — атрибуты одной задачи внутрь, Value с диапазоном или приоритет с
  разбором по факторам наружу. Повторяемость: одинаковые атрибуты дают прежний
  ответ без обращения к модели.
* Зашитый слепок исторических Value (192 задачи) — от него живут аналогии и
  шкала фактора F1, когда базы бэклога рядом нет.
* FastAPI, Streamlit-панель, CLI и слой opencode-агента с тремя агентами.
* 359 тестов собрано локально через `pytest --collect-only` 10.09.2026;
  полный прогон: 343 пройдено, 13 пропущено, 3 ожидаемо `xfail`.

## Быстрый старт

В составе Backlog coordinator сервис запускается из корня только по явному флагу:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-project.ps1 -IncludeValuePriorityAssessor
```

Команды ниже предназначены для standalone-разработки prioritiser.

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Развернуть закрытый пакет знаний (нужен приватный ключ из списка получателей;
без него работают остальные три слоя корпуса):

```bash
.venv/bin/python scripts/rag_package_install.py install
```

```bash
.venv/bin/python -m app.cli init --reset && .venv/bin/python -m app.cli recompute --all
```

Посмотреть результат:

```bash
.venv/bin/python -m app.cli stats
```

```bash
.venv/bin/python -m app.cli backlog --sort priority --limit 20
```

Разобрать конкретную задачу — с вкладом каждого фактора, вводными Value и
историей приоритета:

```bash
.venv/bin/python -m app.cli show TASK-100-011
```

## Сценарии Backlog coordinator

Так агент вызывается из ПРОМ-варианта: базы он не видит, атрибуты приходят в
запросе. Контракт — [docs/COORDINATOR-CONTRACT.md](docs/COORDINATOR-CONTRACT.md).

```bash
.venv/bin/python -m app.cli agent value --task-id NEW-001 --task-type "AD-HOC" --team Core --title "Автоматизация сверки лимитов" --deadline "3Q 2026"
```

```bash
.venv/bin/python -m app.cli agent priority --json request.json
```

Аналоги и шкала фактора F1 берутся из зашитого слепка. Собрать и проверить его:

```bash
.venv/bin/python scripts/value_snapshot_build.py --from-db
```

```bash
.venv/bin/python -m app.cli snapshot
```

## Web-интерфейс

```bash
.venv/bin/python -m streamlit run value_priority_assessor/ui/streamlit_app.py
```

Пять вкладок: бэклог с фильтрами, карточка задачи, настройка весов с валидацией
суммы, драйверы расчёта, запуск ex-post атрибуции.

## API

```bash
.venv/bin/python -m uvicorn app.api.main:app --reload
```

Документация — на `http://127.0.0.1:9100/docs`.

Все endpoints, кроме служебных `/health`, `/ready` и `/metrics`, требуют
capability header. Координатор передаёт
`X-Prioritiser-Secret`; административные endpoints `/admin/*` принимают только
отдельный `X-Methodologist-Secret`. В production оба секрета обязательны и
должны отличаться от локальных значений из `.env.example`.

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/health`, `/ready` | Liveness и readiness БД, LLM, модели и индексов |
| `GET` | `/metrics` | Prometheus-метрики запросов, фаз, LLM-вызовов и retry |
| `GET` | `/backlog?sort=priority` | Бэклог с фильтрами и сортировкой |
| `GET` | `/backlog/external` | Выгрузка вовне: **только** `value_external` |
| `GET` | `/tasks/{key}` | Карточка задачи |
| `GET` | `/tasks/{key}/history` | История изменений приоритета |
| `PATCH` | `/tasks/{key}` | Правка атрибутов с пересчётом |
| `POST` | `/recompute-all` | Пересчёт всего бэклога |
| `GET` | `/reports/low-confidence` | Где качество оценки Value ниже всего |
| `PUT` | `/admin/references/{name}` | Новая версия справочника + пересчёт |
| `POST` | `/admin/attribution` | Ex-post атрибуция `value_external`; тело фиксирует `task_keys` периода |
| `GET` | `/rag/search?q=…&layer=…` | Поиск по корпусу |
| `POST` | `/agent/value` | **Сценарий Backlog coordinator:** рассчитай Value(internal) |
| `POST` | `/agent/value/full` | Полный Value с методами, драйверами и аудитом для UI |
| `POST` | `/agent/priority` | **Сценарий Backlog coordinator:** определи приоритет |
| `POST` | `/agent/priority/full` | Полный priority с факторами, overrides и аудитом для UI |
| `GET` | `/agent/snapshot` | Версия зашитого слепка исторических Value |

## Агент в opencode

Runtime ставится локально, глобальная установка не нужна:

```bash
npm install && npm install --prefix .opencode --ignore-scripts
```

```bash
bash tools/launch/start-agent.sh preflight
```

```bash
bash tools/launch/start-agent.sh start --port 4098
```

`preflight` проверяет 12 условий — версии Python и Node, зависимости, наличие
runtime, валидность `opencode.json`, существование файлов промптов, инструменты,
слепок, состояние базы и состав корпуса знаний. `stop` останавливает ровно тот
процесс, который запустил этот клон.

Модель выбирается в селекторе opencode; провайдеры Claude, GigaChat и GigaCode
описаны в `opencode.json`. Контракт агентного слоя — [AGENTS.md](AGENTS.md).

Пятнадцать инструментов и пять агентов: оркестратор `prioritiser`, субагенты
`value-estimator`, `methodologist`, `strategy-analyst`, `dependency-analyst`. Каждый — тонкая обёртка над `python -m app.cli`:
модель собирает вводные и объясняет результат, арифметику выполняет
детерминированный код.

## Настройка

Скопируйте `.env.example` в `.env` и задайте учётные данные модели. Рабочая
конфигурация использует OpenAI-compatible LLM и LLM-оценщик стратегии; без
настроенного провайдера расчёт завершается явной ошибкой, а не mock-подменой:

```bash
PRIORITISER_LLM_PROVIDER=openai_compat   # также anthropic, gigachat, gigacode
```

Для OpenAI-compatible провайдера сетевой вызов имеет ограниченный timeout и
делает bounded retry только при временных ошибках (`429`, `502–504`, timeout и
network error). Одинаковые конкурентные промпты объединяются в один LLM-вызов;
число параллельных оценок F5/F6 ограничивается
`PRIORITISER_ASSESSMENT_MAX_WORKERS`.

Справочники методолога — в `data/references/`:
`value_drivers.yaml`, `factor_weights.yaml`, `overrides.yaml`, `teams.yaml`,
`customer_levels.yaml`, `task_types.yaml`, `value_defaults.yaml`.

## Тесты

```bash
.venv/bin/python -m pytest
```

## Что нужно от команд трайба

Первый прогон на реальных данных показал, что 40% веса модели не различало
задачи: трудозатраты заполнены у 24 задач из 440, а уровни бизнес-заказчиков в
справочнике не проставлены вовсе. Из-за этого 83% бэклога попадало в P3.

Половина проблемы решена в весах версии 2: фактор C/V убран как
мультиколлинеарный — он выводился из Value и трудозатрат, уже учтённых
факторами F1 и F4, и у 94.5% задач подставлялся нейтральным баллом. Доля P3
упала до 62%. Осталось **32% веса**, которые ждут данных:

* **трудозатраты** → F4, вес 0.17;
* **уровни бизнес-заказчиков** в справочнике → F2, вес 0.15.

Справочник уровней подготовлен к заполнению: `data/references/customer_levels.yaml`
содержит всех заказчиков из слепка — 41 человека, 5 коллективных, 15 подразделений,
— отсортированных по числу задач, так что первые двадцать строк закрывают большую
часть бэклога. Проставить нужно один из уровней `tribe_leader`, `director`, `head`,
`team` вместо `unknown`.

По контракту с Backlog coordinator оба поля обязательны для расчёта приоритета, так
что в ПРОМ-варианте пробел закрывается на входе.

Формулы при этом работают ровно по ТЗ. Подробный разбор с цифрами и порядком
действий — [docs/CALIBRATION-FINDINGS.md](docs/CALIBRATION-FINDINGS.md),
причина исключения C/V — [docs/DEVIATIONS-FROM-TZ.md](docs/DEVIATIONS-FROM-TZ.md).

## Документация

| Документ | О чём |
|---|---|
| [docs/METHODOLOGY.md](docs/METHODOLOGY.md) | Формулы, константы, факторы, овверрайды |
| [docs/RAG.md](docs/RAG.md) | База знаний: пакет K3, схема поиска, метрики качества |
| [docs/FACTOR-ASSESSMENT.md](docs/FACTOR-ASSESSMENT.md) | Оценка F5 и F6 субагентами: рубрики, провайдеры, хранение |
| [docs/VALUE-ANALOGY.md](docs/VALUE-ANALOGY.md) | Оценка Value по аналогии: бэктест, уверенность, ограничения |
| [docs/CALIBRATION-FINDINGS.md](docs/CALIBRATION-FINDINGS.md) | Что показал прогон на 440 задачах |
| [docs/DEVIATIONS-FROM-TZ.md](docs/DEVIATIONS-FROM-TZ.md) | Все расхождения с ТЗ и как их вернуть |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Слои, порядок расчёта, кэш, RAG |
| [docs/COORDINATOR-CONTRACT.md](docs/COORDINATOR-CONTRACT.md) | Контракт запрос-ответ: вход, выход, повторяемость, слепок |
| [AGENTS.md](AGENTS.md) | Контракт агентного слоя |

## Статус

Прототип. Standalone-хранилище по умолчанию — SQLite; production baseline DMB
использует отдельную PostgreSQL-БД и применяет Alembic-миграции до запуска
сервиса. API защищён раздельными capability secrets Координатора и методолога;
порт 9100 не публикуется через Nginx. Интеграция с бэклогом выполняется stateless HTTP-вызовами `/agent/*/full`,
а исторические аналоги берутся из зашитого слепка. Полный список
отступлений с причинами — в [docs/DEVIATIONS-FROM-TZ.md](docs/DEVIATIONS-FROM-TZ.md).

Лицензия — MIT.

Проверено 03.11.2026: [логический контекст SDK 1.3](../CONFIGURATION.md). Вложенные вызовы и retries учитываются в одном run; числовые
лимиты текущего профиля сохранены. Полная миграционная приёмка ещё открыта.

Проверено 03.11.2026: новый эксплуатационный `docs/REMOTE_TOOLS.md` исключён
из слоя methodology RAG. Он не является бизнес-методикой; изменение инструкций
развёртывания не должно менять прежний корпус. Остальной отбор документов,
BM25/FAISS/RRF и закреплённый encoder не изменены. Изолированная регрессия PASS.
