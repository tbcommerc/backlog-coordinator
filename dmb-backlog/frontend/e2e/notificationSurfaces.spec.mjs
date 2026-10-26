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
    deadline: category === 'reporting' ? '2026-09-10' : null,
    days_remaining: category === 'reporting' ? 2 : null,
  };
}

async function mockApplication(page, itemsOverride = null) {
  const metrics = [];
  const state = {
    revision: 10,
    items: itemsOverride || [
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
      const readAction = notification(99, 'reporting', 'Уже просмотренное действие', {
        kind: 'reporting_statuses', url: '/reporting-statuses?source=notification&meeting_id=99', meeting_id: 99,
      });
      readAction.is_read = true;
      readAction.read_at = '2026-09-07T09:00:00Z';
      const actions = [
        ...state.items.filter(item => item.category === 'reporting' && !item.is_resolved),
        readAction,
      ];
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

for(const theme of ['light','dark'])test(`mobile sidebar restores focus and resets at breakpoint ${theme}`,async({page})=>{
 await mockApplication(page);await page.setViewportSize({width:390,height:900});await page.goto('/#/notifications');
 await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
 const toggle=page.locator('#sidebar-toggle-mobile'),sidebar=page.locator('#app-sidebar');
 await expect(sidebar).toHaveAttribute('inert','');await toggle.click();
 await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(sidebar.locator('a').first()).toBeFocused();
 await page.keyboard.press('Escape');await expect(toggle).toBeFocused();await expect(sidebar).toHaveAttribute('inert','');
 await toggle.click();await sidebar.getByRole('link',{name:'Главная',exact:true}).click();
 await expect(sidebar).not.toHaveClass(/open/);await expect(sidebar).toHaveAttribute('inert','');
 await expect(toggle).toHaveAttribute('aria-expanded','false');
 await toggle.click();await page.setViewportSize({width:1280,height:900});
 await expect(sidebar).not.toHaveClass(/open/);await expect(sidebar).toHaveAttribute('aria-hidden','false');
});

for (const theme of ['light','dark']) for (const mode of ['desktop','compact','mobile','touch']) {
  test(`global search uses shared panel: ${theme}/${mode}`,async({browser})=>{
    const context=await browser.newContext({viewport:{width:mode==='mobile'?390:1280,height:900},hasTouch:mode==='touch'});
    const page=await context.newPage();
    await mockApplication(page);
    await page.route('**/api/v1/tasks/?*',route=>route.fulfill({json:{items:[{id:7,title:'Проверка поиска с длинным названием задачи',status:'В работе'},{id:8,title:'Проверка второго результата',status:'Новая'}]}}));
    await page.goto('/#/notifications');
    await page.evaluate(({theme,mode})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.compact=String(mode==='compact');},{theme,mode});
    if(mode==='mobile')await page.locator('#mobile-search-toggle').click();
    const input=page.getByRole('combobox',{name:'Поиск задач'}),panel=page.getByRole('listbox',{name:'Найденные задачи'});
    await input.fill('Проверка');await expect(panel.getByRole('option')).toHaveCount(2);
    await expect(input).toBeFocused();await expect(input).toHaveAttribute('aria-expanded','true');
    await input.press('ArrowDown');await expect(input).toHaveAttribute('aria-activedescendant','search-result-7');
    await input.press('ArrowDown');await expect(panel.getByRole('option').nth(1)).toHaveAttribute('aria-selected','true');
    const box=await panel.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width);
    await input.press('Escape');await expect(panel).toBeHidden();await expect(input).toBeFocused();
    await input.fill('Нет совпадений');await expect(panel).toContainText('Ничего не найдено');
    await input.press('Tab');await expect(panel).toBeHidden();
    await context.close();
  });
}

test('центр и колокольчик используют один согласованный снимок', async ({ page }) => {
  await mockApplication(page);
  await page.goto('/#/notifications');

  await expect(page.getByRole('heading', { name: 'Мои уведомления' })).toBeVisible();
  await expect(page.locator('#notif-stat-unread')).toHaveText('2');
  await expect(page.locator('#notif-badge')).toHaveText('2');
  await expect(page.locator('.notification-card')).toHaveCount(2);
  await expect(page.locator('.notification-card').first()).toContainText('Срок 10 сент.');
  await expect(page.locator('.notification-card').first()).toContainText('Осталось 2 дня');
  await expect(page.locator('.notification-card').first().locator('.notification-deadline-badge')).toHaveClass(/is-warning/);

  await page.locator('#notif-bell-btn').click();
  await expect(page.locator('.notif-dropdown-item')).toHaveCount(2);
  await expect(page.locator('.notif-dropdown-deadline')).toContainText('Срок 10 сент. · Осталось 2 дня');
  await page.keyboard.press('Escape');
  await expect(page.locator('#notif-dropdown')).toBeHidden();

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
  await expect(page.locator('#dash-notif-body')).not.toContainText('Уже просмотренное действие');
  await expect(page.getByRole('heading', { name: 'Ближайшие даты' })).toBeVisible();
  await expect(page.locator('.dashboard-date-item')).toHaveCount(2);
  await expect(page.locator('#dashboard-dates-body')).toContainText('Директорская оперативка');
  await expect(page.locator('#dashboard-dates-body')).toContainText('Контрольная точка проекта');
  const item = page.locator('.dash-notif-item').first();
  await expect(item).toContainText('Обновите статусы к встрече');
  await expect(item).toContainText('Срок 10 сент.');
  await expect(item).toContainText('Осталось 2 дня');
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

test('карточки действий вмещают заголовок и перенесённые метаданные', async ({ page }) => {
  const items = [
    notification(11, 'reporting', 'Заполните статусы к встрече «Директорская оперативка»', {
      kind: 'reporting_statuses', url: '/reporting-statuses?source=notification&meeting_id=11', meeting_id: 11,
    }),
    notification(12, 'reporting', 'Заполните статусы к встрече «Оперативка ДИД»', {
      kind: 'reporting_statuses', url: '/reporting-statuses?source=notification&meeting_id=12', meeting_id: 12,
    }),
    notification(13, 'reporting', 'Заполните статусы к встрече «Встреча по ключевым проектам»', {
      kind: 'reporting_statuses', url: '/reporting-statuses?source=notification&meeting_id=13', meeting_id: 13,
    }),
    notification(14, 'reporting', 'Заполните статусы к встрече «Директорская оперативка»', {
      kind: 'reporting_statuses', url: '/reporting-statuses?source=notification&meeting_id=14', meeting_id: 14,
    }),
  ];
  await mockApplication(page, items);

  for (const width of [944, 760]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto('/#/dashboard');
    await expect(page.locator('.dash-notif-item')).toHaveCount(4);

    const geometry = await page.locator('.dash-notif-item').evaluateAll(cards => cards.map(card => {
      const cardBounds = card.getBoundingClientRect();
      const bodyBounds = card.querySelector('.dash-notif-body').getBoundingClientRect();
      return {
        height: cardBounds.height,
        contentInside: bodyBounds.top >= cardBounds.top - 1 && bodyBounds.bottom <= cardBounds.bottom + 1,
      };
    }));

    expect(geometry.every(item => item.height >= 84), `карточки сохраняют минимальную высоту при ${width}px`).toBe(true);
    expect(geometry.every(item => item.contentInside), `заголовок и метаданные должны оставаться внутри карточки при ${width}px`).toBe(true);
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
      // display:contents has no box; measure its rendered grid children instead.
      const visibleChildren = [...toolbar.children].flatMap(element =>
        getComputedStyle(element).display === 'contents' ? [...element.children] : [element]
      ).filter(element => {
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

    if (width === 1440) {
      const density = await page.locator('.notification-center').evaluate(center => {
        const top = center.getBoundingClientRect().top;
        const hero = center.querySelector('.notification-hero').getBoundingClientRect();
        const toolbar = center.querySelector('.notification-toolbar').getBoundingClientRect();
        const firstCard = center.querySelector('.notification-card').getBoundingClientRect();
        return {
          heroHeight: hero.height,
          toolbarHeight: toolbar.height,
          cardOffset: firstCard.top - top,
        };
      });
      expect(density.heroHeight, 'desktop notification header must stay compact').toBeLessThanOrEqual(72);
      expect(density.toolbarHeight, 'desktop notification filters must fit in two rows').toBeLessThanOrEqual(92);
      expect(density.cardOffset, 'the first notification must remain above the fold').toBeLessThanOrEqual(245);
    }
  }
});

for (const theme of ['light','dark']) for (const mode of ['desktop','compact','mobile','touch']) {
  test(`shell popovers share focus and viewport rules: ${theme}/${mode}`, async({browser})=>{
    const context=await browser.newContext({viewport:{width:mode==='mobile'?390:1280,height:800},hasTouch:mode==='touch'});
    const page=await context.newPage();await mockApplication(page);
    await page.goto('/#/notifications');
    await page.evaluate(({theme,mode})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.compact=String(mode==='compact');},{theme,mode});
    await expect(page.locator('.notification-card').first()).toBeVisible();
    const bell=page.locator('#notif-bell-btn');await bell.click();
    const panel=page.locator('#notif-dropdown');await expect(panel).toBeVisible();
    await expect(panel.locator('.notif-dropdown-item')).toHaveCount(2);
    const box=await panel.boundingBox();expect(box.x).toBeGreaterThanOrEqual(7);expect(box.x+box.width).toBeLessThanOrEqual(mode==='mobile'?383:1273);
    expect(await page.evaluate(()=>({active:document.activeElement.id,inside:document.getElementById('notif-dropdown').contains(document.activeElement)}))).toMatchObject({inside:true});
    await page.screenshot({path:test.info().outputPath('notification-panel.png')});
    await page.keyboard.press('End');await expect(panel.locator('a,button').last()).toBeFocused();
    await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(bell).toBeFocused();
    const avatar=page.locator('#user-avatar-btn');await avatar.focus();await page.keyboard.press('ArrowDown');
    const menu=page.getByRole('menu',{name:'Меню пользователя'});await expect(menu).toBeVisible();
    await page.keyboard.press('End');await expect(menu.getByRole('menuitem',{name:'Выйти'})).toBeFocused();
    await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(avatar).toBeFocused();
    await context.close();
  });
}
