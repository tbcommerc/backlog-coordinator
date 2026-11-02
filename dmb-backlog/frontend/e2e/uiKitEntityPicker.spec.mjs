import { test, expect } from '@playwright/test';

async function mount(page, {width=1280,theme='light',selected=null,disabled=false}={}) {
  await page.setViewportSize({width,height:900});
  await page.goto('/ui-catalog/core.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(async ({theme,selected,disabled})=>{
    await import('/e2e/fixtures/spaStyles.js');
    window.pickerUi=await import('/js/ui/index.js');
    document.documentElement.dataset.theme=theme;
    document.body.innerHTML='<main style="padding:16px;min-width:0"><form id="sample"></form></main>';
    document.querySelector('form').innerHTML=window.pickerUi.entityPicker({id:'task',name:'target_id',searchName:'q',label:'Задача',searchLabel:'Поиск задачи',selected,disabled,required:true})+'<button type="submit">Сохранить</button><button type="reset">Сбросить</button>';
    document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.submitted=Object.fromEntries(new FormData(event.target));});
    window.pickerRoot=document.querySelector('.ui-entity-picker');
  },{theme,selected,disabled});
}

for(const theme of ['light','dark'])for(const width of [1440,390,320])test(`picker layout and native keyboard ${theme}/${width}`,async({page},testInfo)=>{
  await mount(page,{width,theme});
  await page.evaluate(async()=>{
    window.picker=window.pickerUi.bindEntityPicker(window.pickerRoot,{load:async()=>[{value:1,label:'WRK-1 · '+ 'ДлинноеНазваниеБезПробелов'.repeat(10)},{value:2,label:'<img src=x onerror=alert(1)>'}]});
    await window.picker.refresh();
  });
  const choice=page.getByRole('combobox',{name:'Задача',exact:true});
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  await expect(choice).toBeFocused();
  expect(await page.evaluate(()=>window.submitted)).toBeUndefined();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await expect(choice).toHaveValue('1');
  await expect(page.locator('[data-entity-selected]')).toContainText('WRK-1');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();
  expect(await page.evaluate(()=>window.submitted.target_id)).toBe('1');
  await page.locator('.ui-entity-picker').screenshot({path:testInfo.outputPath('picker.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await choice.selectOption('2');await expect(page.locator('[data-entity-selected]')).toContainText('<img src=x');
  await expect(page.locator('img')).toHaveCount(0);
  await page.getByRole('button',{name:'Очистить выбор'}).click();
  await expect(choice).toHaveValue('');await expect(choice).toBeFocused();
  await expect(page.getByRole('button',{name:'Очистить выбор'})).toBeDisabled();
});

test('stale results are ignored immediately during debounce, requests abort, detach is safe',async({page})=>{
  await mount(page);
  await page.evaluate(()=>{
    window.pending=[];
    window.picker=window.pickerUi.bindEntityPicker(window.pickerRoot,{debounce:400,load:(q,{signal})=>new Promise(resolve=>window.pending.push({q,signal,resolve}))});
    window.picker.refresh();
  });
  await page.getByRole('searchbox',{name:'Поиск задачи'}).fill('new');
  await page.evaluate(()=>window.pending[0].resolve([{value:'old',label:'Old'}]));
  await expect(page.locator('option[value=old]')).toHaveCount(0);
  expect(await page.evaluate(()=>window.pending[0].signal.aborted)).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.pending.length)).toBe(2);
  await page.evaluate(()=>window.pending[1].resolve([{value:'new',label:'New'}]));
  await expect(page.locator('option[value=new]')).toHaveCount(1);
  await page.evaluate(()=>{window.picker.refresh();window.pickerRoot.remove();window.pending[2].resolve([{value:'detached',label:'Detached'}]);});
  expect(await page.evaluate(()=>window.pickerRoot.querySelector('option[value=detached]'))).toBeNull();
});

test('errors retry without losing current choice; empty results preserve selected record',async({page})=>{
  await mount(page,{selected:{value:'chosen',label:'Выбранная задача'}});
  await page.evaluate(async()=>{
    window.attempt=0;
    window.picker=window.pickerUi.bindEntityPicker(window.pickerRoot,{load:async()=>{if(++window.attempt===1)throw Error('offline');return [];}});
    await window.picker.refresh();
  });
  await expect(page.locator('[data-entity-status]')).toContainText('Не удалось');
  await expect(page.getByRole('combobox',{name:'Задача',exact:true})).toHaveValue('chosen');
  await page.getByRole('button',{name:'Повторить поиск'}).click();
  await expect(page.locator('.ui-entity-picker')).toHaveAttribute('data-ui-state','empty');
  await expect(page.locator('[data-entity-status]')).toContainText('Текущий выбор сохранён');
  await expect(page.getByRole('combobox',{name:'Задача',exact:true})).toHaveValue('chosen');
  await expect(page.getByRole('button',{name:'Повторить поиск'})).toBeHidden();
});

test('context reset clears selection immediately; destroy blocks pending responses and timers',async({page})=>{
  await mount(page,{selected:{value:'old',label:'Old kind'}});
  await page.evaluate(()=>{
    window.pending=[];
    window.picker=window.pickerUi.bindEntityPicker(window.pickerRoot,{load:(q,{signal})=>new Promise(resolve=>window.pending.push({signal,resolve}))});
    window.picker.refresh({reset:true});
  });
  await expect(page.getByRole('combobox',{name:'Задача',exact:true})).toHaveValue('');
  await expect(page.locator('option[value=old]')).toHaveCount(0);
  await page.evaluate(()=>{window.picker.destroy();window.pending[0].resolve([{value:'late',label:'Late'}]);});
  expect(await page.evaluate(()=>window.pending[0].signal.aborted)).toBe(true);
  await expect(page.locator('option[value=late]')).toHaveCount(0);
  await page.getByRole('searchbox',{name:'Поиск задачи'}).fill('after destroy');
  expect(await page.evaluate(()=>window.pending.length)).toBe(1);
});

test('form reset restores initial value, context reset changes baseline, duplicate items and disabled result',async({page})=>{
  await mount(page,{selected:{value:'1',label:'Initial'}});
  await page.evaluate(async()=>{
    window.items=[{value:'1',label:'Initial'},{value:'2',label:'Second'},{value:'2',label:'Duplicate'}];
    window.picker=window.pickerUi.bindEntityPicker(window.pickerRoot,{load:async()=>window.items});await window.picker.refresh();
  });
  await expect(page.locator('option[value="2"]')).toHaveCount(1);
  await page.getByRole('combobox',{name:'Задача',exact:true}).selectOption('2');
  await page.getByRole('button',{name:'Сбросить'}).click();
  await expect(page.getByRole('combobox',{name:'Задача',exact:true})).toHaveValue('1');
  await page.evaluate(async()=>{window.items=[{value:'1',label:'Initial',disabled:true}];await window.picker.refresh();});
  await expect(page.getByRole('combobox',{name:'Задача',exact:true})).toHaveValue('');
  await expect(page.locator('[data-entity-status]')).toContainText('недоступна');
  await page.evaluate(()=>window.picker.refresh({reset:true}));
  await page.getByRole('button',{name:'Сбросить'}).click();
  await expect(page.getByRole('combobox',{name:'Задача',exact:true})).toHaveValue('');
});

test('disabled picker never fetches; rebind replaces old owner',async({page})=>{
  await mount(page,{disabled:true,selected:{value:1,label:'Read only'}});
  await page.evaluate(async()=>{window.calls=0;window.picker=window.pickerUi.bindEntityPicker(window.pickerRoot,{load:async()=>{window.calls++;return [];}});await window.picker.refresh();});
  await expect(page.getByRole('combobox',{name:'Задача',exact:true})).toBeDisabled();
  await expect(page.getByRole('searchbox',{name:'Поиск задачи'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Очистить выбор'})).toBeDisabled();
  expect(await page.evaluate(()=>window.calls)).toBe(0);
  await page.evaluate(async()=>{
    document.querySelectorAll('input,select').forEach(el=>el.disabled=false);
    window.picker2=window.pickerUi.bindEntityPicker(window.pickerRoot,{debounce:0,load:async()=>{window.calls+=10;return [];}});
    window.picker.destroy();
  });
  await page.getByRole('searchbox',{name:'Поиск задачи'}).fill('new');
  await expect.poll(()=>page.evaluate(()=>window.calls)).toBe(10);
});

test('catalogue picker supports search, empty and clear',async({page})=>{
  await page.goto('/ui-catalog/index.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  const sample=page.locator('#entity-pickers');
  await sample.getByRole('searchbox').fill('WRK-2');
  await expect(sample.locator('option[value="1"]')).toHaveCount(0);
  await sample.getByRole('combobox').selectOption('2');
  await sample.getByRole('searchbox').fill('missing');
  await expect(sample.locator('[data-entity-status]')).toContainText('Ничего не найдено');
  await sample.getByRole('button',{name:'Очистить выбор'}).click();
  await expect(sample.getByRole('combobox')).toHaveValue('');
});

test('Enter in search searches immediately without submitting the containing form',async({page})=>{
  await mount(page,{selected:{value:'1',label:'Selected'}});
  await page.evaluate(()=>{
    window.queries=[];
    window.picker=window.pickerUi.bindEntityPicker(window.pickerRoot,{debounce:10000,load:async query=>{window.queries.push(query);return [];}});
  });
  await page.getByRole('searchbox').fill('target');await page.keyboard.press('Enter');
  await expect.poll(()=>page.evaluate(()=>window.queries)).toEqual(['target']);
  expect(await page.evaluate(()=>window.submitted)).toBeUndefined();
  await page.evaluate(()=>window.picker.destroy());
});
