import {test,expect} from '@playwright/test';
for(const width of [320,1440])test(`form errors keep readable summary and aligned fields: ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/ui-catalog/core.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.evaluate(async()=>{const ui=await import('/js/ui/index.js');document.querySelector('main').innerHTML='<form><div class="ui-form-grid">'+ui.field({id:'begin',label:'Начало'})+ui.field({id:'end',label:'Окончание'})+'</div></form>';ui.showFormErrors(document.querySelector('form'),{end:'Окончание периода должно быть не раньше начала, исправьте дату'});});
 const summary=page.locator('[data-ui-error-summary]');await expect(summary.locator('strong')).toHaveText('Проверьте поля: 1');await expect(summary.locator('ul li a')).toHaveCount(1);
 expect(await summary.locator('a').evaluate(e=>e.getBoundingClientRect().top)).toBeGreaterThan(await summary.locator('strong').evaluate(e=>e.getBoundingClientRect().bottom));
 await expect(page.locator('#end')).toBeFocused();await expect(page.locator('#end')).toHaveAttribute('aria-invalid','true');
 if(width===1440)expect(await page.evaluate(()=>Math.abs(document.getElementById('begin').getBoundingClientRect().top-document.getElementById('end').getBoundingClientRect().top))).toBeLessThanOrEqual(1);
});
