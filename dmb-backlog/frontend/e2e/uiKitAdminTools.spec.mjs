import { test, expect } from '@playwright/test';

const errors = new WeakMap();
async function open(page, params = '') {
  const messages = [];
  errors.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  await page.goto(`/e2e/fixtures/uiKitAdminReports.html?dialogA11y=true&${params}`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
}
const writes = page => page.evaluate(() => window.__apiCalls.filter(call => call[0] === 'write'));
test.afterEach(async ({ page }) => {
  expect(errors.get(page) || []).toEqual([]);
  expect(await page.evaluate(() => window.__blockedWrites || [])).toEqual([]);
});

test('событие сохраняет значения, подписи и фокус при открытии и отмене', async ({ page }, info) => {
  await open(page, 'admin_tab=home');
  const trigger = page.getByRole('button', { name: 'Редактировать событие' });
  await trigger.click();
  await expect(page.getByLabel(/^Название/)).toHaveValue('Релиз "А" <тест>');
  await expect(page.getByLabel(/^Дата/)).toHaveValue('2026-10-20');
  await expect(page.getByLabel('Повторение', { exact: true })).toHaveValue('monthly');
  await expect(page.getByLabel('Показывать на уровне')).toHaveValue('quarter');
  await expect(page.getByLabel(/^Название/)).toBeFocused();
  await page.screenshot({ path: info.outputPath('timeline-desktop.png') });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await writes(page)).toEqual([]);
});

test('событие: ошибки полей, выбор цвета, единственная отправка, сохранение черновика и повтор', async ({ page }) => {
  await open(page, 'admin_tab=home');
  await page.getByRole('button', { name: 'Добавить событие' }).click();
  const save = page.locator('#tl-modal-save');
  await save.click();
  const title = page.getByLabel(/^Название/);
  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await title.fill('Новый релиз');
  await expect(title).not.toHaveAttribute('aria-invalid', 'true');
  await save.click();
  await expect(page.getByLabel(/^Дата/)).toBeFocused();
  await page.getByLabel(/^Дата/).fill('2026-11-10');
  await page.getByLabel('Повторение', { exact: true }).selectOption('weekly');
  await page.getByLabel('Показывать на уровне').selectOption('month');
  const color = page.locator('#tl-color-palette [data-color]').nth(2);
  const value = await color.getAttribute('data-color');
  await color.focus();
  await page.keyboard.press('Space');
  await expect(color).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#tl-color-palette [aria-pressed="true"]')).toHaveCount(1);
  await page.evaluate(() => { window.__holdWrite = true; window.__failWrite = true; });
  await save.click();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await save.dispatchEvent('click');
  expect(await writes(page)).toHaveLength(1);
  await expect(title).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => window.__releaseWrite());
  await expect(save).toBeEnabled();
  await expect(title).toHaveValue('Новый релиз');
  await save.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const calls = await writes(page);
  expect(calls).toHaveLength(2);
  expect(calls[1][2]).toMatchObject({ title: 'Новый релиз', date: '2026-11-10', color: value, is_recurring: true, recurring_interval: 'weekly', visibility_level: 'month', description: null });
  await expect(page.getByRole('cell', { name: /Новый релиз/ })).toBeVisible();
});

test('изменённое событие закрывается только после подтверждения с возвратом фокуса', async ({ page }) => {
  await open(page, 'admin_tab=home');
  const trigger = page.getByRole('button', { name: 'Добавить событие' });
  await trigger.click();
  await page.getByLabel(/^Название/).fill('Черновик');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toHaveCount(0);
  await expect(page.getByLabel(/^Название/)).toHaveValue('Черновик');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await confirm.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await writes(page)).toEqual([]);
});

test('таймлайн использует общее состояние ошибки и повтор загрузки', async ({ page }) => {
  await open(page, 'admin_tab=home&readError=true');
  await expect(page.locator('.view-state-error')).toBeVisible();
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Редактировать событие' })).toBeVisible();
});

test('колонки: название с кавычками, native checkbox, порядок, busy и повтор после ошибки', async ({ page }, info) => {
  await open(page, 'admin_tab=display');
  const rows = page.locator('.display-col-item');
  await expect(rows.first()).toHaveAttribute('data-col', 'title');
  const titleRow = page.locator('[data-col="title"].display-col-item');
  const title = titleRow.getByRole('textbox');
  await expect(title).toHaveValue('Задача "А" <тест>');
  const visible = titleRow.getByRole('checkbox');
  await expect(visible).toBeChecked();
  await visible.focus();
  await page.keyboard.press('Space');
  await expect(visible).not.toBeChecked();
  const handle = titleRow.getByRole('button');
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  await expect(handle).toBeFocused();
  await expect(rows.nth(1)).toHaveAttribute('data-col', 'title');
  await expect(page.locator('#display-order-status')).toContainText('Позиция 2');
  await title.fill('Новая подпись');
  await page.screenshot({ path: info.outputPath('display-desktop.png') });
  await page.evaluate(() => { window.__holdWrite = true; window.__failWrite = true; });
  const save = page.locator('#save-display-settings');
  await save.click();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await save.dispatchEvent('click');
  expect(await writes(page)).toHaveLength(1);
  await page.evaluate(() => window.__releaseWrite());
  await expect(save).toBeEnabled();
  await expect(page.locator('#display-save-status')).toContainText('Повторите');
  await expect(title).toHaveValue('Новая подпись');
  await save.click();
  await expect(page.locator('#display-save-status')).toHaveText('Настройки сохранены');
  const calls = await writes(page);
  expect(calls).toHaveLength(3);
  expect(Object.keys(calls[1][2].settings).slice(0, 2)).toEqual(['id', 'title']);
  expect(calls[1][2].settings.title).toBe(false);
  expect(calls[2][2].labels.title).toBe('Новая подпись');
  await page.getByRole('tab', { name: 'Команды', exact: true }).click();
  await page.getByRole('tab', { name: 'Отображение', exact: true }).click();
  await expect(rows.first()).toHaveAttribute('data-col', 'id');
  await expect(page.locator('[data-col="title"].display-col-item').getByRole('textbox')).toHaveValue('Новая подпись');
});

test('режим чтения не позволяет менять события и настройки колонок', async ({ page }) => {
  await open(page, 'admin_tab=home&access=read');
  await expect(page.getByRole('button', { name: 'Добавить событие' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Редактировать событие' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Отображение', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сохранить настройки' })).toHaveCount(0);
  expect(await page.locator('.display-col-list input:not(:disabled)').count()).toBe(0);
  await expect(page.locator('.display-col-item').first()).toHaveAttribute('draggable', 'false');
  expect(await writes(page)).toEqual([]);
});

test('аналитика: общие фильтры сохраняют расчёты, выбор проекта и семантику навигации', async ({ page }, info) => {
  await open(page, 'surface=analytics');
  await expect(page.locator('.view-state-error')).toHaveCount(0);
  await expect(page.locator('#effort-period')).toHaveValue('q4_2026');
  await expect(page.locator('#dcNum')).toHaveText('10');
  await page.locator('#effort-period').selectOption('q3_2026');
  await expect(page.locator('#dcNum')).toHaveText('11');
  await expect(page.locator('#effort-team')).toHaveAccessibleName('Команда');
  await page.locator('#effort-team').selectOption('Команда А');
  await expect(page.locator('#tTasks')).toHaveText('1');
  await page.screenshot({ path: info.outputPath('analytics-desktop.png') });
  const nav = page.getByRole('navigation', { name: 'Навигация по отчётам' });
  await nav.getByRole('button', { name: 'Поток задач', exact: true }).click();
  await expect(nav.getByRole('button', { name: 'Поток задач', exact: true })).toHaveAttribute('aria-current', 'location');
  await page.locator('#sankey-mode').selectOption('days');
  await page.getByRole('button', { name: 'Команда ↔ Тип задачи', exact: true }).click();
  await expect(page.locator('#sankey-mode')).toHaveValue('days');
  const chip = page.locator('#quarter-teams .an-chip').first();
  await chip.click();
  await expect(page.locator('#quarter-teams .an-chip').first()).toHaveAttribute('aria-pressed', 'true');
  const search = page.getByLabel('Найти и выбрать проект');
  await search.fill('Платформа');
  await expect(search).toHaveValue('Платформа');
  await search.fill('Несуществующий проект');
  await search.press('Tab');
  await expect(search).toHaveValue('Платформа');
  expect(await writes(page)).toEqual([]);
});

test('аналитика: ошибка загрузки и повтор восстанавливают рабочие фильтры', async ({ page }) => {
  await open(page, 'surface=analytics&readError=true');
  await expect(page.locator('.view-state-error')).toBeVisible();
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('#dcNum')).toHaveText('10');
  await expect(page.locator('.view-state-error')).toHaveCount(0);
  await page.locator('#dep-threshold').selectOption('3');
  await expect(page.locator('#dep-threshold')).toHaveValue('3');
});

test('аналитика PO/PL: период и поле работают через общие контролы', async ({ page }) => {
  await open(page, 'surface=analytics&type=po-pl');
  await expect(page.locator('.view-state-error')).toHaveCount(0);
  await page.getByLabel('Период', { exact: true }).selectOption('q3_2026');
  await expect(page.locator('#complete-matrix .an-task-count').first()).toHaveText('1');
  await page.getByLabel('Поле', { exact: true }).selectOption('priority_name');
  await expect(page.getByLabel('Поле', { exact: true })).toHaveValue('priority_name');
});

for (const theme of ['light', 'dark']) {
  for (const surface of ['home', 'display', 'analytics']) {
    test(`мобильный ${surface}, ${theme}: без переполнения, общие контролы доступны`, async ({ page }, info) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, `${surface === 'analytics' ? 'surface=analytics' : `admin_tab=${surface}`}&theme=${theme}`);
      if (surface === 'home') await page.getByRole('button', { name: 'Добавить событие' }).click();
      await expect.poll(async () => page.locator('input.ui-control, select.ui-control').evaluateAll(elements => Math.min(...elements.filter(el => el.getBoundingClientRect().width > 0).map(el => el.getBoundingClientRect().height)))).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      if (surface === 'home') {
        await expect(page.getByRole('button', { name: 'Создать', exact: true })).toBeInViewport();
        await expect(page.getByRole('button', { name: 'Отмена', exact: true })).toBeInViewport();
        expect(await page.locator('#tl-color-palette button').first().evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      }
      if (surface === 'display') expect(await page.locator('.ui-checkbox').first().evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      if (surface === 'analytics') {
        const clipped = await page.locator('.an-report .ui-control').evaluateAll(controls => controls.filter(control => {
          const rect = control.getBoundingClientRect();
          const card = control.closest('.an-report').getBoundingClientRect();
          return rect.width && (rect.left < card.left || rect.right > card.right + 1);
        }).map(control => control.id));
        expect(clipped).toEqual([]);
      }
      await page.screenshot({ path: info.outputPath(`${surface}-${theme}.png`) });
    });
  }
}
