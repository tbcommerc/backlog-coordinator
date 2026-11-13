import { test, expect } from '@playwright/test';
import { mockApp } from './helpers/backlogMock.mjs';

for (const theme of ['light','dark']) test(`pinned hover stays opaque ${theme}`, async ({page},info)=>{
  await mockApp(page,{count:25});
  await page.setViewportSize({width:1366,height:768});
  await page.addInitScript(t=>localStorage.setItem('dmb_theme',t),theme);
  await page.goto('/#/backlog?scope=all');
  await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
  await page.locator('#backlog-btn-column-settings').click();
  await page.locator('#backlog-col-select-all').click();
  await page.getByRole('button',{name:'Закрыть настройки колонок'}).click();
  const row=page.locator('#tasks-table tbody tr').nth(2);
  const id=row.locator('.table-pinned-id');
  await id.hover();
  const initial=await id.boundingBox();
  await page.locator('#tasks-container .table-container').evaluate(el=>{el.scrollLeft=230;});
  await expect.poll(async()=>Math.abs((await id.boundingBox()).x-initial.x)).toBeLessThan(1);
  await page.screenshot({path:info.outputPath('full-page.png'),fullPage:true});
  // Pinned pixels must not depend on the text sliding underneath them.
  const first=await id.screenshot();
  await page.locator('#tasks-container .table-container').evaluate(el=>{el.scrollLeft=310;});
  await page.waitForTimeout(250);
  const second=await id.screenshot();
  expect(first.equals(second),'Pinned cell must fully cover moving content while hovered').toBe(true);
});
