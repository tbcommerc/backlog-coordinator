# Подключение источников Knowledge Base

> AS-IS проверено по `kb/contracts.py`, `kb/sources.py`, `kb/adapters.py` и
> профильным тестам 01.09.2026.

Агент получает знания через общий контракт `KnowledgeSource`. Тип хранения не
должен влиять на Q&A, оркестратор и Composer.

## Общий результат

Каждый адаптер возвращает `RetrievalResult`, который содержит:

- `KnowledgeRecord` — текст, идентификатор, тип источника, заголовок, URI,
  версию и метаданные;
- `score` — нормализованный confidence от 0 до 1;
- `raw_score` — нативная оценка провайдера;
- `provider` и `rank` — трассировка выполнения поиска.

## Внешний RAG

```python
from business_analyst.kb.adapters import ExternalRAGSource, ResultFieldMap

source = ExternalRAGSource(
    source_id="corporate_rag",
    fetcher=rag_client.search,
    fields=ResultFieldMap(
        content="chunk.text",
        record_id="chunk.id",
        title="document.title",
        uri="document.url",
        score="similarity",
        metadata="attributes",
    ),
)
```

`fetcher` должен иметь сигнатуру `(query, k, filters)` и возвращать iterable
из словарей. Сетевой клиент, авторизация и повторные попытки остаются снаружи
адаптера.

## База данных

```python
from business_analyst.kb.adapters import DatabaseKnowledgeSource, ResultFieldMap

source = DatabaseKnowledgeSource(
    source_id="requirements_db",
    fetcher=repository.search_approved_requirements,
    fields=ResultFieldMap(
        content="summary",
        record_id="requirement_id",
        title="title",
        uri="reference_uri",
        score="confidence",
    ),
)
```

Адаптер не создаёт SQL и не управляет транзакциями. Переданный callback обязан
быть read-only, применять права доступа и не возвращать запрещённые поля.

## Калибровка score

- `normalized_score` — провайдер уже возвращает значение 0–1;
- `signed_cosine_score` — cosine similarity находится в диапазоне −1…1;
- `distance_score` — провайдер возвращает неотрицательное расстояние;
- `exponential_distance_score` — более строгое преобразование расстояния.

Если источник не возвращает score, передаётся `score_normalizer=None`, а его
допуск регулируется `RetrievalPolicy.allow_unscored`.

Пороги задаются по типу источника:

```python
RetrievalPolicy(
    default_min_score=0.25,
    min_score_by_source_type={"rag": 0.7, "markdown": 0.25},
    allow_unscored=True,
)
```
