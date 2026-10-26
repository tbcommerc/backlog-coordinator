import { test, expect } from '@playwright/test';

const runtimeErrors = new WeakMap();

async function open(page, tab, extra = '') {
  const errors = [];
  runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/e2e/fixtures/uiKitAdminReports.html?dialogA11y=true&admin_tab=${tab}&${extra}`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  expect(errors).toEqual([]);
}

async function dictionary(page, key = 'priorities', extra = '') {
  await open(page, 'dictionaries', extra);
  const card = page.locator(`[data-dict="${key}"]`);
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#admin-modal-overlay')).toBeVisible();
}

async function discard(page) {
  await page.locator('#admin-modal-overlay .modal-cancel-btn').click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.locator('#admin-modal-overlay')).toHaveCount(0);
}

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page) || []).toEqual([]);
  expect(await page.evaluate(() => window.__blockedWrites || [])).toEqual([]);
});

test('роль сохраняет выбранные права, экранирует название и защищает собственный доступ', async ({ page }, testInfo) => {
  await open(page, 'roles');
  await page.locator('.admin-edit-btn[data-type="role"]').click();
  await expect(page.getByLabel('Название роли')).toHaveValue('Роль "А" <тест>');
  await expect(page.getByLabel('Бэклог команды', { exact: true })).toHaveValue('write_own');
  const admin = page.getByLabel('Администрирование', { exact: true });
  await expect(admin).toHaveValue('full');
  await expect(admin.locator('option[value="none"]')).toBeDisabled();
  await expect(admin).toHaveAttribute('aria-describedby', 'modal-admin_access-hint');
  await page.screenshot({ path: testInfo.outputPath('role-desktop.png') });
  await page.getByRole('button', { name: 'Операции с задачами', exact: true }).click();
  await expect(page.locator('[data-role-section="tasks"]')).toHaveAttribute('aria-current', 'location');
  await expect(page.getByLabel('Редактирование', { exact: true })).toHaveValue('team');
  await page.locator('#admin-modal-overlay .modal-cancel-btn').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('форма пользователя показывает название роли без повторного HTML-экранирования', async ({ page }) => {
  await open(page, 'users');
  await page.locator('.admin-add-btn[data-type="user"]').click();
  await expect(page.getByLabel('Роль', { exact: true }).locator('option[value="101"]')).toHaveText('Роль "А" <тест>');
  await page.locator('#admin-modal-overlay .modal-cancel-btn').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('ошибки политики роли связаны с полями и не отправляют изменения', async ({ page }) => {
  await open(page, 'roles');
  await page.locator('.admin-edit-btn[data-type="role"]').click();
  await page.getByLabel('Режим бизнес-заказчика').selectOption('1');
  await page.locator('.modal-save-btn').click();
  const admin = page.getByLabel('Администрирование', { exact: true });
  await expect(admin).toHaveAttribute('aria-invalid', 'true');
  await expect(admin).toHaveAttribute('aria-describedby', /modal-admin_access-hint admin-field-error-/);
  await expect(page.locator('#admin-form-error-summary')).toContainText('администрирование должно быть запрещено');
  await expect(page.locator('#role-form-live-summary')).toContainText('Ошибок:');
  expect(await page.evaluate(() => window.__apiCalls.filter(([method]) => method !== 'get'))).toEqual([]);
  await page.getByLabel('Режим бизнес-заказчика').selectOption('0');
  await admin.selectOption('partial');
  await expect(admin).not.toHaveAttribute('aria-invalid');
  await expect(admin).toHaveAttribute('aria-describedby', 'modal-admin_access-hint');
  await discard(page);
});

test('редактор справочника связывает поля и ошибки, фильтрует строки и сохраняет порядок с клавиатуры', async ({ page }, testInfo) => {
  await dictionary(page);
  const rows = page.locator('#dict-items-container .dict-editor-row');
  await expect(rows.first().getByLabel('Название', { exact: true })).toHaveValue('Высокий "А" <тест>');
  await expect(page.locator('.dict-row-error:visible')).toHaveCount(0);
  expect(await page.locator('.modal-body-scroll').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('dictionary-desktop.png') });
  await page.getByRole('searchbox', { name: 'Поиск значений' }).fill('medium');
  await expect(page.locator('#dict-items-container .dict-editor-row:visible')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Поиск значений' }).fill('');
  const handle = rows.nth(1).getByRole('button', { name: 'Изменить порядок' });
  await handle.focus();
  await page.keyboard.press('ArrowUp');
  await expect(rows.first()).toHaveAttribute('data-item-id', '2');
  await expect(rows.first().getByRole('button', { name: 'Изменить порядок' })).toBeFocused();
  await page.getByRole('button', { name: 'Добавить значение' }).click();
  const draft = page.locator('.dict-editor-row.is-new');
  await expect(draft.getByLabel('Название', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('.modal-save-btn')).toBeDisabled();
  await draft.getByLabel('Название', { exact: true }).fill('Новая строка');
  await draft.getByLabel('Код', { exact: true }).fill('MEDIUM');
  await expect(draft.getByLabel('Код', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(draft).toContainText('Код уже используется');
  await draft.getByLabel('Код', { exact: true }).fill('UNIQUE');
  await expect(page.locator('.modal-save-btn')).toBeEnabled();
  const associations = await page.locator('.dict-editor-field .ui-control').evaluateAll(controls => controls.every(control => document.querySelector(`label[for="${control.id}"]`) && control.getAttribute('aria-describedby').split(' ').every(id => document.getElementById(id))));
  expect(associations).toBe(true);
  await discard(page);
  await expect.poll(() => page.evaluate(() => window.__apiCalls.filter(([method, path]) => method === 'delete' && path === '/admin/priority/lock').length)).toBe(1);
});

test('архивирование и восстановление в черновике сохраняют кнопки, блокировку цвета и фокус', async ({ page }) => {
  await dictionary(page);
  const row = page.locator('.dict-editor-row[data-item-id="1"]');
  await row.getByLabel('Название', { exact: true }).fill('');
  await expect(page.locator('.modal-save-btn')).toBeDisabled();
  await row.getByRole('button', { name: 'Архивировать', exact: true }).click();
  await expect(row).toHaveClass(/is-archived/);
  await expect(row.getByRole('button', { name: 'Выбрать цвет' })).toBeDisabled();
  await expect(row.getByRole('button', { name: 'Восстановить' })).toBeFocused();
  await expect(row.getByRole('button', { name: 'Восстановить' })).toHaveClass(/ui-btn/);
  await expect(page.locator('.modal-save-btn')).toBeEnabled();
  await row.getByRole('button', { name: 'Восстановить' }).click();
  await expect(row.getByLabel('Название', { exact: true })).toBeEnabled();
  await expect(row.getByRole('button', { name: 'Выбрать цвет' })).toBeEnabled();
  await expect(row.getByRole('button', { name: 'Архивировать', exact: true })).toBeFocused();
  await expect(page.locator('.modal-save-btn')).toBeDisabled();
  await row.getByLabel('Название', { exact: true }).fill('Высокий');
  await expect(page.locator('.modal-save-btn')).toBeEnabled();
  await discard(page);
});

test('цвет выбирается клавиатурой, Escape закрывает только палитру', async ({ page }) => {
  await dictionary(page);
  const row = page.locator('.dict-editor-row[data-item-id="1"]');
  const swatch = row.getByRole('button', { name: 'Выбрать цвет' });
  await swatch.focus();
  await page.keyboard.press('Enter');
  const palette = page.getByRole('dialog', { name: 'Цвет значения' });
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
  await expect(page.locator('#admin-modal-overlay')).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(swatch).toBeFocused();
  await swatch.click();
  await expect(palette.getByRole('button', { name: 'Цвет #6366f1', exact: true })).toBeFocused();
  await palette.getByRole('button', { name: 'Цвет #10b981', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(row.locator('.dict-color-input')).toHaveValue('#10b981');
  await expect(swatch).toHaveAttribute('aria-expanded', 'false');
  await expect(swatch).toBeFocused();
  await discard(page);
});

test('чужая блокировка не открывает справочник с клавиатуры', async ({ page }) => {
  await open(page, 'dictionaries', 'locked=true');
  const card = page.getByRole('button', { name: 'Приоритеты', exact: true });
  await expect(card).toHaveAttribute('aria-disabled', 'true');
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#admin-modal-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => window.__apiCalls.filter(([method]) => method !== 'get'))).toEqual([]);
});

test('ставки сохраняют ноль и кавычки, новые ячейки используют тот же доступный контрол', async ({ page }) => {
  await dictionary(page, 'competencyCosts');
  await expect(page.getByLabel('Frontend "UI" <тест>, 2026, рублей в день', { exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'Добавить год' }).click();
  await page.getByLabel('Новый год').fill('1999');
  await page.locator('#cc-inline-confirm').click();
  await expect(page.getByLabel('Новый год')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Новый год').fill('2027');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Frontend "UI" <тест>, 2027, рублей в день', { exact: true })).toHaveClass(/ui-control/);
  await page.getByRole('button', { name: 'Добавить компетенцию' }).click();
  await page.getByLabel('Новая компетенция').fill('QA "API"');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('QA "API", 2026, рублей в день', { exact: true })).toBeVisible();
  await expect(page.getByLabel('QA "API", 2027, рублей в день', { exact: true })).toHaveValue('');
  await discard(page);
});

for (const theme of ['light', 'dark']) {
  for (const editor of ['roles', 'priorities']) {
    test(`мобильный редактор ${editor} в ${theme}: контролы и действия доступны`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 });
      if (editor === 'roles') {
        await open(page, 'roles', `theme=${theme}`);
        await page.locator('.admin-edit-btn[data-type="role"]').click();
        await page.getByRole('button', { name: 'Основное', exact: true }).click();
      } else await dictionary(page, 'priorities', `theme=${theme}`);
      const dialog = page.locator('#admin-modal-overlay [role="dialog"]');
      const bounds = await dialog.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
      expect(await page.locator('.modal-body-scroll').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator('.modal-save-btn')).toBeInViewport();
      const controls = page.locator('#admin-modal-overlay .ui-control:visible');
      for (const height of await controls.evaluateAll(items => items.map(item => item.getBoundingClientRect().height))) expect(height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath(`${editor}-${theme}.png`), fullPage: true });
      if (editor === 'priorities') {
        await page.locator('.dict-color-swatch').first().click();
        const palette = page.getByRole('dialog', { name: 'Цвет значения' });
        await expect(palette).toBeVisible();
        expect(await palette.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
        await page.screenshot({ path: testInfo.outputPath(`palette-${theme}.png`), fullPage: true });
      }
    });
  }
}
