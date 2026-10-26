import {test,expect} from '@playwright/test';

for(const theme of ['light','dark'])for(const mode of ['desktop','compact','mobile','touch']) {
 test(`remaining report controls ${theme}/${mode}`,async({browser})=>{
  const context=await browser.newContext({viewport:{width:mode==='mobile'?390:1280,height:900},hasTouch:mode==='touch'});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const kind of ['reg-directors','pip','pd-estimates']) {
   await page.goto(`/e2e/fixtures/uiKitComposites.html?surface=report&kind=${kind}&theme=${theme}&compact=${mode==='compact'}`);
   await expect(page.locator('html')).toHaveAttribute('data-ready','true');
   await expect(page.locator('#report-body')).not.toBeEmpty();
   const controls=await page.locator('#page-content').evaluate(root=>[...root.querySelectorAll('.btn')].filter(e=>e.getClientRects().length).map(e=>({name:e.textContent.trim(),w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,square:e.classList.contains('square-icon')})));
   for(const c of controls){expect(c.h,c.name).toBeGreaterThanOrEqual(mode==='mobile'||mode==='touch'?44:28);if(c.square)expect(c.w,c.name).toBe(c.h);}
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
   await page.screenshot({path:test.info().outputPath(`${kind}.png`)});
  }
  expect(errors).toEqual([]);await context.close();
 });
}
test('report errors use shared state and retry; charts follow live theme',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitComposites.html?surface=report&kind=reg-directors&error=1');
 await expect(page.getByRole('alert')).toContainText('Не удалось загрузить отчёт');
 await page.evaluate(()=>{window.__recovered=true;});await page.getByRole('button',{name:'Повторить',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>Boolean(window.Chart.getChart('chart-report-status')))).toBe(true);
 await page.evaluate(()=>{window.__reportChart=window.Chart.getChart('chart-report-status');document.documentElement.dataset.theme='dark';});
 await expect.poll(()=>page.evaluate(()=>window.__reportChart.options.scales.x.ticks.color===getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim())).toBe(true);
 expect(await page.evaluate(()=>window.__reportChart===window.Chart.getChart('chart-report-status'))).toBe(true);
});
