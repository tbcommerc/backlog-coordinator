import { test, expect } from '@playwright/test';

async function open(page, surface, query = '') {
  await page.goto(`/e2e/fixtures/uiKitRegistries.html?surface=${surface}${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
}
const calls = (page, method='get') => page.evaluate(method=>window.__calls.filter(call=>call.method===method), method);
test.afterEach(async ({page})=>{
  expect(await page.evaluate(()=>window.__blocked || [])).toEqual([]);
});

for(const theme of ['light','dark']) for(const [name,width,compact,touch,zoom] of [
  ['desktop',1440,false,false,1],['laptop',1280,false,false,1],['tablet',768,false,false,1],
  ['mobile',390,false,false,1],['compact',1440,true,false,1],['touch',1440,false,true,1],['zoom',1440,false,false,1.5],
]) {
  test(`общая геометрия реестров: ${theme}/${name}`,async({browser})=>{
    const context=await browser.newContext({viewport:{width,height:1000},hasTouch:touch});
    const page=await context.newPage();
    try {
      for(const surface of ['audit','outbox','notifications']) {
        await open(page,surface,`&theme=${theme}&compact=${compact}`);
        if(zoom!==1) await page.evaluate(zoom=>{document.documentElement.style.zoom=zoom;},zoom);
        if(width<=560 && surface==='audit') await page.locator('[data-toggle-audit-filters]').click();
        await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
        const geometry=await page.locator('#page-content').evaluate(root=>({
          overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
          headerFits:[...root.querySelectorAll('.ui-page-header *')].every(el=>{
            const box=el.getBoundingClientRect(), parent=root.getBoundingClientRect();
            return box.left>=parent.left-1 && box.right<=parent.right+1;
          }),
          controls:[...root.querySelectorAll('.btn,.ui-control,.ui-filter-chip')].filter(el=>el.getClientRects().length).map(el=>{
            const style=getComputedStyle(el);
            return {name:el.textContent?.trim().slice(0,45)||el.id,height:parseFloat(style.height),width:parseFloat(style.width),small:el.matches('.btn-sm,.input-sm'),chip:el.matches('.ui-filter-chip'),square:el.classList.contains('square-icon'),clipped:el.scrollWidth>el.clientWidth+1};
          }),
        }));
        expect(geometry.overflow,`${surface}: page overflow`).toBeLessThanOrEqual(1);
        expect(geometry.headerFits,`${surface}: header must not be clipped`).toBe(true);
        await expect(page.locator('i[data-lucide]')).toHaveCount(0);
        expect(geometry.controls.length).toBeGreaterThan(3);
        for(const item of geometry.controls) {
          const size=(width<=640||touch) ? 44 : item.chip ? 32 : item.small||compact ? 28 : 32;
          expect(item.height,`${surface}/${item.name}`).toBeGreaterThanOrEqual(size);
          // Text can wrap on small screens, but never expands desktop controls.
          if(width>640) expect(item.height,`${surface}/${item.name}`).toBe(size);
          if(item.square) expect(item.width,`${surface}/${item.name} must be square`).toBe(item.height);
          expect(item.clipped,`${surface}/${item.name} must fit`).toBe(false);
        }
        expect(await page.evaluate(()=>window.__calls.filter(call=>call.method!=='get'))).toEqual([]);
        if(theme==='light' && ['desktop','mobile'].includes(name)) await page.screenshot({path:test.info().outputPath(`${surface}-${name}.png`),fullPage:true});
      }
    } finally { await context.close(); }
  });
}

test('аудит: поля, валидация дат, фильтры, страницы и копирование',async({page,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await open(page,'audit');
  await page.getByLabel('Дата с',{exact:true}).fill('2026-10-10');
  await page.getByLabel('Дата по',{exact:true}).fill('2026-10-01');
  const before=(await calls(page)).length;
  await page.getByRole('button',{name:'Применить',exact:true}).click();
  await expect(page.locator('#audit-date-error')).toContainText('Дата начала');
  await expect(page.getByLabel('Дата с',{exact:true})).toHaveAttribute('aria-invalid','true');
  await expect(page.getByLabel('Дата с',{exact:true})).toBeFocused();
  expect((await calls(page)).length).toBe(before);
  await page.getByLabel('Дата по',{exact:true}).fill('2026-10-30');
  await page.getByLabel('Поиск',{exact:true}).fill('Название <тест>');
  await page.getByLabel('Пользователь',{exact:true}).selectOption('1');
  await page.getByLabel('Действие',{exact:true}).selectOption('update');
  await page.getByRole('button',{name:'Применить',exact:true}).click();
  await expect(page.locator('.audit-filter-chip')).toHaveCount(5);
  const url=new URL((await calls(page)).at(-1).path,'http://local');
  expect(url.searchParams.get('search')).toBe('Название <тест>');
  expect(url.searchParams.get('user_id')).toBe('1');
  expect(url.searchParams.get('date_to')).toBe('2026-10-30');
  await expect(page.getByLabel('Поиск',{exact:true})).toHaveValue('Название <тест>');
  await page.getByRole('button',{name:'Далее',exact:true}).click();
  await expect(page.locator('.audit-request-cell code')).toHaveText('request-page-2');
  await expect(page.locator('.audit-page-table-wrap')).toBeFocused();
  await page.getByRole('button',{name:'Скопировать Request ID'}).click();
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('request-page-2');
  await page.getByRole('button',{name:'Убрать фильтр: Пользователь: Тестовый автор'}).click();
  expect(new URL((await calls(page)).at(-1).path,'http://local').searchParams.has('user_id')).toBe(false);
  await page.getByLabel('Строк на странице').selectOption('25');
  await expect(page.locator('.audit-pagination')).toContainText('из 5');
  await page.getByRole('button',{name:'Сбросить все',exact:true}).click();
  await expect(page.locator('.audit-filter-chip')).toHaveCount(0);
});

test('аудит: недоступные списки, ошибка загрузки, повтор и пустой поиск',async({page})=>{
  await open(page,'audit','&error&filtersError');
  await expect(page.locator('.audit-filter-notice')).toContainText('Поиск и период продолжают работать');
  await expect(page.locator('.view-state-error')).toBeVisible();
  await page.evaluate(()=>{window.__failRead=false;window.__hold=true;});
  await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await expect(page.locator('[data-refresh-audit]')).toHaveAttribute('aria-busy','true');
  await expect(page.locator('.audit-apply-btn')).toBeDisabled();
  await page.evaluate(()=>window.__release());
  await expect(page.locator('[data-refresh-audit]')).toHaveText('Обновить');
  await page.getByLabel('Поиск',{exact:true}).fill('missing');
  await page.getByRole('button',{name:'Применить',exact:true}).click();
  await expect(page.locator('.view-state-empty')).toContainText('ничего не найдено');
  await page.locator('.view-state').getByRole('button',{name:'Сбросить фильтры'}).click();
  await expect(page.locator('.audit-request-cell code')).toHaveText('request-page-1');
});

test('доставка: поиск Enter, страницы, ошибка и повтор с сохранением запроса',async({page})=>{
  await open(page,'outbox');
  await page.getByLabel('Поиск ошибок доставки').fill('Task');
  await page.getByLabel('Поиск ошибок доставки').press('Enter');
  await page.getByRole('button',{name:'Далее',exact:true}).click();
  expect(new URL((await calls(page)).at(-1).path,'http://local').searchParams.get('page')).toBe('2');
  await page.locator('summary').click();
  await expect(page.locator('.outbox-payload')).toContainText('<img src=x');
  await expect(page.locator('.outbox-payload img')).toHaveCount(0);
  await page.evaluate(()=>{window.__failRead=true;});
  await page.getByRole('button',{name:'Обновить',exact:true}).click();
  await expect(page.locator('.view-state-error')).toBeVisible();
  await expect(page.getByLabel('Поиск ошибок доставки')).toHaveValue('Task');
  await page.evaluate(()=>{window.__failRead=false;});
  await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await expect(page.locator('.outbox-requeue')).toBeVisible();
  await page.getByLabel('Поиск ошибок доставки').fill('missing');
  await page.getByLabel('Поиск ошибок доставки').press('Enter');
  await expect(page.locator('.view-state-empty')).toContainText('Ничего не найдено');
  await page.getByRole('button',{name:'Сбросить поиск',exact:true}).click();
  await expect(page.getByLabel('Поиск ошибок доставки')).toHaveValue('');
  await expect(page.locator('.outbox-requeue')).toBeVisible();
});

test('доставка: отмена, busy, ошибка и безопасный повтор одного события',async({page})=>{
  await open(page,'outbox');
  const requeue=page.locator('.outbox-requeue');
  await requeue.click();
  await page.keyboard.press('Escape');
  await expect(requeue).toBeFocused();
  expect(await calls(page,'post')).toHaveLength(0);
  await page.evaluate(()=>{window.__failWrite=true;window.__hold=true;});
  await requeue.click();
  await page.getByRole('alertdialog').getByRole('button',{name:'Отправить снова',exact:true}).click();
  await expect(requeue).toHaveAttribute('aria-busy','true');
  await expect(requeue).toBeDisabled();
  await page.evaluate(()=>window.__release());
  await expect(requeue).toHaveText('Отправить снова');
  await expect(requeue).toBeEnabled();
  await page.evaluate(()=>{window.__failWrite=false;});
  await requeue.click();
  await page.getByRole('alertdialog').getByRole('button',{name:'Отправить снова',exact:true}).click();
  await expect(page.locator('.view-state-empty')).toContainText('Ошибок доставки нет');
  const writes=await calls(page,'post');
  expect(writes).toHaveLength(2);
  expect(writes.every(call=>call.data.expected_attempts===12)).toBe(true);
  expect(writes[0].data.client_request_id).not.toBe(writes[1].data.client_request_id);
});

test('уведомления: фильтры с клавиатуры, URL, сброс из пустого списка и пагинация',async({page})=>{
  await open(page,'notifications');
  await expect(page.locator('.notification-card')).toHaveCount(20);
  await page.getByRole('button',{name:'Загрузить ещё',exact:true}).click();
  await expect(page.locator('.notification-card')).toHaveCount(23);
  await expect(page.locator('#notifications-load-more')).toBeHidden();
  const category=page.locator('[data-filter-category="mention"]');
  await category.focus(); await page.keyboard.press('Space');
  await expect(category).toHaveAttribute('aria-pressed','true');
  await expect(page).toHaveURL(/category=mention/);
  await expect(page.locator('.view-state-empty')).toBeVisible();
  await page.locator('.view-state').getByRole('button',{name:'Сбросить фильтры'}).click();
  await expect(page.locator('.notification-card')).toHaveCount(20);
  await expect(page).toHaveURL(/#\/notifications$/);
  await page.locator('[data-view="unread"]').click();
  await page.locator('[data-filter-category="comment"]').click();
  await page.locator('[data-filter-importance="medium"]').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
  await expect(page.locator('[data-view="unread"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-filter-category="comment"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-filter-importance="medium"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-filter-category="comment"]').click();
  await expect(page.locator('[data-filter-category="comment"]')).toHaveAttribute('aria-pressed','false');
});

test('уведомления: блокировка встреч, точный переход, rollback прочтения',async({page})=>{
  await open(page,'notifications');
  const locked=page.locator('[data-notif-id="1"]'), regular=page.locator('[data-notif-id="2"]');
  await expect(locked.locator('[data-mark-read]')).toHaveCount(0);
  await locked.locator('[data-open-notification]').click();
  expect(await page.evaluate(()=>window.__navigation[0])).toBe('/reporting-statuses?source=notification&meeting_id=42');
  expect(await calls(page,'put')).toHaveLength(0);
  await page.evaluate(()=>{window.__failWrite=true;window.__hold=true;});
  await regular.locator('[data-mark-read]').click();
  await expect(regular).toHaveClass(/is-read/);
  await expect(regular.locator('[data-open-notification]')).toHaveClass(/btn-secondary/);
  await expect(regular.locator('[data-mark-unread]')).toBeDisabled();
  await page.evaluate(()=>window.__release());
  await expect(regular).toHaveClass(/is-unread/);
  await expect(regular.locator('[data-open-notification]')).toHaveClass(/btn-primary/);
  await expect(regular.getByRole('button',{name:'Отметить прочитанным'})).toBeEnabled();
  await page.evaluate(()=>{window.__failWrite=false;});
  await regular.locator('[data-mark-read]').click();
  await expect(regular.getByRole('button',{name:'Отметить непрочитанным'})).toBeEnabled();
  await regular.locator('[data-mark-unread]').click();
  await expect(regular.getByRole('button',{name:'Отметить прочитанным'})).toBeEnabled();
});

test('уведомления: ошибка загрузки и busy массового прочтения',async({page})=>{
  await open(page,'notifications','&error');
  await expect(page.locator('.view-state-error')).toBeVisible();
  await page.evaluate(()=>{window.__failRead=false;});
  await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await expect(page.locator('.notification-card')).toHaveCount(20);
  await page.evaluate(()=>{window.__hold=true;});
  await page.locator('#mark-all-read').click();
  await expect(page.locator('#mark-all-read')).toHaveAttribute('aria-busy','true');
  await page.evaluate(()=>window.__release());
  await expect(page.locator('#mark-all-read')).toHaveText('Прочитать все');
  await expect(page.locator('#notif-stat-unread')).toHaveText('1');
  await expect(page.locator('[data-notif-id="1"]')).toHaveClass(/is-unread/);
});
