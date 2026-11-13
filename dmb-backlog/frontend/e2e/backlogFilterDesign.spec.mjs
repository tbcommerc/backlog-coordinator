import { test, expect, chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mockApp } from './helpers/backlogMock.mjs';

const evidence = 'artifacts/backlog-filters-2026-11-08';
async function ready(page, scope = 'all') {
  await page.goto(`/#/backlog?bv=2&scope=${scope}`);
  await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready', 'true');
}

for (const theme of ['light','dark']) test(`real browser zoom 200 percent ${theme}`, async ({}, info) => {
  const extension = info.outputPath('zoom-extension');
  mkdirSync(extension,{recursive:true});
  writeFileSync(`${extension}/manifest.json`,JSON.stringify({manifest_version:3,name:'Isolated filter zoom test',version:'1.0',permissions:['tabs'],background:{service_worker:'background.js'}}));
  writeFileSync(`${extension}/background.js`,'chrome.runtime.onInstalled.addListener(()=>{});');
  const context = await chromium.launchPersistentContext(info.outputPath('zoom-profile'), {
    channel:'chromium',headless:true,viewport:{width:1280,height:800},
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
  });
  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const page = context.pages()[0];
    await mockApp(page);
    await page.addInitScript(t => localStorage.setItem('dmb_theme',t),theme);
    await page.goto('http://127.0.0.1:4173/#/backlog?bv=2&scope=team');
    await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
    const initialDpr = await page.evaluate(() => devicePixelRatio);
    const zoom = await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({url:'http://127.0.0.1:4173/*'});
      if (tabs.length !== 1) throw Error('Expected one isolated test tab');
      await chrome.tabs.setZoom(tabs[0].id,2);
      return chrome.tabs.getZoom(tabs[0].id);
    });
    expect(zoom).toBe(2);
    await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(initialDpr * 2);
    await page.locator('#btn-ext-backlog').click();
    await expect(page.locator('#f-backlog-catalog-search')).toBeInViewport();
    await expect(page.locator('#f-backlog-ext-filters [data-key="id"]')).toBeInViewport();
    await expect(page.getByRole('button',{name:'Готово',exact:true})).toBeInViewport();
    // Full-page capture in Chromium at tab zoom crops the physical viewport.
    await page.screenshot({path:`${evidence}/fixture-after-${theme}-zoom200-team-catalog.png`,fullPage:false});
  } finally { await context.close(); }
});

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
    await page.setViewportSize({ width, height: width <= 390 ? 844 : width === 1366 ? 768 : 900 });
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
      else expect(new Set(boxes.map(b => b.y)).size).toBe(3);
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

for (const theme of ['light','dark']) test(`short viewport keeps catalog usable ${theme}`, async ({ page }) => {
  await mockApp(page);
  await page.setViewportSize({ width:1280, height:400 });
  await page.addInitScript(t => localStorage.setItem('dmb_theme',t),theme);
  await ready(page);
  await page.locator('#btn-ext-backlog').click();
  await expect(page.locator('#f-backlog-catalog-search')).toBeInViewport();
  await expect(page.locator('#f-backlog-ext-filters [data-key="id"]')).toBeInViewport();
  await expect(page.getByRole('button',{name:'Готово',exact:true})).toBeInViewport();
  await page.screenshot({path:`${evidence}/fixture-after-${theme}-short-catalog.png`,fullPage:true});
});

for (const theme of ['light','dark']) test(`long mobile values retain full names ${theme}`, async ({ page }) => {
  const { tasks } = await mockApp(page);
  const longName = 'Проект развития клиентского сервиса и внутренних процессов';
  tasks.forEach(task => { task.project_name = longName; });
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(t => localStorage.setItem('dmb_theme',t),theme);
  await ready(page);
  await page.locator('#f-backlog-main-filters [data-key="project_name"]').click();
  await page.locator('.filter-dropdown').getByText(longName,{exact:true}).click();
  await page.locator('.filter-dropdown .fd-apply').click();
  await expect(page.locator('#f-backlog-main-filters [data-key="project_name"]')).toHaveAttribute('aria-label',`Проект: ${longName}`);
  await expect(page.locator('#f-backlog-main-filters [data-key="project_name"]')).toHaveAttribute('title',`Проект: ${longName}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:`${evidence}/fixture-after-${theme}-390-long-page.png`,fullPage:true});
});
