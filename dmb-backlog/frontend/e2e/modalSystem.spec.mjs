import { expect, test } from '@playwright/test';

test('каталог фиксирует единый визуальный контракт модальных окон', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/e2e/fixtures/modalCatalog.html');

  const close = page.locator('[data-catalog="form"] .modal-close');
  await expect(close).toHaveCSS('width', '40px');
  await expect(close).toHaveCSS('height', '40px');
  await expect(page.locator('[data-catalog="form"] .modal')).toHaveCSS('border-radius', '14px');
  const standardWidth = await page.locator('[data-catalog="form"] .modal').evaluate(element => element.getBoundingClientRect().width);
  const wideWidth = await page.locator('[data-catalog="result"] .modal').evaluate(element => element.getBoundingClientRect().width);
  expect(standardWidth).toBe(560);
  expect(wideWidth).toBe(920);

  const geometry = await page.locator('[data-catalog="form"]').evaluate(stage => {
    const surface = stage.querySelector('.modal').getBoundingClientRect();
    const header = stage.querySelector('.modal-header').getBoundingClientRect();
    const body = stage.querySelector('.modal-body').getBoundingClientRect();
    const footer = stage.querySelector('.modal-footer').getBoundingClientRect();
    return { surface, header, body, footer };
  });
  expect(geometry.header.top).toBeGreaterThanOrEqual(geometry.surface.top);
  expect(geometry.body.top).toBeGreaterThanOrEqual(geometry.header.bottom - 1);
  expect(geometry.footer.top).toBeGreaterThanOrEqual(geometry.body.bottom - 1);
  expect(geometry.footer.bottom).toBeLessThanOrEqual(geometry.surface.bottom + 1);

  const footerContracts = await page.locator('[data-catalog]:not([data-catalog="native-dialog"]):not([data-catalog="task"])').evaluateAll(stages => stages.map(stage => {
    const footer = stage.querySelector('.modal-footer, .modal-footer-sticky, .app-modal__footer, .feedback-confirm-actions');
    const buttons = [...footer.querySelectorAll('button')];
    const style = getComputedStyle(footer);
    const secondary = footer.querySelector('.btn-secondary, .btn-ghost, .modal-cancel-btn, .conflict-btn-ghost');
    return {
      name: stage.dataset.catalog,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      gap: style.gap,
      secondaryBorderWidth: secondary ? getComputedStyle(secondary).borderTopWidth : null,
      secondaryBorderStyle: secondary ? getComputedStyle(secondary).borderTopStyle : null,
      rightGap: buttons.length
        ? Math.round(stage.querySelector('.modal, .admin-modal, .feedback-confirm, .conflict-modal').getBoundingClientRect().right - Math.max(...buttons.map(button => button.getBoundingClientRect().right)))
        : null,
    };
  }));
  for (const contract of footerContracts) {
    expect(contract.paddingLeft, contract.name).toBe('24px');
    expect(contract.paddingRight, contract.name).toBe('24px');
    expect(contract.gap, contract.name).toBe('10px');
    expect(contract.rightGap, contract.name).toBeGreaterThanOrEqual(23);
    expect(contract.rightGap, contract.name).toBeLessThanOrEqual(25);
    if (contract.secondaryBorderWidth !== null) {
      expect(contract.secondaryBorderWidth, contract.name).toBe('1px');
      expect(contract.secondaryBorderStyle, contract.name).toBe('solid');
    }
  }

  const taskClose = page.locator('[data-catalog="task"] .iconbtn.close');
  await expect(taskClose).toHaveCSS('width', '40px');
  await expect(page.locator('[data-catalog="task"] .tabs')).toBeVisible();
  await expect(page.locator('[data-catalog="task"] .modal')).toHaveCSS('max-width', '1280px');

  await expect(page).toHaveScreenshot('modal-catalog-desktop.png', { fullPage: true, animations: 'disabled' });
});

test('на touch-ширине закрытие не меньше 44px, действия не переполняют окно', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e/fixtures/modalCatalog.html');

  const close = page.locator('[data-catalog="form"] .modal-close');
  await expect(close).toHaveCSS('width', '44px');
  await expect(close).toHaveCSS('height', '44px');

  const overflow = await page.locator('[data-catalog="form"] .modal').evaluate(surface => ({
    clientWidth: surface.clientWidth,
    scrollWidth: surface.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  const mobileFooter = page.locator('[data-catalog="form"] .modal-footer');
  await expect(mobileFooter).toHaveCSS('padding-left', '16px');
  await expect(mobileFooter).toHaveCSS('padding-right', '16px');
  await expect(page.locator('[data-catalog="form"] .btn-secondary')).toHaveCSS('border-top-width', '1px');
  await expect(page.locator('[data-catalog="form"] .btn-secondary')).toHaveCSS('border-top-style', 'solid');

  await expect(page.locator('[data-catalog="task"] #task-detail-overlay')).toBeHidden();
  await expect(page.locator('[data-catalog="form"]')).toHaveScreenshot('modal-form-mobile.png', { animations: 'disabled' });
});
