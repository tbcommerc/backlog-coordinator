import { test, expect } from '@playwright/test';
import { mockApp } from './helpers/backlogMock.mjs';
for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
  test(`центр уведомлений ${theme} ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockApp(page);
    await page.addInitScript(theme => { localStorage.setItem('dmb_theme', theme); localStorage.setItem('dmb_accent', 'rose'); localStorage.setItem('dmb_compact', 'true'); }, theme);
    let comment = true;
    await page.route('**/api/v1/notifications/preferences', async route => {
      if (route.request().method() === 'PUT') comment = route.request().postDataJSON().preferences.comment;
      await route.fulfill({ json: { preferences: { comment } } });
    });
    await page.route('**/api/v1/notifications?**', route => route.fulfill({ json: { items: [{ id: 1, title: 'Подготовить протокол встречи команды', body: 'Вы назначены исполнителем задачи.', category: 'assignment', importance: 'medium', created_at: '2026-11-05T09:00:00Z', is_read: false }], total: 1 } }));
    await page.goto('/#/notifications');
    const panel = page.locator('#notification-preferences');
    await expect(panel).toBeVisible();
    await expect(page.locator('.notification-card')).toHaveCount(1);
    await expect(page.locator('a[href="#/settings"]')).toHaveCount(0);
    await expect(page.locator('html')).not.toHaveAttribute('data-accent');
    await expect(page.locator('html')).not.toHaveAttribute('data-compact');
    await page.screenshot({ path: test.info().outputPath('closed.png'), fullPage: true });
    await panel.locator('summary').click();
    const toggle = page.getByRole('switch', { name: 'Новые комментарии', exact: true });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(page.locator('#notif-prefs-save-status')).toContainText('Все изменения сохранены');
    expect(comment).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: test.info().outputPath('open.png'), fullPage: true });
    await page.goto('/#/settings?section=notifications');
    await expect(page).toHaveURL(/#\/notifications\?section=preferences$/);
    await expect(toggle).not.toBeChecked();
  });
}
