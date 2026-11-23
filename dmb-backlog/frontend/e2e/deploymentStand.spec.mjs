import { test, expect } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';

test.skip(process.env.DMB_DEMO_BROWSER_TEST !== '1', 'Requires the isolated deployment test server');

const networkReports = new WeakMap();
test.beforeEach(async ({page}) => {
  const calls = [], pending = new Map();
  networkReports.set(page, calls);
  page.on('request', request => {
    if (!request.url().includes('/api/')) return;
    const entry = {method: request.method(), path: new URL(request.url()).pathname, status: 'pending', started: Date.now()};
    calls.push(entry); pending.set(request, entry);
  });
  page.on('response', response => {
    const entry = pending.get(response.request());
    if (entry) { entry.status = response.status(); entry.milliseconds = Date.now() - entry.started; }
  });
});
test.afterEach(async ({page}, info) => {
  const body = JSON.stringify(networkReports.get(page), null, 2);
  await writeFile(info.outputPath('api-status-and-timing.json'), body);
  await info.attach('api-status-and-timing', {body, contentType: 'application/json'});
});

test('real demo login, admin, reference values and browser reload', async ({page, context}, testInfo) => {
  test.setTimeout(180_000);
  const errors = [];
  let phase = 'initial';
  page.on('response', response => {
    if (phase !== 'initial' && response.url().includes('/api/') && response.status() >= 400) errors.push({phase, path: new URL(response.url()).pathname, status: response.status(), bearer: !!response.request().headers().authorization});
  });
  page.on('requestfailed', request => {
    const reason = request.failure()?.errorText;
    if (phase !== 'initial' && request.url().includes('/api/') && reason !== 'net::ERR_ABORTED') {
      errors.push({phase, path:new URL(request.url()).pathname, status:reason});
    }
  });
  await page.goto('/');
  await page.locator('input[name="login"], #login-email, #login-login, #login-identifier').first().fill('browser.demo');
  await page.locator('input[type="password"]').first().fill('Isolated browser demonstration 2026!');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.sidebar')).toBeVisible();
  phase = 'signed-in';
  const minimal = await page.evaluate(async()=>window.app.api.post('/tasks/',{title:'Задача только с названием'}));
  expect(minimal.team_id).toBeNull();
  expect(minimal.task_type_id).toBeNull();
  expect(minimal.channel_id).toBeNull();
  const minimalRead = await page.evaluate(async id=>window.app.api.get('/tasks/'+id),minimal.id);
  expect(minimalRead.title).toBe('Задача только с названием');
  // Finish classification explicitly so the later old-schema rehearsal can
  // represent this new task; the previous schema disallows a null team.
  await page.evaluate(async task=>{
    const refs=await window.app.api.get('/tasks/reference');
    return window.app.api.patch('/tasks/'+task.id,{version:task.version,team_id:refs.teams[0].id});
  },minimalRead);
  await page.goto('/#/admin?admin_tab=dictionaries');
  await expect(page.locator('[data-tab="dictionaries"]')).toBeVisible();
  if (await page.locator('[data-tab="dictionaries"]').getAttribute('aria-selected') !== 'true') {
    await page.locator('[data-tab="dictionaries"]').click();
  }
  await expect(page.locator('[data-tab="dictionaries"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-dict="priorities"]')).toBeVisible({timeout: 20_000});
  await page.screenshot({path: testInfo.outputPath('admin-full.png'), fullPage: true});
  const priorityName = 'Приоритет репетиции ' + Date.now();
  await page.locator('[data-dict="priorities"]').click();
  await page.locator('#dict-add-value').click();
  const draft = page.locator('.dict-editor-row.is-new').last();
  await draft.locator('.dict-value-input').fill(priorityName);
  await draft.locator('.dict-code-input').fill('rehearsal_' + Date.now());
  const dictionarySaved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/dictionaries/priority/batch' && response.request().method() === 'PUT');
  await page.locator('#admin-modal-overlay .modal-save-btn').click();
  expect((await dictionarySaved).status()).toBe(200);
  await expect(page.locator('#admin-modal-overlay')).toHaveCount(0);
  phase = 'reference'; const reference = await page.evaluate(() => window.app.api.get('/tasks/reference'));
  const customPriority = reference.priorities.find(item => item.name === priorityName);
  expect(customPriority).toBeTruthy();
  expect(reference.priorities.length).toBeGreaterThan(0);
  expect(reference.team_types.length).toBeGreaterThan(0);
  expect(reference.project_statuses.length).toBeGreaterThan(0);
  phase = 'reload'; await page.reload();
  await expect(page.locator('.sidebar')).toBeVisible();
  phase = 'backlog';
  const backlogLoaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/tasks/' && response.request().method() === 'GET', {timeout:20_000});
  await page.goto('/#/backlog');
  expect((await backlogLoaded).status()).toBe(200);
  await expect(page.getByRole('link', {name: 'Открыть задачу: Пример задачи для демонстрации', exact: true})).toBeVisible();
  await expect(page.locator('#backlog-add-task-btn')).toBeVisible();
  phase = 'create'; await page.locator('#backlog-add-task-btn').click();
  await expect(page.locator('#create-priority option')).toHaveCount(reference.priorities.length + 1);
  await expect(page.locator('#create-priority')).not.toHaveValue('');
  await page.locator('#create-priority').selectOption(String(customPriority.id));
  await page.screenshot({path: testInfo.outputPath('create-task-full.png'), fullPage: true});
  expect(errors).toEqual([]);
  const createdTitle = 'Задача из браузерной проверки ' + Date.now();
  await page.locator('#create-title').fill(createdTitle);
  await page.locator('#create-task-type').selectOption(String(reference.task_types[0].id));
  await page.locator('#create-channel').selectOption(String(reference.channels[0].id));
  const priorityId = Number(await page.locator('#create-priority').inputValue());
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/tasks/' && response.request().method() === 'POST');
  await page.locator('#create-save-btn').click();
  const created = await saved;
  expect(created.status()).toBe(201);
  const taskId = (await created.json()).id;
  await expect(page.locator('#create-save-btn')).toHaveCount(0);
  const task = await page.evaluate(id => window.app.api.get('/tasks/' + id), taskId);
  expect(task.priority_id).toBe(priorityId);
  // Successful creation opens the new card itself; wait for it rather than
  // clicking the obscured registry behind the overlay.
  await expect(page.locator('#task-detail-overlay')).toBeVisible();
  await page.getByRole('button', {name: 'Редактировать задачу', exact: true}).click({timeout:15_000});
  const renamedTitle = createdTitle + ' — изменена';
  await page.locator('[data-k="title"]').fill(renamedTitle);
  const selectedOwner = reference.users.find(item => item.login === 'browser.demo');
  expect(reference.users.filter(item => item.name === selectedOwner.name)).toHaveLength(2);
  await expect(page.locator('[data-k="assignee"] option[value="'+selectedOwner.id+'"]').first()).toContainText('browser.demo');
  await page.locator('[data-k="assignee"]').selectOption(String(selectedOwner.id),{force:true});
  const selectedCustomer = reference.business_customers.at(-1);
  expect(reference.business_customers.filter(item => item.name === selectedCustomer.name)).toHaveLength(2);
  await page.locator('[data-k="customer"]').selectOption(String(selectedCustomer.id),{force:true});
  await expect(page.locator('[data-k="customerDeptId"]')).toHaveValue(String(selectedCustomer.department_id));
  const changed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/tasks/' + taskId && response.request().method() === 'PATCH', {timeout:15_000});
  await page.locator('#saveBtn').click();
  expect((await changed).status()).toBe(200);
  await expect(page.locator('#saveBtn')).toHaveCount(0);
  await expect(page.getByRole('button', {name:'Редактировать задачу', exact:true})).toBeEnabled();
  await page.getByRole('button', {name: 'Закрыть карточку задачи', exact: true}).click();
  await expect(page.locator('#task-detail-overlay')).toHaveCount(0);
  await page.locator('#f-backlog-search').fill(renamedTitle);
  await expect(page.locator('#tasks-tbody tr[data-task-id]')).toHaveCount(1);
  await expect(page.getByRole('link', {name: 'Открыть задачу: ' + renamedTitle, exact: true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', {name: 'Открыть задачу: ' + renamedTitle, exact: true})).toBeVisible();
  const updated = await page.evaluate(id => window.app.api.get('/tasks/' + id), taskId);
  expect(updated.title).toBe(renamedTitle);
  expect(updated.priority_id).toBe(priorityId);
  expect(updated.owner_id).toBe(selectedOwner.id);
  expect(updated.business_customer_id).toBe(selectedCustomer.id);
  expect(updated.department_id).toBe(selectedCustomer.department_id);
  expect(errors).toEqual([]);
  const exportReady = page.waitForEvent('download');
  await page.locator('#backlog-export-excel').click();
  const exported = await exportReady;
  expect(exported.suggestedFilename()).toMatch(/\.csv$/);
  const exportPath = testInfo.outputPath('backlog-export.csv');
  await exported.saveAs(exportPath);
  const csv = await readFile(exportPath, 'utf8');
  expect(csv).toContain(renamedTitle);
  expect(csv).toContain(priorityName);

  // The real backend rejects this access token; the real cookie must restore
  // concurrent safe reads without logging the user out or exposing credentials.
  phase = 'forced-access-renewal';
  const renewed = await page.evaluate(async () => {
    window.app.api.setAccessToken('invalid-isolated-test-access');
    const [me, users, roles, refs] = await Promise.all([
      window.app.api.get('/auth/me'), window.app.api.get('/admin/users'),
      window.app.api.get('/admin/roles'), window.app.api.get('/tasks/reference'),
    ]);
    return {admin: me.permissions.admin, users: users.length, roles: roles.length, priorities: refs.priorities.length};
  });
  expect(renewed.admin).toBe('full');
  expect(renewed.priorities).toBeGreaterThan(0);
  const second = await context.newPage();
  await second.goto('/#/backlog');
  await expect(second.locator('.sidebar')).toBeVisible();
  await page.evaluate(() => window.app.api.setAccessToken('invalid-two-tab-test'));
  await second.evaluate(() => window.app.api.setAccessToken('invalid-two-tab-test'));
  const parallelTabs = await Promise.all([
    page.evaluate(async () => (await window.app.api.get('/tasks/reference')).priorities.length),
    second.evaluate(async () => (await window.app.api.get('/tasks/reference')).priorities.length),
  ]);
  expect(parallelTabs.every(count => count > 0)).toBe(true);
  await second.close();
  if (process.env.DMB_CHECK_ATTACHMENTS === '1') {
    phase = 'scanner-negative';
    const attachments = await page.evaluate(async id => {
      const api = window.app.api;
      const clean = await api.upload(`/tasks/${id}/attachments`, new File(['Backlog rehearsal attachment'], 'rehearsal.txt', {type: 'text/plain'}));
      const downloaded = await api.get(clean.download_url.replace('/api/v1', ''));
      const before = (await api.get(`/tasks/${id}/attachments`)).total;
      const sample = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
      let rejected = 0;
      try { await api.upload(`/tasks/${id}/attachments`, new File([sample], 'scanner-test.txt', {type:'text/plain'})); }
      catch (error) { rejected = error.status; }
      const after = (await api.get(`/tasks/${id}/attachments`)).total;
      await api.delete(`/tasks/${id}/attachments/${clean.id}`);
      return {downloaded, before, after, rejected};
    }, taskId);
    expect(attachments).toEqual({downloaded:'Backlog rehearsal attachment', before:1, after:1, rejected:400});
  }
  expect(errors.filter(error => !((error.phase === 'forced-access-renewal' && error.status === 401)
    || (error.phase === 'scanner-negative' && error.status === 400)))).toEqual([]);
  await expect(page.locator('.sidebar')).toBeVisible();
});

test('related core registers load with real permissions and references', async ({page}, testInfo) => {
  test.setTimeout(120_000);
  const failures = [];
  let signedIn = false;
  page.on('response', response => {
    if (signedIn && response.url().includes('/api/') && response.status() >= 400) {
      failures.push({path:new URL(response.url()).pathname, status:response.status()});
    }
  });
  page.on('requestfailed', request => {
    const reason = request.failure()?.errorText;
    if (signedIn && request.url().includes('/api/') && reason !== 'net::ERR_ABORTED') failures.push({path:new URL(request.url()).pathname,status:reason});
  });
  await page.goto('/');
  await page.locator('input[name="login"], #login-email, #login-login, #login-identifier').first().fill('browser.demo');
  await page.locator('input[type="password"]').first().fill('Isolated browser demonstration 2026!');
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('.sidebar')).toBeVisible();
  signedIn = true;
  for (const [route, heading, ready, endpoint] of [
    ['/backlog', 'Бэклог', '#tasks-tbody', '/api/v1/tasks/'],
    ['/kanban', 'Канбан-доска', '#kanban-board:not([hidden])', '/api/v1/tasks/reference'],
    ['/metrics', 'Метрики', '#quarterly-metrics', '/api/v2/metrics'],
    ['/work-projects', 'Проекты', '#work-project-list', '/api/v1/projects'],
    ['/work-tasks', 'Рабочие задачи', '.work-results', '/api/v1/work-tasks'],
  ]) {
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === 'GET', {timeout:20_000});
    await page.goto('/#' + route);
    expect((await loaded).status()).toBe(200);
    await expect(page.getByRole('heading', {name:heading, exact:true, level:1})).toBeVisible();
    await expect(page.locator(ready)).toBeVisible();
    await expect(page.locator('main .view-state-loading:visible')).toHaveCount(0);
    await expect(page.locator('main .view-state-error, main .view-state-forbidden, main .view-state-unavailable')).toHaveCount(0);
    await page.screenshot({path:testInfo.outputPath(route.slice(1)+'-full.png'), fullPage:true});
  }
  expect(failures).toEqual([]);
});
