import { test, expect } from '@playwright/test';

test('split submits all parts atomically and keeps errors editable', async ({ page }) => {
  let saved;
  await page.route('**/api/v1/**', async route => {
    const url=new URL(route.request().url());let data={};
    if(url.pathname.endsWith('/work-tasks/options'))data={can_create:true,teams:[{id:10,name:'Команда'}],users:[],projects:[]};
    else if(url.pathname.endsWith('/admin/task-types') || url.pathname.endsWith('/admin/channels'))data=[];
    else if(url.pathname.endsWith('/work-targets'))data={items:[{id:11,public_id:'WRK-11',title:'Первая работа'},{id:12,public_id:'WRK-12',title:'Вторая работа'}]};
    else if(url.pathname.endsWith('/split')){saved=route.request().postDataJSON();data={};}
    else data={items:[],total:0,summary:{total:0,done:0,overdue:0,in_acceptance:0}};
    await route.fulfill({json:data});
  });
  await page.goto('/e2e/fixtures/workTasks.html');await expect(page.locator('html')).toHaveAttribute('data-work-fixture-ready','true');
  await page.evaluate(async()=>{const m=await import('/static/js/components/workResolution.js');await m.openWorkResolution(window.app,{id:7,version:0,title:'Запрос',team_id:10});});
  await page.locator('#wr-decision').selectOption('link_work');
  await page.locator('#wr-target').selectOption('11');await page.locator('#wr-scope').fill('Первая часть');
  await page.getByRole('button',{name:'Добавить часть запроса',exact:true}).click();
  await page.locator('#wr-target').selectOption('12');await page.locator('#wr-scope').fill('Вторая часть');
  await page.getByRole('button',{name:'Подтвердить размещение',exact:true}).click();
  await expect(page.locator('dialog')).toHaveCount(0);
  expect(saved.parts.map(x=>x.target_id)).toEqual([11,12]);expect(saved.version).toBe(0);
});

test('report distinguishes missing historical snapshot from zero and renders saved state on mobile',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.route('**/api/v1/**',async route=>{
    const url=new URL(route.request().url());let data;
    if(url.pathname.endsWith('/work-tasks/options'))data={can_create:true,teams:[{id:10,name:'Команда'}],users:[],projects:[]};
    else if(url.pathname.endsWith('/reporting-meetings'))data=[{id:1,kind:'team_weekly',scheduled_date:'2026-10-15'},{id:2,kind:'team_weekly',scheduled_date:'2026-10-08'}];
    else if(url.pathname.endsWith('/work-reports'))data=url.searchParams.get('meeting_id')==='2'?{available:false,message:'Для этой встречи снимок рабочих задач не зафиксирован'}:{available:true,mode:url.searchParams.has('meeting_id')?'snapshot':'live',as_of:'2026-10-16',summary:{total:1,active:0,done:1,overdue:0,blocked:0,in_acceptance:0,proposals:0},items:[{id:1,title:'Готовый результат',status:'done',due_date:null,result_text:'Принято'}],major_summary:null};
    else data={items:[],total:0,summary:{total:0,done:0,overdue:0,in_acceptance:0}};
    await route.fulfill({json:data});
  });
  await page.goto('/e2e/fixtures/workTasks.html');await expect(page.locator('html')).toHaveAttribute('data-work-fixture-ready','true');
  await page.evaluate(async()=>{const m=await import('/static/js/components/workReports.js');document.querySelector('main').innerHTML=m.renderWorkReports();await m.initWorkReports(window.app);});
  await expect(page.getByText('Готовый результат',{exact:false})).toBeVisible();
  await page.locator('#work-report-meeting').selectOption('1');await expect(page.getByText(/Неизменяемый снимок/)).toBeVisible();
  await page.locator('#work-report-meeting').selectOption('2');await expect(page.getByText(/снимок рабочих задач не зафиксирован/)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
