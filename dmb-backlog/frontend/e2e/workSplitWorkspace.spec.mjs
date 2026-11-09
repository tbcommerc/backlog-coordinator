import {test, expect} from '@playwright/test';

test('compact inspector, fullscreen and sequential navigation preserve queue context',async({page})=>{
 await page.setViewportSize({width:1422,height:800});await setup(page);
 await first(page).click();
 const box=await page.locator('.work-inspector-host').boundingBox();
 expect(box.y,JSON.stringify(await page.locator('.work-workspace-layout').evaluate(el=>({layout:el.className,columns:getComputedStyle(el).gridTemplateColumns,parent:el.parentElement.className,filters:getComputedStyle(el.parentElement.querySelector('.work-filter-panel')).display,children:[...el.children].map(x=>({class:x.className,hidden:x.hidden,y:x.getBoundingClientRect().y}))})))).toBeLessThanOrEqual(200);
 await page.getByRole('button',{name:'Показать фильтры',exact:true}).click();
 await expect(page.locator('#work-search')).toBeVisible();
 await page.getByRole('button',{name:'Скрыть фильтры',exact:true}).click();
 await page.getByRole('button',{name:'На весь экран',exact:true}).click();
 await expect(page.locator('dialog:modal')).toHaveClass(/is-fullscreen/);
 await page.getByRole('button',{name:'Обычный размер',exact:true}).click();
 await expect(page.locator('.work-dialog-inline')).toHaveCount(1);
 const separator=page.getByRole('separator',{name:'Ширина карточки задачи'});
 await expect(separator).toBeVisible();
 const originalWidth=Number(await separator.getAttribute('aria-valuenow'));
 await separator.focus();await page.keyboard.press('ArrowLeft');
 await expect(separator).toHaveAttribute('aria-valuenow',String(originalWidth+10));
 await expect(page.locator('[data-card-width]')).toHaveValue(String(originalWidth+10));
 await page.getByRole('button',{name:'Следующая задача',exact:true}).click();
 await expect(page.locator('.work-card-title')).toHaveText('Подготовить запуск');
 expect(new URL(page.url()).hash).toContain('q=');
});

async function setup(page, {delayFirst = false} = {}) {
 const rows = [1,2].map(id=>({id,public_id:`WRK-${id}`,title:id===1?'Согласовать результат':'Подготовить запуск',description:'Проверенный результат с критериями приёмки.',execution_team_id:10,requester_id:2,assignee_id:1,assignee_name:'Исполнитель',acceptor_id:2,due_date:'2026-11-01',status:'ready',assignment_state:'accepted',version:1,can_edit:true,can_block:true,can_collaborate:true,acceptance_required:true,available_actions:['in_progress','cancelled'],context:{title:'Запуск продукта'}}));
 const writes=[];
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(), path=new URL(req.url()).pathname, reply=json=>route.fulfill({json});
  if(path.endsWith('/options'))return reply({can_create:true,teams:[{id:10,name:'Разработка'}],users:[{id:1,name:'Исполнитель',team_id:10},{id:2,name:'Постановщик',team_id:10}],projects:[]});
  if(path.includes('work-dependencies'))return reply([]);
  if(req.method()==='POST' && path.endsWith('/work-tasks')) {
   const row={...rows[0],...req.postDataJSON(),id:3,public_id:'WRK-3'};rows.push(row);writes.push(row);return reply(row);
  }
  const id=Number(path.match(/work-tasks\/(\d+)/)?.[1]),row=rows.find(x=>x.id===id);
  if(req.method()==='PATCH') {writes.push(req.postDataJSON());Object.assign(row,req.postDataJSON(),{version:row.version+1});return reply(row);}
  if(path.endsWith('/comments') && req.method()==='POST') {writes.push(req.postDataJSON());return reply({id:99,version:++row.version});}
  if(path.endsWith('/transitions')) {writes.push(req.postDataJSON());Object.assign(row,{status:req.postDataJSON().status,version:row.version+1,available_actions:['in_acceptance','cancelled']});return reply(row);}
  if(/\/(history|comments|attachments)$/.test(path))return reply([]);
  if(row) {if(delayFirst && id===1)await new Promise(resolve=>setTimeout(resolve,500));return reply(row);}
  return reply({items:rows,total:rows.length,summary:{total:rows.length}});
 });
 await page.goto('/e2e/fixtures/workTasks.html#/work-tasks?view=all&q=запуск');
 await expect(page.locator('[data-work-row]')).toHaveCount(2);
 return {rows,writes};
}
const first = page=>page.getByRole('button',{name:'WRK-1 · Согласовать результат',exact:true});
const second = page=>page.getByRole('button',{name:'WRK-2 · Подготовить запуск',exact:true});

test('non-modal card preserves queue, draft, filters and selected task after save and transition',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 const {writes}=await setup(page);
 await first(page).click();
 await expect(page.locator('.work-card-title')).toHaveText('Согласовать результат');
 await expect(page.locator('dialog:modal')).toHaveCount(0);
 await expect(page.locator('.work-card-overview')).toContainText('Постановщик');
 await expect(page.locator('#wf-title')).toBeHidden();
 await expect(second(page)).toBeInViewport();
 const compactRow=await page.locator('[data-work-row="1"]').boundingBox();
 const queuePanel=await page.locator('.work-queue-panel').boundingBox();
 expect(compactRow.width).toBeGreaterThan(queuePanel.width-8);
 expect((await page.locator('[data-work-row="1"] td').first().boundingBox()).width).toBeGreaterThan(250);
 await page.getByRole('button',{name:'Редактировать',exact:true}).click();
 await page.locator('#wf-title').fill('Мой черновик');
 await second(page).click();await expect(page.locator('.work-card-title')).toHaveText('Подготовить запуск');
 await first(page).click();await expect(page.locator('#wf-title')).toHaveValue('Мой черновик');
 await page.getByRole('button',{name:'Сохранить изменения'}).click();
 await expect(page.locator('.work-card-title')).toHaveText('Мой черновик');
 await expect(page.locator('[data-work-row="1"]')).toHaveClass('is-selected');
 expect(new URL(page.url()).hash).toContain('/work-tasks/1?');
 await expect(page.locator('#work-search')).toHaveValue('запуск');
 await page.getByRole('button',{name:'Начать работу',exact:true}).click();
 await expect(page.locator('.work-dialog-heading')).toContainText('В работе');
 expect(writes.at(-1)).toMatchObject({version:2,status:'in_progress'});
 await expect(page.locator('.work-dialog')).not.toHaveAttribute('aria-busy','true');
 await page.keyboard.press('Escape');
 await expect(page.locator('.work-dialog-inline')).toHaveCount(0);
 await expect(page.locator('[data-work-id="1"]')).toBeFocused();
 expect(new URL(page.url()).hash).toContain('/work-tasks?');
});

test('slow previous card cannot overwrite selection',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await setup(page,{delayFirst:true});
 await first(page).click();await second(page).click();
 await expect(page.locator('.work-card-title')).toHaveText('Подготовить запуск');
 await page.waitForTimeout(600);
 await expect(page.locator('.work-card-title')).toHaveText('Подготовить запуск');
 await expect(page.locator('.work-dialog-inline')).toHaveCount(1);
});

test('creating and commenting keep the task URL, including when comment ID differs',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Создать задачу'}).click();
 await page.locator('#wf-title').fill('Новая рабочая задача');await page.getByRole('button',{name:'Создать',exact:true}).click();
 await expect(page.locator('.work-card-title')).toHaveText('Новая рабочая задача');
 await expect.poll(()=>new URL(page.url()).hash).toContain('/work-tasks/3?');
 await page.getByRole('tab',{name:'Активность'}).click();
 await page.locator('#wf-comment').fill('Уточнение');await page.getByRole('button',{name:'Отправить комментарий'}).click();
 await expect(page.locator('#wf-comment')).toHaveValue('');
 expect(new URL(page.url()).hash).toContain('/work-tasks/3?');
});

for(const width of [320,390,1024,1440])for(const theme of ['light','dark'])test(`list and card fit ${width} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:800});await setup(page);
 await page.evaluate(theme=>{
  document.documentElement.dataset.theme=theme;
  if(innerWidth>=1024){document.querySelector('main').style.marginLeft='248px';}
 },theme);
 await first(page).click();await expect(page.locator('.work-card-title')).toBeVisible();
  const card=page.locator('.work-dialog');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await card.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await expect(page.getByRole('button',{name:'Начать работу',exact:true})).toBeInViewport();
  if(width<=1024)await expect(card).toHaveJSProperty('tagName','DIALOG');
 else await expect(second(page)).toBeInViewport();
 await page.screenshot({path:info.outputPath('list-card.png'),fullPage:true});
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await expect(first(page)).toBeVisible();
 if(width<=390) {
  const due=page.locator('.work-queue-due').first();
  const box=await due.boundingBox();
  const line=await due.evaluate(el=>parseFloat(getComputedStyle(el).lineHeight));
  expect(box.height).toBeLessThanOrEqual(line*2);
  expect(await page.locator('.work-queue-state').first().evaluate(el=>getComputedStyle(el,'::before').display)).toBe('none');
 }
 await expect(page.locator('#work-search')).toHaveValue('запуск');
});
