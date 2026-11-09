import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
const keys=['created_by','financial_effect_justification','key_project_status_updated_at','directorate_status_updated_at','did_status_updated_at','did_demo'];
test('both backlogs display the same populated supplemental fields',async({page})=>{
 await page.addInitScript(keys=>{localStorage.setItem('dmb_backlog_workspace_v2:101',JSON.stringify({schemaVersion:2,userId:101,contexts:Object.fromEntries(['all','team'].map(scope=>[scope,{teamId:7,columns:{settings:Object.fromEntries(keys.map(k=>[k,true]))},views:{items:[],defaultId:null}}]))}));},keys);
 const {tasks}=await mockApp(page);Object.assign(tasks[0],{created_by_name:'Автор проверки',financial_effect_justification:'Обоснование проверки',key_project_status_updated_at:'2026-10-11T10:00:00Z',directorate_status_updated_at:'2026-10-12',did_status_updated_at:'2026-10-13',did_demo:true});
 for(const route of ['backlog','team-backlog']){await page.goto('/#/'+route);const row=page.locator('tr[data-task-id="41"]');for(const value of ['Автор проверки','Обоснование проверки','2026-10-11','2026-10-12','2026-10-13','Да'])await expect(row).toContainText(value);}
});
for(const readonly of [true,false])test('empty team guidance matches creation permission: '+readonly,async({page})=>{
 const {tasks}=await mockApp(page,{readonly});tasks.splice(0);await page.goto('/#/team-backlog');
 for(const view of ['table','cards']){await page.locator('#backlog-view-toggle-group [data-view="'+view+'"]').click();const container=page.locator('#tasks-container');if(readonly){await expect(container).toContainText('Создание задач для вашей роли недоступно');await expect(container).not.toContainText('создайте новую задачу');}else await expect(container).toContainText('создайте новую задачу');}
});
