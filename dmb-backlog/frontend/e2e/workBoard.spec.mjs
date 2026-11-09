import {test,expect} from '@playwright/test';

async function setup(page,{enabled=true,conflict=false,delay=0}={}) {
 const statuses=['new','ready','in_progress','in_acceptance','done','cancelled'],titles=['Новые','К исполнению','В работе','На приёмке','Выполнены','Отменённые'];
 const rows=statuses.flatMap((status,s)=>Array.from({length:24},(_,n)=>({id:s*100+n+1,public_id:`WRK-${s*100+n+1}`,title:`Проверить результат ${s*100+n+1}`,description:'Ожидаемый результат и критерии',status,version:1,priority:n===0?'urgent':'normal',work_direction:'organizational',execution_team_id:10,assignee_id:1,acceptor_id:1,requester_id:1,assignment_state:'accepted',acceptance_required:true,assignee_name:'Исполнитель',next_actor_label:status==='in_acceptance'?'Принимает: Анна':'Исполнитель',due_date:'2026-11-01',completed_at:status==='done'?'2026-10-21T10:00:00Z':null,context:{title:'Проект запуска'},checklist_progress:{done:1,total:3},checklist:[{id:'a',title:'Проверка',completed:false}],can_edit:!['done','cancelled'].includes(status),can_block:!['done','cancelled'].includes(status),can_collaborate:true,available_actions:status==='ready'?['in_progress','cancelled']:status==='in_progress'?['in_acceptance','cancelled']:status==='in_acceptance'?['done','in_progress']:status==='done'?['ready']:['ready','cancelled']})));
 const writes=[],reads=[];
 const project=row=>({...row,transition_options:row.available_actions.map(target=>({target,enabled:true,label:({ready:'Передать исполнителю',in_progress:row.status==='in_acceptance'?'Вернуть на доработку':'Начать работу',in_acceptance:'Передать на приёмку',done:'Принять результат',cancelled:'Отменить задачу'})[target],requires_input:target==='in_acceptance'||target==='done'?['result_text']:target==='cancelled'||row.status==='done'||row.status==='in_acceptance'?['reason']:[]}))});
 const column=(status,url)=>{
  const filter=url.searchParams.get('status')||'',included=(!filter||filter===status||filter==='active'&&!['done','cancelled'].includes(status)||filter==='active_done'&&status!=='cancelled')&&(url.searchParams.get('view')!=='acceptance'||status==='in_acceptance');
  const subset=rows.filter(x=>x.status===status),offset=url.searchParams.get('cursor')==='next'?20:0;
  return {status,title:titles[statuses.indexOf(status)],state:included?'included':'filtered',total:included?subset.length:null,items:included?subset.slice(offset,offset+20).map(project):[],range_start:included?offset+1:null,range_end:included?Math.min(offset+20,subset.length):null,next_cursor:included&&offset===0&&subset.length>20?'next':null,previous_cursor:offset?'previous':null};
 };
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,reply=json=>route.fulfill({json});
  if(path.endsWith('/options'))return reply({board_enabled:enabled,can_create:true,teams:[{id:10,name:'Команда'}],users:[{id:1,name:'Исполнитель',team_id:10}],projects:[{id:4,name:'Проект'}]});
  if(path.includes('/board')){
   reads.push(url.search);if(delay)await new Promise(r=>setTimeout(r,delay));
   if(!enabled)return route.fulfill({status:404,json:{detail:{code:'board_disabled',message:'Доска выключена'}}});
   if(path.includes('/columns/'))return reply({query_key:'test',column:column(path.split('/').at(-1),url)});
   const cols=statuses.map(x=>column(x,url)),total=cols.reduce((sum,x)=>sum+(x.total||0),0);
   const selected=rows.find(row=>row.id===Number(url.searchParams.get('selected_id')));
   return reply({query_key:'test',selected_matches:selected?cols.find(col=>col.status===selected.status).state==='included':null,filters:{status:url.searchParams.get('status'),view:url.searchParams.get('view')},columns:cols.slice(0,5),cancelled:cols[5],total,summary:{total},collection_counts:{all:total,mine:total,team:total,requested:total,acceptance:24}});
  }
  if(path.endsWith('/transitions')){
   const body=req.postDataJSON();writes.push(body);
   if(conflict)return route.fulfill({status:409,json:{detail:'Конфликт'}});
   const row=rows.find(x=>x.id===Number(path.split('/').at(-2)));row.status=body.status;row.version++;row.available_actions=body.status==='in_progress'?['in_acceptance','cancelled']:[];return reply(row);
  }
  if(/\/(history|comments|attachments)$/.test(path)||path.includes('work-dependencies'))return reply([]);
  const id=Number(path.match(/work-tasks\/(\d+)$/)?.[1]);if(id)return reply(rows.find(x=>x.id===id));
  return reply({items:rows.slice(0,20),total:rows.length,summary:{total:rows.length},collection_counts:{all:rows.length}});
 });
 await page.goto('/e2e/fixtures/workTasks.html#/work-tasks?display=board&view=all&status=active&sort=attention');
 if(enabled)await expect(page.locator('[data-board-column="ready"]')).toBeAttached();
 return {writes,rows,reads};
}

test('board uses independent pages and retains shared conditions when changing display',async({page})=>{
 await setup(page);
 await expect(page.locator('[data-board-column="done"]')).toHaveCount(0);
 await page.getByRole('button',{name:'Следующие: К исполнению',exact:true}).click();
 await expect(page.locator('[data-board-column="ready"]')).toContainText('21–24 из 24');
 await expect(page.locator('[data-board-column="new"]')).toContainText('1–20 из 24');
 await page.getByRole('button',{name:'Список',exact:true}).click();
 await expect(page.locator('.work-queue')).toBeVisible();
 await page.getByRole('button',{name:'Доска',exact:true}).click();
 await expect(page.locator('[data-board-column="ready"]')).toContainText('21–24 из 24');
 await page.locator('#work-status').selectOption('active_done');
 await page.locator('#work-done-period').selectOption('7d');
 await expect.poll(()=>page.url()).toContain('status=active_done');
 await expect(page.locator('[data-board-column="done"]')).toContainText('1–20 из 24');
});

test('selected detail remains open when its column is excluded by a filter',async({page})=>{
 await page.setViewportSize({width:1920,height:1080});await setup(page);
 await page.locator('[data-board-column="ready"] [data-work-id="101"]').click();
 await page.getByRole('button',{name:'Дополнительные фильтры',exact:true}).click();
 await page.locator('#work-status').selectOption('in_progress');
 await page.getByRole('button',{name:'Применить',exact:true}).click();
 await expect(page.locator('[data-membership-note]')).toContainText('больше не входит');
 await expect(page.getByRole('button',{name:'Закрыть',exact:true})).toBeVisible();
 expect(page.url()).toContain('/work-tasks/101?');
});

test('invalid URL filters require explicit reset instead of broadening the board',async({page})=>{
 await setup(page);
 await page.goto('/e2e/fixtures/workWorkspaceRouter.html#/work-tasks?display=board&status=unknown');
 await expect(page.getByRole('heading',{name:'Некорректные условия в ссылке'})).toBeVisible();
 await expect(page.locator('[data-board-column]')).toHaveCount(0);
 await page.getByRole('button',{name:'Сбросить условия',exact:true}).click();
 await expect(page.locator('[data-board-column="ready"]')).toBeAttached();
});

test('display switching supports browser back and forward',async({page})=>{
 await setup(page);
 await page.goto('/e2e/fixtures/workWorkspaceRouter.html#/work-tasks?display=board&view=all&status=active');
 await expect(page.locator('[data-board-column="ready"]')).toBeAttached();
 await page.getByRole('button',{name:'Список',exact:true}).click();await expect(page.locator('.work-queue')).toBeVisible();
 await page.goBack();await expect(page.locator('[data-board-column="ready"]')).toBeAttached();
 await page.goForward();await expect(page.locator('.work-queue')).toBeVisible();
});

test('menu begins work; result uses shared detail form and cancellation sends nothing',async({page})=>{
 const {writes}=await setup(page);
 await page.getByRole('button',{name:'Действия WRK-101',exact:true}).click();
 await page.getByRole('menuitem',{name:'Начать работу',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toEqual({version:1,status:'in_progress'});
 await expect(page.locator('[data-board-column="in_progress"] [data-work-id="101"]')).toBeVisible();
 await page.getByRole('button',{name:'Действия WRK-101',exact:true}).click();
 await page.getByRole('menuitem',{name:'Передать на приёмку',exact:true}).click();
 await expect(page.locator('.work-board-detail')).toBeVisible();
 await expect(page.locator('#wf-result_text')).toBeFocused();
 await expect(page.locator('.work-transition-form')).toContainText('Не выполнено пунктов: 1');
 await page.locator('#wf-result_text').fill('Сохранённый результат');
 await page.getByRole('button',{name:'Назад',exact:true}).click();expect(writes).toHaveLength(1);
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Действия WRK-101',exact:true}).click();
 await page.getByRole('menuitem',{name:'Передать на приёмку',exact:true}).click();
 await expect(page.locator('#wf-result_text')).toHaveValue('Сохранённый результат');
 await page.locator('[data-confirm-transition]').click();
 await expect.poll(()=>writes.length).toBe(2);expect(writes[1].result_text).toBe('Сохранённый результат');
});

test('drag and drop invokes same command only after a valid drop; Escape cancels',async({page})=>{
 await page.setViewportSize({width:1440,height:900});const {writes}=await setup(page);
 const source=page.locator('[data-board-card="101"]'),target=page.locator('[data-board-column="in_progress"] header');
 const from=await source.boundingBox(),to=await target.boundingBox();
 await page.mouse.move(from.x+3,from.y+55);await page.mouse.down();await page.mouse.move(to.x+30,to.y+22,{steps:10});
 await expect(page.locator('.is-dragging')).toHaveCount(1);await page.keyboard.press('Escape');await page.mouse.up();expect(writes).toHaveLength(0);
 const again=await source.boundingBox(), destination=await target.boundingBox();
 await page.mouse.move(again.x+3,again.y+55);await page.mouse.down();await page.mouse.move(destination.x+30,destination.y+22,{steps:10});
 await expect(page.locator('.is-drop-active')).toHaveAttribute('data-board-column','in_progress');
 await page.mouse.up();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0].status).toBe('in_progress');
});

for(const start of ['.work-board-title','.work-board-context','.work-board-person'])test(`drag starts on card content ${start}`,async({page})=>{
 await page.setViewportSize({width:1440,height:900});const {writes}=await setup(page);
 const source=page.locator('[data-board-card="101"]'),handle=source.locator(start);
 const from=await handle.boundingBox(),to=await page.locator('[data-board-column="in_progress"] header').boundingBox();
 await page.mouse.move(from.x+Math.min(30,from.width/2),from.y+from.height/2);
 await page.mouse.down();await page.mouse.move(to.x+30,to.y+22,{steps:12});
 await expect(page.locator('.is-dragging')).toHaveCount(1);
 await page.mouse.up();
 await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toEqual({version:1,status:'in_progress'});
 await expect(page.locator('[data-board-column="in_progress"] [data-work-id="101"]')).toBeVisible();
 await expect(page.locator('dialog')).toHaveCount(0);
});

test('title click still opens detail without a transition',async({page})=>{
 const {writes}=await setup(page);
 await page.locator('[data-board-card="101"] .work-board-title').click();
 await expect(page.locator('.work-board-detail')).toBeVisible();
 expect(writes).toHaveLength(0);
});

test('content drag rejects forbidden drops and asks for a required result',async({page})=>{
 await page.setViewportSize({width:1440,height:900});const {writes}=await setup(page);
 const move=async(id,status)=>{
  const from=await page.locator(`[data-board-card="${id}"] .work-board-title`).boundingBox();
  const to=await page.locator(`[data-board-column="${status}"] header`).boundingBox();
  await page.mouse.move(from.x+20,from.y+10);await page.mouse.down();
  await page.mouse.move(to.x+30,to.y+22,{steps:12});await page.mouse.up();
 };
 await move(101,'new');expect(writes).toHaveLength(0);
 await expect(page.locator('.is-dragging')).toHaveCount(0);
 await move(201,'in_acceptance');
 await expect(page.locator('.work-transition-form')).toBeVisible();
 await expect(page.locator('#wf-result_text')).toBeVisible();
 expect(writes).toHaveLength(0);
});

test('conflict retains entered result, background updates do not overwrite it',async({page})=>{
 const {writes}=await setup(page,{conflict:true});
 await page.getByRole('button',{name:'Действия WRK-201',exact:true}).click();
 await page.getByRole('menuitem',{name:'Передать на приёмку',exact:true}).click();
 await page.locator('#wf-result_text').fill('Не терять ввод');
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('dmb:work-changed',{detail:{id:201}})));
 await page.locator('[data-confirm-transition]').click();
 await expect(page.locator('.work-error')).toContainText('изменены другим');
 await expect(page.locator('#wf-result_text')).toHaveValue('Не терять ввод');expect(writes).toHaveLength(1);
});

test('flag off offers list without board requests',async({page})=>{
 const {reads}=await setup(page,{enabled:false});await expect(page.getByText('Доска рабочих задач пока выключена.',{exact:false})).toBeVisible();expect(reads).toHaveLength(0);
 await page.getByRole('button',{name:'Список',exact:true}).click();await expect(page.locator('.work-queue')).toBeVisible();
});

test('a column error retains other data and can be retried without clearing filters',async({page})=>{
 await setup(page);let failed=false;
 await page.route('**/work-tasks/board/columns/ready?**',async route=>{if(!failed){failed=true;return route.fulfill({status:503,json:{detail:'Повторите чтение'}});}return route.fallback();});
 await page.getByRole('button',{name:'Следующие: К исполнению',exact:true}).click();
 await expect(page.locator('[data-column-error="ready"]')).not.toBeEmpty();
 await expect(page.locator('[data-board-column="new"]')).toContainText('1–20 из 24');
 await page.locator('[data-column-error="ready"] button').click();
 await expect(page.locator('[data-board-column="ready"]')).toContainText('21–24 из 24');
});

test('background update preserves the open menu and keyboard action',async({page})=>{
 const {writes,reads}=await setup(page);
 await page.getByRole('button',{name:'Действия WRK-101',exact:true}).click();
 const before=reads.length;
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('dmb:work-changed')));
 await expect.poll(()=>reads.length).toBeGreaterThan(before);
 await expect(page.getByRole('menuitem',{name:'Начать работу',exact:true})).toBeVisible();
 await page.getByRole('menuitem',{name:'Начать работу',exact:true}).focus();await page.keyboard.press('Enter');
 await expect.poll(()=>writes.length).toBe(1);
});

test('mobile cancelled selection remains available and persists in URL',async({page})=>{
 await page.setViewportSize({width:390,height:844});await setup(page);
 await page.getByRole('button',{name:'Дополнительные фильтры',exact:true}).click();
 await page.locator('#work-status').selectOption('');
 await page.getByRole('button',{name:'Показать задачи',exact:true}).click();
 await page.getByLabel('Этап',{exact:true}).selectOption('cancelled');
 await expect(page.locator('[data-board-column="cancelled"]')).toBeVisible();
 await expect.poll(()=>page.url()).toContain('column=cancelled');
 await page.reload();await expect(page.locator('[data-board-column="cancelled"]')).toBeVisible();
});

for(const width of [320,390,768,1024,1280,1440,1920])for(const theme of ['light','dark'])test(`board layout ${width} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:width===1280?600:900});await setup(page);
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width<640){await expect(page.getByLabel('Этап',{exact:true})).toBeVisible();await page.getByLabel('Этап',{exact:true}).selectOption('ready');await expect(page.locator('[data-board-column="new"]')).toBeHidden();}
 await page.screenshot({path:info.outputPath('board.png'),fullPage:true});
 await page.locator('[data-board-column="ready"] [data-work-id]').first().click();
 await expect(page.getByRole('button',{name:'Закрыть',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(width>=1280)await expect(page.locator('.work-dialog-inline')).toBeVisible();else await expect(page.locator('dialog:modal.work-board-detail')).toBeVisible();
 await page.screenshot({path:info.outputPath('board-detail.png'),fullPage:true});
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await expect(page.locator('[data-board-column="ready"]')).toBeVisible();
});
