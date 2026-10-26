import {test,expect} from '@playwright/test';

for(const theme of ['light','dark'])for(const width of [390,1280])test(`quick edit exit shares dialog lifecycle ${theme}/${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto(`/e2e/fixtures/uiKitComposites.html?theme=${theme}`);
 await page.evaluate(async()=>{
  const css=document.createElement('link');css.rel='stylesheet';css.href='/css/modal-system.css';document.head.append(css);
  const {initModalAccessibility}=await import('/js/modalAccessibility.js');initModalAccessibility();
  const q=await import('/js/components/quickEdit.js');window.__quickEdit=q;
  const root=document.getElementById('page-content');root.innerHTML=q.renderQuickEditToolbar('test')+'<button class="btn" id="exit-edit">Выйти из режима</button>';
  q.initQuickEdit('test',{app:window.app,getTasks:()=>[{id:1,version:1,title:'Задача'}]});q.enterQuickEdit('test');
  q.getQuickEditChanges('test')[1]={title:{oldValue:'Задача',newValue:'Черновик'}};
  document.getElementById('exit-edit').onclick=()=>{window.__exitResult=q.requestExitQuickEdit('test');};
 });
 const trigger=page.locator('#exit-edit');await trigger.focus();await trigger.press('Enter');const dialog=page.getByRole('alertdialog');await expect(dialog).toBeVisible();
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
 expect(await page.evaluate(()=>window.__exitResult)).toBe(false);
 expect(await page.evaluate(()=>window.__quickEdit.getQuickEditChanges('test')[1].title.newValue)).toBe('Черновик');
 await trigger.focus();await trigger.press('Enter');await expect(dialog).toBeVisible();
 const box=await dialog.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
 await dialog.getByRole('button',{name:'Выйти без сохранения',exact:true}).click();
 await expect(dialog).toHaveCount(0);expect(await page.evaluate(()=>window.__exitResult)).toBe(true);
 expect(await page.evaluate(()=>window.__quickEdit.getQuickEditChanges('test'))).toEqual({});
});
