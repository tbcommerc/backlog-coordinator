import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DID_COLUMNS, defaultDidPrefs, didVisibleRows, didDisplay, renderDidBacklog } from '../js/components/didBacklog.js';

test('Девять колонок, сто процентов ширины, ноль и пробелы', () => {
  const prefs = defaultDidPrefs('3Q 2026');
  assert.equal(DID_COLUMNS.length, 9);
  assert.equal(Object.values(prefs.widths).reduce((a, b) => a + b), 100);
  assert.equal(didDisplay({ financial_effect: 0, gaps: [] }, 'financial_effect'), '0,0');
  assert.equal(didDisplay({ title: '', gaps: ['title'] }, 'title'), 'не заполнено');
  assert.doesNotMatch(renderDidBacklog(), /canvas|stat-card/);
});

test('Числовая сортировка и пустые значения в конце', () => {
  const rows = [{ id: 1, financial_effect: null, gaps: ['financial_effect'] }, { id: 2, financial_effect: 10, gaps: [] }, { id: 3, financial_effect: 2, gaps: [] }];
  const prefs = { ...defaultDidPrefs('3Q 2026'), sortField: 'financial_effect' };
  assert.deepEqual(didVisibleRows(rows, prefs).map(r => r.id), [3, 2, 1]);
  assert.deepEqual(didVisibleRows(rows, { ...prefs, sortDir: 'desc' }).map(r => r.id), [2, 3, 1]);
});

test('Совместные фильтры и русская сортировка', () => {
  const rows = [{ id: 1, title: 'Январь', financial_effect: 0, gaps: [] }, { id: 2, title: 'Апрель', financial_effect: 1000, gaps: [] }];
  const prefs = { ...defaultDidPrefs('3Q 2026'), sortField: 'title' };
  assert.deepEqual(didVisibleRows(rows, prefs).map(r => r.id), [2, 1]);
  prefs.filters = { financial_effect: ['1000'], title: ['Апрель'] };
  assert.deepEqual(didVisibleRows(rows, prefs).map(r => r.id), [2]);
  prefs.filters.title = ['Январь'];
  assert.equal(didVisibleRows(rows, prefs).length, 0);
});

test('ДИД использует порядок справочника для клиента, типа и срока', () => {
  const rows = [
    { id: 3, did_client_group: 'Альфа', gaps: [], group_order: 3 },
    { id: 1, did_client_group: 'Янтарь', gaps: [], group_order: 1 },
    { id: 2, did_client_group: 'Бета', gaps: [], group_order: 2 },
  ];
  const prefs = { ...defaultDidPrefs('3Q 2026'), sortField: 'did_client_group' };
  assert.deepEqual(didVisibleRows(rows, prefs).map(row => row.id), [1, 2, 3]);
});
