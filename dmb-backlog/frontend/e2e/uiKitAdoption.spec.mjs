import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';

test('work picker preserves ID contract, reset, cancellation and teardown',async({page})=>{
  await page.goto('/ui-catalog/core.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(async()=>{
    const {field}=await import('/js/ui/primitives.js');
    const {mountWorkPicker}=await import('/js/components/workPicker.js');
    document.body.innerHTML='<form>'+field({id:'parent',label:'Parent',type:'number',value:1,attrs:{name:'parent_id'}})+'<button type="reset">Сбросить</button></form>';
    window.picker=mountWorkPicker(document.querySelector('#parent'),{api:{get:async()=>({items:[{id:2,public_id:'TASK-2',title:'Вторая задача'}]})}},{selected:'TASK-1 · Первая задача',label:'Родитель'});
  });
  const search=page.getByRole('searchbox',{name:'Родитель',exact:true}),choice=page.getByRole('combobox',{name:'Родитель: выбор'});
  await search.fill('Вторая');await search.press('Enter');await choice.selectOption('2');
  expect(await page.evaluate(()=>Object.fromEntries(new FormData(document.querySelector('form'))))).toEqual({parent_id:'2'});
  await page.getByRole('button',{name:'Сбросить',exact:true}).click();
  await expect(choice).toHaveValue('1');await expect(page.locator('#parent')).toHaveValue('1');
  await choice.selectOption('2');
  await page.evaluate(()=>{document.querySelector('#parent').value='1';window.picker.syncFromInput();});
  await expect(choice).toHaveValue('1');await expect(search).toHaveValue('TASK-1 · Первая задача');
  await page.evaluate(()=>window.picker.reset());await expect(choice).toHaveValue('');await expect(page.locator('#parent')).toHaveValue('');
  await page.getByRole('button',{name:'Сбросить',exact:true}).click();await expect(choice).toHaveValue('');await expect(page.locator('#parent')).toHaveValue('');
  await page.evaluate(()=>window.picker.destroy());await expect(page.locator('#parent')).toHaveAttribute('type','number');await expect(page.locator('.ui-entity-picker')).toHaveCount(0);
});

for (const theme of ['light','dark']) for (const width of [320,1440]) {
  test(`shared readonly consumers keep tokens and long values ${theme}/${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:900});
    await page.goto(`/e2e/fixtures/uiKitSettings.html?theme=${theme}#/settings?section=account`);
    await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
    await expect(page.locator('.settings-profile-list .ui-readonly-field')).toHaveCount(3);
    await page.evaluate(async()=>{
      const {descriptionList}=await import('/js/ui/detailComponents.js');
      const {renderRequestRevisionHistory}=await import('/js/components/requestPresentation.js');
      const sample=document.createElement('section');sample.id='adoption-sample';
      sample.innerHTML=descriptionList({items:[{label:'Эталон',value:0}]})+renderRequestRevisionHistory({revision_history:[{revision:1,draft:{title:'ОченьДлиннаяСтрока'.repeat(12),priority:0,problem_statement:'<img src=x onerror=alert(1)>'}}]});
      document.querySelector('.settings-panel').append(sample);sample.querySelector('details').open=true;
    });
    await expect(page.locator('#adoption-sample img')).toHaveCount(0);
    await expect(page.locator('#adoption-sample .ui-readonly-value').filter({hasText:'0'})).toHaveCount(2);
    const styles=await page.evaluate(()=>[...document.querySelectorAll('.settings-profile-list .ui-readonly-value, #adoption-sample .ui-readonly-value')].map(n=>{const s=getComputedStyle(n);return [s.fontSize,s.lineHeight,s.color];}));
    for(const style of styles)expect(style).toEqual(styles[0]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({path:info.outputPath('readonly-consumers.png'),fullPage:true});
  });
}

test('meeting range rejects reversed dates and keeps both corrected endpoints',async({page})=>{
  await page.goto('/e2e/fixtures/uiKitAdminReports.html?surface=meetings');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await expect(page.locator('#meeting-period')).toBeVisible();
  await page.locator('#meeting-period-from').fill('2026-10-20');
  await page.locator('#meeting-period-to').fill('2026-10-01');
  await expect(page.locator('#meeting-period-to')).toHaveAttribute('aria-invalid','true');
  await expect(page.getByRole('alert')).toContainText('Окончание периода');
  await page.locator('#meeting-period-from').fill('2026-09-01');
  await expect(page.locator('#meeting-period-from')).toHaveValue('2026-09-01');
  await expect(page.locator('#meeting-period-to')).toHaveValue('2026-10-01');
  await expect(page.locator('[data-ui-error-summary]')).toHaveCount(0);
  expect(await page.evaluate(()=>window.__blockedWrites)).toEqual([]);
});

test('admin audit range prevents invalid request and preserves correction',async({page})=>{
  await page.goto('/e2e/fixtures/uiKitAdminReports.html?admin_tab=audit');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.locator('#audit-date-from').fill('2026-10-20');
  await expect(page.locator('#audit-date-from')).toHaveValue('2026-10-20');
  await page.locator('#audit-date-to').fill('2026-10-01');
  await expect(page.locator('#audit-date-to')).toHaveAttribute('aria-invalid','true');
  await page.locator('#audit-date-from').fill('2026-09-01');
  await expect(page.locator('#audit-date-to')).toHaveValue('2026-10-01');
  await expect(page).toHaveURL(/admin_from=2026-09-01/);
  await expect(page).toHaveURL(/admin_to=2026-10-01/);
  expect(await page.evaluate(()=>window.__blockedWrites)).toEqual([]);
});

for (const scope of ['backlog','team']) test(`backlog ranges retain apply, cancel, bounds and clear: ${scope}`,async({page})=>{
  await mockApp(page);
  await page.goto('/#/'+(scope==='team'?'team-backlog':'backlog'));
  await page.locator(`#btn-ext-${scope}`).click();
  const progress=page.locator(`.filter-catalog-item [data-filter-key="progress"]`).getByRole('button').first();
  await progress.click();
  const popover=page.locator('.ui-filter-popover');
  await expect(popover.locator('.ui-interval')).toHaveCount(1);
  await popover.locator('.fd-min').fill('20');await popover.locator('.fd-max').fill('10');
  await popover.getByRole('button',{name:'Применить',exact:true}).click();
  await expect(popover.locator('.fd-error')).toBeVisible();
  await popover.locator('.fd-min').fill('-1');
  await popover.getByRole('button',{name:'Применить',exact:true}).click();
  await expect(popover).toBeVisible();
  await popover.locator('.fd-min').fill('0');await popover.locator('.fd-max').fill('100');
  await popover.getByRole('button',{name:'Применить',exact:true}).click();
  await expect(popover).toHaveCount(0);
  await progress.click();await expect(popover.locator('.fd-min')).toHaveValue('0');
  await popover.locator('.fd-min').fill('50');await page.keyboard.press('Escape');
  await progress.click();await expect(popover.locator('.fd-min')).toHaveValue('0');
  await popover.getByRole('button',{name:'Очистить',exact:true}).click();
  await popover.getByRole('button',{name:'Применить',exact:true}).click();
  await progress.click();await expect(popover.locator('.fd-min')).toHaveValue('');
});
