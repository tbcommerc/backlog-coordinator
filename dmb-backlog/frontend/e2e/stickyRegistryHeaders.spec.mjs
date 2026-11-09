import { test, expect } from '@playwright/test';
import { setup } from './stickyRegistrySetup.mjs';

for (const surface of ['backlog','metrics','projects','work']) for (const theme of ['light','dark']) {
  test(`sticky registry ${surface} ${theme}`, async ({page},info)=>{
    await page.setViewportSize({width:1440,height:900});
    await setup(page,surface,theme);
    const table=page.locator('main table.ui-table-data').first();
    await expect(table.locator('tbody td').first()).toBeVisible();
    await page.evaluate(()=>document.fonts.ready);
    await expect(table).toHaveAttribute('data-ui-sticky-header','page');
    const dock=page.locator('.ui-table-sticky-header');
    await expect(dock).toHaveCount(0);
    await page.screenshot({path:info.outputPath(`${surface}-${theme}-top.png`),fullPage:true});
    await page.locator('.main-content').evaluate(el=>{el.scrollTop=450;});
    await expect(dock).toBeVisible();
    const geo=await page.evaluate(()=>{
      const dock=document.querySelector('.ui-table-sticky-header'), surface=dock.querySelector('.ui-table-sticky-surface');
      const nav=document.querySelector('.navbar').getBoundingClientRect();
      const table=document.querySelector('main table.ui-table-data');
      return {gap:surface.getBoundingClientRect().top-nav.bottom,background:getComputedStyle(dock).backgroundColor,
        expected:getComputedStyle(document.querySelector('main')).backgroundColor,
        widths:[...table.querySelectorAll('thead th')].map((th,i)=>Math.abs(th.getBoundingClientRect().width-dock.querySelectorAll('th')[i].getBoundingClientRect().width)),
        original:getComputedStyle(table.tHead).visibility};
    });
    expect(geo.gap).toBeCloseTo(16,0);
    expect(geo.background).toBe(geo.expected);
    expect(Math.max(...geo.widths)).toBeLessThan(1.1);
    expect(geo.original).toBe('hidden');
    await page.screenshot({path:info.outputPath(`${surface}-${theme}-scrolled.png`),fullPage:true});
    await page.locator('.main-content').evaluate(el=>{el.scrollTop+=150;});
    expect((await dock.boundingBox()).y).toBeCloseTo((await page.locator('.navbar').boundingBox()).height,0);
    await page.locator('.main-content').evaluate(el=>{el.scrollTop=0;});
    await expect(dock).toHaveCount(0);
    await expect(table.locator('thead')).toBeVisible();
    await page.locator('.main-content').evaluate(el=>{el.scrollTop=450;});
    await expect(dock).toBeVisible();
    await page.locator('.sidebar-item').first().click();
    await expect(dock).toHaveCount(0);
  });
}

for(const surface of ['metrics','projects','work']) test(`sticky registry ${surface} mobile cards`,async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  await setup(page,surface,'light');
  await expect(page.locator('main table.ui-table-data tbody td').first()).toBeVisible();
  await page.locator('.main-content').evaluate(el=>{el.scrollTop=450;});
  await expect(page.locator('.ui-table-sticky-header')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`${surface}-mobile.png`),fullPage:true});
});

test('sticky backlog keeps pinned cells, selection, sort and keyboard resize',async({page},info)=>{
  await page.setViewportSize({width:1366,height:768});
  await setup(page,'backlog','light');
  await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
  await page.locator('#backlog-btn-column-settings').click();
  await page.locator('#backlog-col-select-all').click();
  await page.getByRole('button',{name:'Закрыть настройки колонок'}).click();
  await page.locator('#tasks-container .table-container').evaluate(el=>{el.scrollLeft=700;});
  await page.locator('.main-content').evaluate(el=>{el.scrollTop=500;});
  const dock=page.locator('#sticky-header-wrapper');
  await expect(dock).toBeVisible();
  const header=await dock.locator('.table-pinned-id').boundingBox();
  const body=await page.locator('#tasks-table tbody .table-pinned-id').first().boundingBox();
  expect(Math.abs(header.x-body.x)).toBeLessThan(2);
  await dock.locator('input[type=checkbox]').check();
  await expect(page.locator('#tasks-table tbody input[type=checkbox]').first()).toBeChecked();
  await dock.locator('th[data-sort=id] .table-sort-button').press('Enter');
  await expect(page.locator('#tasks-table th[data-sort=id]')).toHaveAttribute('aria-sort','ascending');
  await expect(dock).toBeVisible();
  const before=(await page.locator('#tasks-table th[data-sort=id]').boundingBox()).width;
  await dock.locator('th[data-sort=id] .th-resize-handle').press('ArrowRight');
  await expect.poll(async()=>(await page.locator('#tasks-table th[data-sort=id]').boundingBox()).width).toBeGreaterThan(before+8);
  await page.screenshot({path:info.outputPath('backlog-horizontal.png'),fullPage:true});
});
