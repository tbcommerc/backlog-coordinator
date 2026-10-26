import { test, expect } from '@playwright/test';

test('quarterly: navigation waits for saving and preserves failed draft on cancel',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitReportingWorkspaces.html?surface=quarterly&deferred=1');
 const range=page.locator('[data-quarterly-progress="1"]');await range.focus();await range.press('ArrowRight');
 expect(await page.evaluate(async()=>{const m=await import('/js/components/quarterlyGoalsUpdate.js');return m.confirmQuarterlyGoalsNavigation();})).toBe(false);
 await page.evaluate(()=>window.__releaseSave(409));
 await expect(page.locator('[data-quarterly-save-state="1"]')).toContainText('уже изменились');
 await page.evaluate(async()=>{const m=await import('/js/components/quarterlyGoalsUpdate.js');window.__navigationResult=m.confirmQuarterlyGoalsNavigation();});
 await page.getByRole('alertdialog').getByRole('button',{name:'Отмена',exact:true}).click();
 expect(await page.evaluate(()=>window.__navigationResult)).toBe(false);await expect(range).toHaveValue('30');
 await page.evaluate(async()=>{const m=await import('/js/components/quarterlyGoalsUpdate.js');window.__navigationResult=m.confirmQuarterlyGoalsNavigation();});
 await page.getByRole('alertdialog').getByRole('button',{name:'Перейти',exact:true}).click();
 expect(await page.evaluate(()=>window.__navigationResult)).toBe(true);
});

for(const theme of ['light','dark'])for(const compact of [false,true]) {
 test(`weekly required fields and pending save ${theme}/${compact}`,async({page})=>{
  await page.setViewportSize({width:390,height:900});
  await page.goto(`/e2e/fixtures/uiKitReportingWorkspaces.html?weekly=1&deferred=1&theme=${theme}&compact=${compact}`);
  const save=page.locator('[data-save-reporting-task="1"]');
  const next=page.locator('[data-reporting-weekly-next="1"]');
  await expect(save).toBeDisabled();await next.fill('Проверить отчёт');await expect(save).toBeEnabled();
  await page.locator('[data-reporting-weekly-signal="1"]').selectOption('decision');
  await expect(save).toBeDisabled();
  await page.locator('[data-reporting-weekly-decision="1"]').fill('Согласовать дату');
  await save.click();await expect(next).toBeDisabled();
  await expect(page.locator('[data-confirm-reporting-all]')).toBeDisabled();
  await expect(page.locator('[data-reporting-meeting="61"]')).toBeDisabled();
  expect(await page.evaluate(()=>window.__writes.length)).toBe(1);
  await page.evaluate(()=>window.__releaseSave(409));
  await expect(page.locator('[data-reporting-error="1"]')).toContainText('уже изменён');
  await expect(next).toBeEnabled();await expect(next).toHaveValue('Проверить отчёт');
  await expect(save).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 });
}

test('statuses: failed bulk confirmation retains draft and retries batch',async({page})=>{
  await page.goto('/e2e/fixtures/uiKitReportingWorkspaces.html?surface=statuses');
  const text=page.locator('[data-reporting-text="1"]');
  await text.fill('Готово к встрече');
  await page.evaluate(()=>{window.__failSave=true;});
  const confirm=page.locator('[data-confirm-reporting-all]');
  await confirm.click();
  await expect(page.locator('[data-reporting-dirty]')).toHaveText('Не сохранено: 1');
  await expect(text).toHaveValue('Готово к встрече');await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator('[data-reporting-task="1"]')).toHaveAttribute('data-version','2');
  await expect(page.locator('[data-save-reporting-all]')).toBeDisabled();
  const writes=await page.evaluate(()=>window.__writes);
  expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);
  expect(writes[1].path).toBe('/reporting-meetings/61/statuses/batch');
  expect(writes[1].body.items[0]).toMatchObject({task_id:1,text:'Готово к встрече',is_ready:true,version:1});
});

test('quarterly: queued changes, failed predecessor and undo use latest version',async({page})=>{
  await page.goto('/e2e/fixtures/uiKitReportingWorkspaces.html?surface=quarterly&deferred=1');
  const range=page.locator('[data-quarterly-progress="1"]');
  const status=page.locator('[data-quarterly-save-state="1"]');
  const retry=page.locator('[data-quarterly-retry="1"]');
  await range.focus();await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(()=>window.__writes.map(write=>write.body.progress))).toEqual([30]);
  await page.evaluate(()=>window.__releaseSave(500));
  await expect.poll(()=>page.evaluate(()=>window.__writes.length)).toBe(2);
  await expect(status).toContainText('Сохраняем');await expect(retry).toBeHidden();
  await expect(range).toHaveValue('40');
  await page.evaluate(()=>window.__releaseSave());
  await expect(status).toHaveText('Сохранено');await expect(retry).toBeHidden();
  await page.locator('[data-quarterly-undo="1"]').click();
  await expect.poll(()=>page.evaluate(()=>window.__writes.length)).toBe(3);
  expect(await page.evaluate(()=>window.__writes.map(write=>write.body))).toEqual([
    {progress:30,start_shift_id:1,version:1},{progress:40,start_shift_id:1,version:1},{progress:25,start_shift_id:1,version:2}
  ]);
  await page.evaluate(()=>window.__releaseSave());
  await expect(status).toHaveText('Сохранено');await expect(range).toHaveValue('25');
});

test('statuses: dirty navigation traps focus, cancels with Escape and restores selected tab',async({page})=>{
  await page.goto('/e2e/fixtures/uiKitReportingWorkspaces.html?surface=statuses');
  const text=page.locator('[data-reporting-text="1"]');
  await text.fill('Черновик перед переключением');
  const next=page.locator('[data-reporting-meeting="62"]');
  await next.click();
  const dialog=page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button',{name:'Перейти',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  await expect(next).toBeFocused();await expect(text).toHaveValue('Черновик перед переключением');
  await next.click();await dialog.getByRole('button',{name:'Перейти',exact:true}).click();
  await expect(next).toHaveAttribute('aria-selected','true');await expect(next).toBeFocused();
  await expect(text).toHaveValue('Исходный статус');
  expect(await page.evaluate(()=>window.__writes)).toEqual([]);
});

for(const surface of ['statuses','quarterly']) for(const theme of ['light','dark']) for(const mode of ['desktop','compact','mobile','touch']) {
  test(`${surface}: controls, drafts and retry ${theme}/${mode}`,async({browser})=>{
    const context=await browser.newContext({viewport:{width:mode==='mobile'?390:1280,height:900},hasTouch:mode==='touch'});
    const page=await context.newPage();
    await page.goto(`/e2e/fixtures/uiKitReportingWorkspaces.html?surface=${surface}&theme=${theme}&compact=${mode==='compact'}`);
    await expect(page.locator('html')).toHaveAttribute('data-ready','true');
    const close=page.locator('.reporting-status-close');const box=await close.boundingBox();
    expect(box.width).toBe(box.height);expect(box.height).toBe(mode==='mobile'||mode==='touch'?44:mode==='compact'?36:40);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const search=page.locator('input[type="search"]');
    expect((await search.boundingBox()).height).toBe(mode==='mobile'||mode==='touch'?44:mode==='compact'?28:32);
    await page.evaluate(()=>{window.__failSave=true;});
    if(surface==='statuses'){
      const text=page.locator('[data-reporting-text="1"]');await text.fill('Сохранённый черновик после ошибки');
      const save=page.locator('[data-save-reporting-task="1"]');await save.click();
      await expect(page.locator('[data-reporting-error="1"]')).toContainText('Проверочная ошибка');
      await expect(text).toHaveValue('Сохранённый черновик после ошибки');await expect(save).toBeEnabled();
      await save.click();await expect(page.locator('[data-reporting-task="1"]')).toHaveAttribute('data-version','2');
    }else{
      const range=page.locator('[data-quarterly-progress="1"]');await range.focus();await page.keyboard.press('ArrowRight');
      await expect(page.locator('[data-quarterly-save-state="1"]')).toContainText('Проверочная ошибка');
      await expect(range).toHaveValue('30');
      await page.locator('[data-quarterly-retry="1"]').click();
      await expect(page.locator('[data-quarterly-save-state="1"]')).toHaveText('Сохранено');
      await expect(range).toHaveValue('30');
    }
    await search.fill('Нет совпадений');
    await expect(page.locator(surface==='statuses'?'.view-state-empty':'.quarterly-update-empty')).toBeVisible();
    await search.fill('Длинное');
    await expect(page.locator(surface==='statuses'?'[data-reporting-task="1"]':'[data-quarterly-task="1"]')).toBeVisible();
    if(surface==='quarterly') {
      const geometry=await page.locator('.quarterly-update-card-head').evaluate(head=>{
        const title=head.querySelector('.reporting-task-link').getBoundingClientRect(),meta=head.querySelector('.quarterly-update-card-identity > small').getBoundingClientRect();
        return {titleBottom:title.bottom,metaTop:meta.top,metaBottom:meta.bottom,headBottom:head.getBoundingClientRect().bottom};
      });
      expect(geometry.titleBottom).toBeLessThanOrEqual(geometry.metaTop);expect(geometry.metaBottom).toBeLessThanOrEqual(geometry.headBottom);
    }
    await page.screenshot({path:test.info().outputPath('workspace.png')});
    const writes=await page.evaluate(()=>window.__writes);expect(writes).toHaveLength(2);
    for(const {body} of writes)expect(Object.keys(body).some(key=>/user|role|team/i.test(key))).toBe(false);
    await context.close();
  });
}
for(const surface of ['statuses','quarterly']) {
  test(`${surface}: loading settles into empty state`,async({page})=>{
    await page.goto(`/e2e/fixtures/uiKitReportingWorkspaces.html?surface=${surface}&loading=1&empty=1`,{waitUntil:'commit'});
    await expect(page.locator('.view-state-loading')).toBeVisible();
    await expect(page.locator('.view-state-loading')).toHaveAttribute('aria-busy','true');
    await page.evaluate(()=>window.__releaseLoad());
    await expect(page.locator('html')).toHaveAttribute('data-ready','true');
    await expect(page.locator(surface==='statuses'?'.view-state-empty':'.quarterly-update-empty')).toBeVisible();
  });
  test(`${surface}: readonly and load error`,async({page})=>{
    await page.goto(`/e2e/fixtures/uiKitReportingWorkspaces.html?surface=${surface}&readonly=1`);
    await expect(page.locator(surface==='statuses'?'[data-reporting-text="1"]':'[data-quarterly-progress="1"]')).toBeDisabled();
    expect(await page.evaluate(()=>window.__writes)).toEqual([]);
    await page.goto(`/e2e/fixtures/uiKitReportingWorkspaces.html?surface=${surface}&error=1`);
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить');
  });
}
