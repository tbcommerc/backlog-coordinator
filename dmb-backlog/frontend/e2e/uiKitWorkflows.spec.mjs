import {test,expect} from '@playwright/test';

async function mount(page,width=1280,theme='light'){
 await page.setViewportSize({width,height:900});await page.goto('/ui-catalog/core.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.evaluate(async theme=>{await import('/e2e/fixtures/spaStyles.js');window.ui=await import('/js/ui/index.js');document.documentElement.dataset.theme=theme;document.body.innerHTML='<main style="padding:16px;min-width:0"><form id="flow"></form><div id="split-slot"></div></main>';
 document.querySelector('form').innerHTML=ui.stepForm({id:'steps',navigation:true,steps:[{id:'one',label:'Описание',content:ui.field({id:'title',label:'Название',required:true,attrs:{name:'title'}})+ui.button({label:'Далее',attrs:{'data-step-next':true}})},{id:'two',label:'Проверка',content:ui.field({id:'note',label:'Комментарий',attrs:{name:'note'}})+ui.button({label:'Назад',attrs:{'data-step-back':true}})+ui.button({label:'Сохранить',attrs:{type:'submit'}})}]});
 window.stepRoot=document.querySelector('#steps');window.steps=ui.bindStepForm(stepRoot);document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.saved=Object.fromEntries(new FormData(e.target));});
 document.querySelector('#split-slot').innerHTML=ui.splitPane({id:'split',primary:'<p>Список</p>',secondary:'<input aria-label="Черновик" value="Сохранить текст">'});
 window.split=ui.bindSplitPane(document.querySelector('#split'),{size:300,min:200,max:500,minPrimary:200,breakpoint:600});
 },theme);
}

for(const theme of ['light','dark'])for(const width of [1440,390,320])test(`workflow layout ${theme}/${width}`,async({page},info)=>{
 await mount(page,width,theme);
 await page.getByRole('button',{name:'Далее',exact:true}).click();await expect(page.getByRole('textbox',{name:'Название',exact:true})).toBeFocused();
 await page.getByRole('textbox',{name:'Название',exact:true}).fill('Черновик');await page.getByRole('button',{name:'Далее',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Проверка',exact:true})).toBeFocused();
 await page.getByLabel('Комментарий',{exact:true}).fill('Проверено');await page.getByRole('button',{name:'Назад',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Название',exact:true})).toHaveValue('Черновик');await page.getByRole('button',{name:'Далее',exact:true}).click();await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 expect(await page.evaluate(()=>window.saved)).toEqual({title:'Черновик',note:'Проверено'});
 await page.evaluate(()=>document.querySelector('#flow').reset());
 await expect(page.locator('[aria-current=step]')).toHaveAttribute('data-step-id','one');
 await expect(page.getByRole('textbox',{name:'Название',exact:true})).toHaveValue('');
 await expect(page.getByLabel('Черновик',{exact:true})).toHaveValue('Сохранить текст');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 await page.locator('main').screenshot({path:info.outputPath('workflows.png')});
 if(width<600)await expect(page.getByRole('separator')).toBeHidden();
});

test('step guard pending veto error external state and disposal',async({page})=>{
 await mount(page);await page.getByRole('textbox',{name:'Название',exact:true}).fill('Draft');
 await page.evaluate(()=>{window.steps.destroy();window.changes=0;window.errors=[];window.steps=ui.bindStepForm(stepRoot,{beforeChange:()=>new Promise(resolve=>window.guard=resolve),onChange:()=>window.changes++,onError:e=>window.errors.push(e.message)});});
 await page.getByRole('button',{name:'Далее',exact:true}).click();await expect(page.locator('#steps')).toHaveAttribute('aria-busy','true');
 await page.getByRole('button',{name:'Далее',exact:true}).click();await page.evaluate(()=>window.guard(false));
 await expect(page.locator('[aria-current=step]')).toHaveAttribute('data-step-id','one');
 await page.getByRole('button',{name:'Далее',exact:true}).click();
 await page.evaluate(()=>{window.steps.setStep('one');window.guard(true);});
 expect(await page.evaluate(()=>window.changes)).toBe(0);
 await page.evaluate(()=>{window.oldSteps=window.steps;window.steps=ui.bindStepForm(stepRoot,{beforeChange:()=>{throw Error('Guard failed');},onError:e=>window.errors.push(e.message)});window.oldSteps.destroy();});
 await page.getByRole('button',{name:'Далее',exact:true}).click();expect(await page.evaluate(()=>window.errors)).toEqual(['Guard failed']);
 await page.evaluate(()=>window.steps.destroy());expect(await page.locator('#flow').evaluate(el=>el.noValidate)).toBe(false);
 await page.getByRole('button',{name:'Далее',exact:true}).click();await expect(page.locator('[aria-current=step]')).toHaveAttribute('data-step-id','one');
});

test('final submit reveals invalid earlier step and forward jump checks intermediate steps',async({page})=>{
 await mount(page);
 await page.evaluate(()=>window.steps.setStep('two'));
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(page.getByRole('textbox',{name:'Название',exact:true})).toBeFocused();
 expect(await page.evaluate(()=>window.saved)).toBeUndefined();
 await page.evaluate(()=>{window.steps.destroy();stepRoot.outerHTML=ui.stepForm({id:'three',navigation:true,steps:[{id:'a',label:'A',content:'Done'},{id:'b',label:'B',content:ui.field({id:'middle',label:'Средний шаг',required:true})},{id:'c',label:'C',content:'Finish'}]});window.steps=ui.bindStepForm(document.querySelector('#three'));});
 await page.getByRole('button',{name:'C',exact:true}).click();await expect(page.getByRole('textbox',{name:'Средний шаг',exact:true})).toBeFocused();
});

test('split keyboard pointer bounds responsive draft and dispose',async({page})=>{
 await mount(page);
 const handle=page.getByRole('separator');await handle.focus();await page.keyboard.press('ArrowLeft');await expect(handle).toHaveAttribute('aria-valuenow','310');
 await page.keyboard.press('Shift+ArrowLeft');await expect(handle).toHaveAttribute('aria-valuenow','360');await page.keyboard.press('End');await expect(handle).toHaveAttribute('aria-valuenow','500');
 await page.keyboard.press('Home');await expect(handle).toHaveAttribute('aria-valuenow','200');
 const box=await handle.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+10);await page.mouse.down();await page.mouse.move(box.x-100,box.y+10);await page.mouse.up();
 expect(Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(290);
 await page.setViewportSize({width:390,height:900});await expect(handle).toBeHidden();await expect(page.getByLabel('Черновик',{exact:true})).toHaveValue('Сохранить текст');
 await page.setViewportSize({width:1280,height:900});await expect(handle).toBeVisible();
 await page.evaluate(()=>window.split.setActive(false));await expect(handle).toBeHidden();await page.evaluate(()=>window.split.setActive(true));await expect(handle).toBeVisible();
 await page.evaluate(()=>{window.split.destroy();window.split2=ui.bindSplitPane(document.querySelector('#split'),{size:250,min:200,max:500,minPrimary:200});window.split.destroy();});
 await handle.focus();await page.keyboard.press('ArrowLeft');await expect(handle).toHaveAttribute('aria-valuenow','260');
 await page.evaluate(()=>window.split2.destroy());await expect(handle).not.toHaveAttribute('aria-valuenow');
});

test('catalogue step form validates and completes locally',async({page})=>{
 await page.goto('/ui-catalog/index.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 const form=page.locator('#demo-step-form');await form.getByRole('button',{name:'Далее',exact:true}).click();await expect(page.locator('#demo-step-name')).toBeFocused();
 await page.locator('#demo-step-name').fill('Test');await form.getByRole('button',{name:'Далее',exact:true}).click();await form.getByRole('button',{name:'Завершить пример'}).click();await expect(page.locator('#demo-step-result')).toContainText('Пример завершён');
});
