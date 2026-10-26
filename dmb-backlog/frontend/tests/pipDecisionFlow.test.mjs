import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildPipDecisionPayload,
  calculatePipDecisionSummary,
  getPipDecisionGaps,
} from '../js/components/reports.js';

const reportsSource = await readFile(new URL('../js/components/reports.js', import.meta.url), 'utf8');
const expressSource = await readFile(new URL('../js/components/expressEstimate.js', import.meta.url), 'utf8');
const componentsCss = await readFile(new URL('../css/components.css', import.meta.url), 'utf8');

test('PI-сводка отделяет полный контекст от задач с пробелами', () => {
  const tasks = [
    { effort_days: 12, priority_score: 80, financial_effect: 10 },
    { effort_days: 0, priority_score: null, financial_effect: 4 },
  ];

  assert.deepEqual(getPipDecisionGaps(tasks[0]), []);
  assert.deepEqual(getPipDecisionGaps(tasks[1]).map(item => item.code), ['effort', 'priority']);
  assert.deepEqual(calculatePipDecisionSummary(tasks), {
    total: 2,
    contextReady: 1,
    totalEffort: 12,
    totalEffect: 14,
    averagePriority: 80,
  });
});

test('возврат и отклонение требуют объяснения, принятие допускает комментарий', () => {
  assert.throws(
    () => buildPipDecisionPayload({ decision: 'rework', version: 7, reason: ' ' }),
    /Укажите причину/,
  );
  assert.deepEqual(
    buildPipDecisionPayload({ decision: 'reject', version: 7, reason: '  Нет эффекта  ' }),
    { decision: 'reject', version: 7, reason: 'Нет эффекта' },
  );
  assert.deepEqual(
    buildPipDecisionPayload({ decision: 'accept', version: 7 }),
    { decision: 'accept', version: 7, reason: null },
  );
});

test('интерфейс связывает завершение оценки с очередью PI и системным решением', () => {
  assert.match(expressSource, /Перейти к PI-планированию/);
  assert.match(expressSource, /source=express-estimate&transferred=/);
  assert.match(reportsSource, /От бэклога до решения/);
  assert.match(reportsSource, /Вернуть на оценку/);
  assert.match(reportsSource, /showPipDecisionModal\(task, app\)/);
  assert.doesNotMatch(reportsSource, /class="btn btn-danger btn-xs pip-decision-btn"/);
  assert.match(componentsCss, /\.pip-flow-card\s*\{/);
  assert.match(componentsCss, /\.pip-decision-options\s*\{/);
  assert.match(componentsCss, /@media \(max-width:760px\)/);
});
