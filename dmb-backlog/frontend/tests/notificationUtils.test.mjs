import assert from 'node:assert/strict';

import {
  canDismissNotification,
  formatNotificationTime,
  normalizeNotificationTarget,
  notificationActionLabel,
  notificationCategoryMeta,
  notificationDeadlineMeta,
  notificationImportanceMeta,
  notificationReadLocked,
  notificationTaskOpenDetail,
  openNotificationTarget,
  recordNotificationUxEvent,
  resolveNotificationTarget,
} from '../js/notificationUtils.js';

const captureLink = '/meeting-capture?capture=01234567-89ab-cdef-0123-456789abcdef';
assert.equal(normalizeNotificationTarget(`#${captureLink}`), captureLink);
assert.equal(resolveNotificationTarget({ category: 'meeting_capture', target: { url: captureLink } }), captureLink);
assert.equal(notificationActionLabel({ category: 'meeting_capture' }), 'Проверить разбор');
for (const value of ['/meeting-capture', '/meeting-capture?capture=bad', `${captureLink}&capture=bad`, `${captureLink}&extra=1`, `${captureLink}#bad`, `https://evil.test${captureLink}`]) {
  assert.equal(normalizeNotificationTarget(value), '');
}

assert.equal(notificationReadLocked({ category: 'reporting', is_resolved: false }), true);
assert.equal(notificationReadLocked({ category: 'reporting', is_resolved: true }), false);
assert.equal(notificationReadLocked({ category: 'comment', is_resolved: false }), false);

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
assert.equal(notificationActionLabel({ category: 'reporting', action_url: '#/quarterly-goals-update?source=notification' }), 'Обновить прогресс и статусы');
assert.equal(notificationActionLabel({ category: 'request' }), 'Открыть запрос');
assert.equal(canDismissNotification({ category: 'reporting', is_resolved: false }), false);
assert.equal(canDismissNotification({ category: 'comment', is_resolved: false }), true);
assert.deepEqual(notificationCategoryMeta('reporting'), {
  icon: 'clipboard-check', label: 'Отчётная встреча', color: 'var(--warning)',
});
assert.equal(notificationImportanceMeta('high').label, 'Высокий');
assert.equal(notificationImportanceMeta('high').color, 'var(--warning)');
assert.equal(formatNotificationTime('not-a-date'), '');
assert.deepEqual(
  notificationDeadlineMeta({ deadline: '2026-09-20', days_remaining: 3 }, new Date(2026, 8, 17)),
  {
    deadline: '2026-09-20',
    dateLabel: '20 сент.',
    days: 3,
    daysLabel: 'Осталось 3 дня',
    compactLabel: 'Срок 20 сент. · Осталось 3 дня',
    tone: 'accent',
  },
);
assert.equal(notificationDeadlineMeta({ deadline: '2026-09-17', days_remaining: 0 }).tone, 'danger');
assert.equal(notificationDeadlineMeta({ deadline: '2026-09-16', days_remaining: -1 }).daysLabel, 'Просрочено на 1 день');
assert.equal(notificationDeadlineMeta({ deadline: '2026-09-20' }, new Date(2026, 8, 17)).days, 3);
assert.equal(notificationDeadlineMeta({ deadline: '2026-02-31' }), null);
assert.equal(notificationDeadlineMeta({ deadline: null }), null);
assert.deepEqual(notificationTaskOpenDetail('/backlog?task=42&tab=com&comment=7'), {
  taskId: 42, tab: 'com', commentId: 7,
});
assert.equal(notificationTaskOpenDetail('/reporting-statuses?source=notification'), null);

const openedTaskEvents = [];
const navigatedTargets = [];
const previousDocument = globalThis.document;
const previousCustomEvent = globalThis.CustomEvent;
globalThis.document = { dispatchEvent: event => { openedTaskEvents.push(event); return true; } };
globalThis.CustomEvent = class CustomEvent {
  constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
};
try {
  const app = { router: { navigate: target => navigatedTargets.push(target) } };
  openNotificationTarget(app, {
    action_url: '#/backlog?task=42&tab=com&comment=7', task_id: 42, category: 'comment',
  });
  assert.deepEqual(openedTaskEvents.map(event => ({ type: event.type, detail: event.detail })), [{
    type: 'open-task', detail: { taskId: 42, tab: 'com', commentId: 7 },
  }]);
  assert.deepEqual(navigatedTargets, [], 'task notifications must not navigate away from the current page');

  openNotificationTarget(app, { action_url: '#/reporting-statuses?source=notification', category: 'reporting' });
  assert.deepEqual(navigatedTargets, ['/reporting-statuses?source=notification']);
} finally {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
  if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
  else globalThis.CustomEvent = previousCustomEvent;
}

const metricCalls = [];
recordNotificationUxEvent({ api: { post: (path, body) => metricCalls.push({ path, body }) } }, 'notification_opened', {
  surface: 'dashboard', category: 'reporting', state: 'unread',
});
assert.deepEqual(metricCalls, [{
  path: '/notifications/ux-events',
  body: { event: 'notification_opened', surface: 'dashboard', category: 'reporting', state: 'unread' },
}]);

console.log('notificationUtils.test.mjs: OK');

for (const target of [{ action_url: '#/quarterly-goals-update?source=notification' }, { target: { kind: 'quarterly_goals_update', url: '/quarterly-goals-update?source=notification' } }]) {
  assert.equal(resolveNotificationTarget({ category: 'reporting', ...target }), '/quarterly-goals-update?source=notification');
}
assert.equal(normalizeNotificationTarget('/quarterly-goals-update?source=evil'), '');
assert.equal(normalizeNotificationTarget('//evil.test/quarterly-goals-update'), '');
