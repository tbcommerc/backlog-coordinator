import {test,expect} from '@playwright/test';

async function mount(page,width=1440) {
 await page.setViewportSize({width,height:900});
 await page.goto('/ui-catalog/core.html');
 await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.evaluate(async()=>{
  await import('/e2e/fixtures/spaStyles.js');
  const {installFilterSelects}=await import('/js/ui/filterSelect.js');
  document.body.innerHTML=`<main style="padding:16px"><form class="filter-panel" style="display:flex;flex-wrap:wrap;gap:8px">
   <label>Статус<select id="single" aria-label="Статус"><option value="">Все</option><option value="active">В работе</option><option disabled>Недоступно</option></select></label>
   <label>Период<select id="period" aria-label="Период">${Array.from({length:12},(_,i)=>`<option value="${i}">${i+1} квартал 2026</option>`).join('')}</select></label>
   <label>Команды<select id="multi" aria-label="Команды" multiple><option value="a" selected>Команда А</option><option value="b">Команда Б</option></select></label>
   <label>Отключён<select disabled aria-label="Отключён"><option>Все</option></select></label>
  </form><form><select id="editor" aria-label="Редактирование"><option>Поле формы</option></select></form><button id="outside">Снаружи</button></main>`;
  window.changes=0;document.querySelector('#single').addEventListener('change',()=>window.changes++);
  window.disposeFilters=installFilterSelects();
 });
}

for(const width of [1440,390,320])test(`shared filter menu and equal widths at ${width}`,async({page})=>{
 await mount(page,width);
 const widths=await page.locator('.ui-filter-slot').evaluateAll(fields=>fields.map(f=>f.getBoundingClientRect().width));
 expect(new Set(widths.map(Math.round)).size).toBe(1);
 await expect(page.locator('#editor')).not.toHaveClass(/ui-filter-select/);
 await page.locator('#single').click();
 const menu=page.getByRole('dialog',{name:'Фильтр: Статус'});
 await expect(menu).toBeVisible();
 await expect(menu.getByRole('button',{name:'Недоступно'})).toBeDisabled();
 await menu.getByRole('button',{name:'В работе'}).click();
 await expect(page.locator('#single')).toHaveValue('active');
 expect(await page.evaluate(()=>window.changes)).toBe(1);
 await expect(menu).toHaveCount(0);
 await expect(page.locator('#single')).toBeFocused();
 await page.locator('#period').press('ArrowDown');
 const periods=page.getByRole('dialog',{name:'Фильтр: Период'});
 await periods.getByRole('searchbox').fill('12 квартал');
 await expect(periods.locator('.ui-selection-option:visible')).toHaveCount(1);
 const box=await periods.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
 await periods.getByRole('searchbox').press('ArrowDown');
 await page.keyboard.press('Enter');
 await expect(page.locator('#period')).toHaveValue('11');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});

test('DID filters apply drafts and cancel without changing rows',async({page})=>{
 await mount(page);
 await page.evaluate(async()=>{
  const mod=await import('/js/components/didBacklog.js');
  const app={store:{get:()=>({permissions:{}})},api:{
   get:async url=>url.endsWith('/quarters')?{current_quarter:'4Q 2026',quarters:['4Q 2026']}:
    url.endsWith('/preferences')?{saved:false,prefs:null}:{tasks:[
     {id:1,title:'Первая',team_name:'Команда А',task_type_name:'Задача',gaps:[]},
     {id:2,title:'Вторая',team_name:'Команда Б',task_type_name:'Задача',gaps:[]},
    ],total_tasks:2,can_export:false},put:async()=>({})}};
  document.body.innerHTML=mod.renderDidBacklog(app);
  await mod.initDidBacklog(app);
 });
 const rows=page.locator('[data-did-task]');
 await expect(rows).toHaveCount(2);
 await page.locator('[data-did-filter="team_name"]').click();
 let panel=page.getByRole('dialog',{name:'Фильтр: Ответственная команда / кластер'});
 await panel.getByRole('checkbox',{name:'Команда А'}).check();
 await expect(rows).toHaveCount(2);
 await page.keyboard.press('Escape');
 await expect(rows).toHaveCount(2);
 await page.locator('[data-did-filter="team_name"]').click();
 panel=page.getByRole('dialog',{name:'Фильтр: Ответственная команда / кластер'});
 await expect(panel.getByRole('checkbox',{name:'Команда А'})).not.toBeChecked();
 await panel.getByRole('checkbox',{name:'Команда А'}).check();
 await panel.getByRole('button',{name:'Применить',exact:true}).click();
 await expect(rows).toHaveCount(1);
 await expect(rows).toContainText('Первая');
 await expect(page.locator('[data-did-filter="team_name"]')).toBeFocused();
});

test('policy enables OR selection for a scalar-backed filter and restores it',async({page})=>{
 await mount(page);
 await page.evaluate(()=>document.querySelector('.filter-panel').insertAdjacentHTML('beforeend','<label>Команды<select id="work-team" aria-label="Команды работы"><option value="">Все команды</option><option value="10">Команда А</option><option value="20">Команда Б</option></select></label>'));
 const field=page.locator('#work-team');
 await expect(field).toHaveAttribute('data-ui-selection','multiple');
 await field.click();
 let panel=page.getByRole('dialog',{name:'Фильтр: Команды работы'});
 await expect(panel.getByRole('checkbox',{name:'Все команды',exact:true})).toBeChecked();
 await panel.getByRole('checkbox',{name:'Команда А',exact:true}).check();
 await panel.getByRole('checkbox',{name:'Команда Б',exact:true}).check();
 await expect(panel.getByRole('checkbox',{name:'Все команды',exact:true})).not.toBeChecked();
 await panel.getByRole('button',{name:'Применить',exact:true}).click();
 await expect(field).toHaveValue('["10","20"]');
 await field.click();
 panel=page.getByRole('dialog',{name:'Фильтр: Команды работы'});
 await expect(panel.getByRole('checkbox',{name:'Команда А',exact:true})).toBeChecked();
 await expect(panel.getByRole('checkbox',{name:'Команда Б',exact:true})).toBeChecked();
 await panel.getByRole('button',{name:'Очистить',exact:true}).click();
 await page.keyboard.press('Escape');
 await expect(field).toHaveValue('["10","20"]');
 await field.click();
 await page.getByRole('dialog',{name:'Фильтр: Команды работы'}).getByRole('checkbox',{name:'Все команды',exact:true}).check();
 await page.getByRole('button',{name:'Применить',exact:true}).click();
 await expect(field).toHaveValue('');
});

test('production filter policies are explicit for every known select',async({page})=>{
 await mount(page);
 const decisions=await page.evaluate(async()=>{
  const {filterPolicy}=await import('/js/ui/filterPolicy.js');
  return ['work-status','work-priority','work-direction','work-team','work-assignee','work-filter-project','work-report-team','work-report-meeting','work-view','work-sort','work-completed','work-focus','review-mode-filter','review-status-filter','review-sort','customer-status-filter','customer-request-sort','did-quarter','effort-team','effort-period','profile-channel','profile-period','dep-period','dep-type','dep-mode','dep-threshold','sankey-period','sankey-channel','sankey-mode','complete-period','uniform-field','roi-period','roi-team','roi-type','p360-flow-period','p360-flow-channel'].map(id=>{const select=document.createElement('select');select.id=id;return {id,...filterPolicy(select)};});
 });
 for(const decision of decisions)expect(decision.reason,decision.id).not.toBe('Не классифицировано');
 expect(decisions.find(x=>x.id==='work-report-meeting').mode).toBe('single');
 expect(decisions.find(x=>x.id==='work-priority').mode).toBe('multiple');
});

test('multiple selection drafts, cancel, clear and apply',async({page})=>{
 await mount(page);
 await page.locator('#multi').click();
 let panel=page.getByRole('dialog',{name:'Фильтр: Команды'});
 await panel.getByRole('checkbox',{name:'Команда Б'}).check();
 await page.keyboard.press('Escape');
 await expect(page.locator('#multi')).toHaveValues(['a']);
 await page.locator('#multi').click();
 panel=page.getByRole('dialog',{name:'Фильтр: Команды'});
 await panel.getByRole('button',{name:'Очистить',exact:true}).click();
 await expect(page.locator('#multi')).toHaveValues(['a']);
 await panel.getByRole('button',{name:'Применить',exact:true}).click();
 await expect(page.locator('#multi')).toHaveValues([]);
 await page.evaluate(()=>document.querySelector('.filter-panel').insertAdjacentHTML('beforeend','<select id="async" aria-label="Новый"><option>Все</option><option>Новое</option></select>'));
 await expect(page.locator('#async')).toHaveClass(/ui-filter-select/);
 await page.locator('#async').click();
 await expect(page.getByRole('dialog',{name:'Фильтр: Новый'})).toBeVisible();
 await page.locator('#outside').click();
 await expect(page.getByRole('dialog')).toHaveCount(0);
});
