import {test,expect} from '@playwright/test';
const open=async(page,tab)=>{await page.goto(`/e2e/fixtures/uiKitAdminReports.html?dialogA11y=true&admin_tab=${tab}`);await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');};
test('F05 delayed audit search cannot replace another tab', async ({page}) => {
 await open(page,'audit'); await page.locator('#audit-search').fill('query'); await page.locator('[data-tab=teams]').click(); await page.waitForTimeout(400); await expect(page.locator('#admin-content')).toHaveAttribute('data-admin-tab','teams'); await expect(page.locator('#audit-search')).toHaveCount(0); await expect(page.locator('.admin-add-btn[data-type=team]')).toBeVisible();
});
test('F06 draft is isolated when current user changes', async ({page}) => {
 await open(page,'display'); await page.locator('#display-label-id').fill('Private draft'); await page.locator('[data-tab=home]').click();
 await page.evaluate(async()=>{const user={...window.app.store.get('currentUser'),id:999};window.app.store.get=key=>key==='currentUser'?user:null;await (await import('/js/components/admin.js?v=6')).initAdmin(window.app);});
 await page.locator('[data-tab=display]').click(); await expect(page.locator('#display-label-id')).not.toHaveValue('Private draft');
});
test('F09 archive search reveals matching rows',async({page})=>{
 await open(page,'dictionaries');await page.locator('[data-dict=priorities]').click();await page.locator('#dict-search').fill('Архивный');await expect(page.locator('#dict-search-result')).toContainText('Найдено: 1');await expect(page.locator('#dict-archive .dict-value-input')).toBeVisible();
});
test('F05 leaving admin during pending list search is safe',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await open(page,'users');await page.locator('#admin-user-search').fill('query');await page.locator('#admin-content').evaluate(node=>node.remove());await page.waitForTimeout(300);expect(errors).toEqual([]);
});

test('F16 removing invalid filter clears obsolete validation',async({page})=>{
 await open(page,'reports');await page.locator('.admin-add-btn[data-type=report]').click();await page.locator('#report-name').fill('Test');await page.locator('#report-step-2').click();await page.locator('.report-field-cb[value=title]').check();await page.locator('#report-step-3').click();await page.locator('#report-add-filter').click();await page.locator('.modal-save-btn').click();await expect(page.locator('#report-form-error')).toContainText('пустой фильтр');await page.locator('#report-step-3').click();await page.locator('.report-filter-remove').click();await expect(page.locator('#report-form-error')).not.toContainText('пустой фильтр');
});
test('F17 confirmation isolates controls and Escape keeps draft',async({page})=>{
 await open(page,'dictionaries');await page.locator('[data-dict="did-client-groups"]').click();await page.locator('[data-new]').click();await page.locator('input[name=name]').fill('Draft');await page.locator('dialog [data-close]').click();
 expect(await page.locator('[data-editor]').evaluate(node=>node.inert)).toBe(true);
 await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).toHaveCount(0);await expect(page.locator('input[name=name]')).toHaveValue('Draft');expect(await page.locator('[data-editor]').evaluate(node=>node.inert)).toBe(false);expect(await page.evaluate(()=>window.__blockedWrites)).toEqual([]);
});
