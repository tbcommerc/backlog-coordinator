import { expect, test } from '@playwright/test';

import { mockApp } from './helpers/backlogMock.mjs';

test('UX-03: quick-filter counts follow DMB → team → DMB and refresh', async ({ page }) => {
  const { tasks } = await mockApp(page);
  await page.goto('/#/backlog');
    if(!String(await page.content()).includes('Команда не назначена')) await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
  const urgent = page.locator('.quick-filter-btn[data-filter="urgent"]');
  await expect(urgent.locator('.quick-filter-count')).toHaveText('2');
  await page.locator('[data-backlog-scope="team"]').first().click();
  await expect(urgent.locator('.quick-filter-count')).toHaveText('1');
  await expect(urgent).toHaveAccessibleName('Важные задачи: 1');
  tasks[1].priority_name = 'ВЫСОКИЙ';
  await page.locator('#backlog-btn-refresh').click();
  await expect(urgent.locator('.quick-filter-count')).toHaveText('2');
  await expect(urgent).toHaveAccessibleName('Важные задачи: 2');
  await page.locator('[data-backlog-scope="all"]').first().click();
  await expect(urgent.locator('.quick-filter-count')).toHaveText('3');
});

for (const scope of ['backlog', 'team']) {
  test(`UX-05/06/10: ${scope} keeps search, rows and count through quick save and navigation`, async ({ page }) => {
    const { writes } = await mockApp(page);
    const route = scope === 'team' ? 'team-backlog' : 'backlog';
    const table = scope === 'team' ? '#tasks-table' : '#tasks-table';
    const count = scope === 'team' ? '#tasks-count' : '#tasks-count';
    await page.goto(`/#/${route}`);
    if(!String(await page.content()).includes('Команда не назначена')) await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
    await expect(page.locator(`${table} tbody tr[data-task-id]`)).toHaveCount(scope === 'team' ? 2 : 3);
    const search = page.locator(`#f-backlog-search`);
    await search.fill('уникальное описание');
    await expect(page.locator(`${table} tbody tr[data-task-id]`)).toHaveCount(1);
    await expect(page.locator(count)).toHaveText('Найдено: 1 задача');
    await page.locator(`#backlog-inline-edit`).click();
    const owner = page.locator(`${table} select[data-field="owner_id"]`);
    if (scope === 'team') {
      await expect(owner).toHaveValue('');
      await expect(owner.locator('option:checked')).toHaveText('Не выбрано');
    }
    await page.locator(`${table} input[data-field="title"]`).fill('Обновлённая задача');
    await page.locator(`#qe-save-backlog`).click();
    await page.getByRole('button', { name: 'ОК', exact: true }).click();
    await expect(page.locator(`#qe-toolbar-backlog`)).toBeHidden();
    await expect(search).toHaveValue('уникальное описание');
    await expect(page.locator(`${table} tbody tr[data-task-id]`)).toHaveCount(1);
    await expect(page.locator(count)).toHaveText('Найдено: 1 задача');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ title: 'Обновлённая задача', version: 1 });
    const other = scope === 'team' ? 'backlog' : 'team-backlog';
    await page.locator(`[data-backlog-scope="${other==='backlog'?'all':'team'}"]`).first().click();
    await expect(page.locator('[data-backlog-scope][aria-current="true"]')).toHaveAttribute('data-backlog-scope',other==='backlog'?'all':'team');
    await page.locator(`[data-backlog-scope="${route==='backlog'?'all':'team'}"]`).first().click();
    await expect(search).toHaveValue('уникальное описание');
    await expect(page.locator(`${table} tbody tr[data-task-id]`)).toHaveCount(1);
    await expect(page.locator(count)).toHaveText('Найдено: 1 задача');
  });
}

test('UX-17: read-only BA sees a reason and cannot enter an empty editor', async ({ page }) => {
  await mockApp(page, { readonly: true });
  await page.goto('/#/team-backlog');
    if(!String(await page.content()).includes('Команда не назначена')) await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#tasks-table tbody tr[data-task-id]')).toHaveCount(2);
  await expect(page.locator('#backlog-inline-edit')).toBeDisabled();
  await expect(page.locator('#backlog-edit-hint')).toHaveText('Нет прав на изменение задач в этой выборке.');
  await page.locator('#backlog-bulk-open').click();
  await expect(page.locator('[data-backlog-operation="bulk"]')).toBeDisabled();
  await expect(page.locator('[data-backlog-operation="bulk"]')).toContainText('Нет прав на изменение');
  await page.keyboard.press('Escape');
  await page.locator('[data-backlog-scope="all"]').first().click();
  await expect(page.locator('#backlog-inline-edit')).toBeDisabled();
  await page.locator('#backlog-bulk-open').click();
  await expect(page.locator('[data-backlog-operation="bulk"]')).toBeDisabled();
});

test('UX-05/18: missing optional references stay empty and legacy task can save progress', async ({ page }) => {
  const { writes } = await mockApp(page);
  await page.goto('/#/team-backlog?task=41');
    if(!String(await page.content()).includes('Команда не назначена')) await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#task-detail-overlay')).toBeVisible();
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  for (const field of ['assignee', 'customer', 'project', 'type']) {
    await expect(page.locator(`select[data-k="${field}"]`)).toHaveValue('');
    await expect(page.locator(`select[data-k="${field}"] option:checked`)).toHaveText('Не выбрано');
  }
  await page.locator('[data-k="progress"]').fill('15');
  await page.locator('#saveBtn').click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ progress: 15, version: 1 });
  expect(Object.keys(writes[0]).sort()).toEqual(['client_request_id', 'progress', 'version']);
});

test('UX-18: clearing an existing task type still blocks saving', async ({ page }) => {
  const { tasks, writes } = await mockApp(page);
  tasks[0].task_type_id = 1;
  tasks[0].task_type_name = 'AD-HOC';
  await page.goto('/#/team-backlog?task=41');
    if(!String(await page.content()).includes('Команда не назначена')) await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.locator('select[data-k="type"]').selectOption('');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#card-form-error-summary')).toContainText('Укажите тип задачи');
  expect(writes).toHaveLength(0);
});

test('UX-17: empty search is distinguished from missing permissions and can be reset', async ({ page }) => {
  await mockApp(page);
  await page.goto('/#/team-backlog');
    if(!String(await page.content()).includes('Команда не назначена')) await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#tasks-table tbody tr[data-task-id]')).toHaveCount(2);
  await page.locator('#f-backlog-search').fill('нет таких задач');
  await expect(page.locator('#backlog-edit-hint')).toHaveText('В текущей выборке нет задач для изменения.');
  await expect(page.locator('#backlog-inline-edit')).toBeDisabled();
  await page.locator('#f-backlog-reset').click();
  await expect(page.locator('#backlog-inline-edit')).toBeEnabled();
  await expect(page.locator('#backlog-edit-hint')).toBeHidden();
  await page.evaluate(async () => {
    const { showBulkOpsModal } = await import('/js/components/modal.js?v=106');
    void showBulkOpsModal(window.app, 'team', []);
  });
  await expect(page.locator('#bulk-modal-overlay')).toContainText('Страница 1 из 1');
  await expect(page.locator('#bc-page-next')).toBeDisabled();
  await expect(page.locator('#bc-page-prev')).toBeDisabled();
});
