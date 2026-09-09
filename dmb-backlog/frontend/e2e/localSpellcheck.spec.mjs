import { expect, test } from '@playwright/test';

test('нативная проверка подчёркивает ошибки без панели приложения', async ({ page }) => {
  await page.goto('/e2e/fixtures/localSpellcheck.html');
  const title = page.locator('#semantic-title');
  await title.fill('Проверка орфаграфии');
  await expect(title).toHaveAttribute('spellcheck', 'true');
  await expect(title).toHaveAttribute('lang', 'ru');
  await expect(page.locator('#local-spellcheck-panel')).toHaveCount(0);

  await page.locator('#technical-search').focus();
  await expect(page.locator('#technical-search')).toHaveAttribute('spellcheck', 'false');
});
