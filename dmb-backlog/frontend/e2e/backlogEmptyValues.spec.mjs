import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
for(const [route,scope] of [['backlog','backlog'],['team-backlog','team']])test('empty status and priority stay empty: '+scope,async({page})=>{
 const {tasks}=await mockApp(page);for(const task of tasks){task.status_name=null;task.status=null;task.status_id=null;task.priority_name=null;task.priority=null;task.priority_id=null;}
 await page.goto('/#/'+route);
 const rows=page.locator('tbody tr[data-task-id]');await expect(rows.first()).toBeVisible();
 await expect(rows.first()).not.toContainText('СБОР ТРЕБОВАНИЙ');await expect(rows.first()).not.toContainText('СРЕДНИЙ');
 await page.locator('#'+scope+'-view-toggle-group [data-view="cards"]').click();
 await expect(page.locator('.task-card').first()).toBeVisible();await expect(page.locator('.task-card').first()).not.toContainText('СРЕДНИЙ');await expect(page.locator('.task-card').first()).not.toContainText('СБОР ТРЕБОВАНИЙ');
});
