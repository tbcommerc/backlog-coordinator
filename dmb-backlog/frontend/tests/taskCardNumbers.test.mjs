import test from 'node:test';
import assert from 'node:assert/strict';
import { taskNumber, sumTaskMeasurements, taskMeasurementCost, sumTaskCosts } from '../js/taskCardNumbers.js';

test('известный ноль сохраняется, отсутствие и некорректное число неизвестны', () => {
  for (const value of [null, undefined, '', '  ', 'не число']) assert.equal(taskNumber(value), null);
  assert.equal(taskNumber('0'), 0);
  assert.equal(sumTaskMeasurements([null, '', undefined]), null);
  assert.equal(sumTaskMeasurements([0, null]), 0);
  assert.equal(sumTaskMeasurements([0, 1.5, '2.25']), 3.75);
});
test('стоимость отличает нулевую работу, нулевую ставку и неизвестную ставку', () => {
  assert.equal(taskMeasurementCost(0, null), 0);
  assert.equal(taskMeasurementCost(2, 0), 0);
  assert.equal(taskMeasurementCost(2, 15000), 30000);
  assert.equal(taskMeasurementCost(2, null), null);
  assert.equal(taskMeasurementCost(null, 15000), null);
  assert.equal(sumTaskCosts([[0, null], [2, 15000]]), 30000);
  assert.equal(sumTaskCosts([[0, null], [2, null]]), null);
  assert.equal(sumTaskCosts([[null, 15000]]), null);
  assert.equal(sumTaskCosts([[0, null]]), 0);
});
