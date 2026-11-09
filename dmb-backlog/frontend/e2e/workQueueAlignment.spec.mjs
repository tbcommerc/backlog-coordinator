import { test, expect } from '@playwright/test';

for (const width of [1440, 1920]) test(`inspector queue columns align at ${width}`, async ({page}, info) => {
 await page.setViewportSize({width,height:1000});
 await page.goto('/e2e/fixtures/workListVisual.html');
 await page.locator('[data-work-id="77"]').click();
 await expect(page.locator('.has-work-inspector')).toBeVisible();
 const rows=page.locator('[data-work-row]');
 await expect(rows).toHaveCount(8);
 const geometry=await rows.evaluateAll(rows=>rows.map(row=>{
  const box=selector=>row.querySelector(selector).getBoundingClientRect();
  const status=box('.work-queue-status'),due=box('.work-queue-state'),title=box('td:first-child');
  return {status:status.x,due:due.x,titleRight:title.right,statusWidth:status.width,height:row.getBoundingClientRect().height,wide:row.closest('.work-queue-panel').clientWidth>=760,
   clipped:[...row.querySelectorAll('.work-priority,.work-queue-note,.work-queue-signals')].some(el=>el.scrollWidth>el.clientWidth+1)};
 }));
 await page.screenshot({path:info.outputPath('queue-alignment.png'),fullPage:true});
 for(const row of geometry){
  expect(row.status).toBeCloseTo(geometry[0].status,0);
  if(row.wide){expect(row.due).toBeGreaterThan(row.status);expect(row.height).toBeLessThanOrEqual(110);}
  else expect(row.due).toBeCloseTo(row.status,0);
  expect(row.titleRight).toBeLessThan(row.status);
  expect(row.statusWidth).toBe(row.wide?128:156);
  expect(row.clipped).toBe(false);
 }
 if(geometry[0].wide) for(const row of geometry.slice(4)) expect(row.height).toBeLessThanOrEqual(60);
 await expect(page.locator('[data-work-row="76"] .work-queue-note')).toHaveText('Есть препятствие');
 await page.screenshot({path:info.outputPath('queue-alignment.png'),fullPage:true});
});

for (const width of [390,1280]) test(`queue remains readable with modal card at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 await page.goto('/e2e/fixtures/workListVisual.html');
 await expect(page.locator('[data-work-row]')).toHaveCount(8);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(await page.locator('.work-queue-signals').evaluateAll(items=>items.every(el=>el.scrollWidth<=el.clientWidth+1))).toBe(true);
 await page.locator('[data-work-id="77"]').click();
 await expect(page.locator('.work-dialog')).toBeVisible();
 expect(await page.locator('.work-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});
