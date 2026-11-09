import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
test('import preview warns about unsafe cells and clears warnings for valid boundary values',async({page})=>{
 await mockApp(page);await page.goto('/#/team-backlog');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await page.locator('#backlog-import-excel').click();
 const input=page.locator('#import-file-input');
 await input.setInputFiles({name:'invalid.csv',mimeType:'text/csv',buffer:Buffer.from('title;team_id;financial_effect;effort_days;did_demo\n'+'Я'.repeat(256)+';Продукт;-1;10001;perhaps')});
 const errors=page.locator('#import-row-errors');
 await expect(errors).toContainText('255');await expect(errors).toContainText('Демо ДИД');
 await expect(errors.locator('li')).toHaveCount(4);
 await input.setInputFiles({name:'valid.csv',mimeType:'text/csv',buffer:Buffer.from('title;team_id;financial_effect;effort_days;did_demo\n'+'Я'.repeat(255)+';Продукт;0;10000;нет')});
 await expect(errors).toBeHidden();await expect(page.locator('#import-submit-btn')).toBeEnabled();
});
