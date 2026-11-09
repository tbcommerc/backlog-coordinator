import { expect, test } from '@playwright/test';
import { mockApp } from './helpers/backlogMock.mjs';

for (const scope of ['backlog', 'team-backlog']) {
  for (const width of [1280, 1920]) {
    test(`${scope}: short viewport aligns filters with table at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 590 });
      await mockApp(page);
      await page.goto(`/#/${scope}`);
      await expect(page.locator(scope === 'backlog' ? '#tasks-table' : '#tasks-table')).toBeVisible();
      for (const collapsed of [false, true]) {
        await page.locator('.sidebar').evaluate((el, value) => el.classList.toggle('collapsed', value), collapsed);
        await expect.poll(() => page.locator('.filter-panel').evaluate(panel => {
          const toolbar = panel.closest('.sticky-toolbar').getBoundingClientRect();
          const table = document.querySelector('#tasks-table, #tasks-table').closest('.table-container').getBoundingClientRect();
          return Math.max(Math.abs(toolbar.left - table.left), Math.abs(panel.getBoundingClientRect().right - table.right));
        })).toBeLessThan(2);
      }
    });
  }
}
