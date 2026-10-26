import { test, expect } from '@playwright/test';

async function mockMeetings(page, { failAnalysis = false, authFailure = false, empty = false, gate, loseResponse = false, disconnect = false, failSave = false, itemCount = 1 } = {}) {
    let state, confirmations = 0, analyses = 0;
    const task = { id: 42, public_id: 'TASK-000-042', title: 'Автоматизация управленческой отчётности', reason: 'Совпадение по теме: отчёт' };
    await page.route('**/api/v1/meeting-capture/**', async route => {
        const path = new URL(route.request().url()).pathname, method = route.request().method();
        const body = route.request().postDataJSON();
        const respond = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        if (path.endsWith('/sessions')) return respond(state ? [{ id: state.id, title: state.title, status: state.status }] : []);
        if (path.endsWith('/suggestions') || path.endsWith('/tasks')) return respond([task]);
        if (path.endsWith('/analyze')) {
            analyses++;
            if (gate) await gate;
            if (disconnect) return route.abort('connectionreset');
            if (authFailure) return respond({ detail: { code: 'meeting_ai_auth', message: 'Провайдер AI отклонил авторизацию.' } }, 503);
            if (failAnalysis) return respond({ detail: 'AI временно недоступен' }, 502);
            state.items = empty ? [] : Array.from({ length: itemCount }, (_, index) => ({ id: `item-${index}`, kind: index ? 'agreement' : 'action', title: index ? 'Согласовать формат отчёта' : 'Подготовить управленческий отчёт', description: 'Сверить показатели и подготовить отчёт для обсуждения.', owner_text: index ? '' : 'Анна', due_date: null, due_text: 'к пятнице', quote: 'Анна: подготовлю отчёт к пятнице.', origin: 'ai', selected: false, link_choice: null, task_id: null }));
            state.version++;
            if (loseResponse) return route.abort('connectionreset');
            return respond(state);
        }
        if (path.endsWith('/confirm')) { confirmations++; state.status = 'saved'; state.saved_count = state.items.filter(item => item.selected).length; return respond(state); }
        if (failSave && ['POST', 'PUT'].includes(method)) return respond({ detail: 'Не удалось сохранить черновик' }, 503);
        if (method === 'POST') state = { ...body, id: path.split('/').at(-1), version: 1, status: 'draft', links: [], saved_count: 0 };
        if (method === 'PUT') state = { ...state, ...body, version: state.version + 1, links: body.items.some(item => item.task_id) ? [task] : [] };
        return respond(state);
    });
    return { getState: () => state, confirmations: () => confirmations, analyses: () => analyses };
}

async function startAnalysis(page) {
    await page.goto('/e2e/fixtures/meetingCapture.html');
    await page.getByLabel('Или вставьте текст').fill('Анна: подготовлю отчёт к пятнице.');
    await page.getByRole('button', { name: 'Найти поручения и договорённости' }).click();
}

test('review, manual correction, explicit task choice and confirmation', async ({ page }, info) => {
    const mock = await mockMeetings(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/e2e/fixtures/meetingCapture.html');
    await expect(page.getByRole('heading', { name: 'Поручения из встреч' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('meeting-empty.png'), fullPage: true });
    await page.getByLabel('Название встречи').fill('Еженедельная встреча команды');
    await page.getByLabel('Или вставьте текст').fill('Анна: подготовлю отчёт к пятнице.');
    await page.getByRole('button', { name: 'Найти поручения и договорённости' }).click();
    await expect(page.getByLabel('Что согласовано')).toBeVisible();
    await expect(page.getByLabel('Проверено — включить в сохранение')).not.toBeChecked();
    expect(mock.confirmations()).toBe(0);
    await page.locator('.mc-link-box > summary').click();
    await page.getByRole('button', { name: 'Предложить соответствия' }).click();
    await expect(page.getByRole('button', { name: /TASK-000-042/ })).toBeVisible();
    await expect(page.getByLabel('Решение о привязке')).toHaveValue('');
    await page.getByRole('button', { name: /TASK-000-042/ }).click();
    await page.getByLabel('Проверено — включить в сохранение').check();
    await page.getByLabel('Что согласовано').fill('Подготовить и сверить управленческий отчёт');
    await expect(page.getByLabel('Проверено — включить в сохранение')).not.toBeChecked();
    await page.getByLabel('Подтверждённый срок').fill('2026-10-16');
    await page.screenshot({ path: info.outputPath('meeting-review.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('meeting-mobile.png'), fullPage: true });
    await page.getByLabel('Проверено — включить в сохранение').check();
    await page.getByRole('button', { name: 'Перейти к подтверждению — 1' }).click();
    await expect(page.getByRole('heading', { name: 'Проверьте перед сохранением' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Проверьте перед сохранением' })).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'Проверьте перед сохранением' })).toBeFocused();
    expect(mock.confirmations()).toBe(0);
    await page.getByRole('button', { name: 'Создать выбранные записи — 1' }).click();
    await expect(page.getByRole('heading', { name: 'Результат сохранён' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Результат сохранён' })).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'Результат сохранён' })).toBeFocused();
    expect(mock.confirmations()).toBe(1);
    expect(mock.getState().items[0].task_id).toBe(42);
    await page.getByRole('button', { name: 'Новый разбор' }).click();
    await page.getByText('Мои разборы встреч', { exact: true }).click();
    await page.getByRole('button', { name: 'Еженедельная встреча команды' }).click();
    await expect(page.getByRole('heading', { name: 'Результат сохранён' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Результат сохранён' })).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'Результат сохранён' })).toBeFocused();
});

test('file upload and unavailable AI preserve text and allow manual work', async ({ page }) => {
    await mockMeetings(page, { failAnalysis: true });
    await page.goto('/e2e/fixtures/meetingCapture.html');
    await page.locator('#mc-file').setInputFiles({ name: 'Протокол.txt', mimeType: 'text/plain', buffer: Buffer.from('Анна: подготовлю отчёт к пятнице.') });
    await expect(page.getByLabel('Или вставьте текст')).toHaveValue('Анна: подготовлю отчёт к пятнице.');
    await page.getByRole('button', { name: 'Найти поручения и договорённости' }).click();
    await expect(page.getByRole('alert')).toContainText('AI временно недоступен');
    await expect(page.getByLabel('Или вставьте текст')).toHaveValue('Анна: подготовлю отчёт к пятнице.');
    await page.getByRole('button', { name: 'Добавить пункт вручную' }).click();
    await page.locator('.mc-link-box > summary').click();
    await page.getByLabel('Решение о привязке').selectOption('none');
    await page.getByLabel('Проверено — включить в сохранение').check();
    await page.getByRole('button', { name: 'Перейти к подтверждению — 1' }).click();
    await expect(page.getByRole('heading', { name: 'Проверьте перед сохранением' })).toBeVisible();
});

test('delayed analysis shows saved source, elapsed time, active step and blocks duplicate requests', async ({ page }, info) => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const mock = await mockMeetings(page, { gate });
    await page.clock.install();
    await startAnalysis(page);
    await expect(page.getByRole('heading', { name: 'Анализируем расшифровку' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Анализируем расшифровку' })).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'Анализируем расшифровку' })).toBeFocused();
    await expect(page.locator('[aria-current="step"]')).toHaveText('2 Анализ');
    await expect(page.locator('#mc-draft-status')).toHaveText('Расшифровка сохранена · анализ выполняется');
    await expect(page.getByRole('heading', { name: 'Здесь появится план действий' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Анализируем…' })).toBeDisabled();
    await expect(page.getByLabel('Или вставьте текст')).toBeEnabled();
    await expect(page.getByLabel('Или вставьте текст')).toHaveAttribute('readonly', '');
    await page.clock.fastForward(61_000);
    await expect(page.locator('#mc-elapsed')).toHaveText('01:01');
    await expect(page.locator('#mc-long-wait')).toBeVisible();
    await expect(page.locator('#mc-notice')).toContainText('Повторно запускать разбор не нужно');
    await page.screenshot({ path: info.outputPath('meeting-waiting.png'), fullPage: true });
    expect(await page.evaluate(() => window.testApp.router.onBeforeNavigate('/backlog'))).toBe(false);
    expect(mock.analyses()).toBe(1);
    release();
    await expect(page.getByLabel('Что согласовано')).toBeVisible();
    await expect(page.locator('#mc-elapsed')).toHaveCount(0);
    await expect(page.locator('[aria-current="step"]')).toHaveText('3 Проверка результатов');
});

test('empty result is a completed state and manual work remains available', async ({ page }) => {
    const mock = await mockMeetings(page, { empty: true });
    await startAnalysis(page);
    await expect(page.getByRole('heading', { name: 'Разбор завершён' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Здесь появится план действий' })).toHaveCount(0);
    await expect(page.locator('#mc-draft-status')).toHaveText('Черновик сохранён');
    await expect(page.getByRole('button', { name: 'Перейти к подтверждению — 0' })).toBeDisabled();
    await page.getByRole('button', { name: 'Добавить пункт вручную' }).click();
    await expect(page.getByLabel('Что согласовано')).toHaveValue('Новое поручение');
    expect(mock.confirmations()).toBe(0);
});

test('save failure preserves input without claiming that source was saved', async ({ page }) => {
    const mock = await mockMeetings(page, { failSave: true });
    await startAnalysis(page);
    await expect(page.getByRole('heading', { name: 'Не удалось завершить разбор' })).toBeVisible();
    await expect(page.getByText('Текст остаётся на странице. Сохранение черновика не подтверждено.')).toBeVisible();
    await expect(page.getByLabel('Или вставьте текст')).toBeEditable();
    await expect(page.getByLabel('Или вставьте текст')).toHaveValue('Анна: подготовлю отчёт к пятнице.');
    expect(mock.analyses()).toBe(0);
});

test('lost response recovers stored result without repeating AI or overwriting items', async ({ page }) => {
    const mock = await mockMeetings(page, { loseResponse: true });
    await startAnalysis(page);
    await expect(page.getByLabel('Что согласовано')).toBeVisible();
    await expect(page.locator('#mc-notice')).toContainText('Результат восстановлен');
    expect(mock.analyses()).toBe(1);
    expect(mock.confirmations()).toBe(0);
});

test('unknown outcome can be checked later and retry recovers a late result', async ({ page }) => {
    const mock = await mockMeetings(page, { disconnect: true });
    await startAnalysis(page);
    await expect(page.getByRole('heading', { name: 'Не удалось получить результат' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Не удалось связаться с сервером');
    await expect(page.getByText('Исходная расшифровка сохранена в черновике.')).toBeVisible();
    await page.getByRole('button', { name: 'Проверить результат' }).click();
    await expect(page.locator('#mc-notice')).toContainText('Готовый результат пока не сохранён');
    mock.getState().items = [{ id: 'late', kind: 'action', title: 'Поздний результат', selected: false, owner_text: '', due_date: null, link_choice: null }];
    mock.getState().version++;
    await page.getByRole('button', { name: 'Повторить анализ' }).click();
    await expect(page.getByLabel('Что согласовано')).toHaveValue('Поздний результат');
    expect(mock.analyses()).toBe(1);
});

test('compact review navigates unchecked items and edits invalidate review with live counters', async ({ page }) => {
    await mockMeetings(page, { itemCount: 2 });
    await startAnalysis(page);
    const items = page.locator('.mc-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveAttribute('open', '');
    await expect(items.nth(1)).not.toHaveAttribute('open');
    await items.nth(0).getByLabel('Проверено — включить в сохранение').check();
    await expect(page.locator('[data-review-count]')).toHaveText('1');
    await page.getByRole('button', { name: 'Следующий непроверенный' }).click();
    await expect(items.nth(1)).toHaveAttribute('open', '');
    await expect(items.nth(0)).not.toHaveAttribute('open');
    await expect(items.nth(1).locator('summary').first()).toBeFocused();
    await items.nth(1).getByLabel('Проверено — включить в сохранение').check();
    await expect(page.locator('[data-review-count]')).toHaveText('2');
    await expect(page.getByRole('button', { name: 'Следующий непроверенный' })).toBeDisabled();
    await items.nth(1).getByLabel('Что согласовано').fill('Уточнённая договорённость');
    await expect(page.locator('[data-review-count]')).toHaveText('1');
    await expect(items.nth(1).locator('[data-summary-title]')).toHaveText('Уточнённая договорённость');
    await expect(items.nth(1).getByLabel('Проверено — включить в сохранение')).not.toBeChecked();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('retry after AI error is explicit and preserves saved source', async ({ page }) => {
    const mock = await mockMeetings(page, { failAnalysis: true });
    await startAnalysis(page);
    await expect(page.getByRole('heading', { name: 'Не удалось завершить разбор' })).toBeVisible();
    expect(mock.analyses()).toBe(1);
    await page.getByRole('button', { name: 'Повторить анализ' }).click();
    await expect(page.getByRole('heading', { name: 'Не удалось завершить разбор' })).toBeVisible();
    expect(mock.analyses()).toBe(2);
    expect(mock.getState().transcript).toBe('Анна: подготовлю отчёт к пятнице.');
});

test('late server result cannot overwrite local edits during retry', async ({ page }) => {
    const mock = await mockMeetings(page, { disconnect: true });
    await startAnalysis(page);
    await expect(page.getByRole('heading', { name: 'Не удалось получить результат' })).toBeVisible();
    await page.getByLabel('Или вставьте текст').fill('Локальные исправления');
    mock.getState().items = [{ id: 'late', kind: 'action', title: 'Серверный результат', selected: false }];
    mock.getState().version++;
    await page.getByRole('button', { name: 'Найти поручения и договорённости' }).click();
    await expect(page.getByRole('alert')).toContainText('На сервере есть более новая версия');
    await expect(page.getByLabel('Или вставьте текст')).toHaveValue('Локальные исправления');
    expect(mock.getState().items[0].title).toBe('Серверный результат');
    expect(mock.analyses()).toBe(1);
});

test('provider authorization failure explains required configuration and preserves manual work', async ({ page }) => {
    const mock = await mockMeetings(page, { authFailure: true });
    await startAnalysis(page);
    await expect(page.getByRole('heading', { name: 'Нужно проверить настройки AI' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Нужно проверить настройки AI' })).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'Нужно проверить настройки AI' })).toBeFocused();
    await expect(page.getByText(/Повтор без изменения настроек не поможет/)).toBeVisible();
    await expect(page.locator('[aria-current="step"]')).toHaveText('2 Анализ');
    await expect(page.getByRole('button', { name: 'Повторить после настройки AI' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Повторить анализ', exact: true })).toHaveCount(0);
    await expect(page.locator('#mc-draft-status')).toHaveText('Черновик сохранён');
    expect(mock.analyses()).toBe(1);
    await page.getByRole('button', { name: 'Добавить пункт вручную' }).click();
    await expect(page.getByLabel('Что согласовано')).toBeVisible();
});
