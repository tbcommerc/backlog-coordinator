import { expect, test } from '@playwright/test';
import { getRequestStage } from '../js/components/requestPresentation.js';

const requests = Array.from({ length: 20 }, (_, index) => ({
  id: 100 + index,
  status: index === 2 ? 'returned' : index % 4 === 0 ? 'in_progress' : 'submitted',
  title: `Запрос для проверки прокрутки ${index + 1}`,
  description: `Описание запроса ${index + 1}`,
  team_name: 'Команда продукта',
  reviewer_name: index % 4 === 0 ? null : 'Ревьюер',
  assignee_name: index % 4 === 0 ? 'Аналитик' : null,
  reject_reason: index === 2 ? 'Уточните ожидаемый результат.' : null,
  stage_started_at: `2026-09-${String(Math.max(1, 8 - Math.floor(index / 4))).padStart(2, '0')}T09:00:00Z`,
  created_at: `2026-08-${String(index + 1).padStart(2, '0')}T08:00:00Z`,
  updated_at: `2026-09-${String(Math.max(1, 8 - Math.floor(index / 4))).padStart(2, '0')}T10:00:00Z`,
  draft: index === 0 ? {
    problem_statement: 'Ручная обработка занимает много времени.',
    current_process: 'Сотрудник сверяет данные вручную.',
    target_process: 'Система показывает результат автоматически.',
    business_value: 'Сокращение времени обработки.',
    acceptance_criteria: ['Результат доступен не позднее минуты.'],
  } : {},
}));

const legacyTask = {
  id: 901,
  public_id: 'TASK-000-901',
  title: 'Legacy-задача заказчика',
  description: 'Задача создана до появления реестра требований.',
  status: 'ПРИНЯТА В РАБОТУ',
  status_name: 'ПРИНЯТА В РАБОТУ',
  progress: 40,
  team_name: 'Команда продукта',
  created_at: '2026-08-01T08:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};

async function mockCustomerPortal(page, { large = false } = {}) {
  const queueCalls = [];
  let failQueue = false;
  let activations = 0;
  let newDialogs = 0;
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/events/stream') return route.abort();
    if (path === '/auth/refresh') return json(route, { access_token: 'e2e-token', user: { id: 301, name: 'Заказчик' } });
    if (path === '/auth/me') return json(route, { id: 301, name: 'Заказчик', role_name: 'Бизнес-заказчик', permissions: { review: 'none', customer_portal_mode: 'only' } });
    if (path === '/admin/field-labels') return json(route, {});
    if (path === '/tasks/reference') return json(route, { statuses: [], priorities: [], deadlines: [], teams: [], projects: [], task_types: [], channels: [], departments: [], business_customers: [], did_client_groups: [], tags: [], users: [] });
    if (path === '/notifications/snapshot') return json(route, { revision: 1, summary: { unread: 0, requires_action: 0, today: 0, by_category: {} }, recent_items: [], recent_total: 0, action_items: [], action_total: 0 });
    if (path === '/customer/queue') {
      queueCalls.push(Object.fromEntries(url.searchParams));
      if (failQueue) { failQueue = false; return json(route, { detail: 'Временный сбой очереди' }, 503); }
      const draft = { id: 'draft-one', session_id: 'draft-1', kind: 'draft', draft_session: true, title: 'Автоматизация сверки отчёта', status: 'draft', active: true, updated_at: '2026-09-09T10:00:00Z' };
      const task = { ...legacyTask, id: 'task-901', kind: 'task', legacy_task: true, task_id: 901, task_public_id: legacyTask.public_id, task_status: legacyTask.status, task_progress: 40, status: 'in_progress' };
      const all = large ? Array.from({ length: 251 }, (_, i) => ({ ...task, id: `task-${i + 1}`, task_id: i + 1, task_public_id: `TASK-${i + 1}`, title: i === 250 ? 'Уникальная сверка 251' : `Задача ${i + 1}`, updated_at: new Date(Date.UTC(2026, 9, 17, 0, 0, 251 - i)).toISOString() })) : [draft, ...requests.map(r => ({ ...r, kind: 'request' })), task];
      const group = item => item.draft_session ? 'draft' : ['done', 'closed'].includes(getRequestStage(item).group) ? 'complete' : getRequestStage(item).group;
      const counts = { all: all.length, action: 0, draft: 0, review: 0, work: 0, complete: 0 };
      for (const item of all) counts[group(item)]++;
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const filtered = all.filter(item => (!q || `${item.id} ${item.title}`.toLowerCase().includes(q)) && (!url.searchParams.get('group') || group(item) === url.searchParams.get('group'))).sort((a,b) => (Date.parse(b.updated_at) - Date.parse(a.updated_at)) * (url.searchParams.get('sort') === 'oldest' ? -1 : 1));
      const perPage = Number(url.searchParams.get('per_page') || 25);
      const pages = Math.ceil(filtered.length / perPage);
      const current = Math.min(Math.max(1, Number(url.searchParams.get('page') || 1)), Math.max(1, pages));
      if (q === 'задача 2') await new Promise(resolve => setTimeout(resolve, 650));
      return json(route, { items: filtered.slice((current - 1) * perPage, current * perPage), total: filtered.length, pages, page: current, per_page: perPage, counts, warnings: [], preferred_draft: large ? null : draft });
    }
    if (path === '/agent/requests') return json(route, requests);
    if (path === '/agent/requests/100') return json(route, { ...requests[0], task_id: 901, task_public_id: legacyTask.public_id, task_status: legacyTask.status, task_progress: legacyTask.progress });
    if (path === '/agent/sessions') return json(route, { sessions: [{ session_id: 'draft-1', title: 'Автоматизация сверки отчёта', phase: 'draft_ready', has_draft: true, active: true, archived: false, updated_at: '2026-09-09T10:00:00Z' }] });
    if (path === '/customer/tasks') return json(route, { items: [legacyTask], total: 1, page: 1, per_page: 200, pages: 1 });
    if (path === '/customer/tasks/901') return json(route, legacyTask);
    if (path === '/agent/session/draft-1/activate' && route.request().method() === 'POST') { activations += 1; return json(route, { success: true, session_id: 'draft-1', active: true }); }
    if (path === '/agent/new-dialog' && route.request().method() === 'POST') { newDialogs += 1; return json(route, { session_id: 'new-session', active: true }); }
    if (path === '/agent/session') return json(route, { active: false });
    return json(route, {});
  });
  return { activations: () => activations, newDialogs: () => newDialogs, queueCalls, failNext: () => { failQueue = true; } };
}

test('mobile customer queue keeps every card reachable and exposes the active draft', async ({ page }) => {
  const calls = await mockCustomerPortal(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/customer');

  await expect(page.getByRole('heading', { name: 'Мои запросы' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Продолжить черновик' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Новый запрос' })).toBeVisible();
  await expect(page.locator('.customer-request-card')).toHaveCount(22);

  const queueGeometry = await page.locator('.customer-request-list').evaluate(element => ({
    overflowY: getComputedStyle(element).overflowY,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(queueGeometry.overflowY).toBe('visible');

  const lastCard = page.locator('.customer-request-card').last();
  await lastCard.scrollIntoViewIfNeeded();
  await expect(lastCard).toBeVisible();
  const mainGeometry = await page.locator('.main-content').evaluate(element => ({ clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }));
  expect(mainGeometry.scrollHeight).toBeGreaterThan(mainGeometry.clientHeight);
  expect(mainGeometry.scrollTop).toBeGreaterThan(0);

  await page.getByRole('button', { name: /Черновики/ }).click();
  await expect(page).toHaveURL(/status=draft/);
  await expect(page.locator('.customer-request-card')).toHaveCount(1);
  await page.locator('[data-draft-session="draft-1"]').click();
  await expect(page).toHaveURL(/#\/customer\/create/);
  expect(calls.activations()).toBe(1);
});

test('desktop customer cards share one geometry and surface', async ({ page }) => {
  await mockCustomerPortal(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/customer');

  const cards = page.locator('.customer-request-card');
  await expect(cards).toHaveCount(22);
  await expect(page.locator('.customer-request-card-context')).toHaveCount(22);
  const geometry = await cards.evaluateAll(elements => elements.map(element => ({
    height: element.getBoundingClientRect().height,
    background: getComputedStyle(element).backgroundColor,
    borderLeftWidth: getComputedStyle(element).borderLeftWidth,
  })));
  const heights = geometry.map(item => item.height);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
  expect(new Set(geometry.map(item => item.background)).size).toBe(1);
  expect(new Set(geometry.map(item => item.borderLeftWidth))).toEqual(new Set(['4px']));

  const main = page.locator('.main-content');
  const scrollGeometry = await main.evaluate(element => ({
    overflowY: getComputedStyle(element).overflowY,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(scrollGeometry.overflowY).toBe('auto');
  expect(scrollGeometry.scrollHeight).toBeGreaterThan(scrollGeometry.clientHeight);
  await cards.first().hover();
  await page.mouse.wheel(0, 700);
  await expect.poll(() => main.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
});

test('customer detail follows review navigation and opens a customer-safe linked task', async ({ page }) => {
  await mockCustomerPortal(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/customer/request/100');

  await expect(page.getByRole('heading', { name: requests[0].title })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Разделы запроса' })).toBeVisible();
  await page.getByRole('button', { name: 'TO-BE' }).click();
  await expect(page.locator('#request-section-target-process')).toBeFocused();

  const layout = await page.locator('.customer-request-detail-layout').evaluate(root => ({
    overflow: root.scrollWidth - root.clientWidth,
    mainTop: root.querySelector('.customer-request-detail-main').getBoundingClientRect().top,
    asideTop: root.querySelector('.customer-request-detail-aside').getBoundingClientRect().top,
  }));
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.mainTop).toBeLessThan(layout.asideTop);

  await page.getByRole('link', { name: 'Открыть задачу' }).click();
  await expect(page).toHaveURL(/#\/customer\/task\/901/);
  await expect(page.getByRole('heading', { name: legacyTask.title })).toBeVisible();
  await expect(page.getByText('Доступное заказчику описание реализации')).toBeVisible();
  await expect.poll(() => page.locator('.main-content').evaluate(element => element.scrollTop)).toBe(0);
});


test('server queue reaches records beyond 200, persists page, searches and recovers', async ({ page }) => {
  const calls = await mockCustomerPortal(page, { large: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/customer?page=10');
  await expect(page.locator('.customer-request-card')).toHaveCount(25);
  await expect(page.getByText('Страница 10 из 11', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Следующая', exact: true }).click();
  await expect(page.locator('.customer-request-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Уникальная сверка 251' })).toBeVisible();
  await expect(page).toHaveURL(/page=11/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Уникальная сверка 251' })).toBeVisible();
  const search = page.getByRole('searchbox');
  await search.fill('Уникальная');
  await expect.poll(() => calls.queueCalls.at(-1)?.q).toBe('Уникальная');
  await expect(page).not.toHaveURL(/page=/);
  await expect(page.locator('#customer-results-status')).toHaveText('Показано 1 из 1, страница 1 из 1');
  await expect(page.locator('#customer-stat-all')).toHaveText('251');
  await search.fill('Не существует');
  await expect(page.getByText('Запросы не найдены', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await expect(page.locator('.customer-request-card')).toHaveCount(25);
  await page.getByRole('combobox', { name: 'Сортировка запросов' }).selectOption('oldest');
  await expect(page.locator('.customer-request-card').first()).toContainText('Уникальная сверка 251');
  calls.failNext();
  await page.getByRole('button', { name: 'Обновить запросы', exact: true }).click();
  await expect(page.getByText('Не удалось загрузить запросы', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.customer-request-card')).toHaveCount(25);
  expect(await page.locator('.customer-request-list').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});

test('new search suppresses an older delayed server result', async ({ page }) => {
  const calls = await mockCustomerPortal(page, { large: true });
  await page.goto('/#/customer');
  await expect(page.locator('.customer-request-card')).toHaveCount(25);
  await page.getByRole('searchbox').fill('задача 2');
  await expect.poll(() => calls.queueCalls.at(-1)?.q).toBe('задача 2');
  await page.getByRole('searchbox').fill('Уникальная');
  await expect(page.locator('.customer-request-card')).toHaveCount(1);
  await page.waitForTimeout(800);
  await expect(page.locator('.customer-request-card')).toHaveCount(1);
  await expect(page.locator('.customer-request-card')).toContainText('Уникальная сверка 251');
});


test('customer result distinguishes execution outcomes and review rejection with history', async ({ page }) => {
  await mockCustomerPortal(page);
  let status = 'completed';
  const labels = { completed: 'Выполнен', not_relevant: 'Не актуален', task_rejected: 'Задача отклонена', task_deleted: 'Задача удалена', rejected: 'Отклонён' };
  await page.route('**/api/v1/agent/requests/100', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ ...requests[0], status,
      task_id: 901, task_status: 'ВЫПОЛНЕНА', task_progress: 100,
      status_history: [{ status, title: 'Результат синхронизирован', actor_name: 'Система', created_at: '2026-10-17T10:00:00Z', comment: '' }] })
  }));
  for (const [next, label] of Object.entries(labels)) {
    status = next;
    await page.goto('/#/customer/request/100');
    await page.reload();
    await expect(page.locator('.customer-request-detail-header .badge')).toHaveText(label);
    await expect(page.getByText('Результат синхронизирован', { exact: true })).toBeVisible();
  }
});


test('customer event read state persists after reload and read failure can retry', async ({ page }) => {
  await mockCustomerPortal(page);
  let unread = true, fail = true;
  await page.route('**/api/v1/customer/queue?*', route => route.fulfill({
    contentType:'application/json',body:JSON.stringify({items:[{...requests[0],kind:'request',status:'returned',unread_event_count:unread?1:0}],total:1,pages:1,page:1,per_page:25,counts:{all:1,action:1,draft:0,review:0,work:0,complete:0},warnings:[]})
  }));
  await page.route('**/api/v1/customer/requests/100/events', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({total: unread ? 1 : 0,
      items: unread ? [{id: 51, title: 'Новое замечание специалиста', body: 'Проверьте условия'}] : []})
  }));
  await page.route('**/api/v1/notifications/read', route => {
    expect(route.request().postDataJSON()).toEqual({ids: [51]});
    if (fail) { fail=false; return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Временная ошибка'})}); }
    unread=false;
    return route.fulfill({contentType:'application/json',body:JSON.stringify({changed_ids:[51],blocked_ids:[]})});
  });
  await page.goto('/#/customer');
  await expect(page.getByText('Новое замечание · 1', {exact:true})).toBeVisible();
  await page.locator('.customer-request-card').click();
  await expect(page.getByText('Новое замечание специалиста', {exact:true})).toBeVisible();
  const read = page.getByRole('button',{name:'Отметить прочитанным',exact:true});
  await read.click();
  await expect(page.getByText(/Не удалось сохранить прочтение/)).toBeVisible();
  await read.click();
  await expect(page.getByText('Непрочитанных событий нет',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByText('Непрочитанных событий нет',{exact:true})).toBeVisible();
  await page.goto('/#/customer');
  await expect(page.locator('.customer-request-card')).toHaveCount(1);
  await expect(page.getByText('Новое замечание · 1', {exact:true})).toHaveCount(0);
  unread=true;
  await page.goto('/#/customer/request/100');
  await page.reload();
  await expect(page.getByText('Новое замечание специалиста',{exact:true})).toBeVisible();
});


test('customer queue explains personal and shared scope and uses safe task detail', async ({ page }) => {
  await mockCustomerPortal(page);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#/customer');
  await expect(page.getByText('Ваши личные запросы и черновики, а также общие задачи вашего бизнес-заказчика',{exact:true})).toBeVisible();
  await expect(page.getByText('Личный запрос #100',{exact:true})).toBeVisible();
  const shared=page.locator('.customer-request-card').filter({hasText:'Legacy-задача заказчика'});
  await expect(shared).toContainText('общая задача бизнес-заказчика');
  await expect(shared).toHaveAttribute('href','#/customer/task/901');
  await expect(page.locator('.customer-request-card[href*="#/backlog"]')).toHaveCount(0);
  await shared.click();
  await expect(page.getByRole('heading',{name:legacyTask.title})).toBeVisible();
  await expect(page.getByText(/Изменение задачи здесь недоступно/)).toBeVisible();
});
