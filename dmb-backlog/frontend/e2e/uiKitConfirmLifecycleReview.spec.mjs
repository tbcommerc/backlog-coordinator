import {test,expect} from '@playwright/test';
test('simple task confirmations settle replacement and release keyboard listeners on every exit',async({page})=>{
 await page.goto('/ui-catalog/core.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.evaluate(async()=>{const m=await import('/js/components/modal.js');window.confirmTask=m.showConfirmModal;window.keyListeners=new Set();const add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);document.addEventListener=(type,fn,...args)=>{if(type==='keydown')window.keyListeners.add(fn);return add(type,fn,...args);};document.removeEventListener=(type,fn,...args)=>{if(type==='keydown')window.keyListeners.delete(fn);return remove(type,fn,...args);};window.firstConfirm=window.confirmTask('Первое');});
 await page.locator('#confirm-ok').click();expect(await page.evaluate(()=>window.firstConfirm)).toBe(true);expect(await page.evaluate(()=>window.keyListeners.size)).toBe(0);
 await page.evaluate(()=>{window.firstConfirm=window.confirmTask('Заменяемое');window.secondConfirm=window.confirmTask('Последнее');});expect(await page.evaluate(()=>window.firstConfirm)).toBe(false);await expect(page.locator('#confirm-modal-overlay')).toHaveCount(1);
 await page.locator('#confirm-cancel').click();expect(await page.evaluate(()=>window.secondConfirm)).toBe(false);expect(await page.evaluate(()=>window.keyListeners.size)).toBe(0);
});
test('express confirmation cannot be dismissed while an operation is pending',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitExpress.html');await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 await page.evaluate(async()=>{(await import('/js/modalAccessibility.js')).initModalAccessibility();window.app.api.delete=()=>new Promise((resolve,reject)=>window.failDelete=()=>reject(Error('Synthetic failure')));});
 await page.locator('.qe-del-epic-btn').first().click();await page.locator('#qe-confirm-action').click();await expect(page.locator('#qe-modal')).toHaveAttribute('aria-busy','true');await expect(page.locator('#qe-confirm-cancel')).toBeDisabled();await page.keyboard.press('Escape');await expect(page.locator('#qe-modal')).toBeVisible();
 await page.evaluate(()=>window.failDelete());await expect(page.locator('#qe-confirm-action')).toBeEnabled();await expect(page.locator('#qe-confirm-cancel')).toBeEnabled();await page.locator('#qe-confirm-cancel').click();await expect(page.locator('#qe-modal')).toHaveCount(0);
});

test('shared confirmations isolate lower layers and restore original inert after out-of-order completion',async({page})=>{
 await page.goto('/ui-catalog/core.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.evaluate(async()=>{const {confirmAction}=await import('/js/uiFeedback.js');window.confirmShared=confirmAction;document.querySelector('main').inert=false;window.firstShared=confirmAction({title:'Первое',message:'Проверка'});window.secondShared=confirmAction({title:'Второе',message:'Проверка'});});
 await expect(page.getByRole('alertdialog',{name:'Второе',exact:true})).toBeVisible();expect(await page.locator('main').evaluate(e=>e.inert)).toBe(true);
 await page.evaluate(()=>document.querySelectorAll('[data-feedback-confirm]')[0].click());expect(await page.evaluate(()=>window.firstShared)).toBe(true);expect(await page.locator('main').evaluate(e=>e.inert)).toBe(true);
 await page.getByRole('alertdialog',{name:'Второе',exact:true}).getByRole('button',{name:'Отмена',exact:true}).click();expect(await page.evaluate(()=>window.secondShared)).toBe(false);expect(await page.locator('main').evaluate(e=>e.inert)).toBe(false);
});

test('Escape cancels only the top confirmation and keeps its native parent open',async({page})=>{
 await page.goto('/ui-catalog/core.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.evaluate(async()=>{const {initModalAccessibility,enhanceDialogOverlay}=await import('/js/modalAccessibility.js');initModalAccessibility();const d=document.createElement('dialog');d.id='escape-native-parent';d.innerHTML='<h2>Родительский диалог</h2><button data-close>Закрыть родителя</button>';d.querySelector('button').onclick=()=>d.close();document.body.append(d);enhanceDialogOverlay(d);d.showModal();window.nestedEscapeResult=(await import('/js/uiFeedback.js')).confirmAction({title:'Вложенное подтверждение'});});
 await expect(page.getByRole('alertdialog',{name:'Вложенное подтверждение',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).toHaveCount(0);await expect(page.locator('#escape-native-parent')).toBeVisible();expect(await page.evaluate(()=>window.nestedEscapeResult)).toBe(false);
});
