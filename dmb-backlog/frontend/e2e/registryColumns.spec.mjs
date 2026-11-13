import { test, expect } from '@playwright/test';
import { setup } from './stickyRegistrySetup.mjs';

for (const surface of ['backlog', 'metrics', 'projects', 'work']) for (const theme of ['light', 'dark']) {
  test(`shared columns ${surface} ${theme}`, async ({ page }, info) => {
    test.setTimeout(90_000); // Full reload + pointer/keyboard + sticky + mobile journey.
    await page.setViewportSize({ width: 1440, height: 900 });
    await setup(page, surface, theme);
    if (surface === 'backlog') await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready', 'true');
    const table = page.locator('main table[data-ui-table="registry"], .main-content table[data-ui-table="registry"]').first();
    const header = table.locator('thead th').filter({ has: page.locator('.th-resize-handle') }).first();
    const handle = header.locator('.th-resize-handle');
    await expect(handle).toBeVisible();
    const width = async () => (await header.boundingBox()).width;
    const original = await width();
    await handle.press('ArrowRight');
    await expect.poll(width).toBeCloseTo(original + 10, 0);
    await handle.press('Shift+ArrowRight');
    await expect.poll(width).toBeCloseTo(original + 60, 0);
    const fixed = await width();
    await page.setViewportSize({ width: 1366, height: 900 });
    await expect.poll(width).toBeCloseTo(fixed, 0);
    await page.reload();
    if (surface === 'backlog') await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready', 'true');
    await expect(handle).toBeVisible();
    await expect.poll(width).toBeCloseTo(fixed, 0);
    await handle.press('Home');
    await expect.poll(width).not.toBeCloseTo(fixed, 0);
    const box = await handle.boundingBox(), beforeDrag = await width();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
    await expect.poll(width).toBeCloseTo(beforeDrag + 70, 0);
    await handle.dblclick();
    await expect.poll(width).not.toBeCloseTo(beforeDrag + 70, 0);
    await page.locator('.main-content').evaluate(el => el.scrollTop = 500);
    const dock = page.locator('.ui-table-sticky-header').first();
    await expect(dock).toBeVisible();
    const dockHandle = dock.locator('.th-resize-handle').first();
    const beforeSticky = await width();
    await dockHandle.press('ArrowRight');
    await expect.poll(width).toBeCloseTo(beforeSticky + 10, 0);
    await page.screenshot({ path: info.outputPath('sticky-resized.png'), fullPage: true });
    await page.locator('.main-content').evaluate(el => el.scrollTop = 0);
    await handle.press('Home');
    await page.mouse.move(0, 0);
    await page.screenshot({ path: info.outputPath('full-screen.png'), fullPage: true });
    const key = await header.getAttribute('data-column-key');
    if (surface !== 'backlog') {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
      expect(key).toBeTruthy();
    }
  });
}
