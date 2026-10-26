import { expect, test } from '@playwright/test';
import { mockApp } from './helpers/backlogMock.mjs';

async function open(page, scope = 'backlog', options = {}) {
  const data = await mockApp(page, options);
  await page.goto(`/#/${scope === 'team' ? 'team-backlog' : 'backlog'}`);
  await expect(page.locator(scope === 'team' ? '#team-tasks-table tbody tr[data-task-id]' : '#tasks-table tbody tr[data-task-id]')).not.toHaveCount(0);
  return data;
}

for (const scope of ['backlog', 'team']) {
  const table = scope === 'team' ? '#team-tasks-table' : '#tasks-table';
  const container = scope === 'team' ? '#team-tasks-container' : '#tasks-container';
  const pagination = scope === 'team' ? '#team-pagination' : '#pagination';

  test(`UX-01 ${scope}: mobile pagination reveals the first row below the toolbar`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, scope, { count: 205 });
    await page.locator(`${pagination} [data-page="2"]`).click();
    await expect.poll(() => page.locator(`${table} tbody tr[data-task-id]`).first().evaluate(row => {
      const r = row.getBoundingClientRect();
      const toolbar = document.querySelector('.sticky-toolbar').getBoundingClientRect();
      return r.top >= toolbar.bottom && r.bottom < innerHeight;
    })).toBe(true);
  });

  test(`UX-01/02/13/15 ${scope}: page starts at the first row, ID stays visible, keyboard sort/resize`, async ({ page }) => {
    await open(page, scope, { count: 205 });
    await page.locator(`${pagination} [data-page="2"]`).click();
    await expect(page.locator(`${pagination} [data-page="2"]`)).toHaveClass(/btn-primary/);
    await expect.poll(async () => page.locator(`${table} tbody tr[data-task-id]`).first().evaluate(row => {
      const y = row.getBoundingClientRect().top;
      return y >= 0 && y < innerHeight - 100;
    })).toBe(true);
    await page.locator('.main-content').evaluate(el => { el.scrollTop = 0; });
    await page.locator(`#${scope}-btn-column-settings`).click();
    await page.locator(`#${scope}-col-select-all`).click();
    await page.getByRole('button', { name: 'Закрыть настройки колонок' }).click();
    const copy = page.locator(`${table} tbody [data-copy-task-id]`).first();
    const id = await copy.getAttribute('data-copy-task-id');
    await expect(copy).toHaveAccessibleName(`Копировать ${id}`);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await copy.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(id);
    await page.locator(`${container} .table-container`).evaluate(el => { el.scrollLeft = el.scrollWidth; });
    const pin = await page.locator(`${table} tbody .table-pinned-id`).first().boundingBox();
    const area = await page.locator(`${container} .table-container`).boundingBox();
    expect(Math.abs(pin.x - area.x - 40)).toBeLessThan(3);
    await page.locator('.main-content').evaluate(el => { el.scrollTop = 650; });
    await expect(page.locator('#sticky-header-wrapper .table-pinned-id')).toBeVisible();
    const pinnedHeader = await page.locator('#sticky-header-wrapper .table-pinned-id').boundingBox();
    expect(Math.abs(pinnedHeader.x - area.x - 40)).toBeLessThan(3);
    const clonedSelect = page.locator('#sticky-header-wrapper input[type="checkbox"]');
    await clonedSelect.check();
    await expect(page.locator(`${table} tbody input[type="checkbox"]`).first()).toBeChecked();
    await page.locator('.main-content').evaluate(el => { el.scrollTop = 0; });
    await expect(page.locator(`${table} tbody .task-id-cell > span`).first()).toHaveAttribute('title', id);
    await page.locator(`${container} .table-container`).evaluate(el => { el.scrollLeft = 0; });
    const sort = page.locator(`${table} th[data-sort="title"] .table-sort-button`);
    await sort.focus();
    await sort.press('Enter');
    await expect(page.locator(`${table} th[data-sort="title"]`)).toHaveAttribute('aria-sort', 'ascending');
    await sort.press('Space');
    await expect(page.locator(`${table} th[data-sort="title"]`)).toHaveAttribute('aria-sort', 'descending');
    const resize = page.locator(`${table} th[data-sort="id"] .th-resize-handle`);
    const before = await page.locator(`${table} th[data-sort="id"]`).evaluate(el => el.getBoundingClientRect().width);
    await resize.focus();
    await resize.press('ArrowRight');
    const after = await page.locator(`${table} th[data-sort="id"]`).evaluate(el => el.getBoundingClientRect().width);
    expect(after).toBeGreaterThan(before + 8);
    await resize.press('Home');
    await expect(resize).toHaveAccessibleName('Ширина колонки: ID');
  });

  test(`UX-11/12/14 ${scope}: mobile columns keep ID and cards open using the keyboard`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, scope);
    await page.locator(`#${scope}-btn-column-settings`).click();
    await page.locator(`#${scope}-col-clear-all`).click();
    await expect(page.locator(`#${scope}-column-settings-list input[data-col="id"]`)).toBeChecked();
    await page.getByRole('button', { name: 'Закрыть настройки колонок' }).click();
    await expect(page.locator(`${table} th[data-sort]`)).toHaveCount(1);
    await expect(page.locator(`${table} th[data-sort="id"]`)).toBeVisible();
    await page.reload();
    await expect(page.locator(`${table} th[data-sort]`)).toHaveCount(1);
    await page.getByRole('button', { name: 'Карточное представление', exact: true }).click();
    const card = page.locator(`${container} [data-open-task]`).first();
    await card.focus();
    await card.press('Enter');
    await expect(page.locator('#task-detail-overlay')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });

  test(`UX-04 ${scope}: short screen leaves useful table area in quick edit`, async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await open(page, scope, { count: 205 });
    await page.locator(`#${scope}-inline-edit`).click();
    await page.locator('.main-content').evaluate(el => { el.scrollTop = 800; });
    await expect.poll(async () => page.locator('.sticky-toolbar').evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThan(0);
    await expect.poll(async () => page.locator(`#qe-toolbar-${scope}`).evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThan(64);
    const visibleInputs = await page.locator(`${table} input[data-field="title"]`).evaluateAll(inputs => inputs.filter(el => {
      const r = el.getBoundingClientRect();
      return r.top > 120 && r.bottom < innerHeight && document.elementFromPoint(r.x + 10, r.y + 10) === el;
    }).length);
    expect(visibleInputs).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: test.info().outputPath(`${scope}-short.png`) });
  });

  test(`C02/UX-19 ${scope}: pending quick edits guard view switching and expose field errors`, async ({ page }) => {
    const { writes } = await open(page, scope);
    await page.locator(`#${scope}-inline-edit`).click();
    const progress = page.locator(`${table} input[data-field="progress"]`).first();
    await expect(progress).toHaveAccessibleName(/Прогресс.*TASK-/);
    await progress.fill('101');
    await expect(progress).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator(`#qe-error-${scope}`)).not.toBeEmpty();
    await progress.fill('15');
    await expect(page.locator(`#qe-undo-${scope}`)).toHaveAccessibleName('Отменить последнее изменение');
    await page.getByRole('button', { name: 'Карточное представление', exact: true }).click();
    await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
    await expect(page.locator(table)).toBeVisible();
    await expect(progress).toHaveValue('15');
    await page.getByRole('button', { name: 'Карточное представление', exact: true }).click();
    await page.getByRole('button', { name: 'Сохранить и выйти', exact: true }).click();
    await expect(page.locator(`${container} .task-card`)).not.toHaveCount(0);
    await expect(page.locator(`#qe-toolbar-${scope}`)).toBeHidden();
    expect(writes).toHaveLength(1);
  });
}

test('UX-07/08: mobile tab arrows share the tab strip and every panel has the active name', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApp(page);
  await page.goto('/#/team-backlog?task=41');
  await expect(page.locator('#task-tab-main')).toBeVisible();
  const tabs = await page.locator('#tabs').boundingBox();
  const arrow = await page.locator('.tabs-scroll-right').boundingBox();
  expect(arrow.y).toBeGreaterThanOrEqual(tabs.y - 1);
  expect(arrow.y + arrow.height).toBeLessThanOrEqual(tabs.y + tabs.height + 1);
  for (const tab of ['com', 'sys', 'rep', 'log', 'main']) {
    await page.locator(`#task-tab-${tab}`).click();
    await expect(page.locator('#mbody')).toHaveAttribute('aria-labelledby', `task-tab-${tab}`);
  }
  await page.screenshot({ path: test.info().outputPath('mobile-tabs.png') });
});

test('UX-09/16: empty DMB gives useful guidance and reversed ranges have inline errors', async ({ page }) => {
  await open(page);
  await page.locator('#f-backlog-search').fill('нет совпадений');
  await expect(page.locator('#tasks-container')).toContainText('Измените условия поиска или сбросьте фильтры.');
  await page.locator('#f-backlog-reset').click();
  for (const [key, from, to] of [['progress', '90', '10'], ['date_received', '2026-10-12', '2026-10-01']]) {
    await page.locator('#btn-ext-backlog').click();
    await page.locator(`.filter-catalog-item [data-filter-key="${key}"] button`).click();
    const dialog = page.locator('.filter-dropdown');
    const first = dialog.locator('input[type="number"], input[type="date"]').first();
    const last = dialog.locator('input[type="number"], input[type="date"]').last();
    await first.fill(from); await last.fill(to);
    await dialog.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(dialog.locator('.fd-error')).toBeVisible();
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('aria-invalid', 'true');
    await first.fill(to);
    await dialog.getByRole('button', { name: 'Применить', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.locator('#f-backlog-reset').click();
  }
});

test('C01: concurrent editors show a version conflict and retain the second draft', async ({ context, page }) => {
  const { writes } = await mockApp(context, { conflict: true });
  const other = await context.newPage();
  for (const tab of [page, other]) {
    await tab.goto('/#/team-backlog?task=41');
    await tab.getByRole('button', { name: 'Редактировать', exact: true }).click();
  }
  await page.locator('[data-k="progress"]').fill('20');
  await other.locator('[data-k="progress"]').fill('25');
  await page.locator('#saveBtn').click();
  await expect.poll(() => writes.length).toBe(1);
  await other.locator('#saveBtn').click();
  await expect(other.getByRole('alertdialog', { name: 'Конфликт версий' })).toBeVisible();
  await other.locator('#cc-btn-cancel').click();
  await expect(other.locator('[data-k="progress"]')).toHaveValue('25');
  expect(writes).toHaveLength(1);
});

test('C01: a 409 without conflict details leaves a visible error and retains draft', async ({ page }) => {
  await mockApp(page);
  await page.route('**/api/v1/tasks/41', route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 409, contentType: 'application/json', body: '{}' }) : route.fallback());
  await page.goto('/#/team-backlog?task=41');
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  await page.locator('[data-k="progress"]').fill('25');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#card-form-error-summary')).toContainText('Сохранение не выполнено');
  await expect(page.locator('[data-k="progress"]')).toHaveValue('25');
});

test('UX-19: bulk selection and progress have names, empty changes have a persistent error', async ({ page }) => {
  await open(page, 'team');
  await page.locator('#team-bulk-open').click();
  await page.locator('[data-team-operation="bulk"]').click();
  const bulk = page.locator('#bulk-modal-overlay');
  await expect(bulk.locator('.bc-cb').first()).toHaveAccessibleName(/Выбрать TASK-/);
  await bulk.locator('#bc-next').click();
  await bulk.locator('#bc-next').click();
  await expect(bulk.locator('#bc-error')).toContainText('Добавьте хотя бы одно поле');
  await bulk.locator('#bc-add-field').click();
  await bulk.locator('.bc-field-option[data-field="progress"]').click();
  await expect(bulk.locator('.bc-field-val[data-field="progress"]')).toHaveAccessibleName(/Прогресс/);
});

test('C02: saved card view asks about pending changes and discard does not write', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('dmb_saved_views_v1_backlog', JSON.stringify({ items: [{
    id: 'cards', name: 'Карточки для аудита', state: { toolbar: { search: '', filters: {} }, page: { view: 'cards' } },
  }] })));
  const { writes } = await open(page);
  await page.locator('#backlog-inline-edit').click();
  await page.locator('#tasks-table input[data-field="title"]').first().fill('Несохранённый заголовок');
  await page.locator('#backlog-saved-view-trigger').click();
  await page.getByRole('button', { name: 'Карточки для аудита', exact: true }).click();
  await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await expect(page.locator('#tasks-table')).toBeVisible();
  await expect(page.locator('#tasks-table input[data-field="title"]').first()).toHaveValue('Несохранённый заголовок');
  await page.locator('#backlog-saved-view-trigger').click();
  await page.getByRole('button', { name: 'Карточки для аудита', exact: true }).click();
  await page.getByRole('button', { name: 'Выйти без сохранения', exact: true }).click();
  await expect(page.locator('#tasks-container .task-card')).toHaveCount(3);
  await expect(page.locator('#qe-toolbar-backlog')).toBeHidden();
  expect(writes).toHaveLength(0);
});
