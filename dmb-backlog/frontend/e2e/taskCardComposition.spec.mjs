import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const evidence = resolve('artifacts/task-card-composition-2026-11-09');
async function open(page, width, height, theme) {
  await page.setViewportSize({ width, height });
  await page.goto(`/e2e/fixtures/taskCardIncrement.html?theme=${theme}#/tasks?task=42`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.locator('.ui-task-detail-summary')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Ссылки и файлы · 2/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of ['light', 'dark']) for (const [width, height] of [[1440,900],[1366,768],[390,844],[320,844]]) {
  test(`task composition full viewport ${theme} ${width}`, async ({ page }) => {
    await open(page, width, height, theme);
    const summary = page.getByRole('region', { name: 'Рабочая сводка' });
    await expect(summary.locator('.ui-readonly-field')).toHaveCount(5);
    const geometry = await page.evaluate(() => {
      const fields = [...document.querySelectorAll('.ui-task-detail-summary .ui-readonly-field')].map(el => ({ text:el.textContent, top:el.getBoundingClientRect().top, bottom:el.getBoundingClientRect().bottom }));
      return { fields, footerTop:document.querySelector('#mfoot').getBoundingClientRect().top, overflow:document.querySelector('#mbody').scrollWidth-document.querySelector('#mbody').clientWidth };
    });
    for (const item of geometry.fields) expect(item.bottom, item.text).toBeLessThanOrEqual(geometry.footerTop);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    if (width > 700) {
      const metricTops = await page.locator('.ui-task-detail-metric > .ui-task-detail-note:first-child').evaluateAll(items=>items.map(el=>el.getBoundingClientRect().top));
      expect(Math.max(...metricTops)-Math.min(...metricTops)).toBeLessThanOrEqual(1);
    }
    await expect(page.locator('.ui-task-detail-summary [data-inline-edit="assignee"] .ui-task-detail-value')).toHaveCSS('font-weight', '400');
    await expect(page.locator('#mbody .task-title')).toHaveCount(0);
    await mkdir(evidence, {recursive:true});
    await page.screenshot({path:resolve(evidence,`main-${theme}-${width}.png`)});
    await page.locator('[data-action="edit"]').click();
    await expect(page.locator('[data-k="title"]')).toBeVisible();
    await expect(page.locator('[data-k="effortDays"]')).toBeVisible();
    const descriptionWidths = await page.locator('[data-k="description"]').evaluate(el => ({ field: el.getBoundingClientRect().width, section: el.closest('.ui-task-edit-grid').getBoundingClientRect().width }));
    expect(descriptionWidths.field).toBeGreaterThan(descriptionWidths.section * .9);
    const editorGeometry = await page.evaluate(() => {
      const control = document.querySelector('.ui-task-edit-grid [data-k="progress"]');
      const controls = [...document.querySelectorAll('.ui-task-edit-grid .ui-control:not(textarea)')].filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect().height);
      return { progressWidth: control.getBoundingClientRect().width, fieldWidth: control.closest('.ui-task-edit-field').getBoundingClientRect().width, controls };
    });
    expect(Math.abs(editorGeometry.progressWidth - editorGeometry.fieldWidth)).toBeLessThanOrEqual(1);
    expect(Math.max(...editorGeometry.controls) - Math.min(...editorGeometry.controls)).toBeLessThanOrEqual(1);
    const footerGeometry = await page.locator('#mfoot').evaluate(footer => {
      const meta = footer.querySelector('.fmeta');
      const actions = footer.querySelector('.factions').getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(meta);
      return { actionsLeft:actions.left, textRight:Math.max(...[...range.getClientRects()].map(rect=>rect.right)) };
    });
    expect(footerGeometry.textRight, 'footer status text must not overlap action buttons').toBeLessThanOrEqual(footerGeometry.actionsLeft - 1);
    await page.locator('#mbody').evaluate(el=>el.scrollTop=0);
    await page.screenshot({path:resolve(evidence,`edit-${theme}-${width}.png`)});
    await page.locator('[data-k="finEffect"]').scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(evidence,`estimates-${theme}-${width}.png`)});
  });
}

test('attributes remain reachable, editable and cancelable through the new composition', async ({ page }) => {
  await open(page,1440,900,'light');
  const attributesToggle = page.locator('[data-action="toggle-card-attributes"]');
  await attributesToggle.click();
  await expect(attributesToggle).toHaveAttribute('aria-expanded','true');
  const more = page.locator('#task-extra-attributes');
  await more.locator('[data-inline-edit="customerDeptId"]').click();
  await expect(page.locator('[data-k="customerDeptId"]')).toBeVisible();
  await page.locator('#cardCancelBtn').click();
  await expect(page.locator('[data-action="edit"]')).toBeVisible();
  await page.locator('[data-action="edit"]').click();
  await page.locator('[data-k="comment"]').fill('Композиция сохраняет рабочий комментарий');
  await page.locator('#saveBtn').click();
  await expect(page.locator('.task-comment')).toContainText('Композиция сохраняет рабочий комментарий');
  await expect(page.locator('.task-comment')).toHaveClass(/task-comment/);
});
