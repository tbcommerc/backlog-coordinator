import { test, expect } from '@playwright/test';
const fixture = '/e2e/fixtures/backlogAssistant.html';
const sid = '00000000-0000-4000-8000-000000000001';
const rid = '00000000-0000-4000-8000-000000000002';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/backlog-assistant/**', route => {
    const path = new URL(route.request().url()).pathname;
    const value = path.endsWith('/capabilities') ? {enabled: true} : path.endsWith('/sessions')
      ? route.request().method() === 'POST' ? {id: sid, context_revision: 1} : {items: []}
      : path.endsWith('/messages') ? {run_id: rid, status: 'queued'} : {id: rid, message_id: rid, status: 'running'};
    return route.fulfill({json: value});
  });
});
test('ambiguous send preserves text and idempotency key', async ({page}) => {
  const keys = [];
  await page.route('**/sessions/*/messages', route => { keys.push(route.request().headers()['idempotency-key']); return route.fulfill({status: 503, json: {detail:'unavailable'}}); });
  await page.goto(fixture);
  await page.getByLabel('Сообщение помощнику').fill('Мои задачи');
  await page.getByRole('button', {name:'Отправить', exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Текст сохранён');
  await expect(page.getByLabel('Сообщение помощнику')).toHaveValue('Мои задачи');
  await page.getByRole('button', {name:'Отправить', exact:true}).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
});
test('closing panel preserves draft, returns focus and does not cancel', async ({page}) => {
  let cancels = 0;
  await page.route('**/runs/*/cancel', route => {cancels++; return route.fulfill({json:{}});});
  await page.goto(fixture);
  await page.getByRole('button', {name:'Открыть панель'}).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Сообщение помощнику').fill('Подготовь сводку');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', {name:'Открыть панель'})).toBeFocused();
  await page.getByRole('button', {name:'Открыть панель'}).click();
  await expect(page.getByRole('dialog').getByLabel('Сообщение помощнику')).toHaveValue('Подготовь сводку');
  expect(cancels).toBe(0);
});
for (const width of [390, 1280]) test(`answer and controls fit ${width}`, async ({page}) => {
  await page.setViewportSize({width, height:900});
  await page.route('**/runs/*', route => route.fulfill({json:{id:rid,message_id:rid,status:'completed',answer:{kind:'answer',as_of:'2026-10-14T12:00:00Z',verified_blocks:[{items:[{title:'<script>unsafe</script>',status:'В работе'}],total:1}],sources:[],limitations:[],coverage:{displayed_count:1}}}}));
  await page.goto(fixture);
  await page.getByLabel('Сообщение помощнику').fill('Покажи задачи');
  await page.getByRole('button', {name:'Отправить',exact:true}).click();
  await expect(page.getByRole('cell', {name:'<script>unsafe</script>'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/backlog-assistant-${width}.png`,fullPage:true});
});


test('stop during message dispatch cancels once the run is known', async ({page}) => {
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  let cancels = 0;
  await page.route('**/sessions/*/messages', async route => {
    await delayed;
    return route.fulfill({json:{run_id:rid,status:'queued'}});
  });
  await page.route('**/runs/*', route => route.fulfill({json:{id:rid,message_id:rid,status:cancels ? 'cancelled' : 'running',error_code:cancels ? 'cancelled' : null}}));
  await page.route('**/runs/*/cancel', route => {cancels++; return route.fulfill({json:{}});});
  await page.goto(fixture);
  await page.getByLabel('Сообщение помощнику').fill('Покажи задачи');
  await page.getByRole('button',{name:'Отправить',exact:true}).click();
  await expect(page.getByLabel('Сообщение помощнику')).toBeDisabled();
  await page.getByRole('button',{name:'Остановить',exact:true}).click();
  release();
  await expect(page.getByRole('status')).toHaveText('Отменено');
  expect(cancels).toBe(1);
  await expect(page.getByLabel('Сообщение помощнику')).toBeEnabled();
  await expect(page.getByRole('alert')).toBeHidden();
});


test('card explanation and event history are visible in the dialogue', async ({page}) => {
  await page.route('**/runs/*', route => route.fulfill({json:{id:rid,message_id:rid,status:'completed',answer:{kind:'answer',as_of:'2026-10-15T10:00:00Z',verified_blocks:[{items:[{title:'Синтетическая карточка',description:'Нужно согласовать требования.',review_comment:'Не указан владелец.'}],history:[{field:'status_id',old:'Новая',new:'В работе',at:'2026-10-15'}],history_total:1}],sources:[],limitations:[],coverage:{displayed_count:1}}}}));
  await page.goto(fixture);
  await page.getByLabel('Сообщение помощнику').fill('Объясни карточку');
  await page.getByRole('button',{name:'Отправить',exact:true}).click();
  await expect(page.getByText('Нужно согласовать требования.',{exact:true})).toBeVisible();
  await expect(page.getByText('Не указан владелец.',{exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'История изменений (1)'})).toBeVisible();
});

test('search conditions and normalized terms are visible', async ({page}) => {
  await page.route('**/runs/*', route => route.fulfill({json:{id:rid,message_id:rid,status:'completed',answer:{kind:'answer',as_of:'2026-10-15T10:00:00Z',verified_blocks:[{items:[{title:'Кэширование котировок'}],total:1,search_terms:[{term:'котировка',tokens:['котиров']}]}],sources:[],limitations:[],coverage:{displayed_count:1}}}}));
  await page.goto(fixture);
  await page.getByLabel('Сообщение помощнику').fill('Найди задачу о котировках');
  await page.getByRole('button',{name:'Отправить',exact:true}).click();
  await expect(page.getByText('Условия поиска: котировка (формы слов: котиров)',{exact:true})).toBeVisible();
  await expect(page.getByRole('cell',{name:'Кэширование котировок'})).toBeVisible();
});

test('new conversation restores suggestions and focuses the composer', async ({page}) => {
  await page.route('**/runs/*', route => route.fulfill({json:{id:rid,message_id:rid,status:'completed',answer:{kind:'no_results',sources:[],coverage:{}}}}));
  await page.goto(fixture);
  await page.getByRole('button', {name:'Найти задачи'}).click();
  await expect(page.getByLabel('Сообщение помощнику')).toHaveValue('Покажи 5 доступных задач');
  await expect(page.getByLabel('Сообщение помощнику')).toBeFocused();
  await page.getByRole('button', {name:'Отправить',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Готово');
  await expect(page.locator('[data-ba-welcome]')).toHaveCount(0);
  await page.getByRole('button', {name:'Новый разговор',exact:true}).click();
  await expect(page.getByRole('heading', {name:'С чего начнём?'})).toBeVisible();
  await expect(page.getByLabel('Сообщение помощнику')).toBeFocused();
  await expect(page.locator('.ba-user-message')).toHaveCount(0);
});

test('busy state switches send to stop and restores controls after cancellation', async ({page}) => {
  let cancelled = false;
  await page.route('**/runs/*', route => route.fulfill({json:{id:rid,message_id:rid,status:cancelled ? 'cancelled' : 'running'}}));
  await page.route('**/runs/*/cancel', route => { cancelled = true; return route.fulfill({json:{}}); });
  await page.goto(fixture);
  await page.getByLabel('Сообщение помощнику').fill('Подготовь сводку');
  await page.getByRole('button', {name:'Отправить',exact:true}).click();
  await expect(page.locator('[data-ba-activity]')).toBeVisible();
  await expect(page.getByRole('button', {name:'Отправить',exact:true})).toBeHidden();
  await expect(page.getByRole('button', {name:'Новый разговор',exact:true})).toBeDisabled();
  await page.screenshot({path:'test-results/assistant-conversation-running.png',fullPage:true});
  await page.getByRole('button', {name:'Остановить',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Отменено');
  await expect(page.locator('[data-ba-activity]')).toBeHidden();
  await expect(page.getByRole('button', {name:'Остановить',exact:true})).toBeHidden();
  await expect(page.getByRole('button', {name:'Новый разговор',exact:true})).toBeEnabled();
  await expect(page.locator('.ba-run-notice')).toContainText('Ответ остановлен');
});

test('history selects a conversation and keeps its terminal notice beside the question', async ({page}) => {
  await page.route('**/backlog-assistant/sessions', route => route.fulfill({json:{items:[{id:sid,title:'Сводка по задачам',updated_at:1792234800}]}}));
  await page.route('**/sessions/'+sid, route => route.fulfill({json:{id:sid,runs:[{id:rid,text:'Сколько задач в работе?',status:'expired'}]}}));
  await page.goto(fixture);
  const item = page.locator('[data-ba-session]');
  await item.click();
  await expect(item).toHaveAttribute('aria-current','true');
  await expect(page.locator('.ba-user-message')).toHaveText('ВыСколько задач в работе?');
  await expect(page.locator('.ba-run-notice')).toContainText('Время ожидания истекло');
  await expect(page.locator('[data-ba-activity]')).toBeHidden();
  await page.getByRole('button', {name:'Новый разговор',exact:true}).click();
  await expect(item).toHaveAttribute('aria-current','false');
});

for (const [theme,width,height] of [
  ['light',1280,900], ['dark',1280,900], ['light',390,844],
  ['dark',390,844], ['light',320,568], ['light',840,600],
]) test(`drawer layout and search context: ${theme} ${width}x${height}`, async ({page}) => {
  await page.setViewportSize({width,height});
  await page.goto(fixture);
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme; },theme);
  await page.getByRole('button',{name:'Открыть панель'}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading',{name:'С чего начнём?'})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Закрыть помощника'})).toBeInViewport();
  await expect(dialog.getByRole('button',{name:'Отправить',exact:true})).toBeInViewport();
  await expect(dialog.locator('.ba-readonly')).toBeInViewport();
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  // Prompts are content cards; ordinary commands retain the shared kit geometry.
  const differences = await dialog.evaluate(el => {
    const result = [];
    for (const actual of el.querySelectorAll('.btn, textarea.ui-control')) {
      if (!actual.getClientRects().length) continue;
      const reference = document.createElement(actual.tagName);
      reference.className = actual.tagName === 'TEXTAREA' ? 'input ui-control' : [...actual.classList].filter(c => !c.startsWith('ba-')).join(' ');
      reference.disabled = actual.disabled;
      reference.style.position = 'fixed'; reference.style.left = '-10000px';
      document.body.append(reference);
      const a = getComputedStyle(actual), b = getComputedStyle(reference);
      const keys = ['fontSize','borderRadius','backgroundColor','color',...(actual.tagName === 'BUTTON' ? ['minHeight','paddingTop','paddingBottom'] : [])];
      for (const key of keys) if (a[key] !== b[key]) result.push({label:actual.textContent || 'textarea',key,actual:a[key],reference:b[key]});
      reference.remove();
    }
    return result;
  });
  expect(differences).toEqual([]);
  await dialog.screenshot({path:`test-results/assistant-drawer-${theme}-${width}x${height}.png`});
  await dialog.locator('.ba-context summary').click();
  const context = dialog.locator('.ba-context-fields');
  await expect(context).toBeInViewport();
  const box = await context.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  await dialog.getByLabel('Область',{exact:true}).selectOption('my_team');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
