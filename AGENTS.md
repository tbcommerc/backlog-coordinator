Всегда общайся с пользователем на русском языке независимо от языка запроса.

Always communicate with the user in Russian regardless of the query language.

## ЖЁСТКИЙ ЗАПРЕТ — БАЗА ДАННЫХ

**НИКОГДА НЕ ИЗМЕНЯЙ ДАННЫЕ В БД без прямого явного указания пользователя.**

Запрещено без подтверждения пользователя:
- Отправлять PUT/POST/PATCH запросы к API, которые изменяют данные
- Выполнять SQL-запросы UPDATE/INSERT/DELETE
- Использовать Python-скрипты с db.commit()
- Перезаписывать любые существующие данные при тестировании
- Отправлять в тестовом запросе поля, не относящиеся к проверяемой функциональности

При тестировании API:
- Используй ТОЛЬКО GET-запросы
- Если нужен PUT/POST — используй МИНИМАЛЬНЫЙ набор полей (только тестируемый функционал), а НЕ полную копию seed-данных
- Никогда не отправляй `name`, `description`, `pl`, `po`, `cl` при тестировании если только эти поля не являются целью теста

## HARD BAN — DATABASE

**NEVER MODIFY DB DATA without explicit direct user instruction.**

Forbidden without user confirmation:
- PUT/POST/PATCH API calls that change data
- SQL UPDATE/INSERT/DELETE queries
- Python scripts with db.commit()
- Overwriting any existing data during testing
- Sending irrelevant fields in test requests

When testing API:
- Use ONLY GET requests
- If PUT/POST is needed — use MINIMAL field set (only the feature under test), NOT full seed data copy
- Never send `name`, `description`, `pl`, `po`, `cl` unless those fields ARE the test target

## SCHEMA MIGRATIONS — AUTO

При добавлении новых колонок в models.py:
- `database.py:ensure_schema()` автоматически добавляет недостающие колонки через ALTER TABLE
- НИКОГДА не запускай ALTER TABLE вручную
- Просто добавь колонку в models.py, перезапусти сервер — всё подхватится

When adding new columns to models.py:
- `database.py:ensure_schema()` auto-adds missing columns via ALTER TABLE
- NEVER run ALTER TABLE manually
- Just add the column to models.py, restart server — it auto-migrates

## НЕ ОСТАНАВЛИВАЙСЯ — ДОВОДИ ДО КОНЦА

**Запрещено останавливаться после перезапуска сервера.** Перезапуск сервера — это техническая операция внутри задачи, а не повод ждать указаний.

Одно изменение → сразу следующее. Весь PDLC-цикл должен пройти за один прогон, без пауз на ожидание.

### Порядок действий в рамках одной задачи:
1. Выполни изменение (код, данные, конфиг)
2. Сообщи пользователю 1 предложением, что сделано
3. Если нужно перезапустить сервер — перезапусти и **сразу продолжай** (не жди, не спрашивай)
4. Выполни следующее изменение в рамках той же задачи
5. В конце — итоговый summary всей задачи

### Правило «единого потока»:
- Не останавливайся, пока вся задача не завершена
- Не жди подтверждения на каждом шаге — пользователь скажет, если что-то не так
- Если задача включает 5 шагов, сделай все 5 без пауз
- Между шагами — только технические задержки (sleep), без ожидания ввода пользователя
- Если сервер упал — перезапусти и продолжай

### Если ошибка:
1. Исправь сразу
2. Перезапусти сервер
3. Продолжай без остановки
4. В конце напиши summary всех исправлений
