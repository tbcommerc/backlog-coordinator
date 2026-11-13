import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';

async function setup(page,{width=1440,theme='light',card=false,view='quarter',edit=true}={}){
 await page.setViewportSize({width,height:1000});await page.goto('/ui-catalog/core.html');
 await expect(page.locator('html')).toHaveAttribute('data-ready','true');await page.addScriptTag({url:'/static/js/lib/lucide.min.js?v=20'});
 await page.evaluate(async({theme,card,view,edit})=>{
  await import('/e2e/fixtures/spaStyles.js');(await import('/js/modalAccessibility.js')).initModalAccessibility();document.documentElement.dataset.theme=theme;
  const mod=await import('/js/components/metricsQuarterly.js');
  const options={user_id:1,team_id:1,can_create:edit,business_date:'2026-11-03',teams:[{id:1,name:'Команда'}],users:[{id:1,name:'Владелец'}],projects:[],meetings:[]};
  const p={id:7,year:2026,quarter:4,state:'active',availability:'active',start_date:'2026-10-01',end_date:'2026-12-31',plan:{target:'100',result_type:'volume',direction:'up',source_snapshot:'Отчёт',cadence:'none'},fact:null,result:{outcome:'no_data',progress:null,is_final:false},observations:{count:0,violation_count:null},schedule:{next_due:null},capabilities:{write_fact:edit,add_measurement:edit,close:false,correct_final:false}};
  const metric={id:1,version:1,public_id:'MET-001',title:'Квартальный объём обслуживания с длинным названием',unit:'шт',team_id:1,owner_id:1,team:'Команда',owner:'Владелец',model_version:'quarterly_v2',lifecycle_state:'tracking',source:'Отчёт',method:'Сумма',preferred_result_type:'volume',default_direction:'up',annual_aggregation:'sum',display_precision:2,year:2026,year_settings:{expected_quarters:[4],aggregation:'sum',scale:100},permissions:{edit,comment:edit},periods:[p],quarters:[1,2,3].map(quarter=>({quarter,availability:'outside_scope'})).concat(p),legacy_periods:[],annual:{completeness:'empty',scope_adjusted:true,coverage:{expected:[4],missing:[4],cancelled:[]},confirmed_value:null,preliminary_value:null,final_value:null}};
  const list={items:[{...metric,period:p}],summary:{missing_fact:1,awaiting_close:0,not_achieved:0,overdue:0},total:1,page:1,pages:1};
 const fixture={metric,options,list,requests:[],reads:[],responses:{},failure:null};window.quarterFixture=fixture;
  const app={router:{},api:{get:async()=>({items:[{id:8,public_id:'WRK-8',title:'Связанная рабочая задача'}]}),request:async(method,path,body,opts)=>{
   if(method!=='GET'){fixture.requests.push({method,path,body,opts});if(fixture.failure)throw Object.assign(new Error(fixture.failure.message),fixture.failure);return metric;}
   fixture.reads.push(path);if(fixture.getFailure&&path.includes(fixture.getFailure))throw Object.assign(new Error('Не удалось загрузить раздел'),{status:fixture.getFailureStatus||503});const response=Object.entries(fixture.responses).find(([key])=>path.includes(key));if(response)return response[1];
   if(path==='/metrics/1/measurements/9')return {id:9,value:'20',measured_on:'2026-11-03',source:'Old source'};if(path.endsWith('/options'))return options;if(path.startsWith('/metrics?'))return list;
   if(/\/(observation-chart|measurements|history|comments|files|links|reports)(?:\?|$)/.test(path))return {items:[],total:0};return metric;
  }}};
  fixture.show=async()=>{location.hash=fixture.route||(card?'#/metrics/1':'#/metrics')+'?view='+view+'&year=2026&quarter=4';document.body.innerHTML='<main style="padding:16px;min-width:0"></main>';document.querySelector('main').innerHTML=await mod.renderQuarterlyMetrics(app);mod.initQuarterlyMetrics(app);window.lucide?.createIcons();};
  await fixture.show();
 },{theme,card,view,edit});
}

for (const theme of ['light','dark']) for (const width of [1440,1366,390,320]) {
 test(`metrics panel matches backlog ${theme} ${width}`,async({page},info)=>{
  await setup(page,{width,theme});
  const data=await page.evaluate(()=>({options:quarterFixture.options,list:quarterFixture.list}));
  await mockApp(page);
  await page.addInitScript(t=>localStorage.setItem('dmb_theme',t),theme);
  await page.route('**/api/v2/metrics**',route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith('/options')?data.options:data.list}));
  await page.setViewportSize({width,height:width<700?844:900});
  const style=locator=>locator.evaluate(el=>{const c=getComputedStyle(el);return Object.fromEntries(['height','fontSize','borderRadius','backgroundColor','paddingLeft','paddingRight'].map(k=>[k,c[k]]));});
  await page.goto('/#/backlog');await expect(page.locator('#f-backlog-search')).toBeVisible();
  const searchStyle=await style(page.locator('#f-backlog-search'));
  const panelStyle=await style(page.locator('.filter-panel[data-filter-scope=backlog]'));
  const filterStyle=await style(page.locator('#btn-ext-backlog'));
  await page.screenshot({path:info.outputPath('backlog.png'),fullPage:true});
  await page.goto('/#/metrics?year=2026&quarter=4');
  const search=page.getByRole('searchbox',{name:'Поиск',exact:true});await expect(search).toBeVisible();
  expect(await style(search)).toEqual(searchStyle);
  const panel=await style(page.locator('#quarterly-filters .filter-panel'));
  for(const key of ['borderRadius','backgroundColor','paddingLeft','paddingRight'])expect(panel[key]).toBe(panelStyle[key]);
  const filter=page.getByRole('button',{name:'Все фильтры',exact:true});
  expect(await style(filter)).toEqual(filterStyle);
  expect(await page.locator('.ui-registry-actions > button').evaluateAll(els=>els.map(el=>el.getAttribute('aria-label')||el.textContent.trim()))).toEqual(['Новая метрика','Колонки']);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath('metrics.png'),fullPage:true});
  await search.fill('качество');await search.press('Enter');await expect(page).toHaveURL(/q=/);
  await page.getByRole('button',{name:'Сброс',exact:true}).click();await expect(search).toHaveValue('');
  await filter.click();await expect(page.locator('#qmetric-filter-extra')).toBeVisible();
  await page.screenshot({path:info.outputPath('filters.png'),fullPage:true});
  await filter.click();await expect(page.locator('#qmetric-filter-extra')).toBeHidden();
  await page.getByRole('button',{name:'Колонки',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Колонки',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('columns.png'),fullPage:true});
 });
}

for (const theme of ['light','dark']) for (const [width,height] of [[1440,900],[1366,768],[390,844],[320,800]]) {
 test(`whole metrics composition ${theme} ${width}`,async({page},info)=>{
  await setup(page,{width,theme});
  const data=await page.evaluate(()=>({options:quarterFixture.options,list:quarterFixture.list,metric:quarterFixture.metric}));
  await mockApp(page);
  await page.addInitScript(theme=>localStorage.setItem('dmb_theme',theme),theme);
  await page.route('**/api/v2/metrics**',route=>{
   const path=new URL(route.request().url()).pathname;
   const json=path.endsWith('/options')?data.options:/\/metrics\/?$/.test(path)?data.list:/\/(measurements|observation-chart|history|comments|files|links|reports)$/.test(path)?{items:[],total:0}:data.metric;
   return route.fulfill({json});
  });
  await page.setViewportSize({width,height});
  await page.goto('/#/metrics?year=2026&quarter=4&view=quarter');
  await expect(page.getByRole('heading',{name:'Метрики',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:data.metric.title,exact:true})).toBeVisible();
  const quarter=await page.getByRole('combobox',{name:'Квартал',exact:true}).boundingBox();
  const view=await page.getByRole('group',{name:'Представление',exact:true}).boundingBox();
  expect(view.x+view.width<=quarter.x || view.y+view.height<=quarter.y || quarter.x+quarter.width<=view.x || quarter.y+quarter.height<=view.y).toBe(true);
  await info.attach('whole-registry',{body:await page.screenshot(),contentType:'image/png'});
  const periodGroup=page.getByRole('group',{name:'Период',exact:true});
  await expect(periodGroup.getByRole('button',{name:'Квартал',exact:true})).toHaveAttribute('aria-pressed','true');
  await periodGroup.getByRole('button',{name:'Год',exact:true}).click();
  await expect(page.getByRole('table',{name:'Годовой реестр'})).toBeVisible();
  await expect(periodGroup.getByRole('combobox',{name:'Квартал',exact:true})).toHaveCount(0);
  await expect(periodGroup.getByRole('spinbutton',{name:'Год',exact:true})).toHaveValue('2026');
  await page.screenshot({path:info.outputPath('period-year.png'),fullPage:true});
  await periodGroup.getByRole('button',{name:'Квартал',exact:true}).click();
  await expect(periodGroup.getByRole('combobox',{name:'Квартал',exact:true})).toHaveValue('4');
  await page.screenshot({path:info.outputPath('period-quarter.png'),fullPage:true});
  await page.getByRole('button',{name:'Колонки',exact:true}).click();
  const columns=page.getByRole('dialog',{name:'Колонки',exact:true});
  const ownerRow=columns.getByRole('checkbox',{name:'Владелец',exact:true}).locator('..');
  const stateRow=columns.getByRole('checkbox',{name:'Состояние',exact:true}).locator('..');
  const ownerBox=await ownerRow.boundingBox(),stateBox=await stateRow.boundingBox();
  expect(stateBox.y).toBeGreaterThanOrEqual(ownerBox.y+ownerBox.height);
  expect(ownerBox.height).toBeGreaterThanOrEqual(width<700?44:32);
  const menuBox=await columns.boundingBox();
  expect(menuBox.x).toBeGreaterThanOrEqual(0);expect(menuBox.x+menuBox.width).toBeLessThanOrEqual(width);
  await info.attach('whole-columns-open',{body:await page.screenshot(),contentType:'image/png'});
  await columns.getByRole('checkbox',{name:'Владелец',exact:true}).press('Space');
  await expect(page).toHaveURL(/hidden_columns=owner/);
  await expect(page.getByRole('columnheader',{name:'Владелец',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Колонки',exact:true}).click();
  await expect(columns.getByRole('checkbox',{name:'Владелец',exact:true})).not.toBeChecked();
  await columns.getByRole('checkbox',{name:'Владелец',exact:true}).check();
  await expect(page).not.toHaveURL(/hidden_columns=owner/);
  await page.getByRole('button',{name:'Колонки',exact:true}).click();
  await columns.getByRole('checkbox',{name:'Владелец',exact:true}).press('Escape');
  await expect(columns).toBeHidden();
  await expect(page.getByRole('button',{name:'Колонки',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Все фильтры',exact:true}).click();
  const slot=page.locator('[name=team_id]').locator('..');
  expect(await slot.evaluate(el=>getComputedStyle(el).width)).not.toBe('0px');
  if(width<700)await page.locator('[data-reference-quick]').click();
  await expect(page.locator('.qmetric-signals')).toBeVisible();
  const filterBox=await page.locator('#qmetric-filter-extra').boundingBox();
  if(width>=1366)expect(filterBox.height).toBeLessThan(240);
  await info.attach('whole-filters-open',{body:await page.screenshot({path:info.outputPath('filters-open.png'),fullPage:true}),contentType:'image/png'});
  if(width<700){
   await page.locator('.qmetric-title-link,.ui-table-title').first().scrollIntoViewIfNeeded();
   await info.attach('whole-registry-links',{body:await page.screenshot({path:info.outputPath('registry-links.png')}),contentType:'image/png'});
  }
  await page.getByRole('combobox',{name:'Команды',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Фильтр: Команды',exact:true})).toBeVisible();
  await page.getByRole('dialog',{name:'Фильтр: Команды',exact:true}).getByRole('checkbox',{name:'Все',exact:true}).press('Escape');
  await page.getByRole('button',{name:'Все фильтры',exact:true}).click();
  await page.getByRole('link',{name:data.metric.title,exact:true}).click();
  await expect(page.locator('#quarterly-card')).toBeVisible();
  await expect(page.locator('#quarterly-card .ui-section-card:not(.ui-section-plain)')).toHaveCount(0);
  await info.attach('whole-card',{body:await page.screenshot(),contentType:'image/png'});
  const panel=await page.locator('#quarterly-card').boundingBox();
  expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(width+1);
  await page.getByRole('tab',{name:'Обсуждение',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Обсуждение',exact:true})).toBeVisible();
  await info.attach('whole-discussion',{body:await page.screenshot(),contentType:'image/png'});
  await page.getByRole('tab',{name:'История',exact:true}).click();
  await expect(page.getByRole('heading',{name:'История',exact:true})).toBeVisible();
  const historyPeriod=await page.getByRole('combobox',{name:'Область истории',exact:true}).boundingBox();
  const historyAction=await page.getByRole('combobox',{name:'Тип события',exact:true}).boundingBox();
  if(width>=1366){expect(Math.abs(historyPeriod.y-historyAction.y)).toBeLessThan(1);expect(historyPeriod.width).toBeLessThanOrEqual(240);}
  else expect(historyPeriod.y+historyPeriod.height).toBeLessThanOrEqual(historyAction.y);
  await info.attach('whole-history',{body:await page.screenshot(),contentType:'image/png'});
 });
}

test('creation sends decimal strings and atomic plans',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Новая метрика',exact:true}).click();
 const editor=page.locator('#quarterly-editor');await editor.getByLabel('Название',{exact:true}).fill('Новая метрика');await editor.getByLabel('Единица',{exact:true}).fill('шт');await editor.getByLabel('Источник',{exact:true}).fill('Отчёт');await editor.locator('[name=target_4]').fill('100,25');
 await editor.getByRole('button',{name:'Создать и начать',exact:true}).click();
 const req=await page.evaluate(()=>window.quarterFixture.requests[0]);
 expect(req.opts).toMatchObject({apiVersion:2});expect(req.opts.idempotencyKey).toBeTruthy();
 expect(req.body.plans).toEqual([{quarter:4,target:'100.25',result_type:'volume',direction:'up',reason:''}]);expect(req.body.expected_quarters).toEqual([4]);
});

test('fact error retains input and retry key',async({page})=>{
 await setup(page,{card:true});await page.getByRole('button',{name:'Внести факт',exact:true}).click();
 const editor=page.locator('#quarterly-editor');await editor.getByLabel('Значение',{exact:true}).fill('0');
 await page.evaluate(()=>window.quarterFixture.failure={status:503,message:'Временно недоступно'});
 await editor.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(editor.getByRole('alert')).toContainText('Временно недоступно');
 await expect(editor.getByLabel('Значение',{exact:true})).toHaveValue('0');await editor.getByRole('button',{name:'Сохранить',exact:true}).click();
 const requests=await page.evaluate(()=>window.quarterFixture.requests);expect(requests[0].opts.idempotencyKey).toBe(requests[1].opts.idempotencyKey);expect(requests[0].body.value).toBe('0');expect(requests[0].path).toBe('/metrics/1/periods/7/fact');
});

test('read-only card hides write actions',async({page})=>{
 await setup(page,{card:true,edit:false});await expect(page.getByRole('button',{name:'Внести факт',exact:true})).toHaveCount(0);await expect(page.locator('#quarterly-card')).toContainText('Нет факта');
});

for(const width of [320,390,768,1024,1440])for(const theme of ['light','dark'])test(`quarter and year fit ${width} ${theme}`,async({page})=>{
 await setup(page,{width,theme,view:'year'});await expect(page.getByRole('table',{name:'Годовой реестр'})).toBeVisible();await expect(page.getByText('Не ведётся',{exact:true}).first()).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
 if(width===1440||width===320)await page.screenshot({path:test.info().outputPath('year.png'),fullPage:true});
 await setup(page,{width,theme,card:true});await expect(page.locator('#quarterly-card')).toBeVisible();
 expect(await page.locator('#quarterly-card').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBeTruthy();
 await page.getByRole('button',{name:'Внести факт',exact:true}).click();await expect(page.locator('#quarterly-editor')).toBeVisible();
 expect(await page.locator('#quarterly-editor').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBeTruthy();
 if(width===1440||width===320)await page.screenshot({path:test.info().outputPath('fact-form.png'),fullPage:true});
});

test('keyboard and 200 percent layout',async({page})=>{
 await setup(page,{width:768,card:true});await page.evaluate(()=>document.documentElement.style.zoom='2');
 const action=page.getByRole('button',{name:'Внести факт',exact:true});
 const bounds=await action.boundingBox();expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(1000);
 await page.getByRole('button',{name:'Внести факт',exact:true}).click();await expect(page.locator('#quarterly-editor [name=value]')).toBeFocused();
 await page.keyboard.press('Escape');await expect(page.locator('#quarterly-editor')).toHaveCount(0);await expect(page.locator('#quarterly-card')).toBeVisible();
});

for(const failure of [{status:401,message:'Сессия истекла'},{status:409,message:'Версия изменилась'},{status:422,message:'Проверьте дату'},{name:'TimeoutError',message:'Время ожидания истекло'},{name:'AbortError',message:'Запрос отменён'}])test(`write failure retains form ${failure.status||failure.name}`,async({page})=>{
 await setup(page,{card:true});await page.getByRole('button',{name:'Внести факт',exact:true}).click();
 const editor=page.locator('#quarterly-editor');await editor.getByLabel('Значение',{exact:true}).fill('99.9999999999');
 await page.evaluate(f=>window.quarterFixture.failure=f,failure);await editor.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(editor.getByRole('alert')).not.toBeEmpty();await expect(editor.getByLabel('Значение',{exact:true})).toHaveValue('99.9999999999');await expect(editor).toBeVisible();
});

test('multiple attention filters use shared JSON encoding',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Нет факта · 1',exact:true}).click();
 await page.evaluate(async()=>{quarterFixture.route=location.hash;await quarterFixture.show();});
 await page.getByRole('button',{name:'Все фильтры',exact:true}).click();
 await page.locator('.qmetric-signals').getByRole('button',{name:'Ожидают итога · 0',exact:true}).click();
 expect(await page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('attention'))).toBe('["missing_fact","awaiting_close"]');
});

test('expanded filters apply one draft and reset preserves period and view',async({page})=>{
 await setup(page,{view:'year'});
 await page.locator('.qmetric-signals').getByRole('button',{name:'Нет факта · 1',exact:true}).click();
 await page.evaluate(async()=>{quarterFixture.route=location.hash;await quarterFixture.show();});
 await page.getByRole('button',{name:'Все фильтры',exact:true}).click();
 await page.locator('[name=scope]').selectOption('mine');
 await page.locator('[name=sort]').selectOption('updated');
 await page.getByRole('checkbox',{name:'Включая архив'}).check();
 await expect(page).not.toHaveURL(/scope=mine/);
 await page.getByRole('button',{name:'Применить фильтры',exact:true}).click();
 await expect(page).toHaveURL(/scope=mine/);
 await expect(page).toHaveURL(/archived=true/);
 await expect(page).toHaveURL(/sort=updated/);
 await page.evaluate(async()=>{quarterFixture.route=location.hash;await quarterFixture.show();});
 await expect(page.getByRole('button',{name:'Снять фильтр: Мои метрики',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Все фильтры · 2',exact:true}).click();
 await page.getByRole('button',{name:'Сбросить',exact:true}).click();
 await expect(page).toHaveURL(/year=2026/);await expect(page).toHaveURL(/view=year/);
 await expect(page).not.toHaveURL(/scope=|archived=|attention=|sort=/);
});

test('quarterly duplicate measurement correction keeps typed value',async({page})=>{
 await setup(page,{card:true});await page.getByRole('button',{name:'Добавить замер',exact:true}).click();
 const editor=page.locator('#quarterly-editor');await editor.getByLabel('Значение',{exact:true}).fill('30');
 await page.evaluate(()=>window.quarterFixture.failure={status:409,code:'duplicate_measurement_date',message:'Замер уже существует',data:{measurement_id:9}});
 await editor.getByRole('button',{name:'Сохранить',exact:true}).click();await editor.getByRole('button',{name:'Открыть исправление',exact:true}).click();
 await expect(editor.getByLabel('Значение',{exact:true})).toHaveValue('30');await expect(editor.getByLabel('Причина исправления',{exact:true})).toHaveAttribute('required','');
 await editor.getByLabel('Причина исправления',{exact:true}).fill('Сверка источника');await page.evaluate(()=>window.quarterFixture.failure=null);
 await editor.getByRole('button',{name:'Сохранить',exact:true}).click();const req=await page.evaluate(()=>window.quarterFixture.requests.at(-1));
 expect(req.method).toBe('PATCH');expect(req.path).toBe('/metrics/1/measurements/9');expect(req.body.value).toBe('30');
});

test('large decimal remains readable on narrow card',async({page})=>{
 await setup(page,{width:320,card:true,theme:'dark'});await page.evaluate(async()=>{const f=window.quarterFixture;f.metric.periods[0].fact={value:'999999999999999.9999999999',as_of_date:'2026-11-03',status:'preliminary'};f.metric.display_precision=10;await f.show();});
 await expect(page.locator('#quarterly-card')).toContainText('999');expect(await page.locator('#quarterly-card').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBeTruthy();
 await page.screenshot({path:test.info().outputPath('large-decimal.png'),fullPage:true});
});

test('M03 M04 M06: range direction legacy and annual meaning',async({page})=>{
 await setup(page);await page.evaluate(async()=>{const f=window.quarterFixture;f.metric.periods[0].plan={target:'90',upper:'110',result_type:'range',direction:'range'};await f.show();});
 await expect(page.getByRole('table')).toContainText('90 – 110');
 await page.evaluate(async()=>{const f=window.quarterFixture;f.list.items[0].model_version='legacy_v1';await f.show();});
 await expect(page.getByRole('table')).toContainText('Данные прежней модели');await expect(page.getByRole('table')).not.toContainText('Нет факта');
 await setup(page,{view:'year'});await page.evaluate(async()=>{const f=window.quarterFixture;f.list.items[0].annual={final_value:'400',coverage:{closed:[1,2,3,4],participating:[1,2,3,4]}};await f.show();});
 await expect(page.getByRole('columnheader',{name:'Итог года'})).toBeVisible();await expect(page.getByRole('table')).toContainText('400 шт');
});

test('M14 M15 M16: guided creation validates without losing input',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Новая метрика',exact:true}).click();const editor=page.locator('#quarterly-editor');
 await editor.getByLabel('Название',{exact:true}).fill('Неполная метрика');await editor.getByRole('button',{name:'Создать и начать'}).click();
 await expect(editor.getByRole('alert')).toContainText('Источник');await expect(editor.locator('[name=source]')).toHaveAttribute('aria-invalid','true');await expect(editor.getByLabel('Название',{exact:true})).toHaveValue('Неполная метрика');
 await expect(editor.locator('[name=direction] option[value=down]')).toHaveAttribute('disabled','');
 await editor.getByLabel('Тип результата',{exact:true}).selectOption('threshold');await editor.getByLabel('Направление',{exact:true}).selectOption('down');await editor.getByLabel('Источник',{exact:true}).fill('QA');await expect(editor.getByLabel('Направление',{exact:true})).toHaveValue('down');
 await expect(editor.locator('[data-quarter="1"]')).toBeHidden();await editor.getByLabel('Действие',{exact:true}).selectOption('draft');await expect(editor.getByRole('button',{name:'Сохранить черновик'})).toBeVisible();
});

for(const count of [0,1,25,26])test(`M20: measurement boundary ${count}`,async({page})=>{
 await setup(page,{card:true});await page.evaluate(async count=>{const f=window.quarterFixture;f.responses['/measurements?']={items:Array.from({length:Math.min(count,25)},(_,i)=>({id:i,value:'0',measured_on:'2026-11-03',source:'QA'})),total:count};await f.show();},count);
 const pages=page.getByRole('navigation',{name:'Страницы списка'});if(!count)await expect(pages).toHaveCount(0);else{await expect(pages.getByRole('button',{name:'Назад'})).toBeDisabled();if(count<=25)await expect(pages.getByRole('button',{name:'Далее'})).toBeDisabled();else await expect(pages.getByRole('button',{name:'Далее'})).toBeEnabled();}
});

test('M23: lazy secondary load and partial failure retain primary card',async({page})=>{
 await setup(page,{card:true});expect(await page.evaluate(()=>window.quarterFixture.reads.some(x=>/\/files|\/comments|\/history/.test(x)))).toBe(false);
 await page.evaluate(async()=>{const f=window.quarterFixture;f.route='#/metrics/1?year=2026&quarter=4&section=discussion';f.getFailure='/files';await f.show();});await expect(page.locator('#quarterly-card')).toBeVisible();await expect(page.getByRole('alert')).toContainText('Не удалось загрузить');await expect(page.getByRole('heading',{name:'Обсуждение',exact:true})).toBeVisible();
});

test('M13 M29: readable history and collapsible long comments',async({page})=>{
 await setup(page,{card:true,width:390});await page.evaluate(async()=>{const f=window.quarterFixture;f.route='#/metrics/1?year=2026&quarter=4&section=history';f.responses['/history?']={items:[{action:'fact_corrected',actor_id:1,created_at:'2026-11-03T12:00:00Z',before:{value:'70'},after:{value:'80'}}],total:1};await f.show();});
 await expect(page.locator('#quarterly-card')).toContainText('Исправлен факт');await expect(page.locator('#quarterly-card')).toContainText('Владелец');await expect(page.locator('#quarterly-card')).toContainText('МСК');await page.locator('#quarterly-card summary').filter({hasText:'Исправлен факт'}).click();await expect(page.locator('#quarterly-card')).toContainText('70 → 80');
 await page.evaluate(async()=>{const f=window.quarterFixture;f.route='#/metrics/1?year=2026&quarter=4&section=discussion';f.responses['/comments?']={items:[{text:'Тестовый текст. '.repeat(600),author_id:1,created_at:'2026-11-03T12:00:00Z'}],total:1};await f.show();});
 const article=page.locator('#quarterly-card article');expect((await article.boundingBox()).height).toBeLessThan(350);await article.locator('summary').press('Enter');await expect(article.locator('details')).toHaveAttribute('open','');await expect(article.locator('summary')).toHaveText('Свернуть комментарий');
});

test('M24: unlink is scoped to relation and confirmed',async({page})=>{
 await setup(page,{card:true});await page.evaluate(async()=>{const f=window.quarterFixture;f.route='#/metrics/1?year=2026&quarter=4&section=discussion';f.responses['/links']={items:[{id:12,kind:'work',target_id:8,public_id:'WRK-8',title:'QA'}]};await f.show();});
 await page.getByRole('button',{name:'Снять связь',exact:true}).click();await expect(page.getByRole('alertdialog')).toContainText('Связанная задача останется без изменений');await page.getByRole('alertdialog').getByRole('button',{name:'Снять связь',exact:true}).click();
 const req=await page.evaluate(()=>window.quarterFixture.requests.at(-1));expect(req.method).toBe('DELETE');expect(req.path).toBe('/metrics/1/links/12?version=1');
});

test('M18: nearest future meeting is selected',async({page})=>{
 await setup(page,{card:true});await page.evaluate(async()=>{const f=window.quarterFixture;f.options.meetings=[{id:3,kind:'directorate',scheduled_date:'2027-02-01',state:'planned'},{id:1,kind:'directorate',scheduled_date:'2026-11-02',state:'planned'},{id:2,kind:'directorate',scheduled_date:'2026-11-09',state:'planned'}];f.route='#/metrics/1?year=2026&quarter=4&section=discussion';await f.show();});
 await page.getByRole('button',{name:'Подготовить статус встречи'}).click();await expect(page.getByRole('combobox',{name:/^Встреча/})).toHaveValue('2');
});

test('M08 M09 M10 M11: period controls and accessible chart values',async({page})=>{
 await setup(page,{card:true,width:390});await page.evaluate(async()=>{const f=window.quarterFixture;f.metric.periods[0].fact={value:'100',as_of_date:'2026-11-03',status:'preliminary'};f.responses['/observation-chart']={items:[{date:'2026-11-03',value:'100'}]};await f.show();});
 await expect(page.getByRole('group',{name:'Выбор квартала'})).toBeVisible();expect(await page.locator('.qmetric-chart-scale').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(12);
 await expect(page.locator('.qmetric-chart').first().locator('.qmetric-measure-mark')).toHaveCount(1);await expect(page.locator('.qmetric-chart').first().locator('.qmetric-fact-mark')).toHaveCount(1);
 await page.getByText('Точные значения графика (2)',{exact:true}).press('Enter');await expect(page.getByRole('region',{name:'Точные значения',exact:true}).first()).toContainText('100');
 await page.getByRole('button',{name:'К замерам выбранного квартала'}).click();await expect(page.locator('#qmetric-observations')).toBeFocused();
});

test('M17 M19 M27: conditional settings and independent preliminary action',async({page})=>{
 await setup(page,{card:true});await page.evaluate(async()=>{const f=window.quarterFixture;f.metric.year_settings.aggregation='none';f.metric.periods[0].capabilities.close=true;await f.show();});
 await expect(page.getByRole('button',{name:'Обновить предварительный факт'})).toBeVisible();await page.locator('#quarterly-card summary').filter({hasText:/^Годовой итог$/}).click();await expect(page.locator('#quarterly-card')).toContainText('Годовой итог не рассчитывается по выбранному правилу');
 await page.getByRole('button',{name:'Область и правило года'}).click();const form=page.locator('#quarterly-editor');await expect(form.locator('[name=scale]')).toBeHidden();await form.locator('[name=aggregation]').selectOption('ratio');await expect(form.locator('[name=scale]')).toBeVisible();await expect(form.locator('[name=exclude_4]')).toBeHidden();
});

test('M21: closing card restores source link focus',async({page})=>{
 await setup(page,{card:true});await page.locator('#quarterly-card').getByRole('button',{name:'Закрыть',exact:true}).click();await page.evaluate(async()=>{const f=window.quarterFixture;f.route=location.hash;await f.show();});await expect(page.getByRole('link',{name:'Квартальный объём обслуживания с длинным названием',exact:true})).toBeFocused();
});

test('M28: conflict compares user values and refreshed values',async({page})=>{
 await setup(page,{card:true});await page.getByRole('button',{name:'Внести факт',exact:true}).click();const editor=page.locator('#quarterly-editor');await editor.getByLabel('Значение',{exact:true}).fill('101');
 await page.evaluate(()=>{const f=window.quarterFixture;f.failure={status:409,message:'Версия изменена'};f.metric.periods[0].fact={value:'102',author_id:1,created_at:'2026-11-03T12:00:00Z'};});await editor.getByRole('button',{name:'Сохранить',exact:true}).click();await editor.getByRole('button',{name:'Сравнить с актуальной версией'}).click();await expect(editor.getByRole('button',{name:'Сохранить мой вариант поверх актуального',exact:true})).toBeVisible();
 await expect(editor.getByRole('table')).toContainText('Ваш ввод');await expect(editor.getByRole('table')).toContainText('101');await expect(editor.getByRole('table')).toContainText('102');await expect(editor.locator('pre')).toHaveCount(0);await expect(editor.getByLabel('Значение',{exact:true})).toHaveValue('101');
 await page.evaluate(()=>{window.quarterFixture.failure=null;window.quarterFixture.metric.version=2;});await editor.getByRole('button',{name:'Сохранить мой вариант поверх актуального',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Сохранить мой вариант',exact:true}).click();await expect(editor).toHaveCount(0);expect(await page.evaluate(()=>window.quarterFixture.requests.at(-1).body)).toMatchObject({version:2,value:'101'});
});

for(const status of [403,404,503])test(`M22: detail load ${status} has recovery action`,async({page})=>{
 await setup(page,{card:true});await page.evaluate(async status=>{const f=window.quarterFixture;f.getFailure='/metrics/1?';f.getFailureStatus=status;await f.show();},status);
 await expect(page.getByRole('heading',{name:status===403?'Недостаточно прав':status===404?'Метрика не найдена или недоступна':'Метрики недоступны',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:status===503?'Повторить':'К реестру',exact:true})).toBeVisible();
});

test('visual review: zero alerts stay visible and shared controls retain readable year',async({page})=>{
 await setup(page);await page.evaluate(async()=>{const f=window.quarterFixture;f.list.summary.missing_fact=0;f.metric.periods[0].fact={value:'90',status:'preliminary',as_of_date:'2026-11-03'};f.metric.periods[0].result={outcome:'not_achieved',progress:'90',is_final:false};await f.show();(await import('/js/ui/filterSelect.js')).installFilterSelects();});
 await expect(page.locator('.qmetric-signals .ui-filter-chip')).toHaveCount(4);
 expect(await page.locator('.qmetric-outcome .ui-badge>span').first().evaluate(e=>getComputedStyle(e).whiteSpace)).toBe('normal');
 const year=page.locator('#quarterly-filters [name=year]');await expect(year).toHaveValue('2026');expect((await year.boundingBox()).width).toBeGreaterThanOrEqual(80);
 await page.getByRole('button',{name:'Все фильтры',exact:true}).click();await expect(page.locator('#qmetric-filter-extra .ui-filter-chip')).toHaveCount(0);
 await page.getByRole('button',{name:'Все фильтры',exact:true}).click();await page.locator('#quarterly-filters [name=quarter]').click();
 await page.getByRole('dialog',{name:'Фильтр: Квартал'}).getByRole('button',{name:'3 квартал',exact:true}).click();
 expect(await page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('quarter'))).toBe('3');
 await page.getByRole('button',{name:'Год',exact:true}).click();expect(await page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('view'))).toBe('year');
});

test('visual review: tabs support arrows and exact decimal expands without inner scrolling',async({page})=>{
 await setup(page,{card:true,width:390});await page.evaluate(async()=>{const f=window.quarterFixture;f.metric.display_precision=10;f.metric.periods[0].fact={value:'999999999999999.9999999999',status:'preliminary',as_of_date:'2026-11-03'};await f.show();});
 const exact=page.locator('.qmetric-exact');await exact.locator('summary').press('Enter');await expect(exact.locator('span')).toContainText('999,9999999999');
 expect(await exact.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBeTruthy();
 const tabs=page.getByRole('tablist',{name:'Разделы карточки'});await tabs.getByRole('tab',{name:'Показатели',exact:true}).focus();
 await page.keyboard.press('ArrowRight');await expect(tabs.getByRole('tab',{name:'Обсуждение',exact:true})).toBeFocused();
 await page.keyboard.press('Enter');expect(await page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('section'))).toBe('discussion');
 await page.evaluate(async()=>{const f=window.quarterFixture;f.route=location.hash;await f.show();});await expect(page.getByRole('tab',{name:'Обсуждение',exact:true})).toBeFocused();
});

test('visual review: populated observations do not widen the summary on mobile',async({page})=>{
 await setup(page,{card:true,width:390,theme:'dark'});await page.evaluate(async()=>{const f=window.quarterFixture;f.metric.display_precision=10;f.metric.periods[0].fact={value:'999999999999999.9999999999',status:'preliminary',as_of_date:'2026-11-03'};f.responses['/measurements?']={items:Array.from({length:25},(_,i)=>({id:i+1,value:'999999999999999.9999999999',measured_on:'2026-11-03',source:'QA pagination source'})),total:26};await f.show();});
 const bounds=await page.locator('.qmetric-result-section').evaluate(e=>{const r=e.getBoundingClientRect(),d=document.querySelector('#quarterly-card').getBoundingClientRect();return {left:r.left,right:r.right,dialogLeft:d.left,dialogRight:d.right};});expect(bounds.left).toBeGreaterThanOrEqual(bounds.dialogLeft);expect(bounds.right).toBeLessThanOrEqual(bounds.dialogRight);
 const fact=page.locator('.qmetric-result-section .qmetric-summary>div').nth(1);await expect(fact).toBeInViewport();
 await page.locator('.qmetric-exact summary').press('Enter');await expect(page.locator('.qmetric-exact')).toContainText('999,9999999999');
});

for(const theme of ['light','dark'])for(const width of [1440,390])test(`R7 all editor surfaces ${theme} ${width}`,async({page},info)=>{
 test.setTimeout(180000);
 for(const action of ['create','fact','measure','use','correct-measure','close','final','plans','revise','settings','passport','comment','file','link','report','lifecycle','archive','cancel','restore','activate']){
  await setup(page,{card:action!=='create',width,theme});
  await page.evaluate(async action=>{
   const f=quarterFixture,p=f.metric.periods[0];
   if(['comment','file','link','report'].includes(action))f.route='#/metrics/1?year=2026&quarter=4&section=discussion';
   p.capabilities.close=action==='close';p.capabilities.correct_final=['final','revise'].includes(action);
   if(['final','revise'].includes(action))p.state='completed';if(action==='restore')p.state='cancelled';if(action==='activate')p.state='draft';
   f.responses['/measurements?']={items:[{id:9,value:'20',measured_on:'2026-11-03',source:'Источник замера'}],total:1};
   await f.show();
  },action);
  const trigger=page.locator(`[data-qact="${action}"]`).first();
  await trigger.evaluate(el=>{for(let n=el.parentElement;n;n=n.parentElement)if(n.tagName==='DETAILS')n.open=true;});
  await trigger.click();const editor=page.locator('#quarterly-editor');await expect(editor).toBeVisible();
  for(const summary of await editor.locator('details>summary').all())if(await summary.isVisible())await summary.click();
  await expect(editor.locator('[type=submit]')).toBeInViewport();
  const bounds=await editor.evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:e.scrollWidth>e.clientWidth+1};});
  expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeLessThanOrEqual(bounds.width+1);expect(bounds.bottom).toBeLessThanOrEqual(bounds.height+1);expect(bounds.overflow).toBe(false);
  if(width===390){const footer=await editor.locator('.ui-detail-panel-footer').boundingBox();expect(footer.y+footer.height).toBeGreaterThan(980);}
  await page.screenshot({path:info.outputPath(`${action}.png`)});
  if(['close','final','revise'].includes(action))expect(await editor.locator('input[type=checkbox]').evaluateAll(es=>es.every(e=>e.closest('.ui-checkbox')))).toBe(true);
  if(action==='settings'){await expect(editor.getByRole('checkbox',{name:'4 квартал',exact:true})).toBeChecked();expect(await editor.locator('form').evaluate(e=>new FormData(e).getAll('expected_quarters'))).toEqual(['4']);}
  await editor.getByRole('button',{name:'Отмена',exact:true}).click();await expect(editor).toHaveCount(0);
 }
});

for(const [theme,width] of [['light',1440],['dark',390]])test(`R7 expanded menus and sections ${theme} ${width}`,async({page},info)=>{
 test.setTimeout(240000);await setup(page,{theme,width});await page.setViewportSize({width,height:width===390?844:900});
 await page.evaluate(async()=>{quarterFixture.options.users.push(...Array.from({length:12},(_,i)=>({id:i+2,name:'Владелец '+(i+2)})));await quarterFixture.show();(await import('/js/ui/filterSelect.js')).installFilterSelects();});
 await page.getByRole('button',{name:'Все фильтры',exact:true}).click();
 for(const label of ['Команды','Владельцы','Проекты','Состояние метрики','Состояние периода','Область','Сортировка']){
  await page.getByRole('combobox',{name:label,exact:true}).click();const popup=page.getByRole('dialog',{name:'Фильтр: '+label,exact:true});await expect(popup).toBeVisible();
  const r=await popup.boundingBox();expect(r.x).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(width+1);
  await page.screenshot({path:info.outputPath('filter-'+label+'.png')});await page.keyboard.press('Escape');await expect(popup).toBeHidden();
 }
 await page.getByRole('combobox',{name:'Владельцы',exact:true}).click();await page.getByRole('searchbox',{name:'Поиск значения'}).fill('неттакоговладельца');await expect(page.getByRole('dialog',{name:'Фильтр: Владельцы'})).toContainText('Ничего не найдено');await page.screenshot({path:info.outputPath('filter-empty.png')});await page.keyboard.press('Escape');
 await page.evaluate(async()=>{const f=quarterFixture;f.route='#/metrics/1?year=2026&quarter=4';await f.show();});
 for(const summary of await page.locator('#quarterly-card details>summary').all())if(await summary.isVisible())await summary.click();
 await page.screenshot({path:info.outputPath('card-expanded.png')});
 await page.evaluate(async()=>{const f=quarterFixture;f.route='#/metrics/1?year=2026&quarter=4&section=history';f.responses['/history?']={items:[{action:'fact_corrected',actor_id:1,created_at:'2026-11-03T12:00:00Z',before:{value:'70'},after:{value:'80'},reason:'Уточнение результата'}],total:1};await f.show();});
 await page.locator('#quarterly-card summary').filter({hasText:'Исправлен факт'}).click();await page.screenshot({path:info.outputPath('history-expanded.png')});
 for(const label of ['Область истории','Тип события']){await page.getByRole('combobox',{name:label,exact:true}).click();await expect(page.getByRole('dialog',{name:'Фильтр: '+label})).toBeVisible();await page.screenshot({path:info.outputPath(label+'.png')});await page.keyboard.press('Escape');}
 await page.evaluate(async()=>{const f=quarterFixture;f.route='#/metrics/1?year=2026&quarter=4&section=discussion';f.responses['/comments?']={items:[{text:'Длинный комментарий с объяснением результата. '.repeat(40),author_id:1,created_at:'2026-11-03T12:00:00Z'}],total:1};f.responses['/files']={items:[{id:3,filename:'Приложение с результатами измерений квартальной метрики.pdf',size:512}]};f.responses['/links']={items:[{id:12,kind:'work',target_id:8,public_id:'WRK-8',title:'Проверка полного квартального результата'}]};await f.show();});
 await page.getByRole('combobox',{name:'Показывать',exact:true}).click();await page.screenshot({path:info.outputPath('discussion-filter.png')});await page.keyboard.press('Escape');
 await page.locator('#quarterly-card article summary').click();await page.screenshot({path:info.outputPath('comment-expanded.png')});await page.locator('#quarterly-card article summary').click();
 expect(await page.locator('.qmetric-material').evaluateAll(es=>es.every(e=>e.scrollWidth<=e.clientWidth+1))).toBe(true);
 for(const action of ['Удалить вложение','Снять связь']){await page.getByRole('button',{name:action,exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();await page.screenshot({path:info.outputPath(action+'.png')});await page.getByRole('alertdialog').getByRole('button',{name:'Отмена',exact:true}).click();}
 await page.getByRole('button',{name:'Связать задачу',exact:true}).click();await expect(page.locator('#quarterly-editor')).toBeVisible();await page.screenshot({path:info.outputPath('link-picker.png')});await page.locator('#quarterly-editor').getByRole('button',{name:'Отмена',exact:true}).click();
});

test('R7 named quarter selection validates and empty meetings explain recovery',async({page},info)=>{
 await setup(page,{card:true,width:390,theme:'dark'});await page.setViewportSize({width:390,height:844});
 await page.locator('summary').filter({hasText:'Годовой итог'}).click();await page.getByRole('button',{name:'Область и правило года',exact:true}).click();
 const editor=page.locator('#quarterly-editor');await editor.getByRole('checkbox',{name:'4 квартал',exact:true}).uncheck();await editor.getByLabel('Причина',{exact:true}).fill('Проверка области');await editor.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(editor.getByRole('alert')).toContainText('Выберите хотя бы один квартал');await editor.getByRole('link',{name:/Ожидаемые кварталы/}).click();await expect(editor.getByRole('checkbox',{name:'1 квартал',exact:true})).toBeFocused();
 await editor.getByRole('checkbox',{name:'3 квартал',exact:true}).check();await editor.getByRole('checkbox',{name:'4 квартал',exact:true}).check();await editor.getByRole('button',{name:'Сохранить',exact:true}).click();await expect(editor).toHaveCount(0);expect(await page.evaluate(()=>quarterFixture.requests.at(-1).body.expected_quarters)).toEqual([3,4]);
 await page.evaluate(async()=>{quarterFixture.route='#/metrics/1?year=2026&quarter=4&section=discussion';await quarterFixture.show();});await page.getByRole('button',{name:'Подготовить статус встречи',exact:true}).click();await expect(page.locator('#quarterly-editor [type=submit]')).toBeDisabled();await expect(page.locator('#quarterly-editor')).toContainText('Нет запланированных встреч');await page.screenshot({path:info.outputPath('empty-meeting-mobile.png')});
});

test('M25: migration enables only explicitly selected data',async({page})=>{
 await setup(page);await page.evaluate(async()=>{const {openMetricMigration}=await import('/js/components/metricsMigration.js');await openMetricMigration({router:{},api:{request:async()=>({version:1,periods:[{period:{id:9,label:'Прежний квартал',start_date:'2026-10-01',end_date:'2026-12-31',state:'active',target:'100'},recognized_quarter:4,proposed_type:'volume',proposed_fact:{value:'90',measured_on:'2026-11-03',source:'QA'},undated_legacy_fact:null}]})}},1);});
 const dialog=page.locator('#quarterly-migration');await expect(dialog.getByLabel('Факт',{exact:true})).toBeDisabled();await dialog.getByLabel('Перевести 4 квартал').check();await expect(dialog.getByLabel('Тип результата')).toBeEnabled();await expect(dialog.getByLabel('Факт',{exact:true})).toBeDisabled();await dialog.getByLabel('Сохранить явно выбранный факт').check();await expect(dialog.getByLabel('Факт',{exact:true})).toBeEnabled();
});
