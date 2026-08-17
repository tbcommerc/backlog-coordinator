"""Отладочный скрипт для диагностики импорта."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(".")))

import import_service as svc
from database import get_db, engine
from sqlalchemy.orm import Session

# Используем ту же сессию что и endpoint
db = next(get_db())

# Прочитать CSV
csv_content = open("test_import_200.csv", "rb").read().decode("utf-8-sig")
delimiter = svc.detect_delimiter(csv_content)
print(f"Delimiter: {repr(delimiter)}")

rows = svc.parse_csv(csv_content, delimiter)
print(f"Total rows parsed: {len(rows)}")
print(f"First row keys: {list(rows[0].keys())}")
print(f"First row sample: {dict(list(rows[0].items())[:5])}")
print()

# Построить field_map
field_map, db_key_to_label, required_fields = svc.build_field_map(db)
print(f"db_key_to_label count: {len(db_key_to_label)}")
print(f"db_key_to_label['title']: {repr(db_key_to_label.get('title', 'NOT FOUND'))}")
print(f"field_map keys count: {len(field_map)}")
print(f"required_fields: {required_fields}")
print()

# Проверить маппинг для "Название задачи"
test_keys = list(rows[0].keys())
for tk in test_keys:
    norm = svc._norm(tk)
    mapped = field_map.get(norm)
    if mapped:
        print(f"  Header {repr(tk)[:30]} -> field_map[{repr(norm)[:30]}] = {repr(mapped)}")
        break
print()

# Обработать первые 3 строки
refs = svc.load_reference_indexes(db)

print("=== Обработка первых 3 строк ===")
for i in range(min(3, len(rows))):
    row_num = i + 2
    task, errors = svc.process_row(
        row_num, rows[i], field_map, db_key_to_label, refs,
        required_fields, db, 1
    )
    print(f"Row {row_num}: task={'CREATED' if task else 'NONE'}")
    print(f"  errors: {[(e['type'], e['field'], repr(e['value'])[:20]) for e in errors]}")
    if task:
        print(f"  task.title={repr(getattr(task, 'title', None))}")
        print(f"  task.team_id={getattr(task, 'team_id', None)}")

db.close()
