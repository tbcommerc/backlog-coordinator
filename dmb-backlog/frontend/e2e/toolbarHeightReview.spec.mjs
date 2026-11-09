import {test,expect} from '@playwright/test';
for(const tab of ['teams','projects','users','audit']) test(`toolbar admin ${tab}`,async({page},info)=>{
 await page.goto(`/e2e/fixtures/uiKitAdminReports.html?admin_tab=${tab}`);
 await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 const heights=await page.locator('.admin-action-row input.input,.admin-action-row select.input,.admin-action-row > button,.admin-list-reset,#audit-reset').evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().height));
 expect(heights.length).toBeGreaterThan(0);
 expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath('full.png'),fullPage:true});
});
