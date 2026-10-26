import { test, expect } from '@playwright/test';

// Read-only component fixtures: no application database or credentials.
for (const width of [1440,1280,390,320]) for (const theme of ['light','dark']) {
 test(`visual refresh ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const shot=async name=>{
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await page.evaluate(()=>document.fonts.ready);
   if(name !== 'catalog') expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1), `${name}: horizontal overflow`).toBe(true);
   await page.screenshot({path:info.outputPath(`${name}.png`),fullPage:true});
  };
  await page.goto('/e2e/fixtures/workListVisual.html');
  await expect(page.locator('[data-work-row]').first()).toBeVisible();
  await shot('queue');
  await page.getByRole('button',{name:'Сводка',exact:true}).click();
  await expect(page.locator('.work-summary-grid')).toBeVisible();
  await shot('summary');
  await page.getByRole('button',{name:'Список',exact:true}).click();
  await page.locator('[data-work-id]').first().click();
  await expect(page.locator('#work-drawer-title')).toBeVisible();
  await shot('drawer');
  await page.locator('[data-work-action="close"]').click();
  await page.locator('[data-work-action="create"]').click();
  await expect(page.locator('#wf-title')).toBeVisible();
  await shot('create');
  await page.goto(`/e2e/fixtures/uiKitRegistries.html?surface=notifications&theme=${theme}`);
  await expect(page.locator('.notification-card').first()).toBeVisible();
  await shot('notifications');
  await page.goto(`/e2e/fixtures/uiKitComposites.html?theme=${theme}`);
  await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await shot('dmb-toolbar');
  await page.locator('#btn-ext-backlog').click();
  await expect(page.locator('#f-backlog-ext-filters')).toBeVisible();
  await shot('dmb-filters');
  await page.goto('/ui-catalog/core.html');
  await shot('catalog');
 });
}
