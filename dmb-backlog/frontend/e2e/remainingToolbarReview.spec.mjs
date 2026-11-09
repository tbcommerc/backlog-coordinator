import {test,expect} from '@playwright/test';
const surfaces=[...['reports','directorate','customer','meetings','dashboard','analytics'].map(s=>[s,`uiKitAdminReports.html?surface=${s}`]),...['audit','outbox','notifications'].map(s=>[s,`uiKitRegistries.html?surface=${s}`]),['statuses','uiKitReportingWorkspaces.html'],['quarterly','uiKitReportingWorkspaces.html?surface=quarterly'],['kanban','uiKitComposites.html?surface=kanban']];
for(const [name,url] of surfaces) for(const width of [1440,390]) for(const theme of ['light','dark']) test(`${name} ${width} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});await page.goto('/e2e/fixtures/'+url);await page.waitForLoadState('networkidle');
 await expect(page.locator('main')).not.toBeEmpty();
 await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 const mismatches=await page.locator('input:not([type=checkbox]):not([type=radio]),select,.ui-segmented').evaluateAll(es=>es.filter(e=>e.getClientRects().length).flatMap(e=>{
 const r=e.getBoundingClientRect();const parent=e.closest('[class*=toolbar],[class*=filters],[class*=actions]');if(!parent)return [];
 return [...parent.querySelectorAll('.btn')].filter(b=>b.getClientRects().length&&!b.closest('.ui-segmented')).flatMap(b=>{const s=b.getBoundingClientRect();return Math.abs(r.y+r.height/2-s.y-s.height/2)<3&&Math.abs(r.height-s.height)>1?[{field:e.id||e.className,button:b.id||b.textContent.trim(),heights:[r.height,s.height]}]:[]});
 }));
 expect(mismatches,`${name}: controls in the same row`).toEqual([]);
 if(name==='meetings'){
 const heights=await page.locator('[data-meeting-filter],.meeting-toolbar-actions .ui-segmented,[data-meeting-reset]').evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().height));
 expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(1);
 }
 await page.screenshot({path:info.outputPath('full.png'),fullPage:true});
});
