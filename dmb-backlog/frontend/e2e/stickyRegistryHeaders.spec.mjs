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
    // Inspect rendered pixels beyond both viewport edges: an uncovered outer
    // table border is visible in the gap even when its computed background is opaque.
    const box=await dock.boundingBox();
    const gapImage=await page.screenshot({clip:{x:Math.floor(box.x)-2,y:Math.ceil(box.y)+2,width:Math.ceil(box.width)+4,height:10}});
    const gapIsUniform=await page.evaluate(async base64=>{
      const img=new Image();
      img.src=`data:image/png;base64,${base64}`;
      await img.decode();
      const canvas=document.createElement('canvas');
      canvas.width=img.width; canvas.height=img.height;
      const ctx=canvas.getContext('2d');
      ctx.drawImage(img,0,0);
      const pixels=ctx.getImageData(0,0,img.width,img.height).data;
      return pixels.every((value,index)=>value===pixels[index%4]);
    },gapImage.toString('base64'));
    expect(gapIsUniform,'The entire gap, including the outer table borders, must be one opaque colour').toBe(true);
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

test('sticky header follows sidebar resize, keeps focus and leaves with the table',async({page})=>{
  await page.setViewportSize({width:1366,height:768});
  await setup(page,'backlog','light');
  await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
  await page.locator('#tasks-table th[data-sort=id] button').focus();
  await page.locator('.main-content').evaluate(el=>{el.scrollTop=400;});
  await expect(page.locator('#sticky-header-wrapper th[data-sort=id] button')).toBeFocused();
  await page.getByRole('button',{name:'Свернуть или развернуть боковую панель'}).click();
  await expect.poll(()=>page.evaluate(()=>{
    const surface=document.querySelector('.ui-table-sticky-header').getBoundingClientRect();
    const table=document.querySelector('#tasks-table').getBoundingClientRect();
    return Math.abs(surface.left-table.left);
  })).toBeLessThan(1.1);
  await page.locator('.main-content').evaluate(el=>{el.scrollTop=0;});
  await expect(page.locator('#sticky-header-wrapper')).toHaveCount(0);
  // Extra fixture content makes the table's lower boundary reachable independently
  // of the page end, without adding records or modifying production markup.
  await page.locator('#pagination').evaluate(el=>{el.style.paddingBottom='100vh';});
  await page.locator('.main-content').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await expect(page.locator('#sticky-header-wrapper')).toHaveCount(0);
});

test('quick edit reserves its actual toolbar height above the opaque gap',async({page},info)=>{
  await page.setViewportSize({width:1440,height:900});
  await setup(page,'backlog','light');
  await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
  await page.locator('#backlog-inline-edit').click();
  await expect(page.locator('.qe-toolbar')).toBeVisible();
  await page.locator('.main-content').evaluate(el=>{el.scrollTop=500;});
  await expect(page.locator('#sticky-header-wrapper')).toBeVisible();
  const gap=await page.evaluate(()=>document.querySelector('.ui-table-sticky-surface').getBoundingClientRect().top-document.querySelector('.qe-toolbar').getBoundingClientRect().bottom);
  expect(gap).toBeCloseTo(16,0);
  await page.screenshot({path:info.outputPath('quick-edit-sticky.png'),fullPage:true});
});

test('annual metrics scroll horizontally with the pinned metric column',async({page},info)=>{
  await page.setViewportSize({width:1024,height:768});
  await setup(page,'metrics','light');
  await page.getByRole('button',{name:'Год',exact:true}).click();
  const table=page.locator('.qmetric-year table');
  await expect(table).toBeVisible();
  await page.locator('.qmetric-year .ui-data-table-scroll').evaluate(el=>{el.scrollLeft=300;});
  await page.locator('.main-content').evaluate(el=>{el.scrollTop=400;});
  await expect(page.locator('.ui-table-sticky-header')).toBeVisible();
  const source=await table.locator('thead th').first().boundingBox();
  const docked=await page.locator('.ui-table-sticky-header th').first().boundingBox();
  expect(Math.abs(source.x-docked.x)).toBeLessThan(1.1);
  await page.screenshot({path:info.outputPath('metrics-year-sticky.png'),fullPage:true});
});

for(const theme of ['light','dark']) test(`sort indicators stay clear of wrapped labels ${theme}`,async({page},info)=>{
  await page.setViewportSize({width:1440,height:900});
  await setup(page,'backlog',theme);
  await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
  // Match long configured headings, then narrow columns using the actual control.
  await page.locator('#tasks-table th[data-sort=team] .th-label').evaluate(el=>{el.textContent='Ответственная команда';});
  for(const key of ['priority','team']) {
    const handle=page.locator(`#tasks-table th[data-sort=${key}] .th-resize-handle`);
    for(let i=0;i<4;i++) await handle.press('Shift+ArrowLeft');
  }
  const assertSpacing=async selector=>{
    const metrics=await page.locator(`${selector} .table-sort-button`).evaluateAll(buttons=>buttons.map(button=>{
      const label=button.querySelector('.th-label'),icon=button.querySelector('.sort-icon');
      const text=document.createRange(); text.selectNodeContents(label);
      const iconRect=icon.getBoundingClientRect(),buttonRect=button.getBoundingClientRect();
      return {gap:Math.min(...[...text.getClientRects()].map(rect=>iconRect.left-rect.right)),
        overflow:label.scrollWidth-label.clientWidth,iconOverflow:iconRect.right-buttonRect.right,
        lines:label.getBoundingClientRect().height/parseFloat(getComputedStyle(label).lineHeight)};
    }));
    for(const item of metrics) {
      expect(item.gap).toBeGreaterThanOrEqual(7.8);
      expect(item.overflow).toBeLessThanOrEqual(1);
      expect(item.iconOverflow).toBeLessThanOrEqual(.5);
      expect(item.lines).toBeLessThanOrEqual(2.05);
    }
  };
  await assertSpacing('#tasks-table');
  await page.screenshot({path:info.outputPath('narrow-sort-top.png'),fullPage:true});
  await page.locator('.main-content').evaluate(el=>{el.scrollTop=450;});
  await expect(page.locator('#sticky-header-wrapper')).toBeVisible();
  await assertSpacing('#sticky-header-wrapper');
  await page.locator('#sticky-header-wrapper th[data-sort=priority] button').press('Enter');
  await expect(page.locator('#tasks-table th[data-sort=priority]')).toHaveAttribute('aria-sort','ascending');
  await assertSpacing('#sticky-header-wrapper');
  await page.screenshot({path:info.outputPath('narrow-sort-sticky.png'),fullPage:true});
});
