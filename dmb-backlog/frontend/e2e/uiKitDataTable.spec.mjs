import { test, expect } from '@playwright/test';

async function mount(page, width=1280, theme='light') {
  await page.setViewportSize({width,height:900});
  await page.goto('/ui-catalog/core.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(async theme=>{
    await import('/e2e/fixtures/spaStyles.js');
    window.tableUi=await import('/js/ui/index.js');
    document.documentElement.dataset.theme=theme;
    document.body.innerHTML='<main style="padding:16px;min-width:0"><div id="sample"></div></main>';
  },theme);
}

for(const theme of ['light','dark'])for(const width of [1440,390,320])test(`table cards ${theme}/${width}`,async({page},testInfo)=>{
  await mount(page,width,theme);
  await page.evaluate(()=>{
    const {dataTable,tableCell}=window.tableUi;
    document.querySelector('#sample').innerHTML=dataTable({label:'Показатели команды',responsive:'cards',rows:[{title:'ДлинноеНазваниеБезПробелов'.repeat(12),value:0,date:'2026-10-29',owner:null}],columns:[
      {key:'title',label:'Название',render:r=>tableCell({value:r.title,type:'link',href:'#/metrics/1',secondary:'<img src=x onerror=alert(1)>'})},
      {key:'value',label:'Значение',type:'number'}, {key:'date',label:'Дата',type:'date'}, {key:'owner',label:'Владелец'},
    ]});
  });
  const table=page.getByRole('table',{name:'Показатели команды'});
  await expect(table).toBeVisible();
  await expect(table.locator('td').nth(1)).toHaveText('0');
  await expect(table.locator('time')).toHaveText('29.10.2026');
  await expect(table.locator('td').nth(3)).toHaveText('—');
  await expect(table.locator('img')).toHaveCount(0);
  await table.getByRole('link').focus();await expect(table.getByRole('link')).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(await table.evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  if(width<700) expect(await table.locator('td').nth(1).evaluate(el=>getComputedStyle(el,'::before').content)).toContain('Значение');
  await page.locator('#sample').screenshot({path:testInfo.outputPath('table.png')});
});

test('controlled sorting, keyboard, rebinding, busy and dispose',async({page})=>{
  await mount(page,390);
  await page.evaluate(()=>{
    const ui=window.tableUi,host=document.querySelector('#sample');window.sortCalls=[];
    host.innerHTML=ui.dataTable({label:'Очередь',responsive:'cards',sort:{key:'x',direction:'asc'},rows:[{x:'B'},{x:'A'}],columns:[{key:'x',label:'Название',sortable:true}]});
    window.oldDispose=ui.bindDataTable(host,{onSort:()=>window.sortCalls.push('old')});
    window.tableDispose=ui.bindDataTable(host,{onSort:s=>window.sortCalls.push(s)});
    window.oldDispose();
  });
  const sort=page.getByRole('button',{name:'Название: сортировать по убыванию'});
  await sort.focus();await page.keyboard.press('Enter');
  expect(await page.evaluate(()=>window.sortCalls)).toEqual([{key:'x',direction:'desc'}]);
  await expect(page.locator('tbody tr').first()).toHaveText('B');
  await expect(page.locator('th')).toHaveAttribute('aria-sort','ascending');
  await page.evaluate(()=>document.querySelector('.ui-data-table').setAttribute('aria-busy','true'));
  await sort.click();expect(await page.evaluate(()=>window.sortCalls.length)).toBe(1);
  await page.evaluate(()=>{document.querySelector('.ui-data-table').removeAttribute('aria-busy');window.tableDispose();});
  await sort.click();expect(await page.evaluate(()=>window.sortCalls.length)).toBe(1);
});

test('empty loading error retry, hidden, and horizontal scrolling',async({page})=>{
  await mount(page,320);
  for(const state of ['empty','loading','error']){
    await page.evaluate(state=>{document.querySelector('#sample').innerHTML=window.tableUi.dataTable({label:'Записи',state,columns:[{key:'title',label:'Название'}],rows:[],actionLabel:'Повторить',actionAttrs:{'data-test-retry':true}});},state);
    await expect(page.getByRole(state==='error'?'alert':'status')).toBeVisible();
    await expect(page.locator('[data-test-retry]')).toHaveCount(state==='loading'?0:1);
    await expect(page.locator('table')).toHaveCount(0);
    const geometry = await page.locator('.view-state').evaluate(el => {
      const box = el.getBoundingClientRect();
      return [...el.children].map(child => {
        const rect = child.getBoundingClientRect();
        return Math.abs((rect.left + rect.right - box.left - box.right) / 2);
      });
    });
    for (const offset of geometry) expect(offset).toBeLessThanOrEqual(1);
    await expect(page.locator('.view-state')).toHaveCSS('text-align', 'center');
  }
  await page.evaluate(()=>{
    document.querySelector('#sample').innerHTML=window.tableUi.dataTable({label:'Широкая таблица',columns:[{key:'title',label:'Название'}],rows:[{title:'Показатель'}]});
  });
  const region=page.getByRole('region',{name:'Широкая таблица — таблица'});
  await region.focus();await page.keyboard.press('ArrowRight');
  await expect.poll(()=>region.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.evaluate(()=>document.querySelector('.ui-data-table').hidden=true);
  await expect(region).toBeHidden();
});

test('catalogue table sorts values and retains keyboard focus',async({page},testInfo)=>{
  await page.setViewportSize({width:390,height:900});
  await page.goto('/ui-catalog/index.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  const demo=page.locator('#data-tables');
  await demo.getByRole('button',{name:'Значение: сортировать по возрастанию'}).click();
  await expect(demo.locator('tbody tr').first()).toContainText('Качество данных');
  await expect(demo.getByRole('button',{name:'Значение: сортировать по убыванию'})).toBeFocused();
  await page.keyboard.press('Space');
  await expect(demo.locator('tbody tr').first()).toContainText('Скорость обработки');
  await demo.screenshot({path:testInfo.outputPath('catalogue-table.png')});
});
