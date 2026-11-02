import {test,expect} from '@playwright/test';

async function mount(page,spa=false) {
  await page.goto('/ui-catalog/core.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(async spa=>{
    if(spa)await import('/e2e/fixtures/spaStyles.js');
    const ui=await import('/js/ui/index.js');window.deepUi=ui;
    document.body.innerHTML=`<main style="padding:16px;max-width:100%;box-sizing:border-box">${ui.filterChip({label:'Все задачи',count:999999,selected:true,attrs:{id:'filter'}})}${ui.filterChip({label:'Недоступно',attrs:{id:'disabled',disabled:true}})}${ui.kpiCard({label:'Число',value:1000,attrs:{id:'numeric'}})}${ui.kpiCard({label:'Форматированное',value:'1 000',attrs:{id:'formatted'}})}${ui.kpiCard({label:'Текст',value:'Нет данных',variant:'text',interactive:false,attrs:{id:'text'}})}${ui.collapseSection({label:'Раздел',content:'Содержимое'})}${ui.field({id:'external',label:'Внешняя ошибка',attrs:{'aria-invalid':'true'}})}${ui.field({id:'field',label:'Поле',hint:'Подсказка',error:'Первичная ошибка'})}${ui.selectionList({items:[{value:1,label:'Запрещено',disabled:true}]})}<div id="hidden">${ui.filterChip({label:'Скрытый фильтр',attrs:{hidden:true}})}${ui.kpiCard({label:'Скрытая метрика',attrs:{hidden:true}})}</div>${ui.progress({value:null})}${ui.progress({value:0})}${ui.progress({state:'indeterminate'})}${ui.progress({value:100})}${ui.progress({value:30,state:'error'})}</main>`;
  },spa);
}

for(const spa of [false,true])test(`U03–08 U11 U14 hidden, disabled, state and overflow; SPA=${spa}`,async({browser})=>{
 const context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true});const page=await context.newPage();
 try {
 await mount(page,spa);
 for(const selector of ['#filter','summary'])expect(await page.locator(selector).evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
 await expect(page.locator('#disabled')).toHaveCSS('cursor','not-allowed');
 await expect(page.locator('.ui-selection-option')).toHaveCSS('opacity','0.5');
 for(const element of await page.locator('#hidden > *').all())await expect(element).toBeHidden();
 await expect(page.locator('#filter')).toHaveCSS('font-family',/Inter/);
 expect(await page.locator('#numeric strong').evaluate(e=>getComputedStyle(e).fontSize)).toBe(await page.locator('#formatted strong').evaluate(e=>getComputedStyle(e).fontSize));
 await expect(page.locator('#text')).not.toHaveAttribute('type');
 await page.locator('#filter').evaluate(e=>e.setAttribute('aria-pressed','false'));
 const neutral=await page.locator('#filter .quick-filter-count').evaluate(e=>getComputedStyle(e).backgroundColor);
 await page.locator('#filter').evaluate(e=>e.classList.remove('active'));
 expect(await page.locator('#filter .quick-filter-count').evaluate(e=>getComputedStyle(e).backgroundColor)).toBe(neutral);
 await page.locator('#filter').evaluate(e=>e.dataset.uiTone='success');
 expect(await page.locator('#filter .quick-filter-count').evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe(neutral);
 await page.setViewportSize({width:320,height:900});
 for(const label of ['ОченьДлинноеНазвание'.repeat(20),'Очень длинное название '.repeat(20)]){
  await page.locator('#filter .quick-filter-label').evaluate((e,s)=>e.textContent=s,label);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator('#filter .quick-filter-label')).toHaveCSS('white-space','nowrap');
  await expect(page.locator('#filter .quick-filter-label')).toHaveCSS('text-overflow','ellipsis');
 }
 }finally{await context.close();}
});

for (const spa of [false, true]) test(`FilterChip counter stays at the right padding; SPA=${spa}`, async ({page}) => {
 await mount(page, spa);
 for (const width of [1440, 390, 320]) {
  await page.setViewportSize({width, height:900});
  for (const selected of [false, true]) for (const disabled of [false, true]) {
   const measurements = await page.evaluate(({selected, disabled}) => {
    const filter = document.querySelector('#filter');
    filter.style.width = '260px';
    filter.disabled = disabled;
    filter.setAttribute('aria-pressed', String(selected));
    return ['Просрочено', 'Очень длинное название фильтра '.repeat(8)].map(label => {
     filter.querySelector('.quick-filter-label').textContent = label;
     const counter = filter.querySelector('.quick-filter-count');
     const style = getComputedStyle(filter);
     return {
      rightGap: filter.getBoundingClientRect().right - counter.getBoundingClientRect().right,
      expectedGap: parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth),
      counterWidth: counter.getBoundingClientRect().width,
      overflow: counter.scrollWidth > counter.clientWidth,
     };
    });
   }, {selected, disabled});
   for (const actual of measurements) {
    expect(actual.rightGap).toBeCloseTo(actual.expectedGap, 0);
    expect(actual.counterWidth).toBeGreaterThan(0);
    expect(actual.overflow).toBe(false);
   }
  }
 }
});

test('U02 selected counter contrast in every theme and accent',async({page})=>{
 await mount(page,true);
 const results=await page.evaluate(()=>{
  const luminance=s=>{const [r,g,b]=s.match(/[\d.]+/g).slice(0,3).map(Number).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;};
  const rows=[];
  for(const theme of ['light','dark'])for(const accent of ['indigo','emerald','amber','rose','sky','violet','cyan','orange','teal','purple']){
   document.documentElement.dataset.theme=theme;document.documentElement.dataset.accent=accent;
   const css=getComputedStyle(document.querySelector('#filter .quick-filter-count')),a=luminance(css.color),b=luminance(css.backgroundColor);
   rows.push({theme,accent,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)});
  }return rows;
 });
 for(const row of results)expect(row.ratio,JSON.stringify(row)).toBeGreaterThanOrEqual(4.5);
});

test('U15 U16 U21 validation and tooltip retain only their own descriptions',async({page})=>{
 await mount(page);
 await expect(page.locator('#external')).toHaveAttribute('aria-invalid','true');
 await page.evaluate(()=>{
  const field=document.querySelector('#external');
  window.deepUi.clearFieldError(field);
  window.deepUi.showFieldError(field,'Временная ошибка сервера');
  window.deepUi.clearFieldError(field);
 });
 await expect(page.locator('#external')).toHaveAttribute('aria-invalid','true');
 await page.evaluate(()=>{
  const field=document.querySelector('#field');window.deepUi.showFieldError(field,'Ошибка сервера');
  const panel=document.createElement('div');panel.textContent='Подсказка';document.body.append(panel);
  const tooltip=window.deepUi.bindTooltip({trigger:field,panel});
  field.setAttribute('aria-describedby',field.getAttribute('aria-describedby')+' later');tooltip.destroy();
 });
 await expect(page.locator('#field')).toHaveAttribute('aria-describedby',/later/);
 await expect(page.locator('.field-error-message:visible')).toHaveCount(1);
 await expect(page.locator('#field-error')).toHaveText('Ошибка сервера');
 await page.evaluate(()=>window.deepUi.clearFieldError(document.querySelector('#field')));
 await expect(page.locator('#field')).not.toHaveAttribute('aria-invalid','true');
 await expect(page.locator('#field-error')).toBeHidden();
 await expect(page.locator('#field')).toHaveAttribute('aria-describedby',/field-hint.*later/);
});

test('U17 aria-disabled menu items cannot execute or close the menu',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{
  document.body.insertAdjacentHTML('beforeend','<button id="trigger">Меню</button><div id="menu"><a href="#unexpected" aria-disabled="true">Запрещено</a><button>Доступно</button></div>');
  window.deepUi.bindActionMenu({trigger:document.querySelector('#trigger'),panel:document.querySelector('#menu')});
  window.menuActions=0;document.querySelector('#menu a').addEventListener('click',()=>window.menuActions++);
 });
 await page.locator('#trigger').click();
 await page.locator('#menu a').dispatchEvent('click');
 expect(await page.evaluate(()=>window.menuActions)).toBe(0);
 await expect(page.locator('#menu')).toBeVisible();
 await page.getByRole('menuitem',{name:'Доступно'}).click();await expect(page.locator('#menu')).toBeHidden();
});

test('U20 U22 U24 progress, file and count states are explicit and accessible',async({page})=>{
 await mount(page);
 for(const state of ['unknown','determinate','indeterminate','complete','error'])await expect(page.locator(`.ui-progress[data-ui-state=${state}]`)).toHaveCount(1);
 await expect(page.locator('[data-ui-state=unknown]')).toContainText('Нет данных');
 await expect(page.locator('[data-ui-state=determinate] [role=progressbar]')).toHaveAttribute('aria-valuenow','0');
 await expect(page.locator('[data-ui-state=indeterminate] [role=progressbar]')).not.toHaveAttribute('aria-valuenow');
 await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend',window.deepUi.fileUpload({id:'upload',hint:'TXT'})+window.deepUi.counter({value:1000,cap:99,id:'counter'})+window.deepUi.rangeControl({id:'range',label:'Доля',value:50,step:5})));
 await expect(page.locator('#counter')).toHaveText('99+');await expect(page.locator('#counter')).toHaveAttribute('aria-label','Количество: 1000');
 await page.getByLabel('Доля').focus();await page.keyboard.press('ArrowRight');await expect(page.locator('#range')).toHaveValue('55');
 for(const state of ['dragover','selected','uploading','cancelled','error','disabled','idle']){
  await page.evaluate(state=>window.deepUi.setUploadState(document.querySelector('.ui-upload'),state,state),state);
  await expect(page.locator('.ui-upload')).toHaveAttribute('data-ui-state',state);
  expect(await page.locator('#upload').isDisabled()).toBe(['uploading','disabled'].includes(state));
 }
});

test('U29 fixture CSS is identical to the SPA, in order',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitConsistency.html?surface=workTasks');
 await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 const actual=await page.locator('link[rel=stylesheet]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
 const expected=await page.evaluate(async()=>[...new DOMParser().parseFromString(await(await fetch('/static/index.html')).text(),'text/html').querySelectorAll('link[rel=stylesheet]')].map(n=>n.getAttribute('href')));
 expect(actual).toEqual(expected);
});

test('U09 U12 U13 U19 real work consumers use shared status, avatar and controls',async({browser})=>{
 const context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true});const page=await context.newPage();
 try{
 await mount(page,true);
 await page.evaluate(async()=>{
  const {renderWorkQueue}=await import('/js/components/workQueue.js');const {checklistView}=await import('/js/components/workProductivity.js');
  const {workStatus}=await import('/js/components/workUi.js');
  const items=['new','ready','in_progress','in_acceptance','done','cancelled'].map((status,id)=>({id:id+1,public_id:'WRK-'+(id+1),title:status,status,assignee_name:'Иван Иванов'}));
  document.body.innerHTML='<main class="work-task-workplace">'+renderWorkQueue({items,total:6,summary:{}})+checklistView({can_check:true,checklist:[{id:1,title:'Проверить',completed:false}]})+'<section id="reference">'+items.map(i=>workStatus(i.status)).join('')+window.deepUi.avatar({name:'Иван Иванов',size:24})+'</section></main>';
 });
 for(const status of ['new','ready','in_progress','in_acceptance','done','cancelled']){
  const style=selector=>page.locator(selector).evaluate(e=>[getComputedStyle(e).color,getComputedStyle(e).backgroundColor,e.textContent]);
  expect(await style(`.work-queue [data-status=${status}]`)).toEqual(await style(`#reference [data-status=${status}]`));
 }
 const avatarStyle=selector=>page.locator(selector).first().evaluate(e=>[e.textContent,getComputedStyle(e).fontSize,getComputedStyle(e).fontWeight,getComputedStyle(e).backgroundColor]);
 expect(await avatarStyle('.work-queue .ui-avatar')).toEqual(await avatarStyle('#reference .ui-avatar'));
 expect(await page.locator('.ui-checkbox').evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
 await expect(page.locator('.ui-checkbox input')).toHaveCSS('width','18px');
 for(const menu of await page.locator('[data-queue-menu]').all()){
  const box=await menu.boundingBox();expect(box.width).toBe(box.height);expect(box.height).toBeGreaterThanOrEqual(44);
 }
 }finally{await context.close();}
});

test('U18 express editors have contextual accessible names',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitExpress.html');await expect(page.locator('.qe-inline-field-input').first()).toBeVisible();
 for(const input of await page.locator('.qe-inline-field-input,.qe-inline-title').all())await expect(input).toHaveAccessibleName(/Название (эпика|истории)/);
});

test('U21 U23 U25 U26 composition owns focus and preserves useful content',async({page})=>{
 await mount(page);
 await page.evaluate(()=>{
  const u=window.deepUi;
  document.body.innerHTML='<form>'+u.field({id:'one',label:'Первое'})+u.field({id:'two',label:'Второе'})+'</form><section id="result"><p>Сохранённый результат</p>'+u.renderViewState({kind:'stale',scope:'partial',actionLabel:'Повторить'})+'</section>'+u.pagination({page:2,pages:3,disabled:true})+u.cursorPagination({hasNext:true})+u.loadMore({loading:true})+u.segmentedControl({label:'Вид',items:[{value:'a',label:'Список'},{value:'b',label:'Доска',disabled:true}],value:'a'});
  u.showFormErrors(document.querySelector('form'),{one:'Ошибка первого',two:'Ошибка второго'});
 });
 await expect(page.locator('#one')).toBeFocused();await expect(page.locator('[data-ui-error-summary] a')).toHaveCount(2);
 await page.getByRole('link',{name:'Ошибка второго'}).click();await expect(page.locator('#two')).toBeFocused();
 await expect(page.locator('#result')).toContainText('Сохранённый результат');await expect(page.locator('.view-state')).toHaveAttribute('data-ui-scope','partial');
 for(const b of await page.locator('[data-page]').all())await expect(b).toBeDisabled();
 await expect(page.locator('[data-cursor-direction=next]')).toBeEnabled();
 await expect(page.getByRole('button',{name:'Загружаем…'})).toBeDisabled();
 await expect(page.getByRole('group',{name:'Вид'})).toBeVisible();await expect(page.getByRole('button',{name:'Доска',exact:true})).toBeDisabled();
 await page.evaluate(()=>window.deepUi.clearFormErrors(document.querySelector('form')));
 await expect(page.locator('[data-ui-error-summary]')).toHaveCount(0);
});
