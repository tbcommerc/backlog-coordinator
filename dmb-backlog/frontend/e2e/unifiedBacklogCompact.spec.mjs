import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
import {mkdirSync,readFileSync} from 'node:fs';
for(const theme of ['light','dark'])for(const width of [320,390,1280,1366,1440,1920])test(`compact backlog heading ${theme} ${width}`,async({page},info)=>{
 await mockApp(page);await page.setViewportSize({width,height:900});await page.addInitScript(t=>localStorage.setItem('dmb_theme',t),theme);
 await page.goto('/#/backlog?bv=2&scope=all');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
 const group=page.locator('.ui-page-header .backlog-scope-bar');await expect(group).toBeVisible();
 await expect(page.locator('.ui-toolbar-stack > .backlog-scope-bar')).toHaveCount(0);
 await expect(page.locator('[data-backlog-scope="team"]')).toHaveText('Команда');
 await expect(page.locator('[data-backlog-scope="all"]')).toHaveText('Трайб');
 await expect(page.locator('[data-backlog-scope="team"]')).toHaveAttribute('title',/Продукт/);
 const geometry=await group.evaluate(el=>{const r=el.getBoundingClientRect(),h=el.closest('.ui-page-header').getBoundingClientRect();return{width:r.width,inside:r.top>=h.top&&r.bottom<=h.bottom,overflow:document.documentElement.scrollWidth-innerWidth}});
 const controls=await page.locator('[data-backlog-scope],#backlog-add-task-btn,#backlog-saved-view-trigger').evaluateAll(es=>es.map(el=>{const r=el.getBoundingClientRect();return{width:r.width,height:el.closest('.ui-segmented')?.getBoundingClientRect().height||r.height}}));
 expect(controls).toHaveLength(4);expect(Math.max(...controls.map(x=>x.height))-Math.min(...controls.map(x=>x.height))).toBeLessThanOrEqual(1);
 const panelHeights=await page.locator('#f-backlog-search,#btn-ext-backlog,#f-backlog-reset,.ui-page-header .toolbar-actions > button,.ui-page-header .ui-segmented').evaluateAll(es=>es.filter(el=>el.getClientRects().length).map(el=>el.getBoundingClientRect().height));
 expect(Math.max(...panelHeights)-Math.min(...panelHeights)).toBeLessThanOrEqual(1);
 expect(Math.abs(controls[0].width-controls[1].width)).toBeLessThanOrEqual(1);
 if(width>1024){await expect(page.locator('#backlog-add-task-btn .ui-responsive-icon-label')).toBeVisible();await expect(page.locator('#backlog-saved-view-label')).toBeVisible();expect(Math.abs(controls[2].width-controls[3].width)).toBeLessThanOrEqual(1);}
 if(width>1024){const rows=await page.locator('.ui-page-header button:visible').evaluateAll(es=>es.map(el=>{const r=el.getBoundingClientRect();return r.y+r.height/2;}));expect(Math.max(...rows)-Math.min(...rows)).toBeLessThanOrEqual(1);}
 expect(geometry.inside).toBe(true);expect(geometry.width).toBeLessThanOrEqual(384);expect(geometry.overflow).toBeLessThanOrEqual(1);
 {const title=await page.locator('.ui-page-heading .toolbar-title').boundingBox(),g=await group.boundingBox();expect(Math.abs(title.y+title.height/2-g.y-g.height/2)).toBeLessThan(3);}
 const dir=info.outputPath('screens');mkdirSync(dir,{recursive:true});await page.screenshot({path:`${dir}/${theme}-${width}-all.png`,fullPage:true});
 await page.locator('[data-backlog-scope="team"]').focus();await page.keyboard.press('Enter');await expect(page.locator('[data-backlog-scope="team"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
 await expect(page.locator('#tasks-table tr[data-task-id]')).toHaveCount(2);await page.screenshot({path:`${dir}/${theme}-${width}-team.png`,fullPage:true});
 await page.locator('[data-backlog-scope="all"]').click();await expect(page.locator('#tasks-table tr[data-task-id]')).toHaveCount(3);
 await info.attach('geometry',{body:JSON.stringify(geometry),contentType:'application/json'});
});

for(const theme of ['light','dark'])test(`compact baseline comparison ${theme}`,async({page})=>{await mockApp(page);await page.setViewportSize({width:1440,height:900});await page.addInitScript(t=>localStorage.setItem('dmb_theme',t),theme);
 let source=readFileSync(new URL('../js/components/backlogPage.js',import.meta.url),'utf8').replace('uniformPrimaryActions: true,','uniformPrimaryActions: false,').replace('titleAccessory:scopeMarkup(),','contextHtml:scopeMarkup(),').replace("subtitle: '',","subtitle: dataScope==='team'?`Моя команда · ${escapeHtml(user.team_name||String(user.team_id))}`:'Все доступные задачи',").replace("className:'ui-segmented-inline ui-segmented-equal',size:'small',",'').replace("label:scope==='team'?'Моя команда':'Все доступные'",'label:label(scope)');
 await page.route('**/components/backlogPage.js*',r=>r.fulfill({contentType:'text/javascript',body:source}));await page.goto('/#/backlog?bv=2&scope=all');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await expect(page.locator('.ui-toolbar-stack > .backlog-scope-bar')).toHaveCount(1);mkdirSync('../.runtime/evidence/backlog-compact',{recursive:true});await page.screenshot({path:`../.runtime/evidence/backlog-compact/${theme}-1440-before.png`,fullPage:true});});
