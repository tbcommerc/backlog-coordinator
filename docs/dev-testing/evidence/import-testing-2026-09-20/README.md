# Evidence: импорт задач, 20.09.2026

Каталог содержит входные файлы и результаты датированного аудита
[`../../IMPORT_UX_UI_AUDIT_2026-09-20.md`](../../IMPORT_UX_UI_AUDIT_2026-09-20.md).
Это воспроизводимая доказательная база, а не описание текущего AS-IS после
будущих изменений продукта.

## Состав

- `inputs/` — 56 CSV/XLS/XLSX и файлов с ошибочными расширениями/байтами;
- `manifest.json`, `manifest.csv` — назначение и ожидаемый класс результата;
- `parser-probe-results.json` — результат серверного parser/service;
- `route-probe-results.json` — результат HTTP-граничных сценариев;
- `transaction-probe-results.json` — savepoint/commit/rollback;
- `ui-ux-results.json` — actual-DOM измерения и UI preflight;
- `xlsx-verification.json` и `*.inspect.ndjson` — повторное чтение книг;
- `previews/` — render листов XLSX;
- `ui-screenshots/` — визуальная проверка интерфейса;
- `build_test_inputs.mjs`, `verify_test_inputs.mjs`, `probe_*.py` — генераторы и probes.

Сценарии не записывают данные в БД и не изменяют справочники, пользователей,
роли, команды или их защищённые атрибуты.

