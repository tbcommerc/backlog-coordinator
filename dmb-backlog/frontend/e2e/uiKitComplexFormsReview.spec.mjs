import { test, expect } from '@playwright/test';

test('late search results cannot populate a different resolution mode',async({page})=>{
  await open(page);await page.locator('#wr-decision').selectOption('link_work');
  await page.evaluate(()=>{window.__holdSearch=true;});
  const search=page.locator('[data-search]');await search.click();
  await expect(search).toHaveAttribute('aria-busy','true');
  await page.locator('#wr-decision').selectOption('link_major');
  await expect(search).toBeEnabled();await expect(search).not.toHaveAttribute('aria-busy');
  await page.evaluate(()=>{window.__holdSearch=false;window.__releaseSearch();});
  await expect(page.locator('[data-results]')).toBeEmpty();await expect(page.locator('#wr-target')).toHaveValue('');
  await search.click();await expect(page.locator('[data-results] [data-target="11"]')).toBeVisible();
});

async function open(page, theme='light') {
  await page.goto('/e2e/fixtures/workResolution.html?theme='+theme);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.locator('#open-resolution').click();
  await expect(page.getByRole('dialog',{name:'Разместить запрос',exact:true})).toBeVisible();
}

for(const theme of ['light','dark'])for(const [width,height] of [[1440,900],[768,600],[320,568],[640,360]])
test(`resolution modes remain usable on short screens: ${theme}/${width}x${height}`,async({page},testInfo)=>{
  await page.setViewportSize({width,height});await open(page,theme);
  const dialog=page.getByRole('dialog'),submit=dialog.locator('[type=submit]');
  for(const decision of ['create_work','create_major','link_work','link_major']){
    await page.locator('#wr-decision').selectOption(decision);
    const box=await dialog.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y+box.height).toBeLessThanOrEqual(height);
    expect(await dialog.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
    await expect(submit).toBeInViewport({ratio:1});
    await expect(page.locator('#wr-target')).toHaveJSProperty('required',decision.startsWith('link'));
    for(const field of await dialog.locator('input:visible,select:visible,textarea:visible').all()){
      await field.scrollIntoViewIfNeeded();await expect(field).toBeInViewport();
      const r=await field.boundingBox();expect(r.x).toBeGreaterThanOrEqual(box.x);expect(r.x+r.width).toBeLessThanOrEqual(box.x+box.width);
      if(width<=640)expect(r.height).toBeGreaterThanOrEqual(44);
    }
    await expect(submit).toBeInViewport({ratio:1});
  }
  await page.locator('#wr-decision').selectOption('create_work');
  await expect(page.locator('#wr-project')).toBeHidden();await expect(page.locator('#wr-parent')).toBeHidden();
  await page.locator('#wr-placement').selectOption('project');await expect(page.locator('#wr-project')).toBeVisible();await expect(page.locator('#wr-parent')).toBeHidden();
  await expect(page.locator('#wr-project')).toHaveJSProperty('required',true);
  await submit.focus();await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'Закрыть',exact:true})).toBeFocused();
  await page.screenshot({path:testInfo.outputPath('resolution.png')});
  await page.keyboard.press('Escape');
  const discard=page.getByRole('alertdialog');await expect(discard).toBeVisible();
  if(width===320)await page.screenshot({path:testInfo.outputPath('discard.png')});
  const prompt=await discard.boundingBox();expect(prompt.x).toBeGreaterThanOrEqual(0);expect(prompt.y).toBeGreaterThanOrEqual(0);
  expect(prompt.x+prompt.width).toBeLessThanOrEqual(width);expect(prompt.y+prompt.height).toBeLessThanOrEqual(height);
  for(const control of await discard.getByRole('button').all())await expect(control).toBeInViewport({ratio:1});
  await discard.getByRole('button',{name:'Продолжить редактирование',exact:true}).click();
  await expect(page.locator('#wr-placement')).toHaveValue('project');
  await page.keyboard.press('Escape');await page.getByRole('alertdialog').getByRole('button',{name:'Закрыть без сохранения',exact:true}).click();
  await expect(dialog).toHaveCount(0);await expect(page.locator('#open-resolution')).toBeFocused();
  expect(await page.evaluate(()=>window.__writes)).toEqual([]);
});

test('resolution validation, busy lock and failed save preserve the editable draft',async({page})=>{
  await page.setViewportSize({width:320,height:568});await open(page,'dark');
  await page.locator('#wr-decision').selectOption('link_work');
  const submit=page.locator('dialog [type=submit]');
  await submit.click();expect(await page.evaluate(()=>window.__writes.length)).toBe(0);
  await expect(page.locator('#wr-target')).toBeFocused();
  await page.locator('#wr-target').fill('11');await page.locator('#wr-scope').fill('Сохранённая потребность');
  await page.evaluate(()=>{window.__hold=true;window.__fail=true;});await submit.click();
  await expect(submit).toHaveAttribute('aria-busy','true');await expect(submit).toBeDisabled();
  await expect(page.locator('#wr-scope')).toBeDisabled();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(()=>document.querySelector('dialog form').requestSubmit());
  expect(await page.evaluate(()=>window.__writes.length)).toBe(1);
  await page.evaluate(()=>{window.__hold=false;window.__release();});
  const error=page.locator('[data-error]');await expect(error).toContainText('Версия изменилась');await expect(error).toBeFocused();await expect(error).toBeInViewport();
  await expect(page.locator('#wr-scope')).toHaveValue('Сохранённая потребность');await expect(submit).toBeEnabled();await expect(submit).not.toHaveAttribute('aria-busy');
  await submit.click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const writes=await page.evaluate(()=>window.__writes);expect(writes).toHaveLength(2);expect(writes[0].body).toEqual(writes[1].body);expect(writes[0].options.idempotencyKey).toBe(writes[1].options.idempotencyKey);
});

test('fulfillment read retry and readonly state; save failure retains text and prevents duplicates',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('/e2e/fixtures/workResolution.html?theme=dark');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(async()=>{window.__readFail=true;await window.__showFulfillment();});
  await expect(page.getByRole('heading',{name:'Не удалось загрузить результат запроса'})).toBeVisible();
  await page.getByRole('button',{name:'Повторить',exact:true}).click();
  const input=page.locator('#fulfillment-result'),submit=page.locator('#fulfillment [type=submit]');
  await input.fill('Подтверждённый результат');
  await page.evaluate(()=>{window.__hold=true;window.__fail=true;});await submit.click();
  await expect(submit).toBeDisabled();await expect(submit).toHaveAttribute('aria-busy','true');await expect(input).toBeDisabled();
  await page.evaluate(()=>document.querySelector('#fulfillment form').requestSubmit());
  expect(await page.evaluate(()=>window.__writes.length)).toBe(1);
  await page.evaluate(()=>{window.__hold=false;window.__release();});
  await expect(page.locator('#fulfillment [role=alert]')).toBeFocused();await expect(input).toHaveValue('Подтверждённый результат');await expect(submit).toBeEnabled();
  await submit.click();await expect(page.getByText('Результат запроса подтверждён',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__writes.length)).toBe(2);
  await page.evaluate(()=>window.__showFulfillment(false));await expect(page.locator('#fulfillment form')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});

for(const decision of ['create_work','create_major','link_work','link_major'])
test(`resolution sends only the selected mode: ${decision}`,async({page})=>{
  await page.setViewportSize({width:320,height:568});await open(page,'dark');
  await page.locator('#wr-decision').selectOption(decision);
  if(decision==='create_work'){
    await page.locator('#wr-placement').selectOption('project');await page.locator('#wr-project').selectOption('3');
  }else if(decision==='create_major'){
    await page.locator('#wr-type').selectOption('1');await page.locator('#wr-channel').selectOption('1');
  }else{
    await page.getByRole('button',{name:'Найти',exact:true}).click();
    const result=page.locator('[data-results] [data-target="11"]');await expect(result).toBeVisible();await result.click();
    await expect(page.locator('#wr-target')).toHaveValue('11');
    expect(await page.getByRole('dialog').evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.locator('#wr-scope').fill('Проверенная потребность');
  await page.getByRole('button',{name:'Подтвердить размещение',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const writes=await page.evaluate(()=>window.__writes);expect(writes).toHaveLength(1);
  const body=writes[0].body;expect(body.decision).toBe(decision);expect(body.version).toBe(4);
  if(decision==='create_work'){expect(body.work.direct_project_id).toBe(3);expect(body).not.toHaveProperty('major');}
  else if(decision==='create_major'){expect(body.major.task_type_id).toBe(1);expect(body).not.toHaveProperty('work');}
  else{expect(body.target_id).toBe(11);expect(body).not.toHaveProperty('work');expect(body).not.toHaveProperty('major');}
});
