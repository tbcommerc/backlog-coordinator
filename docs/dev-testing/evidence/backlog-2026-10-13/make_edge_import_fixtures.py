"""Synthetic workbooks for browser-only import review."""
from pathlib import Path
from openpyxl import Workbook
import xlsxwriter

root = Path(__file__).resolve().parent
headers = ['Название задачи', 'Ответственная команда', 'Описание задачи']
row = ['UX-AUDIT-20261013 структура файла', 'Проектный офис', 'Проверка предпросмотра без импорта']

wb = Workbook()
wb.active.title = 'Инструкция'
wb.active.append(['Задачи находятся на листе Данные'])
ws = wb.create_sheet('Данные')
ws.append(headers)
ws.append(row)
wb.save(root / 'ux-multisheet.xlsx')

wb = Workbook()
ws = wb.active
ws.append(['Отчёт для проверки смещённой шапки'])
ws.append([])
ws.append(headers)
ws.append(row)
wb.save(root / 'ux-offset-header.xlsx')

wb = Workbook()
ws = wb.active
ws.append(headers + ['Незнакомая колонка'])
ws.append(row + ['Дополнительное безопасное значение'])
wb.save(root / 'ux-extra-column.xlsx')

wb = Workbook()
ws = wb.active
ws.append(headers)
ws.append(['UX-AUDIT-20261013 длинное название ' + 'длина ' * 100, 'Проектный офис', 'Описание ' * 1200])
wb.save(root / 'ux-long-values.xlsx')

wb = xlsxwriter.Workbook(root / 'ux-formula-cached.xlsx')
ws = wb.add_worksheet('Данные')
ws.write_row(0, 0, headers)
ws.write(1, 0, 'UX-AUDIT-20261013 формула')
ws.write(1, 1, 'Проектный офис')
ws.write_formula(1, 2, '=1+1', None, 2)
wb.close()
print('5 edge workbooks generated: multi-sheet, offset, extra, long, cached formula')
