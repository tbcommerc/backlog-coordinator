import re, sqlite3

def _norm(value):
    return re.sub(r'\s+', ' ', str(value).strip().lower())

# Заголовок из CSV
content = open("test_import_200.csv", "rb").read().decode("utf-8-sig")
header_key = content.split(";")[1]  # "Название задачи"
print(f"CSV header key: {repr(header_key)}")
print(f"CSV header hex: {header_key.encode('utf-8').hex()}")
print(f"CSV header lower: {repr(header_key.lower())}")
print(f"CSV header lower hex: {header_key.lower().encode('utf-8').hex()}")
print()

# Что в БД для title
con = sqlite3.connect(r"D:\Проект\dmb-backlog\backend\dmb_backlog.db")
cur = con.cursor()
row = cur.execute("SELECT key, label, is_required FROM field_labels WHERE key='title'").fetchone()
if row:
    db_key, db_label, db_req = row
    print(f"DB label: {repr(db_label)}")
    print(f"DB label hex: {db_label.encode('utf-8').hex()}")
    print(f"DB label lower: {repr(db_label.lower())}")
    print(f"DB label lower hex: {db_label.lower().encode('utf-8').hex()}")
    print(f"_norm(db_label): {repr(_norm(db_label))}")
    print(f"_norm(csv_header): {repr(_norm(header_key))}")
    print(f"Match: {_norm(db_label) == _norm(header_key)}")
    print(f"Equal (direct): {db_label == header_key}")
    print(f"Equal (lower): {db_label.lower() == header_key.lower()}")
con.close()
print()

# Проверить все возможные Unicode-варианты
import unicodedata
db_label_test = "Название задачи"  # typed directly
csv_label_test = header_key
print(f"db_label typed: {repr(db_label_test)} hex={db_label_test.encode('utf-8').hex()}")
print(f"csv from file: {repr(csv_label_test)} hex={csv_label_test.encode('utf-8').hex()}")
print(f"NFC match: {unicodedata.normalize('NFC', db_label_test) == unicodedata.normalize('NFC', csv_label_test)}")
print(f"NFD match: {unicodedata.normalize('NFD', db_label_test) == unicodedata.normalize('NFD', csv_label_test)}")
print(f"NFKC match: {unicodedata.normalize('NFKC', db_label_test) == unicodedata.normalize('NFKC', csv_label_test)}")
print(f"NFKD match: {unicodedata.normalize('NFKD', db_label_test) == unicodedata.normalize('NFKD', csv_label_test)}")
