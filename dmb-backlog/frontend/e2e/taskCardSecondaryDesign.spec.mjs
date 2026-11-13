import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('artifacts/task-card-secondary-2026-11-11');
for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
  test(`secondary tabs ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({width, height:width===1440?960:844});
    await page.goto(`/e2e/fixtures/taskCardIncrement.html?theme=${theme}&profile=proposal#/tasks?task=42`);
    await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
    await mkdir(output,{recursive:true});
    for (const tab of ['rep','com','sys','log','work']) {
      await page.locator(`#task-tab-${tab}`).click();
      await expect(page.locator(`#task-tab-${tab}`)).toHaveAttribute('aria-selected','true');
      await expect(page.locator('#mbody')).toHaveAttribute('aria-labelledby',`task-tab-${tab}`);
      if(tab==='rep') await expect(page.locator('.ui-task-report')).toHaveCount(3);
      if(tab==='com') await expect(page.locator('#comment-textarea')).toBeVisible();
      if(tab==='sys') {
        await expect(page.locator('#mbody')).toContainText('Материалы и требования');
        await expect(page.locator('#attachments-list-container')).toContainText('Требования к статусам заявки.pdf');
        expect(await page.locator('#attachments-list-container').evaluate(el=>!!(el.compareDocumentPosition(document.querySelector('#attachment-drop-zone'))&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
      }
      if(tab==='work') {
        await expect(page.locator('#work-42-search')).toBeVisible();
        await expect(page.locator('#task-work-list button[type=submit]')).toHaveCount(0);
        await expect(page.locator('#task-work-list [data-work-action=toggle-search]')).toBeHidden();
        await expect(page.locator('.ui-task-work-row')).toHaveCount(3);
        await expect(page.locator('#task-work-list table')).toHaveCount(0);
      }
      if(tab==='log') { await expect(page.locator('.ui-task-history-item')).toHaveCount(5); await expect(page.locator('#mbody table')).toHaveCount(0); }
      const overflow = await page.locator('#mbody').evaluate(el=>el.scrollWidth>el.clientWidth+1);
      expect(overflow).toBe(false);
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:resolve(output,`${tab}-${theme}-${width}.png`)});
    }
  });
}

test('reporting editor preserves cancel/save and files have one picker action', async ({page}) => {
  await page.goto('/e2e/fixtures/taskCardIncrement.html?profile=proposal#/tasks?task=42');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.locator('#task-tab-rep').click();
  await page.locator('[data-action="edit-reporting-status"]').first().click();
  await page.locator('[data-reporting-text]').fill('Черновик для проверки');
  await expect(page.locator('.ui-task-report.is-dirty')).toContainText('Черновик');
  await page.locator('[data-action="cancel-reporting-status"]').click();
  await expect(page.locator('[data-reporting-text]')).toHaveCount(0);
  await expect(page.locator('#mbody')).not.toContainText('Черновик для проверки');
  await page.locator('[data-action="edit-reporting-status"]').first().click();
  await page.locator('[data-reporting-text]').fill('Статус сохранён явно');
  await page.locator('[data-action="save-reporting-status"]').click();
  await expect(page.locator('[data-reporting-text]')).toHaveCount(0);
  await expect(page.locator('#mbody')).toContainText('Статус сохранён явно');
  expect(await page.evaluate(()=>window.__apiCalls.filter(([method])=>method==='put').length)).toBe(1);
  await page.locator('#task-tab-sys').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Добавить файлы',exact:true}).click();
  await chooser;
});

test('linked work list filters and placement/external forms remain reachable', async ({page}) => {
  await page.goto('/e2e/fixtures/taskCardIncrement.html?profile=proposal#/tasks?task=42');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.locator('#task-tab-work').click();
  await expect(page.locator('.ui-task-work-row')).toHaveCount(3);
  await expect(page.locator('[data-task-work-count]')).toContainText('3 рабочие задачи');
  await page.locator('#work-42-search').fill('недоступности');
  await expect(page.locator('.ui-task-work-row')).toHaveCount(1);
  await expect(page.locator('[data-task-work-count]')).toContainText('1 рабочая задача');
  await page.locator('#work-42-search').fill('нет такого названия');
  await expect(page.locator('#task-work-list')).toContainText('По запросу ничего не найдено');
  await page.getByRole('button',{name:'Сбросить поиск',exact:true}).click();
  await expect(page.locator('.ui-task-work-row')).toHaveCount(3);
  await page.getByRole('button',{name:'Привязать',exact:true}).click();
  await expect(page.locator('[data-placement]')).toBeVisible();
  await page.locator('[data-task-external-toggle]').click();
  await expect(page.locator('[data-external-form]')).toBeVisible();
});

test('history distinguishes numeric and string zero from missing values', async ({page}) => {
  await page.goto('/e2e/fixtures/taskCardIncrement.html?profile=proposal#/tasks?task=42');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await page.evaluate(() => {
    window.__taskCardFixture.history.splice(0, Infinity, ...[
      [0, 47], [47, 0], ['0', '47'], ['47', '0'], [47, null], [47, '']
    ].map(([old_value,new_value],i) => ({id:100+i,field_name:'progress',field_label:`Переход ${i}`,old_value,new_value,changed_at:'2026-11-11T10:00:00Z',changed_by_name:'QA'})));
  });
  await page.locator('#task-tab-log').click();
  for (const i of [0,2]) {
    const row=page.locator('.ui-task-history-item').filter({hasText:`Переход ${i}`});
    await expect(row.locator('del')).toHaveText('0');
    await expect(row.locator('.ui-task-history-change > span')).toHaveText('47');
  }
  for (const i of [1,3,4,5]) {
    const row=page.locator('.ui-task-history-item').filter({hasText:`Переход ${i}`});
    await expect(row.locator('del')).toHaveText('47');
    await expect(row.locator('.ui-task-history-change > span')).toHaveText(i<4?'0':'Не указано');
  }
  const states=resolve('artifacts/task-card-states-2026-11-11');
  await mkdir(states,{recursive:true});
  await page.screenshot({path:resolve(states,'history-zero-null.png')});
});
