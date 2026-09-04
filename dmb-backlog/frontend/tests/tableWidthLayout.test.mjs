import assert from 'node:assert/strict';
import test from 'node:test';

import { applyColumnWidths } from '../js/components/tableUtils.js';

function makeTable(containerWidth, initialColWidths) {
  const cols = initialColWidths.map(width => ({
    offsetWidth: width,
    style: { width: `${width}px` },
  }));
  return {
    id: '',
    parentElement: { clientWidth: containerWidth },
    style: {},
    querySelectorAll(selector) {
      return selector === 'colgroup > col' ? cols : [];
    },
    cols,
  };
}

test('таблица бэклога заполняет широкий контейнер, не меняя сохраняемые ширины', () => {
  const table = makeTable(600, [40, 220, 120]);
  const widths = { title: 220, status: 120 };

  applyColumnWidths(table, ['title', 'status'], widths, { offset: 1, fixed: { status: 120 } });

  assert.equal(table.style.width, '600px');
  assert.equal(table.cols[0].style.width, '40px');
  assert.equal(table.cols[1].style.width, '440px');
  assert.equal(table.cols[2].style.width, '120px');
  assert.deepEqual(widths, { title: 220, status: 120 });
});

test('таблица сохраняет расчётную ширину и горизонтальный scroll в узком контейнере', () => {
  const table = makeTable(300, [40, 220, 120]);
  const widths = { title: 220, status: 120 };

  applyColumnWidths(table, ['title', 'status'], widths, { offset: 1, fixed: {} });

  assert.equal(table.style.width, '380px');
  assert.equal(table.cols[1].style.width, '220px');
  assert.equal(table.cols[2].style.width, '120px');
});
