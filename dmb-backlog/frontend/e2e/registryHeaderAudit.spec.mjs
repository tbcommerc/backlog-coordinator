import { test, expect } from '@playwright/test';
import { setup } from './stickyRegistrySetup.mjs';

async function measureHeaders(page) {
  return page.evaluate(()=>{
    const table=document.querySelector('main table[data-ui-sticky-header="page"]');
    const dock=document.querySelector('.ui-table-sticky-header');
    const heads=[table.tHead,...(dock?[dock.querySelector('thead')]:[])];
    const violations=[];
    for(const [headIndex,head] of heads.entries()) for(const [column,cell] of [...head.rows[0].cells].entries()) {
      const style=getComputedStyle(cell),box=cell.getBoundingClientRect();
      if(style.display==='none'||!box.width) continue;
      const label=cell.querySelector('.th-label'),icon=cell.querySelector('.sort-icon');
      if(label&&icon) {
        const l=label.getBoundingClientRect(),i=icon.getBoundingClientRect();
        if(i.left-l.right<7.5) violations.push({headIndex,column,kind:'sort overlap',gap:i.left-l.right});
        if(i.right>box.right-parseFloat(style.paddingRight)+.75) violations.push({headIndex,column,kind:'icon outside cell'});
      }
      const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()) {
        const node=walker.currentNode;
        if(!node.textContent.trim()||node.parentElement.closest('.sr-only,.sort-icon,.th-resize-handle')) continue;
        const range=document.createRange();range.selectNodeContents(node);
        for(const r of range.getClientRects()) {
          let left=r.left,right=r.right,top=r.top,bottom=r.bottom;
          const clipped=node.parentElement.closest('.th-label');
          if(clipped) {
            const clip=clipped.getBoundingClientRect();
            left=Math.max(left,clip.left);right=Math.min(right,clip.right);
            top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);
          }
          if(right<=left||bottom<=top) continue;
          if(left<box.left+parseFloat(style.paddingLeft)-1||right>box.right-parseFloat(style.paddingRight)+1||top<box.top-1||bottom>box.bottom+1)
            violations.push({headIndex,column,kind:'text outside cell',text:node.textContent.trim(),cell:[box.left,box.right],textBox:[left,right,top,bottom]});
        }
      }
    }
    const source=[...table.tHead.rows[0].cells];
    const copy=dock?[...dock.querySelector('thead').rows[0].cells]:[];
    const body=table.tBodies[0].rows[0];
    for(const [column,cell] of source.entries()) {
      const a=cell.getBoundingClientRect(),b=copy[column]?.getBoundingClientRect(),c=body.cells[column]?.getBoundingClientRect();
      if(b&&(Math.abs(a.x-b.x)>1.1||Math.abs(a.width-b.width)>1.1||Math.abs(a.height-b.height)>1.1))
        violations.push({column,kind:'projection alignment',source:[a.x,a.width,a.height],copy:[b.x,b.width,b.height]});
      if(c&&(Math.abs(a.x-c.x)>1.1||Math.abs(a.width-c.width)>1.1)) violations.push({column,kind:'body alignment'});
    }
    return {violations,headHeight:table.tHead.getBoundingClientRect().height,columns:source.length,
      resizeHandles:table.tHead.querySelectorAll('.th-resize-handle').length,
      sortButtons:table.tHead.querySelectorAll('.table-sort-button,[data-ui-sort]').length};
  });
}

for(const surface of ['backlog','metrics','projects','work']) for(const theme of ['light','dark']) {
  test(`registry header audit ${surface} ${theme}`,async({page},info)=>{
    test.setTimeout(90_000);
    await page.setViewportSize({width:1440,height:900});
    await setup(page,surface,theme);
    const table=page.locator('main table[data-ui-sticky-header="page"]').first();
    await expect(table.locator('tbody td').first()).toBeVisible();
    await page.evaluate(()=>document.fonts.ready);
    if(surface==='backlog') {
      // Exercise dragging as well as the keyboard resize covered by stickyRegistryHeaders.
      for(const key of ['priority','team']) {
        const handle=await table.locator(`th[data-sort=${key}] .th-resize-handle`).boundingBox();
        await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);
        await page.mouse.down();await page.mouse.move(handle.x-45,handle.y+handle.height/2,{steps:8});await page.mouse.up();
      }
    }
    for(const width of [1440,1024,768]) {
      await page.setViewportSize({width,height:900});
      await page.locator('.main-content').evaluate(el=>{el.scrollTop=0;});
      await expect(page.locator('.ui-table-sticky-header')).toHaveCount(0);
      if(await table.locator('thead').evaluate(el=>getComputedStyle(el).display!=='table-header-group')) {
        await page.locator('.main-content').evaluate(el=>{el.scrollTop=600;});
        await expect(page.locator('.ui-table-sticky-header')).toHaveCount(0);
        await page.screenshot({path:info.outputPath(`${width}-cards.png`),fullPage:true});
        continue;
      }
      const top=await measureHeaders(page);
      await page.screenshot({path:info.outputPath(`${width}-top.png`),fullPage:true});
      expect.soft(top.violations,`${surface} ${width} source`).toEqual([]);
      await page.locator('.main-content').evaluate(el=>{el.scrollTop=600;});
      await expect(page.locator('.ui-table-sticky-header')).toBeVisible();
      await expect.poll(async()=> (await measureHeaders(page)).violations,`${surface} ${width} dock`).toEqual([]);
      await page.screenshot({path:info.outputPath(`${width}-sticky.png`),fullPage:true});
      const scrollArea=page.locator('main .table-container,main .ui-data-table-scroll').first();
      if(await scrollArea.count()) await scrollArea.evaluate(el=>{el.scrollLeft=el.scrollWidth;});
      await expect.poll(async()=> (await measureHeaders(page)).violations,`${surface} ${width} horizontal`).toEqual([]);
      if(width===1440) {
        await page.getByRole('button',{name:'Свернуть или развернуть боковую панель'}).click();
        await expect.poll(async()=> (await measureHeaders(page)).violations,`${surface} ${width} sidebar`).toEqual([]);
        await page.screenshot({path:info.outputPath(`${width}-sidebar.png`),fullPage:true});
        await page.getByRole('button',{name:'Свернуть или развернуть боковую панель'}).click();
      }
    }
  });
}

for(const theme of ['light','dark']) test(`annual header audit ${theme}`,async({page},info)=>{
  await page.setViewportSize({width:390,height:844});
  await setup(page,'metrics',theme);
  await page.getByRole('button',{name:'Год',exact:true}).click();
  await expect(page.locator('.qmetric-year table')).toBeVisible();
  await page.locator('.main-content').evaluate(el=>{el.scrollTop=500;});
  await expect(page.locator('.ui-table-sticky-header')).toBeVisible();
  const scrollArea=page.locator('.qmetric-year .ui-data-table-scroll');
  expect(await scrollArea.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeGreaterThan(100);
  for(const position of [0,300,2000]) {
    await scrollArea.evaluate((el,x)=>{el.scrollLeft=x;},position);
    if(position) expect(await scrollArea.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
    await expect.poll(async()=> (await measureHeaders(page)).violations).toEqual([]);
    const pinnedCell=scrollArea.locator('tbody tr').nth(3).locator('td').first();
    await pinnedCell.hover();
    const hoverBackground=await pinnedCell.evaluate(el=>getComputedStyle(el.parentElement).backgroundColor);
    expect(hoverBackground).toMatch(/^rgb\([^)]+\)$/);
    await expect(pinnedCell).toHaveCSS('background-color',hoverBackground);
    await page.screenshot({path:info.outputPath(`annual-${position}.png`),fullPage:true});
  }
});
