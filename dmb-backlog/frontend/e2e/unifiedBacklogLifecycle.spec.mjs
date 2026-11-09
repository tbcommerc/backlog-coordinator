import{test,expect}from '@playwright/test';import{mockApp}from './helpers/backlogMock.mjs';
const profiles=[
 ['team editor',{team_id:7,permissions:{backlog_dmb:'read',backlog_team:'write_own',task_edit:'team'}},'all',3],
 ['team only',{team_id:7,permissions:{backlog_dmb:'none',backlog_team:'write_own',task_edit:'team'}},'',2],
 ['no team',{team_id:null,permissions:{backlog_dmb:'read',backlog_team:'read_own',task_edit:'none'}},'team',0],
 ['no access',{team_id:7,permissions:{backlog_dmb:'none',backlog_team:'none',task_edit:'all'}},'all',0],
 ['unknown capability',{team_id:7,permissions:{backlog_dmb:'read',backlog_team:'read_own',task_edit:'unknown'}},'all',3],
 ['team write_all is not global read',{team_id:7,permissions:{backlog_dmb:'none',backlog_team:'write_all',task_edit:'team'}},'',2],
];
for(const [name,profile,scope,count]of profiles)test('BU-A01/A02/A03/A05/A07/A08/A09 '+name,async({page})=>{
 await mockApp(page);const u={id:101,name:'Профиль',role_name:'BA/Участник команды',team_name:'Продукт',...profile};let listCalls=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/v1/tasks/')listCalls++;});await page.route('**/api/v1/auth/me',r=>r.fulfill({json:u}));await page.goto('/#/backlog'+(scope?'?scope='+scope:''));
 if(count){await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await expect(page.locator('#tasks-table tbody tr[data-task-id]')).toHaveCount(count);if(profile.permissions.task_edit==='team'){await expect(page.locator('tr[data-task-id="41"] input[type="checkbox"]')).toHaveCount(1);await expect(page.locator('tr[data-task-id="43"] input[type="checkbox"]')).toHaveCount(0);}else await expect(page.locator('#backlog-inline-edit')).toBeDisabled();}
 else{await expect(page.getByRole('heading',{name:/Область недоступна|Команда не назначена/})).toBeVisible();expect(listCalls).toBe(0);}
});
test('BU-R10: back and forward restore same-scope search and pages',async({page})=>{
 await mockApp(page,{count:101});await page.goto('/#/backlog?bv=2&scope=all');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await page.locator('#pagination [data-page="2"][data-page-action="number"]').click();await expect(page).toHaveURL(/page=2/);await page.goBack();await expect(page).not.toHaveURL(/page=2/);await expect(page.locator('#tasks-table tbody tr[data-task-id]')).toHaveCount(100);await page.goForward();await expect(page.locator('#tasks-table tbody tr[data-task-id]')).toHaveCount(1);
});
test('BU-D15: twenty context changes do not multiply list loads',async({page})=>{
 test.setTimeout(120000);await mockApp(page);let calls=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/v1/tasks/')calls++;});await page.goto('/#/backlog?scope=all');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
 for(let i=0;i<20;i++){const scope=i%2?'all':'team';await page.locator('[data-backlog-scope="'+scope+'"]').click();await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await expect(page.locator('#tasks-table tbody tr[data-task-id]')).toHaveCount(scope==='team'?2:3);}
 expect(calls).toBe(21);
});
test('BU-D05: rapid ABA only commits the newest context',async({page})=>{
 await mockApp(page);await page.goto('/#/backlog?scope=all');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await page.route('**/api/v1/tasks/?*',async r=>{await new Promise(resolve=>setTimeout(resolve,150));try{await r.fallback();}catch{}});
 await page.evaluate(()=>{location.hash='/backlog?scope=team';setTimeout(()=>{location.hash='/backlog?scope=all';},20);setTimeout(()=>{location.hash='/backlog?scope=team';},40);});await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await expect(page.locator('[data-backlog-scope="team"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#tasks-table tbody tr[data-task-id]')).toHaveCount(2);await page.waitForTimeout(300);await expect(page.locator('#tasks-table tbody tr[data-task-id]')).toHaveCount(2);
});
test('BU-E14/D13: realtime refresh preserves quick-edit input',async({page})=>{
 await mockApp(page);await page.goto('/#/backlog?scope=all');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await page.locator('#backlog-inline-edit').click();const input=page.locator('[data-task="41"][data-field="title"]');await input.fill('Нельзя терять');await page.evaluate(()=>window.app.router.refreshCurrentRoute());await expect(input).toHaveValue('Нельзя терять');await expect(page.locator('#backlog-stale')).toBeVisible();
});
