import { test, expect } from '@playwright/test';
import { mockApp } from './helpers/backlogMock.mjs';

test('UX-39 server rejection stays in bulk form and never applies changes', async ({ page }) => {
  await mockApp(page);
  let writes = 0;
  await page.route('**/api/v1/tasks/bulk', route => { writes++; return route.fulfill({json:{}}); });
  await page.route('**/api/v1/tasks/bulk/preview', route => route.fulfill({
    status:422, json:{detail:[{loc:['body','progress'],msg:'Прогресс должен быть целым числом от 0 до 100',type:'value_error'}]}
  }));
  await page.goto('/#/team-backlog');
  await page.locator('#team-bulk-open').click();
  await page.locator('[data-team-operation="bulk"]').click();
  const bulk=page.locator('#bulk-modal-overlay');
  await bulk.locator('#bc-next').click();
  await bulk.locator('#bc-add-field').click();
  await bulk.locator('.bc-field-option[data-field="progress"]').click();
  await bulk.locator('.bc-field-val[data-field="progress"]').fill('101');
  await bulk.locator('#bc-next').click();
  await expect(bulk.locator('#bc-error')).toContainText('Прогресс');
  await expect(bulk).toBeVisible();
  expect(writes).toBe(0);
});

test('IMP-01 UTF16 BOM with blank prefix and multiline preview', async ({page}) => {
  await mockApp(page);
  await page.goto('/#/team-backlog');
  await page.locator('#team-import-excel').click();
  await page.locator('#import-file-input').setInputFiles({
    name:'utf16.csv', mimeType:'text/csv',
    buffer:Buffer.from('\ufeff\r\n  \r\ntitle;team_id;description\r\nТест;Продукт;"строка1\r\nстрока2"', 'utf16le')
  });
  await expect(page.locator('#import-preview-tbody tr')).toHaveCount(1);
  await expect(page.locator('#import-preview-tbody')).toContainText('строка1');
  await expect(page.locator('#import-preview-tbody')).toContainText('строка2');
  await expect(page.locator('#import-submit-btn')).toBeEnabled();
});

test('IMP-02 technical headers expose all invalid cell warnings', async ({page}) => {
  await mockApp(page);
  await page.goto('/#/team-backlog');
  await page.locator('#team-import-excel').click();
  await page.locator('#import-file-input').setInputFiles({
    name:'invalid.csv', mimeType:'text/csv',
    buffer:Buffer.from('title;team_id;date_received;progress;financial_effect\n;Продукт;2026-02-30;101;bad')
  });
  const errors=page.locator('#import-row-errors');
  await expect(errors).toBeVisible();
  await expect(errors).toContainText('обязательно');
  await expect(errors).toContainText('даты');
  await expect(errors).toContainText('прогресса');
  await expect(errors).toContainText('числовой');
});
