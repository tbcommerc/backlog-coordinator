import {test,expect} from '@playwright/test';
async function setup(page,{status='in_acceptance',empty=false}={}) {
 const row={id:1,public_id:'WRK-1',title:'Проверить длинное название и доступность основного решения '.repeat(4),description:'Ожидаемый результат',result_text:'Результат исполнителя',result_revision:4,execution_team_id:10,requester_id:2,assignee_id:1,acceptor_id:2,due_date:'2026-11-01',status,assignment_state:'accepted',version:1,can_edit:true,can_collaborate:true,can_block:true,available_actions:status==='in_acceptance'?['done','in_progress']:['in_acceptance'],acceptance_required:true,next_step:{label:'Проверить результат',actor_name:'Приёмщик'}};
 const writes=[];let delayedRead=null;
 const state={row,writes,delayNext:false,release:()=>delayedRead?.()};
 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,reply=json=>route.fulfill({json});
  if(path.endsWith('/options'))return reply({can_create:true,teams:[{id:10,name:'Команда'}],users:[{id:1,name:'Исполнитель',team_id:10,login_notice:'Приглашение не принято'},{id:2,name:'Приёмщик',team_id:10}],projects:[]});
  if(/\/(history|comments|attachments)$/.test(path)||path.includes('work-dependencies'))return reply([]);
  if(req.method()==='POST'||req.method()==='PATCH'){const body=req.postDataJSON();writes.push(body);Object.assign(row,body,{version:row.version+1});return reply(row);}
  if(path.endsWith('/1')){const snapshot={...row};if(state.delayNext){state.delayNext=false;await new Promise(resolve=>delayedRead=resolve);}return reply(snapshot);}
  if(/work-tasks\/\d+$/.test(path))return reply({...row,id:Number(path.split('/').at(-1))});
  const n=Number(url.searchParams.get('page')||1);
  return reply({items:empty?[]:Array.from({length:n===3?1:30},(_,i)=>({...row,id:(n-1)*30+i+1,public_id:`WRK-${(n-1)*30+i+1}`})),total:empty?0:61,summary:{total:empty?0:61},collection_counts:{mine:empty?0:61,acceptance:0,requested:0,team:61,all:61}});
 });
 await page.goto('/e2e/fixtures/workTasks.html#/work-tasks?view=mine');
 await expect(page.locator('.work-results')).toContainText(empty?'Вам пока не назначены':'WRK-1');
 return state;
}
for(const [width,height] of [[1440,900],[1280,720],[320,800]])test(`audit decision visible ${width}`,async({page})=>{
 await page.setViewportSize({width,height});await setup(page);
 await page.getByRole('button',{name:'Дополнительные фильтры'}).click();
 await page.locator('#work-priority').selectOption('high');
 await page.getByRole('button',{name:/^(Применить|Показать задачи)$/}).click();
 await page.locator('[data-work-id="1"]').click();
 await page.locator('.work-error').evaluate(el=>el.textContent='Не удалось сохранить изменения. Проверьте соединение и повторите действие. Ваш ввод сохранён.');
 await expect(page.locator('.work-card-title')).toBeInViewport();
 await expect(page.locator('[data-work-action="transition:done"]')).toBeInViewport();
 const box=await page.locator('[data-work-action="transition:done"]').boundingBox();expect(box.y+box.height).toBeLessThanOrEqual(height);
 await page.screenshot({path:`test-results/audit-decision-${width}.png`});
});
test('acceptance submits version without result editor or overwrite',async({page})=>{
 const {writes}=await setup(page);await page.locator('[data-work-id="1"]').click();
 await page.locator('[data-work-action="transition:done"]').click();await expect(page.locator('#wf-result_text')).toHaveCount(0);
 await page.locator('[data-confirm-transition]').click();await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({version:1,status:'done'});expect(writes[0]).not.toHaveProperty('result_text');
});

test('session end closes the selected card before the login page replaces its host',async({page})=>{
 await setup(page);await page.locator('[data-work-id="1"]').click();
 await expect(page.locator('.work-dialog')).toBeVisible();
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('dmb:session-ended')));
 await expect(page.locator('.work-dialog')).toHaveCount(0);
});

test('removing the workplace never promotes its inspector to a modal',async({page})=>{
 await setup(page);await page.locator('[data-work-id="1"]').click();
 await expect(page.locator('.work-dialog-inline')).toBeVisible();
 await page.locator('.work-task-workplace').evaluate(el=>el.remove());
 await page.setViewportSize({width:1100,height:720});
 await expect(page.locator('.work-dialog')).toHaveCount(0);
});

test('narrow filters, distinct queues and explicit activity',async({page})=>{
 await page.setViewportSize({width:320,height:800});await setup(page);
 await expect(page.locator('.work-focus-nav [data-work-collection]')).toHaveCount(0);
 const first=await page.locator('[data-work-row]').first().boundingBox();expect(first.y).toBeLessThanOrEqual(240);
 await page.getByRole('button',{name:'Дополнительные фильтры'}).click();
 const a=await page.locator('#work-priority').boundingBox(),b=await page.locator('#work-direction').boundingBox();expect(a.x).toBe(b.x);expect(b.y).toBeGreaterThan(a.y+a.height);
 await page.getByRole('button',{name:'Отмена',exact:true}).click();await page.locator('[data-work-id="1"]').click();
 await page.getByRole('tab',{name:'Активность'}).click();await page.getByRole('button',{name:'Изменения',exact:true}).click();await expect(page.locator('.work-comment-form')).toBeHidden();await expect(page.locator('[data-work-history]')).toBeVisible();
});

test('compact mobile display preserves context below a 64px application header',async({page})=>{
 await page.setViewportSize({width:320,height:800});await setup(page);
 await page.addStyleTag({content:'body { margin:0; } main { padding-top:64px; }'});
 const first=await page.locator('[data-work-row]').first().boundingBox();expect(first.y).toBeLessThanOrEqual(240);
 await page.getByRole('combobox',{name:'Представление задач',exact:true}).selectOption('summary');
 await expect(page).toHaveURL(/display=summary/);
 await page.getByRole('combobox',{name:'Представление задач',exact:true}).selectOption('list');
 await expect(page.locator('.work-queue')).toBeVisible();
 await expect(page).toHaveURL(/view=mine/);
});
test('pagination focuses top and return restores row',async({page})=>{
 await setup(page);await page.locator('[data-page-scope="work"][data-page="1"]').click();
 await expect(page.locator('.work-results')).toBeFocused();await expect(page.locator('[data-work-id="31"]')).toBeInViewport();await expect(page.locator('caption')).toContainText('31–60 из 61');
 await page.locator('[data-work-id="31"]').click();await page.keyboard.press('Escape');await expect(page.locator('[data-work-id="31"]')).toBeFocused();expect(page.url()).toContain('page=2');
});
test('late own read is ignored and foreign version preserves draft',async({page})=>{
 const state=await setup(page,{status:'in_progress'});await page.locator('[data-work-id="1"]').click();await page.getByRole('button',{name:'Редактировать',exact:true}).click();await page.locator('#wf-title').fill('Мой текст');
 state.delayNext=true;await page.evaluate(()=>document.dispatchEvent(new CustomEvent('dmb:work-changed')));
 await expect.poll(()=>state.delayNext).toBe(false);await page.getByRole('button',{name:'Сохранить изменения'}).click();await expect.poll(()=>state.writes.length).toBe(1);state.release();
 await expect(page.locator('.work-card-title')).toHaveText('Мой текст');await expect(page.locator('.work-save-status')).not.toContainText('другим участником');
 await page.getByRole('button',{name:'Редактировать',exact:true}).click();await page.locator('#wf-title').fill('Не потерять ввод');state.row.version++;
 await page.evaluate(()=>document.dispatchEvent(new CustomEvent('dmb:work-changed')));await expect(page.locator('.work-save-status')).toContainText('другим участником');await expect(page.locator('#wf-title')).toHaveValue('Не потерять ввод');
 await expect(page.locator('.work-assignment-warning')).toContainText('Приглашение не принято');
});
