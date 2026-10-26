import { test, expect } from '@playwright/test';

async function open(page, query = '') {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/e2e/fixtures/uiKitAdminReports.html?${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  expect(errors).toEqual([]);
}

async function editReport(page, query = '') {
  await open(page, `admin_tab=reports&${query}`);
  await page.locator('.admin-edit-btn[data-type="report"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.report-step-panel:visible')).toHaveCount(1);
  const contrast = await page.locator('.report-step[aria-selected="true"]').evaluate(element => {
    const style = getComputedStyle(element);
    const rgba = color => color.match(/[\d.]+/g).map(Number);
    const luminance = rgb => rgb.slice(0, 3).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const layers = [];
    for (let current = element; current; current = current.parentElement) layers.unshift(rgba(getComputedStyle(current).backgroundColor));
    const background = layers.reduce((under, over) => over.slice(0, 3).map((channel, index) => channel * (over[3] ?? 1) + under[index] * (1 - (over[3] ?? 1))), [255, 255, 255]);
    const a = luminance(rgba(style.color)), b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
}

test('закрытое администрирование не загружает данные; частичный доступ скрывает аудит', async ({ page }) => {
  await open(page, 'access=none');
  await expect(page.getByRole('heading', { name: 'Недостаточно прав' })).toBeVisible();
  expect(await page.evaluate(() => window.__apiCalls)).toEqual([]);
  await open(page, 'access=partial');
  await expect(page.locator('#admin-tab-audit')).toHaveCount(0);
  await expect(page.locator('#admin-tab-teams')).toHaveAttribute('aria-selected', 'true');
});

test('административные вкладки переключаются стрелками и связываются с панелью', async ({ page }) => {
  await open(page);
  await page.locator('#admin-tab-teams').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#admin-tab-projects')).toBeFocused();
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
  await page.locator('.admin-pagination').getByRole('button', { name: 'Далее' }).click();
  await expect(page.locator('.admin-pagination')).toContainText('21–23 из 23');
  await page.getByRole('searchbox', { name: 'Поиск', exact: true }).fill('Команда "А" <тест>');
  await expect(page.locator('.admin-list-count')).toHaveText('Найдено: 1');
  await expect(page.locator('.admin-edit-btn[data-type="team"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await expect(page.locator('.admin-list-count')).toHaveText('Найдено: 23');
  await expect(page.locator('.admin-pagination')).toContainText('1–20 из 23');
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

test('конструктор сохраняет ноль, false, порядок полей и направление сортировки', async ({ page }, testInfo) => {
  await editReport(page);
  await page.screenshot({ path: testInfo.outputPath('admin-report-desktop.png'), fullPage: true });
  await page.locator('#report-step-1').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#report-step-2')).toBeFocused();
  await expect(page.locator('#report-panel-2')).toBeVisible();
  await page.locator('.report-selected-field[data-field="title"] .report-field-up').click();
  await page.locator('#report-step-3').click();
  const rows = page.locator('.report-filter-row');
  expect(await page.locator('.report-wizard-main').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect(rows.nth(0).getByLabel('Значение фильтра')).toHaveValue('0');
  await expect(rows.nth(1).getByLabel('Значение фильтра')).toHaveValue('false');
  await page.locator('#report-step-4').click();
  await page.getByLabel('Сортировка', { exact: true }).selectOption('title');
  await page.getByLabel('Направление').selectOption('desc');
  await page.locator('.modal-save-btn').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const payload = await page.evaluate(() => window.__apiCalls.find(([method]) => method === 'post')[2]);
  expect(JSON.parse(payload.fields)).toEqual(['title', 'id']);
  expect(JSON.parse(payload.filters)).toEqual([{ field: 'progress', operator: 'gt', value: 0 }, { field: 'did_demo', operator: 'equals', value: false }]);
  expect(payload.sort_by).toBe('title');
  expect(payload.sort_order).toBe('desc');
});

test('ошибка сохранения оставляет черновик и восстанавливает кнопку; двойной запрос исключён', async ({ page }) => {
  await editReport(page);
  await page.getByLabel('Название отчёта').fill('Сохранённый черновик');
  await page.evaluate(() => { window.__holdWrite = true; window.__failWrite = true; });
  const save = page.locator('.modal-save-btn');
  await save.click();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await expect(save).toBeDisabled();
  await page.keyboard.press('Control+s');
  expect(await page.evaluate(() => window.__apiCalls.filter(([method]) => method === 'post'))).toHaveLength(1);
  await page.evaluate(() => window.__releaseWrite());
  await expect(page.locator('#admin-form-error-summary')).toContainText('Введённые данные сохранены в форме');
  await expect(page.getByLabel('Название отчёта')).toHaveValue('Сохранённый черновик');
  await expect(save).not.toHaveAttribute('aria-busy');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
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

test('отчёт открывается и выполняется из административного списка', async ({ page }) => {
  await open(page, 'admin_tab=reports');
  await page.locator('[data-admin-report-id="42"] h4').click();
  await page.locator('#report-execute-btn').click();
  await expect(page.locator('#report-execution-result tbody tr')).toHaveCount(2);
  await expect(page.locator('#report-execution-result')).toContainText('Подготовить витрину');
  await page.locator('#report-view-back').click();
  await expect(page.locator('[data-admin-report-id="42"]')).toBeVisible();
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

for (const theme of ['light', 'dark']) {
  test(`мобильный конструктор ${theme}: поля и действия помещаются в диалог`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await editReport(page, `theme=${theme}`);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    await page.locator('#report-step-3').click();
    const geometry = await page.locator('.report-filter-row .ui-control').evaluateAll(items => items.map(item => { const rect = item.getBoundingClientRect(); return { left: rect.left, right: rect.right, height: rect.height }; }));
    for (const item of geometry) { expect(item.left).toBeGreaterThanOrEqual(0); expect(item.right).toBeLessThanOrEqual(391); expect(item.height).toBeGreaterThanOrEqual(44); }
    await expect(page.locator('.modal-save-btn')).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`admin-report-${theme}.png`), fullPage: true });
  });
}

for (const theme of ['light','dark']) for (const mode of ['desktop','compact','mobile','touch']) {
  test(`report editor action geometry: ${theme}, ${mode}`, async({browser})=>{
    const context=await browser.newContext({viewport:{width:mode==='mobile'?390:1440,height:900},hasTouch:mode==='touch'});
    const page=await context.newPage();await editReport(page,`theme=${theme}`);
    await page.evaluate(mode=>document.documentElement.dataset.compact=String(mode==='compact'),mode);
    await page.locator('#report-step-3').click();
    const remove=page.getByRole('button',{name:'Удалить фильтр'}).first();
    const box=await remove.boundingBox();expect(box.height).toBe(['mobile','touch'].includes(mode)?44:28);expect(box.width).toBe(box.height);
    const count=await page.locator('.report-filter-row').count();await remove.click();await expect(page.locator('.report-filter-row')).toHaveCount(count-1);
    expect(await page.evaluate(()=>window.__blockedWrites)).toEqual([]);await context.close();
  });
}
