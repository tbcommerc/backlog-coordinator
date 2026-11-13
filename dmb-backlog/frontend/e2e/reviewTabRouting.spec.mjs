import { test, expect } from '@playwright/test';
import { mockWorkspace } from './helpers/requirementWorkspace.mjs';

test('review tabs and revision detail navigate through the application router', async ({ page }, info) => {
  await mockWorkspace(page);
  await page.route('**/api/v1/agent/requests/registry?*', route => route.fulfill({
    json: { items: [], total: 0, has_more: false, counts: {}, options: {} },
  }));
  await page.goto('/e2e/fixtures/workWorkspaceRouter.html#/review');
  for (const sheet of ['pages', 'agent-v2', 'agent-v2-details']) await page.addStyleTag({ url: `/static/css/${sheet}.css` });
  await page.addStyleTag({ content: '#page-content, #breadcrumb-nav { margin-left: 260px; padding: 16px; }' });
  await expect(page.locator('#review-count')).not.toHaveText('Загрузка…');
  await page.screenshot({ path: info.outputPath('requests-full.png'), fullPage: true });
  const tab = page.getByRole('link', { name: 'Редакции БТ', exact: true });
  await tab.click();
  await expect(page.locator('.requirement-review-card')).toBeVisible();
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await page.locator('.requirement-review-card').click();
  await expect(page.locator('.requirement-review-detail')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.requirement-review-card')).toBeVisible();
  await page.goForward();
  await expect(page.locator('.requirement-review-detail')).toBeVisible();
  await page.getByRole('link', { name: 'Все редакции БТ', exact: true }).click();
  await expect(page.locator('.requirement-review-card')).toBeVisible();
  await page.screenshot({ path: info.outputPath('revisions-full.png'), fullPage: true });
  await page.getByRole('link', { name: 'Запросы', exact: true }).click();
  await expect(page.locator('#review-queue-card')).toBeVisible();
  await expect(page.locator('#requirement-reviews')).toHaveCount(0);
});
