import {test,expect} from '@playwright/test';

test('router keeps one visible page heading at mobile width',async({page})=>{
 await page.setViewportSize({width:320,height:700});
 await page.route('**/api/v1/**',route=>route.fulfill({json:route.request().url().includes('/options')?{can_create:false,teams:[],users:[],projects:[]}:{items:[],total:0,summary:{}}}));
 await page.goto('/e2e/fixtures/workWorkspaceRouter.html#/work-tasks');
 await expect(page.getByRole('heading',{name:'Рабочие задачи',exact:true})).toBeVisible();
 await expect(page.locator('#breadcrumb-nav')).toBeHidden();
});

for(const width of [1440,1280,720,390,320]) for(const theme of ['light','dark']) {
 test(`registry geometry ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  await page.goto('/e2e/fixtures/workListVisual.html');
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect(page.locator('[data-work-row]').first()).toBeVisible();
  if(width<=900) await page.locator('[data-work-action=toggle-search]').click();
  await expect(page.locator('#work-search')).toBeVisible();
  const box=await page.locator('#work-search').boundingBox();
  expect(box.width).toBeGreaterThan(180);expect(box.x+box.width).toBeLessThanOrEqual(width);
  await page.locator('#work-search').fill('проверка');
  await page.screenshot({path:info.outputPath('search.png')});
  await page.goto(`/e2e/fixtures/uiKitRegistries.html?surface=notifications&theme=${theme}`);
  await expect(page.locator('.notification-card').first()).toBeVisible();
  await expect(page.locator('.notification-card .btn-primary')).toHaveCount(0);
  if(width>=1280) {
   const row=await page.locator('.notification-card').nth(1).boundingBox();
   expect(row.height).toBeLessThanOrEqual(80); // Wrapped/long text may expand the 64px baseline.
  }
  await page.locator('.notification-card').nth(1).locator('h3').click();
  await expect.poll(()=>page.evaluate(()=>window.__navigation.length)).toBeGreaterThan(0);
  await page.goto(`/e2e/fixtures/uiKitComposites.html?surface=registry&theme=${theme}`);
  await expect(page.locator('#tasks-table')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('dmb-table.png')});
  await page.locator('#backlog-more-tools').click();
  await expect(page.getByRole('dialog',{name:'Действия бэклога'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#backlog-more-tools')).toBeFocused();
  expect(await page.evaluate(()=>window.__writes)).toEqual([]);
 });
}
