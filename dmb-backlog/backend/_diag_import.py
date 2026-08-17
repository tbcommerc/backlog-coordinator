import sqlite3
import unicodedata

con = sqlite3.connect(r"D:\Проект\dmb-backlog\backend\dmb_backlog.db")
cur = con.cursor()

# Получить точное значение label для title
row = cur.execute("SELECT label FROM field_labels WHERE key='title'").fetchone()
db_label = row[0] if row else None
print(f"DB label for 'title': {repr(db_label)}")
print(f"DB label bytes: {db_label.encode('utf-8').hex()}")
print(f"DB label unicode categories: {[unicodedata.category(c) for c in db_label]}")
print()

# Заголовок CSV
csv_header_raw = open("test_import_200.csv", "rb").readline()
csv_header = csv_header_raw.decode("utf-8-sig")
headers = csv_header.split(";")
title_header = headers[1]  # "Название задачи"
print(f"CSV header[1]: {repr(title_header)}")
print(f"CSV header[1] bytes: {title_header.encode('utf-8').hex()}")
print(f"CSV header[1] unicode categories: {[unicodedata.category(c) for c in title_header]}")
print()

# Сравнение
print(f"Equal (direct): {db_label == title_header}")
print(f"Equal (stripped): {db_label.strip() == title_header.strip()}")

# Нормализация NFC
db_nfc = unicodedata.normalize('NFC', db_label) if db_label else None
csv_nfc = unicodedata.normalize('NFC', title_header)
print(f"Equal (NFC): {db_nfc == csv_nfc}")
print(f"DB NFC bytes: {db_nfc.encode('utf-8').hex()}")
print(f"CSV NFC bytes: {csv_nfc.encode('utf-8').hex()}")
print()

# Что _norm() делает с этими строками
import re
def _norm(value):
    return re.sub(r'\s+', ' ', str(value).strip().lower())

db_norm = _norm(db_label)
csv_norm = _norm(title_header)
print(f"_norm(DB): {repr(db_norm)}")
print(f"_norm(CSV): {repr(csv_norm)}")
print(f"_norm equal: {db_norm == csv_norm}")
print()

# Проверить ЧТО импорт видит — запустить parse_csv
import csv, io
content = open("test_import_200.csv", "rb").read().decode("utf-8-sig")
first_line = content.split("\n", 1)[0]
print(f"First line (from content): {repr(first_line[:80])}")
reader = csv.DictReader(io.StringIO(content), delimiter=";")
first_row = next(reader)
print(f"First row keys (DictReader): {list(first_row.keys())[:5]}")
title_key = first_row.get("Название задачи", "NOT FOUND")
print(f"First row['Название задачи']: {repr(title_key)}")
print()

# Что field_map содержит
print("=== Testing build_field_map directly ===")
from database import Base
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(".")))
# Need to import models and import_service
import import_service as svc
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import Base

engine = create_engine("sqlite:///./dmb_backlog.db", connect_args={"check_same_thread": False})
Base.metadata.create_all(bind=engine)
Session = sessionmaker(bind=engine)
db_session = Session()

field_map, db_key_to_label, required = svc.build_field_map(db_session)
print(f"field_map for 'название задачи': {field_map.get('название задачи')}")
print(f"field_map for 'Название задачи': {field_map.get('Название задачи')}")
# Check all keys that contain 'назва'
matching = {k: v for k, v in field_map.items() if 'назва' in k.lower()}
print(f"keys containing 'назва': {matching}")

# Check _norm versions
print(f"\n_norm('Название задачи') = {_norm('Название задачи')}")
print(f"_norm('название задачи') = {_norm('название задачи')}")

db_session.close()
con.close()
