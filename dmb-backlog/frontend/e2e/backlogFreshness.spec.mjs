import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { mockApp } from './helpers/backlogMock.mjs';

const out = 'artifacts/backlog-freshness-2026-11-09';
for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`freshness warning ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApp(page, { count: 130 });
    await page.addInitScript(t => localStorage.setItem('dmb_theme', t), theme);
    await page.goto('/#/backlog?bv=2&scope=all');
    await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('#tasks-count')).toContainText('130');
    let fail = true;
    let release;
    await page.route('**/api/v1/tasks/?**', async route => {
      if (fail) return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
      await new Promise(resolve => { release = resolve; });
      return route.fallback();
    });
    await page.locator('#backlog-btn-refresh').click();
    const notice = page.locator('#backlog-stale');
    await expect(notice).toBeVisible();
    await mkdir(out, { recursive: true });
    await page.screenshot({ path: `${out}/${process.env.FRESHNESS_BEFORE ? 'before' : 'after'}-${theme}-${width}.png` });
    if (process.env.FRESHNESS_BEFORE) return;
    await expect(notice).toContainText('Данные могут быть неактуальны');
    await expect(notice.locator('.ui-alert')).toHaveAttribute('data-ui-variant', 'inline');
    await expect(notice.locator('svg')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#tasks-count')).toContainText('130');
    fail = false;
    await notice.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(notice.getByRole('button')).toHaveText('Обновляем…');
    await expect(notice.getByRole('button')).toBeDisabled();
    await expect.poll(() => Boolean(release)).toBe(true);
    release();
    await expect(notice).toBeHidden();
    await expect(page.locator('#tasks-count')).toContainText('130');
  });
}

test('refresh preserves selection deferral, filters and pagination', async ({ page }) => {
  await mockApp(page, { count: 230 });
  await page.goto('/#/backlog?bv=2&scope=all&page=2&q=Задача');
  await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#f-backlog-search')).toHaveValue('Задача');
  await page.locator('#backlog-select-all').check();
  await page.locator('#backlog-btn-refresh').click();
  await expect(page.locator('#backlog-stale')).toContainText('Обновление отложено');
  await expect(page.locator('#backlog-stale button')).toHaveCount(0);
  await page.locator('#backlog-select-all').uncheck();
  await expect(page.locator('#backlog-stale')).toBeHidden();
  let fail = true;
  await page.route('**/api/v1/tasks/?**', route => fail ? route.fulfill({status:503,json:{detail:'Unavailable'}}) : route.fallback());
  await page.locator('#backlog-btn-refresh').click();
  await expect(page.locator('#backlog-stale')).toContainText('Данные могут быть неактуальны');
  await page.locator('[data-backlog-retry]').click();
  await expect(page.locator('[data-backlog-retry]')).toBeEnabled();
  await expect(page.locator('#backlog-stale')).toBeVisible();
  fail = false;
  await page.locator('[data-backlog-retry]').click();
  await expect(page.locator('#backlog-stale')).toBeHidden();
  await expect(page.locator('#f-backlog-search')).toHaveValue('Задача');
  await expect(page.locator('#pagination [aria-current="page"]')).toHaveText('2');
});
