import test from 'node:test';
import assert from 'node:assert/strict';
import { auditEntityLabel } from '../js/adminLabels.js';

test('live audit work and metric entity filters remain distinguishable', () => {
  const types = ['work_tasks', 'work_attachments', 'work_dependencies', 'work_history',
    'work_resolutions', 'work_comments', 'work_task_templates', 'work_meeting_snapshots',
    'request_work_links', 'meeting_actions', 'kr_metrics', 'kr_periods', 'kr_measurements',
    'kr_history', 'kr_comments', 'kr_links', 'kr_reporting_statuses', 'kr_files'];
  const labels = types.map(auditEntityLabel);
  assert.equal(new Set(labels).size, types.length);
  assert.ok(labels.every(label => !label.startsWith('Другой объект')));
});

test('unknown audit types retain an identifying fallback', () => {
  assert.notEqual(auditEntityLabel('new_type_a'), auditEntityLabel('new_type_b'));
  assert.equal(auditEntityLabel(null), 'Другой объект');
  assert.equal(auditEntityLabel(' WORK_TASKS '), 'Рабочие задачи');
});
