import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {setup} from './fixtures/projectManagementSetup.js';
import {mockApp} from './helpers/backlogMock.mjs';
const dir='.runtime/neutral-links-images';
const before=process.env.LINK_CAPTURE==='before';
async function capture(page,name){mkdirSync(dir,{recursive:true});await page.screenshot({path:`${dir}/${before?'before':'after'}-${name}.png`,fullPage:true});}
async function neutral(locator){
 const colors=await locator.evaluateAll(nodes=>nodes.map(el=>({text:el.textContent,color:getComputedStyle(el).color,expected:getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim()})));
 // Resolve CSS variables through a detached probe attached to the same document.
 await expect.poll(()=>locator.evaluateAll(nodes=>nodes.filter(el=>{const p=document.createElement('span');document.body.append(p);const expected=['--text-link','--text-secondary','--text-muted'].map(token=>{p.style.color=`var(${token})`;return getComputedStyle(p).color;});p.remove();return !expected.includes(getComputedStyle(el).color);}).map(el=>({text:el.textContent,color:getComputedStyle(el).color}))),{message:JSON.stringify(colors)}).toEqual([]);
}
for(const theme of ['light','dark'])for(const width of [390,1440])test(`project links ${theme} ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await setup(page);
 await page.route('**/api/v1/projects?*',route=>route.fulfill({json:{items:['AI ПОМОЩНИК IB','AI-СПРАВКА ПО КЛИЕНТУ','BI','DATA','IB'].map((name,i)=>({id:i+1,name,code:'P'+i,backlog_count:1,status:'active'})),total:5,page:1}}));
 await page.evaluate(async()=>{history.replaceState(null,'','#/work-projects?cview=table');await window.renderProjects();});
 await page.locator('html').evaluate((el,t)=>el.dataset.theme=t,theme);
 const link=page.getByRole('link',{name:'AI ПОМОЩНИК IB',exact:true});await expect(link).toBeVisible();
 await capture(page,`projects-${theme}-${width}`);if(before)return;
 await neutral(page.getByRole('table',{name:'Каталог проектов'}).locator('a'));
 await link.hover();await neutral(link);await expect(link).toHaveCSS('text-decoration-line','underline');
 await link.focus();await expect(link).toBeFocused();expect(await link.evaluate(el=>getComputedStyle(el).outlineStyle)).not.toBe('none');
 await page.keyboard.press('Enter');await expect(page).toHaveURL(/project=1/);
 if(width<700)await expect(page.getByLabel('Раздел проекта',{exact:true})).toBeVisible();
 else await expect(page.getByRole('tab',{name:'План',exact:true})).toBeVisible();
});
for(const theme of ['light','dark'])test(`backlog full screen and task links ${theme}`,async({page})=>{
 await mockApp(page);await page.setViewportSize({width:1440,height:900});await page.goto('/#/backlog');
 await page.locator('tr[data-task-id="41"]').waitFor();await page.locator('html').evaluate((el,t)=>el.dataset.theme=t,theme);
 await capture(page,`backlog-${theme}`);if(before)return;
 await neutral(page.locator('main table a[href]'));
 const link=page.locator('tr[data-task-id="41"] a').filter({hasText:'Первая задача'});await link.click();
 await expect(page.locator('#task-detail-overlay')).toBeVisible();await capture(page,`task-card-${theme}`);
 await neutral(page.locator('#task-detail-overlay a[href]').filter({hasText:/Jira|Макеты|TASK|WRK/}));
});
for(const surface of ['reports','directorate','customer','meetings','dashboard','analytics'])for(const theme of ['light','dark'])test(`surface ${surface} ${theme}`,async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await page.goto(`/e2e/fixtures/uiKitAdminReports.html?surface=${surface}&theme=${theme}`);
 await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');await page.evaluate(()=>document.fonts.ready);
 await capture(page,`${surface}-${theme}`);if(before)return;
 // Main content links only: tabs/buttons and semantic status badges are separate contracts.
 await neutral(page.locator('main a[href]:not(.btn):not([role="tab"]):not(.nav-item):not(.chat-task-link a)'));
});
test('all legacy content link styles stay neutral in both themes and on hover',async({page})=>{
 await setup(page);if(before)return;
 // Actual selector families found in active stylesheets, including descendants.
 const families=['ui-link','ui-table-title','attachment-download-link','pip-task-id','hm-link','bc-link-btn','qmetric-title-link','qmetric-fact-link','dashboard-widget-link'];
 for(const theme of ['light','dark']){
 await page.locator('html').evaluate((el,t)=>el.dataset.theme=t,theme);
 await page.locator('main').evaluate((el,families)=>{el.innerHTML=families.map(c=>`<p><a class="${c}" href="#target">${c}</a></p>`).join('')+['attachment-item-name','task-description-content','fval','jrow','chat-message-content','ui-readonly-content'].map(c=>`<p class="${c}"><a href="#target">${c}</a></p>`).join('')+'<p><a href="#target">Обычная ссылка</a></p>';},families);
 const links=page.locator('main a');await neutral(links);
 for(const link of await links.all()){await link.hover();await neutral(link);await expect(link).toHaveAttribute('href','#target');}
 }
});
