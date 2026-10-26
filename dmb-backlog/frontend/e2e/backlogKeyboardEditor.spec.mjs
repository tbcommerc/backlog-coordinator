import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
for(const route of ['backlog','team-backlog'])test('table task opens using keyboard: '+route,async({page})=>{
 const {writes}=await mockApp(page);await page.goto('/#/'+route);const link=page.locator('tr[data-task-id="41"] a[href="#/'+route+'?task=41"]');await expect(link).toHaveAccessibleName(/Открыть задачу:/);await link.focus();await expect(link).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#task-detail-overlay')).toBeVisible();expect(writes).toHaveLength(0);
});
async function open(page){await page.goto('/e2e/fixtures/taskCardIncrement.html#/tasks?task=42');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');}
test('full editor names department, DID client and financial effect',async({page})=>{
 await open(page);await page.getByRole('button',{name:'Редактировать',exact:true}).click();await expect(page.locator('select[data-k="customerDeptId"]')).toHaveAccessibleName('Подразделение заказчика');await expect(page.locator('select[data-k="didClientId"]')).toHaveAccessibleName('Клиент ДИД');await expect(page.locator('input[data-k="finEffect"]')).toHaveAccessibleName('Финансовый эффект');
});
for(const inline of [false,true])test('rejected sync is offered again: inline='+inline,async({page})=>{
 await page.route('**/e2e/fixtures/taskCardIncrement.html',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace("statuses: [{ id: 8, name: 'В работе' }]","statuses: [{ id: 8, name: 'В работе' }, { id: 9, name: 'ВЫПОЛНЕНА' }]")});});
 await open(page);await page.evaluate(()=>{window.syncWrites=[];window.app.api.patch=async(url,payload)=>{window.syncWrites.push(payload);return {};};});if(inline)await page.locator('[data-inline-edit="status"]').click();else await page.getByRole('button',{name:'Редактировать',exact:true}).click();
 await page.locator('[data-k="status"]').selectOption('ВЫПОЛНЕНА');
 const dialog=page.getByRole('alertdialog',{name:'Согласовать статус и прогресс'});await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Оставить как есть',exact:true}).click();
 for(let i=0;i<2;i++){await page.locator('#saveBtn').click();await expect(dialog).toBeVisible();await dialog.getByRole('button',{name:'Оставить как есть',exact:true}).click();}
 await page.locator('#saveBtn').click();await expect(dialog).toContainText('черновике');await expect(dialog).toContainText('Затем нажмите');await dialog.getByRole('button',{name:'Изменить',exact:true}).click();if(!inline)await expect(page.locator('[data-k="progress"]')).toHaveValue('100');expect(await page.evaluate(()=>window.syncWrites.length)).toBe(0);await page.locator('#saveBtn').click();await expect.poll(()=>page.evaluate(()=>window.syncWrites.length)).toBe(1);expect(await page.evaluate(()=>window.syncWrites[0])).toMatchObject({progress:100,status_id:9});
});
