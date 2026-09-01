import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateCv, calculateTaskCv, cvZone } from '../js/taskMetrics.js';

test('C/V uses RUB cost and million-RUB effect', () => {
  assert.equal(calculateCv(300_000, 1), 0.3);
  assert.equal(calculateTaskCv({ effort_rub: 1_500_000, financial_effect: 1 }), 1.5);
});

test('missing C/V belongs to the red/missing zone', () => {
  assert.equal(calculateCv(null, 10), null);
  assert.equal(calculateCv(10, 0), null);
  assert.equal(cvZone(null), 'missing');
  assert.equal(cvZone(0.3), 'good');
  assert.equal(cvZone(1), 'warning');
  assert.equal(cvZone(1.01), 'danger');
});
