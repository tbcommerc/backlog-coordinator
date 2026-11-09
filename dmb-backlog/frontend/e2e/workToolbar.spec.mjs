import {test,expect} from '@playwright/test';

async function setup(page,width=1440){
 await page.setViewportSize({width,height:900});
 const queries=[];
 await page.route('**/api/v1/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.endsWith('/options'))return route.fulfill({json:{can_create:true,board_enabled:true,teams:[{id:10,name:'Проектный офис'}],users:[{id:1,name:'Иван Петров'}],projects:[]}});
  if(url.pathname.endsWith('/work-tasks'))queries.push(url.searchParams);
  return route.fulfill({json:{items:[{id:1,public_id:'WRK-1',title:'Подготовить требования к интеграции',status:'in_progress',assignee_id:1,assignee_name:'Иван Петров',due_date:'2026-11-01',priority:'high',available_actions:[]}],total:1,summary:{total:1,overdue:1,blocked:1},focus_counts:{today:3,overdue:7,blocked:2},collection_counts:{mine:8,acceptance:2,requested:9,team:15,all:40}}});
 });
 await page.goto('/e2e/fixtures/workTasks.html#/work-tasks?view=all');
 await expect(page.locator('html')).toHaveAttribute('data-work-fixture-ready','true');
 await page.evaluate(async()=>{
  const {installFilterSelects}=await import('/js/ui/filterSelect.js');
  installFilterSelects();
 });
 await page.addScriptTag({url:'/static/js/lib/lucide.min.js'});
 await page.evaluate(()=>window.lucide.createIcons());
 return queries;
}

for(const width of [1280,1440,1920])test(`desktop toolbar keeps search readable at ${width}px`,async({page})=>{
 await setup(page,width);
 await page.evaluate(()=>{const main=document.querySelector('main');main.classList.add('main-content');main.style.marginLeft='248px';});
 const search=page.locator('#work-search');
 await expect(page.locator('[data-work-action=reset]')).toBeVisible();
 expect(await page.locator('.work-toolbar').evaluate(el=>parseFloat(getComputedStyle(el).borderTopWidth))).toBe(1);
 expect((await search.boundingBox()).width).toBeGreaterThanOrEqual(280);
 expect(await search.evaluate(el=>{const c=getComputedStyle(el),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=c.font;return el.clientWidth-parseFloat(c.paddingLeft)-parseFloat(c.paddingRight)>=ctx.measureText(el.placeholder).width;})).toBe(true);
 for(const id of ['status','sort']){
  const box=await page.locator(`#work-${id}`).boundingBox(),label=await page.locator(`label[for=work-${id}]`).boundingBox();
  expect(label.x+label.width).toBeLessThanOrEqual(box.x+1);
  expect(Math.abs(label.y+label.height/2-box.y-box.height/2)).toBeLessThanOrEqual(1);
  expect((await page.locator(`#work-${id}`).locator('..').boundingBox()).height).toBeLessThanOrEqual(34);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for(const width of [1440,1024,768,390,320])test(`toolbar fits ${width}px and keeps focus filters accessible`,async({page},info)=>{
 await setup(page,width);
 if(width>900)await expect(page.locator('#work-search')).toBeVisible();
 await expect(page.locator('[data-work-focus]')).toHaveCount(3);
 for(const el of await page.locator('[data-work-focus]').all()){await expect(el).toBeInViewport({ratio:1});expect(await el.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return r.left>=p.left && r.right<=p.right;})).toBe(true);}
 if(width>900){
  for(const id of ['status','sort']){
   await expect(page.locator(`#work-${id}`)).toBeVisible();
   expect((await page.locator(`label[for=work-${id}]`).boundingBox()).width).toBeGreaterThan(20);
  }
  await expect(page.locator('#work-team')).toBeHidden();
  await expect(page.locator('#work-assignee')).toBeHidden();
  expect((await page.locator('.work-toolbar').boundingBox()).height).toBeLessThan(130);
 }else{
  await expect(page.locator('#work-view')).toBeVisible();
  await page.locator('[data-work-action=filters]').click();
  await expect(page.getByRole('dialog',{name:'Фильтры рабочих задач'})).toBeVisible();
  await expect(page.locator('#work-status')).toBeVisible();
  await page.keyboard.press('Escape');
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width>900){
  const tabs=await page.locator('.work-collections').boundingBox(),toolbar=await page.locator('.work-toolbar').boundingBox();
  await page.screenshot({path:info.outputPath(`toolbar-${width}.png`),clip:{x:toolbar.x,y:tabs.y,width:toolbar.width,height:toolbar.y+toolbar.height-tabs.y}});
 }else await page.screenshot({path:info.outputPath(`toolbar-${width}.png`)});
});

test('compact dark toolbar keeps keyboard focus and refresh available',async({page},info)=>{
 await setup(page);
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 await expect(page.getByRole('button',{name:'Обновить',exact:true})).toBeVisible();
 const tab=page.locator('[data-work-collection=mine]');
 await tab.focus();await page.keyboard.press('Enter');
 await expect(tab).toBeFocused();
 await expect(tab).toHaveAttribute('aria-pressed','true');
 expect(await tab.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none');
 const tabs=await page.locator('.work-collections').boundingBox(),toolbar=await page.locator('.work-toolbar').boundingBox();
 await page.screenshot({path:info.outputPath('toolbar-dark.png'),clip:{x:toolbar.x,y:tabs.y,width:toolbar.width,height:toolbar.y+toolbar.height-tabs.y}});
});

test('several focus shortcuts form one OR selection',async({page})=>{
 const queries=await setup(page);
 await page.locator('[data-work-focus=overdue]').click();
 await page.locator('[data-work-focus=blocked]').click();
 await expect.poll(()=>queries.at(-1).get('focus')).toBe('["overdue","blocked"]');
 await expect(page.locator('[data-work-focus=overdue]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('[data-work-focus=blocked]')).toHaveAttribute('aria-pressed','true');
 await page.locator('[data-work-focus=overdue]').click();
 await expect.poll(()=>queries.at(-1).get('focus')).toBe('blocked');
});

test('focus respects context, toggles off, and reset preserves collection and display',async({page})=>{
 const queries=await setup(page);
 await page.locator('[data-work-action=filters]').click();
 await page.locator('#work-priority').selectOption('high');
 await page.locator('[data-work-action=apply-filters]').click();
 await page.locator('#work-status').selectOption('in_progress');
 await page.locator('[data-work-focus=overdue]').click();
 await expect.poll(()=>queries.at(-1).get('focus')).toBe('overdue');
 expect(queries.at(-1).get('priority')).toBe('high');
 expect(queries.at(-1).get('status')).toBe('in_progress');
 await expect(page.locator('[data-work-focus=blocked] .quick-filter-count')).toHaveText('2');
 await page.locator('[data-work-focus=overdue]').click();
 await expect.poll(()=>queries.at(-1).has('focus')).toBe(false);
 await page.locator('[data-work-display=summary]').click();
 await page.locator('[data-work-action=reset]').click();
 await expect.poll(()=>queries.at(-1).get('view')).toBe('all');
 await expect(page).toHaveURL(/display=summary/);
 expect(queries.at(-1).get('status')).toBe('active');
 expect(queries.at(-1).has('priority')).toBe(false);
});

test('completion period is explicit, cancellable on mobile and restored on reset',async({page})=>{
 const queries=await setup(page,390);
 await page.locator('[data-work-action=filters]').click();
 await page.locator('#work-status').selectOption('done');
 await expect(page.locator('#work-done-period')).toBeVisible();
 await page.locator('#work-done-period').selectOption('7d');
 await page.keyboard.press('Escape');
 expect(queries.at(-1).get('status')).toBe('active');
 await page.locator('[data-work-action=filters]').click();
 await expect(page.locator('#work-done-period')).toBeHidden();
 await page.locator('#work-status').selectOption('done');
 await page.locator('#work-done-period').selectOption('30d');
 await page.locator('[data-work-action=apply-filters]').click();
 await expect.poll(()=>queries.at(-1).get('done_period')).toBe('30d');
 expect(queries.at(-1).get('status')).toBe('done');
 await expect(page.locator('[data-work-action=filters]')).toContainText('(2)');
 await page.locator('[data-work-action=reset]').click();
 await expect.poll(()=>queries.at(-1).get('done_period')).toBe('all');
 await expect(page.locator('[data-work-action=reset]')).toBeDisabled();
});

test('filters survive viewport changes without duplicate controls',async({page})=>{
 await setup(page);
 await page.locator('[data-work-action=filters]').click();
 await page.locator('#work-assignee').selectOption('1');
 await page.locator('[data-work-action=apply-filters]').click();
 await page.setViewportSize({width:390,height:900});
 await page.locator('[data-work-action=filters]').click();
 await expect(page.locator('#work-assignee')).toHaveValue('1');
 await page.keyboard.press('Escape');
 await page.setViewportSize({width:1440,height:900});
 await expect(page.locator('#work-extra-filters #work-assignee')).toBeHidden();
 await expect(page.locator('#work-assignee')).toHaveCount(1);
 await expect(page.locator('#work-assignee')).toHaveValue('1');
});

for(const width of [1440,1024,390,320])test(`expanded all-filters panel is readable and transactional at ${width}px`,async({page},info)=>{
 const queries=await setup(page,width);
 await page.locator('[data-work-action=filters]').click();
 const panel=page.locator('#work-extra-filters');
 await expect(panel).toBeVisible();
 await expect(panel.getByRole('heading',{name:'Все фильтры',exact:true})).toBeVisible();
 await expect(panel.locator('#work-focus')).toBeHidden();
 await expect(panel.locator('#work-status')).toBeVisible();
 await expect(panel.locator('#work-priority')).toBeVisible();
 await expect(panel.locator('#work-parent-search')).toBeVisible();
 const count=queries.length;
 await panel.locator('#work-priority').selectOption('high');
 await panel.locator('#work-status').selectOption('done');
 await expect(panel.locator('#work-done-period')).toBeVisible();
 await panel.locator('#work-done-period').selectOption('7d');
 expect(queries.length).toBe(count);
 if(width>900){
  for(const id of ['work-direction','work-filter-project','work-priority'])expect((await panel.locator('#'+id).boundingBox()).width).toBeGreaterThan(180);
  expect((await panel.locator('#work-parent-search').boundingBox()).width).toBeGreaterThan(350);
  const panelBox=await panel.boundingBox(),table=await page.locator('.work-queue-panel').boundingBox();
  expect(table.y).toBeLessThan(panelBox.y+panelBox.height);expect(await panel.evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
 }
 expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`all-filters-${width}.png`),fullPage:true});
 await expect(panel).toBeVisible();
 await panel.getByRole('button',{name:'Отмена',exact:true}).click();
 expect(queries.length).toBe(count);
 await page.locator('[data-work-action=filters]').click();
 await expect(panel.locator('#work-priority')).toHaveValue('');
 await expect(panel.locator('#work-status')).toHaveValue('active');
 await panel.locator('#work-direction').selectOption('product');
 await panel.locator('[data-work-action=apply-filters]').click();
 await expect.poll(()=>queries.at(-1).get('work_direction')).toBe('product');
 await expect(panel).toBeHidden();
 if(width>900)await expect(page.locator('.work-toolbar-primary #work-status')).toBeVisible();
});
