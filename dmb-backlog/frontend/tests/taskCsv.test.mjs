import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csvCell, csvRows, taskCsvValue, parseCsvRows } from '../js/taskCsv.js';

test('CSV protects formulas but keeps numeric negative values', () => {
  for (const value of ['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', '  =1+1']) assert.equal(csvCell(value), `'${value}`);
  assert.equal(csvCell(-12.5), '-12.5');
  assert.equal(csvCell('a;"b"\nc'), '"a;""b""\nc"');
  assert.equal(csvRows([['A', 'B'], ['1;2', null]]), '\uFEFFA;B\r\n"1;2";\r\n');
});
test('CSV maps reference labels, object lists, booleans and public IDs', () => {
  const task = {id:41,status_name:'В работе',owner_name:'Иван',tags:[{name:'А'},{name:'Б'}],involved_team_names:['Один','Два'],did_demo:false};
  for (const [key,value] of Object.entries({id:'TASK-000-041',status:'В работе',owner:'Иван',tags:'А, Б',involved_teams:'Один, Два',did_demo:'Нет',project:''})) assert.equal(taskCsvValue(task,key),value);
});

test('CSV reader keeps quoted delimiters, escaped quotes and multiline cells', () => {
  const rows=[['title','team_id','description'],['Тест; "пример"','Команда','строка1\r\nстрока2']];
  assert.deepEqual(parseCsvRows(csvRows(rows)).rows,rows);
  assert.deepEqual(parseCsvRows('title,team_id,description\nТест,Команда,текст;текст').rows[1],['Тест','Команда','текст;текст']);
  assert.throws(()=>parseCsvRows('title;team_id\n"broken'),/кавычки/);
});
