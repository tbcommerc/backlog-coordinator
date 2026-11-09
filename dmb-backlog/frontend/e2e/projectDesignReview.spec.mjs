import {test,expect} from '@playwright/test';
import {setup} from './fixtures/projectManagementSetup.js';
import {management} from './fixtures/projectData.js';

test('real router refreshes search, horizon and pagination without reload',async({page})=>{
 await setup(page,'#/work-projects?project=1&section=backlog&year=2026&quarter=4');
 await page.route('**/api/v1/projects/1/management?*',async route=>{
  const q=new URL(route.request().url()).searchParams,data=management();
  data.total=q.get('q')?0:q.get('horizon')==='all'?31:1;
  data.page=Number(q.get('page')||1);
  data.items=data.total?[{...data.items[0],title:data.page===2?'Последняя задача':'Первая задача'}]:[];
  await route.fulfill({json:data});
 });
 await page.evaluate(async()=>{window.removeEventListener('hashchange',window.renderProjects);const {Router}=await import('/static/js/router.js');window.app.router=new Router(window.app);window.app.router.init();});
 await page.getByRole('button',{name:'Все фильтры',exact:true}).click();
 await page.getByLabel('Поиск задач',{exact:true}).fill('нет-совпадений');
 await expect(page.getByRole('status').filter({hasText:'Есть неприменённые изменения'})).toBeVisible();
 await page.getByRole('button',{name:'Применить',exact:true}).click();
 await expect(page.getByText('Нет совпадений',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Сброс',exact:true}).click();
 await expect(page.getByRole('link',{name:/Первая задача/})).toBeVisible();
 await page.getByRole('button',{name:'Все фильтры',exact:true}).click();
 await page.getByLabel('Показывать задачи').selectOption('all');await page.getByRole('button',{name:'Применить',exact:true}).click();
 await expect(page.getByText('Задач: 31')).toBeVisible();
 await page.locator('[data-page-scope="management-top"][data-page-action="next"]').click();
 await expect(page.getByRole('link',{name:/Последняя задача/})).toBeVisible();
 await page.goBack();await expect(page.getByRole('link',{name:/Первая задача/})).toBeVisible();
});

test('mobile keeps full statuses, task context and current section after resize',async({page})=>{
 await setup(page,'#/work-projects?project=1&section=gantt&year=2026');
 await page.addStyleTag({url:'/static/css/ui/info-chips.css'});
 await page.setViewportSize({width:320,height:760});
 await expect(page.getByLabel('Раздел проекта',{exact:true})).toHaveValue('gantt');
 const geometry=await page.locator('.project-gantt').evaluate(el=>{const row=el.querySelector('.project-gantt-row:not(.project-gantt-heading)'),label=row.querySelector('.project-gantt-label').getBoundingClientRect(),track=row.querySelector('.project-gantt-track').getBoundingClientRect();return {labelBottom:label.bottom,trackTop:track.top,width:el.getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>innerWidth};});
 expect(geometry.overflow).toBe(false);expect(geometry.labelBottom).toBeLessThanOrEqual(geometry.trackTop+1);expect(geometry.width).toBeLessThanOrEqual(320);
 await page.getByLabel('Раздел проекта',{exact:true}).selectOption('backlog');
 const clipped=await page.locator('.project-management-table .ui-badge span').evaluateAll(nodes=>nodes.some(n=>n.scrollWidth>n.clientWidth+1));expect(clipped).toBe(false);
 await expect(page.locator('#project-plan-filters')).toBeHidden();
});

test('project identity remains visible while next workspace is loading',async({page})=>{
 await setup(page);let release;
 await page.route('**/api/v1/projects/1/workspace?*',async route=>{await new Promise(r=>release=r);await route.fallback();});
 await page.getByRole('tab',{name:'План',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Направление',exact:true})).toBeVisible();
 await expect(page.getByRole('tab',{name:'Гант и вехи',exact:true})).toBeVisible();
 await expect.poll(()=>Boolean(release)).toBe(true);release();
 await expect(page.getByRole('button',{name:'Применить',exact:true})).toBeVisible();
});


test('cancel and Escape restore advanced filters without a false dirty state',async({page})=>{
 await setup(page,'#/work-projects?project=1&section=backlog&year=2026&quarter=4');
 const toggle=page.getByRole('button',{name:'Все фильтры',exact:true});await toggle.click();
 await page.getByLabel('Показывать задачи',{exact:true}).selectOption('all');await page.getByRole('button',{name:'Отмена',exact:true}).click();
 await expect(page.locator('#project-plan-filters')).toBeHidden();await expect(page.locator('.project-filter-draft')).toBeEmpty();
 await toggle.click();await expect(page.getByLabel('Показывать задачи',{exact:true})).toHaveValue('period');
 await page.getByLabel('Показывать задачи',{exact:true}).selectOption('undated');await page.keyboard.press('Escape');
 await expect(toggle).toBeFocused();await expect(page.locator('.project-filter-draft')).toBeEmpty();
});
