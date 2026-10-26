import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateQuickEstimateReadiness } from '../js/components/expressEstimate.js';

const effortFields = [
  'effort_designee',
  'effort_analytics',
  'effort_be',
  'effort_python_be',
  'effort_fe',
  'effort_test',
  'effort_test_auto',
  'effort_delivery',
];

function estimateItem(id, title, effort = {}) {
  return Object.assign(
    { id, title },
    Object.fromEntries(effortFields.map(field => [field, null])),
    effort,
  );
}

test('задача без эпика блокирует завершение экспресс-оценки', () => {
  const readiness = calculateQuickEstimateReadiness([
    { id: 1, public_id: 'TASK-000-001', title: 'Без декомпозиции', epics: [] },
  ]);

  assert.equal(readiness.ready, false);
  assert.equal(readiness.total_blockers, 1);
  assert.equal(readiness.blocking_tasks[0].blockers[0].code, 'missing_decomposition');
});

test('положительная оценка конечного эпика делает задачу готовой', () => {
  const readiness = calculateQuickEstimateReadiness([
    {
      id: 2,
      public_id: 'TASK-000-002',
      title: 'Готовая задача',
      epics: [{ ...estimateItem(20, 'Эпик', { effort_analytics: 2.5 }), stories: [] }],
    },
  ]);

  assert.equal(readiness.ready, true);
  assert.equal(readiness.ready_tasks, 1);
  assert.equal(readiness.total_blockers, 0);
});

test('каждая история должна иметь собственную положительную оценку', () => {
  const readiness = calculateQuickEstimateReadiness([
    {
      id: 3,
      public_id: 'TASK-000-003',
      title: 'Частичная оценка',
      epics: [{
        ...estimateItem(30, 'Эпик'),
        stories: [
          estimateItem(31, 'Готовая история', { effort_fe: 1 }),
          estimateItem(32, 'История без оценки'),
        ],
      }],
    },
  ]);

  assert.equal(readiness.ready, false);
  assert.equal(readiness.total_blockers, 1);
  assert.equal(readiness.blocking_tasks[0].blockers[0].entity_id, 32);
});

test('отрицательные трудозатраты остаются блокером даже при положительной сумме', () => {
  const readiness = calculateQuickEstimateReadiness([
    {
      id: 4,
      public_id: 'TASK-000-004',
      title: 'Некорректная оценка',
      epics: [{ ...estimateItem(40, 'Эпик', { effort_be: -1, effort_fe: 3 }), stories: [] }],
    },
  ]);

  assert.equal(readiness.ready, false);
  assert.equal(readiness.blocking_tasks[0].blockers[0].code, 'invalid_effort');
});
