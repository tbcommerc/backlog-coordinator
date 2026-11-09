import {test,expect}from '@playwright/test';import{mockApp}from './helpers/backlogMock.mjs';
for(const scope of ['all','team'])test(`BU-E01/E08/E09: ${scope} saves only changed fields and keeps context`,async({page})=>{
 const {writes}=await mockApp(page);await page.goto('/#/backlog?scope='+scope);await expect(page.locator('#tasks-table tbody tr[data-task-id]')).toHaveCount(scope==='team'?2:3);
 await page.locator('#f-backlog-search').fill('уникальное описание');await expect(page.locator('#tasks-count')).toHaveText('Найдено: 1 задача');
 await page.locator('#backlog-inline-edit').click();await page.locator('#tasks-table input[data-field="title"]').fill('Новая редакция');
 await page.locator('#qe-save-backlog').click();await page.getByRole('button',{name:'ОК',exact:true}).click();
 await expect(page.locator('#qe-toolbar-backlog')).toBeHidden();expect(writes).toEqual([{title:'Новая редакция',version:1}]);await expect(page.locator('#f-backlog-search')).toHaveValue('уникальное описание');await expect(page).toHaveURL(new RegExp('scope='+scope));
});
test('BU-E03: dirty cancel keeps URL, draft and scope',async({page})=>{
 await mockApp(page);await page.goto('/#/backlog?scope=all');await expect(page.locator('#tasks-table')).toBeVisible();await page.locator('#backlog-inline-edit').click();await page.locator('input[data-task="41"][data-field="title"]').fill('Черновик');
 await page.locator('[data-backlog-scope="team"]').click();await expect(page.locator('#qe-exit-confirm-overlay')).toBeVisible();await page.getByRole('button',{name:'Продолжить редактирование',exact:true}).click();await expect(page).toHaveURL(/scope=all/);await expect(page.locator('input[data-task="41"][data-field="title"]')).toHaveValue('Черновик');
});
test('BU-O13/O14/O16: complete filtered CSV uses visible columns and ignores selection',async({page})=>{
 await mockApp(page,{count:101});await page.goto('/#/backlog?scope=all');await expect(page.locator('#tasks-count')).toHaveText('Найдено: 101 задача');
 await page.locator('#backlog-select-all').check();await expect(page.locator('#backlog-selected-count')).toHaveText('101');
 const download=page.waitForEvent('download');await page.locator('#backlog-export-excel').click();const result=await download;expect(result.suggestedFilename()).toMatch(/backlog_all_.*\.csv/);const stream=await result.createReadStream();let text='';for await(const chunk of stream)text+=chunk.toString('utf8');expect(text.split('\r\n').filter(Boolean)).toHaveLength(102);
});
test('BU-S05: saved view survives reload in its own context',async({page})=>{
 await mockApp(page);await page.goto('/#/backlog?scope=team');await expect(page.locator('#tasks-table')).toBeVisible();await page.locator('#f-backlog-search').fill('Первая');await expect(page.locator('#tasks-count')).toHaveText('Найдено: 1 задача');await page.locator('#backlog-saved-view-save').click();await page.locator('#backlog-saved-view-name').fill('Командный поиск');await page.locator('#backlog-saved-view-confirm').click();await expect(page.locator('#backlog-saved-view-label')).toHaveText('Командный поиск');await page.reload();await expect(page.locator('#tasks-table')).toBeVisible();await page.locator('#backlog-saved-view-trigger').click();await expect(page.getByRole('button',{name:'Командный поиск',exact:true})).toBeVisible();
});
