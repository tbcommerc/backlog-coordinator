import { test, expect } from '@playwright/test';

const squareActions = '.qe-exclude-task-btn, .qe-del-epic-btn, .qe-del-story-btn';
for (const theme of ['light', 'dark']) {
  for (const width of [1440, 900, 390]) {
    test(`экспресс-оценка: компактные действия и квадратные иконки, ${theme}, ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`/e2e/fixtures/uiKitExpress.html?theme=${theme}`);
      await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
      await expect(page.locator('.qe-task-block')).toHaveCount(2);
      const heights=await page.locator('#qe-task-search-input,.qe-estimate-filters,.qe-collapse-actions button').evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().height));
      expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(1);
      const resourceRows = page.locator('.qe-resource-table tbody tr');
      const rowHeight = await resourceRows.first().evaluate(el => el.getBoundingClientRect().height);
      await page.locator('#res-edit-btn').click();
      const resourceGeometry = await resourceRows.evaluateAll(rows => rows.map(row => ({
        row: row.getBoundingClientRect().height,
        field: row.querySelector('input').getBoundingClientRect().height,
      })));
      for (const item of resourceGeometry) {
        expect(item.row).toBe(rowHeight);
        expect(item.field).toBe(width > 640 ? 24 : 44);
      }
      const chartRows = await page.locator('.qe-resource-row').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
      for (const height of chartRows) expect(height).toBe(rowHeight);
      await page.locator('#res-cancel-btn').click();
      const compact = page.locator('.qe-collapse-actions .btn');
      const geometry = await compact.evaluateAll(buttons => buttons.map(button => {
        const box = button.getBoundingClientRect(), style = getComputedStyle(button);
        return { width: box.width, height: box.height, font: parseFloat(style.fontSize) };
      }));
      for (const box of geometry) {
        expect(box.height).toBe(width > 640 ? 32 : 44);
        expect(box.font).toBe(13);
        expect(box.width).toBeLessThan(width);
      }
      const icons = await page.locator(squareActions).evaluateAll(buttons => buttons.map(button => {
        const box = button.getBoundingClientRect(); return { width: box.width, height: box.height };
      }));
      expect(icons.length).toBe(5);
      for (const box of icons) {
        expect(box.width).toBe(width > 640 ? 28 : 44);
        expect(box.height).toBe(box.width);
      }
      await page.locator('#qe-collapse-all-btn').click();
      await expect(page.locator('#task-12')).toBeHidden();
      await page.locator('#qe-expand-all-btn').click();
      await expect(page.locator('#task-12')).toBeVisible();
      await expect(page.locator('#epic-21')).toBeVisible();
      const numbers = await page.locator('.qe-inline-effort').evaluateAll(inputs => {
        const context = document.createElement('canvas').getContext('2d');
        return inputs.map(input => {
          const style = getComputedStyle(input);
          context.font = `${style.fontSize} ${style.fontFamily}`;
          return { value: input.value, text: context.measureText(input.value).width, available: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
        });
      });
      expect(numbers.some(input => input.value === '1000')).toBe(true);
      for (const input of numbers) expect(input.text, `visible value: ${input.value}`).toBeLessThanOrEqual(input.available);
      await page.locator('#express-hierarchy-section').screenshot({ path: info.outputPath('hierarchy.png') });
      expect(await page.evaluate(() => window.__writes)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
