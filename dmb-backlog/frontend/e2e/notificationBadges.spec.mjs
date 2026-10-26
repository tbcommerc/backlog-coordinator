import { test, expect } from '@playwright/test';
for(const theme of ['light','dark'])for(const width of [320,390,760,1440]){
 test(`notification badge geometry ${theme}/${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  await page.goto('/e2e/fixtures/notificationAudit.html');
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await expect(page.locator('.notification-card')).toHaveCount(20);
  // Exercise both elevated priorities using the actual rendered reporting card.
  for(const priority of ['high','critical']){
   await page.locator('[data-notif-id="1"]').evaluate((card,priority)=>{card.classList.toggle('importance-high',priority==='high');card.classList.toggle('importance-critical',priority==='critical');card.querySelector('.notification-priority').textContent=priority==='high'?'Высокий':'Критический';},priority);
   const pair=await page.locator('[data-notif-id="1"] .notification-new-label,[data-notif-id="1"] .notification-priority').evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n);return {height:n.getBoundingClientRect().height,font:s.fontSize,line:s.lineHeight,weight:s.fontWeight,padding:s.padding,border:s.borderWidth,radius:s.borderRadius,overflow:n.scrollWidth>n.clientWidth+1};}));
   expect(pair).toHaveLength(2);expect(pair[0]).toEqual(pair[1]);expect(pair[0].height).toBe(24);expect(pair[0].overflow).toBe(false);
  }
  await page.locator('#notifications-load-more').click();await page.locator('#notifications-load-more').click();
  await expect(page.locator('.notification-card')).toHaveCount(43);
  const overflow=await page.locator('.notification-card').evaluateAll(cards=>cards.filter(c=>c.scrollWidth>c.clientWidth+1).map(c=>c.dataset.notifId));expect(overflow).toEqual([]);
  await page.locator('[data-filter-category="mention"]').click();
  await expect(page.locator('.notification-card')).toHaveCount(1);
  await page.locator('[data-notif-id="3"] [data-mark-read]').click();await expect(page.locator('[data-notif-id="3"] .notification-new-label')).toHaveCount(0);
  await page.locator('[data-notif-id="3"] [data-mark-unread]').click();await expect(page.locator('[data-notif-id="3"] .notification-new-label')).toHaveCSS('font-size','12px');
  if(width===1440){await page.locator('[data-filter-category="reporting"]').click();await expect(page.locator('[data-notif-id="1"]')).toBeVisible();}
  if(width===1440)await page.locator('[data-notif-id="1"]').screenshot({path:`../.runtime/notification-badges-${theme}.png`});
 });
}
