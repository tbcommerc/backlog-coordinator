import { expect, test } from '@playwright/test';

async function openReport(page) {
  await page.goto('/e2e/fixtures/teamWeeklyReport.html');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
}

test('недельный отчёт собирает повестку и управленческий ритм на desktop', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openReport(page);
  await expect(page.locator('.team-weekly-kpis > button')).toHaveCount(5);
  await expect(page.locator('.team-weekly-task')).toHaveCount(3);
  await expect(page.locator('.team-weekly-rhythm')).toBeVisible();
  await expect(page.getByText('Согласовать объём пилота: 20 клиентов')).toBeVisible();
  const geometry = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    columns: getComputedStyle(document.querySelector('.team-weekly-layout')).gridTemplateColumns,
  }));
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.columns.split(' ').length).toBeGreaterThan(1);
  await page.screenshot({ path: testInfo.outputPath('team-weekly-desktop.png'), fullPage: true });
});

test('недельный отчёт не создаёт горизонтальный overflow на mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openReport(page);
  await expect(page.locator('.team-weekly-kpis > button')).toHaveCount(5);
  const geometry = await page.evaluate(() => ({
    documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
    taskColumns: getComputedStyle(document.querySelector('.team-weekly-task-grid')).gridTemplateColumns,
  }));
  expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
  expect(geometry.bodyOverflow).toBeLessThanOrEqual(1);
  expect(geometry.taskColumns.split(' ').length).toBe(1);
});
