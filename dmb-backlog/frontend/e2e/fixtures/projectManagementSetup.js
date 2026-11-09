import {expect} from '@playwright/test';
import {workspace,management} from './projectData.js';

export async function setup(page,hash='#/work-projects?project=1&year=2026&quarter=4') {
 const queries=[];
 await page.route('**/api/v1/**',async route=>{
  const url=new URL(route.request().url());queries.push(url);
  let data={items:[],total:0,page:1,summary:{total:0,active:0,done:0,overdue:0,in_acceptance:0}};
  if(url.pathname.endsWith('/options'))data={projects:[{id:1,name:'Развитие платформы'}],teams:[{id:10,name:'Команда'}],users:[],can_create:false};
  if(url.pathname.endsWith('/workspace'))data=workspace();
  if(url.pathname.endsWith('/management')){data=management();data.milestones=[data.items[0]];data.attention=[data.items[0]];}
  if(url.pathname.endsWith('/tasks/7/plan'))data=route.request().method()==='PUT'?{version:3}:management().items[0];
  if(url.pathname.endsWith('/results'))data={page:1,total:1,items:url.searchParams.get('kind')==='metrics'?[{id:2,title:'Скорость процесса',period:'2026',unit:'дней',previous_fact:10,target:5,summary:{fact:7,measured_on:'2026-06-01'}}]:[{id:7,title:'Улучшение процесса',public_id:'TASK-7',before:'I квартал',after:'II квартал',changed_at:'2026-04-01',completed_at:'2026-04-01',result:'Согласовано'}]};
  await route.fulfill({json:data});
 });
 await page.goto('/e2e/fixtures/workTasks.html');
 await expect(page.locator('html')).toHaveAttribute('data-work-fixture-ready','true');
 await page.addScriptTag({url:'/static/js/lib/lucide.min.js'});
 await page.evaluate(async hash=>{
  history.replaceState(null,'',hash);
  const m=await import('/static/js/components/workProjects.js');
  window.renderProjects=async()=>{document.querySelector('main').innerHTML=m.renderWorkProjects();await m.initWorkProjects(window.app);};
  window.addEventListener('hashchange',window.renderProjects);await window.renderProjects();
 },hash);
 return queries;
}
