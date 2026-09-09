import assert from 'node:assert/strict';

import {
  canDismissNotification,
  formatNotificationTime,
  normalizeNotificationTarget,
  notificationActionLabel,
  notificationCategoryMeta,
  notificationImportanceMeta,
  recordNotificationUxEvent,
  resolveNotificationTarget,
} from '../js/notificationUtils.js';

assert.equal(
  resolveNotificationTarget({ action_url: '#/backlog?task=12&tab=com&comment=7', task_id: 12, category: 'comment' }),
  '/backlog?task=12&tab=com&comment=7',
  'an exact target must win',
);
assert.equal(
  resolveNotificationTarget({ action_url: '#/backlog', task_id: 12, category: 'mention' }),
  '/backlog?task=12&tab=com',
  'a generic legacy target must fall back to task discussion',
);
assert.equal(
  resolveNotificationTarget({ action_url: '', task_id: 8, category: 'assignment' }),
  '/backlog?task=8',
  'assignment fallback must open the task',
);
assert.equal(
  resolveNotificationTarget({ action_url: '', task_id: 8, category: 'reporting' }),
  '/reporting-statuses?source=notification',
  'legacy reporting notifications must open the batch status form, not a task card',
);
assert.equal(
  resolveNotificationTarget({ action_url: '#/backlog?task=8&tab=rep', task_id: 8, category: 'reporting' }),
  '/reporting-statuses?source=notification',
  'legacy task-reporting targets must be redirected to the batch status form',
);
assert.equal(
  normalizeNotificationTarget('/reporting-statuses?source=notification'),
  '/reporting-statuses?source=notification',
  'the batch status form must be valid even when an old notification has no meeting id',
);
assert.equal(resolveNotificationTarget({ action_url: '#/backlog' }), '/notifications');
assert.equal(normalizeNotificationTarget('https://example.test/backlog?task=1'), '', 'external targets must be rejected');
assert.equal(normalizeNotificationTarget('/admin'), '', 'non-allowlisted application routes must be rejected');
assert.equal(normalizeNotificationTarget('/customer/request/17'), '/customer/request/17', 'request decisions must open the customer request');
assert.equal(normalizeNotificationTarget('/customer/request/17?next=/admin'), '', 'request targets must not accept query parameters');
assert.equal(normalizeNotificationTarget('/backlog?task=1&next=https://example.test'), '', 'unexpected target parameters must be rejected');
assert.equal(
  resolveNotificationTarget({ target: { kind: 'task_discussion', url: '/backlog?task=19&tab=com' }, action_url: '#/notifications' }),
  '/backlog?task=19&tab=com',
  'typed target must take precedence over the legacy field',
);
assert.equal(notificationActionLabel({ category: 'reporting', is_resolved: true }), 'Открыть контекст');
assert.equal(notificationActionLabel({ category: 'request' }), 'Открыть запрос');
assert.equal(canDismissNotification({ category: 'reporting', is_resolved: false }), false);
assert.equal(canDismissNotification({ category: 'comment', is_resolved: false }), true);
assert.deepEqual(notificationCategoryMeta('reporting'), {
  icon: 'clipboard-check', label: 'Отчётная встреча', color: 'var(--warning)',
});
assert.equal(notificationImportanceMeta('high').label, 'Высокий');
assert.equal(notificationImportanceMeta('high').color, 'var(--warning)');
assert.equal(formatNotificationTime('not-a-date'), '');

const metricCalls = [];
recordNotificationUxEvent({ api: { post: (path, body) => metricCalls.push({ path, body }) } }, 'notification_opened', {
  surface: 'dashboard', category: 'reporting', state: 'unread',
});
assert.deepEqual(metricCalls, [{
  path: '/notifications/ux-events',
  body: { event: 'notification_opened', surface: 'dashboard', category: 'reporting', state: 'unread' },
}]);

console.log('notificationUtils.test.mjs: OK');
