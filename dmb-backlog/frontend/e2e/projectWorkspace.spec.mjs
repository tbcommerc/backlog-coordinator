import {test,expect} from '@playwright/test';
import {workspace,management} from './fixtures/projectData.js';

export async function setup(page,hash='#/work-projects?project=1&year=2026') {
 const queries=[];
 await page.route('**/api/v1/**',async route=>{
  const url=new URL(route.request().url());queries.push(url);
  let data={items:[],total:0,page:1,summary:{total:0,active:0,done:0,overdue:0,in_acceptance:0}};
  if(url.pathname.endsWith('/options'))data={projects:[{id:1,name:'Развитие платформы'}],teams:[{id:10,name:'Команда'}],users:[],can_create:false};
  if(url.pathname.endsWith('/workspace'))data=workspace();
  if(url.pathname.endsWith('/management')){data=management();data.milestones=[data.items[0]];data.attention=[data.items[0]];}
  if(url.pathname.endsWith('/tasks/7/plan'))data=route.request().method()==='PUT'?{version:3}:management().items[0];
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

test('results interval, history and metric evidence',async({page})=>{
 const queries=await setup(page,'#/work-projects?project=1&section=results&year=2026');
 await expect(page.getByText('Согласовано',{exact:true})).toBeVisible();
 await page.getByLabel('Год',{exact:true}).fill('2024');
 await page.getByLabel('Период',{exact:true}).selectOption('2');
 await page.getByRole('button',{name:'Применить',exact:true}).click();
 await page.getByRole('link',{name:'Изменения плана 1',exact:true}).click();
 await expect(page.getByText('II квартал',{exact:true})).toBeVisible();
 expect(queries.filter(x=>x.pathname.endsWith('/results')).at(-1).searchParams.get('quarter')).toBe('2');
 expect(queries.filter(x=>x.pathname.endsWith('/results')).at(-1).searchParams.get('year')).toBe('2024');
 await page.getByRole('link',{name:'Метрики 1',exact:true}).click();
 await expect(page.getByRole('link',{name:'Скорость процесса'})).toHaveAttribute('href','#/metrics/2');
 await expect(page.getByRole('cell',{name:'7 дней',exact:true})).toBeVisible();
 await page.goBack();await expect(page.locator('.project-result-type[aria-current=page]')).toContainText('Изменения плана');
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
