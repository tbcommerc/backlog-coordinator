import assert from 'node:assert/strict';
import test from 'node:test';

import { applyColumnSort, setReferenceSortOrders } from '../js/components/tableUtils.js';
import { sortFilterOptions } from '../js/components/filterToolbar.js';

test('статусы сортируются по жизненному циклу, а не по алфавиту', () => {
  const rows = [
    { id: 3, status_name: 'ВЫПОЛНЕНА' },
    { id: 1, status_name: 'НОВАЯ ЗАДАЧА' },
    { id: 2, status_name: 'СБОР ТРЕБОВАНИЙ' },
  ];
  assert.deepEqual(applyColumnSort(rows, 'status', 'asc').map(row => row.id), [1, 2, 3]);
});

test('сроки сортируются хронологически, а без срока остаётся в конце', () => {
  const rows = [
    { id: 4, deadline_name: 'БЕЗ СРОКА' },
    { id: 3, deadline_name: '1Q 2027' },
    { id: 2, deadline_name: '2026' },
    { id: 1, deadline_name: '4Q 2026' },
  ];
  assert.deepEqual(applyColumnSort(rows, 'deadline', 'asc').map(row => row.id), [1, 2, 3, 4]);
});

test('таблица и фильтр используют один порядок справочника', () => {
  const configured = [
    { value: 'Цель', sort_order: 1 },
    { value: 'AD-HOC', sort_order: 2 },
    { value: 'Техдолг', sort_order: 3 },
  ];
  setReferenceSortOrders({ task_type: configured });
  const rows = [
    { id: 3, task_type_name: 'Техдолг' },
    { id: 1, task_type_name: 'Цель' },
    { id: 2, task_type_name: 'AD-HOC' },
  ];
  assert.deepEqual(applyColumnSort(rows, 'task_type', 'asc').map(row => row.id), [1, 2, 3]);
  assert.deepEqual(sortFilterOptions(new Set(['Техдолг', 'Цель', 'AD-HOC']), configured), ['Цель', 'AD-HOC', 'Техдолг']);
});

test('незаполненные значения остаются в конце в обоих направлениях', () => {
  const rows = [{ id: 1, priority_name: null }, { id: 2, priority_name: 'ВЫСОКИЙ' }, { id: 3, priority_name: 'НИЗКИЙ' }];
  assert.deepEqual(applyColumnSort(rows, 'priority', 'asc').map(row => row.id), [2, 3, 1]);
  assert.deepEqual(applyColumnSort(rows, 'priority', 'desc').map(row => row.id), [3, 2, 1]);
});
