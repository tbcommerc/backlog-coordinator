import { expect, test } from '@playwright/test';

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

async function mockCustomerPortal(page) {
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
  return { activations: () => activations, newDialogs: () => newDialogs };
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
