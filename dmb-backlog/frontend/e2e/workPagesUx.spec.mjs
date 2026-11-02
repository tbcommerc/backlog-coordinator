import { workspace } from './fixtures/projectData.js';
import { test, expect } from '@playwright/test';
const refs={can_create:true,teams:[{id:10,name:'Команда платформы'}],users:[{id:1,name:'Исполнитель',team_id:10}],projects:[{id:1,name:'Развитие платформы'},{id:2,name:'Второй проект'}]};
const task={id:1,public_id:'WRK-1',title:'Подготовить требования к интеграции',assignee_name:'Исполнитель',status:'in_progress',due_date:'2026-10-25',context:{title:'Развитие платформы'}};
const summary={total:1,done:0,overdue:0,in_acceptance:0};
const report={available:true,mode:'live',as_of:'2026-10-17',summary:{...summary,active:1,blocked:1,proposals:0},items:[{...task,blocked_reason:'Ожидаем спецификацию',result_text:'Согласована первая редакция'}],major_summary:{obligations:46,with_external_links:2},major_items:Array.from({length:46},(_,i)=>({id:i+1,public_id:`TASK-${i+1}`,title:`Интеграция платформы — этап ${i+1}`,work:{total:3,done:1,overdue:i===0?1:0,blocked:0,in_acceptance:0},external_links:0}))};
async function setup(page,handler){
 await page.route('**/api/v1/**',async route=>{const url=new URL(route.request().url());if(url.pathname.endsWith('/workspace'))return route.fulfill({json:workspace(refs.projects.find(p=>p.id===Number(url.pathname.split('/').at(-2))))});if(url.pathname.endsWith('/projects'))return route.fulfill({json:{items:refs.projects,total:2,page:1}});if(handler && await handler(route,url))return;const data=url.pathname.endsWith('/options')?refs:url.pathname.endsWith('/reporting-meetings')?[]:url.pathname.endsWith('/work-reports')?report:url.pathname.endsWith('/major-tasks')?{total:2,items:report.major_items.slice(0,2)}:{total:1,items:[task],summary};await route.fulfill({json:data});});
 await page.goto('/e2e/fixtures/workTasks.html');await expect(page.locator('.work-table')).toBeVisible();
}
async function navigate(page,name,project=''){await page.evaluate(async ({name,project})=>{history.replaceState(null,'',name==='Projects'?'#/work-projects'+(project?'?section=execution&project='+project:''):'#/work-tasks');const m=await import(`/static/js/components/work${name}.js`);document.querySelector('main').innerHTML=m[`renderWork${name}`]();await m[`initWork${name}`](window.app);},{name,project});}

test('filters apply as a set, Enter searches and reset clears conditions',async({page})=>{
 const queries=[];await setup(page,async(route,url)=>{if(url.pathname.endsWith('/work-tasks'))queries.push(url.searchParams);return false;});
 await expect(page.getByRole('button',{name:'Создать задачу'})).toHaveClass(/btn-primary/);await expect(page.locator('.work-pagination')).toHaveCount(0);
 await page.getByRole('button',{name:'Дополнительные фильтры'}).click();await page.locator('#work-direction').selectOption('product');await page.getByRole('button',{name:'Применить',exact:true}).click();await expect.poll(()=>queries.at(-1).get('work_direction')).toBe('product');
 await page.getByRole('button',{name:'Дополнительные фильтры'}).click();await page.locator('#work-team').selectOption('10');await page.getByRole('button',{name:'Применить',exact:true}).click();await expect.poll(()=>queries.at(-1).get('execution_team_id')).toBe('10');await page.locator('#work-search').fill('Интеграция');await page.locator('#work-search').press('Enter');await expect.poll(()=>queries.at(-1).get('q')).toBe('Интеграция');
 await page.getByRole('button',{name:'Сброс',exact:true}).click();await expect.poll(()=>queries.at(-1).get('execution_team_id')).toBeNull();await expect(page.locator('#work-search')).toHaveValue('');
});
test('empty state, retry and readonly permission',async({page})=>{
 await setup(page);let fail=true;await page.route('**/api/v1/work-tasks?**',route=>fail?route.fulfill({status:503,json:{detail:'Попробуйте позже'}}):route.fulfill({json:{total:0,items:[],summary:{total:0,done:0,overdue:0,in_acceptance:0}}}));
 await page.getByRole('button',{name:'Дополнительные фильтры'}).click();
 await page.locator('#work-status').selectOption('done');await page.getByRole('button',{name:'Применить',exact:true}).click();await expect(page.getByText('Не удалось загрузить задачи')).toBeVisible();fail=false;await page.getByRole('button',{name:'Повторить',exact:true}).click();await expect(page.getByText('Задачи не найдены по условиям')).toBeVisible();await page.getByRole('button',{name:'Сбросить условия',exact:true}).click();await expect(page.getByText('Вам пока не назначены задачи')).toBeVisible();await page.getByRole('button',{name:'Показать все доступные',exact:true}).click();await expect(page.getByText('Рабочих задач пока нет')).toBeVisible();await expect(page.locator('.work-pagination')).toHaveCount(0);
 await page.route('**/api/v1/work-tasks/options',route=>route.fulfill({json:{...refs,can_create:false}}));await navigate(page,'Tasks');await expect(page.getByRole('button',{name:'Создать задачу'})).toBeHidden();
});
test('project selection, view, create context and clearing',async({page})=>{
 const queries=[];let creation;await setup(page,async(route,url)=>{if(route.request().method()==='POST'){creation=route.request().postDataJSON();await route.fulfill({json:{...task,...creation}});return true;}if(url.pathname.endsWith('/work-tasks'))queries.push(url.searchParams);return false;});
 await navigate(page,'Projects');await expect(page.getByLabel('Поиск проекта')).toBeVisible();await navigate(page,'Projects','1');await expect(page.locator('#work-view')).toHaveValue('all');await expect.poll(()=>queries.at(-1).get('effective_project_id')).toBe('1');await page.locator('#work-view').selectOption('mine');await expect.poll(()=>queries.at(-1).get('view')).toBe('mine');
 await page.getByRole('button',{name:'Создать задачу'}).click();await expect(page.locator('#wf-direct_project_id')).toHaveValue('1');await page.locator('#wf-title').fill('Новая задача проекта');await page.getByRole('button',{name:'Создать',exact:true}).click();await page.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);expect(creation.direct_project_id).toBe(1);
 await navigate(page,'Projects');await expect(page.getByLabel('Поиск проекта')).toBeVisible();const before=queries.length;await page.evaluate(()=>document.dispatchEvent(new Event('dmb:work-changed')));expect(queries.length).toBe(before);
});
test('old project responses cannot replace the current project',async({page})=>{
 await setup(page);await navigate(page,'Projects');let release;const gate=new Promise(resolve=>{release=resolve;});await page.route('**/api/v1/projects/1/major-tasks?*',async route=>{await gate;await route.fulfill({json:{total:1,items:[{id:99,public_id:'OLD',title:'Устаревший проект'}]}});});await navigate(page,'Projects','1');await navigate(page,'Projects','2');await expect(page.locator('.work-project-obligation').first()).toBeVisible();release();await expect(page.locator('#work-project-major')).not.toContainText('Устаревший проект');
});
test('report pages and search preserve aggregates',async({page})=>{
 await setup(page);await navigate(page,'Reports');const list=page.locator('[data-report-list="obligations"]');await expect(list.locator('tbody tr')).toHaveCount(20);await list.getByRole('button',{name:'Далее'}).click();await expect(list).toContainText('TASK-21');await expect(list.getByRole('button',{name:'Далее'})).toBeFocused();await list.getByRole('button',{name:'Далее'}).click();await expect(list.locator('tbody tr')).toHaveCount(6);await page.locator('#work-report-search').fill('TASK-46');await expect(list.locator('tbody tr')).toHaveCount(1);await expect(page.getByRole('heading',{name:'Задачи бэклога 46'})).toBeVisible();await expect(list.locator('.work-pagination')).toHaveCount(0);await page.locator('#work-report-search').fill('Нет такой задачи');await expect(list.getByText('Ничего не найдено')).toBeVisible();
});
for(const width of [1440,390])for(const theme of ['light','dark'])test(`three pages fit ${width} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:1000});await setup(page);await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);for(const name of ['Tasks','Projects','Reports']){await navigate(page,name,name==='Projects'?'1':'');if(name==='Projects'){if(width<=900)await page.locator('.project-structure-disclosure > summary').click();await expect(page.locator('.work-project-obligation').first()).toBeVisible();}if(name==='Tasks')await page.getByRole('button',{name:'Дополнительные фильтры'}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/work-${name}-${theme}-${width}.png`,fullPage:true});}
});

test('embedded work list keeps unique labels and collapsed filters',async({page})=>{
 await setup(page);
 await page.evaluate(async()=>{
  const root=document.createElement('section');root.id='embedded-work';document.querySelector('main').append(root);
  const {mountWorkList}=await import('/static/js/components/workTasks.js');await mountWorkList(root,window.app,94);
 });
 const embedded=page.locator('#embedded-work');
 await expect(embedded.locator('#work-94-view').locator('..')).toBeHidden();
 await expect(embedded.locator('#work-94-extra-filters')).toBeHidden();
 await expect(embedded.getByLabel('Статус',{exact:true})).toHaveCount(1);
 await embedded.getByRole('button',{name:'Дополнительные фильтры'}).click();
 await expect(embedded.getByLabel('Команда',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(x=>x.id);return ids.length===new Set(ids).size;})).toBe(true);
});
