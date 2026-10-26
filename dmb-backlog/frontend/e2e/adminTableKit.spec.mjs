import { test, expect } from '@playwright/test';
for (const theme of ['light','dark']) for (const compact of [false,true]) test(`table kit ${theme} compact=${compact}`, async ({page}) => {
 let reference;
 for (const tab of ['users','projects','businessCustomers','roles','home','audit','notifications']) {
  await page.goto(`/e2e/fixtures/uiKitAdminReports.html?admin_tab=${tab}&theme=${theme}`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(value=>document.documentElement.dataset.compact=String(value),compact);
  const table=page.locator('#admin-content table').first();
  if(!await table.count()) continue;
  await expect(table).toHaveClass(/ui-table-admin/);
  const styles=await table.locator('thead th').evaluateAll(headers=>headers.map(th=>{
   const s=getComputedStyle(th); return Object.fromEntries(['fontSize','fontWeight','lineHeight','letterSpacing','textTransform','paddingTop','paddingBottom','paddingLeft','backgroundColor','color','borderBottomWidth'].map(k=>[k,s[k]]));
  }));
  expect(styles.length,tab).toBeGreaterThan(0); reference ||= styles[0];
  for(const style of styles) expect(style,tab).toEqual(reference);
  await expect(table.locator('..')).toHaveClass(/ui-table-surface/);
  if (!compact && ['users','projects'].includes(tab)) await table.locator('..').screenshot({path: `test-results/table-${tab}-${theme}.png`});
  expect(await page.evaluate(()=>window.__blockedWrites)).toEqual([]);
 }
});
test('mobile tables keep cards and role matrix scrolling',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 for(const tab of ['users','projects','roles']){
  await page.goto(`/e2e/fixtures/uiKitAdminReports.html?admin_tab=${tab}`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await expect(page.locator('#admin-content table thead').first()).toHaveCSS('display',tab==='roles'?'table-header-group':'none');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 }
});
