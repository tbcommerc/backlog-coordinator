import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
test('metadata and failed-only export exclude successful warning rows',async({page})=>{
 await mockApp(page);await page.route('**/api/v1/tasks/import',r=>r.fulfill({json:{total:2,created:1,skipped:1,errors:[{row:2,fatal:false,message:'Неизвестный заказчик'},{row:3,fatal:true,message:'Нет команды'}]}}));
 await page.goto('/#/team-backlog');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await page.locator('#backlog-import-excel').click();const input=page.locator('#import-file-input');
 await input.setInputFiles({name:'source.csv',mimeType:'text/csv',buffer:Buffer.from('title;team_id;unknown\nSUCCESS;Продукт;x\n"FAILED;quoted";Missing;y')});
 const details=page.locator('#import-file-details');await expect(details).toContainText('UTF-8');await expect(details).toContainText('Всего строк: 2');await expect(details).toContainText('unknown → игнорируется');
 await page.locator('#import-submit-btn').click();await expect(page.locator('#import-submit-btn')).toBeDisabled();
 const pending=page.waitForEvent('download');await page.locator('#import-retry-download').click();const stream=await (await pending).createReadStream();let text='';for await(const chunk of stream)text+=chunk.toString('utf8');
 expect(text).toContain('FAILED;quoted');expect(text).not.toContain('SUCCESS');expect(text).toContain('"title";"team_id"');
 await input.setInputFiles({name:'fixed.csv',mimeType:'text/csv',buffer:Buffer.from('title;team_id\nFIXED;Продукт')});await expect(page.locator('#import-submit-btn')).toBeEnabled();await expect(page.locator('#import-result')).toBeHidden();
});
test('global rollback never guesses failed rows',async({page})=>{
 await mockApp(page);await page.route('**/api/v1/tasks/import',r=>r.fulfill({json:{total:1,created:0,skipped:1,errors:[{row:null,fatal:true,message:'Rollback'}]}}));
 await page.goto('/#/team-backlog');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await page.locator('#backlog-import-excel').click();await page.locator('#import-file-input').setInputFiles({name:'a.csv',mimeType:'text/csv',buffer:Buffer.from('title;team_id\nA;B')});await page.locator('#import-submit-btn').click();await expect(page.locator('#import-result')).toBeVisible();await expect(page.locator('#import-retry-download')).toHaveCount(0);await expect(page.locator('#import-submit-btn')).toBeDisabled();
});