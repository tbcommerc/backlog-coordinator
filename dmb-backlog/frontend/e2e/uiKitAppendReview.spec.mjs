import {test,expect} from '@playwright/test';
async function open(page){
 await page.goto('/e2e/fixtures/uiKitExpress.html');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(()=>{window.__reads=[];window.__failAppend=true;window.app.api.get=async path=>{window.__reads.push(path);const p=new URL('http://fixture'+path);if(p.pathname!=='/quick-estimate/backlog-tasks')return [];const offset=Number(p.searchParams.get('offset'));if(offset===20&&window.__failAppend){window.__failAppend=false;throw Error('Synthetic network failure');}return {total:40,items:Array.from({length:20},(_,i)=>({id:offset+i+1,title:'Задача '+(offset+i+1),version:1}))};};});
 await page.locator('#express-import-btn').click();await expect(page.locator('.import-task-check')).toHaveCount(20);
}
test('failed append retains rows, selection and retries the same page',async({page})=>{
 await open(page);await page.locator('.import-task-check').first().check();await page.locator('.qe-load-more').click();
 await expect(page.locator('.qe-import-error')).toBeVisible();await expect(page.locator('.import-task-check')).toHaveCount(20);await expect(page.locator('.import-task-check').first()).toBeChecked();
 await page.locator('.qe-load-more').click();await expect(page.locator('.import-task-check')).toHaveCount(40);
 expect(await page.evaluate(()=>window.__reads.filter(p=>p.includes('backlog-tasks')).map(p=>new URL('http://fixture'+p).searchParams.get('offset')))).toEqual(['0','20','20']);
 await expect(page.locator('.import-task-check').nth(20)).toBeFocused();await expect(page.locator('.import-task-check').first()).toHaveAccessibleName(/Выбрать TASK-.*Задача 1/);
});
test('an old delayed search cannot replace the latest query',async({page})=>{
 await open(page);await page.evaluate(()=>{window.app.api.get=async path=>{const q=new URL('http://fixture'+path).searchParams.get('q');if(q==='old')await new Promise(resolve=>window.__releaseOld=resolve);return {total:1,items:[{id:q==='new'?202:101,title:q,version:1}]};};});
 await page.locator('#import-search').fill('old');await expect.poll(()=>page.evaluate(()=>typeof window.__releaseOld)).toBe('function');
 await page.locator('#import-search').fill('new');await expect(page.locator('.import-task-check')).toHaveAttribute('data-task-id','202');
 await page.evaluate(()=>window.__releaseOld());await expect(page.locator('.import-task-check')).toHaveAttribute('data-task-id','202');
});

test('reporting append retains drafts and moves focus to newly displayed tasks',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitReportingWorkspaces.html?many=101');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await expect(page.locator('[data-reporting-task]')).toHaveCount(50);await page.locator('[data-reporting-text="1"]').fill('Сохранить мой черновик');
 await page.locator('[data-reporting-load-more]').click();await expect(page.locator('[data-reporting-task]')).toHaveCount(100);await expect(page.locator('[data-reporting-text="1"]')).toHaveValue('Сохранить мой черновик');
 expect(await page.locator('[data-reporting-task="51"]').evaluate(e=>e.contains(document.activeElement))).toBe(true);
 await page.locator('[data-reporting-load-more]').click();await expect(page.locator('[data-reporting-task]')).toHaveCount(101);expect(await page.locator('[data-reporting-task="101"]').evaluate(e=>e.contains(document.activeElement))).toBe(true);
 expect(await page.evaluate(()=>window.__writes)).toEqual([]);
});
test('notification filters use single-line FilterChip at 320px',async({page})=>{
 await page.setViewportSize({width:320,height:900});await page.goto('/e2e/fixtures/uiKitRegistries.html?surface=notifications');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 const chips=page.locator('.notification-filter-chip');expect(await chips.count()).toBeGreaterThan(5);
 for(const chip of await chips.all()){await expect(chip).toHaveClass(/ui-filter-chip/);await expect(chip.locator('.quick-filter-label')).toHaveCSS('white-space','nowrap');expect(await chip.locator('.quick-filter-label').evaluate(e=>e.getBoundingClientRect().height)).toBeLessThanOrEqual(19);}
});
