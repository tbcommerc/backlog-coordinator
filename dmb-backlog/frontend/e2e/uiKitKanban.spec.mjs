import { test, expect } from '@playwright/test';

test('readonly kanban cannot move tasks by menu or drag',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitComposites.html?surface=kanban&readonly=1');
 await expect(page.locator('[data-kanban-status="1"]')).toBeDisabled();
 await expect(page.locator('.task-card[data-id="1"]')).toHaveAttribute('draggable','false');
 expect(await page.evaluate(()=>window.__writes)).toEqual([]);
});

test('keyboard status menu serializes save, restores focus and rolls back failure',async({page})=>{
 await page.goto('/e2e/fixtures/uiKitComposites.html?surface=kanban');
 const trigger=page.locator('[data-kanban-status="1"]');await trigger.focus();await trigger.press('ArrowDown');
 const menu=page.getByRole('menu',{name:'Переместить задачу'});await expect(menu).toBeVisible();
 await page.evaluate(()=>{window.__holdMove=true;});
 await menu.getByRole('menuitem',{name:'НАЗНАЧЕНА КОМАНДА',exact:true}).click();await expect(trigger).toBeDisabled();
 await expect(page.locator('.task-card[data-id="1"]')).toHaveAttribute('aria-busy','true');
 await page.evaluate(()=>{window.__holdMove=false;window.__releaseMove();});
 await expect(trigger).toBeEnabled();await expect(trigger).toBeFocused();
 await expect(page.locator('.kanban-column-body[data-status="НАЗНАЧЕНА КОМАНДА"] .task-card')).toHaveCount(1);
 await trigger.press('ArrowDown');await page.evaluate(()=>{window.__failMove=true;});
 await menu.getByRole('menuitem',{name:'СБОР ТРЕБОВАНИЙ',exact:true}).click();
 await expect(page.locator('.kanban-column-body[data-status="НАЗНАЧЕНА КОМАНДА"] .task-card')).toHaveCount(1);await expect(trigger).toBeFocused();
 expect(await page.evaluate(()=>window.__writes)).toEqual([{path:'/tasks/1',body:{status_id:2,version:1}},{path:'/tasks/1',body:{status_id:3,version:2}}]);
 await trigger.press('ArrowDown');await page.evaluate(()=>{window.__failKanban=true;});
 await menu.getByRole('menuitem',{name:'СБОР ТРЕБОВАНИЙ',exact:true}).click();
 await expect(page.locator('.kanban-column-body[data-status="СБОР ТРЕБОВАНИЙ"] .task-card')).toHaveCount(1);await expect(trigger).toBeFocused();
 await trigger.press('ArrowDown');await menu.getByRole('menuitem',{name:'ПРОВЕРКА ТРЕБОВАНИЙ',exact:true}).click();
 await expect(trigger).toBeFocused();
 expect(await page.evaluate(()=>window.__writes.at(-1).body)).toEqual({status_id:4,version:3});
});

for (const theme of ['light','dark']) for (const mode of ['desktop','compact','mobile','touch']) {
  test(`kanban controls, statuses and overflow: ${theme}/${mode}`,async({browser})=>{
    const context=await browser.newContext({viewport:{width:mode==='mobile'?390:1280,height:800},hasTouch:mode==='touch'});
    const page=await context.newPage();
    await page.goto(`/e2e/fixtures/uiKitComposites.html?surface=kanban&theme=${theme}&compact=${mode==='compact'}`);
    await expect(page.locator('html')).toHaveAttribute('data-ready','true');
    await expect(page.locator('#kanban-state')).toBeHidden();
    await expect(page.locator('.kanban-column')).toHaveCount(13);
    await expect(page.locator('.kanban-column .task-card')).toHaveCount(2);
    await expect(page.locator('.kanban-column .ui-badge').first()).toHaveText('1');
    await expect(page.locator('.kanban-column .view-state-empty')).toHaveCount(11);
    const button=page.getByRole('button',{name:'Добавить задачу',exact:true});
    const bounds=await button.boundingBox();
    expect(bounds.height).toBe(mode==='mobile'||mode==='touch'?44:mode==='compact'?28:32);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const board=page.locator('#kanban-board');
    expect(await board.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
    await expect(page.locator('.kanban-column').first()).toHaveAttribute('data-ui-tone','info');
    await page.screenshot({path:test.info().outputPath('kanban.png')});
    expect(await page.evaluate(()=>window.__writes)).toEqual([]);
    await context.close();
  });
}
test('kanban error retries and empty state is explicit',async({page})=>{
  await page.goto('/e2e/fixtures/uiKitComposites.html?surface=kanban&fail=1&empty=1');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить канбан');
  await expect(page.locator('#kanban-board')).toBeHidden();
  await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await expect(page.locator('#kanban-board')).toBeVisible();
  await expect(page.locator('.kanban-column .view-state-empty')).toHaveCount(13);
  await expect(page.locator('.task-card')).toHaveCount(0);
  await expect(page.locator('#kanban-board i[data-lucide]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Добавить задачу',exact:true})).toBeEnabled();
});
