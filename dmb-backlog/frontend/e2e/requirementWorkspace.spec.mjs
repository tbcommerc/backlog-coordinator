import { test, expect } from '@playwright/test';

const fixture = '/e2e/fixtures/requirementWorkspace.html';
import { mockWorkspace, initialDraft } from './helpers/requirementWorkspace.mjs';

for (const width of [1440, 390]) test(`review cards keep one finding open and provide a return from editing at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const mock = await mockWorkspace(page);
  const state = mock.getState();
  state.document_review = { id: 'r1', status: 'completed', base_fingerprint: 'h1', revision: 1 };
  state.document_findings = Array.from({ length: 8 }, (_, index) => ({ id: `f${index}`, review_id: 'r1', base_fingerprint: 'h1', status: 'open', severity: 'warning', field: 'business_goal', message: `Уточните метрику ${index + 1} и срок достижения результата`, quote: 'Сократить время обработки', method: 'llm' }));
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await page.getByRole('button', { name: /^Уточнения/ }).click();
  const cards = page.locator('.agent-v2-finding.is-guided');
  await expect(cards).toHaveCount(8);
  await expect(page.locator('.agent-v2-finding[open]')).toHaveCount(1);
  await cards.nth(1).locator(':scope > summary').click();
  await expect(page.locator('.agent-v2-finding[open]')).toHaveCount(1);
  await expect(cards.nth(1)).toHaveAttribute('open', '');
  await cards.nth(1).getByRole('button', { name: 'Изменить раздел', exact: true }).click();
  await expect(page.locator('[data-field="business_goal"] textarea')).toBeFocused();
  await page.getByRole('button', { name: 'Вернуться к замечаниям' }).click();
  await expect(cards.nth(1)).toHaveAttribute('open', '');
  await cards.nth(1).locator('.agent-v2-finding-evidence > summary').click();
  await expect(cards.nth(1).locator('blockquote')).toBeVisible();
  await page.screenshot({ path: info.outputPath('review-cards.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await cards.last().scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Черновик', exact: true })).toBeInViewport();
});

test('source parsing remains separate from full transfer and requirement opens exact evidence', async ({ page }) => {
  const mock = await mockWorkspace(page);
  const state = mock.getState();
  state.document_generation = { status: 'partial', facts_total: 1, facts_covered: 1,
    source_parsing: { status: 'partial', nonempty_lines: 4, accounted_lines: 4, unresolved: [{ line: 3 }] } };
  state.document_sources = [{ id: 'src-1', version: 1, title: 'Материалы', content: 'Цель\nСократить ожидание\nПримечание:\nУведомить исполнителя', sections: [] }];
  state.draft.business_requirements = [{ id: 'BR-001', text: 'Уведомить исполнителя', source_refs: ['src-1@1#L4'] }];
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await expect(page.getByLabel('Полнота переноса')).toContainText('неразобранных: 1');
  await expect(page.getByLabel('Полнота переноса')).toContainText('1 из 1 выделенных');
  const evidence = page.locator('#agent-v2-section-business_requirements details');
  await evidence.locator('summary').click();
  await expect(evidence.locator('blockquote')).toHaveText('Уведомить исполнителя');
  await expect(evidence.locator('summary')).toContainText('строка 4');
});

test('generation report separates missing input from failed processing and escapes evidence', async ({ page }, testInfo) => {
  const mock = await mockWorkspace(page);
  mock.getState().document_generation = { status: 'partial', facts_total: 10, facts_covered: 9,
    section_states: { current_process: { status: 'unprocessed' }, target_process: { status: 'missing_data', reason: 'Целевой процесс не описан' } },
    issues: [{ field: 'current_process', message: 'Потерян фрагмент', quote: '<script>unsafe</script>' }],
    questions: [{ origin: 'agent', text: 'Нужен email?', priority: 'optional', decision: 'out_of_scope', removed: true, reason: 'Email исключён' }] };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await expect(page.getByLabel('Полнота переноса')).toContainText('Есть замечания к переносу источников');
  await expect(page.locator('#agent-v2-section-current_process header')).toContainText('Не удалось обработать');
  await expect(page.locator('#agent-v2-section-target_process header')).toContainText('Нет данных в источнике');
  await expect(page.getByLabel('Полнота переноса')).toContainText('Разбор источника: отдельная проверка не выполнялась');
  await page.getByText('Замечания к разбору и переносу: 1', { exact: true }).click();
  await expect(page.locator('.agent-v2-transfer blockquote')).toHaveText('<script>unsafe</script>');
  await expect(page.locator('.agent-v2-transfer script')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('generation-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test('independent review preserves text, cites evidence and applies only selected changes', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const mock = await mockWorkspace(page);
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await page.getByRole('button', { name: 'Проверить черновик', exact: true }).click();
  await expect(page.locator('.agent-v2-finding').getByText('Не определено целевое время', { exact: true })).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('workspace-desktop.png') });
  expect(mock.getState().draft).toEqual(initialDraft);
  await expect(page.locator('.agent-v2-finding blockquote').first()).toHaveText('Сократить время');
  await page.getByRole('button', { name: 'Предложить текст с ИИ', exact: true }).last().click();
  await expect(page.locator('.agent-v2-proposal')).toBeVisible();
  await page.locator('input[value="op-2"]').uncheck();
  await page.getByRole('button', { name: 'Принять выбранные правки' }).click();
  await expect(page.locator('#agent-v2-section-business_goal .agent-v2-section-value')).toHaveText('Сократить обработку до 15 минут');
  expect(mock.getState().draft.scope_in).toBe(initialDraft.scope_in);
  await expect(page.getByText('Проверена предыдущая редакция', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Черновик', exact: true }).click();
  await page.getByRole('button', { name: 'Материалы и история', exact: true }).click();
  await page.locator('.agent-v2-version-comparison summary').click();
  await expect(page.locator('.agent-v2-version-comparison')).toContainText('Сократить время обработки');
  await expect(page.locator('.agent-v2-version-comparison')).toContainText('Сократить обработку до 15 минут');
  expect(mock.calls.find(call => call.body?.action === 'apply_proposal').body.operation_ids).toEqual(['op-1']);
});

test('findings require a reason; multiple sources invalidate review; degraded submission is explicit', async ({ page }) => {
  const mock = await mockWorkspace(page, { degraded: true });
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await page.getByRole('button', { name: 'Проверить черновик', exact: true }).click();
  await page.getByText('Уже решено или не согласны с замечанием?', { exact: true }).click();
  await page.locator('.agent-v2-finding-form textarea').fill('Метрика согласована в отдельном эксперименте');
  await page.getByRole('button', { name: 'Отклонить', exact: true }).click();
  await expect(page.getByText('Отклонено аналитиком')).toBeVisible();
  expect(mock.getState().draft).toEqual(initialDraft);
  await page.getByRole('button', { name: 'Материалы и история', exact: true }).click();
  await page.getByText('Добавить текстовый источник', { exact: true }).click();
  await page.locator('#agent-v2-add-source [name="title"]').fill('Регламент');
  await page.locator('#agent-v2-add-source [name="content"]').fill('Допустимое время обработки 15 минут');
  await page.getByRole('button', { name: 'Добавить материал' }).click();
  await expect(page.getByRole('heading', { name: 'Материалы (2)' })).toBeVisible();
  await page.getByRole('button', { name: /^Уточнения/ }).click();
  await expect(page.getByRole('button', { name: 'Проверить исправления' })).toBeVisible();
  await page.getByRole('button', { name: 'Проверить исправления', exact: true }).click();
  await page.getByRole('button', { name: 'Подготовить к согласованию' }).click();
  await expect(page.getByRole('region', { name: 'Перед отправкой' })).toBeVisible();
  await page.getByRole('button', { name: 'Отправить на согласование' }).click();
  expect(mock.calls.some(call => call.path === '/api/v2/agent/requirement-reviews')).toBe(false);
  await page.getByLabel('Передать с пометкой: ИИ-проверка недоступна').check();
  await page.getByRole('button', { name: 'Отправить на согласование' }).click();
  await expect(page.locator('.requirement-review-detail')).toBeVisible();
  expect(mock.calls.some(call => call.path.endsWith('/send-for-review'))).toBe(false);
  expect(mock.calls.find(call => call.path === '/api/v2/agent/requirement-reviews').body.acknowledge_degraded_review).toBe(true);
});

test('stale proposal fails safely and exposes explicit reload', async ({ page }) => {
  const mock = await mockWorkspace(page, { staleApply: true });
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await page.getByRole('button', { name: /^Уточнения/ }).click();
  await page.getByText('Попросить помощника о другой правке', { exact: true }).click();
  await page.locator('#agent-v2-document-instruction textarea').fill('Уточни целевое время');
  await page.locator('#agent-v2-document-instruction').getByRole('button', { name: 'Предложить правку' }).click();
  await page.getByRole('button', { name: 'Принять выбранные правки' }).click();
  await expect(page.getByRole('button', { name: 'Обновить документ' })).toBeVisible();
  expect(mock.getState().draft.business_goal).toBe(initialDraft.business_goal);
  await page.getByRole('button', { name: 'Обновить документ' }).click();
  await expect(page.locator('.agent-v2-revision')).toHaveText('Редакция 2');
  await expect(page.getByRole('button', { name: 'Принять выбранные правки' })).toHaveCount(0);
});

test('human review sends its own version and return comment without creating work', async ({ page }) => {
  const mock = await mockWorkspace(page);
  await page.goto(`${fixture}#/review?tab=requirements&requirement_review=45`);
  await expect(page.getByText('Зафиксированный документ', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Вернуть на доработку' }).click();
  expect(mock.calls.some(call => call.path.endsWith('/actions'))).toBe(false);
  await page.locator('#requirement-review-decision textarea').fill('Уточнить исключения при повторной заявке');
  await page.getByRole('button', { name: 'Вернуть на доработку' }).click();
  await expect(page.getByText('Комментарий к решению', { exact: true })).toBeVisible();
  const action = mock.calls.find(call => call.path.endsWith('/actions'));
  expect(action.body).toMatchObject({ action: 'return', version: 3, comment: 'Уточнить исключения при повторной заявке' });
  expect(mock.calls.some(call => /\/tasks|\/agent\/requests/.test(call.path))).toBe(false);
});

test('write flow prepares a readable initial draft from source', async ({ page }) => {
  const mock = await mockWorkspace(page);
  await page.goto(`${fixture}#/agent-v2`);
  await page.getByRole('button', { name: /Описать задачу/ }).click();
  await page.locator('#agent-v2-blank-start textarea').fill('Сократить ожидание клиентов при обработке онлайн-заявок');
  await page.locator('#agent-v2-blank-start').getByRole('button', { name: 'Подготовить черновик', exact: true }).click();
  await expect(page.locator('.agent-v2-document')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Проверить черновик', exact: true })).toBeVisible();
  expect(mock.getState().draft).toEqual(initialDraft);
  expect(mock.calls.filter(call => call.body?.action).map(call => call.body.action)).toEqual(['add_source', 'create_draft']);
});

test('mobile document and human review do not overflow horizontally', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkspace(page);
  for (const hash of ['#/agent-v2?session=doc-1', '#/review?tab=requirements&requirement_review=45']) {
    await page.goto(fixture + hash);
    await expect(page.locator(hash.startsWith('#/review') ? '.requirement-review-detail' : '.agent-v2-document')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (hash.startsWith('#/agent-v2')) {
      const newDocumentButton = await page.locator('#agent-v2-new-work').boundingBox();
      expect(newDocumentButton.x + newDocumentButton.width).toBeLessThanOrEqual(390);
      await page.locator('.agent-v2-document-head').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('workspace-mobile.png') });
    }
  }
});

test('new working revision never inherits the previous human approval', async ({ page }) => {
  await mockWorkspace(page, { humanStatus: 'approved' });
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await expect(page.locator('.agent-v2-journey li').last()).toHaveClass('is-done');
  await page.getByRole('button', { name: 'Материалы и история', exact: true }).click();
  await page.getByRole('button', { name: 'Начать следующую редакцию' }).click();
  await expect(page.locator('.agent-v2-revision')).toHaveText('Редакция 2');
  await expect(page.locator('.agent-v2-journey li').last()).not.toHaveClass('is-done');
});


test('autosave batches neighboring sections and survives session and SPA navigation', async ({ page }) => {
  const mock = await mockWorkspace(page);
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await page.getByRole('button', { name: 'Изменить: Проблема', exact: true }).click();
  const problem = page.locator('[data-field="problem_statement"] textarea');
  await problem.fill('Новое описание проблемы');
  await page.getByRole('button', { name: 'Изменить: Бизнес-цель', exact: true }).click();
  await page.locator('[data-field="business_goal"] textarea').fill('Новая цель');
  await expect(page.locator('#agent-v2-save-status')).toHaveText('Все правки сохранены');
  expect(mock.getState().draft.problem_statement).toBe('Новое описание проблемы');
  expect(mock.getState().draft.business_goal).toBe('Новая цель');
  await expect(problem).toBeVisible();
  await page.locator('.agent-v2-recents>summary').click();
  await page.locator('[data-session="doc-2"]').click();
  await expect(page).toHaveURL(/session=doc-2$/);
  await expect(page.locator('[data-session="doc-2"]')).toHaveAttribute('aria-current', 'true');
  await page.locator('.agent-v2-recents>summary').click();
  await page.locator('[data-session="doc-1"]').click();
  await expect(page).toHaveURL(/session=doc-1$/);
  await expect(problem).toHaveValue('Новое описание проблемы');
  await page.evaluate(() => { location.hash = '#/review?tab=requirements&requirement_review=45'; });
  await expect(page.locator('.requirement-review-detail')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/agent-v2?session=doc-1'; });
  await expect(problem).toHaveValue('Новое описание проблемы');
  await page.locator('[data-field="problem_statement"]').getByRole('button', { name: 'Закрыть' }).click();
  await page.getByRole('button', { name: 'Изменить: Проблема', exact: true }).click();
  await expect(problem).toHaveValue('Новое описание проблемы');
});

test('title edits update document and recent list, outline transfers keyboard focus', async ({ page }) => {
  await mockWorkspace(page);
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await page.getByRole('button', { name: 'Изменить: Название', exact: true }).click();
  await page.getByRole('textbox', { name: 'Название', exact: true }).fill('Новое название');
  await page.locator('[data-field="title"]').getByRole('button', { name: 'Готово' }).click();
  await expect(page.locator('.agent-v2-document-head h2')).toHaveText('Новое название');
  await page.locator('.agent-v2-recents>summary').click();
  await expect(page.locator('[data-session="doc-1"] strong')).toHaveText('Новое название');
  await expect(page.locator('[data-session="doc-1"] time')).not.toContainText('T14:');
  await page.locator('.agent-v2-compact-outline>summary').click();
  await page.locator('.agent-v2-outline-more>summary').click();
  await page.getByRole('link', { name: 'За границами', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#agent-v2-section-scope_out')).toBeFocused();
  expect(page.url()).toContain('session=doc-1');
});

test('unknown import headings are visible and can be mapped without overwriting an existing section', async ({ page }) => {
  const mock = await mockWorkspace(page);
  mock.getState().document_sources[0] = { id: 'src-1', title: 'Документ', version: 1,
    content: '# Документ\n## Особые условия\nТолько онлайн', sections: [{ title: 'Особые условия', content: '## Особые условия\nТолько онлайн' }],
    import_result: { recognized_fields: ['need_statement'], unmapped_sections: ['Особые условия'] } };
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await expect(page.locator('.agent-v2-import-result')).toContainText('распознано 1, не распознано 1');
  await page.getByLabel('Назначить раздел').selectOption('scope_in');
  await page.getByRole('button', { name: 'Перенести в редактор' }).click();
  await expect(page.locator('[data-field="scope_in"] textarea')).toHaveValue('Заявки клиентов\nТолько онлайн');
  expect(mock.getState().draft.scope_in).toBe(initialDraft.scope_in);
});

test('pending review announces progress; degraded result never marks the review step done', async ({ page }) => {
  await mockWorkspace(page, { degraded: true });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  await page.route('**/api/v2/agent/document-action', async route => { await pending; await route.fallback(); });
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await page.getByRole('button', { name: 'Проверить черновик', exact: true }).click();
  await expect(page.locator('#agent-v2-operation-status')).toHaveText('Проверяем документ…');
  await expect(page.getByRole('button', { name: 'Проверить черновик', exact: true })).toBeDisabled();
  release();
  await expect(page.locator('#agent-v2-operation-status')).toBeHidden();
  await expect(page.locator('.agent-v2-journey li').nth(2)).toContainText('Уточнения');
  await expect(page.locator('.agent-v2-journey li').nth(2)).not.toHaveClass('is-done');
});

for (const [width, height] of [[1920,1080],[1440,900],[1366,768],[768,1024],[390,844],[320,740]]) {
  test(`document and tools are reachable on first screen at ${width}x${height}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await mockWorkspace(page);
    await page.goto(`${fixture}#/agent-v2?session=doc-1`);
    // Approximate the production global navigation width on desktop.
    if (width >= 1000) await page.addStyleTag({ content: '#root{margin-left:240px}' });
    await expect(page.locator('.agent-v2-document-head')).toBeVisible();
    const heading = await page.locator('.agent-v2-document-head').boundingBox();
    expect(heading.y + heading.height).toBeLessThan(height);
    expect((await page.locator('.agent-v2-br-list').boundingBox()).y).toBeLessThan(height);
    const switcher = page.getByRole('button', { name: 'Уточнения', exact: true });
    expect((await switcher.boundingBox()).y).toBeLessThan(height);
    await switcher.click();
    await expect(page.getByRole('button', { name: 'Проверить исправления', exact: true })).toBeVisible();
    expect((await page.getByRole('button', { name: 'Проверить исправления', exact: true }).boundingBox()).y).toBeLessThan(height);
    await page.getByRole('button', { name: 'Материалы и история', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Материалы (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Черновик', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`audit-${width}.png`) });
  });
}


test('keyboard start selection, unload warning and light theme remain usable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkspace(page);
  await page.goto(`${fixture}#/agent-v2`);
  const choice = page.getByRole('button', { name: /Описать задачу/ });
  await choice.focus(); await page.keyboard.press('Enter');
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#agent-v2-blank-start textarea')).toBeVisible();
  await page.evaluate(() => { location.hash = '#/agent-v2?session=doc-1'; document.documentElement.dataset.theme = 'light'; });
  await page.getByRole('button', { name: 'Изменить: Проблема', exact: true }).click();
  await page.locator('[data-field="problem_statement"] textarea').fill('Несохранённый текст');
  const prevented = await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
  expect(prevented).toBe(true);
  await page.locator('[data-field="problem_statement"]').getByRole('button', { name: 'Закрыть' }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('audit-light-mobile.png') });
});

test('typing during autosave preserves focus and saves the latest text before review', async ({ page }) => {
  const mock = await mockWorkspace(page);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let held = false;
  await page.route('**/api/v2/agent/document-action', async route => {
    if (route.request().postDataJSON().action === 'save_sections' && !held) { held = true; await pending; }
    await route.fallback();
  });
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await page.getByRole('button', { name: 'Изменить: Проблема', exact: true }).click();
  const input = page.locator('[data-field="problem_statement"] textarea');
  await input.fill('Первая формулировка');
  await expect(page.locator('#agent-v2-save-status')).toHaveText('Сохраняем…');
  await input.fill('Окончательная формулировка');
  release();
  await expect(page.locator('#agent-v2-save-status')).toHaveText('Все правки сохранены');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('Окончательная формулировка');
  await page.getByRole('button', { name: 'Проверить черновик', exact: true }).click();
  const saves = mock.calls.filter(call => call.body?.action === 'save_sections');
  expect(saves).toHaveLength(2);
  expect(saves[1].body.expected_draft_hash).toBe('h2');
  expect(mock.getState().draft.problem_statement).toBe('Окончательная формулировка');
  expect(mock.calls.find(call => call.body?.action === 'review').body.expected_draft_hash).toBe('h3');
});

test('autosave conflict retains local text and needs explicit choice after reload', async ({ page }) => {
  const mock = await mockWorkspace(page);
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await expect(page.locator('.agent-v2-revision')).toHaveText('Редакция 1');
  mock.getState().draft = { ...mock.getState().draft, problem_statement: 'Правка другого окна', fingerprint: 'external', revision: 2 };
  await page.getByRole('button', { name: 'Изменить: Проблема', exact: true }).click();
  const input = page.locator('[data-field="problem_statement"] textarea');
  await input.fill('Мой локальный текст');
  await page.getByRole('button', { name: 'Загрузить актуальную редакцию' }).click();
  await expect(input).toHaveValue('Мой локальный текст');
  await expect(page.locator('#agent-v2-section-problem_statement .agent-v2-section-value')).toHaveText('Правка другого окна');
  await expect(page.getByRole('button', { name: 'Сохранить мои правки' })).toBeVisible();
  expect(mock.getState().draft.problem_statement).toBe('Правка другого окна');
  await page.getByRole('button', { name: 'Сохранить мои правки' }).click();
  await expect(page.locator('#agent-v2-save-status')).toHaveText('Все правки сохранены');
  expect(mock.getState().draft.problem_statement).toBe('Мой локальный текст');
});

test('critical unknown remains blocked; answering focuses the section; AI text may be declined', async ({ page }) => {
  const mock = await mockWorkspace(page);
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await page.getByRole('button', { name: 'Проверить черновик', exact: true }).click();
  mock.getState().document_findings[0].severity = 'critical';
  await page.getByRole('button', { name: 'Уточнения (1)', exact: true }).click();
  await page.getByRole('button', { name: 'Отложить вопрос', exact: true }).click();
  await expect(page.getByText('Этот вопрос блокирует согласование.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подготовить к согласованию' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Изменить раздел', exact: true }).click();
  await expect(page.locator('[data-field="business_goal"] textarea')).toBeFocused();
  await page.getByRole('button', { name: 'Уточнения (1)', exact: true }).click();
  await page.getByRole('button', { name: 'Предложить текст с ИИ', exact: true }).click();
  await page.getByRole('button', { name: 'Оставить мой текст' }).click();
  await expect(page.locator('.agent-v2-proposal')).toHaveCount(0);
  expect(mock.getState().draft).toEqual(initialDraft);
});

test('preview is separate from sending and contains exact saved text', async ({ page }, testInfo) => {
  const mock = await mockWorkspace(page);
  await page.goto(`${fixture}#/agent-v2?session=doc-1`);
  await page.getByRole('button', { name: 'Проверить черновик', exact: true }).click();
  await page.getByRole('button', { name: 'Подготовить к согласованию' }).click();
  await expect(page.getByRole('region', { name: 'Перед отправкой' })).toContainText('очередь согласования бизнес-требований');
  await expect(page.getByRole('region', { name: 'Перед отправкой' })).toContainText(initialDraft.acceptance_criteria[0]);
  expect(mock.calls.some(call => call.path === '/api/v2/agent/requirement-reviews')).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('approval-preview.png') });
  await page.getByRole('button', { name: 'Отправить на согласование' }).click();
  await expect(page.locator('.requirement-review-detail')).toBeVisible();
  expect(mock.calls.find(call => call.path === '/api/v2/agent/requirement-reviews').body.expected_draft_hash).toBe('h1');
});

test('generation failure retains the source and offers retry and manual editing', async ({ page }) => {
  const mock = await mockWorkspace(page);
  await page.route('**/api/v2/agent/document-action', async route => {
    if (route.request().postDataJSON().action === 'create_draft') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: { message: 'Не удалось подготовить черновик. Материалы сохранены.' } }) });
    await route.fallback();
  });
  await page.goto(`${fixture}#/agent-v2`);
  await page.locator('#agent-v2-blank-start textarea').fill('Материал для повторной попытки');
  await page.getByRole('button', { name: 'Подготовить черновик', exact: true }).click();
  await expect(page.locator('#agent-v2-error')).toContainText('Материалы сохранены');
  await expect(page.getByRole('button', { name: 'Подготовить черновик', exact: true })).toBeVisible();
  expect(mock.getState().document_sources[0].content).toBe('Материал для повторной попытки');
  await page.getByRole('button', { name: 'Изменить: Проблема', exact: true }).click();
  await page.locator('[data-field="problem_statement"] textarea').fill('Документ заполняется вручную');
  await expect(page.locator('#agent-v2-save-status')).toHaveText('Все правки сохранены');
  expect(mock.getState().draft.problem_statement).toBe('Документ заполняется вручную');
});

for (const theme of ['light', 'dark']) for (const mode of ['desktop', 'compact', 'mobile', 'touch']) {
  test(`V2 edit control obeys computed kit geometry: ${theme}, ${mode}`, async ({ browser, browserName }, info) => {
    test.skip(browserName==='firefox' && mode==='touch','Playwright Firefox does not support hasTouch');
    const context = await browser.newContext({ viewport: {width:mode === 'mobile' ? 390 : 1440,height:900}, ...(browserName==='firefox'?{}:{hasTouch:mode === 'touch'}) });
    const page = await context.newPage();
    await mockWorkspace(page);
    await page.goto(`${fixture}#/agent-v2?session=doc-1`);
    await page.evaluate(({theme,mode})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.compact=String(mode==='compact');},{theme,mode});
    const edits = page.locator('.agent-v2-edit-toggle:visible');
    await expect(edits.first()).toBeVisible();
    const sizes = await edits.evaluateAll(elements=>elements.map(el=>({height:el.getBoundingClientRect().height,font:getComputedStyle(el).fontSize, css:Object.fromEntries(['padding','border','line-height','display','min-height','height'].map(key=>[key,getComputedStyle(el).getPropertyValue(key)])),html:el.outerHTML})));
    for (const size of sizes) { expect(size.height,JSON.stringify(size)).toBe(['mobile','touch'].includes(mode)?44:mode==='compact'?28:32); expect(size.font).toBe('13px'); }
    await edits.first().click();
    await expect(page.locator('.agent-v2-section-form:visible').first()).toBeVisible();
    await page.screenshot({path:info.outputPath('v2-kit-sizing.png')});
    await context.close();
  });
}
