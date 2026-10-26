import { test, expect } from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.goto('/ui-catalog/index.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready','true');
});

test('validation preserves descriptions, external invalid state and repeated error lifecycle',async({page})=>{
  const result=await page.evaluate(async()=>{
    const {field}=await import('/js/ui/primitives.js');
    const {showFieldError,clearFieldError}=await import('/js/uiFeedback.js');
    const host=document.createElement('div');host.innerHTML=field({id:'review-field',label:'Название',hint:'Подсказка',attrs:{'aria-describedby':'external','aria-invalid':'false'}})+'<p id="external">Внешнее описание</p>';
    document.body.append(host);const input=host.querySelector('input');input.setAttribute('aria-invalid','false');
    const snapshot=()=>({description:input.getAttribute('aria-describedby'),invalid:input.getAttribute('aria-invalid'),errors:host.querySelectorAll('.field-error-message').length});
    const before=snapshot();clearFieldError(input);const untouched=snapshot();
    showFieldError(input,'Первая ошибка');showFieldError(input,'Повторная ошибка');
    const during=snapshot();const error=host.querySelector('.field-error-message');
    const associated=during.description.split(' ').includes(error.id);
    input.setAttribute('aria-describedby',input.getAttribute('aria-describedby')+' later');
    const otherImport=await import('/js/uiFeedback.js?v=4');
    otherImport.clearFieldError(input);const after=snapshot();clearFieldError(input);
    const stable=snapshot();host.remove();return {before,untouched,during,associated,after,stable};
  });
  expect(result.untouched).toEqual(result.before);
  expect(result.during.errors).toBe(1);expect(result.during.invalid).toBe('true');expect(result.associated).toBe(true);
  expect(result.after).toEqual({description:'external review-field-hint later',invalid:'false',errors:0});
  expect(result.stable).toEqual(result.after);
});

test('disabled and stale initial tabs remain reachable and activate by keyboard',async({page})=>{
  await page.evaluate(async()=>{
    const {tabs}=await import('/js/ui/primitives.js');const {mountTabs}=await import('/js/ui/controls.js');
    const host=document.createElement('section');host.id='review-tabs';host.innerHTML=tabs({id:'review',label:'Проверка вкладок',selected:'gone',items:[{id:'off',label:'Недоступная',disabled:true},{id:'first',label:'Первая'},{id:'next',label:'Следующая'}]});document.body.append(host);mountTabs(host);
  });
  const root=page.locator('#review-tabs');const first=root.getByRole('tab',{name:'Первая'});
  await expect(first).toHaveAttribute('tabindex','0');await expect(first).toHaveAttribute('aria-selected','true');
  await first.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  await expect(root.getByRole('tab',{name:'Следующая'})).toHaveAttribute('aria-selected','true');
  await page.keyboard.press('ArrowRight');await expect(first).toBeFocused();
});

test('action toast persists and closing it restores focus',async({page})=>{
  await page.clock.install();
  const origin=page.locator('#demo-toast');await origin.focus();
  await page.evaluate(async()=>{const {showToast}=await import('/js/uiFeedback.js');showToast('Доступно действие','info',{actionLabel:'Отменить',onAction:()=>{window.reviewAction=(window.reviewAction||0)+1;}});});
  const action=page.getByRole('button',{name:'Отменить',exact:true});await action.focus();
  await page.clock.fastForward(60000);await expect(action).toBeFocused();
  await action.press('Enter');await expect(origin).toBeFocused();await page.clock.fastForward(500);
  await expect(page.locator('.toast')).toHaveCount(0);expect(await page.evaluate(()=>window.reviewAction)).toBe(1);
});

test('toast timer pauses for hover and focus, resumes after both leave, and honors zero',async({page})=>{
  await page.clock.install();
  await page.evaluate(async()=>{const {showToast}=await import('/js/uiFeedback.js');showToast('Временное уведомление','info',{duration:1000});});
  const toast=page.locator('.toast');await toast.hover();await page.clock.fastForward(5000);await expect(toast).toHaveCount(1);
  const close=toast.getByRole('button',{name:'Закрыть'});await close.focus();await page.mouse.move(0,0);await page.clock.fastForward(5000);await expect(close).toBeFocused();
  await page.locator('#demo-toast').focus();await page.clock.fastForward(1500);await expect(toast).toHaveCount(0);
  await page.evaluate(async()=>{const {showToast}=await import('/js/uiFeedback.js');showToast('Без таймера','info',{duration:0});});
  await page.clock.fastForward(60000);await expect(toast).toHaveCount(1);
  await toast.getByRole('button',{name:'Закрыть'}).click();await page.clock.fastForward(500);await expect(toast).toHaveCount(0);
});
