"""Synthetic UX import fixture; no credentials or production input."""
from pathlib import Path
from openpyxl import Workbook, load_workbook

root = Path(__file__).resolve().parent
wb = Workbook()
ws = wb.active
ws.title = "UX review"
ws.append(["Название задачи", "Ответственная команда", "Описание задачи"])
ws.append(["UX-AUDIT-20261013 XLSX проверка", "Проектный офис", "Первая строка\nВторая строка; запятая, кавычки \"тест\""])
ws.append([None, "Проектный офис", "Строка без обязательного названия"])
ws.append(["UX-AUDIT-20261013 XLSX проверка", "Проектный офис", "Повторное название в одном файле"])
path = root / "ux-partial-valid.xlsx"
wb.save(path)
check = load_workbook(path, read_only=True)
assert check.active.max_row == 4
assert check.active["C2"].value.count("\n") == 1
print(path.name, "4 rows, 3 columns, multiline verified")

csv_text = 'Название задачи;Ответственная команда;Описание задачи\r\nUX-AUDIT-20261013 кодировка;Проектный офис;Текст для предпросмотра\r\n'
(root / 'ux-utf8-bom.csv').write_text(csv_text, encoding='utf-8-sig')
(root / 'ux-cp1251.csv').write_bytes(csv_text.encode('cp1251'))
(root / 'ux-missing-header.csv').write_text('Название задачи;Описание задачи\r\nUX-AUDIT-20261013 нет команды;Проверка обязательного заголовка\r\n', encoding='utf-8')
(root / 'ux-1001-invalid.csv').write_text('Название задачи;Ответственная команда;Описание задачи\r\n' + ''.join(f';Проектный офис;UX-AUDIT-20261013 неверная строка {i}\r\n' for i in range(1,1002)), encoding='utf-8')
print('CSV fixtures: BOM, CP1251, missing header, 1001 invalid rows')
