import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { mockApp } from './helpers/backlogMock.mjs';

// Decode actual downloads, including quoted newlines and semicolons.
function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (ch === ';' && !quoted) { row.push(cell); cell = ''; }
    else if (ch === '\n' && !quoted) { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

for (const scope of ['backlog', 'team']) {
  const route = scope === 'team' ? 'team-backlog' : 'backlog';
  const table = scope === 'team' ? '#team-tasks-table' : '#tasks-table';
  test(`${scope}: search entered during initial loading is retained`, async ({ page }) => {
    await mockApp(page);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/v1/tasks/?*', async route => { await gate; await route.fallback(); });
    await page.goto(`/#/${route}`);
    await page.locator(`#f-${scope}-search`).fill('уникальное описание');
    release();
    await expect(page.locator(`${table} tbody tr[data-task-id]`)).toHaveCount(1);
    await expect(page.locator(`#f-${scope}-search`)).toHaveValue('уникальное описание');
  });

  test(`${scope}: CSV download matches filtered rows, labels and escaped text`, async ({ page }) => {
    const { tasks } = await mockApp(page);
    tasks[0].title = 'Экспорт; "кавычки"\nвторая строка';
    await page.goto(`/#/${route}`);
    await page.locator(`#f-${scope}-search`).fill('уникальное описание');
    await expect(page.locator(`${table} tbody tr[data-task-id]`)).toHaveCount(1);
    const pending = page.waitForEvent('download');
    await page.locator(`#${scope}-export-excel`).click();
    const file = await pending;
    const bytes = await fs.readFile(await file.path());
    expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
    const rows = parseCsv(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveLength(rows[0].length);
    const values = Object.fromEntries(rows[0].map((key, index) => [key, rows[1][index]]));
    expect(values.ID).toBe('TASK-000-041');
    expect(rows[1]).toContain(tasks[0].title);
    expect(rows[1]).toContain('В РАБОТЕ');
    if (scope === 'backlog') expect(rows[1]).toContain('Продукт');
  });

  for (const failure of ['offline', 'timeout', 'server']) test(`${scope}: ${failure} load can recover without losing search`, async ({ page }) => {
    await mockApp(page);
    await page.goto(`/#/${route}`);
    await page.locator(`#f-${scope}-search`).fill('уникальное описание');
    await expect(page.locator(`${table} tbody tr[data-task-id]`)).toHaveCount(1);
    const pattern = '**/api/v1/tasks/?*';
    const fail = request => failure === 'server' ? request.fulfill({ status: 503, contentType: 'application/json', body: '{"detail":"temporary failure"}' }) : request.abort(failure === 'timeout' ? 'timedout' : 'internetdisconnected');
    await page.route(pattern, fail);
    await page.locator(`#${scope}-btn-refresh`).click();
    await expect(page.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
    await page.unroute(pattern, fail);
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(page.locator(`${table} tbody tr[data-task-id]`)).toHaveCount(1);
    await expect(page.locator(`#f-${scope}-search`)).toHaveValue('уникальное описание');
  });

  test(`${scope}: saved default survives reload and can be removed`, async ({ page }) => {
    await mockApp(page);
    await page.goto(`/#/${route}`);
    await page.locator(`#f-${scope}-search`).fill('уникальное описание');
    await page.locator(`#${scope}-saved-view-save`).click();
    await page.locator(`#${scope}-saved-view-name`).fill('Проверка приёмки');
    await page.locator(`#${scope}-saved-view-default`).check();
    await page.locator(`#${scope}-saved-view-confirm`).click();
    await page.reload();
    await expect(page.locator(`#f-${scope}-search`)).toHaveValue('уникальное описание');
    await expect(page.locator(`${table} tbody tr[data-task-id]`)).toHaveCount(1);
    await page.locator(`#f-${scope}-search`).fill('Вторая задача');
    await page.locator(`#${scope}-saved-view-trigger`).click();
    await page.getByRole('button', {name:'Обновить текущими настройками',exact:true}).click();
    await page.locator('[data-feedback-confirm]').click();
    await page.reload();
    await expect(page.locator(`#f-${scope}-search`)).toHaveValue('Вторая задача');
    await page.locator(`#${scope}-saved-view-trigger`).click();
    await page.getByRole('button', { name: 'Удалить представление Проверка приёмки', exact: true }).click();
    await page.getByRole('button', { name: 'Удалить', exact: true }).click();
    await page.reload();
    await expect(page.locator(`${table} tbody tr[data-task-id]`)).toHaveCount(scope === 'team' ? 2 : 3);
    await expect(page.locator(`#f-${scope}-search`)).toHaveValue('');
  });
}

test('import CSV template has equal column counts and preserves list examples', async ({ page }) => {
  await mockApp(page);
  await page.goto('/#/team-backlog');
  await page.locator('#team-import-excel').click();
  const pending = page.waitForEvent('download');
  await page.locator('#download-template-link').click();
  const file = await pending;
  const rows = parseCsv((await fs.readFile(await file.path(), 'utf8')).replace(/^\uFEFF/, ''));
  expect(rows).toHaveLength(2);
  expect(rows[1]).toHaveLength(rows[0].length);
  expect(rows[1]).toContain('1;2');
  expect(rows[1]).toContain('https://jira.example.com/ABC-1;https://jira.example.com/ABC-2');
});

test('no-team profile has an explanation and no task mutation controls', async ({ page }) => {
  await mockApp(page);
  await page.route('**/api/v1/auth/me', route => route.fulfill({json: {id:101,name:'Без команды',team_id:null,role_name:'BA/Участник команды',permissions:{backlog_team:'read_own',backlog_dmb:'read'}}}));
  await page.goto('/#/team-backlog');
  await expect(page.getByText('Команда не назначена', {exact:true})).toBeVisible();
  await expect(page.locator('#team-inline-edit')).toHaveCount(0);
});

for (const file of ['03_valid_cp1251_semicolon.csv','37_length_and_injection.csv','40_valid_minimal.xlsx','44_valid_spreadsheetml_2003.xls','26_quoted_multiline.csv','39_partial_success.csv','51_exactly_10000_rows.csv']) test(`import preview: ${file}`, async ({page}) => {
  await mockApp(page);
  await page.goto('/#/team-backlog');
  await page.locator('#team-import-excel').click();
  await page.locator('#import-file-input').setInputFiles(`../docs/dev-testing/evidence/import-testing-2026-09-20/inputs/${file}`);
  await expect(page.locator('#import-preview-section')).toBeVisible();
  await expect(page.locator('#import-submit-btn')).toBeEnabled();
  if (file.startsWith('26')) {
    await expect(page.locator('#import-preview-tbody tr')).toHaveCount(1);
    await expect(page.locator('#import-preview-tbody')).toContainText('line 1\nline 2');
  }
  if (file.startsWith('39')) await expect(page.locator('#import-row-errors')).toBeVisible();
  if (file.startsWith('51')) await expect(page.locator('#import-preview-tbody tr')).toHaveCount(5);
});

test('import valid to broken to empty to valid cannot submit stale preview', async ({page}) => {
  await mockApp(page);
  await page.goto('/#/team-backlog');
  await page.locator('#team-import-excel').click();
  const input=page.locator('#import-file-input');
  const valid={name:'valid.csv',mimeType:'text/csv',buffer:Buffer.from('title;team_id\nТест;Продукт')};
  await input.setInputFiles(valid);
  await expect(page.locator('#import-submit-btn')).toBeEnabled();
  await input.setInputFiles({name:'broken.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('bad')});
  await expect(page.locator('#import-error-summary')).toBeVisible();
  await expect(page.locator('#import-preview-section')).toBeHidden();
  await expect(page.locator('#import-submit-btn')).toBeDisabled();
  await input.setInputFiles({name:'empty.csv',mimeType:'text/csv',buffer:Buffer.from('')});
  await expect(page.locator('#import-error-summary')).toContainText('Файл не содержит строк задач');
  await expect(page.locator('#import-submit-btn')).toBeDisabled();
  await input.setInputFiles(valid);
  await expect(page.locator('#import-submit-btn')).toBeEnabled();
  await expect(page.locator('#import-error-summary')).toBeHidden();
});
