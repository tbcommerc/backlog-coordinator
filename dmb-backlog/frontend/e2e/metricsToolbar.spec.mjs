import {test,expect} from '@playwright/test';

async function openRegistry(page,{width=1440,theme='light',hash='#/metrics',canCreate=true}={}){
 await page.setViewportSize({width,height:900});
 await page.goto('/ui-catalog/core.html');
 await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.addScriptTag({url:'/js/lib/lucide.min.js'});
 await page.evaluate(async({theme,hash,canCreate})=>{
  await import('/e2e/fixtures/spaStyles.js');
  const {installFilterSelects}=await import('/js/ui/filterSelect.js');
  installFilterSelects();
  document.documentElement.dataset.theme=theme;
  const legacy=await import('/js/components/metrics.js'); const mod={renderMetrics:legacy.renderLegacyMetrics,initMetrics:legacy.initLegacyMetrics};
  const options={user_id:1,can_create:canCreate,current_period:'2026-Q4',periods:[{id:'2026-Q3',name:'3 квартал 2026'},{id:'2026-Q4',name:'4 квартал 2026'}],teams:[{id:1,name:'Проектный офис'}],users:[{id:1,name:'Владелец метрик'}],projects:[{id:7,name:'Развитие платформы'}]};
  const registry={items:[{id:1,title:'Показатель качества',public_id:'MET-1',unit:'%',owner:'Владелец метрик',team:'Проектный офис'}],summary:{active:1,achieved:0,overdue:0,missing:0},total:1,page:1,pages:1};
  window.metricRequests=[];
  const app={router:{},api:{get:async url=>{if(url.endsWith('/options'))return options;window.metricRequests.push(url);return registry;}}};
  window.metricToolbarApp=app;
  location.hash=hash;
  document.body.innerHTML='<main style="padding:16px;min-width:0"></main>';
  const render=async()=>{const html=await mod.renderMetrics(app);if(html){document.querySelector('main').innerHTML=html;mod.initMetrics(app);}};
  await render();
  window.addEventListener('hashchange',render);
 },{theme,hash,canCreate});
 await expect(page.getByRole('heading',{name:'Метрики',exact:true})).toBeVisible();
}

test('metric teams allow multiple values and restore them from URL',async({page})=>{
 await openRegistry(page);
 await page.locator('[name=team_id]').evaluate(select=>select.add(new Option('Вторая команда','2')));
 await page.locator('[name=team_id]').click();
 let panel=page.getByRole('dialog',{name:'Фильтр: Команда'});
 await panel.getByRole('checkbox',{name:'Проектный офис',exact:true}).check();
 await panel.getByRole('checkbox',{name:'Вторая команда',exact:true}).check();
 await panel.getByRole('button',{name:'Применить',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('team_id'))).toBe('["1","2"]');
 await expect(page.locator('[name=team_id]')).toHaveValue('["1","2"]');
 // One available reference was removed by the fixture's reload; its selected ID is retained.
 await page.locator('[name=team_id]').click();
 panel=page.getByRole('dialog',{name:'Фильтр: Команда'});
 await expect(panel.getByRole('checkbox',{name:'Проектный офис',exact:true})).toBeChecked();
 await expect(panel.getByRole('checkbox',{name:'Недоступное значение: 2',exact:true})).toBeChecked();
 await panel.getByRole('checkbox',{name:'Проектный офис',exact:true}).uncheck();
 await panel.getByRole('button',{name:'Применить',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('team_id'))).toBe('2');
});

test('several metric attention shortcuts persist together',async({page})=>{
 await openRegistry(page);
 await page.locator('[data-act=attention][data-key=active]').click();
 await page.locator('[data-act=attention][data-key=missing]').click();
 await expect.poll(()=>page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('attention'))).toBe('["active","missing"]');
 await expect(page.locator('[data-act=attention][data-key=active]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('[data-act=attention][data-key=missing]')).toHaveAttribute('aria-pressed','true');
});

test('period uses shared popup and filters retain equal widths',async({page})=>{
 await openRegistry(page);
 const fields=page.locator('.metric-main-filters .metric-filter-control');
 const widths=await fields.evaluateAll(items=>items.map(item=>Math.round(item.getBoundingClientRect().width)));
 expect(Math.max(...widths)-Math.min(...widths)).toBeLessThanOrEqual(1);
 await page.locator('[name="period"]').click();
 const panel=page.getByRole('dialog',{name:'Фильтр: Период'});
 await expect(panel).toBeVisible();
 await panel.getByRole('button',{name:'3 квартал 2026',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('period'))).toBe('2026-Q3');
 await expect(page.getByRole('dialog',{name:'Фильтр: Период'})).toHaveCount(0);
});

test('search debounce, Enter, focus and filter persistence',async({page})=>{
 await openRegistry(page,{hash:'#/metrics?period=2026-Q3&team_id=1&scope=mine&attention=overdue&page=3'});
 const search=page.getByRole('searchbox',{name:'Поиск метрик'});
 await search.fill('качество');
 await expect.poll(()=>page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('q'))).toBe('качество');
 await expect(search).toBeFocused();await expect(search).toHaveValue('качество');
 expect(await page.evaluate(()=>document.activeElement.selectionStart)).toBe(8);
 const params=await page.evaluate(()=>Object.fromEntries(new URLSearchParams(location.hash.split('?')[1])));
 expect(params).toMatchObject({period:'2026-Q3',team_id:'1',scope:'mine',attention:'overdue'});expect(params.page).toBeUndefined();
 await search.fill('MET-12');await search.press('Enter');
 await expect.poll(()=>page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('q'))).toBe('MET-12');
 await search.fill('');
 await expect.poll(()=>page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).has('q'))).toBe(false);
 await expect(page.getByRole('button',{name:'Найти',exact:true})).toHaveCount(0);
});

test('immediate filters, hidden conditions, sorting, reset and stale debounce',async({page})=>{
 await openRegistry(page);
 await page.getByRole('combobox',{name:'Команда',exact:true}).selectOption('1');
 await expect.poll(()=>page.evaluate(()=>location.hash)).toContain('team_id=1');
 await page.getByRole('combobox',{name:'Владелец',exact:true}).selectOption('1');
 await expect.poll(()=>page.evaluate(()=>location.hash)).toContain('owner_id=1');
 await page.getByRole('combobox',{name:'Состояние',exact:true}).selectOption('active');
 await expect.poll(()=>page.evaluate(()=>location.hash)).toContain('state=active');
 await page.getByRole('combobox',{name:'Проект',exact:true}).selectOption('7');
 await page.getByRole('checkbox',{name:'Архив метрик',exact:true}).check();
 await expect(page.getByRole('checkbox',{name:'Архив метрик',exact:true})).toBeChecked();
 await page.getByRole('combobox',{name:'Сортировка',exact:true}).selectOption('due');
 await expect.poll(()=>page.evaluate(()=>location.hash)).toContain('sort=due');
 await expect(page.getByRole('checkbox',{name:'Архив метрик',exact:true})).toBeChecked();
 await page.getByRole('combobox',{name:'Проект',exact:true}).selectOption('');
 await expect(page.getByRole('checkbox',{name:'Архив метрик',exact:true})).toBeChecked();
 await expect.poll(()=>page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).has('project_id'))).toBe(false);
 await page.getByRole('button',{name:'Мои метрики',exact:true}).click();
 await expect(page.getByRole('button',{name:'Мои метрики',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.locator('[data-act=attention][data-key=overdue]').click();
 await expect(page.locator('[data-key=overdue]')).toHaveAttribute('aria-pressed','true');
 await page.getByRole('searchbox',{name:'Поиск метрик'}).fill('не должно вернуться');
 await page.getByRole('button',{name:'Сброс',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>location.hash)).toBe('#/metrics');
 await expect(page.getByRole('combobox',{name:'Период',exact:true})).toHaveValue('2026-Q4');
 await expect(page.getByRole('combobox',{name:'Сортировка',exact:true})).toHaveValue('title');
 await expect(page.getByRole('button',{name:'Все метрики',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('searchbox',{name:'Поиск метрик'})).toHaveValue('');
 await expect(page.getByRole('checkbox',{name:'Архив метрик',exact:true})).not.toBeChecked();
 // Let the former debounce deadline pass through a real UI action.
 await page.getByRole('searchbox',{name:'Поиск метрик'}).pressSequentially('новый',{delay:100});
 await expect.poll(()=>page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('q'))).toBe('новый');
});

test('continued typing survives an in-flight registry response',async({page})=>{
 await openRegistry(page);
 await page.evaluate(()=>{
  // Delay the actual module API response, without replacing the registry markup.
  window.metricResponseGate=new Promise(resolve=>window.releaseMetricResponse=resolve);
  window.metricDelayNext=true;
 });
 await page.evaluate(async()=>{
  // The fixture exposes its API below for deterministic response ordering.
  const get=window.metricToolbarApp.api.get;
  window.metricToolbarApp.api.get=async url=>{
   const response=await get(url);
   if(!url.endsWith('/options')&&window.metricDelayNext){window.metricDelayNext=false;window.metricRequestPending=true;await window.metricResponseGate;}
   return response;
  };
 });
 const search=page.getByRole('searchbox',{name:'Поиск метрик'});
 await search.fill('первая');
 await expect.poll(()=>page.evaluate(()=>window.metricRequestPending)).toBe(true);
 await search.fill('первая и вторая');
 await page.evaluate(()=>window.releaseMetricResponse());
 await expect(search).toHaveValue('первая и вторая');
 await expect(search).toBeFocused();
 await expect.poll(()=>page.evaluate(()=>new URLSearchParams(location.hash.split('?')[1]).get('q'))).toBe('первая и вторая');
});

for(const theme of ['light','dark'])for(const width of [320,390,768,1440])test(`toolbar geometry ${theme}/${width}`,async({page})=>{
 await openRegistry(page,{theme,width,hash:'#/metrics?project_id=7&archived=true'});
 await expect(page.getByRole('button',{name:'Обновить',exact:true})).toHaveAttribute('title','Обновить');
 await expect(page.locator('.metric-registry-bar [role=status]')).toHaveText('Найдено: 1');
 const geometry=await page.evaluate(()=>{
  const boxes=[...document.querySelectorAll('.metric-chips>button')].map(el=>{const r=el.getBoundingClientRect();return {width:r.width,top:r.top,overflow:el.scrollWidth-el.clientWidth};});
  return {overflow:document.documentElement.scrollWidth-innerWidth,boxes};
 });
 expect(geometry.overflow).toBeLessThanOrEqual(1);
 expect(Math.max(...geometry.boxes.map(x=>x.width))-Math.min(...geometry.boxes.map(x=>x.width))).toBeLessThanOrEqual(1);
 for(const box of geometry.boxes)expect(box.overflow).toBeLessThanOrEqual(1);
 if(width>=768)expect(new Set(geometry.boxes.map(x=>x.top)).size).toBe(1);
 const filterRows=await page.locator('.metric-main-filters>.metric-filter-control').evaluateAll(nodes=>nodes.map(el=>el.getBoundingClientRect().top));
 expect(filterRows).toHaveLength(5);
 if(width>=768)expect(new Set(filterRows).size).toBe(1);
 for(const label of ['Период','Команда','Владелец','Состояние','Проект']){
  const control=page.getByRole('combobox',{name:label,exact:true});
  await control.focus();
  await expect(control).toBeFocused();
  const focus=await control.evaluate(el=>({inner:getComputedStyle(el).outlineStyle,shadow:getComputedStyle(el).boxShadow,outer:getComputedStyle(el.closest('.metric-filter-control')).outlineStyle,width:getComputedStyle(el.closest('.metric-filter-control')).outlineWidth}));
  expect(focus).toEqual({inner:'none',shadow:'none',outer:'solid',width:'2px'});
 }
 await page.getByRole('combobox',{name:'Период',exact:true}).focus();
 await page.screenshot({path:`.runtime-metrics-toolbar/${theme}-${width}.png`,fullPage:true});
});

test('read-only role and direct URL restore',async({page})=>{
 await openRegistry(page,{canCreate:false,hash:'#/metrics?period=2026-Q3&owner_id=1&scope=mine&attention=overdue&sort=due&project_id=7'});
 await expect(page.getByRole('button',{name:'Новая метрика',exact:true})).toHaveCount(0);
 await expect(page.getByRole('combobox',{name:'Период',exact:true})).toHaveValue('2026-Q3');
 await expect(page.getByRole('combobox',{name:'Владелец',exact:true})).toHaveValue('1');
 await expect(page.getByRole('combobox',{name:'Сортировка',exact:true})).toHaveValue('due');
 await expect(page.getByRole('button',{name:'Мои метрики',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('[data-key=overdue]')).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('checkbox',{name:'Архив метрик',exact:true})).toBeVisible();
 await page.locator('[data-key=overdue]').click();
 await expect(page.locator('[data-key=overdue]')).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('[data-key=active] .quick-filter-count')).toHaveText('1');
});
