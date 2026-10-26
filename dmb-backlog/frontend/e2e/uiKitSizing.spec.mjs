import { test, expect } from '@playwright/test';

const scale = { 'extra-small': 24, small: 28, default: 32, large: 40 };
for (const mode of ['desktop', 'compact', 'mobile', 'touch', 'zoom']) {
  test(`единая геометрия в странице и диалогах: ${mode}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport:{width:mode === 'mobile' ? 390 : 1440,height:1000}, hasTouch:mode === 'touch' });
    const page = await context.newPage();
    await page.goto('/e2e/fixtures/uiKitSizing.html');
    await expect(page.locator('html')).toHaveAttribute('data-ready','true');
    await expect(page.locator('[data-hidden]')).toHaveCount(3);
    for (const hidden of await page.locator('[data-hidden]').all()) await expect(hidden).toBeHidden();
    await expect(page.locator('[data-stacked]')).toHaveCSS('display','grid');
    const stacked = await page.locator('[data-stacked]').evaluate(button => ({ label:button.querySelector('span').getBoundingClientRect().bottom, hint:button.querySelector('small').getBoundingClientRect().top }));
    expect(stacked.hint).toBeGreaterThanOrEqual(stacked.label);
    await page.evaluate(mode => {
      document.documentElement.dataset.compact = String(mode === 'compact');
      document.body.classList.toggle('compact-mode', mode === 'compact');
      if (mode === 'zoom') document.documentElement.style.zoom = '1.5';
    },mode);
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
    const controls = await page.locator('[data-case]').evaluateAll(elements => elements.map(element => {
      const box=element.getBoundingClientRect();
      return { context:element.closest('[data-context]').dataset.context,size:element.closest('[data-size]').dataset.size,kind:element.dataset.case,width:box.width,height:box.height,overflow:element.scrollHeight-element.clientHeight };
    }));
    for (const item of controls) {
      const size = mode === 'compact' && ['default','large'].includes(item.size) ? scale[item.size]-4 : scale[item.size];
      const target = (['mobile','touch'].includes(mode) ? 44 : size)*(mode === 'zoom' ? 1.5 : 1);
      expect(item.height, JSON.stringify(item)).toBe(target);
      if (item.kind.includes('icon')) expect(item.width,JSON.stringify(item)).toBe(target);
      expect(item.overflow,JSON.stringify(item)).toBeLessThanOrEqual(1);
    }
    await context.close();
  });
}

for (const surface of ['reports','admin','directorate','customer','meetings','analytics']) {
  test(`реальный экран соблюдает шкалу размеров: ${surface}`,async({page})=>{
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(`/e2e/fixtures/uiKitAdminReports.html?surface=${surface}`);
    await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
    const controls=await page.locator('.btn, input.input, select.input').evaluateAll(elements=>elements.filter(element=>element.getClientRects().length).map(element=>{
      const box=element.getBoundingClientRect();
      return {className:element.className,height:box.height,width:box.width,small:element.classList.contains('btn-sm'),square:element.classList.contains('square-icon')};
    }));
    expect(controls.length).toBeGreaterThan(0);
    for(const item of controls) {
      expect(item.height,item.className).toBe(item.small?28:32);
      if(item.square) expect(item.width,item.className).toBe(item.height);
    }
    expect(await page.evaluate(()=>window.__apiCalls.filter(([method])=>method!=='get'))).toEqual([]);
  });
}
