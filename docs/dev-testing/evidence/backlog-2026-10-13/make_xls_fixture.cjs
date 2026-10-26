const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { exports: {}, Buffer };
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../../../dmb-backlog/frontend/js/lib/xlsx.full.min.js'), 'utf8'), context);
const XLSX = context.exports;
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ['Название задачи', 'Ответственная команда', 'Описание задачи'],
  ['UX-AUDIT-20261013 XLS проверка', 'Проектный офис', 'Настоящий бинарный Excel BIFF8\nВторая строка']
]), 'UX review');
const file = path.join(__dirname, 'ux-valid-biff8.xls');
fs.writeFileSync(file, XLSX.write(workbook, { bookType: 'biff8', type: 'buffer' }));
const bytes = fs.readFileSync(file);
if (bytes.subarray(0,8).toString('hex') !== 'd0cf11e0a1b11ae1') throw new Error('Expected CFB signature');
const reopened = XLSX.read(bytes, { type: 'buffer' });
if (XLSX.utils.sheet_to_json(reopened.Sheets['UX review']).length !== 1) throw new Error('Unexpected row count');
console.log('Verified binary XLS fixture: one task, CFB signature, BIFF8');
