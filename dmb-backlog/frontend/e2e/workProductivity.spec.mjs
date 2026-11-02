import {test,expect} from '@playwright/test';

async function setup(page,{executor=false,conflict=false}={}) {
 const row={id:1,public_id:'WRK-1',title:'Подготовить встречу',description:'Результат встречи',priority:'high',checklist:[{id:'agenda',title:'Повестка',completed:true},{id:'invite',title:'Приглашения',completed:false}],execution_team_id:10,requester_id:2,assignee_id:1,due_date:'2026-11-01',status:'ready',assignment_state:'accepted',version:1,can_edit:!executor,can_check:true,can_block:true,can_collaborate:true,acceptance_required:false,available_actions:[]};
 const writes=[],templates=[];
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method(),reply=json=>route.fulfill({json});
  if(path.endsWith('/options'))return reply({can_create:!executor,teams:[{id:10,name:'Команда'}],users:[{id:1,name:'Исполнитель',team_id:10},{id:2,name:'Постановщик',team_id:10}],projects:[]});
  if(path.includes('/work-task-templates')) {
   if(method==='GET')return reply({items:templates});
   const body=req.postDataJSON();writes.push({path,body});
   if(path.endsWith('/archive')){templates.splice(0);return reply({deleted:true});}
   const item={...body,id:7,version:(templates[0]?.version||0)+1};templates.splice(0,templates.length,item);return reply(item);
  }
  if(method==='PATCH'){
   const body=req.postDataJSON();writes.push({path,body});
   if(conflict)return route.fulfill({status:409,json:{detail:'Задача изменена другим пользователем'}});
   if(path.includes('/checklist/'))row.checklist.find(x=>x.id===path.split('/').at(-1)).completed=body.completed;
   else Object.assign(row,body);
   row.version++;return reply(row);
  }
  if(method==='POST' && path.endsWith('/work-tasks')){const body=req.postDataJSON();writes.push({path,body});Object.assign(row,body,{id:2,public_id:'WRK-2'});return reply(row);}
  if(/\/(history|comments|attachments)$/.test(path)||path.includes('work-dependencies'))return reply([]);
  if(/work-tasks\/\d+$/.test(path))return reply(row);
  return reply({items:[{...row,checklist_progress:{done:row.checklist.filter(x=>x.completed).length,total:row.checklist.length}}],total:1,summary:{total:1}});
 });
 await page.goto('/e2e/fixtures/workTasks.html#/work-tasks?view=all');
 await page.locator('[data-work-id="1"]').first().click();
 await expect(page.locator('.work-card-title')).toBeVisible();
 return {row,writes,templates};
}

test('priority and checklist structure save together; completion uses current version',async({page})=>{
 const {row,writes}=await setup(page);
 await expect(page.locator('.work-checklist-view')).toContainText('1 из 2');
 await page.locator('[data-check-item="invite"]').click();
 await expect(page.locator('[data-checklist-count]')).toHaveText('2 из 2');
 await page.getByRole('button',{name:'Редактировать',exact:true}).click();
 await page.locator('#wf-priority').selectOption('urgent');
 await page.getByRole('button',{name:'Добавить пункт',exact:true}).click();
 await page.getByRole('textbox',{name:'Пункт 3',exact:true}).fill('Протокол');
 await page.getByRole('button',{name:'Переместить пункт 3 выше',exact:true}).click();
 await page.getByRole('button',{name:'Убрать пункт 1',exact:true}).click();
 await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
 await expect(page.locator('.work-dialog-heading [data-priority]')).toHaveText('Срочный');
 expect(writes.at(-1).body.version).toBe(2);
 expect(row.checklist.map(x=>x.title)).toEqual(['Протокол','Приглашения']);
 expect(row.checklist.map(x=>x.completed)).toEqual([false,true]);
 await page.getByRole('button',{name:'К списку',exact:true}).click();
 await page.locator('#work-sort').selectOption('priority');
 const priority=page.locator('#work-priority');
 await page.getByRole('button',{name:'Дополнительные фильтры',exact:true}).click();
 await priority.selectOption('urgent');
 await page.getByRole('button',{name:'Применить',exact:true}).click();
 await expect.poll(()=>page.url()).toContain('priority=urgent');
 await expect(page.locator('[data-work-row] .work-checklist-summary')).toHaveAttribute('aria-label','Чек-лист 1/2');
 await expect(page.locator('[data-work-row] .work-checklist-summary')).toHaveText('1 из 2');
});

test('executor can mark checklist without editing structure; conflict does not fake success',async({page})=>{
 await setup(page,{executor:true,conflict:true});
 await expect(page.getByRole('button',{name:'Редактировать',exact:true})).toHaveCount(0);
 await expect(page.locator('[data-work-templates]')).toHaveCount(0);
 await page.locator('[data-check-item="invite"]').click();
 await expect(page.locator('.work-error')).toContainText('изменены другим участником');
 await expect(page.locator('[data-check-item="invite"]')).not.toBeChecked();
 await expect(page.locator('[data-checklist-count]')).toHaveText('1 из 2');
});

test('personal template copies content with new unchecked items and leaves assignment and date',async({page})=>{
 const {row,writes,templates}=await setup(page);
 if(await page.locator('[data-card-menu]').count()){await page.locator('[data-card-menu] > summary').click();await page.getByRole('button',{name:'Сохранить как шаблон',exact:true}).click();}else await page.getByText('Из шаблона',{exact:true}).click();
 await page.locator('#wf-template-name').fill('Встреча');
 await page.getByRole('button',{name:'Сохранить новый шаблон',exact:true}).click();
 await expect(page.locator('#wf-template')).toHaveValue('7');
 expect(templates[0].content.checklist).toEqual(['Повестка','Приглашения']);
 expect(templates[0].content).not.toHaveProperty('assignee_id');
 expect(templates[0].content).not.toHaveProperty('due_date');
 await page.getByRole('button',{name:'К списку',exact:true}).click();
 await page.getByRole('button',{name:'Создать задачу',exact:true}).click();
 await page.locator('#wf-assignee_id').selectOption('2');
 await page.locator('#wf-due_date').fill('2026-12-01');
 if(await page.locator('[data-card-menu]').count()){await page.locator('[data-card-menu] > summary').click();await page.getByRole('button',{name:'Сохранить как шаблон',exact:true}).click();}else await page.getByText('Из шаблона',{exact:true}).click();
 await page.locator('#wf-template').selectOption('7');
 await page.getByRole('button',{name:'Применить к новой задаче',exact:true}).click();
 await page.getByRole('button',{name:'Применить шаблон',exact:true}).click();
 await expect(page.locator('#wf-title')).toHaveValue('Подготовить встречу');
 await expect(page.locator('#wf-assignee_id')).toHaveValue('2');
 await expect(page.locator('#wf-due_date')).toHaveValue('2026-12-01');
 const items=JSON.parse(await page.locator('#wf-checklist').inputValue());
 expect(items.every(x=>!x.completed && !['agenda','invite'].includes(x.id))).toBe(true);
 await page.getByRole('button',{name:'Создать',exact:true}).click();
 await expect(page.locator('.work-card-title')).toBeVisible();
 expect(writes.at(-1).body.checklist).toEqual(items);
 if(await page.locator('[data-card-menu]').count()){await page.locator('[data-card-menu] > summary').click();await page.getByRole('button',{name:'Сохранить как шаблон',exact:true}).click();}else await page.getByText('Из шаблона',{exact:true}).click();
 await page.locator('#wf-template').selectOption('7');
 await page.locator('#wf-template-name').fill('Встреча — обновлённый');
 await page.getByRole('button',{name:'Обновить выбранный',exact:true}).click();
 await expect.poll(()=>templates[0].version).toBe(2);
 await page.getByRole('button',{name:'Удалить выбранный',exact:true}).click();
 expect(templates).toHaveLength(1);
 await page.getByRole('button',{name:'Подтвердить удаление',exact:true}).click();
 await expect.poll(()=>templates.length).toBe(0);
 expect(row.checklist).toEqual(items);
});

for(const width of [320,390,1440])for(const theme of ['light','dark'])test(`productivity controls fit ${width} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await setup(page);
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 if(await page.locator('[data-card-menu]').count()){await page.locator('[data-card-menu] > summary').click();await page.getByRole('button',{name:'Сохранить как шаблон',exact:true}).click();}else await page.getByText('Из шаблона',{exact:true}).click();
 await expect(page.locator('#wf-template-name')).toBeVisible();
 await page.getByRole('button',{name:'Редактировать',exact:true}).click();
 await page.getByRole('textbox',{name:'Пункт 1',exact:true}).fill('Очень длинное название пункта чек-листа для проверки доступности и размеров элементов');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('.work-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('productivity.png'),fullPage:true});
});
