import { workspace } from './fixtures/projectData.js';
import { test, expect } from '@playwright/test';
async function setup(page, hash='#/work-projects') {
 if(hash.includes('project=')&&!hash.includes('section='))hash+='&section=execution';
 const queries=[];
 await page.route('**/api/v1/**',async route=>{
  const url=new URL(route.request().url()); queries.push(url);
  const projects=[{id:1,name:'Первый проект'},{id:2,name:'Второй проект'}];
  if(url.pathname.endsWith('/workspace')) {
   const id=Number(url.pathname.split('/').at(-2));
   if(!projects.some(p=>p.id===id))return route.fulfill({status:404,json:{detail:'Проект недоступен'}});
   return route.fulfill({json:workspace(projects.find(p=>p.id===id))});
  }
  if(url.pathname.endsWith('/projects')) {
   const filtered=projects.filter(p=>p.name.toLowerCase().includes((url.searchParams.get('q')||'').toLowerCase()));
   return route.fulfill({json:{items:filtered.map(p=>({...p,code:'P'+p.id,backlog_count:1})),total:filtered.length,page:1}});
  }
  const items=[{id:1,public_id:'WRK-1',title:'Прямая задача',status:'new',context:{title:'Проект'}},{id:2,public_id:'WRK-2',title:'Дочерняя задача',status:'done',context:{title:'Обязательство'}}];
  const selected = url.searchParams.has('major_task_id') ? items.slice(1) : url.searchParams.has('direct_project_id') ? items.slice(0,1) : items;
  await route.fulfill({json:url.pathname.endsWith('/options')?{can_create:true,teams:[],users:[],projects:[{id:1,name:'Первый проект'},{id:2,name:'Второй проект'}]}:url.pathname.endsWith('/tasks/7')?{id:7,project_id:1,public_id:'TASK-7',title:'Обязательство'}:url.pathname.endsWith('/major-tasks')?{total:1,items:[{id:7,public_id:'TASK-7',title:'Обязательство'}]}:{items:selected,total:selected.length,summary:{total:selected.length,done:1,overdue:0,in_acceptance:0}}});
 });
 await page.goto('/e2e/fixtures/workTasks.html');
 await expect(page.locator('html')).toHaveAttribute('data-work-fixture-ready','true');
 await page.evaluate(async hash=>{
  window.app.store.get=()=>({id:1,team_id:10,permissions:{task_edit:'all'}});
  const m=await import('/static/js/components/workProjects.js');
  window.renderProjects=async()=>{document.querySelector('main').innerHTML=m.renderWorkProjects();await m.initWorkProjects(window.app);};
  history.replaceState(null,'',hash);
  window.addEventListener('hashchange',window.renderProjects);
  await window.renderProjects();
 },hash);
 return queries;
}
async function choose(page,name){
 const disclosure=page.locator('.project-structure-disclosure');
 if(!await disclosure.evaluate(x=>x.open))await disclosure.locator('summary').click();
 await page.getByRole('navigation',{name:'Выбор работ проекта'}).getByRole('link',{name,exact:true}).click();
}
test('real router switches scope, back and direct link without duplicate lists',async({page})=>{
 const queries=await setup(page,'#/work-projects?project=1');
 await page.evaluate(async()=>{
  window.removeEventListener('hashchange',window.renderProjects);
  const {Router}=await import('/static/js/router.js');
  window.app.router=new Router(window.app);window.app.router.init();
 });
 await expect(page.locator('.work-table')).toBeVisible();
 await choose(page,'Напрямую в проекте');
 await expect(page.locator('#project-work-title')).toHaveText('Напрямую в проекте');
 await expect(page.locator('.work-table')).not.toContainText('Дочерняя задача');
 expect(queries.some(u=>u.searchParams.get('direct_project_id')==='1'&&!u.searchParams.has('effective_project_id'))).toBe(true);
 await choose(page,'TASK-7 Обязательство');
 await expect(page.locator('#project-work-title')).toHaveText('Обязательство');
 await expect(page.locator('.work-table')).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Создать задачу',exact:true})).toHaveCount(1);
 await page.getByRole('button',{name:'Создать задачу',exact:true}).click();
 await expect(page.locator('#wf-major_task_id')).toHaveValue('7');
 await expect(page.locator('#wf-direct_project_id')).toHaveValue('');
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.goBack();
 await expect(page.locator('#project-work-title')).toHaveText('Напрямую в проекте');
 await page.goForward();
 await expect(page.locator('#project-work-title')).toHaveText('Обязательство');
 await expect(page.locator('#work-project-direct')).toContainText('Дочерняя задача');
});
test('foreign obligation never mounts a list or creation action',async({page})=>{
 await setup(page,'#/work-projects?project=2&major=7');
 await expect(page.getByText('Задача бэклога недоступна в этом проекте')).toBeVisible();
 await expect(page.locator('.work-table')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Создать задачу',exact:true})).toHaveCount(0);
});
test('overview fits application sidebar and narrow mobile',async({page})=>{
 for(const width of [1280,1024,320]){
  await page.setViewportSize({width,height:700});
  await setup(page,'#/work-projects?project=1');
  if(width>900)await page.evaluate(()=>{document.querySelector('main').style.marginLeft='248px';});
  await expect(page.locator('.work-table')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const overlaps=await page.locator('.work-filter-panel').evaluate(form=>{
   const boxes=[...form.querySelectorAll('button,input,select')].filter(x=>x.getClientRects().length&&!x.closest('[hidden]')).map(x=>({name:x.getAttribute('aria-label')||x.id||x.textContent,box:x.getBoundingClientRect()}));
   return boxes.flatMap((a,i)=>boxes.slice(i+1).filter(b=>Math.min(a.box.right,b.box.right)-Math.max(a.box.left,b.box.left)>1&&Math.min(a.box.bottom,b.box.bottom)-Math.max(a.box.top,b.box.top)>1).map(b=>[a.name,b.name]));
  });
  expect(overlaps).toEqual([]);
  expect(await page.locator('.work-table tbody tr').first().evaluate(x=>x.getBoundingClientRect().top)).toBeLessThan(650);
  await page.screenshot({path:`test-results/project-shell-${width}.png`,fullPage:true});
 }
});
test('empty project scope preserves placement and readonly access',async({page})=>{
 await setup(page,'#/work-projects?project=1&scope=direct');
 await page.route('**/api/v1/work-tasks/options',route=>route.fulfill({json:{can_create:false,teams:[],users:[],projects:[{id:1,name:'Первый проект'}]}}));
 await page.route('**/api/v1/work-tasks?*',route=>route.fulfill({json:{items:[],total:0,summary:{total:0,done:0,overdue:0,in_acceptance:0}}}));
 await page.evaluate(()=>window.renderProjects());
 await expect(page.getByText('В выбранном разделе пока нет доступных рабочих задач.')).toBeVisible();
 await expect(page.getByRole('button',{name:'Создать задачу',exact:true})).toBeHidden();
 await expect(page.getByRole('button',{name:'Показать все доступные'})).toHaveCount(0);
 await expect(page.locator('#project-work-title')).toHaveText('Напрямую в проекте');
});
test('obligation pagination is independent and selection survives another page',async({page})=>{
 const queries=await setup(page,'#/work-projects?project=1&major=7');
 await page.route('**/api/v1/projects/1/major-tasks?*',route=>{
  const second=new URL(route.request().url()).searchParams.get('page')==='2';
  return route.fulfill({json:{total:31,items:second?[{id:99,public_id:'TASK-99',title:'Последнее обязательство'}]:Array.from({length:30},(_,i)=>({id:i+1,public_id:`TASK-${i+1}`,title:`Обязательство ${i+1}`}))}});
 });
 await page.evaluate(()=>window.renderProjects());
 await expect(page.locator('.work-table')).toBeVisible();
 const calls=queries.filter(u=>u.pathname.endsWith('/work-tasks')).length;
 await page.locator('#work-project-major').getByRole('button',{name:'Далее'}).click();
 await expect(page.locator('#work-project-major')).toContainText('Последнее обязательство');
 await expect(page.locator('[data-selected-major]')).toContainText('TASK-7');
 await expect(page.locator('.work-table')).toHaveCount(1);
 expect(queries.filter(u=>u.pathname.endsWith('/work-tasks')).length).toBe(calls);
 await expect(page.locator('#project-work-title')).toHaveText('Обязательство');
});
test('failed navigation does not hide available project work',async({page})=>{
 await setup(page,'#/work-projects?project=1');
 await page.route('**/api/v1/projects/1/major-tasks?*',route=>route.fulfill({status:503,json:{detail:'Временно недоступно'}}));
 await page.evaluate(()=>window.renderProjects());
 await expect(page.locator('#work-project-major').getByRole('button',{name:'Повторить'})).toBeVisible();
 await expect(page.locator('.work-table')).toContainText('Прямая задача');
 await page.unroute('**/api/v1/projects/1/major-tasks?*');
 await page.locator('#work-project-major').getByRole('button',{name:'Повторить'}).click();
 await expect(page.locator('[data-major="7"]')).toBeVisible();
 await expect(page.locator('.work-table')).toHaveCount(1);
});
test('projects search, navigation, complete selection and creation context',async({page})=>{
 const queries=await setup(page);
 await page.getByLabel('Поиск проекта').fill('Второй');await page.getByLabel('Поиск проекта').press('Enter');
 await expect(page.getByRole('link',{name:'Первый проект'})).toHaveCount(0);
 await page.getByRole('button',{name:'Сбросить',exact:true}).click();
 await expect(page.getByLabel('Поиск проекта')).toHaveValue('');
 await expect(page.getByRole('link',{name:'Первый проект'})).toBeVisible();
 expect(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).has('cq')).toBe(false);
 await expect(page.getByLabel('Поиск проекта')).toBeFocused();
 await page.getByRole('link',{name:'Первый проект'}).click();
 await expect(page.getByRole('heading',{name:'Первый проект',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Рабочие задачи',exact:true}).click();
 await expect(page.locator('#work-project-direct')).toContainText('Дочерняя задача');
 expect(queries.some(u=>u.searchParams.get('effective_project_id')==='1'&&!u.searchParams.has('direct_project_id'))).toBe(true);
 await choose(page,'TASK-7 Обязательство');
 await expect(page.locator('.work-table')).toHaveCount(1);
 await expect(page.locator('#work-project-direct')).toContainText('Дочерняя задача');
 await expect(page.locator('#work-project-direct')).not.toContainText('Прямая задача');
 expect(queries.some(u=>u.searchParams.get('major_task_id')==='7')).toBe(true);
 await choose(page,'Все рабочие задачи');
 await page.locator('#work-project-direct').locator('..').getByRole('button',{name:'Создать задачу',exact:true}).click();
 await expect(page.locator('#wf-direct_project_id')).toHaveValue('1');
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('link',{name:'Все проекты',exact:false}).click();
 await expect(page.getByLabel('Поиск проекта')).toBeVisible();
 await page.goBack();
 await expect(page.getByRole('heading',{name:'Первый проект',exact:true})).toBeVisible();
});
test('unavailable project',async({page})=>{
 await setup(page,'#/work-projects?project=999');
 await expect(page.getByText('Проект недоступен',{exact:true})).toBeVisible();
});
test('project first viewport and retry',async({page})=>{
 await page.setViewportSize({width:1280,height:600});
 await setup(page,'#/work-projects?project=1');
 await expect(page.locator('.work-table')).toBeVisible();
 expect(await page.locator('.work-table tbody tr').first().evaluate(x=>x.getBoundingClientRect().bottom)).toBeLessThan(600);
 await page.route('**/api/v1/projects?*',route=>route.fulfill({status:503,json:{detail:'Ошибка сервиса'}}));
 await page.getByRole('link',{name:'Все проекты',exact:false}).click();
 await expect(page.getByRole('button',{name:'Повторить'})).toBeVisible();
 await page.unroute('**/api/v1/projects?*');
 await page.getByRole('button',{name:'Повторить'}).click();
 await expect(page.getByLabel('Поиск проекта')).toBeVisible();
});
for(const width of [390,1440]) test(`project fits ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await setup(page,'#/work-projects?project=1');
 await expect(page.locator('.work-table')).toBeVisible();
 await choose(page,'TASK-7 Обязательство');
 await expect(page.locator('.work-table')).toHaveCount(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/projects-${width}.png`,fullPage:true});
});
for(const theme of ['light','dark']) for(const width of [390,1440]) test(`catalogue design ${theme} ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await setup(page);
 await page.route('**/api/v1/projects?*',route=>route.fulfill({json:{total:6,page:1,items:[
  'Развитие цифровой платформы','Клиентский опыт','Автоматизация отчётности','Управление данными и интеграция с внешними информационными системами','Операционная эффективность','Мобильное приложение'
 ].map((name,i)=>({id:i+1,name,code:'P'+i,status:'Активен',description:i%2?'Короткое описание':'Описание направления с несколькими строками текста. '.repeat(20),responsible:'Очень длинное имя ответственного за направление проекта',backlog_count:1}))}}));
 await page.route('**/api/v1/projects/1/workspace?*',route=>route.fulfill({json:workspace({id:1,name:'Развитие цифровой платформы'})}));
 await page.evaluate(async theme=>{document.documentElement.dataset.theme=theme;await window.renderProjects();},theme);
 await expect(page.locator('.project-card')).toHaveCount(6);
 await expect(page.locator('.project-card-code')).toHaveCount(0);
 await expect(page.locator('.project-card .ui-badge').first()).toHaveAttribute('data-ui-tone','success');
 const misaligned=await page.locator('.project-catalog').evaluate(list=>{
  const rows=new Map();
  for(const card of list.querySelectorAll('.project-card')){
   const top=Math.round(card.getBoundingClientRect().top);
   const positions=[...card.children].map(el=>el.getBoundingClientRect().top);
   const first=rows.get(top);if(first&&positions.some((y,i)=>Math.abs(y-first[i])>1))return true;
   rows.set(top,positions);
  }
  return false;
 });
 expect(misaligned).toBe(false);
 const overflowing=await page.locator('.project-catalog').evaluate(list=>[...list.querySelectorAll('.project-card-name,.project-card-description,.project-card-owner')].some(el=>el.getBoundingClientRect().height>parseFloat(getComputedStyle(el).lineHeight)*(el.classList.contains('project-card-owner')?1:2)+1));
 expect(overflowing).toBe(false);
 await expect(page.locator('.project-card-name').first()).toHaveAttribute('title','Развитие цифровой платформы');
 const spacing=await page.locator('.project-catalog-toolbar').evaluate(form=>{const input=form.querySelector('input').getBoundingClientRect(),button=form.querySelector('button').getBoundingClientRect();return button.left-input.right;});
 expect(spacing).toBeGreaterThanOrEqual(0);expect(spacing).toBeLessThanOrEqual(12);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/project-catalogue-${theme}-${width}.png`,fullPage:true});
 await page.getByLabel('Поиск проекта').fill('Черновик поиска');
 await expect(page.getByRole('button',{name:'Сбросить',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'Сбросить',exact:true}).click();
 await expect(page.getByLabel('Поиск проекта')).toHaveValue('');
 await page.locator('.project-card').first().focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'Развитие цифровой платформы',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Рабочие задачи',exact:true}).click();
 if(!await page.locator('.project-structure-disclosure').evaluate(x=>x.open)){
  await page.locator('summary').focus();await page.keyboard.press('Enter');
 }
 await page.locator('[data-major="7"] a').focus();await page.keyboard.press('Enter');
 await expect(page.locator('.work-table')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`test-results/project-overview-${theme}-${width}.png`,fullPage:true});
});
