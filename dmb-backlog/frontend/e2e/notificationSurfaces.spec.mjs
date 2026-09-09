import { expect, test } from '@playwright/test';

function notification(id, category, title, target) {
  return {
    id,
    task_id: target.task_id || null,
    type: category === 'reporting' ? 'meeting.status_update.required' : 'task.comment.added',
    category,
    title,
    body: null,
    importance: 'high',
    is_read: false,
    is_dismissed: false,
    is_resolved: false,
    action_url: `#${target.url}`,
    target,
    group_key: null,
    group_count: 1,
    created_at: '2026-09-07T08:00:00Z',
    read_at: null,
    resolved_at: null,
  };
}

async function mockApplication(page) {
  const metrics = [];
  const state = {
    revision: 10,
    items: [
      notification(2, 'reporting', 'Обновите статусы к встрече', {
        kind: 'reporting_statuses', url: '/reporting-statuses?source=notification&meeting_id=42', meeting_id: 42,
      }),
      notification(1, 'comment', 'Новый комментарий', {
        kind: 'task_discussion', url: '/backlog?task=7&tab=com&comment=3', task_id: 7, tab: 'com', comment_id: 3,
      }),
    ],
  };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/events/stream') return route.abort();
    if (path === '/auth/refresh') return json(route, { access_token: 'e2e-token', user: { id: 101, name: 'Тестовый пользователь' } });
    if (path === '/auth/me') return json(route, {
      id: 101, name: 'Тестовый пользователь', email: 'e2e@example.test', role_name: 'Участник команды',
      permissions: { admin: 'none', customer_portal_mode: 'all' },
    });
    if (path === '/admin/field-labels') return json(route, {});
    if (path === '/tasks/reference') return json(route, {
      statuses: [], priorities: [], deadlines: [], teams: [], projects: [], task_types: [], channels: [],
      departments: [], business_customers: [], did_client_groups: [], tags: [], users: [],
    });
    if (path === '/notifications/ux-events') {
      metrics.push(request.postDataJSON());
      return json(route, { message: 'accepted' }, 202);
    }
    if (path === '/notifications/read-all') {
      state.items.forEach(item => { item.is_read = true; });
      state.revision += 1;
      return json(route, { message: 'ok', changed_ids: [1, 2] });
    }
    if (path === '/notifications/read') {
      const ids = request.postDataJSON()?.ids || [];
      state.items.forEach(item => { if (ids.includes(item.id)) item.is_read = true; });
      state.revision += 1;
      return json(route, { message: 'ok' });
    }
    if (path === '/notifications/snapshot') {
      const unread = state.items.filter(item => !item.is_read && !item.is_resolved).length;
      const actions = state.items.filter(item => item.category === 'reporting' && !item.is_resolved);
      return json(route, {
        revision: state.revision,
        summary: { unread, requires_action: actions.length, today: state.items.length, by_category: { reporting: unread ? 1 : 0, comment: unread ? 1 : 0 } },
        recent_items: state.items,
        recent_total: state.items.length,
        action_items: actions,
        action_total: actions.length,
      });
    }
    if (path === '/notifications') return json(route, { items: state.items, total: state.items.length, page: 1, per_page: 20 });
    if (path === '/reporting-meetings') return json(route, { items: [{
      id: 42, kind: 'directorate', title: 'Директорская оперативка', scheduled_date: '2099-09-10', state: 'planned',
    }] });
    if (path === '/timeline') return json(route, { items: [{
      id: 77, title: 'Контрольная точка проекта', date: '2099-09-12', event_type: 'milestone', project_name: 'Проект Альфа', color: '#6366f1',
    }] });
    return json(route, {});
  });
  return { metrics, state };
}

test('центр и колокольчик используют один согласованный снимок', async ({ page }) => {
  await mockApplication(page);
  await page.goto('/#/notifications');

  await expect(page.getByRole('heading', { name: 'Мои уведомления' })).toBeVisible();
  await expect(page.locator('#notif-stat-unread')).toHaveText('2');
  await expect(page.locator('#notif-badge')).toHaveText('2');
  await expect(page.locator('.notification-card')).toHaveCount(2);

  await page.locator('#notif-bell-btn').click();
  await expect(page.locator('.notif-dropdown-item')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#notif-dropdown')).toHaveClass(/hidden/);

  await page.locator('#mark-all-read').click();
  await expect(page.locator('#notif-stat-unread')).toHaveText('0');
  await expect(page.locator('#notif-badge')).toHaveClass(/hidden/);
});

test('главная показывает действия и ближайшие даты, сохраняя точный переход', async ({ page }) => {
  const { metrics } = await mockApplication(page);
  await page.goto('/#/dashboard');

  await expect(page.getByRole('heading', { name: 'Требует вашего действия' })).toBeVisible();
  await expect(page.locator('#dash-notif-count')).toHaveText('2');
  await expect(page.locator('.dash-action-item')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Ближайшие даты' })).toBeVisible();
  await expect(page.locator('.dashboard-date-item')).toHaveCount(2);
  await expect(page.locator('#dashboard-dates-body')).toContainText('Директорская оперативка');
  await expect(page.locator('#dashboard-dates-body')).toContainText('Контрольная точка проекта');
  const item = page.locator('.dash-notif-item').first();
  await expect(item).toContainText('Обновите статусы к встрече');
  await item.click();
  await expect(page).toHaveURL(/#\/reporting-statuses\?source=notification&meeting_id=42$/);
  await expect.poll(() => metrics.map(event => event.event)).toContain('notification_primary_action_clicked');
  expect(metrics.every(event => !('user_id' in event) && !('title' in event))).toBe(true);
});

test('главная не создаёт вложенный скролл и сохраняет подписи действий', async ({ page }) => {
  await mockApplication(page);

  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/#/dashboard');
    await expect(page.getByRole('heading', { name: 'Требует вашего действия' })).toBeVisible();
    await expect(page.locator('.dash-notif-action').first()).toBeVisible();

    const geometry = await page.locator('.dashboard-workspace').evaluate(workspace => {
      const actions = workspace.querySelector('#dash-notif-body');
      const actionLabel = workspace.querySelector('.dash-notif-action');
      const panels = [...workspace.querySelectorAll(':scope > .widget')];
      const columns = getComputedStyle(workspace).gridTemplateColumns.split(' ').filter(Boolean).length;
      return {
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        nestedOverflow: actions.scrollHeight - actions.clientHeight,
        actionsOverflowStyle: getComputedStyle(actions).overflowY,
        actionLabelFontSize: parseFloat(getComputedStyle(actionLabel).fontSize),
        panelHeights: panels.map(panel => panel.getBoundingClientRect().height),
        columns,
      };
    });

    expect(geometry.documentOverflow, `page overflow at ${viewport.width}px`).toBeLessThanOrEqual(1);
    expect(geometry.nestedOverflow, `nested action scroll at ${viewport.width}px`).toBeLessThanOrEqual(1);
    expect(geometry.actionsOverflowStyle).toBe('visible');
    expect(geometry.actionLabelFontSize).toBeGreaterThan(0);
    expect(geometry.columns).toBe(viewport.width <= 960 ? 1 : 2);
    if (geometry.columns === 2) {
      expect(Math.abs(geometry.panelHeights[0] - geometry.panelHeights[1]), 'desktop panels must have equal height').toBeLessThanOrEqual(1);
    }
  }
});

test('панель фильтров не обрезает подписи и действия в рабочей области', async ({ page }) => {
  await mockApplication(page);

  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/notifications');
    await expect(page.getByRole('heading', { name: 'Мои уведомления' })).toBeVisible();
    await page.getByRole('button', { name: 'Закрытые' }).click();
    await expect(page.getByRole('button', { name: 'Сбросить' })).toBeVisible();
    const assignment = page.getByRole('button', { name: 'Назначения', exact: true });
    await assignment.click();
    await expect(assignment).toHaveAttribute('aria-pressed', 'true');
    await expect(page).toHaveURL(/category=assignment/);
    await assignment.click();
    await expect(assignment).toHaveAttribute('aria-pressed', 'false');
    await expect(page).not.toHaveURL(/category=assignment/);

    const geometry = await page.locator('.notification-toolbar').evaluate(toolbar => {
      const bounds = toolbar.getBoundingClientRect();
      const visibleChildren = [...toolbar.children].filter(element => {
        const style = getComputedStyle(element);
        return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden';
      });
      return {
        height: bounds.height,
        horizontalOverflow: toolbar.scrollWidth - toolbar.clientWidth,
        childrenInside: visibleChildren.every(element => {
          const child = element.getBoundingClientRect();
          return child.left >= bounds.left - 1 && child.right <= bounds.right + 1;
        }),
        chipsFit: [...toolbar.querySelectorAll('.notification-filter-chip')].every(element => element.scrollWidth <= element.clientWidth + 1),
      };
    });

    expect(geometry.horizontalOverflow, `toolbar overflow at ${width}px`).toBeLessThanOrEqual(1);
    expect(geometry.childrenInside, `toolbar children at ${width}px`).toBe(true);
    expect(geometry.height, `toolbar stretched vertically at ${width}px`).toBeLessThan(190);
    expect(geometry.chipsFit, `quick-filter labels at ${width}px`).toBe(true);
  }
});
