import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const moduleUrl = new URL('../js/components/modal.js', import.meta.url);
const source = readFileSync(moduleUrl, 'utf8')
  .replace(/from (['"])(\.[^'"]+)\1/g, (_, quote, path) => `from '${new URL(path, moduleUrl).href}'`);
globalThis.window = { app: {}, location: { hash: '#/backlog' } };
const { getLatestPipDecision } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const componentsCss = readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');

test('карточка выбирает последнее структурированное PI-решение', () => {
  const result = getLatestPipDecision([
    {
      id: 8,
      field_name: 'pip_decision',
      new_value: JSON.stringify({ decision: 'accept', reason: null }),
      changed_at: '2026-09-09T10:00:00Z',
      changed_by_name: 'Лидер трайба',
    },
    {
      id: 12,
      field_name: 'pip_decision',
      new_value: JSON.stringify({ decision: 'rework', reason: 'Уточнить оценку FE' }),
      changed_at: '2026-09-10T10:00:00Z',
      changed_by_name: 'Проектный офис',
    },
    { id: 13, field_name: 'status_id', new_value: '17', changed_at: '2026-09-10T10:00:00Z' },
  ]);

  assert.deepEqual(result, {
    decision: 'rework',
    reason: 'Уточнить оценку FE',
    label: 'Возвращена на экспресс-оценку',
    consequence: 'Команде нужно уточнить оценку и снова передать задачу на PI-планирование.',
    tone: 'rework',
    icon: 'edit',
    changedAt: '2026-09-10T10:00:00Z',
    changedByName: 'Проектный офис',
    historyId: 12,
  });
});

test('результат PI заметен и на основной вкладке, и над полным логом', () => {
  assert.match(source, /cardPipDecisionBanner\(true\)/);
  assert.match(source, /cardPipDecisionBanner\(false\)/);
  assert.match(source, /'data-action': 'open-pip-history'/);
  assert.match(componentsCss, /\.pip-history-summary\s*\{/);
  assert.match(componentsCss, /\.pip-history-summary\.is-rework/);
});

delete globalThis.window;
