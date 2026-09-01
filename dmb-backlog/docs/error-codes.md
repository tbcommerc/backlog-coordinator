# Ошибки API и импорта — AS-IS

> Статус: проверено по `frontend/js/api.js`, `frontend/js/components/quickEdit.js`,
> `backend/import_service.py` и роутерам FastAPI на 2026-09-01.

## Формат ошибок API

Единого реестра прикладных кодов для всего backend нет. FastAPI обычно возвращает
поле `detail`; отдельные обработчики могут возвращать объект в `detail`. Клиент
`APIError` сохраняет HTTP-статус, необязательное поле верхнего уровня `code`,
разобранный JSON и исходный текст.

Клиент явно распознаёт `401`, `403`, `404`, `422`, `429` и статусы `>=500`.
Быстрое редактирование отправляет `version`; несовпадение с текущей версией задачи
даёт `409` с деталями текущей и переданной версий. `423` используется некоторыми
операциями для заблокированной задачи. Точный контракт конкретной операции нужно
сверять с соответствующим роутером, а не выводить только из этого справочника.

## Типы ошибок импорта CSV

Фатальные ошибки пропускают строку:

- `team_not_found`
- `channel_not_found`
- `business_customer_not_found`
- `department_not_found`
- `project_not_found`
- `task_type_not_found`
- `priority_not_found`
- `deadline_not_found`
- `status_not_found`
- `required_missing`
- `invalid_date`
- `invalid_number`
- `invalid_progress`
- `unknown_error`

`owner_not_found` нефатальна: строка может быть импортирована без исполнителя.
Для неизвестной вовлечённой команды используется `team_not_found`.

В текущей реализации нет ошибки `duplicate_external_id`, поскольку у модели
задачи нет поля `external_id` и такая проверка не выполняется.

Структура элемента `errors`:

```json
{
  "row": 3,
  "field": "team_id",
  "field_label": "Ответственная команда",
  "value": "Команда X",
  "type": "team_not_found",
  "message": "...",
  "fatal": true
}
```

Подробнее: [импорт CSV](IMPORT_SPEC.md) и [индекс API](API_SPEC.md).
