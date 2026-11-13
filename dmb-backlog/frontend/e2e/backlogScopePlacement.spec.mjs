import { test, expect } from '@playwright/test';
import { mockApp } from './helpers/backlogMock.mjs';

for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`scope precedes creation ${theme} ${width}`, async ({ page }, info) => {
    await mockApp(page);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(theme => localStorage.setItem('dmb_theme', theme), theme);
    await page.goto('/#/backlog?scope=all');
    await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready', 'true');
    const scope = page.locator('.toolbar-actions > .backlog-scope-bar');
    await expect(scope).toBeVisible();
    await expect(page.locator('.backlog-scope-bar + #backlog-add-task-btn')).toBeVisible();
    const a = await scope.boundingBox();
    const b = await page.locator('#backlog-add-task-btn').boundingBox();
    expect(a.x + a.width).toBeLessThanOrEqual(b.x);
    expect(Math.abs(a.y + a.height / 2 - b.y - b.height / 2)).toBeLessThan(2);
    const heights = await page.locator('.toolbar-actions').evaluate(el => {
      const rail = el.querySelector('.backlog-scope-bar .ui-segmented').getBoundingClientRect();
      return { scope: rail.height, buttons: [...el.querySelectorAll('button:not(.ui-segment-item)')]
        .filter(button => button.getBoundingClientRect().height > 0)
        .map(button => ({ name: button.getAttribute('title') || button.getAttribute('aria-label') || button.textContent.trim(), height: button.getBoundingClientRect().height })) };
    });
    console.log(JSON.stringify({ theme, width, ...heights }));
    for (const button of heights.buttons) expect(button.height, button.name).toBe(heights.scope);
    await page.screenshot({ path: info.outputPath('full-page.png'), fullPage: true });
    await page.locator('[data-backlog-scope="team"]').click();
    await expect(page.locator('[data-backlog-scope="team"]')).toHaveAttribute('aria-pressed', 'true');
  });
}
