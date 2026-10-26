import { test, expect } from '@playwright/test';

async function setup(page, hash = '') {
 const queries=[];
 await page.route('**/api/v1/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/options')) return route.fulfill({json:{can_create:false,teams:[{id:10,name:'Разработка'},{id:20,name:'Аналитика'}],users:[],projects:[]}});
  queries.push(url.searchParams);
  return route.fulfill({json:{items:[{id:1,public_id:'WRK-1',title:'Подготовить результат',status:'in_progress',assignee_name:'Иван'}],total:1,collection_counts:{mine:3,acceptance:2,requested:4,team:6,all:9},summary:{total:9,overdue:2,blocked:1,unassigned:1,in_acceptance:2,active:7,done:2}}});
 });
 await page.goto('/e2e/fixtures/workTasks.html'+hash);
 await expect(page.getByRole('heading',{name:'Рабочие задачи',exact:true})).toBeVisible();
 return queries;
}

test('collections, shared team/search, summary drilldown and reload retain scope',async({page})=>{
 const queries=await setup(page);
 await page.getByRole('button',{name:'Я поручил · 4',exact:true}).click();
 await expect.poll(()=>queries.at(-1)?.get('view')).toBe('requested');
 await page.getByRole('button',{name:'Дополнительные фильтры'}).click();
 await page.locator('#work-team').selectOption('20');
 await page.getByRole('button',{name:'Применить',exact:true}).click();
 await page.locator('#work-search').fill('результат');await page.locator('#work-search').press('Enter');
 await page.getByRole('button',{name:'Сводка',exact:true}).click();
 await expect(page.locator('.work-table')).toHaveCount(0);
 await page.getByRole('button',{name:'Просрочены · 2',exact:true}).click();
 await expect(page.locator('.work-table')).toBeVisible();
 expect(queries.at(-1).get('execution_team_id')).toBe('20');
 expect(queries.at(-1).get('q')).toBe('результат');expect(queries.at(-1).get('view')).toBe('requested');expect(queries.at(-1).get('overdue')).toBe('true');
 await page.reload();await expect(page.locator('.work-table')).toBeVisible();
 expect(queries.at(-1).get('execution_team_id')).toBe('20');expect(queries.at(-1).get('overdue')).toBe('true');
 await page.getByRole('button',{name:'Сбросить',exact:true}).click();
 expect(queries.at(-1).get('execution_team_id')).toBeNull();expect(queries.at(-1).get('overdue')).toBeNull();
});

test('review defaults, deadline sorting and compact mobile collection persist',async({page})=>{
 const queries=await setup(page);
 expect(queries.at(-1).get('status')).toBe('active');
 expect(queries.at(-1).get('sort')).toBe('attention');
 await expect(page.locator('#work-view')).toBeHidden();
 await page.locator('#work-sort').selectOption('due');
 await page.locator('#work-search').fill('WRK-1');await page.locator('#work-search').press('Enter');
 await page.reload();
 await expect(page.locator('#work-sort')).toHaveValue('due');
 await expect(page.locator('#work-search')).toHaveValue('WRK-1');
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('#work-view')).toBeVisible();
 await expect(page.locator('#work-status')).toBeHidden();
 expect((await page.locator('tbody tr').first().boundingBox()).y).toBeLessThan(400);
 await page.getByRole('button',{name:'Сводка',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Ближайшие действия'})).toBeVisible();
 await expect(page.locator('.work-priority-list')).toContainText('Подготовить результат');
});

for (const [metric,param,value] of [['Есть препятствие · 1','blocked','true'],['Без исполнителя · 1','unassigned','true'],['Ожидают приёмки · 2','status','in_acceptance'],['Выполнены · Не включены','status','done'],['Активные · 7','status','active'],['Всего · 9','view','all']]) test(`summary ${metric} opens matching list`,async({page})=>{
 const queries=await setup(page,'#/work-tasks?display=summary&view=all');
 await page.getByRole('button',{name:metric,exact:true}).click();
 await expect(page.locator('.work-table')).toBeVisible();expect(queries.at(-1).get(param)).toBe(value);
 await expect(page.getByRole('button',{name:'Список',exact:true})).toHaveAttribute('aria-pressed','true');
});

test('quick filters toggle, counts select collection and keyboard controls work',async({page})=>{
 const queries=await setup(page);
 await page.getByRole('button',{name:'Мне принять · 2',exact:true}).click();
 expect(queries.at(-1).get('view')).toBe('acceptance');
 await page.getByRole('button',{name:'Дополнительные фильтры',exact:true}).click();
 const quick=page.locator('[data-attention-draft=blocked]');
 await quick.focus();await page.keyboard.press('Space');await page.getByRole('button',{name:'Применить',exact:true}).click();expect(queries.at(-1).get('blocked')).toBe('true');
 await page.locator('[data-remove-attention=blocked]').click();expect(queries.at(-1).get('blocked')).toBeNull();
});

test('drilldown intersects quick filters and survives refresh',async({page})=>{
 const queries=await setup(page,'#/work-tasks?display=summary&view=all&attention=overdue');
 await page.getByRole('button',{name:'Есть препятствие · 1',exact:true}).click();
 expect(queries.at(-1).get('overdue')).toBe('true');expect(queries.at(-1).get('blocked')).toBe('true');
 await page.reload();await expect(page.locator('.work-table')).toBeVisible();
 expect(queries.at(-1).get('overdue')).toBe('true');expect(queries.at(-1).get('blocked')).toBe('true');
});

test('real router redirects old report without opening major task modal',async({page})=>{
 const queries=await setup(page);
 await page.goto('/e2e/fixtures/workWorkspaceRouter.html#/work-reports?task=12&team_id=10');
 await expect(page.getByRole('heading',{name:'Состояние задач',exact:true})).toBeVisible();
 expect(queries.at(-1).get('major_task_id')).toBe('12');expect(queries.at(-1).get('execution_team_id')).toBe('10');
 await expect(page.locator('dialog')).toHaveCount(0);
 await expect(page.locator('.sidebar-item[href="#/work-reports"]')).toHaveCount(0);
 await expect(page.locator('.sidebar-item[href="#/work-tasks"]')).toHaveText('Рабочие задачи');
});

test('snapshot link cannot silently show live data for an absent meeting',async({page})=>{
 await setup(page);const requests=[];
 await page.route('**/api/v1/reporting-meetings?**',route=>route.fulfill({json:[]}));
 await page.route('**/api/v1/work-reports?**',route=>{requests.push(new URL(route.request().url()).searchParams.get('meeting_id'));return route.fulfill({json:{available:false,message:'Для этой встречи снимок не зафиксирован'}});});
 await page.goto('/e2e/fixtures/workWorkspaceRouter.html#/work-reports?meeting_id=77');
 await expect(page.getByText('Для этой встречи снимок не зафиксирован')).toBeVisible();expect(requests).toEqual(['77']);
 await page.evaluate(()=>{location.hash='/work-reports?meeting_id=78';});
 await expect.poll(()=>requests.at(-1)).toBe('78');
 await expect(page.locator('#work-report-meeting')).toHaveValue('78');
});

test('direct task URL opens card, retains URL and reloads list after saving',async({page})=>{
 const queries=await setup(page);let saved;
 const row={id:1,public_id:'WRK-1',title:'Прямая задача',description:'Ожидаемый результат',execution_team_id:10,status:'ready',can_edit:true,version:1,available_actions:[]};
 await page.route('**/api/v1/work-tasks/1',route=>{
  if(route.request().method()==='PATCH'){saved=route.request().postDataJSON();Object.assign(row,saved);}
  return route.fulfill({json:row});
 });
 await page.goto('/e2e/fixtures/workWorkspaceRouter.html#/work-tasks/1?view=all');
 await expect(page.locator('#wf-title')).toHaveValue('Прямая задача');
 expect(new URL(page.url()).hash).toContain('/work-tasks/1?');const before=queries.length;
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('dmb:work-changed')));
 await expect.poll(()=>queries.length).toBeGreaterThan(before);
 expect(new URL(page.url()).hash).toContain('/work-tasks/1?');
 await page.getByRole('button',{name:'Редактировать',exact:true}).click();
 await page.locator('#wf-title').fill('Обновлённая задача');await page.getByRole('button',{name:'Сохранить изменения'}).click();
 await expect(page.locator('.work-dialog-inline')).toBeVisible();expect(saved.title).toBe('Обновлённая задача');
 await expect.poll(()=>queries.length).toBeGreaterThan(before);expect(new URL(page.url()).hash).toContain('/work-tasks/1?');
 await expect(page.locator('.work-card-title')).toHaveText('Обновлённая задача');
});

test('task browser history restores selection without mutations',async({page})=>{
 await setup(page);let writes=0;
 await page.route('**/api/v1/work-tasks/1',route=>{if(route.request().method()!=='GET')writes++;return route.fulfill({json:{id:1,public_id:'WRK-1',title:'Карточка из истории',status:'ready',version:1,available_actions:[]}});});
 await page.goto('/e2e/fixtures/workWorkspaceRouter.html#/work-tasks?view=all');
 await page.addStyleTag({content:'#page-content{margin-left:250px}'});
 await page.locator('[data-work-id="1"]').click();await expect(page.locator('.work-card-title')).toHaveText('Карточка из истории');
 await page.goBack();await expect(page.locator('.work-dialog')).toHaveCount(0);
 await page.goForward();await expect(page.locator('.work-card-title')).toHaveText('Карточка из истории');expect(writes).toBe(0);
});

test('same-page URL navigation reapplies collection, summary and filters',async({page})=>{
 const queries=await setup(page);
 await page.goto('/e2e/fixtures/workWorkspaceRouter.html#/work-tasks?view=mine');
 await expect(page.locator('.work-table')).toBeVisible();
 await page.evaluate(()=>{location.hash='/work-tasks?display=summary&view=requested&team=20&attention=overdue';});
 await expect(page.getByRole('heading',{name:'Состояние задач',exact:true})).toBeVisible();
 expect(queries.at(-1).get('view')).toBe('requested');expect(queries.at(-1).get('execution_team_id')).toBe('20');expect(queries.at(-1).get('overdue')).toBe('true');
});

test('closed work does not show pending assignment or active obstacle flags',async({page})=>{
 await setup(page);
 await page.route('**/api/v1/work-tasks?**',route=>route.fulfill({json:{items:[{id:1,public_id:'WRK-1',title:'Закрытое поручение',status:'cancelled',assignment_state:'proposed',blocked_reason:'Старое препятствие'}],total:1,summary:{total:1}}}));
 await page.locator('[data-work-collection="all"]').click();await expect(page.locator('.work-table')).toContainText('Отменена');
 await expect(page.locator('.work-table')).not.toContainText('Ожидает принятия');await expect(page.locator('.work-table')).not.toContainText('Есть блокер');
});

test('overlapping customer redirects still render a destination',async({page})=>{
 await setup(page);await page.goto('/e2e/fixtures/workWorkspaceRouter.html#/work-tasks?view=mine');
 await expect(page.locator('.work-table')).toBeVisible();
 await page.evaluate(async()=>{
  const router=window.app.router;
  window.app.store.get=()=>({id:35,permissions:{customer_portal_mode:'only'}});
  router.routes['/customer']={render:async()=>{await Promise.resolve();return '<h1>Мои запросы</h1>';}};
  router.lastHash=null;router.renderedPath=null;document.getElementById('page-content').innerHTML='';
  history.replaceState(null,'','#/work-tasks');
  await Promise.all([router.handleRoute(),router.handleRoute()]);
 });
 await expect(page.getByRole('heading',{name:'Мои запросы',exact:true})).toBeVisible();
});

test('URL navigation closes old work dialog without restoring stale route',async({page})=>{
 await setup(page);
 await page.route('**/api/v1/work-tasks/1',route=>route.fulfill({json:{id:1,public_id:'WRK-1',title:'Прямая задача',execution_team_id:10,status:'ready',can_edit:true,version:1,available_actions:[]}}));
 await page.goto('/e2e/fixtures/workWorkspaceRouter.html#/work-tasks/1');
 await page.getByRole('button',{name:'Редактировать',exact:true}).click();
 await expect(page.locator('#wf-title')).toBeVisible();await page.locator('#wf-title').fill('Сохранить черновик навигации');
 await page.evaluate(()=>{location.hash='/work-tasks?view=acceptance';});
 await expect(page.locator('dialog')).toHaveCount(0);await expect(page.locator('[data-work-collection="acceptance"]')).toHaveAttribute('aria-pressed','true');
 await page.evaluate(()=>{location.hash='/work-tasks/1';});
 await expect(page.locator('.work-dialog-inline')).toBeVisible();await expect(page.locator('#wf-title')).toHaveValue('Сохранить черновик навигации');
});

for(const width of [390,1440])for(const theme of ['light','dark'])test(`workspace list/summary fits ${width} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:800});await setup(page);
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 for(const mode of ['Список','Сводка']){
  await page.getByRole('button',{name:mode,exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`${theme}-${width}-${mode}.png`),fullPage:true});
 }
});
