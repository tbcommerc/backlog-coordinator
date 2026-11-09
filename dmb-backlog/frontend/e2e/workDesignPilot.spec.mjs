import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { setupWorkDesignPilot } from './helpers/workDesignPilot.mjs';

const capture = process.env.DESIGN_PILOT_CAPTURE;
async function image(page, info, name) {
  if (capture) {
    if (!['before', 'after'].includes(capture)) throw new Error('DESIGN_PILOT_CAPTURE must be before or after');
    const dir = info.outputPath(`design-${capture}`);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' });
  } else {
    if (info.project.metadata.designVisual) {
      await expect(page).toHaveScreenshot(`${name}-${process.platform}.png`, { animations: 'disabled', maxDiffPixels: 80 });
    } else {
      await info.attach(name, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
    }
  }
}

for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 900], [1366, 768], [390, 844]]) {
  test(`design pilot ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await setupWorkDesignPilot(page, { theme });
    await expect(page.locator('[data-work-row]')).toHaveCount(8);
    await image(page, info, `registry-${theme}-${width}`);
    if (width >= 1366) {
      const search = await page.locator('#work-search').boundingBox();
      const status = await page.locator('#work-status').boundingBox();
      expect(Math.abs(search.y - status.y)).toBeLessThan(4);
      expect((await page.locator('[data-work-row]').first().boundingBox()).y).toBeLessThan(380);
    }
    await page.locator('[data-work-id="77"]').click();
    await expect(page.locator('.work-card-title')).toBeVisible();
    await expect(page.locator('.work-checklist-view [data-checklist-count]')).toHaveText('1 из 2');
    const summary = await page.locator('.ui-detail-summary').boundingBox();
    const result = await page.locator('.work-saved-result').boundingBox();
    expect(summary.y + summary.height).toBeLessThanOrEqual(result.y);
    await image(page, info, `detail-${theme}-${width}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('search and cancelled filters preserve the registry context', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await setupWorkDesignPilot(page);
  await page.locator('#work-search').fill('ретроспективе');
  await expect(page.locator('[data-work-row]')).toHaveCount(1);
  await page.locator('[data-work-action="filters"]').click();
  await expect(page.locator('#work-priority')).toBeVisible();
  await page.locator('#work-priority').selectOption('high');
  await page.locator('[data-work-action="cancel-filters"]').last().click();
  await expect(page.locator('#work-priority')).toHaveValue('');
  await expect(page.locator('#work-search')).toHaveValue('ретроспективе');
  await page.locator('#work-search').fill('нет такого названия');
  await expect(page.locator('[data-work-row]')).toHaveCount(0);
});

test('header refresh and relocated sort retain queue context', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupWorkDesignPilot(page);
  await expect(page.locator('[data-work-row]')).toHaveCount(8);
  await page.getByRole('combobox', { name: 'Сортировка', exact: true }).selectOption('due');
  await expect(page).toHaveURL(/sort=due/);
  const request = page.waitForRequest(r => new URL(r.url()).pathname.endsWith('/work-tasks') && r.method() === 'GET');
  await page.getByRole('button', { name: 'Обновить', exact: true }).click();
  expect(new URL((await request).url()).searchParams.get('sort')).toBe('due');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Дополнительные фильтры', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Сортировка', exact: true })).toHaveValue('due');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.work-sort-slot #work-sort')).toHaveValue('due');
});

test('editing keeps assignee and deadline ahead of the description', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupWorkDesignPilot(page, { editable: true });
  await page.locator('[data-work-id="76"]').click();
  await expect(page.locator('#wf-description')).toBeVisible();
  const fields = await page.locator('.work-primary-fields').boundingBox();
  const description = await page.locator('#wf-description').boundingBox();
  expect(fields.y + fields.height).toBeLessThanOrEqual(description.y);
  await image(page, info, 'detail-edit-light-1440');
});

for (const theme of ['light', 'dark']) test(`composition variants ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto('/ui-catalog/page-compositions.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.ui-filter-navigation[aria-pressed=true]')).toBeVisible();
  await page.locator('summary').click();
  await expect(page.locator('details')).toHaveAttribute('open', '');
  expect(await page.locator('.ui-section-plain').first().evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('0px');
  await image(page, info, `composition-variants-${theme}`);
});
