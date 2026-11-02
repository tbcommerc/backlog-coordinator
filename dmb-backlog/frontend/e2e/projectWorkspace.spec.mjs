import {test,expect} from '@playwright/test';
import {workspace} from './fixtures/projectData.js';

async function setup(page,hash='#/work-projects?project=1&year=2026') {
 const queries=[];
 await page.route('**/api/v1/**',async route=>{
  const url=new URL(route.request().url());queries.push(url);
  let data={items:[],total:0,page:1,summary:{total:0,active:0,done:0,overdue:0,in_acceptance:0}};
  if(url.pathname.endsWith('/options'))data={projects:[{id:1,name:'Развитие платформы'}],teams:[{id:10,name:'Команда'}],users:[],can_create:false};
  if(url.pathname.endsWith('/workspace'))data=workspace();
  if(url.pathname.endsWith('/backlog'))data={page:1,total:1,items:[{id:7,public_id:'TASK-7',title:'Улучшение процесса',deadline:'2026',status:'В работе'}]};
  if(url.pathname.endsWith('/results'))data={page:1,total:1,items:url.searchParams.get('kind')==='metrics'?[{id:2,title:'Скорость процесса',period:'2026',unit:'дней',previous_fact:10,target:5,summary:{fact:7,measured_on:'2026-06-01'}}]:[{id:7,title:'Улучшение процесса',public_id:'TASK-7',before:'I квартал',after:'II квартал',changed_at:'2026-04-01',completed_at:'2026-04-01',result:'Согласовано'}]};
  await route.fulfill({json:data});
 });
 await page.goto('/e2e/fixtures/workTasks.html');
 await expect(page.locator('html')).toHaveAttribute('data-work-fixture-ready','true');
 await page.evaluate(async hash=>{
  history.replaceState(null,'',hash);
  const m=await import('/static/js/components/workProjects.js');
  window.renderProjects=async()=>{document.querySelector('main').innerHTML=m.renderWorkProjects();await m.initWorkProjects(window.app);};
  window.addEventListener('hashchange',window.renderProjects);await window.renderProjects();
 },hash);
 return queries;
}

for(const width of [320,1440])test(`four sections and task planning context at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});const queries=await setup(page);
 await expect(page.getByRole('tab',{selected:true})).toHaveText('Обзор');
 await expect(page.getByRole('tab')).toHaveText(['Обзор','Задачи','Рабочие задачи','Метрики']);
 await expect(page.getByRole('heading',{name:'О направлении'})).toBeVisible();
 await expect(page.locator('#work-projects-page .toolbar-subtitle')).toHaveCount(0);
 await expect(page.locator('.project-signal')).toHaveCount(6);
 const signals=await page.locator('.project-signals').evaluate(el=>({height:el.getBoundingClientRect().height,edges:[...el.querySelectorAll('strong')].map(n=>Math.round(n.getBoundingClientRect().right))}));
 expect(signals.height).toBeLessThan(400);
 expect(new Set(signals.edges).size).toBe(1);
 await page.screenshot({path:`test-results/project-about-compact-${width}.png`,fullPage:true});
 await page.getByRole('tab',{name:'Задачи',exact:true}).click();
 await expect(page.locator('.project-plan-card')).toHaveCount(6);
 await expect(page.locator('.ui-page-header .project-return .ui-badge')).toHaveAttribute('data-ui-tone','success');
 await expect(page.getByRole('link',{name:'TASK-7 · Улучшение процесса'})).toBeVisible();
 expect(await page.locator('.project-plan-grid').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(width>1100?56:170);
 expect(await page.locator('.project-backlog-table').evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(width>1100?500:760);
 await page.screenshot({path:`test-results/project-planning-compact-${width}.png`,fullPage:true});
 await page.locator('.project-plan-card').filter({hasText:'Без квартала'}).click();
 await expect.poll(()=>queries.filter(x=>x.pathname.endsWith('/backlog')).at(-1)?.searchParams.get('bucket')).toBe('annual');
 await expect(page.locator('#project-bucket')).toHaveValue('annual');
 await expect(page.locator('[data-project-bucket="annual"]')).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('link',{name:'TASK-7 · Улучшение процесса'})).toHaveAttribute('href',/bucket=annual.*task=7/);
 await page.getByRole('tab',{name:'Рабочие задачи',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Все рабочие задачи',exact:true})).toBeVisible();
 await page.goBack();await expect(page.getByRole('tab',{selected:true})).toHaveText('Задачи');
 for(const name of ['Обзор','Рабочие задачи','Метрики']){
  await page.getByRole('tab',{name,exact:true}).click();await expect(page.getByRole('tab',{selected:true})).toHaveText(name);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
});

test('results interval, history and metric evidence',async({page})=>{
 const queries=await setup(page,'#/work-projects?project=1&section=results&year=2026');
 await expect(page.getByText('Согласовано',{exact:true})).toBeVisible();
 await page.getByLabel('Год',{exact:true}).fill('2024');
 await page.getByLabel('Период результатов',{exact:true}).selectOption('2');
 await page.getByLabel('Показать результаты',{exact:true}).selectOption('moves');
 await page.getByRole('button',{name:'Показать',exact:true}).click();
 await expect(page.getByText('II квартал',{exact:true})).toBeVisible();
 expect(queries.filter(x=>x.pathname.endsWith('/results')).at(-1).searchParams.get('quarter')).toBe('2');
 expect(queries.filter(x=>x.pathname.endsWith('/results')).at(-1).searchParams.get('year')).toBe('2024');
 await page.getByLabel('Показать результаты',{exact:true}).selectOption('metrics');
 await page.getByRole('button',{name:'Показать',exact:true}).click();
 await expect(page.getByRole('link',{name:'Скорость процесса'})).toHaveAttribute('href','#/metrics/2');
 await expect(page.getByRole('cell',{name:'7 дней',exact:true})).toBeVisible();
 await page.goBack();await expect(page.getByLabel('Показать результаты',{exact:true})).toHaveValue('moves');
});

test('metrics are a dedicated section and legacy planning opens tasks',async({page})=>{
 const queries=await setup(page,'#/work-projects?project=1&section=planning&year=2026&bucket=2');
 await expect(page.getByRole('tab',{selected:true})).toHaveText('Задачи');
 await expect(page.locator('#project-bucket')).toHaveValue('2');
 await page.getByRole('tab',{name:'Метрики',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Метрики проекта'})).toBeVisible();
 await expect(page.getByLabel('Показать результаты',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'Скорость процесса'})).toBeVisible();
 await page.getByLabel('Период метрик',{exact:true}).selectOption('2');
 await page.getByRole('button',{name:'Показать',exact:true}).click();
 await expect.poll(()=>queries.filter(x=>x.pathname.endsWith('/results')).at(-1)?.searchParams.get('quarter')).toBe('2');
 expect(queries.filter(x=>x.pathname.endsWith('/results')).at(-1).searchParams.get('kind')).toBe('metrics');
 await expect(page.getByRole('tab')).toHaveCount(4);
});

test('workspace error is recoverable and signals clear stale execution filters',async({page})=>{
 await setup(page,'#/work-projects?project=1&wview=mine&wq=old&wt=10&ws=done');
 const target=new URLSearchParams((await page.getByRole('link',{name:'Просрочены 1'}).getAttribute('href')).split('?')[1]);
 expect(Object.fromEntries(target)).toEqual({project:'1',section:'execution',wa:'overdue'});
 await page.route('**/api/v1/projects/1/workspace?*',route=>route.fulfill({status:503,json:{detail:'Временно недоступно'}}));
 await page.getByRole('tab',{name:'Задачи',exact:true}).click();
 await expect(page.getByRole('button',{name:'Повторить'})).toBeVisible();
 await page.unroute('**/api/v1/projects/1/workspace?*');await page.getByRole('button',{name:'Повторить'}).click();
 await expect(page.locator('.project-plan-card')).toHaveCount(6);
});

test('execution restores team and status filters from URL',async({page})=>{
 const queries=await setup(page,'#/work-projects?project=1&section=execution&wt=10&ws=done');
 await expect(page.getByText('Некорректные условия в ссылке')).toHaveCount(0);
 await expect.poll(()=>queries.filter(x=>x.pathname.endsWith('/work-tasks')).at(-1)?.searchParams.get('execution_team_id')).toBe('10');
 expect(queries.filter(x=>x.pathname.endsWith('/work-tasks')).at(-1).searchParams.get('status')).toBe('done');
 await page.getByRole('searchbox',{name:'Поиск в этой очереди'}).fill('integration');
 await page.getByRole('searchbox',{name:'Поиск в этой очереди'}).press('Enter');
 await expect.poll(()=>queries.filter(x=>x.pathname.endsWith('/work-tasks')).at(-1)?.searchParams.get('q')).toBe('integration');
 await page.getByRole('tab',{name:'Обзор',exact:true}).click();
 await page.getByRole('tab',{name:'Рабочие задачи',exact:true}).click();
 await expect(page.getByRole('searchbox',{name:'Поиск в этой очереди'})).toHaveValue('integration');
});
