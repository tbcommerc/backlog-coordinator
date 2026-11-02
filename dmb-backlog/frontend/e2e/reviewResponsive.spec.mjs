import { expect, test } from '@playwright/test';

const requestItem = {
  id: 8,
  version: 4,
  status: 'in_review',
  title: 'Сверка расчётной инструкции',
  description: 'Нужно исключить ручную сверку перед отправкой инструкции.',
  author_name: 'Мария Заказчик',
  team_id: 12,
  team_name: 'Расчёты',
  reviewer_id: 101,
  reviewer_name: 'Тестовый ревьюер',
  available_actions: ['approve', 'return', 'reject', 'release', 'reroute'],
  created_at: '2026-09-08T08:00:00Z',
  updated_at: '2026-09-08T09:00:00Z',
  draft: {
    problem_statement: 'Сотрудник вручную сверяет параметры инструкции и теряет время.',
    current_process: 'Параметры сравниваются в двух системах.',
    target_process: 'Система показывает расхождения до отправки.',
    business_value: 'Снижается риск ошибочной отправки.',
    user_roles: ['Специалист расчётов'],
    acceptance_criteria: ['Расхождения показаны до подтверждения отправки.'],
    open_questions: ['Уточните допустимое время сверки.'],
    review_findings: [{ text: 'Не описана интеграция с расчётной системой.', section_key: 'data_integrations' }],
    completeness_score: 82,
    quality_score: 76,
  },
};

async function mockReview(page, { staleOnApprove = false, queueItems = [requestItem] } = {}) {
  let statusCalls = 0;
  let detailCalls = 0;
  let baCalls = 0;
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/events/stream') return route.abort();
    if (path === '/auth/refresh') return json(route, { access_token: 'e2e-token', user: { id: 101, name: 'Тестовый ревьюер' } });
    if (path === '/auth/me') return json(route, { id: 101, name: 'Тестовый ревьюер', role_name: 'Ревьюер', permissions: { review: 'all', customer_portal_mode: 'all' } });
    if (path === '/admin/field-labels') return json(route, {});
    if (path === '/tasks/reference') return json(route, { statuses: [], priorities: [], deadlines: [], teams: [], projects: [], task_types: [], channels: [], departments: [], business_customers: [], did_client_groups: [], tags: [], users: [] });
    if (path === '/notifications/snapshot') return json(route, { revision: 1, summary: { unread: 0, requires_action: 0, today: 0, by_category: {} }, recent_items: [], recent_total: 0, action_items: [], action_total: 0 });
    if (path === '/agent/requests/review') return json(route, queueItems);
    if (path === '/agent/requests/8' && route.request().method() === 'GET') {
      detailCalls += 1;
      return json(route, staleOnApprove && detailCalls > 1 ? { ...requestItem, version: 5 } : requestItem);
    }
    if (path === '/agent/requests/8/status') {
      statusCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 120));
      return json(route, { detail: 'Запрос был изменён в другой сессии' }, 409);
    }
    if (path === '/agent/teams/12/ba') { baCalls += 1; return json(route, [{ id: 202, name: 'Бизнес-аналитик', role: 'BA' }]); }
    if (path === '/agent/teams') return json(route, [{id:12,name:'Расчёты'},{id:13,name:'Другая команда'}]);
    return json(route, {});
  });
  return { statusCalls: () => statusCalls, baCalls: () => baCalls };
}

for(const theme of ['light','dark'])for(const width of [390,1280])test(`review action dialogs use shared controls ${theme}/${width}`,async({page})=>{
 await mockReview(page);await page.setViewportSize({width,height:1000});await page.goto('/#/review/8');
 await expect(page.locator('#btn-return')).toBeVisible();
 await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.compact='true';},theme);
 for(const action of ['return','reject','release','reroute']) {
  await page.locator(`#btn-${action}`).click();const dialog=page.locator('.review-modal');await expect(dialog).toBeVisible();
  const close=dialog.getByRole('button',{name:'Закрыть диалог',exact:true});const box=await close.boundingBox();
  expect(box.width).toBeCloseTo(box.height,2);expect(box.height).toBeCloseTo(width===390?44:36,2);
  const rect=await dialog.boundingBox();expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(width);
  await expect(dialog.locator('#modal-confirm')).toBeDisabled();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await expect(page.locator(`#btn-${action}`)).toBeFocused();
 }
});

test('desktop review list fills the available viewport height', async ({ page }) => {
  const queueItems = Array.from({ length: 8 }, (_, index) => ({
    ...requestItem,
    id: index + 1,
    title: `Запрос на ревью ${index + 1}`,
    updated_at: `2026-09-08T${String(9 + index).padStart(2, '0')}:00:00Z`,
  }));
  await mockReview(page, { queueItems });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/#/review');
  await expect(page.locator('.review-request-card')).toHaveCount(8);

  const geometry = await page.locator('#page-content').evaluate(root => {
    const list = root.querySelector('#review-list-content');
    const rootRect = root.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const rootStyle = getComputedStyle(root);
    return {
      bottomGap: rootRect.bottom - Number.parseFloat(rootStyle.paddingBottom) - listRect.bottom,
      clientHeight: list.clientHeight,
      scrollHeight: list.scrollHeight,
    };
  });
  expect(Math.abs(geometry.bottomGap), JSON.stringify(geometry)).toBeLessThanOrEqual(2);
  expect(geometry.clientHeight).toBeGreaterThan(500);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  await page.screenshot({ path: 'test-results/review-list-desktop.png' });
});

test('mobile review keeps content before decisions and preserves a failed comment', async ({ page }) => {
  const { statusCalls } = await mockReview(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/review');
  await expect(page.getByRole('heading', { name: 'Ревью запросов' })).toBeVisible();
  await page.getByRole('searchbox', { name: /Поиск по номеру/ }).fill('#8');
  await expect(page.getByRole('link', { name: /Запрос #8/ })).toBeVisible();
  await expect(page.locator('#review-count')).toHaveText('Показано 1 · загружено 1');
  await page.locator('#review-mode-filter').selectOption('history');
  await expect(page).toHaveURL(/mode=history/);
  await page.locator('#review-mode-filter').selectOption('action');
  let unresolvedIcons = await page.locator('#page-content i[data-lucide]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-lucide')));
  expect(unresolvedIcons, `Неразрешённые иконки: ${unresolvedIcons.join(', ')}`).toEqual([]);

  await page.goto('/#/review/8');
  await expect(page.getByRole('heading', { name: 'Сверка расчётной инструкции' })).toBeVisible();

  const layout = await page.locator('.review-detail-layout').evaluate(root => ({
    overflow: root.scrollWidth - root.clientWidth,
    mainTop: root.querySelector('.review-detail-main').getBoundingClientRect().top,
    asideTop: root.querySelector('.review-detail-aside').getBoundingClientRect().top,
  }));
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.mainTop).toBeLessThan(layout.asideTop);
  unresolvedIcons = await page.locator('#page-content i[data-lucide]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-lucide')));
  expect(unresolvedIcons, `Неразрешённые иконки: ${unresolvedIcons.join(', ')}`).toEqual([]);

  await page.setViewportSize({ width: 320, height: 760 });
  const narrowOverflow = await page.locator('#page-content').evaluate(root => root.scrollWidth - root.clientWidth);
  expect(narrowOverflow).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.locator('.request-legacy-description > summary').click();
  await expect(page.getByText('Нужно исключить ручную сверку перед отправкой инструкции.')).toBeVisible();
  await page.getByRole('button', { name: /Не описана интеграция/ }).click();
  await expect(page.locator('#request-section-data-integrations')).toBeFocused();
  await expect(page.locator('#request-section-data-integrations')).toContainText('Не уточнено');
  await page.screenshot({ path: 'test-results/review-detail-mobile.png', fullPage: true });

  await page.getByRole('button', { name: 'Вернуть на уточнение' }).click();
  const comment = page.getByLabel(/Что нужно уточнить/);
  await expect(comment).toBeFocused();
  await comment.fill('В критерии 1 укажите допустимое время сверки и источник норматива.');

  await page.locator('.modal-close').click();
  const discard = page.locator('.review-modal-discard');
  await expect(discard).toBeVisible();
  const discardGeometry = await discard.evaluate(element => ({
    overflow: element.scrollWidth - element.clientWidth,
    width: element.getBoundingClientRect().width,
    children: [...element.querySelectorAll('*')].map(child => ({
      tag: child.tagName,
      className: child.className,
      width: child.getBoundingClientRect().width,
      scrollWidth: child.scrollWidth,
      clientWidth: child.clientWidth,
      minWidth: getComputedStyle(child).minWidth,
      boxSizing: getComputedStyle(child).boxSizing,
    })),
  }));
  expect(discardGeometry.overflow, JSON.stringify(discardGeometry)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Продолжить' }).click();

  await page.locator('#modal-confirm').evaluate(button => { button.click(); button.click(); });
  await expect(page.locator('.review-modal-error')).toBeVisible();
  expect(statusCalls()).toBe(1);
  await page.getByRole('button', { name: 'Обновить данные' }).click();
  await expect(page.locator('.review-modal')).toHaveCount(0);

  await page.getByRole('button', { name: 'Вернуть на уточнение' }).click();
  await expect(page.getByLabel(/Что нужно уточнить/)).toHaveValue('В критерии 1 укажите допустимое время сверки и источник норматива.');
});

test('review blocks transfer when the rendered version is stale', async ({ page }) => {
  const { baCalls } = await mockReview(page, { staleOnApprove: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/#/review/8');
  await expect(page.getByText('редакция 1', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Передать в проработку' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Запрос изменился' })).toBeVisible();
  await expect(page.getByText('проверьте изменения перед решением')).toBeVisible();
  expect(baCalls()).toBe(0);
});

test('review append error retains rows, retries the same offset once and focuses new content',async({page})=>{
 const items=Array.from({length:250},(_,i)=>({...requestItem,id:i+1,title:`Запрос ${i+1}`}));
 await mockReview(page,{queueItems:items});const offsets=[];let failed=false;
 await page.route('**/api/v1/agent/requests/review?*',async route=>{const offset=Number(new URL(route.request().url()).searchParams.get('offset'));offsets.push(offset);if(offset===250&&!failed){failed=true;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Синтетический сбой догрузки'})});}return route.fulfill({contentType:'application/json',body:JSON.stringify(offset===0?items:[{...requestItem,id:251,title:'Новая строка'}])});});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/#/review');await expect(page.locator('.review-request-card')).toHaveCount(250);
 await page.locator('#load-more-review').evaluate(b=>{b.click();b.click();});await expect(page.locator('#retry-review-list')).toBeVisible();await expect(page.locator('#retry-review-list')).toBeFocused();await expect(page.locator('.review-request-card')).toHaveCount(250);
 await page.locator('#retry-review-list').click();await expect(page.locator('.review-request-card')).toHaveCount(251);await expect(page.locator('[data-review-id="251"]')).toBeFocused();expect(offsets).toEqual([0,250,250]);expect(errors).toEqual([]);
});

test('review filtered empty batch retains continuation and finds a match beyond the loaded page',async({page})=>{
 const items=Array.from({length:250},(_,i)=>({...requestItem,id:i+1,title:`Запрос ${i+1}`}));await mockReview(page,{queueItems:items});
 await page.route('**/api/v1/agent/requests/review?*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(Number(new URL(route.request().url()).searchParams.get('offset'))===0?items:[{...requestItem,id:251,title:'Нужное совпадение'}])}));
 await page.goto('/#/review');await expect(page.locator('.review-request-card')).toHaveCount(250);await page.locator('#review-search').fill('Нужное совпадение');await expect(page.getByText('Ничего не найдено',{exact:true})).toBeVisible();await expect(page.locator('#load-more-review')).toBeVisible();await page.locator('#load-more-review').click();await expect(page.locator('.review-request-card')).toHaveCount(1);await expect(page.locator('[data-review-id="251"]')).toBeFocused();
});

test('review ignores an old response after leaving and reopening the queue',async({page})=>{
 await mockReview(page);let releaseOld;let calls=0;
 await page.route('**/api/v1/agent/requests/review?*',async route=>{calls++;if(calls===1){await new Promise(resolve=>releaseOld=resolve);await route.fulfill({contentType:'application/json',body:JSON.stringify([{...requestItem,title:'Устаревший ответ'}])}).catch(()=>{});return;}return route.fulfill({contentType:'application/json',body:JSON.stringify([{...requestItem,title:'Актуальный ответ'}])});});
 await page.goto('/#/review');await expect.poll(()=>calls).toBe(1);await page.evaluate(()=>{window.location.hash='#/settings';});await expect(page.getByRole('heading',{name:'Персональные настройки',exact:true})).toBeVisible();await page.evaluate(()=>{window.location.hash='#/review';});await expect(page.locator('.review-request-card')).toContainText('Актуальный ответ');releaseOld();await expect(page.locator('.review-request-card')).toContainText('Актуальный ответ');await expect(page.getByText('Устаревший ответ',{exact:true})).toHaveCount(0);
});
