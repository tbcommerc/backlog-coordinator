import { test, expect } from '@playwright/test';

async function capture(page,info,theme,name){
 await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
 await page.evaluate(()=>document.fonts.ready);
 if(name !== 'catalog') expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth + 1),name+': horizontal overflow').toBe(true);
 await page.screenshot({path:info.outputPath(name+'.png'),fullPage:true});
}
// Independent read-only compositions keep each scenario within its own timeout.
for (const width of [1440,1280,390,320]) for (const theme of ['light','dark']) {
 test(`visual refresh ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const shot=name=>capture(page,info,theme,name);
  await page.goto('/e2e/fixtures/workListVisual.html');
  await expect(page.locator('[data-work-row]').first()).toBeVisible();
  await shot('queue');
  if(width<=400) await page.getByRole('combobox',{name:'Представление задач',exact:true}).selectOption('summary'); else await page.getByRole('button',{name:'Сводка',exact:true}).click();
  await expect(page.locator('.work-summary-grid')).toBeVisible();
  await shot('summary');
  if(width<=400) await page.getByRole('combobox',{name:'Представление задач',exact:true}).selectOption('list'); else await page.getByRole('button',{name:'Список',exact:true}).click();
  await page.locator('[data-work-id]').first().click();
  await expect(page.locator('#work-drawer-title')).toBeVisible();
  await shot('drawer');
  await page.locator('[data-work-action="close"]').click();
  await page.locator('[data-work-action="create"]').click();
  await expect(page.locator('#wf-title')).toBeVisible();
  await shot('create');
 });
 test(`visual catalog ${width} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const shot=name=>capture(page,info,theme,name);
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
