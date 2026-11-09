import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { mockApp } from './helpers/backlogMock.mjs';

for (const theme of ['light', 'dark']) test(`quick edit toggle: ${theme}`, async ({ page }) => {
  await mockApp(page);
  await page.addInitScript(t => localStorage.setItem('dmb_theme', t), theme);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/backlog?scope=all');
  await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready', 'true');
  const toggle = page.locator('#backlog-inline-edit');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.locator('#qe-toolbar-backlog')).toBeVisible();
  await page.mouse.move(0, 0);
  mkdirSync('../docs/dev-testing/evidence/quick-edit-toggle-2026-11-04', { recursive: true });
  await page.screenshot({ path: `../docs/dev-testing/evidence/quick-edit-toggle-2026-11-04/after-${theme}.png`, fullPage: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const active = await toggle.evaluate(el => getComputedStyle(el).backgroundColor);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#qe-toolbar-backlog')).toBeHidden();
  expect(await toggle.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(active);
});
