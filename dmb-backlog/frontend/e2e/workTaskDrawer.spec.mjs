import { test, expect } from '@playwright/test';

test('activity loads all 250 comments and 150 history events through cursors', async ({page}) => {
 await setup(page);
 await page.route('**/api/v1/work-tasks/1/comments?**', route => {
  const before=Number(new URL(route.request().url()).searchParams.get('before') || 251);
  const start=Math.max(1,before-100);
  return route.fulfill({json:{items:Array.from({length:before-start},(_,i)=>({id:start+i,author_id:1,body:`Сообщение ${start+i}`})),next_cursor:start>1?start:null}});
 });
 await page.route('**/api/v1/work-tasks/1/history?**', route => {
  const before=Number(new URL(route.request().url()).searchParams.get('before') || 151);
  const start=Math.max(1,before-100);
  return route.fulfill({json:{items:Array.from({length:before-start},(_,i)=>({id:before-i-1,action:'updated',reason:`Изменение ${before-i-1}`})),next_cursor:start>1?start:null}});
 });
 await page.locator('[data-close]').click();
 await page.getByRole('button',{name:'WRK-1 · Подготовить сценарии приёмки'}).click();
 await page.locator('#work-card-activity-panel > summary').click();
 await expect(page.locator('.work-comment').last()).toContainText('Сообщение 250');
 await page.getByRole('button',{name:'Предыдущие комментарии'}).click();
 await page.getByRole('button',{name:'Предыдущие комментарии'}).click();
 await expect(page.locator('.work-comment')).toHaveCount(250);
 await expect(page.locator('.work-comment').first()).toContainText('Сообщение 1');
 await page.getByRole('button',{name:'Более ранние изменения'}).click();
 await expect(page.locator('.work-history-item')).toHaveCount(150);
 await expect(page.getByRole('button',{name:'Более ранние изменения'})).toHaveCount(0);
});

test('restoring cancelled work requests a reason and uses the shared transition', async ({page}) => {
 const writes=await setup(page,{status:'cancelled',available_actions:['new'],can_edit:false});
 await page.getByRole('button',{name:'Восстановить задачу',exact:true}).click();
 await expect(page.locator('#wf-reason')).toBeVisible();
 await page.locator('#wf-reason').fill('Ошибочная отмена');
 await page.getByRole('button',{name:'Восстановить задачу',exact:true}).click();
 expect(writes.at(-1).body).toMatchObject({status:'new',reason:'Ошибочная отмена',version:1});
});
async function setup(page, overrides = {}) {
 let row={id:1,public_id:'WRK-1',title:'Подготовить сценарии приёмки',description:'Проверить основные сценарии и приложить результаты проверки.',execution_team_id:10,work_direction:'organizational',assignee_id:1,due_date:'2026-11-01',acceptor_id:2,status:'in_progress',assignment_state:'accepted',version:1,available_actions:['in_acceptance','cancelled'],acceptance_required:true,can_edit:true,can_block:true,can_collaborate:true,can_place:true,can_reassign:true,...overrides};
 const writes=[], comments=[], files=[];
 await page.route('**/api/v1/work-targets**',route=>route.fulfill({json:{items:[{id:2,public_id:'WRK-2',title:'Зависимая работа'}]}}));
 await page.route('**/api/v1/work-dependencies**',async route=>{if(route.request().method()==='POST')writes.push({path:'/work-dependencies',body:route.request().postDataJSON()});return route.fulfill({json:[]});});
 await page.route('**/api/v1/work-tasks**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,reply=body=>route.fulfill({json:body});
  if(path.endsWith('/options'))return reply({can_create:true,teams:[{id:10,name:'Разработка'},{id:20,name:'Аналитика'}],users:[{id:1,name:'Александр Иванов',team_id:10},{id:2,name:'Мария Петрова',team_id:20}],projects:[{id:5,name:'Проект IB'}]});
  if(['POST','PATCH'].includes(req.method())){
   if(path.endsWith('/attachments')){writes.push({path,body:req.postData()});files.push({id:11,filename:'result.txt',size:12});return reply({...files[0],version:++row.version});}
   const body=req.postDataJSON();writes.push({path,body});
   if(path.endsWith('/comments'))comments.push({author_id:1,body:body.body,created_at:'2026-10-17T10:30:00Z'});
   row={...row,...(req.method()==='PATCH'?body:{}),...(path.endsWith('/transitions')?{status:body.status,result_text:body.result_text||row.result_text,available_actions:body.status==='ready'?['in_progress','cancelled']:body.status==='in_progress'?['in_acceptance','cancelled']:body.status==='in_acceptance'?['done','in_progress']:[]}:{}),version:row.version+1};return reply(row);
  }
  if(path.endsWith('/comments'))return reply(comments);
  if(path.endsWith('/history'))return reply([{action:'created',created_at:'2026-10-17T09:00:00Z'}]);
  if(path.endsWith('/attachments'))return reply(files);
  if(path.endsWith('/1'))return reply(row);
  return reply({items:[row],total:1,summary:{total:1}});
 });
 await page.goto('/e2e/fixtures/workTasks.html?presentation=modal');
 await page.getByRole('button',{name:'WRK-1 · Подготовить сценарии приёмки'}).click();
 await expect(page.locator('.work-card-title:visible, .work-card-title-editor')).toBeVisible();if(row.can_edit&&!['done','cancelled'].includes(row.status)&&!(await page.locator('#wf-title').isVisible()))await page.getByRole('button',{name:'Редактировать',exact:true}).click();return writes;
}
test('compact single page, keyboard sections and fixed footer at desktop/mobile in both themes',async({page})=>{
 await setup(page);
 for(const width of [1440,390])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:700});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect(page.locator('#wf-reason')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Сохранить изменения'})).toBeInViewport();
  await expect(page.getByRole('button',{name:'Передать на приёмку',exact:true})).toBeInViewport();
  const footer=page.locator('.work-dialog-footer');
  await expect(footer.locator('.btn-primary:visible')).toHaveCount(1);
  const primaryBox=await footer.locator('.btn-primary:visible').boundingBox();
  const footerBox=await footer.boundingBox();
  expect(footerBox.x+footerBox.width-primaryBox.x-primaryBox.width).toBeLessThan(32);
  expect(await page.locator('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  // Productivity fields may scroll; the modal and its fixed footer must fit the viewport.
  if(width===1440){const box=await page.locator('dialog').boundingBox();expect(box.width).toBeLessThanOrEqual(600);expect(box.height).toBeLessThanOrEqual(668);}
  await expect(page.locator('.work-dialog [role="tab"]')).toHaveCount(0);
  const activity=page.locator('#work-card-activity-panel > summary');
  await activity.focus();await page.keyboard.press('Enter');
  await expect(page.locator('#wf-comment')).toBeVisible();
  await expect(page.locator('#wf-title')).toBeVisible();
  await activity.focus();await page.keyboard.press('Enter');
  await page.screenshot({path:`test-results/work-card-${width}-${theme}.png`});
 }
});

test('return feedback is immediately visible and opens history',async({page})=>{
 await setup(page,{return_feedback:{reason:'Добавить контрольный пример',actor_name:'Мария Петрова',created_at:'2026-10-20T10:00:00Z'}});
 await expect(page.locator('.work-return-feedback')).toContainText('Добавить контрольный пример');
 await expect(page.locator('.work-return-feedback')).toContainText('Мария Петрова');
 await page.getByRole('button',{name:'Показать историю',exact:true}).click();
 await expect(page.locator('#work-card-activity-panel')).toHaveAttribute('open','');
 await expect(page.locator('[data-work-history]')).toHaveAttribute('open','');
});
test('result draft survives task save and transition submits result',async({page})=>{
 const writes=await setup(page);
 await page.getByRole('button',{name:'Передать на приёмку',exact:true}).click();await expect(page.locator('#wf-reason')).toHaveCount(0);
 await page.locator('#wf-result_text').fill('Все сценарии проверены');await page.getByRole('button',{name:'Назад',exact:true}).click();
 await page.locator('#wf-title').fill('Проверить сценарии приёмки');await page.keyboard.press('Control+s');await expect(page.locator('#wf-title')).toHaveValue('Проверить сценарии приёмки');await page.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);
 expect(writes[0].body.title).toBe('Проверить сценарии приёмки');expect(writes[0].body).not.toHaveProperty('result_text');
 await page.getByRole('button',{name:'WRK-1 · Проверить сценарии приёмки'}).click();await page.getByRole('button',{name:'Передать на приёмку',exact:true}).click();
 await expect(page.locator('#wf-result_text')).toHaveValue('Все сценарии проверены');await page.getByRole('button',{name:'Передать на приёмку',exact:true}).click();
 await expect(page.locator('dialog')).toHaveCount(1);await expect(page.locator('.work-dialog-heading')).toContainText('На приёмке');expect(writes.at(-1).body).toEqual({version:2,status:'in_acceptance',result_text:'Все сценарии проверены',reason:''});
});
test('cancel requires reason and Ctrl+Enter confirms chosen action',async({page})=>{
 const writes=await setup(page);await page.locator('[data-card-menu-trigger]').click();await page.getByRole('menuitem',{name:'Отменить задачу',exact:true}).click();await page.getByRole('button',{name:'Отменить задачу',exact:true}).click();
 expect(writes).toHaveLength(0);await expect(page.locator('#wf-reason')).toBeFocused();await page.locator('#wf-reason').fill('Потребность снята');await page.keyboard.press('Control+Enter');
 await expect(page.locator('dialog')).toHaveCount(1);await expect(page.locator('.work-dialog-heading')).toContainText('Отменена');expect(writes[0].body).toMatchObject({reason:'Потребность снята',status:'cancelled'});
});
test('comment and file stay open, preserve edits and update version for dependencies/save',async({page})=>{
 const writes=await setup(page);await page.locator('#wf-title').fill('Мой несохранённый текст');await page.locator('#work-card-activity-panel > summary').click();
 await page.locator('#wf-comment').fill('Проверка завершена');await page.getByRole('button',{name:'Отправить комментарий'}).click();
 await expect(page.locator('.work-comment')).toContainText('Проверка завершена');await expect(page.locator('#wf-comment')).toHaveValue('');
 await page.locator('#wf-comment').fill('Второе сообщение');await page.keyboard.press('Control+Enter');await expect(page.locator('.work-comment')).toHaveCount(2);expect(writes[1].body.version).toBe(2);
 await page.locator('#work-card-resources-panel > summary').click();await page.locator('[data-work-upload]').setInputFiles({name:'result.txt',mimeType:'text/plain',buffer:Buffer.from('test results')});await expect(page.getByRole('button',{name:'result.txt'})).toBeVisible();
 await page.getByText('Зависимости',{exact:true}).click();await page.getByRole('searchbox',{name:'Связанная работа',exact:true}).fill('WRK-2');await page.getByRole('searchbox',{name:'Связанная работа',exact:true}).press('Enter');await page.getByRole('combobox',{name:'Связанная работа: выбор',exact:true}).selectOption('2');await page.getByRole('button',{name:'Добавить зависимость'}).click();await expect.poll(()=>writes.length).toBe(4);expect(writes[3].body.source_version).toBe(4);
 await page.getByRole('button',{name:'Сохранить изменения'}).click();await page.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);expect(writes.at(-1).body).toMatchObject({version:4,title:'Мой несохранённый текст'});await expect(page.getByRole('button',{name:'WRK-1 · Мой несохранённый текст'})).toBeFocused();
});
test('completed readonly card has result without unavailable editing controls and restores focus',async({page})=>{
 await setup(page,{status:'done',result_text:'Результат принят',available_actions:[],can_edit:true,can_block:false,can_collaborate:false,can_place:false,can_reassign:false});
 await expect(page.locator('#wf-title')).toBeDisabled();await expect(page.getByRole('button',{name:'Сохранить изменения'})).toHaveCount(0);await expect(page.getByText('Результат принят',{exact:true})).toBeVisible();await expect(page.locator('#wf-result_text')).toHaveCount(0);
 await page.locator('#work-card-activity-panel > summary').click();await expect(page.locator('#wf-comment')).toHaveCount(0);await page.locator('#work-card-resources-panel > summary').click();await expect(page.locator('[data-work-upload]')).toHaveCount(0);await expect(page.locator('[data-dependency]')).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'WRK-1 · Подготовить сценарии приёмки'})).toBeFocused();
});
for(const [label,status,actions,target] of [
 ['Вернуть на доработку','in_acceptance',['in_progress','done'],'in_progress'],
 ['Переоткрыть','done',['ready'],'ready']
])test(`${label} requires reason and preserves existing result`,async({page})=>{
 const writes=await setup(page,{status,available_actions:actions,result_text:'Сохранённый результат'});
 await page.getByRole('button',{name:label,exact:true}).click();await expect(page.locator('#wf-result_text')).toHaveCount(0);
 await page.locator('#wf-reason').fill('Нужны уточнения');await page.getByRole('button',{name:label,exact:true}).click();await expect.poll(()=>writes.length).toBe(1);await expect(page.locator('dialog')).toHaveCount(1);
 expect(writes[0].body).toMatchObject({status:target,reason:'Нужны уточнения',version:1});
});
test('accept assignment uses selected assignee and due date',async({page})=>{
 const writes=await setup(page,{status:'new',assignment_state:'proposed',can_decide_assignment:true,available_actions:[]});
 await page.locator('#wf-due_date').fill('2026-12-01');await page.getByRole('button',{name:'Принять назначение',exact:true}).click();await page.getByRole('button',{name:'Принять назначение',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);await expect(page.locator('dialog')).toHaveCount(1);
 expect(writes[0].body).toMatchObject({version:1,decision:'accepted',assignee_id:1,due_date:'2026-12-01'});
});
test('move and reassign retain placement and reassignment payloads',async({page})=>{
 const writes=await setup(page);await page.locator('[data-card-menu-trigger]').click();await page.getByRole('menuitem',{name:'Переместить',exact:true}).click();
 await page.locator('#wf-move-project').selectOption('5');await page.locator('#wf-move-reason').fill('Уточнено размещение');await page.getByRole('button',{name:'Подтвердить перенос'}).click();await expect.poll(()=>writes.length).toBe(1);await page.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);
 expect(writes[0].body).toEqual({version:1,major_task_id:null,direct_project_id:5,reason:'Уточнено размещение'});
 await page.getByRole('button',{name:'WRK-1 · Подготовить сценарии приёмки'}).click();await page.locator('[data-card-menu-trigger]').click();await page.getByRole('menuitem',{name:'Предложить другой команде',exact:true}).click();
 await page.locator('#wf-reassign-team').selectOption('20');await page.locator('#wf-reassign-reason').fill('Нужна экспертиза');await page.getByRole('button',{name:'Предложить команде',exact:true}).click();await expect.poll(()=>writes.length).toBe(2);await page.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);
 expect(writes[1].body).toEqual({version:2,execution_team_id:20,reason:'Нужна экспертиза'});
});

for(const [status,target,label] of [
 ['new','ready','Передать исполнителю'],['ready','in_progress','Начать работу'],
 ['in_progress','done','Завершить'],['in_acceptance','done','Принять результат']
])test(`next step ${status} to ${target} submits allowed action`,async({page})=>{
 const writes=await setup(page,{status,available_actions:[target],acceptance_required:false});
 await expect(page.locator('.work-next-step')).not.toBeEmpty();
 await page.getByRole('button',{name:label,exact:true}).click();
 if(['done','in_acceptance'].includes(target)){if(status!=='in_acceptance')await page.locator('#wf-result_text').fill('Проверенный результат');else await expect(page.locator('#wf-result_text')).toHaveCount(0);await page.getByRole('button',{name:label,exact:true}).click();}
 await expect.poll(()=>writes.at(-1)?.body.status).toBe(target);await expect(page.locator('dialog')).toHaveCount(1);
});

test('retired obstacle stays absent with legacy response fields',async({page})=>{
 await setup(page,{can_block:true,blocked_reason:'legacy'});
 await expect(page.locator('#wf-blocked_reason')).toHaveCount(0);
 await expect(page.locator('[data-work-action="edit-blocker"]')).toHaveCount(0);
});

test('declining assignment requires reason and does not change team attributes',async({page})=>{
 const writes=await setup(page,{status:'new',assignment_state:'proposed',can_decide_assignment:true,available_actions:[]});
 await page.getByRole('button',{name:'Отклонить назначение',exact:true}).click();
 await page.getByRole('button',{name:'Отклонить назначение',exact:true}).click();expect(writes).toHaveLength(0);
 await page.locator('#wf-reason').fill('Не наш профиль');await page.getByRole('button',{name:'Отклонить назначение',exact:true}).click();
 expect(writes.at(-1).body).toMatchObject({version:1,decision:'declined',reason:'Не наш профиль'});
 expect(writes.at(-1).body).not.toHaveProperty('execution_team_id');
});

test('cross-team creation leaves assignee to receiving team',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Создать задачу',exact:true}).click();
 await page.getByText('Команда и связь с проектом',{exact:true}).click();await page.locator('#wf-execution_team_id').selectOption('20');
 await expect(page.locator('#wf-assignee_id')).toBeDisabled();await expect(page.locator('#wf-assignee_id')).toHaveValue('');
 await expect(page.locator('[data-work-assignment-note]')).toBeVisible();
 await page.locator('#wf-execution_team_id').selectOption('10');await expect(page.locator('#wf-assignee_id')).toBeEnabled();
});

test('cancelled proposal explains closure and offers no assignment decision',async({page})=>{
 await setup(page,{status:'cancelled',assignment_state:'proposed',can_decide_assignment:false,available_actions:[],can_block:false,blocked_reason:'Историческое препятствие'});
 await expect(page.locator('.work-next-step')).toContainText('Задача отменена');
 await expect(page.locator('.work-next-step')).not.toContainText('должна принять');
 await expect(page.getByRole('button',{name:'Принять назначение',exact:true})).toHaveCount(0);
});

test('whitespace title is explained locally and can be corrected',async({page})=>{
 const writes=await setup(page);await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('button',{name:'Создать задачу',exact:true}).click();
 await page.locator('#wf-title').fill('   ');await page.getByRole('button',{name:'Создать',exact:true}).click();
 expect(writes).toHaveLength(0);await expect(page.locator('#wf-title')).toHaveAttribute('aria-invalid','true');await expect(page.getByText('Укажите название задачи',{exact:true}).last()).toBeVisible();
 await page.locator('#wf-title').fill('Исправленное название');await page.getByRole('button',{name:'Создать',exact:true}).click();
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(page.locator('dialog')).toHaveCount(0);expect(writes.at(-1).body.title).toBe('Исправленное название');
});
