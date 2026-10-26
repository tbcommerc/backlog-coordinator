import { expect, test } from '@playwright/test';

const draft = {
  title: 'Повторная отправка расчётной инструкции',
  problem_statement: 'Бэк-офицер не может повторить технически неуспешную отправку без обращения в поддержку.',
  target_process: 'Повторная отправка запускается из карточки сделки и выполняется асинхронно.',
  user_roles: ['Бэк-офицер'],
  process: 'Отправка расчётных инструкций',
  acceptance_criteria: ['Кнопка недоступна, пока предыдущая попытка выполняется.'],
  open_question_details: [{ slot: 'acceptance_criteria', text: 'Уточните предельный таймаут.', blocking: true }],
  conflicts: [],
  quality_issues: [],
  assumptions: [],
};

const progress = [
  ['need_statement', 'Потребность', draft.problem_statement],
  ['to_be', 'Целевой результат', draft.target_process],
  ['role', 'Основная роль', 'Бэк-офицер'],
  ['process', 'Процесс', draft.process],
].map(([key, label, value]) => ({ key, label, value, filled: true, required: true }));

async function mockAssistant(page, { sessionDelay = 0 } = {}) {
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const session = {
    active: true,
    session_id: 'ux-session',
    title: draft.title,
    phase: 'draft_ready',
    dialogue_mode: 'balanced',
    sources: [],
    needs_user_response: true,
    can_generate_draft: false,
    history: [
      { role: 'user', content: 'Нужно повторять отправку расчётной инструкции из карточки сделки.' },
      { role: 'assistant', content: 'Черновик готов. Проверьте документ и уточните предельный таймаут.' },
    ],
    slots: Object.fromEntries(progress.map(item => [item.key, item.value])),
    progress,
    draft,
  };

  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path === '/events/stream') return route.abort();
    if (path === '/auth/refresh') return json(route, { access_token: 'e2e-token', user: { id: 101, name: 'Тестовый пользователь' } });
    if (path === '/auth/me') return json(route, {
      id: 101,
      name: 'Тестовый пользователь',
      email: 'e2e@example.test',
      role_name: 'Бизнес-заказчик',
      permissions: { admin: 'none', customer_portal_mode: 'all' },
    });
    if (path === '/admin/field-labels') return json(route, {});
    if (path === '/tasks/reference') return json(route, {
      statuses: [], priorities: [], deadlines: [], teams: [], projects: [], task_types: [], channels: [],
      departments: [], business_customers: [], did_client_groups: [], tags: [], users: [],
    });
    if (path === '/notifications/snapshot') return json(route, {
      revision: 1,
      summary: { unread: 0, requires_action: 0, today: 0, by_category: {} },
      recent_items: [], recent_total: 0, action_items: [], action_total: 0,
    });
    if (path === '/agent/chat-stream') {
      const result = {
        ...session,
        action: 'question',
        phase: 'agentic_dialogue',
        message: 'Потоковый ответ готов.',
        draft: null,
        history: [
          ...session.history,
          { role: 'user', content: request.postDataJSON()?.message || '' },
          { role: 'assistant', content: 'Потоковый ответ готов.' },
        ],
      };
      const body = [
        'event: ready\ndata: {"stream":true}',
        'event: status\ndata: {"stage":"response","message":"Формулируем ответ…"}',
        'event: delta\ndata: {"text":"Потоковый "}',
        'event: delta\ndata: {"text":"ответ готов."}',
        `event: result\ndata: ${JSON.stringify(result)}`,
        '',
      ].join('\n\n');
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body });
    }
    if (path === '/agent/session') {
      if (sessionDelay) await new Promise(resolve => setTimeout(resolve, sessionDelay));
      return json(route, session);
    }
    if (path === '/agent/sessions') return json(route, { sessions: [{ ...session, history: undefined }] });
    if (path === '/agent/ux-event') return json(route, { message: 'accepted' }, 202);
    return json(route, {});
  });
}

test('восстановление сессии не показывает ложное приветствие', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockAssistant(page, { sessionDelay: 600 });
  await page.goto('/#/customer/create');

  await expect(page.locator('.chat-resume-loading')).toBeVisible();
  await expect(page.locator('.chat-welcome')).toHaveCount(0);
  await expect(page.getByText('Черновик готов. Проверьте документ и уточните предельный таймаут.')).toBeVisible();
  await expect(page.locator('.chat-resume-loading')).toHaveCount(0);
  await expect(page.locator('.chat-welcome')).toHaveCount(0);
});

test('короткий landscape сохраняет рабочую область диалога', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await mockAssistant(page);
  await page.goto('/#/customer/create');

  const messages = page.locator('#agent-chat-messages');
  await expect(messages).toBeVisible();
  await expect(page.locator('#chat-interview-progress')).toContainText('1 блокер');
  await expect(page.locator('.navbar-search')).toBeHidden();
  await expect(page.locator('#mobile-search-toggle')).toBeVisible();

  const geometry = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    main: document.querySelector('.chat-main').getBoundingClientRect().toJSON(),
    messages: document.querySelector('#agent-chat-messages').getBoundingClientRect().toJSON(),
    composer: document.querySelector('.chat-input-area').getBoundingClientRect().toJSON(),
  }));
  expect(geometry.main.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.messages.height).toBeGreaterThanOrEqual(90);
  expect(geometry.composer.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
});

test('финальная проверка показывает документ раньше блокеров', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await mockAssistant(page);
  await page.goto('/#/customer/create');

  await expect(page.locator('#agent-chat-messages')).toHaveAttribute('aria-live', 'off');
  await expect(page.locator('#chat-live-announcer')).toHaveAttribute('aria-live', 'polite');
  await page.getByRole('tab', { name: /Требование/ }).click();
  await expect(page.locator('#requirement-map-card')).toBeVisible();
  await expect(page.locator('#chat-draft-panel')).toBeVisible();

  const order = await page.evaluate(() => ({
    documentTop: document.querySelector('#requirement-map-card').getBoundingClientRect().top,
    blockersTop: document.querySelector('#chat-draft-panel').getBoundingClientRect().top,
  }));
  expect(order.blockersTop).toBeGreaterThan(order.documentTop);
});

test('desktop скрывает вторичные действия ответа до фокуса или наведения', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAssistant(page);
  await page.goto('/#/customer/create');

  const message = page.locator('.chat-message-bot').first();
  const actions = message.locator('.chat-answer-actions');
  await expect(actions).toHaveCSS('opacity', '0');
  await message.hover();
  await expect(actions).toHaveCSS('opacity', '1');
});

test('браузер получает финальный ответ через SSE-контракт', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockAssistant(page);
  await page.goto('/#/customer/create');

  await page.locator('#agent-chat-input').fill('Продолжим уточнение');
  await page.locator('#agent-chat-input').press('Control+Enter');

  await expect(page.locator('#agent-chat-messages').getByText('Потоковый ответ готов.', { exact: true })).toBeVisible();
  await expect(page.locator('.chat-message-streaming')).toHaveCount(0);
  await expect(page.locator('#agent-chat-input')).not.toHaveAttribute('aria-busy');
});

test('V1 session action menu shares keyboard navigation, viewport placement and focus return',async({page})=>{
  await mockAssistant(page);await page.goto('/#/customer/create');
  const history=page.getByRole('button',{name:'Открыть историю требований',exact:true});
  await expect(history).toBeVisible();await history.click();
  const toggle=page.locator('[data-session-menu]').first();
  // The focus workspace keeps recent sessions in the sidebar.
  await expect(toggle).toBeAttached();
  const session=page.locator('[data-session-id]').first();await expect(session).toBeVisible();await session.focus();await expect(session).toBeFocused();await page.keyboard.press('ArrowRight');
  const menu=page.getByRole('menu',{name:'Действия с требованием'});await expect(menu).toBeVisible();
  await page.keyboard.press('End');await expect(menu.getByRole('menuitem').last()).toBeFocused();
  await page.keyboard.press('Home');await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(toggle).toBeFocused();
});
