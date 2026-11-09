import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
import {setupWorkDesignPilot} from './helpers/workDesignPilot.mjs';
for(const theme of ['light','dark'])for(const width of [320,390,1280])test(`segment catalog ${theme} ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/ui-catalog/segmented.html');if(theme==='dark')await page.locator('#catalog-theme').click();
 const scope=page.locator('#segment-scope');await expect(scope).toHaveAttribute('data-segment-ready','');
 await expect(scope.locator('button[tabindex="0"]')).toHaveCount(1);await scope.getByRole('button',{name:'Команда',exact:true}).click();await expect(scope.getByRole('button',{name:'Команда',exact:true})).toHaveAttribute('aria-pressed','true');
 const measure=()=>scope.evaluate(g=>{const b=g.querySelector('[aria-pressed=true]').getBoundingClientRect(),t=g.querySelector('.ui-segment-thumb').getBoundingClientRect();return{offset:Math.abs(t.x-b.x),width:Math.abs(t.width-b.width),height:g.getBoundingClientRect().height}});
 await expect.poll(async()=>{const m=await measure();return m.offset+m.width}).toBeLessThan(1);
 await scope.getByRole('button',{name:'Команда',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(scope.getByRole('button',{name:'Трайб',exact:true})).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Home');await expect(scope.getByRole('button',{name:'Команда',exact:true})).toBeFocused();
 const partial=page.locator('#segment-partial');await partial.getByRole('button',{name:'Первый'}).focus();await page.keyboard.press('ArrowRight');await expect(partial.getByRole('button',{name:'Третий'})).toBeFocused();await expect(page.locator('#segment-disabled button:disabled')).toHaveCount(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 const h=await scope.boundingBox(),button=await page.locator('[data-demo=scope] > .btn').boundingBox();expect(Math.abs(h.height-button.height)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath('catalog.png'),fullPage:true});
});
test('thumb follows controlled state, resize and lifecycle; no optimistic selection',async({page})=>{
 await page.goto('/ui-catalog/segmented.html');
 await page.evaluate(async()=>{const {segmentedControl}=await import('/js/ui/segmented.js');const host=document.createElement('div');host.id='controlled';host.innerHTML=segmentedControl({label:'Контролируемый выбор',value:'a',items:[{value:'a',label:'Первый'},{value:'b',label:'Длинное второе значение'}]});document.body.append(host)});
 const group=page.locator('#controlled .ui-segmented');await expect(group).toHaveAttribute('data-segment-ready','');await group.getByRole('button',{name:'Длинное второе значение'}).click();await expect(group.getByRole('button',{name:'Первый'})).toHaveAttribute('aria-pressed','true');
 await group.evaluate(g=>g.querySelectorAll('button').forEach((el,i)=>el.setAttribute('aria-pressed',String(i===1))));await page.setViewportSize({width:700,height:900});
 await expect.poll(()=>group.evaluate(g=>Math.abs(g.querySelector('.ui-segment-thumb').getBoundingClientRect().x-g.querySelector('[aria-pressed=true]').getBoundingClientRect().x))).toBeLessThan(1);
 await page.evaluate(async()=>{const {segmentedControl}=await import('/js/ui/segmented.js');const host=document.querySelector('#controlled');host.onclick=event=>{const value=event.target.closest('button')?.dataset.segmentValue;if(value)host.innerHTML=segmentedControl({label:'Контролируемый выбор',value,items:[{value:'a',label:'Первый'},{value:'b',label:'Длинное второе значение'}]})}});
 await group.getByRole('button',{name:'Длинное второе значение'}).focus();await page.keyboard.press('Home');await expect(group.getByRole('button',{name:'Первый'})).toBeFocused();
 await page.emulateMedia({reducedMotion:'reduce',forcedColors:'active'});expect(await group.locator('.ui-segment-thumb').evaluate(el=>parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(.001);await expect(group.locator('[aria-pressed=true]')).toHaveCSS('outline-style','solid');
 await page.evaluate(()=>window.disposeSegmented());await group.evaluate(g=>g.remove());
});
test('backlog full shell: scoped selection, cards and one row',async({page},info)=>{
 await mockApp(page);await page.setViewportSize({width:1280,height:900});await page.goto('/#/backlog?bv=2&scope=all');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
 const group=page.getByRole('group',{name:'Область бэклога',exact:true});await expect(group).toHaveAttribute('data-segment-ready','');await group.getByRole('button',{name:'Команда',exact:true}).click();await expect(page.locator('#tasks-table tr[data-task-id]')).toHaveCount(2);
 const views=page.getByRole('group',{name:'Режим отображения',exact:true});await views.getByRole('button',{name:'Карточное представление'}).click();await expect(views.getByRole('button',{name:'Карточное представление'})).toHaveAttribute('aria-pressed','true');
 const centers=await page.locator('.ui-page-header button:visible').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return r.y+r.height/2}));expect(Math.max(...centers)-Math.min(...centers)).toBeLessThan(2);await page.screenshot({path:info.outputPath('backlog.png'),fullPage:true});
});
test('meetings full shell: view choice survives rerender and keyboard focus',async({page},info)=>{
 await mockApp(page);
 const user={id:101,name:'Тест',role_name:'Администратор',permissions:{admin:'full',backlog_dmb:'read_write',backlog_team:'write_all',task_edit:'all'}};
 await page.route('**/api/v1/auth/**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/refresh')?{access_token:'fixture-token',user}:user}));
 await page.route('**/api/v1/reporting-meetings**',route=>route.fulfill({json:{items:[],can_manage:false,can_prepare:false}}));
 await page.setViewportSize({width:1366,height:900});await page.goto('/#/reporting-meetings');
 const group=page.getByRole('group',{name:'Представление календаря',exact:true});await expect(group).toHaveAttribute('data-segment-ready','');
 await group.getByRole('button',{name:'Карточки',exact:true}).focus();await page.keyboard.press('ArrowRight');
 await expect(group.getByRole('button',{name:'Хронология',exact:true})).toHaveAttribute('aria-pressed','true');await expect(group.getByRole('button',{name:'Хронология',exact:true})).toBeFocused();
 await page.screenshot({path:info.outputPath('meetings.png'),fullPage:true});
});
test('current activity control preserves the comment draft and never saves',async({page},info)=>{
 await page.setViewportSize({width:1440,height:900});const {writes}=await setupWorkDesignPilot(page,{editable:true});
 await page.locator('[data-work-id="76"]').click();await expect(page.locator('#wf-description')).toBeVisible();
 await page.locator('#work-card-activity-panel > summary').click();
 const group=page.getByRole('group',{name:'Вид активности',exact:true});await expect(group).toHaveAttribute('data-segment-ready','');
 await page.locator('#wf-comment').fill('Черновик обсуждения');await group.getByRole('button',{name:'Изменения',exact:true}).click();
 await expect(page.locator('.work-comment-form')).toBeHidden();await group.getByRole('button',{name:'Комментарии',exact:true}).click();
 await expect(page.locator('#wf-comment')).toHaveValue('Черновик обсуждения');await expect(group.getByRole('button',{name:'Комментарии',exact:true})).toHaveAttribute('aria-pressed','true');expect(writes).toEqual([]);
 await page.screenshot({path:info.outputPath('activity.png'),fullPage:true});
});
