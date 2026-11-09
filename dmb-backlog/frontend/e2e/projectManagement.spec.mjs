import {test,expect} from '@playwright/test';
import {setup} from './fixtures/projectManagementSetup.js';
import {management} from './fixtures/projectData.js';

test('overview and deviations ignore hidden plan filters',async({page})=>{
 const queries=await setup(page,'#/work-projects?project=1&section=about&keys=1&pq=unrelated&pg=2');
 const last=()=>queries.filter(x=>x.pathname.endsWith('/management')).at(-1)?.searchParams;
 expect(last().get('q')).toBe('');expect(last().get('milestones')).toBe('false');expect(last().get('page')).toBe('1');
 await page.getByRole('tab',{name:'Отклонения',exact:true}).click();
 await expect.poll(()=>last().get('view')).toBe('deviations');
 expect(last().get('q')).toBe('');expect(last().get('milestones')).toBe('false');
});

for(const width of [320,390,1024,1440])for(const theme of ['light','dark'])test(`management navigation ${width} ${theme}`,async({page})=>{
 await page.setViewportSize({width,height:900});await setup(page);
 await page.locator('html').evaluate((el,theme)=>el.dataset.theme=theme,theme);
 await expect(page.locator('[role=tab]')).toHaveText(['Обзор','План','Гант и вехи','Отклонения','Результаты','Рабочие задачи']);
 await expect(page.locator('.project-passport')).toBeVisible();
 await expect(page.locator('.ui-kpi-card')).toHaveCount(4);
 for(const name of ['План','Гант и вехи','Отклонения','Результаты']){
  if(width<=900)await page.getByLabel('Раздел проекта',{exact:true}).selectOption(({План:'backlog','Гант и вехи':'gantt',Отклонения:'deviations',Результаты:'results'})[name]);else await page.getByRole('tab',{name,exact:true}).click();
  await expect(page.locator('[role=tab][aria-selected=true]')).toHaveText(name);
  await expect(page.getByText('Не удалось загрузить план проекта')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(name==='Гант и вехи'){
   await expect(page.locator('.project-gantt-bar')).toHaveCount(1);
   await expect(page.locator('.project-gantt-milestone')).toHaveCount(1);
   await expect(page.locator('.project-gantt-milestone')).toHaveAttribute('href',/task=7/);
   await page.getByRole('button',{name:'Скрыть исходный план'}).click();
   await expect(page.locator('.project-gantt-baseline')).toHaveCount(0);
   await page.screenshot({path:`test-results/project-gantt-${width}-${theme}.png`,fullPage:true});
  }
 }
 await page.goBack();await expect(page.locator('[role=tab][aria-selected=true]')).toHaveText('Отклонения');
});

test('saves exact dates and milestone without protected fields',async({page})=>{
 await setup(page,'#/work-projects?project=1&section=backlog&year=2026&quarter=4');
 let write;await page.route('**/api/v1/projects/1/tasks/7/plan',route=>{write=route.request().postDataJSON();return route.fulfill({json:{version:3}});});
 await page.getByRole('button',{name:'Настроить',exact:true}).click();
 await page.getByLabel('Срок результата',{exact:true}).fill('2026-11-20');
 await page.getByLabel('Ключевая веха',{exact:true}).selectOption('0');
 await page.getByLabel('Причина изменения сроков',{exact:true}).fill('Согласован перенос');
 await page.getByRole('button',{name:'Сохранить план',exact:true}).click();
 await expect(page.locator('[data-plan-form]')).toHaveCount(0);
 expect(write).toEqual({version:2,starts_on:'2026-10-01',ends_on:'2026-11-20',is_milestone:false,expected_result:'Согласован процесс',change_reason:'Согласован перенос'});
});

test('conflict preserves draft with explicit version refresh',async({page})=>{
 await setup(page,'#/work-projects?project=1&section=backlog&year=2026');
 await page.route('**/api/v1/projects/1/tasks/7/plan',route=>route.request().method()==='PUT'?route.fulfill({status:409,json:{detail:'Задача изменена'}}):route.fulfill({json:{...management().items[0],version:9}}));
 await page.getByRole('button',{name:'Настроить',exact:true}).click();
 await page.getByLabel('Ожидаемый результат',{exact:true}).fill('Мой черновик');
 await page.getByRole('button',{name:'Сохранить план'}).click();
 await expect(page.getByRole('alert')).toContainText('Задача изменена');
 await expect(page.getByLabel('Ожидаемый результат',{exact:true})).toHaveValue('Мой черновик');
 await page.getByRole('button',{name:'Обновить версию задачи'}).click();
 await expect(page.getByRole('alert')).toContainText('Версия обновлена');
 await expect(page.getByLabel('Ожидаемый результат',{exact:true})).toHaveValue('Мой черновик');
});

test('legacy plan, filters, retry, readonly and metrics links',async({page})=>{
 const queries=await setup(page,'#/work-projects?project=1&section=planning&year=2026&bucket=2');
 await expect(page.locator('[role=tab][aria-selected=true]')).toHaveText('План');
 await expect(page.getByLabel('Период',{exact:true})).toHaveValue('2');
 await page.getByRole('button',{name:'Все фильтры',exact:true}).click();
 await page.getByLabel('Показывать задачи').selectOption('undated');await page.getByRole('button',{name:'Применить',exact:true}).click();
 await expect.poll(()=>queries.filter(x=>x.pathname.endsWith('/management')).at(-1)?.searchParams.get('horizon')).toBe('undated');
 await page.route('**/api/v1/projects/1/management?*',route=>route.fulfill({status:503,json:{detail:'Временно недоступно'}}));
 await page.getByRole('tab',{name:'Обзор',exact:true}).click();
 await expect(page.getByRole('button',{name:'Повторить',exact:true})).toBeVisible();
 await page.unroute('**/api/v1/projects/1/management?*');await page.getByRole('button',{name:'Повторить',exact:true}).click();
 await expect(page.locator('.project-passport')).toBeVisible();
 const readonly=management();readonly.items[0].can_edit=false;
 await page.route('**/api/v1/projects/1/management?*',route=>route.fulfill({json:readonly}));
 await page.getByRole('tab',{name:'План',exact:true}).click();
 await expect(page.getByRole('button',{name:'Настроить',exact:true})).toHaveCount(0);
 await page.evaluate(()=>location.hash='#/work-projects?project=1&section=metrics&year=2026');
 await expect(page.locator('[role=tab][aria-selected=true]')).toHaveText('Результаты');
 await expect(page.getByRole('link',{name:'Скорость процесса'})).toBeVisible();
});
