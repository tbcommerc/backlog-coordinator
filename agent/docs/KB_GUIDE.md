# Knowledge Base AI Business Analyst Agent

> AS-IS проверено по `kb_seed/`, `agent/kb/` и профильным тестам 08.09.2026.

## Назначение

Knowledge Base даёт агенту подтверждённый контекст для Q&A, извлечения фактов и
трассируемых источников draft. Агент не должен превращать найденный фрагмент в
утверждённое бизнес-требование без участия пользователя и ревьюера.

## Curated corpus

Локальный корпус находится в `agent/kb_seed/`:

- `manifest.json` — реестр документов, status, priority и domain metadata;
- `business_context.md`, `architecture.md`;
- `products.md`, `modules.md`, `processes.md`, `roles.md`;
- `regulations.md`, `settlement_statuses.md`;
- `requirements_history.json` — история для поиска похожих требований.

`KnowledgeBase` читает только manifest и указанные в нём Markdown-файлы,
разбивает их по заголовкам и индексирует approved chunks. KB загружается при
импорте runtime; после изменения корпуса сервис нужно перезапустить.

## Manifest

Каждая запись `documents` содержит как минимум:

```json
{
  "id": "products",
  "title": "Продукты",
  "domain": "business",
  "status": "approved",
  "priority": 90,
  "products": [],
  "modules": [],
  "processes": []
}
```

- `id` совпадает с именем Markdown без расширения;
- только `status=approved` допускается в выдачу;
- `priority` участвует в ранжировании;
- product/module/process metadata используется для фильтрации и источников.
- необязательные `version` и `updated_at` передаются в выдачу без подмены датой
  загрузки; отсутствие даты означает неизвестную актуальность.

JSON-комментарии не поддерживаются. Manifest должен быть валидным UTF-8 JSON.

## Поиск

`KBSearch` использует детерминированный лексический BM25-подобный score с общей
нормализацией русских и английских токенов. `RetrievalService` собирает ответы
от нескольких `KnowledgeSource`, применяет `RetrievalPolicy`, сортирует по
score/source priority и ограничивает итоговый `k`.

Score отражает поисковое соответствие, а не достаточность ответа. Активный
runtime называет выдачу справочными фрагментами и явно сообщает, что конкретный
ответ может отсутствовать. По умолчанию сериализуется полный фрагмент раздела;
явное ограничение длины помечает сокращение. Автоматически найденные ссылки при
подготовке резюме получают `usage=reference_candidate` и не подтверждают факты.
Предположения хранятся отдельно и не теряются после нового поиска.

Остаётся ограничение: отдельной семантической проверки достаточности ответа и
экспертной верификации дат всего корпуса пока нет. Их нельзя вывести из BM25
или заполнить датами автоматически.

По умолчанию runtime подключает `MarkdownKnowledgeSource`. Для истории
требований есть отдельный `RequirementsHistorySource`; внешние источники не
включаются одной переменной — их нужно явно создать и передать сервису.

## Общий контракт источников

`KnowledgeSource` возвращает `RetrievalResult`:

- нормализованный `KnowledgeRecord` с content, source ID/type, title, URI,
  version и metadata;
- `score` 0–1 и необязательный `raw_score`;
- provider и provider rank.

Реализованы:

- `MarkdownKnowledgeSource`;
- `RequirementsHistorySource`;
- `ExternalRAGSource`;
- `DatabaseKnowledgeSource`.

RAG/DB adapters получают read-only callback. Они не создают HTTP/SQL, не
управляют credentials и не обходят object-level security. Настройка field map и
score normalization описана в
[KB_SOURCE_ADAPTERS.md](KB_SOURCE_ADAPTERS.md).

## Онтология

`agent/kb/ontology.py` строит сущности из заголовков curated Markdown и aliases
в скобках. Она поддерживает product/module/process/role matching и простую
морфологическую нормализацию. Онтология не является отдельным master-data
справочником и не должна автоматически изменять защищённые справочники backlog.

## Добавление документа

1. Добавить UTF-8 Markdown в `kb_seed/` с одним `#` и содержательными `##`.
2. Добавить запись в `manifest.json` с уникальным `id`.
3. Сначала использовать `status=draft`, проверить содержание и metadata.
4. После ревью переключить в `approved`.
5. Запустить профильные тесты и перезапустить Agent.

Нельзя помещать в Git секреты, персональные данные, закрытый corpus без
разрешённого механизма хранения или автоматически выгруженные рабочие данные.

## Проверка

Из каталога `agent`:

```powershell
..\.venv\Scripts\python.exe -m pytest `
  agent\tests\test_kb_search.py `
  agent\tests\test_kb_contracts.py `
  agent\tests\test_kb_adapters.py `
  -q -p no:cacheprovider
```

Быстрая read-only статистика:

```powershell
..\.venv\Scripts\python.exe -c "from agent.kb.loader import kb; print(kb.stats())"
```

Конкретные числа документов/chunks меняются вместе с manifest и не фиксируются
как постоянный контракт.

## Типовые проблемы

- Документ не загружен: проверить `id`, имя файла, JSON и `status`.
- Пустая выдача: проверить approved status, токены запроса и policy threshold.
- Неверный score внешнего провайдера: выбрать правильный normalizer и сохранить
  raw score для диагностики.
- Утечка между пользователями: исправить интеграционный callback; adapter не
  добавляет авторизацию автоматически.
- Устаревший corpus: обновить источник, версию/metadata, перезапустить Agent и
  зафиксировать доказательства проверки.
