import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark']) {
  for (const width of [1440, 900, 390]) {
    test(`шапка статусов встреч: компактные действия, ${theme}, ${width}`, async ({ page }, info) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/e2e/fixtures/uiKitAdminReports.html?surface=reports&theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
      await page.evaluate(() => document.fonts.ready);
      const header = page.locator('.reporting-status-page-header');
      const buttons = header.locator('.btn');
      await expect(buttons).toHaveCount(2);
      const geometry = await buttons.evaluateAll(elements => elements.map(element => {
        const box = element.getBoundingClientRect(), icon = element.querySelector('svg').getBoundingClientRect();
        return { y: box.y, height: box.height, iconWidth: icon.width, iconHeight: icon.height };
      }));
      for (const button of geometry) {
        expect(button.height).toBe(width > 640 ? 28 : 44);
        expect(button.iconWidth).toBe(14);
        expect(button.iconHeight).toBe(14);
      }
      if (width >= 900) expect(geometry[0].y).toBe(geometry[1].y);
      expect(await header.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator('#count-team-weekly')).toHaveText('246');
      await page.screenshot({ path: info.outputPath('reports-header.png') });
      await buttons.nth(0).click();
      await expect(page).toHaveURL(/#\/quarterly-goals-update\?source=report$/);
      await buttons.nth(1).click();
      await expect(page).toHaveURL(/#\/reporting-statuses\?source=report$/);
      await page.locator('[data-report="team-weekly"]').focus();
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => window.__navigation)).toBe('/reports/detail?r=team-weekly');
      expect(await page.evaluate(() => window.__apiCalls.filter(([method]) => method !== 'get'))).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
