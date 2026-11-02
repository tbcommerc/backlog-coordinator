import { test, expect } from '@playwright/test';
const open = async (page, tab) => {
  await page.goto(`/e2e/fixtures/uiKitAdminReports.html?dialogA11y=true&admin_tab=${tab}`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
};
test('F01 команда загружает варианты и сохраняет отсутствующие в списке текущие значения', async ({page}) => {
  await open(page, 'teams');
  await page.evaluate(async () => {
    const original = window.app.api.get.bind(window.app.api);
    window.app.api.get = async path => path === '/admin/teams' ? [{id:1,name:'Команда',pl:'Архивный PL',po:'PO',cl:'CL',it_pl:'IT',team_type_id:12}] : path === '/admin/users' ? [{id:2,name:'PO'},{id:3,name:'CL'},{id:4,name:'IT'}] : path === '/admin/team-types' ? [{id:12,name:'Продуктовая'}] : original(path);
    await (await import('/js/components/admin.js?v=6')).initAdmin(window.app);
  });
  await page.locator('.admin-edit-btn[data-type="team"]').click();
  await expect(page.locator('#modal-pl')).toHaveValue('Архивный PL');
  await expect(page.locator('#modal-po')).toHaveValue('PO');
  await expect(page.locator('#modal-team-type')).toHaveValue('12');
  await page.locator('.modal-cancel-btn').click();
  expect(await page.evaluate(()=>window.__blockedWrites)).toEqual([]);
});
test('F05 последнее переключение выигрывает при задержке и resize', async ({page}) => {
  await open(page,'teams');
  await page.evaluate(() => {const get=window.app.api.get.bind(window.app.api);window.app.api.get=async path=>{if(path==='/admin/projects')await new Promise(r=>setTimeout(r,250));return get(path);};});
  await page.locator('[data-tab=projects]').click(); await page.locator('[data-tab=users]').click();
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#admin-content')).toHaveAttribute('data-admin-tab','users');
  await expect(page.locator('#admin-tab-mobile-select')).toHaveValue('users');
  await page.waitForTimeout(350);
  await expect(page.locator('#admin-content')).toHaveAttribute('data-admin-tab','users');
});
test('F06 черновик отображения переживает переходы и историю', async ({page}) => {
  await open(page,'display'); await page.locator('#display-label-id').fill('Черновик ID');
  await page.locator('[data-tab=home]').click(); await page.locator('[data-tab=display]').click();
  await expect(page.locator('#display-label-id')).toHaveValue('Черновик ID');
  await page.goBack(); await page.goForward();
  await expect(page.locator('#display-label-id')).toHaveValue('Черновик ID');
});
test('F08/F09 поиск не меняет справочник, пустой результат и сброс', async ({page}) => {
  await open(page,'dictionaries'); await page.locator('[data-dict=priorities]').click();
  await page.locator('#dict-search').fill('несуществующее значение');
  await expect(page.locator('#dict-search-result')).toContainText('Ничего не найдено');
  await expect(page.locator('#dict-pending-count')).toHaveText('0');
  await page.locator('#dict-search-reset').click(); await expect(page.locator('#dict-search')).toHaveValue('');
  await page.locator('#dict-search').fill('нет'); await page.locator('.modal-cancel-btn').click();
  await expect(page.locator('#admin-modal-overlay')).toHaveCount(0); await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('F17 подтверждение закрытия клиента ДИД и сохранение ввода при отказе', async ({page}) => {
  await open(page,'dictionaries'); await page.locator('[data-dict="did-client-groups"]').click(); await page.locator('[data-new]').click();
  await page.locator('input[name=name]').fill('Черновик ДИД'); await page.locator('dialog [data-close]').click();
  await expect(page.getByRole('alertdialog')).toBeVisible(); await page.getByRole('button',{name:'Продолжить редактирование',exact:true}).click();
  await expect(page.locator('input[name=name]')).toHaveValue('Черновик ДИД'); await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toBeVisible(); await page.getByRole('button',{name:'Не сохранять',exact:true}).click();
  await expect(page.locator('dialog')).toHaveCount(0); expect(await page.evaluate(()=>window.__blockedWrites)).toEqual([]);
});
for(const width of [390,844]) test(`F04/F15 свёрнутые фильтры и маркер ${width}`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:390}); await open(page,'users');
  await expect(page.locator('.admin-user-filter-group')).not.toHaveAttribute('open','');
  if(width===844) expect((await page.locator('#admin-content tbody tr').first().boundingBox()).y).toBeLessThan(350);
  await page.locator('#admin-tab-mobile-select').selectOption('home'); const dot=page.locator('.tl-admin-dot').first();
  await expect(dot).toBeVisible(); expect((await dot.boundingBox()).width).toBeLessThanOrEqual(12);
});

test('F01 неполная загрузка не открывает редактирование команды',async({page})=>{
  await open(page,'teams');
  await page.evaluate(async()=>{const get=window.app.api.get.bind(window.app.api);window.app.api.get=async path=>{if(path==='/admin/users')throw Error('Unavailable');return get(path);};await (await import('/js/components/admin.js?v=6')).initAdmin(window.app);});
  await expect(page.locator('#admin-retry-btn')).toBeVisible(); await expect(page.locator('.admin-edit-btn')).toHaveCount(0);
});
test('F02/F03/F10/F11 поиск логина, фокус пагинации и подписи',async({page})=>{
  await open(page,'users');
  await page.evaluate(async()=>{const get=window.app.api.get.bind(window.app.api);window.app.api.get=async path=>path==='/admin/users'?Array.from({length:40},(_,i)=>({id:i+1,name:`User ${i}`,login:`qa.user-${i}`,is_active:true,credential_state:'ready'})):get(path);await (await import('/js/components/admin.js?v=6')).initAdmin(window.app);});
  await page.locator('#admin-user-search').fill('qa.user-17'); await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Готова ко входу');
  await page.locator('#admin-user-filters-reset').click(); await page.locator('.admin-list-page[data-page="2"][aria-label="Страница 2"]').click();
  await expect(page.locator('#admin-content')).toBeFocused(); expect((await page.locator('#admin-content').boundingBox()).y).toBeGreaterThanOrEqual(0);
  await expect(page.getByRole('combobox',{name:'Роль пользователя'})).toBeVisible();
});
test('F14 раскрытая карточка аудита переносит длинный trace без внутреннего overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page,'audit');
  await page.evaluate(async()=>{const get=window.app.api.get.bind(window.app.api);window.app.api.get=async path=>path.startsWith('/admin/audit-log?')?{items:[{created_at:'2026-10-17T10:00:00Z',action:'BULK_UPDATE',entity_type:'dictionary_items',trace_id:'a'.repeat(120),details:{changed_fields:['field'.repeat(30)]}}],total:1}:get(path);await (await import('/js/components/admin.js?v=6')).initAdmin(window.app);});
  await page.locator('.admin-row-details-toggle').click();
  const sizes=await page.locator('.audit-table').evaluate(table=>({width:table.getBoundingClientRect().width,cells:[...table.querySelectorAll('td')].map(e=>[e.scrollWidth,e.clientWidth])}));
  expect(sizes.width).toBeLessThanOrEqual(390);for(const [scroll,client] of sizes.cells)expect(scroll-client).toBeLessThanOrEqual(1);
  await expect(page.locator('tbody')).toContainText('Массовое изменение');await expect(page.locator('tbody')).toContainText('Значения справочников');
});
