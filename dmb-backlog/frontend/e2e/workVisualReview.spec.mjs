import {test,expect} from '@playwright/test';
const row={id:1,public_id:'WRK-1',title:'Подготовить протокол встречи',description:'Ожидаемый результат',status:'in_progress',assignee_id:1,assignee_name:'Аналитик',execution_team_id:10,due_date:'2025-10-14',version:1,can_edit:true,can_block:true,can_collaborate:true,blocked_reason:'Ждём данные',available_actions:['done','cancelled']};
async function setup(page,width=1440,dueDate=row.due_date){
 await page.setViewportSize({width,height:width<900?844:900});const writes=[];
 await page.route('**/api/v1/**',r=>{const path=new URL(r.request().url()).pathname;if(r.request().method()!=='GET')writes.push(r.request().method());return r.fulfill({json:path.endsWith('/options')?{can_create:true,teams:[{id:10,name:'Аналитика'}],users:[{id:1,name:'Аналитик',team_id:10}],projects:[]}:path.endsWith('/work-tasks/1')?{...row,due_date:dueDate}:/\/(comments|history|attachments|dependencies)$/.test(path)?[]:{items:Array.from({length:12},(_,i)=>({...row,id:i+1,public_id:'WRK-'+(i+1)})),total:12,summary:{total:12},collection_counts:{mine:12},focus_counts:{today:0,overdue:12,blocked:12}}});});
 await page.goto('/e2e/fixtures/workTasks.html#/work-tasks');await expect(page.locator('html')).toHaveAttribute('data-work-fixture-ready','true');return writes;
}
test('V02 filter overlay preserves queue coordinates',async({page})=>{await setup(page);const a=await page.locator('.work-queue-panel').boundingBox();await page.locator('[data-work-action=filters]').click();const b=await page.locator('.work-queue-panel').boundingBox();expect(Math.abs(a.y-b.y)).toBeLessThanOrEqual(1);expect(await page.locator('[data-work-row]').evaluateAll(rows=>rows.filter(el=>el.getBoundingClientRect().bottom<=innerHeight).length)).toBeGreaterThanOrEqual(5);});
for(const theme of ['light','dark'])test(`V01 V03 V04 V06 V07 ${theme}`,async({page},info)=>{
 await setup(page);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.locator('[data-work-id="1"]').click();await expect(page.locator('.work-card-title')).toBeVisible();
 const a=await page.locator('.work-card-title').boundingBox();await page.locator('[data-card-menu-trigger]').click();await expect(page.getByRole('menu',{name:'Дополнительные действия'})).toBeVisible();const b=await page.locator('.work-card-title').boundingBox();expect(Math.abs(a.y-b.y)).toBeLessThanOrEqual(1);await page.keyboard.press('Escape');await expect(page.locator('[data-card-menu]')).toBeHidden();
 const fields=page.locator('.work-card-properties').first();await expect(fields).toContainText('14 октября 2025');for(const tag of ['dt','dd']){const p=await fields.locator(tag).nth(0).boundingBox(),q=await fields.locator(tag).nth(1).boundingBox();expect(Math.abs(p.y-q.y)).toBeLessThanOrEqual(1);}
 expect((await page.locator('[data-work-row]').first().boundingBox()).height).toBeLessThanOrEqual(88);
 const contrast=await page.locator('.work-queue-due.work-warning').first().evaluate(el=>{const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number),lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);let bg=el;while(bg&&getComputedStyle(bg).backgroundColor==='rgba(0, 0, 0, 0)')bg=bg.parentElement;const l=[lum(rgb(getComputedStyle(el).color)),lum(rgb(bg?getComputedStyle(bg).backgroundColor:'rgb(255,255,255)'))].sort((a,b)=>b-a);return(l[0]+.05)/(l[1]+.05);});expect(contrast).toBeGreaterThanOrEqual(4.5);await page.screenshot({path:info.outputPath(`inspector-${theme}.png`)});
});
for(const width of [320,390])test(`V05 V08 V23 V24 mobile ${width}`,async({page},info)=>{
 await setup(page,width);const fit=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await fit();for(const el of await page.locator('[data-work-focus]').all())await expect(el).toBeInViewport({ratio:1});expect((await page.locator('[data-work-id="1"]').boundingBox()).height).toBeGreaterThanOrEqual(44);expect((await page.locator('[data-work-row]').first().boundingBox()).y).toBeLessThanOrEqual(300);
 await page.locator('[data-work-action=filters]').click();await fit();await page.keyboard.press('Escape');await fit();await page.locator('[data-work-id="1"]').click();await expect(page.locator('.work-card-title')).toBeVisible();await fit();await page.locator('[data-close]').click();await fit();await page.screenshot({path:info.outputPath(`mobile-${width}.png`)});
});
test('V22 local error persists without creating a task',async({page})=>{const writes=await setup(page);await page.locator('[data-work-action=create]').click();await page.getByRole('button',{name:'Создать',exact:true}).click();await expect(page.locator('#wf-title')).toHaveAttribute('aria-invalid','true');await page.locator('#wf-description').focus();await expect(page.getByText('Укажите название задачи',{exact:true}).last()).toBeVisible();expect(writes).toEqual([]);});

test('V20 mixed activity is chronological and composer draft survives filters',async({page})=>{
 await setup(page);
 await page.route('**/work-tasks/1/comments?**',r=>r.fulfill({json:[{id:1,author_id:1,body:'Поздний комментарий',created_at:'2026-10-30T12:00:00Z'}]}));
 await page.route('**/work-tasks/1/history?**',r=>r.fulfill({json:[{id:1,action:'created',actor_name:'Аналитик',created_at:'2026-10-30T10:00:00Z'}]}));
 await page.locator('[data-work-id="1"]').click();await page.getByRole('tab',{name:'Активность',exact:true}).click();
 await expect(page.locator('.work-activity-timeline > article').first()).toHaveClass('work-comment');
 await page.locator('#wf-comment').fill('Черновик обсуждения');await page.locator('[data-activity-mode=history]').click();await page.locator('[data-activity-mode=comments]').click();await expect(page.locator('#wf-comment')).toHaveValue('Черновик обсуждения');
});
test('V25 personal board preserves a different responsible person',async({page})=>{
 await setup(page);
 const actors=await page.evaluate(async()=>{const {boardCard}=await import('/js/components/workBoard.js');return [boardCard({id:1,title:'Работа',status:'in_progress',assignee_id:1,assignee_name:'Исполнитель'},null,{personal:true,userId:1}),boardCard({id:2,title:'Приёмка',status:'in_acceptance',assignee_id:1,acceptor_name:'Приёмщик'},null,{personal:true,userId:1}),boardCard({id:3,title:'Командная',status:'in_progress',assignee_id:1,assignee_name:'Исполнитель'},null,{personal:false,userId:1})].map(html=>new DOMParser().parseFromString(html,'text/html').querySelector('.work-board-person')?.textContent?.trim()||null);});
 expect(actors).toEqual([null,'Приёмщик','Исполнитель']);
});


for(const dueDate of [new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'}),new Date(Date.now()+86400000).toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'}),'2025-01-01',null])test(`V07 exact due date ${dueDate}`,async({page})=>{await setup(page,390,dueDate);await page.locator('[data-work-id="1"]').click();await expect(page.locator('.work-card-properties').first()).toContainText(dueDate?new Date(dueDate+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}):'Без срока');});
