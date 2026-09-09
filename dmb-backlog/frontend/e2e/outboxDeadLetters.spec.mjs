import { expect, test } from '@playwright/test';
import { join } from 'node:path';

const screenshotDir = process.env.OUTBOX_SCREENSHOT_DIR || 'test-results';

const items = [
  {
    id: 1842,
    event_type: 'task.reporting_status.updated',
    aggregate_type: 'Task',
    aggregate_id: 233,
    aggregate_version: 12,
    attempts: 12,
    dead_lettered_at: '2026-09-07T09:42:00Z',
    last_error: 'Сервис отчётности вернул 503 Service Unavailable после истечения таймаута.',
    payload: { task_id: 233, meeting_id: 42, status: 'ready' },
  },
  {
    id: 1839,
    event_type: 'notification.assignment.created',
    aggregate_type: 'Notification',
    aggregate_id: 981,
    aggregate_version: 3,
    attempts: 7,
    dead_lettered_at: '2026-09-07T08:18:00Z',
    last_error: 'Получатель временно недоступен: upstream connection reset.',
    payload: { notification_id: 981, category: 'assignment' },
  },
  {
    id: 1814,
    event_type: 'task.updated',
    aggregate_type: 'Task',
    aggregate_id: 198,
    aggregate_version: 8,
    attempts: 3,
    dead_lettered_at: '2026-09-06T17:04:00Z',
    last_error: 'Не удалось разрешить адрес целевого сервиса.',
    payload: { task_id: 198, changed_fields: ['status_id'] },
  },
];

async function mockApplication(page) {
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/events/stream') return route.abort();
    if (path === '/auth/refresh') return json(route, { access_token: 'e2e-token', user: { id: 1, name: 'Администратор' } });
    if (path === '/auth/me') return json(route, {
      id: 1,
      name: 'Администратор',
      email: 'admin@example.test',
      role_name: 'Администратор',
      permissions: { admin: 'full', customer_portal_mode: 'all' },
    });
    if (path === '/admin/field-labels') return json(route, {});
    if (path === '/tasks/reference') return json(route, {
      statuses: [], priorities: [], deadlines: [], teams: [], projects: [], task_types: [], channels: [],
      departments: [], business_customers: [], did_client_groups: [], tags: [], users: [],
    });
    if (path === '/notifications/snapshot') return json(route, {
      revision: 1,
      summary: { unread: 0, requires_action: 0, today: 0, by_category: {} },
      recent_items: [], recent_total: 0, action_items: [], action_total: 0,
    });
    if (path === '/admin/outbox/dead-letters') return json(route, { items, total: items.length, page: 1, per_page: 50, pages: 1 });
    return json(route, {});
  });
}

test('очередь ошибок сохраняет рабочую композицию на desktop и mobile', async ({ page }) => {
  await mockApplication(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/outbox-dead-letters');
  await expect(page.getByRole('heading', { name: 'Ошибки доставки событий' })).toBeVisible();
  await expect(page.locator('.outbox-table tbody tr')).toHaveCount(3);
  await expect(page.locator('.outbox-metric.is-danger strong')).toHaveText('3');

  const desktop = await page.locator('.outbox-page').evaluate(root => {
    const bounds = root.getBoundingClientRect();
    const action = root.querySelector('.outbox-requeue').getBoundingClientRect();
    return {
      overflow: root.scrollWidth - root.clientWidth,
      actionInside: action.right <= bounds.right + 1,
      actionWidth: action.width,
    };
  });
  expect(desktop.overflow).toBeLessThanOrEqual(1);
  expect(desktop.actionInside).toBe(true);
  expect(desktop.actionWidth).toBeGreaterThanOrEqual(132);
  await page.screenshot({ path: join(screenshotDir, 'outbox-desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ошибки доставки событий' })).toBeVisible();
  await page.screenshot({ path: join(screenshotDir, 'outbox-mobile.png'), fullPage: true });
  const mobile = await page.locator('.outbox-page').evaluate(root => {
    const rootBounds = root.getBoundingClientRect();
    return {
      overflow: root.scrollWidth - root.clientWidth,
      cards: [...root.querySelectorAll('.outbox-table tbody tr')].every(row => getComputedStyle(row).display === 'grid'),
      actionsFit: [...root.querySelectorAll('.outbox-requeue')].every(button => button.scrollWidth <= button.clientWidth + 1),
      offenders: [...root.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > rootBounds.right + 1).slice(0, 6).map(element => ({
        tag: element.tagName,
        className: element.className?.baseVal || element.className || '',
        left: Math.round(element.getBoundingClientRect().left),
        width: Math.round(element.getBoundingClientRect().width),
        right: Math.round(element.getBoundingClientRect().right),
        rootRight: Math.round(rootBounds.right),
        boxSizing: getComputedStyle(element).boxSizing,
        cssWidth: getComputedStyle(element).width,
        parentWidth: Math.round(element.parentElement.getBoundingClientRect().width),
      })),
    };
  });
  expect(mobile.overflow, JSON.stringify(mobile.offenders)).toBeLessThanOrEqual(1);
  expect(mobile.cards).toBe(true);
  expect(mobile.actionsFit).toBe(true);
});
