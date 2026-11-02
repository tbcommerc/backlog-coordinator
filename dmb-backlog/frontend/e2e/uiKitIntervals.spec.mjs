import {test,expect} from '@playwright/test';

async function mount(page,width=1280,theme='light'){
 await page.setViewportSize({width,height:900});await page.goto('/ui-catalog/core.html');
 await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.evaluate(async theme=>{
  await import('/e2e/fixtures/spaStyles.js');window.ui=await import('/js/ui/index.js');
  document.documentElement.dataset.theme=theme;
  document.body.innerHTML='<main style="padding:16px;min-width:0"><form id="sample"></form></main>';
  document.querySelector('form').innerHTML=ui.dateRange({id:'dates',label:'Период',required:true,from:{name:'start',label:'Начало',value:'2026-10-01'},to:{name:'end',label:'Окончание',value:'2026-12-31'}})+ui.numberRange({id:'numbers',label:'Допустимые значения',from:{name:'lower',value:0},to:{name:'upper',value:100},hint:'Можно указать одну границу.'})+'<button type="submit">Проверить</button><button type="reset">Сбросить</button>';
  document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();ui.clearFormErrors(e.target);const errors=ui.validateRanges(e.target);window.rangeErrors=errors;if(Object.keys(errors).length)ui.showFormErrors(e.target,errors);else window.values=Object.fromEntries(new FormData(e.target));});
  document.querySelector('form').addEventListener('reset',e=>ui.clearFormErrors(e.target));
 },theme);
}

for(const theme of ['light','dark'])for(const width of [1440,390,320])test(`intervals ${theme}/${width}`,async({page},testInfo)=>{
 await mount(page,width,theme);
 await expect(page.getByRole('group',{name:'Период',exact:true})).toBeVisible();
 await page.locator('#dates-to').fill('2026-09-30');await page.locator('#numbers-to').fill('-0.5');
 await page.getByRole('button',{name:'Проверить',exact:true}).click();
 await expect(page.locator('#dates-to')).toBeFocused();
 await expect(page.locator('#dates-to')).toHaveAttribute('aria-invalid','true');
 await expect(page.locator('#numbers-to')).toHaveAttribute('aria-invalid','true');
 await expect(page.locator('#numbers-from')).toHaveValue('0');
 await page.locator('[data-ui-error-summary] a').last().click();await expect(page.locator('#numbers-to')).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 await page.locator('form').screenshot({path:testInfo.outputPath('ranges-errors.png')});
 await page.locator('#dates-to').fill('2026-10-01');await page.locator('#numbers-to').fill('0');
 await page.getByRole('button',{name:'Проверить',exact:true}).click();
 expect(await page.evaluate(()=>window.values)).toEqual({start:'2026-10-01',end:'2026-10-01',lower:'0',upper:'0'});
 await expect(page.locator('[data-ui-error-summary]')).toHaveCount(0);
});

test('open bounds, negative decimals, exponent, order opt-out and native limits',async({page})=>{
 await mount(page);
 await page.locator('#numbers-from').fill('-2.75');await page.locator('#numbers-to').fill('-3.5');
 expect(await page.evaluate(()=>ui.validateRanges(document.querySelector('form')))).toHaveProperty('numbers-to');
 await page.locator('#numbers-to').fill('');
 expect(await page.evaluate(()=>ui.validateRanges(document.querySelector('form')))).toEqual({});
 await page.locator('#numbers-from').fill('2e2');await page.locator('#numbers-to').fill('100');
 expect(await page.evaluate(()=>ui.validateRanges(document.querySelector('#numbers')))).toHaveProperty('numbers-to');
 await page.evaluate(()=>document.querySelector('#numbers').dataset.rangeOrder='false');
 expect(await page.evaluate(()=>ui.validateRanges(document.querySelector('form')))).toEqual({});
 await page.evaluate(()=>{const field=document.querySelector('#numbers-from');field.min='0';field.max='10';field.step='0.5';});
 await page.locator('#numbers-from').fill('10.25');
 expect(await page.locator('#numbers-from').evaluate(el=>({range:el.validity.rangeOverflow,step:el.validity.stepMismatch}))).toEqual({range:true,step:true});
});

test('disabled, readonly, hidden and reset respect native form semantics',async({page})=>{
 await mount(page);
 await page.locator('#dates-to').fill('2025-01-01');
 await page.evaluate(()=>document.querySelector('#dates').disabled=true);
 expect(await page.evaluate(()=>ui.validateRanges(document.querySelector('form')))).toEqual({});
 expect(await page.evaluate(()=>Object.fromEntries(new FormData(document.querySelector('form'))))).not.toHaveProperty('start');
 await page.evaluate(()=>{document.querySelector('#dates').disabled=false;document.querySelector('#dates-to').readOnly=true;});
 expect(await page.evaluate(()=>ui.validateRanges(document.querySelector('form')))).toEqual({});
 await page.evaluate(()=>{document.querySelector('#dates-to').readOnly=false;document.querySelector('#dates').hidden=true;});
 await expect(page.getByRole('group',{name:'Период'})).toBeHidden();
 expect(await page.evaluate(()=>ui.validateRanges(document.querySelector('form')))).toEqual({});
 await page.evaluate(()=>document.querySelector('#dates').hidden=false);
 await page.getByRole('button',{name:'Проверить',exact:true}).click();
 await page.getByRole('button',{name:'Сбросить',exact:true}).click();
 await expect(page.locator('#dates-to')).toHaveValue('2026-12-31');
 await expect(page.locator('[data-ui-error-summary]')).toHaveCount(0);
});

test('required empty dates use native validation; optional single bound is valid',async({page})=>{
 await mount(page);
 await page.locator('#dates-from').fill('');await page.getByRole('button',{name:'Проверить',exact:true}).click();
 await expect(page.locator('#dates-from')).toBeFocused();
 expect(await page.locator('#dates-from').evaluate(el=>el.validity.valueMissing)).toBe(true);
 await page.evaluate(()=>document.querySelector('#dates-from').required=false);
 await page.getByRole('button',{name:'Проверить',exact:true}).click();
 expect(await page.evaluate(()=>window.values.start)).toBe('');
});

test('catalogue validates ranges and preserves values on correction',async({page})=>{
 await page.goto('/ui-catalog/index.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.locator('#demo-numbers-to').fill('-1');await page.getByRole('button',{name:'Проверить диапазоны'}).click();
 await expect(page.locator('#demo-numbers-to')).toBeFocused();
 await page.locator('#demo-numbers-to').fill('0');await page.getByRole('button',{name:'Проверить диапазоны'}).click();
 await expect(page.locator('#demo-interval-result')).toHaveText('Диапазоны корректны');
});
