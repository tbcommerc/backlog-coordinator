import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
for(const route of ['backlog','team-backlog'])test('direct task route opens card: '+route,async({page})=>{
 await mockApp(page);await page.goto('/#/'+route+'?task=41');await expect(page.locator('#task-detail-overlay')).toBeVisible();await expect(page.getByRole('button',{name:'Редактировать',exact:true})).toBeVisible();
});
for(const status of [403,404])test('unavailable direct task explains failure: '+status,async({page})=>{
 await mockApp(page);await page.route('**/api/v1/tasks/999',r=>r.fulfill({status,json:{detail:'fixture'}}));await page.goto('/#/team-backlog?task=999');await expect(page.getByText('Не удалось открыть задачу: она удалена или недоступна',{exact:true})).toBeVisible();await expect(page).not.toHaveURL(/task=999/);await expect(page.locator('#task-detail-overlay')).toHaveCount(0);
});
for(const scope of ['backlog','team'])test('quick save confirmation names one change: '+scope,async({page})=>{
 const {writes}=await mockApp(page);await page.goto('/#/'+(scope==='team'?'team-backlog':'backlog'));await page.locator('#backlog-inline-edit').click();await page.locator('input[data-field="title"]').first().fill('Черновик');await page.locator('#qe-save-backlog').click();await expect(page.getByText('Будет сохранено 1 изменение. Продолжить?',{exact:true})).toBeVisible();expect(writes).toHaveLength(0);
});
