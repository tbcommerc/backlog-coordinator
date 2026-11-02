import { expect, test } from '@playwright/test';

test('каталог показывает все семейства уведомлений без переполнения', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/e2e/fixtures/notificationCatalog.html');

  await expect(page.getByRole('heading', { name: 'Каталог уведомлений' })).toBeVisible();
  await expect(page.locator('[data-catalog="global-toasts"] .toast')).toHaveCount(7);
  await expect(page.locator('[data-catalog="card-toasts"] .catalog-card-toast')).toHaveCount(5);
  await expect(page.locator('[data-catalog="bell-popup"] .catalog-dropdown')).toHaveCount(4);
  await expect(page.locator('[data-catalog="center-cards"] .notification-card')).toHaveCount(3);
  await expect(page.locator('[data-catalog="dashboard-cards"] .dash-notif-item')).toHaveCount(2);

  const overflow = await page.locator('.catalog-shell').evaluate(shell => ({ clientWidth:shell.clientWidth, scrollWidth:shell.scrollWidth }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  await expect(page).toHaveScreenshot('notification-catalog-desktop.png', { fullPage:true, animations:'disabled' });
});

test('реальные toast закрываются и выполняют действие', async ({ page }) => {
  await page.goto('/e2e/fixtures/notificationCatalog.html');
  await page.getByRole('button', { name:'Error', exact:true }).click();
  const error = page.locator('.catalog-live-stage .toast-error');
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(error).toContainText('Сервер недоступен');
  await error.getByRole('button', { name:'Закрыть' }).click();
  await expect(error).toBeHidden();

  await page.getByRole('button', { name:'Toast с действием' }).click();
  const actionable = page.locator('.catalog-live-stage .toast-success');
  await actionable.getByRole('button', { name:'Отменить' }).click();
  await expect(actionable).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-action-triggered', 'true');
});

test('каталог сохраняет читаемость на мобильной ширине', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.goto('/e2e/fixtures/notificationCatalog.html');
  const overflow = await page.locator('.catalog-shell').evaluate(shell => ({ clientWidth:shell.clientWidth, scrollWidth:shell.scrollWidth }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
  await page.getByRole('button', { name:'Warning', exact:true }).click();
  const toast = page.locator('.catalog-live-stage .toast-warning');
  await expect(toast).toBeVisible();
  const geometry = await toast.evaluate(element => ({ clientWidth:element.clientWidth, scrollWidth:element.scrollWidth, right:element.getBoundingClientRect().right, viewport:innerWidth }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  // Real feedback now uses the top layer; close it before capturing static samples.
  await toast.getByRole('button', {name:'Закрыть',exact:true}).click();
  await expect(toast).toBeHidden();
  await expect(page.locator('[data-catalog="global-toasts"]')).toHaveScreenshot('notification-toasts-mobile.png', { animations:'disabled' });
});
