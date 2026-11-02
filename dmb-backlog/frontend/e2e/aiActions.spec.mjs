import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark']) for (const width of [390, 1280]) {
  test(`AI actions: ${theme}, ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/ui-catalog/index.html');
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const soft = page.getByRole('button', { name: 'AI-расчёт', exact: true });
    const solid = page.getByRole('button', { name: 'AI-анализ', exact: true });
    await expect(soft).toBeVisible();
    await expect(soft.locator('svg')).toBeVisible();
    const styles = button => button.evaluate(el => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, color: s.color, border: s.borderColor, height: el.getBoundingClientRect().height };
    });
    const initial = await styles(soft);
    const primary = await styles(solid);
    expect(initial.bg).not.toBe(primary.bg);
    expect(initial.color).not.toBe(primary.color);
    expect(initial.height).toBeGreaterThanOrEqual(width === 390 ? 44 : 32);
    await page.evaluate(() => { document.documentElement.dataset.accent = 'green'; });
    expect(await styles(soft)).toEqual(initial);
    await soft.hover();
    await expect.poll(async () => (await styles(soft)).bg).not.toBe(initial.bg);
    await soft.focus();
    await expect(soft).toBeFocused();
    const busy = page.getByRole('button', { name: 'Анализируем…', exact: true });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(await busy.evaluate(el => getComputedStyle(el, '::before').content)).toBe('""');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await busy.evaluate(el => getComputedStyle(el, '::before').animationName)).toBe('none');
    await soft.locator('..').locator('..').screenshot({ path: testInfo.outputPath('ai-actions.png') });
  });
}
