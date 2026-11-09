import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { mockApp } from './helpers/backlogMock.mjs';

const evidence = 'artifacts/backlog-filters-2026-11-08';
async function ready(page, scope = 'all') {
  await page.goto(`/#/backlog?bv=2&scope=${scope}`);
  await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready', 'true');
}

test('custom pins persist after reload, stay independent by scope, and reset without clearing conditions', async ({ page }) => {
  await mockApp(page);
  await page.setViewportSize({ width:1440, height:900 });
  await ready(page);
  const pins = page.locator('#f-backlog-main-filters [data-filter-key]');
  const keys = () => pins.evaluateAll(es => es.map(e => e.dataset.filterKey));
  const original = ['status_name','priority_name','team_name','deadline_name','project_name'];
  expect(await keys()).toEqual(original);
  await page.locator('#btn-ext-backlog').click();
  await page.locator('[data-pin-filter="project_name"]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-pin-filter="project_name"]')).toBeFocused();
  await expect(page.locator('#f-backlog-pin-count')).toHaveText('На панели: 4 из 5');
  await page.locator('[data-pin-filter="owner_name"]').click();
  await page.keyboard.press('Escape');
  const custom = [...original.slice(0,4), 'owner_name'];
  expect(await keys()).toEqual(custom);
  await page.reload();
  await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
  expect(await keys()).toEqual(custom);
  await page.locator('#f-backlog-search').fill('Первая');
  await expect(page.locator('#tasks-table tr[data-task-id]')).toHaveCount(1);
  await page.locator('#btn-ext-backlog').click();
  await page.locator('[data-reset-pinned-filters]').click();
  await page.getByRole('button',{ name:'Готово', exact:true }).click();
  expect(await keys()).toEqual(original);
  await expect(page.locator('#f-backlog-search')).toHaveValue('Первая');
  await page.locator('[data-backlog-scope="team"]').click();
  await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
  expect(await keys()).toEqual(['status_name','priority_name','deadline_name','owner_name','task_type_name']);
  await page.locator('#btn-ext-backlog').click();
  await expect(page.locator('.ui-filter-catalog-context')).toContainText('Продукт');
  await expect(page.locator('#f-backlog-ext-filters [data-key="team_name"]')).toHaveCount(0);
});
for (const theme of ['light', 'dark']) for (const width of [1440, 1366, 390, 320]) {
  test(`filter composition ${theme} ${width}`, async ({ page }) => {
    await mockApp(page, { count: 25 });
    await page.setViewportSize({ width, height: width === 1366 ? 768 : 900 });
    await page.addInitScript(t => localStorage.setItem('dmb_theme', t), theme);
    await ready(page);
    mkdirSync(evidence, { recursive: true });
    const phase = process.env.FILTER_DESIGN_BEFORE ? 'fixture-before' : 'fixture-after';
    await page.screenshot({ path: `${evidence}/${phase}-${theme}-${width}-page.png`, fullPage: true });
    if (!process.env.FILTER_DESIGN_BEFORE) {
      const pins = page.locator('#f-backlog-main-filters .filter-btn');
      await expect(pins).toHaveCount(5);
      await expect(pins.first()).toBeVisible();
      const search = await page.locator('#f-backlog-search').boundingBox();
      const boxes = await pins.evaluateAll(es => es.map(e => { const r = e.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width }; }));
      expect(boxes.every(b => b.y >= search.y + search.height)).toBe(true);
      if (width >= 1280) expect(new Set(boxes.map(b => b.y)).size).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
    await page.locator('#btn-ext-backlog').click();
    await page.screenshot({ path: `${evidence}/${phase}-${theme}-${width}-catalog.png`, fullPage: true });
    if (process.env.FILTER_DESIGN_BEFORE) return;
    await expect(page.locator('#f-backlog-pin-count')).toHaveText('На панели: 5 из 5');
    await page.locator('#f-backlog-catalog-search').fill('несуществующий фильтр');
    await expect(page.locator('#f-backlog-catalog-empty')).toBeVisible();
    await page.locator('#f-backlog-catalog-search').fill('приоритет');
    await page.locator('#f-backlog-ext-filters [data-key="priority_name"]').click();
    await page.screenshot({ path: `${evidence}/${phase}-${theme}-${width}-value.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.locator('#f-backlog-ext-filters [data-key="priority_name"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#btn-ext-backlog')).toBeFocused();
  });
}
