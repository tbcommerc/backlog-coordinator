import { test, expect } from '@playwright/test';

async function insideViewport(panel) {
  const box = await panel.boundingBox();
  const viewport = await panel.page().evaluate(() => ({width:innerWidth,height:innerHeight}));
  expect(box.x).toBeGreaterThanOrEqual(7);
  expect(box.y).toBeGreaterThanOrEqual(7);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 7);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 7);
}
async function checkGeometry(page, target) {
  const controls = await page.locator('.ui-popover:visible .btn').evaluateAll(items=>items.map(item=>({
    text:item.textContent, square:item.matches('.square-icon'), width:item.getBoundingClientRect().width, height:item.getBoundingClientRect().height,
  })));
  for (const item of controls) {
    expect(item.height,item.text).toBeGreaterThanOrEqual(target);
    if (item.square) expect(item.width,item.text).toBe(item.height);
  }
}
for (const theme of ['light','dark']) for (const mode of ['desktop','compact','mobile','touch']) {
  test(`составные панели: ${theme}, ${mode}`,async({browser},info)=>{
    const context = await browser.newContext({viewport:{width:mode==='mobile'?390:1280,height:800},hasTouch:mode==='touch'});
    const page = await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`/e2e/fixtures/uiKitComposites.html?theme=${theme}&compact=${mode==='compact'}`);
    await expect(page.locator('html')).toHaveAttribute('data-ready','true');
    const trigger=page.locator('#backlog-btn-column-settings');
    await trigger.click();
    const panel=page.getByRole('dialog',{name:'Настройка колонок'});
    await expect(panel).toBeVisible(); await insideViewport(panel); await checkGeometry(page,['mobile','touch'].includes(mode)?44:28);
    await expect(panel).toHaveCSS('background-color',theme==='dark'?'rgb(15, 15, 35)':'rgb(248, 250, 252)');
    await page.screenshot({path:info.outputPath('columns.png')});
    const column=panel.getByRole('checkbox',{name:'Задача'}); await column.focus(); await page.keyboard.press('Alt+ArrowDown');
    expect(await page.evaluate(()=>window.__columnOrder)).toEqual(['team','title','progress','status']);
    await page.keyboard.press('Escape'); await expect(panel).toBeHidden(); await expect(trigger).toBeFocused();
    const viewTrigger=page.locator('#backlog-saved-view-trigger');
    const triggerBox=await viewTrigger.boundingBox();
    expect(triggerBox.height).toBe(['mobile','touch'].includes(mode)?44:28);
    if(mode==='mobile') expect(triggerBox.width).toBe(44);
    await page.locator('#backlog-saved-view-save').click();
    await page.getByLabel('Название представления').fill('Длинное название представления '.repeat(2));
    await page.locator('#backlog-saved-view-confirm').click();
    await expect(page.locator('#backlog-saved-view-save')).toBeFocused();
    await page.locator('#backlog-saved-view-trigger').click();
    const views=page.getByRole('dialog',{name:'Сохранённые представления'});
    await expect(views.locator('.saved-view-item')).toHaveCount(1); await insideViewport(views); await checkGeometry(page,['mobile','touch'].includes(mode)?44:28);
    await page.screenshot({path:info.outputPath('saved-views.png')});
    await views.locator('.saved-view-rename').click(); await views.getByRole('textbox').fill('Черновик переименования');
    await page.keyboard.press('Escape'); await expect(views).toBeVisible(); await expect(views.locator('.saved-view-rename')).toBeFocused();
    await page.keyboard.press('Escape'); await expect(views).toBeHidden(); await expect(page.locator('#backlog-saved-view-trigger')).toBeFocused();
    await page.locator('#menu-trigger').click(); const menu=page.getByRole('menu'); await insideViewport(menu);
    await page.keyboard.press('End'); await expect(menu.getByRole('menuitem').last()).toBeFocused();
    await page.keyboard.press('Home'); await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown'); await expect(menu.getByRole('menuitem').last()).toBeFocused();
    await page.keyboard.press('Escape'); await expect(page.locator('#menu-trigger')).toBeFocused();
    await page.locator('#tooltip-trigger').focus(); const tooltip=page.getByRole('tooltip'); await expect(tooltip).toBeVisible(); await insideViewport(tooltip);
    await page.screenshot({path:info.outputPath('composites.png')});
    await page.keyboard.press('Escape'); await expect(tooltip).toBeHidden();
    expect(errors).toEqual([]); expect(await page.evaluate(()=>window.__writes)).toEqual([]); await context.close();
  });
  test(`фильтр реального отчёта: ${theme}, ${mode}`,async({browser})=>{
    const context=await browser.newContext({viewport:{width:mode==='mobile'?390:1280,height:800},hasTouch:mode==='touch'});
    const page=await context.newPage();
    await page.goto(`/e2e/fixtures/uiKitComposites.html?surface=report&theme=${theme}&compact=${mode==='compact'}`);
    const trigger=page.locator('.filter-trigger[data-field="team_name"]').first();
    await expect(trigger).toBeVisible(); await trigger.click();
    const panel=page.getByRole('dialog',{name:'Фильтр отчёта'}); await expect(panel).toBeVisible(); await insideViewport(panel);
    await expect(panel.locator('img')).toHaveCount(0);
    await panel.getByRole('checkbox',{name:'Команда Б',exact:true}).check();
    await expect(panel.getByRole('checkbox',{name:/Выбрать все/})).toHaveJSProperty('indeterminate',true);
    await expect(page.locator('.report-balanced-table tbody tr')).toHaveCount(1);
    await panel.getByRole('button',{name:'Сбросить'}).click();
    await expect(page.locator('.report-balanced-table tbody tr')).toHaveCount(2);
    await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0); await expect(trigger).toBeFocused();
    const box=await trigger.boundingBox(); expect(box.width).toBe(box.height); expect(box.height).toBe(['mobile','touch'].includes(mode)?44:28);
    await context.close();
  });
}

test('типизированный фильтр сохраняет выбор при поиске, применяет его и возвращает фокус после перерисовки',async({page})=>{
  await page.goto('/e2e/fixtures/uiKitComposites.html');
  await page.locator('#btn-ext-backlog').click();
  const trigger=page.locator('#f-backlog-ext-filters .filter-btn[data-key="status_name"]');
  await trigger.click(); const panel=page.getByRole('dialog',{name:'Фильтр: Статус'});
  await panel.getByRole('checkbox',{name:'В работе',exact:true}).check();
  await panel.getByRole('searchbox').fill('нет совпадений');
  await expect(panel.getByRole('status')).toHaveText('Ничего не найдено');
  await panel.getByRole('searchbox').fill('');
  await expect(panel.getByRole('checkbox',{name:'В работе',exact:true})).toBeChecked();
  await panel.getByRole('button',{name:'Применить'}).click();
  expect(await page.evaluate(()=>window.__visibleTasks)).toEqual([1]);
  await expect(trigger).toBeFocused();
  await trigger.click(); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
});

test('панель закрывается при Tab, клике снаружи и удалении триггера; пересчитывает границы после resize',async({page})=>{
  await page.goto('/e2e/fixtures/uiKitComposites.html');
  const trigger=page.locator('#backlog-btn-column-settings');
  await trigger.click();const panel=page.getByRole('dialog',{name:'Настройка колонок'});
  await page.setViewportSize({width:320,height:480}); await insideViewport(panel);
  await panel.getByRole('checkbox').last().focus();await page.keyboard.press('Tab');await expect(panel).toBeHidden();
  await page.setViewportSize({width:1280,height:800});
  await trigger.click();await page.locator('#next-control').click();await expect(panel).toBeHidden();await expect(page.locator('#next-control')).toBeFocused();
  await trigger.click();await trigger.evaluate(el=>el.closest('#page-content').replaceChildren());
  await expect(page.locator('.ui-popover:visible')).toHaveCount(0);
});

for(const width of [1440,390]) test(`вложенный каталог фильтров закрывает только верхнюю панель: ${width}`,async({page})=>{
  await page.setViewportSize({width,height:700});await page.goto('/e2e/fixtures/uiKitComposites.html');
  const trigger=page.locator('#btn-ext-backlog');await trigger.click();
  const catalog=page.getByRole('dialog',{name:'Все фильтры',exact:true});await expect(catalog).toBeVisible();await insideViewport(catalog);
  const searchGap = await catalog.locator('.filter-catalog-search').evaluate(input => {
    const icon = input.parentElement.querySelector('svg').getBoundingClientRect();
    const style = getComputedStyle(input);
    const textLeft = input.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    return textLeft - icon.right;
  });
  expect(searchGap, 'Текст поиска должен располагаться правее лупы с зазором').toBeGreaterThanOrEqual(8);
  await catalog.getByRole('searchbox',{name:'Найти фильтр'}).fill('Статус');
  const filter=catalog.locator('.filter-btn[data-key="status_name"]');await filter.click();
  const nested=page.getByRole('dialog',{name:'Фильтр: Статус',exact:true});await expect(nested).toBeVisible();await insideViewport(nested);
  await page.keyboard.press('Escape');await expect(nested).toHaveCount(0);await expect(catalog).toBeVisible();await expect(filter).toBeFocused();
  await page.keyboard.press('Escape');await expect(catalog).toBeHidden();await expect(trigger).toBeFocused();
  await trigger.click();await filter.click();await page.mouse.click(2,2);await expect(catalog).toBeHidden();await expect(nested).toHaveCount(0);
});

for (const width of [1440, 390]) test(`DMB keeps complete filter labels in one catalog: ${width}`, async ({page}) => {
  await page.setViewportSize({width, height: 700});
  await page.goto('/e2e/fixtures/uiKitComposites.html');
  await page.evaluate(async () => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/css/feedback.css'; document.head.append(css);
    const container = document.createElement('div'); container.id = 'toast-container'; document.body.append(container);
    const {showToast} = await import('/js/uiFeedback.js');
    window.toast = (message, type) => showToast(message, type, {persistent: true});
  });
  await page.locator('#btn-ext-backlog').click();
  const catalog = page.getByRole('dialog', {name: 'Все фильтры', exact: true});
  await expect(page.locator('#f-backlog-main-filters')).toBeHidden();
  await expect(catalog.locator('[data-pin-filter]')).toHaveCount(0);
  await expect(catalog.locator('.filter-label').first()).toBeVisible();
  await insideViewport(catalog);
  await expect(catalog).toBeVisible();
});

for (const width of [1440, 390]) test(`сброс фильтра не перекрывает раскрытие и закрепление: ${width}`, async ({page}) => {
  await page.setViewportSize({width, height: 800});
  await page.goto('/e2e/fixtures/uiKitComposites.html');
  await page.locator('#btn-ext-backlog').click();
  await page.locator('#f-backlog-ext-filters .filter-btn[data-key="status_name"]').click();
  const panel = page.getByRole('dialog', {name: 'Фильтр: Статус', exact: true});
  await panel.getByRole('checkbox', {name: 'В работе', exact: true}).check();
  await panel.getByRole('button', {name: 'Применить'}).click();
  async function checkCell(cell) {
    const field = await cell.locator('.filter-btn').boundingBox();
    const clear = await cell.locator('.filter-clear').boundingBox();
    expect(clear.x).toBeGreaterThanOrEqual(field.x + field.width + 4);
    expect(Math.abs(clear.y + clear.height / 2 - field.y - field.height / 2)).toBeLessThan(1);
  }
  const catalog = page.getByRole('dialog', {name: 'Все фильтры', exact: true});
  const cell = catalog.locator('.filter-cell[data-filter-key="status_name"]');
  await checkCell(cell);
  await cell.getByRole('button', {name: 'Очистить фильтр Статус', exact: true}).click();
  await expect(cell.locator('.filter-clear')).toHaveCount(0);
  await expect(cell.locator('.filter-value')).toHaveText('Все');
  expect(await page.evaluate(() => [...window.__visibleTasks].sort((a, b) => a - b))).toEqual([1, 2]);
});

for(const mode of ['desktop','compact','mobile','touch']) test(`report disclosure is square and keyboard accessible: ${mode}`,async({browser})=>{
  const context=await browser.newContext({viewport:{width:mode==='mobile'?390:1440,height:900},hasTouch:mode==='touch'});const page=await context.newPage();
  await page.goto(`/e2e/fixtures/uiKitComposites.html?surface=report&kind=did-operational&compact=${mode==='compact'}`);
  const toggle=page.getByRole('button',{name:/Развернуть или свернуть команду/});await expect(toggle).toBeVisible();
  const box=await toggle.boundingBox();expect(box.height).toBe(['mobile','touch'].includes(mode)?44:28);expect(box.width).toBe(box.height);
  await toggle.focus();await page.keyboard.press('Space');await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(page.locator('.report-group-body')).toBeHidden();
  await page.keyboard.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(page.locator('.report-group-body')).toBeVisible();await context.close();
});


test('hover tooltip dismisses with Escape without moving or stealing focus',async({page})=>{
  await page.goto('/e2e/fixtures/uiKitComposites.html');
  const next=page.locator('#next-control');await next.focus();
  await page.locator('#tooltip-trigger').hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();await expect(next).toBeFocused();
});

test('action menu stays inside a modal focus boundary and Escape preserves the dialog',async({page})=>{
  await page.goto('/e2e/fixtures/uiKitComposites.html');
  await page.evaluate(async()=>{
    const {bindActionMenu}=await import('/js/ui/actionMenu.js');
    const {button}=await import('/js/ui/primitives.js');
    const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Проверка модального меню');
    dialog.innerHTML=`${button({label:'Действия внутри окна',attrs:{id:'modal-menu-trigger'}})}<div id="modal-menu-panel" hidden>${button({label:'Первый пункт'})}${button({label:'Последний пункт'})}</div>`;
    document.body.append(dialog);dialog.showModal();
    bindActionMenu({trigger:dialog.querySelector('#modal-menu-trigger'),panel:dialog.querySelector('#modal-menu-panel'),label:'Модальное меню'});
  });
  const trigger=page.getByRole('button',{name:'Действия внутри окна'});await trigger.click();
  const menu=page.getByRole('menu',{name:'Модальное меню'});await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('End');await expect(menu.getByRole('menuitem').last()).toBeFocused();
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(trigger).toBeFocused();
  await expect(page.getByRole('dialog',{name:'Проверка модального меню'})).toBeVisible();
});
