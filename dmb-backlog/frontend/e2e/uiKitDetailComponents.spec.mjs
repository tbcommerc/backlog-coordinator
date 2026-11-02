import { test, expect } from '@playwright/test';

async function mount(page, { theme = 'light', width = 1280, spa = false } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/ui-catalog/core.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(async ({ theme, spa }) => {
    if (spa) await import('/e2e/fixtures/spaStyles.js');
    const ui = await import('/js/ui/index.js');
    window.detailUi = ui;
    document.documentElement.dataset.theme = theme;
    document.body.innerHTML = '<main style="padding:16px;min-width:0"><button id="origin">Открыть</button><div id="sample"></div><div id="inline"></div></main>';
    window.disposeModal = ui.initModalAccessibility();
  }, { theme, spa });
}

test('catalogue exposes shared detail components and working panel', async ({ page }, testInfo) => {
  await page.setViewportSize({width:1280,height:900});
  await page.goto('/ui-catalog/index.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  const sample=page.locator('#detail-components');
  await expect(sample.locator('.ui-readonly-field').filter({has:page.locator('dt',{hasText:'Оценка'})})).toContainText('0');
  await sample.screenshot({path:testInfo.outputPath('catalogue-details.png')});
  await page.getByRole('button',{name:'Открыть панель деталей'}).click();
  await expect(page.getByRole('dialog',{name:'Рабочая задача',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#catalog-detail')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Открыть панель деталей'})).toBeFocused();
});

for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
  test(`detail fields and sections ${theme}/${width}`, async ({ page }, testInfo) => {
    await mount(page, { theme, width, spa: true });
    await page.evaluate(() => {
      const ui = window.detailUi;
      document.querySelector('#sample').innerHTML = ui.sectionCard({ title: 'Паспорт', content: ui.descriptionList({ items: [
        { label: 'Ноль', value: 0 }, { label: 'Нет значения', value: null },
        { label: 'Загрузка', state: 'loading' }, { label: 'Ошибка', state: 'error', message: 'Нет ответа' },
        { label: 'Текст', value: '<img src=x onerror=alert(1)>' },
        { label: 'Длинное значение', value: 'НеразрывноеЗначение'.repeat(40) },
        { label: 'Небезопасная ссылка', value: 'Название', href: 'javascript:alert(1)' },
        { label: 'Задача', value: 'WRK-1', href: '#/work-tasks/1' },
        { label: 'Скрыто', value: 'hidden', attrs: { hidden: true } },
      ] }), footer: 'Обновлено сегодня' }) + ui.sectionCard({ title: 'Подробности', collapsible: true, open: false, content: '<p id="collapsed">Содержимое</p>' });
    });
    const fields = page.locator('.ui-readonly-field');
    await expect(fields.filter({ has: page.locator('dt', { hasText: /^Ноль$/ }) }).locator('dd')).toHaveText('0');
    await expect(fields.filter({ has: page.locator('dt', { hasText: /^Нет значения$/ }) }).locator('dd')).toHaveText('—');
    await expect(page.locator('[data-ui-state=loading]')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('[data-ui-state=error]')).toContainText('Нет ответа');
    await expect(page.locator('#sample img')).toHaveCount(0);
    await expect(page.locator('#sample a')).toHaveCount(1);
    await expect(fields.filter({ hasText: 'Скрыто' })).toBeHidden();
    await expect(page.locator('#collapsed')).toBeHidden();
    await page.locator('summary.ui-section-header').press('Enter');
    await expect(page.locator('#collapsed')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    if (width !== 320) await page.screenshot({ path: testInfo.outputPath('detail-components.png'), fullPage: true });
  });
}

test('copy reports success and failure, disposal removes the handler', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const ui = window.detailUi;
    document.querySelector('#sample').innerHTML = ui.readOnlyField({ label: 'Код', value: 'WRK-1', copy: true });
    window.copied = [];
    window.disposeCopy = ui.bindReadOnlyFields(document.querySelector('#sample'), { writeText: async value => {
      window.copied.push(value); if (window.failCopy) throw Error('denied');
    } });
  });
  await page.getByRole('button', { name: 'Копировать: Код' }).click();
  await expect(page.getByRole('status')).toHaveText('Скопировано');
  await page.evaluate(() => { window.failCopy = true; });
  await page.getByRole('button', { name: 'Копировать: Код' }).click();
  await expect(page.getByRole('status')).toHaveText('Не удалось скопировать');
  await page.evaluate(() => window.disposeCopy());
  await page.getByRole('button', { name: 'Копировать: Код' }).click();
  expect(await page.evaluate(() => window.copied)).toEqual(['WRK-1', 'WRK-1']);
});

test('panel preserves focused field across modes and guards every Escape', async ({ page }) => {
  await mount(page);
  await page.locator('#origin').focus();
  await page.evaluate(() => {
    const ui = window.detailUi, host = document.createElement('div');
    host.innerHTML = ui.detailPanel({ id: 'details', title: 'Карточка', body: ui.field({ id: 'draft', label: 'Черновик' }) });
    window.closeRequests = [];
    window.panel = ui.bindDetailPanel(host.firstElementChild, { isBusy: () => window.panelBusy, onClose: reason => { window.closeRequests.push(reason); return false; } });
    window.panel.present();
  });
  await expect(page.locator('#details')).toHaveAttribute('aria-modal', 'true');
  await page.locator('#draft').fill('Сохранить введённое');
  await page.evaluate(() => { window.panelBusy = true; });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  expect(await page.evaluate(() => window.closeRequests)).toEqual([]);
  await page.evaluate(() => { window.panelBusy = false; });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.closeRequests)).toEqual(['escape']);
  await expect(page.locator('#details')).toBeVisible();
  await page.locator('#draft').focus();
  await page.evaluate(() => window.panel.present({ container: document.querySelector('#inline') }));
  await expect(page.locator('#details')).toHaveAttribute('role', 'region');
  await expect(page.locator('#details')).not.toHaveAttribute('aria-modal');
  await expect(page.locator('#draft')).toHaveValue('Сохранить введённое');
  await expect(page.locator('#draft')).toBeFocused();
  await page.locator('#draft').focus();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.closeRequests)).toEqual(['escape', 'escape']);
  await page.evaluate(() => window.panel.present({ fullscreen: true }));
  await expect(page.locator('#details')).toHaveClass(/ui-detail-panel-fullscreen/);
  await expect(page.locator('#draft')).toHaveValue('Сохранить введённое');
  await expect(page.locator('#draft')).toBeFocused();
});

test('an existing panel keeps its container and delegated actions', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const ui = window.detailUi, root = document.querySelector('#sample');
    root.innerHTML = ui.detailPanel({id:'owned',title:'Карточка',body:ui.button({label:'Действие',attrs:{'data-owned-action':''}})});
    window.ownedClicks = 0;
    root.addEventListener('click',event => { if(event.target.closest('[data-owned-action]')) window.ownedClicks++; });
    ui.bindDetailPanel(root.firstElementChild).present();
  });
  await page.getByRole('button',{name:'Действие',exact:true}).click();
  expect(await page.evaluate(() => window.ownedClicks)).toBe(1);
  await expect(page.locator('#sample > dialog')).toBeVisible();
});

test('default panel restores focus and fits mobile; footer stays visible', async ({ page }) => {
  await mount(page, { width: 320 });
  await page.locator('#origin').focus();
  await page.evaluate(() => {
    const ui = window.detailUi, host = document.createElement('div');
    host.innerHTML = ui.detailPanel({ id: 'details', title: 'Очень длинное название карточки', body: '<p>Строка</p>'.repeat(80), footer: 'Действия панели' });
    ui.bindDetailPanel(host.firstElementChild).present();
  });
  const footer = await page.locator('.ui-detail-panel-footer').boundingBox();
  expect(footer.y + footer.height).toBeLessThanOrEqual(901);
  await expect(page.locator('.ui-detail-panel-body')).toHaveCSS('overflow-y', 'auto');
  await page.keyboard.press('Escape');
  await expect(page.locator('#details')).toHaveCount(0);
  await expect(page.locator('#origin')).toBeFocused();
});

test('section states and hidden do not expose stale body', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    document.querySelector('#sample').innerHTML = ['loading', 'empty', 'error'].map(state => window.detailUi.sectionCard({title:state,state,content:'Устаревшее значение'})).join('') + window.detailUi.sectionCard({title:'Скрыто',attrs:{hidden:true}});
  });
  await expect(page.locator('#sample')).not.toContainText('Устаревшее значение');
  await expect(page.getByRole('alert')).toHaveText('Не удалось загрузить раздел');
  await expect(page.locator('.ui-section-card[hidden]')).toBeHidden();
});
