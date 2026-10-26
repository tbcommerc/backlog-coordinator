import { test, expect } from '@playwright/test';
import { mockApp } from './helpers/backlogMock.mjs';

test('global import failure gets focus and replacement clears old report', async ({ page }) => {
 await mockApp(page);
 await page.route('**/api/v1/tasks/import', route => route.fulfill({json:{total:1,created:0,skipped:1,errors:[{row:null,message:'Изменения отменены',fatal:true}]}}));
 await page.goto('/#/team-backlog');
 await page.locator('#team-import-excel').click();
 const input=page.locator('#import-file-input');
 await input.setInputFiles({name:'first.csv',mimeType:'text/csv',buffer:Buffer.from('title;team_id\nЗадача;Продукт')});
 await page.locator('#import-submit-btn').click();
 const result=page.locator('#import-result');
 await expect(result).toContainText('Ошибка импорта:');
 await expect(result).not.toContainText('Строка null');
 await expect(result).toBeFocused();
 await expect(page.locator('#import-download-report')).toBeVisible();
 await input.setInputFiles({name:'empty.csv',mimeType:'text/csv',buffer:Buffer.from('')});
 await expect(result).toBeHidden();
 await expect(page.locator('#import-result-content')).toBeEmpty();
 await expect(page.locator('#import-submit-btn')).toBeDisabled();
});

test('missing headers explain the header position without CSV-only wording', async ({ page }) => {
 await mockApp(page);await page.goto('/#/team-backlog');await page.locator('#team-import-excel').click();
 await page.locator('#import-file-input').setInputFiles({name:'headers.csv',mimeType:'text/csv',buffer:Buffer.from('description\nОписание')});
 await expect(page.getByText('Не найдена обязательная колонка "Название задачи"', {exact:false})).toContainText('первая строка файла или первого листа Excel');
 await expect(page.locator('#import-submit-btn')).toBeDisabled();
});

for (const partial of [false, true]) {
 test('result and downloadable report persist until explicit close: partial=' + partial, async ({page}) => {
  await mockApp(page);
  await page.route('**/api/v1/tasks/import', route => route.fulfill({json:{total:partial?2:1,created:1,skipped:partial?1:0,errors:partial?[{row:3,message:'Нет команды',fatal:true}]:[]}}));
  await page.goto('/#/team-backlog');await page.locator('#team-import-excel').click();
  await expect(page.locator('#import-drop-zone')).toContainText('только первый лист');
  await page.locator('#import-file-input').setInputFiles({name:'tasks.csv',mimeType:'text/csv',buffer:Buffer.from('title;team_id\nЗадача;Продукт')});
  await page.locator('#import-submit-btn').click();
  const result=page.locator('#import-result');
  await expect(result).toBeFocused();
  await expect(result).toHaveAttribute('role','status');
  await expect(result).toHaveAttribute('aria-live','polite');
  await page.waitForTimeout(1800);
  await expect(result).toBeVisible();
  const downloadPromise=page.waitForEvent('download');
  await page.locator('#import-download-report').click();
  const download=await downloadPromise;
  const stream=await download.createReadStream();let report='';for await (const chunk of stream) report+=chunk.toString('utf8');
  expect(report).toContain('Импортировано: 1');
  expect(report).toContain('tasks.csv');
  if(partial) expect(report).toContain('Нет команды');
  await page.locator('#import-cancel-btn').click();
  await expect(result).toHaveCount(0);
 });
}
