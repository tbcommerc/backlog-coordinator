import { test, expect } from '@playwright/test';

async function open(page, query = '') {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/e2e/fixtures/uiKitAdminReports.html?${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  expect(errors).toEqual([]);
}

test('закрытое администрирование не загружает данные; частичный доступ скрывает аудит', async ({ page }) => {
  await open(page, 'access=none');
  await expect(page.getByRole('heading', { name: 'Недостаточно прав' })).toBeVisible();
  expect(await page.evaluate(() => window.__apiCalls)).toEqual([]);
  await open(page, 'access=partial');
  await expect(page.locator('#admin-tab-audit')).toHaveCount(0);
  await expect(page.locator('#admin-tab-teams')).toHaveAttribute('aria-selected', 'true');
});

test('административные вкладки получают фокус стрелками и активируются Enter', async ({ page }) => {
  await open(page);
  await page.locator('#admin-tab-teams').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#admin-tab-projects')).toBeFocused();
  await expect(page.locator('#admin-tab-teams')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect(page.locator('#admin-tab-projects')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#admin-content')).toHaveAttribute('aria-labelledby', 'admin-tab-projects');
  await expect(page).toHaveURL(/admin_tab=projects/);
});

test('ошибка чтения показывает общее состояние и позволяет загрузить данные повторно', async ({ page }) => {
  await open(page, 'readError=true');
  await expect(page.locator('.view-state-error')).toBeVisible();
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.admin-list-count')).toHaveText('Найдено: 23');
});

test('поиск, сброс и пагинация сохраняют управление списком', async ({ page }) => {
  await open(page);
  await expect(page.locator('.admin-list-count')).toHaveText('Найдено: 23');
  await page.locator('.ui-pagination').getByRole('button', { name: 'Далее' }).click();
  await expect(page.locator('.ui-pagination')).toContainText('21–23 из 23');
  await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('Команда "А" <тест>');
  await expect(page.locator('.admin-list-count')).toHaveText('Найдено: 1');
  await expect(page.locator('.admin-edit-btn[data-type="team"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await expect(page.locator('.admin-list-count')).toHaveText('Найдено: 23');
  await expect(page.locator('.ui-pagination')).toContainText('1–20 из 23');
});

test('форма команды экранирует данные, связывает подсказку и возвращает фокус без записи', async ({ page }) => {
  await open(page);
  const edit = page.locator('.admin-edit-btn[data-type="team"][data-id="1"]');
  await edit.click();
  await expect(page.locator('#modal-name')).toHaveValue('Команда "А" <тест>');
  await expect(page.locator('#modal-abbr')).toHaveAttribute('aria-describedby', 'modal-abbr-hint');
  await page.locator('.modal-cancel-btn').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(edit).toBeFocused();
  expect(await page.evaluate(() => window.__apiCalls.filter(([method]) => method !== 'get'))).toEqual([]);
});





test('фильтры директорского отчёта применяются и сбрасываются', async ({ page }) => {
  await open(page, 'surface=directorate');
  const project = page.getByLabel('Проект', { exact: true });
  await project.selectOption('Витрина');
  await expect(page.locator('[data-open-directorate-task]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await expect(project).toHaveValue('');
  await expect(page.locator('[data-open-directorate-task]')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Сбросить фильтры' })).toBeDisabled();
});



test('фильтр заказчика сохраняет действующие статусы', async ({ page }) => {
  await open(page, 'surface=customer');
  await page.getByLabel('Статус задачи').selectOption('ВЫПОЛНЕНА');
  await expect(page.locator('#customer-tasks-tbody tr')).toHaveCount(1);
  await expect(page.locator('#customer-tasks-tbody')).toContainText('Проверить API');
});

test('форма даты встречи доступна по меткам и закрывается без изменения встречи', async ({ page }) => {
  await open(page, 'surface=meetings');
  await page.locator('[data-meeting-action="schedule"]').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Дата встречи')).toHaveValue('2026-10-13');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.__apiCalls.filter(([method]) => method !== 'get'))).toEqual([]);
});

for (const surface of ['directorate', 'customer', 'meetings']) {
  test(`мобильный отчёт ${surface}: страница не выходит за ширину экрана`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `surface=${surface}&theme=dark`);
    const widths = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(widths.content).toBeLessThanOrEqual(widths.viewport + 1);
    await page.screenshot({ path: testInfo.outputPath(`${surface}-mobile.png`), fullPage: true });
  });
}


for (const width of [1536, 390]) test(`удалённый раздел отчётов недоступен: ${width}`, async ({page}) => {
  await page.setViewportSize({width,height:864});
  await open(page, 'admin_tab=reports');
  await expect(page.locator('#admin-tab-reports')).toHaveCount(0);
  await expect(page.locator('#admin-tab-mobile-select option[value="reports"]')).toHaveCount(0);
  await expect(page.locator('[data-type="report"], [data-admin-report-id], .report-wizard')).toHaveCount(0);
  await expect(page.locator('#admin-content')).toHaveAttribute('data-admin-tab','teams');
  expect(await page.evaluate(() => window.__apiCalls.filter(([,path]) => path.startsWith('/reports')))).toEqual([]);
});
