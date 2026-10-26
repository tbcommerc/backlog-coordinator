import {test,expect} from '@playwright/test';

for(const width of [320,390,768,1024,1280,1440])for(const theme of ['light','dark'])test(`queue density ${width} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width:1500,height:1000});
 await page.goto('/e2e/fixtures/workViewport.html');
 await page.locator('#screen').selectOption(String(width));
 const frame=page.frameLocator('#app');
 await expect(frame.locator('[data-work-row]')).toHaveCount(8);
 await page.locator('#theme').selectOption(theme);
 const geometry=await frame.locator('.work-queue-panel').evaluate(el=>({width:el.clientWidth,overflow:document.documentElement.scrollWidth>innerWidth,rows:[...el.querySelectorAll('[data-work-row]')].map(row=>({height:row.getBoundingClientRect().height,display:getComputedStyle(row).display,titleWidth:row.cells[0].getBoundingClientRect().width,cellBorders:[...row.cells].map(td=>getComputedStyle(td).borderBottomWidth)}))}));
 expect(geometry.overflow).toBe(false);
 for(const row of geometry.rows){expect(row.display).toBe(geometry.width>=860?'table-row':'grid');expect(row.height).toBeLessThanOrEqual(geometry.width>=860?104:geometry.width>=460?130:190);if(geometry.width>=860)expect(row.titleWidth).toBeGreaterThanOrEqual(320);else expect(row.cellBorders.every(x=>x==='0px')).toBe(true);}
 await page.screenshot({path:info.outputPath('queue.png')});
 await frame.locator('[data-work-id="77"]').click();await expect(frame.locator('.work-dialog')).toBeVisible();
 expect(await frame.locator('.work-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('detail.png')});
});

for(const scale of ['1.25','1.5','2'])for(const theme of ['light','dark'])test(`queue zoom emulation ${scale} ${theme}`,async({page},info)=>{
 await page.setViewportSize({width:1500,height:1050});await page.goto('/e2e/fixtures/workViewport.html');
 const frame=page.frameLocator('#app');await expect(frame.locator('[data-work-row]')).toHaveCount(8);
 await page.locator('#scale').selectOption(scale);await page.locator('#theme').selectOption(theme);
 expect(await frame.locator('body').evaluate(()=>innerWidth)).toBeCloseTo(1440/Number(scale),0);
 expect(await frame.locator('body').evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('zoom.png')});
 // Keyboard avoids the browser driver's pointer-coordinate bug on CSS-zoomed iframes.
 await frame.locator('[data-queue-menu="76"]').press('Enter');await expect(frame.getByRole('menuitem',{name:'Открыть задачу'})).toBeVisible();
});
