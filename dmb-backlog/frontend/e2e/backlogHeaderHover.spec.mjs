import { test, expect } from '@playwright/test';
import { mockApp } from './helpers/backlogMock.mjs';

for (const theme of ['light', 'dark']) test(`backlog header hover spacing ${theme}`, async ({ page }, info) => {
  await mockApp(page, { count: 25 });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.addInitScript(t => localStorage.setItem('dmb_theme', t), theme);
  await page.goto('/#/backlog?scope=all');
  await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready', 'true');
  const button = page.locator('#tasks-table th[data-sort="id"] .table-sort-button');
  await button.hover();
  const spacing = await button.evaluate(el => {
    const b = el.getBoundingClientRect();
    const label = el.querySelector('.th-label').getBoundingClientRect();
    const cell = el.closest('th');
    return { inset: label.left - b.left, alignment: label.left - cell.getBoundingClientRect().left - parseFloat(getComputedStyle(cell).paddingLeft) };
  });
  expect(spacing.inset).toBeGreaterThanOrEqual(8);
  expect(Math.abs(spacing.alignment)).toBeLessThan(1);
  await page.screenshot({ path: info.outputPath('header-hover.png'), fullPage: true });
  await button.press('Enter');
  await expect(page.locator('#tasks-table th[data-sort="id"]')).toHaveAttribute('aria-sort', 'ascending');
});
