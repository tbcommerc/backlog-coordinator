import {test,expect} from '@playwright/test';

async function setup(page,{width=1440,theme='light',section='overview',edit=true}={}){
 await page.setViewportSize({width,height:1000});
 await page.goto('/ui-catalog/core.html');
 await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.evaluate(async({theme,section,edit})=>{
  await import('/e2e/fixtures/spaStyles.js');
  (await import('/js/modalAccessibility.js')).initModalAccessibility();
  document.documentElement.dataset.theme=theme;
  const legacy=await import('/js/components/metrics.js'); const mod={renderMetrics:legacy.renderLegacyMetrics,initMetrics:legacy.initLegacyMetrics};
  const options={user_id:1,team_id:1,can_create:true,edit_scope:'team',today:'2026-11-02',current_period:'2026-10-01|2026-12-31',periods:[{key:'2026-10-01|2026-12-31',label:'4 квартал 2026',start_date:'2026-10-01',end_date:'2026-12-31'}],teams:[{id:1,name:'Команда сервиса'}],users:[{id:1,name:'Ответственный'}],projects:[],priorities:[],business_customers:[],departments:[],did_client_groups:[],meetings:[]};
  const p={id:7,label:'4 квартал 2026',state:'active',start_date:'2026-10-01',end_date:'2026-12-31',direction:'down',target:3,baseline:null,baseline_date:null,cadence:'none',legacy_fact:null,method_snapshot:'Среднее время',source_snapshot:'Система заявок',summary:{fact:4.2,measured_on:'2026-11-02',progress:null,achieved:false,deviation:1.2,freshness:'current',next_due:null,missed_count:0}};
  const card={id:1,version:5,title:'Время обработки заявки',public_id:'MET-001',unit:'дня',team_id:1,owner_id:1,team:'Команда сервиса',owner:'Ответственный',source:'Система заявок',method:'Среднее время',tags:['Важная'],involved_teams:[],involved_team_ids:[],permissions:{edit,comment:edit},periods:[p],measurements:Array.from({length:7},(_,i)=>({id:i+1,period_id:7,measured_on:'2026-11-'+String(2-i>0?2-i:1).padStart(2,'0'),value:4.2+i,source:'Система заявок',comment:'',author:'Ответственный'})),links:[],comments:[],files:[{id:8,filename:'Методика.txt',size:10,created_at:'2026-10-01'}],reports:[],history:[{id:1,action:'created',author:'Ответственный',created_at:'2026-10-01',before:{},after:{title:'Время обработки заявки'}}]};
  // Unique dates matching the real API contract.
  card.measurements.forEach((m,i)=>m.measured_on=new Date(Date.UTC(2026,10,2-i)).toISOString().slice(0,10));
  const registry={items:[{...card,period:p}],summary:{active:1,achieved:0,overdue:0,missing:0},total:1,page:1,pages:1};
  window.metricFixture={card,options,registry,requests:[]};
  const app={router:{},api:{get:async url=>url.endsWith('/options')?options:url.startsWith('/metrics?')?registry:card,request:async(method,path,body,opts)=>{window.metricFixture.requests.push({method,path,body,opts});if(window.metricFixture.reject)throw window.metricFixture.reject;return card;}}};
  window.metricFixture.show=async section=>{location.hash=section===null?'#/metrics':'#/metrics/1?section='+section;document.body.innerHTML='<main style="padding:16px;min-width:0"></main>';document.querySelector('main').innerHTML=await mod.renderMetrics(app);mod.initMetrics(app);};
  await window.metricFixture.show(section);
 },{theme,section,edit});
}

test('one form creates metric and active goal; draft allows incomplete target',async({page})=>{
 await setup(page,{section:null});
 await page.getByRole('button',{name:'Новая метрика',exact:true}).click();
 const form=page.locator('#metric-editor');
 await form.locator('[name=title]').fill('Доля ошибок');
 await form.locator('[name=unit]').fill('%');
 await form.locator('[name=source]').fill('Мониторинг');
 await form.locator('[name=direction]').selectOption('down');
 await form.locator('[name=target]').fill('0');
 await expect(form.locator('[name=cadence]')).toHaveValue('none');
 await expect(form.locator('[name=baseline]')).toBeDisabled();
 await expect(form.locator('[name=upper]')).toBeHidden();
 await form.getByRole('button',{name:'Создать',exact:true}).click();
 const request=await page.evaluate(()=>window.metricFixture.requests[0]);
 expect(request).toMatchObject({method:'POST',path:'/metrics',body:{title:'Доля ошибок',unit:'%',source:'Мониторинг',method:'',owner_id:1,team_id:1,initial_period:{direction:'down',target:0,upper:null,baseline:null,baseline_date:null,cadence:'none',first_due_date:null,start_immediately:true}}});
 expect(request.opts.idempotencyKey).toBeTruthy();
 await page.evaluate(()=>window.metricFixture.show(null));
 await page.getByRole('button',{name:'Новая метрика',exact:true}).click();
 await page.locator('#metric-editor [name=title]').fill('Черновая метрика');
 await page.locator('#metric-editor [name=unit]').fill('шт');
 await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
 expect(await page.evaluate(()=>window.metricFixture.requests.at(-1).body.initial_period)).toMatchObject({target:null,start_immediately:false});
});

test('conditional fields, validation and failed save preserve entered values',async({page})=>{
 await setup(page);
 await page.getByLabel('Действия с метрикой',{exact:true}).click();
 await page.getByRole('button',{name:'Настроить период',exact:true}).click();
 const form=page.locator('#metric-editor');
 await form.locator('[name=use_baseline]').check();
 await expect(form.locator('[name=baseline]')).toBeVisible();
 await expect(form.locator('[name=baseline]')).toHaveAttribute('required','');
 await form.locator('[name=baseline]').fill('10');
 await form.locator('[name=baseline_date]').fill('2026-10-01');
 await form.locator('[name=direction]').selectOption('range');
 await expect(form.locator('[name=baseline]')).toBeDisabled();
 await form.locator('[name=target]').fill('0');
 await form.locator('[name=upper]').fill('-1');
 await form.locator('[name=reason]').fill('Изменение условий');
 await form.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(form.locator('[name=upper]')).toHaveAttribute('aria-invalid','true');
 expect(await page.evaluate(()=>window.metricFixture.requests.length)).toBe(0);
 await form.locator('[name=upper]').fill('0');
 await form.locator('[name=cadence]').selectOption('interval');
 await expect(form.locator('[name=interval_days]')).toBeVisible();
 await form.locator('[name=interval_days]').fill('7');
 await form.locator('[name=first_due_date]').fill('2027-01-01');
 await form.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(form.locator('[name=first_due_date]')).toHaveAttribute('aria-invalid','true');
 await form.locator('[name=cadence]').selectOption('none');
 await page.evaluate(()=>window.metricFixture.reject=Object.assign(Error('Конфликт версии'),{status:409}));
 await form.getByRole('button',{name:'Сохранить',exact:true}).click();
 await expect(form.locator('#metric-form-error')).toContainText('Конфликт версии');
 await expect(form.locator('[name=upper]')).toHaveValue('0');
 await expect(form.getByRole('button',{name:'Обновить данные карточки',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.metricFixture.requests[0].body)).toMatchObject({target:0,upper:0,cadence:'none',first_due_date:null,version:5});
});

test('duplicate date opens explicit correction and preserves new value',async({page})=>{
 await setup(page);
 await page.getByRole('button',{name:'Внести значение',exact:true}).click();
 const form=page.locator('#metric-editor');
 await expect(form.locator('[name=measured_on]')).toHaveValue('2026-11-02');
 await expect(form.locator('[name=source]')).toBeHidden();
 await form.locator('[name=value]').fill('0');
 await form.getByRole('button',{name:'Добавить замер',exact:true}).click();
 await page.getByRole('button',{name:'Исправить замер',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Исправить измерение',exact:true})).toBeVisible();
 await expect(form.locator('[name=value]')).toHaveValue('0');
 await expect(form.locator('[name=reason]')).toHaveAttribute('required','');
 expect(await page.evaluate(()=>window.metricFixture.requests.length)).toBe(0);
 await form.locator('[name=reason]').fill('Проверен первоисточник');
 await form.getByRole('button',{name:'Сохранить исправление',exact:true}).click();
 expect(await page.evaluate(()=>window.metricFixture.requests[0])).toMatchObject({method:'PATCH',path:'/metrics/1/measurements/1',body:{value:0,reason:'Проверен первоисточник',source:'Система заявок'}});
});

test('next period defaults after existing periods and starts in one request',async({page})=>{
 await setup(page);
 await page.getByLabel('Действия с метрикой',{exact:true}).click();
 await page.getByRole('button',{name:'Новый период',exact:true}).click();
 const form=page.locator('#metric-editor');
 await expect(form.locator('[name=start_date]')).toHaveValue('2027-01-01');
 await expect(form.locator('[name=end_date]')).toHaveValue('2027-03-31');
 await form.locator('[name=target]').fill('2');
 await form.getByRole('button',{name:'Сохранить и начать',exact:true}).click();
 expect(await page.evaluate(()=>window.metricFixture.requests[0])).toMatchObject({method:'POST',path:'/metrics/1/periods',body:{target:2,start_date:'2027-01-01',end_date:'2027-03-31',start_immediately:true}});
});

for(const theme of ['light','dark'])for(const width of [1440,390,320])test(`compact card and legacy navigation ${theme}/${width}`,async({page},testInfo)=>{
 await setup(page,{theme,width,edit:false});
 const card=page.locator('#metric-card');
 await expect(card.locator('.metric-tab')).toHaveCount(3);
 await expect(card).toContainText('На 1,2 дня выше цели');
 await expect(card).not.toContainText('Нужна база');
 await expect(card.getByRole('button',{name:'Внести значение',exact:true})).toHaveCount(0);
 await expect(card.locator('table tbody tr')).toHaveCount(7);
 await expect(card.getByRole('button',{name:/Исправить замер от/})).toHaveCount(0);
 await expect(card.getByRole('status')).toContainText('Без расписания');
 const geometry=await card.evaluate(el=>({width:el.getBoundingClientRect().width,overflow:el.scrollWidth-el.clientWidth}));
 expect(geometry.width).toBeLessThanOrEqual(width);expect(geometry.overflow).toBeLessThanOrEqual(1);
 await card.screenshot({path:testInfo.outputPath('overview.png')});
 for(const section of ['measurements','links','files','comments','reports','history']){
  await page.evaluate(section=>window.metricFixture.show(section),section);
  await expect(card.locator('.metric-tab[aria-current=page]')).toHaveText(['files','comments'].includes(section)?'Обсуждение':['reports','history'].includes(section)?'История':'Обзор');
 }
 await expect(card).toContainText('Метрика создана');
 await page.getByRole('link',{name:'Обсуждение',exact:true}).click();
 await expect(card).toContainText('Методика.txt');
 await page.keyboard.press('Escape');
 await expect.poll(()=>page.evaluate(()=>location.hash)).toBe('#/metrics');
});
