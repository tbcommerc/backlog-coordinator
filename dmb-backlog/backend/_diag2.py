import csv, io, re

def _norm(value):
    return re.sub(r'\s+', ' ', str(value).strip().lower())

content = open("test_import_200.csv", "rb").read().decode("utf-8-sig")
first_line = content.split("\n", 1)[0]
print("First line:", repr(first_line[:80]))
print()

reader = csv.DictReader(io.StringIO(content), delimiter=";")
first_row = next(reader)
header_keys = list(first_row.keys())
print(f"DictReader headers ({len(header_keys)}):")
for i, k in enumerate(header_keys[:5]):
    print(f"  [{i}]: repr={repr(k)} hex={k.encode('utf-8').hex()}")
    print(f"       _norm={repr(_norm(k))}")

print()
print(f"first_row['Название задачи'] (direct): {repr(first_row.get('Название задачи', 'NOT FOUND'))}")
print(f"first_row['название задачи'] (lower): {repr(first_row.get('название задачи', 'NOT FOUND'))}")
norm_key = _norm('Название задачи')
print(f"_norm('Название задачи') = {repr(norm_key)}")
print()

# Simulate what field_map contains
import sqlite3
con = sqlite3.connect(r"D:\Проект\dmb-backlog\backend\dmb_backlog.db")
cur = con.cursor()
labels = cur.execute("SELECT key, label FROM field_labels WHERE key='title'").fetchall()
for key, label in labels:
    print(f"DB: key={key!r}, label={label!r}, label.lower()={label.lower()!r}")
    norm_label = _norm(label)
    print(f"  _norm(label)={norm_label!r}")
    print(f"  _norm('Название задачи')={_norm('Название задачи')!r}")
    print(f"  Match: {_norm(label) == _norm('Название задачи')}")
con.close()
