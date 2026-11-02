import {test,expect} from '@playwright/test';

test('focus selection persists across list and board',async({page})=>{
 const {queries}=await setup(page);
 await page.locator('[data-work-focus=today]').click();
 await expect.poll(()=>queries.at(-1).get('focus')).toBe('today');
 await page.getByRole('button',{name:'Доска',exact:true}).click();
 await expect(page.locator('[data-board-column]')).toHaveCount(4);
 expect(queries.at(-1).get('focus')).toBe('today');
 await page.locator('[data-work-focus=today]').click();
 await expect.poll(()=>queries.at(-1).has('focus')).toBe(false);
});

test('groups collapse without a request and survive refresh',async({page})=>{
 const {queries}=await setup(page);await page.getByRole('button',{name:'Группировать задачи'}).click();const group=page.locator('[data-work-group]').first();
 const name=await group.getAttribute('data-work-group'),count=queries.length;
 await group.click();await expect(group).toHaveAttribute('aria-expanded','false');expect(queries.length).toBe(count);
 await expect(group.locator('xpath=ancestor::tbody').locator('[data-work-row]').first()).toBeHidden();
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('dmb:work-changed')));
 await expect.poll(()=>queries.length).toBeGreaterThan(count);
 await expect(page.locator(`[data-work-group="${name}"]`)).toHaveAttribute('aria-expanded','false');
});

test('personal queue hides own assignee but keeps acceptance actor and mobile counts',async({page})=>{
 await setup(page,{width:390});await page.locator('#work-view').selectOption('mine');
 await expect(page.locator('[data-work-row="1"] .work-queue-person-line')).toBeHidden();
 await expect(page.locator('[data-work-row="2"] .work-queue-person')).toContainText('Ожидает приёмки');
 await expect(page.locator('[data-work-row="2"] .work-queue-person small')).toHaveText('Анна');
 await expect(page.locator('[data-work-row="1"] .work-personal-next')).not.toBeEmpty();
 const next=await page.locator('[data-work-row="1"] .work-personal-next').boundingBox();
 const status=await page.locator('[data-work-row="1"] .work-queue-status').boundingBox();
 expect(status.y).toBeGreaterThanOrEqual(next.y+next.height);
 await expect(page.locator('#work-view option[value=all]')).toHaveText('Все доступные · 2');
 await page.locator('#work-view').selectOption('team');await expect(page.locator('[data-work-row="1"] .work-queue-person-line')).toBeVisible();
});

test('mobile filters pin apply last, cancel edits and contain keyboard focus',async({page})=>{
 const {queries}=await setup(page,{width:390});
 await page.getByRole('button',{name:'Дополнительные фильтры',exact:true}).click();
 const panel=page.getByRole('dialog',{name:'Фильтры рабочих задач'});await expect(panel).toBeVisible();const count=queries.length;
 await page.locator('#work-status').selectOption('active_done');
 await page.locator('#work-done-period').selectOption('7d');expect(queries.length).toBe(count);
 const apply=page.getByRole('button',{name:'Показать задачи',exact:true});
 const rect=await apply.boundingBox();expect(rect.y+rect.height).toBeGreaterThan(820);
 await page.getByRole('button',{name:'Закрыть фильтры',exact:true}).press('Shift+Tab');
 await expect(page.getByRole('button',{name:'Отмена',exact:true})).toBeFocused();
 await page.keyboard.press('Escape');await expect(panel).toBeHidden();expect(page.url()).not.toContain('done_period=7d');
 await page.getByRole('button',{name:'Дополнительные фильтры',exact:true}).click();
 await page.locator('#work-status').selectOption('active_done');
 await page.locator('#work-done-period').selectOption('7d');await apply.click();
 await expect.poll(()=>queries.at(-1).get('done_period')).toBe('7d');expect(queries.at(-1).get('status')).toBe('active_done');
});

test('creation progressively reveals acceptance, priority and extra parameters',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Создать задачу',exact:true}).click();
 await expect(page.locator('#wf-title')).toBeVisible();await expect(page.locator('#wf-assignee_id')).toBeVisible();
 await expect(page.locator('#wf-priority')).toBeHidden();await expect(page.locator('#wf-acceptor_id')).toBeHidden();
 await page.locator('#wf-acceptance_required').selectOption('true');await expect(page.locator('#wf-acceptor_id')).toBeVisible();
 await page.locator('#wf-acceptance_required').selectOption('false');await expect(page.locator('#wf-acceptor_id')).toBeHidden();
 await page.getByText('Приоритет и чек-лист',{exact:true}).click();await expect(page.locator('#wf-priority')).toBeVisible();
 await page.getByText('Дополнительные параметры',{exact:true}).click();await expect(page.locator('#wf-execution_team_id')).toBeVisible();
});

test('blocked card agrees with next step and preserves completion as secondary action',async({page})=>{
 const {rows}=await setup(page);Object.assign(rows[0],{status:'in_progress',blocked_reason:'Ожидаем ответ',available_actions:['done'],next_step:{kind:'blocker',label:'Снять препятствие',actor_name:'Иван'}});
 await page.locator('[data-work-id="1"]').click();
 await expect(page.locator('.work-next-step')).toContainText('Иван: Снять препятствие');
 await expect(page.getByRole('button',{name:'Снять препятствие',exact:true})).toHaveClass(/btn-primary/);
 await expect(page.getByRole('button',{name:'Завершить',exact:true})).toHaveClass(/btn-secondary/);
});

async function setup(page,{display='list',status='active',conflict=false,summary={total:2,done:0},width=1440,theme='light'}={}){
 await page.setViewportSize({width,height:900});
 const queries=[],writes=[];
 const rows=[{id:1,public_id:'WRK-1',title:'Подготовить согласованный результат для запуска нового продукта',description:'Согласовать критерии готовности',status:'ready',version:1,execution_team_id:10,requester_id:2,assignee_id:1,assignee_name:'Иван Александрович Петров',acceptor_id:2,acceptor_name:'Анна',due_date:'2026-11-01',assignment_state:'accepted',priority:'normal',can_edit:true,can_block:true,can_collaborate:true,available_actions:['in_progress','cancelled'],checklist:[]},
 {id:2,public_id:'WRK-2',title:'Принять результат',description:'Ожидаемый результат',result_text:'Предъявленный результат работы',status:'in_acceptance',version:1,execution_team_id:10,requester_id:1,assignee_id:1,assignee_name:'Иван',acceptor_id:2,acceptor_name:'Анна',assignment_state:'accepted',priority:'high',available_actions:['done','in_progress'],can_collaborate:true,checklist:[]}];
 let failed=false;
 await page.route('**/api/v1/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,reply=json=>route.fulfill({json});
  if(path.endsWith('/options'))return reply({board_enabled:true,can_create:true,teams:[{id:10,name:'Команда продукта'}],users:[{id:1,name:'Иван',team_id:10},{id:2,name:'Анна',team_id:10}],projects:[]});
  if(request.method()==='PATCH'){
   writes.push(request.postDataJSON());if(conflict&&!failed){failed=true;rows[0].version++;rows[0].description='Изменено другим участником';return route.fulfill({status:409,json:{detail:'Конфликт'}});}
   Object.assign(rows[0],request.postDataJSON());return reply(rows[0]);
  }
  if(path.endsWith('/transitions')){writes.push(request.postDataJSON());return reply({...rows[0],status:request.postDataJSON().status});}
  if(/\/(history|comments|attachments)$/.test(path)||path.includes('work-dependencies'))return reply([]);
  if(path.endsWith('/work-task-templates'))return reply({items:[]});
  const id=Number(path.match(/work-tasks\/(\d+)$/)?.[1]);if(id)return reply(rows.find(x=>x.id===id));
  queries.push(url.searchParams);
  if(path.endsWith('/board')){
   const statuses=['new','ready','in_progress','in_acceptance','done','cancelled'];
   const cols=statuses.map((s,i)=>{const included=url.searchParams.get('status')==='active_done'?s!=='cancelled':url.searchParams.get('status')==='active'?!['done','cancelled'].includes(s):url.searchParams.get('status')===s;const items=rows.filter(x=>x.status===s);return {status:s,title:['Новые','К исполнению','В работе','На приёмке','Выполнены','Отменённые'][i],state:included?'included':'filtered',items:included?items:[],total:included?items.length:null,range_start:1,range_end:items.length};});
   return reply({columns:cols.slice(0,5),cancelled:cols[5],filters:{status:url.searchParams.get('status'),view:'all'},summary,total:2,collection_counts:{all:2},query_key:'test'});
  }
  return reply({items:rows,total:2,summary,focus_counts:{overdue:99,blocked:99},attention_items:rows,collection_counts:{all:2}});
 });
 await page.goto(`/e2e/fixtures/workTasks.html#/work-tasks?display=${display}&view=all&status=${status}`);
 await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 await expect(page.getByRole('heading',{name:'Рабочие задачи',exact:true})).toBeVisible();
 await expect.poll(()=>queries.length).toBeGreaterThan(0);
 return {queries,writes,rows};
}

test('approved list keeps filtered totals, optional grouping and unclipped row menu',async({page})=>{
 await setup(page,{summary:{total:2,overdue:1,blocked:2}});
 await expect(page.locator('.work-queue-heading')).toHaveText('2 задачи1 просрочена·2 с препятствием');
 await expect(page.locator('[data-work-group]')).toHaveCount(0);
 const menu=await page.locator('[data-queue-menu]').first().boundingBox();
 const panel=await page.locator('.work-queue-panel').boundingBox();
 expect(menu.x+menu.width).toBeLessThanOrEqual(panel.x+panel.width);
 await expect(page.locator('[data-work-focus=blocked]')).toHaveAttribute('aria-pressed','false');
 await page.locator('[data-work-focus=blocked]').click();
 await expect(page.locator('[data-work-focus=blocked]')).toHaveAttribute('aria-pressed','true');
});

test('filters apply atomically, cancel, preserve collection and expose chips',async({page})=>{
 const {queries}=await setup(page,{width:390});
 await page.getByRole('button',{name:'Дополнительные фильтры',exact:true}).click();
 const count=queries.length;
 await page.locator('#work-priority').selectOption('high');
 await page.locator('[data-attention-draft=blocked]').check();
 await expect.poll(()=>queries.length).toBe(count);
 await page.getByRole('button',{name:'Отмена',exact:true}).click();
 expect(page.url()).not.toContain('priority=');
 await page.getByRole('button',{name:'Дополнительные фильтры',exact:true}).click();
 await expect(page.locator('#work-priority')).toHaveValue('');
 await page.locator('#work-priority').selectOption('high');
 await page.getByRole('button',{name:'Показать задачи',exact:true}).click();
 await expect(page.locator('[data-remove-filter=work-priority]')).toBeVisible();
 await page.locator('[data-work-action=reset]').click();
 expect(page.url()).toContain('view=all');expect(page.url()).not.toContain('priority=');
});

test('summary distinguishes filtered, unknown and zero metrics',async({page})=>{
 await setup(page,{display:'summary'});
 await expect(page.locator('[data-work-metric=done]')).toHaveText('Выполнены · Не включены');
 await expect(page.locator('[data-work-metric=blocked]')).toHaveText('Есть препятствие · —');
 await page.locator('#work-status').selectOption('active_done');
 await page.locator('#work-done-period').selectOption('7d');
 await expect(page.locator('[data-work-metric=done]')).toHaveText('Выполнены · 0');
});

test('single-page board has four columns, no disabled pager, explicit completed control',async({page})=>{
 await setup(page,{display:'board'});
 await expect(page.locator('[data-board-column]')).toHaveCount(4);
 await expect(page.locator('[data-board-page]')).toHaveCount(0);
 await expect(page.locator('[data-board-menu="1"]')).toHaveText('⋯');
 await expect(page.locator('.work-board-context')).toHaveCount(0);
 await page.locator('#work-status').selectOption('active_done');
 await page.locator('#work-done-period').selectOption('30d');
 await expect(page.locator('[data-board-column]')).toHaveCount(5);
 expect(page.url()).toContain('done_period=30d');
});

test('acceptance result is above properties and templates are absent from reading',async({page})=>{
 await setup(page);await page.locator('[data-work-id="2"]').click();
 await expect(page.locator('.work-saved-result')).toContainText('Предъявленный результат');
 expect(await page.locator('.work-saved-result').evaluate(el=>!!(el.compareDocumentPosition(document.querySelector('.work-card-properties'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
 await expect(page.locator('[data-work-templates]')).toHaveCount(0);
 await expect(page.locator('#wf-title')).toBeHidden();
});

test('changing display preserves the actual editor and its draft',async({page})=>{
 await setup(page);await page.locator('[data-work-id="1"]').click();await page.getByRole('button',{name:'Редактировать',exact:true}).click();
 await page.locator('#wf-title').fill('Несохранённый текст');
 await page.locator('#wf-title').evaluate(el=>el.dataset.identity='same');
 await page.getByRole('button',{name:'Доска',exact:true}).click();
 await expect(page.locator('#wf-title')).toHaveValue('Несохранённый текст');
 await expect(page.locator('#wf-title')).toHaveAttribute('data-identity','same');
 await expect(page.locator('.work-dialog')).toHaveCount(1);
});

test('conflict compares versions and retries only after explicit review',async({page})=>{
 const {writes}=await setup(page,{conflict:true});await page.locator('[data-work-id="1"]').click();await page.getByRole('button',{name:'Редактировать',exact:true}).click();
 await page.locator('#wf-title').fill('Мой текст');await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
 await expect(page.locator('[data-work-conflict]')).toContainText('Изменено другим участником');expect(writes).toHaveLength(1);
 await page.getByRole('button',{name:'Загрузить актуальную версию и мой черновик',exact:true}).click();
 await expect(page.locator('#wf-title')).toHaveValue('Мой текст');await expect(page.locator('#wf-description')).toHaveValue('Изменено другим участником');
 await page.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(2);expect(writes[1].version).toBe(2);
});

test('resizing preserves editor DOM while switching between panel and modal',async({page})=>{
 await setup(page);await page.locator('[data-work-id="1"]').click();await page.getByRole('button',{name:'Редактировать',exact:true}).click();await page.locator('#wf-title').fill('Текст при изменении ширины');
 await page.locator('#wf-title').evaluate(el=>el.dataset.identity='same');
 await page.setViewportSize({width:768,height:900});await expect(page.locator('dialog:modal')).toBeVisible();
 await expect(page.locator('#wf-title')).toHaveValue('Текст при изменении ширины');
 await page.setViewportSize({width:1440,height:900});await expect(page.locator('dialog:modal')).toHaveCount(0);
 await expect(page.locator('#wf-title')).toHaveAttribute('data-identity','same');
 await page.locator('[data-work-id="2"]').focus();await expect(page.locator('[data-work-id="2"]')).toBeFocused();
});

test('background update retains an open list menu',async({page})=>{
 await setup(page);await page.locator('[data-queue-menu="1"]').click();await page.evaluate(()=>document.dispatchEvent(new CustomEvent('dmb:work-changed')));
 await page.waitForTimeout(450);await expect(page.getByRole('menuitem',{name:'Начать работу',exact:true})).toBeVisible();await page.keyboard.press('Escape');
 await expect(page.locator('[data-work-row]')).toHaveCount(2);
});

for(const width of [320,390,768,1024,1280,1440,1920])for(const theme of ['light','dark'])test(`layout ${width} ${theme}`,async({page},testInfo)=>{
 await setup(page,{width,theme,display:'board'});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
 // The toolbar keeps search and quick filters visible on narrow screens.
 if(width<640){await page.locator('#work-board-column').selectOption('ready');await page.screenshot({path:testInfo.outputPath('board.png')});const card=await page.locator('[data-board-card="1"]').boundingBox();expect(card.y).toBeLessThanOrEqual(420);}
 await page.locator('[data-work-id="1"]').click();
 await expect(page.locator('.work-dialog')).toBeVisible();
 expect(await page.locator('.work-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 if(width===1440)await page.screenshot({path:testInfo.outputPath('detail.png'),fullPage:true});
});
