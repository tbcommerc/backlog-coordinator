import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(90_000);

const expectedScenarios = [
  'confirm-standard', 'confirm-danger', 'confirm-admin', 'unsaved-task', 'unsaved-quick', 'duplicate',
  'meeting-schedule', 'meeting-cancel', 'meeting-complete', 'meeting-data', 'review-assign', 'review-reason',
  'assistant-submit', 'assistant-edit', 'bulk-select', 'bulk-fields', 'bulk-result', 'save-result', 'import-file',
  'express-import', 'express-complete', 'prioritiser-requirements', 'conflict', 'timeline', 'customer-reference',
  'admin-team', 'admin-user', 'admin-role', 'admin-dictionary', 'admin-project', 'admin-business-customer',
  'admin-report', 'admin-notification', 'task-detail', 'task-create',
];

test('полный каталог содержит каждый выявленный модальный сценарий и не переполняется', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/modal-catalog.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));

  const ids = await page.locator('[data-modal-scenario]').evaluateAll(items => items.map(item => item.dataset.modalScenario));
  expect(ids).toEqual(expectedScenarios);
  expect(new Set(ids).size).toBe(expectedScenarios.length);

  const audit = await page.locator('[data-modal-scenario]').evaluateAll(items => items.map(item => {
    const stage = item.querySelector('.catalog-stage');
    const surface = stage.querySelector('.modal, .admin-modal, .feedback-confirm, .conflict-modal, .app-modal, dialog');
    const stageRect = stage.getBoundingClientRect();
    const surfaceRect = surface.getBoundingClientRect();
    const close = surface.querySelector('.modal-close, .modal-close-x, .prioritiser-requirements-x, .iconbtn.close');
    const footer = surface.querySelector('.modal-footer, .modal-footer-sticky, .app-modal__footer, .feedback-confirm-actions, .mfoot');
    const secondary = footer?.querySelector('.btn-secondary, .btn-ghost, .modal-cancel-btn, .conflict-btn-ghost');
    return {
      id: item.dataset.modalScenario,
      stageOverflow: stage.scrollWidth - stage.clientWidth,
      surfaceOverflow: surface.scrollWidth - surface.clientWidth,
      insideHorizontally: surfaceRect.left >= stageRect.left - 1 && surfaceRect.right <= stageRect.right + 1,
      closeWidth: close ? close.getBoundingClientRect().width : null,
      closeHeight: close ? close.getBoundingClientRect().height : null,
      secondaryBorder: secondary ? getComputedStyle(secondary).borderTopStyle : null,
      secondaryBorderWidth: secondary ? getComputedStyle(secondary).borderTopWidth : null,
      footerLeft: footer ? getComputedStyle(footer).paddingLeft : null,
      footerRight: footer ? getComputedStyle(footer).paddingRight : null,
    };
  }));

  for (const item of audit) {
    expect(item.stageOverflow, `${item.id}: stage overflow`).toBeLessThanOrEqual(1);
    expect(item.surfaceOverflow, `${item.id}: surface overflow`).toBeLessThanOrEqual(1);
    expect(item.insideHorizontally, `${item.id}: surface outside stage`).toBe(true);
    if (item.closeWidth !== null) {
      expect(item.closeWidth, `${item.id}: close width`).toBeGreaterThanOrEqual(40);
      expect(item.closeHeight, `${item.id}: close height`).toBeGreaterThanOrEqual(40);
    }
    if (item.secondaryBorder !== null && !['task-detail', 'task-create', 'customer-reference'].includes(item.id)) {
      expect(item.secondaryBorder, `${item.id}: secondary border`).toBe('solid');
      expect(item.secondaryBorderWidth, `${item.id}: secondary border width`).toBe('1px');
    }
    if (item.footerLeft !== null && !['task-detail', 'task-create', 'customer-reference'].includes(item.id)) {
      expect(item.footerLeft, `${item.id}: footer left`).toBe('24px');
      expect(item.footerRight, `${item.id}: footer right`).toBe('24px');
    }
  }
});

for (const group of ['confirm', 'workflow', 'operation', 'admin', 'task']) {
  test(`визуальный снимок раздела ${group}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto('/modal-catalog.html');
    await page.locator(`[data-filter="${group}"]`).click();
    await expect(page.locator(`[data-section="${group}"]`)).toHaveScreenshot(`modal-catalog-${group}.png`, {
      animations: 'disabled',
      maxDiffPixelRatio: 0.002,
    });
  });
}

test('компактный режим воспроизводит мобильные размеры контролов', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/modal-catalog.html');
  await page.locator('[data-filter="confirm"]').click();
  await page.locator('#catalog-width').click();
  const first = page.locator('[data-modal-scenario="confirm-standard"]');
  await expect(first.locator('.app-modal__footer')).toHaveCSS('padding-left', '16px');
  await expect(first.locator('.app-modal__footer')).toHaveCSS('padding-right', '16px');
  await expect(first).toHaveScreenshot('modal-catalog-compact-confirm.png', { animations: 'disabled' });
});
