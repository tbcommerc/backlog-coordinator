import assert from 'node:assert/strict';
import test from 'node:test';

import { getSelectedItems, reconcileSelection, setAllSelection } from '../js/components/tableSelection.js';

const tasks = Array.from({ length: 205 }, (_, index) => ({
  id: index + 1,
  editable: index % 10 !== 0,
}));

test('select all covers every filtered task across pagination', () => {
  const selected = new Set();
  const filtered = tasks.filter(task => task.id <= 150);

  setAllSelection(selected, filtered, true, task => task.editable);

  assert.equal(selected.size, 135);
  assert.equal(selected.has(102), true);
  assert.equal(selected.has(141), false);
  assert.equal(getSelectedItems(selected, filtered).length, 135);
});

test('selection survives page changes and is pruned when filters change', () => {
  const selected = new Set([1, 102, 201]);
  const filtered = tasks.filter(task => task.id >= 100 && task.id <= 180);

  reconcileSelection(selected, filtered, task => task.editable);

  assert.deepEqual([...selected], [102]);
});

test('clearing select all removes the entire filtered selection', () => {
  const selected = new Set([1, 101, 201]);
  const filtered = tasks.filter(task => task.id <= 150);

  setAllSelection(selected, filtered, false, task => task.editable);

  assert.deepEqual([...selected], []);
});
