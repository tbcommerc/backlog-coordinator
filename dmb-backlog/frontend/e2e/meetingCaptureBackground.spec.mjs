import { test, expect } from '@playwright/test';

const fixture = '/e2e/fixtures/meetingCapture.html';

async function backgroundAPI(page) {
    let row, starts = 0, polls = 0, nextPollFailure = false, holdPoll, holdHistory, loseAcceptance = false;
    const respond = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/api/v1/meeting-capture/**', async route => {
        const path = new URL(route.request().url()).pathname;
        const method = route.request().method(), body = route.request().postDataJSON();
        if (path.endsWith('/sessions')) { if (row && holdHistory) await holdHistory; return respond(route, row ? [{ ...row, item_count: row.items.length }] : []); }
        if (path.endsWith('/analyze')) {
            if (!['queued', 'running', 'completed'].includes(row.analysis_status)) {
                starts++; row = { ...row, version: row.version + 1, analysis_status: 'queued', analysis_run_id: `run-${starts}`, analysis_requested_at: new Date().toISOString(), analysis_started_at: null, analysis_finished_at: null, analysis_error_code: null };
            }
            if (loseAcceptance) { loseAcceptance = false; return route.abort('connectionreset'); }
            return respond(route, row, 202);
        }
        if (path.endsWith('/status')) {
            polls++;
            if (holdPoll) await holdPoll;
            if (nextPollFailure) { nextPollFailure = false; return route.abort('connectionreset'); }
            const { transcript, items, title, links, ...status } = row;
            return respond(route, status);
        }
        if (method === 'POST') row = { ...body, id: path.split('/').at(-1), version: 1, status: 'draft', analysis_status: 'idle', links: [], saved_count: 0 };
        if (method === 'PUT') row = { ...row, ...body, version: row.version + 1, analysis_status: body.transcript !== row.transcript || body.meeting_date !== row.meeting_date ? 'idle' : row.analysis_status };
        return respond(route, row);
    });
    return {
        starts: () => starts, polls: () => polls, row: () => row,
        running: () => { row.analysis_status = 'running'; row.analysis_started_at = new Date().toISOString(); },
        finish: (empty = false) => {
            row.analysis_status = 'completed'; row.analysis_finished_at = new Date().toISOString(); row.version++;
            row.items = empty ? [] : [{ id: 'ai-one', title: 'Подготовить отчёт', description: '', kind: 'action', owner_text: 'Анна', due_date: null, due_text: 'к пятнице', quote: 'Анна: подготовлю отчёт к пятнице.', origin: 'ai', selected: false, link_choice: null, task_id: null }];
        },
        fail: () => { row.analysis_status = 'failed'; row.analysis_error_code = 'interrupted'; row.analysis_error_message = 'Обработка прервана. Можно запустить новый анализ.'; row.version++; },
        failNextPoll: () => { nextPollFailure = true; },
        hold: promise => { holdPoll = promise; },
        loseAcceptance: () => { loseAcceptance = true; },
        holdHistory: promise => { holdHistory = promise; },
    };
}

async function begin(page) {
    await page.goto(fixture);
    await page.getByLabel('Название встречи').fill('QA фоновый разбор');
    await page.getByLabel('Или вставьте текст').fill('Анна: подготовлю отчёт к пятнице.');
    await page.getByRole('button', { name: 'Найти поручения и договорённости' }).click();
    await expect(page.getByRole('heading', { name: 'Анализ в очереди' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Новый разбор', exact: true })).toBeEnabled();
}

test('notification link overrides remembered capture and new draft clears the link', async ({ page }) => {
    const api = await backgroundAPI(page);
    await begin(page);
    api.finish();
    const id = api.row().id;
    await page.evaluate(() => sessionStorage.setItem('meeting-capture:active:fixture', '11111111-1111-1111-1111-111111111111'));
    const reads = [];
    page.on('request', request => { if (request.method() === 'GET' && /\/sessions\/[^/]+$/.test(new URL(request.url()).pathname)) reads.push(request.url()); });
    await page.goto(`${fixture}#/meeting-capture?capture=${id}`);
    await expect(page.getByLabel('Что согласовано')).toHaveValue('Подготовить отчёт');
    expect(reads.some(url => url.endsWith(`/sessions/${id}`))).toBe(true);
    expect(reads.some(url => url.endsWith('/sessions/11111111-1111-1111-1111-111111111111'))).toBe(false);
    await page.getByRole('button', { name: 'Новый разбор', exact: true }).click();
    await expect(page.getByLabel('Название встречи')).toHaveValue('Новая встреча');
    expect(new URL(page.url()).hash).toBe('#/meeting-capture');
    expect(api.starts()).toBe(1);
});

test('accepted job survives refresh and completion is fetched without starting AI again', async ({ page }) => {
    const api = await backgroundAPI(page);
    await begin(page);
    const id = api.row().id;
    api.running();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Анализируем расшифровку' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Анализируем расшифровку' })).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'Анализируем расшифровку' })).toBeFocused();
    await expect(page.getByLabel('Название встречи')).toHaveValue('QA фоновый разбор');
    await expect(page.getByLabel('Название встречи')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Добавить пункт вручную' })).toBeDisabled();
    await expect(page.getByText(/Можно уйти со страницы или обновить её/)).toBeVisible();
    api.finish();
    await expect(page.getByLabel('Что согласовано')).toHaveValue('Подготовить отчёт');
    expect(api.row().id).toBe(id);
    expect(api.starts()).toBe(1);
    expect(api.polls()).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByLabel('Что согласовано')).toHaveValue('Подготовить отчёт');
    expect(api.starts()).toBe(1);
});

test('navigation is allowed during background work and return restores the finished result', async ({ page }) => {
    const api = await backgroundAPI(page);
    await begin(page);
    expect(await page.evaluate(() => window.testApp.router.onBeforeNavigate('/backlog'))).toBe(true);
    await page.goto('about:blank');
    api.finish();
    await page.goto(fixture);
    await expect(page.getByLabel('Что согласовано')).toHaveValue('Подготовить отчёт');
    expect(api.starts()).toBe(1);
});

test('late polling response cannot replace a new draft', async ({ page }) => {
    const api = await backgroundAPI(page);
    let release;
    api.hold(new Promise(resolve => { release = resolve; }));
    await begin(page);
    await expect.poll(api.polls).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Новый разбор', exact: true }).click();
    await page.getByLabel('Название встречи').fill('Другой разбор');
    api.finish(); release();
    await page.waitForTimeout(2200);
    await expect(page.getByLabel('Название встречи')).toHaveValue('Другой разбор');
    await expect(page.locator('.mc-item')).toHaveCount(0);
    expect(api.starts()).toBe(1);
});

test('temporary status failure retries reads and never repeats extraction', async ({ page }) => {
    const api = await backgroundAPI(page);
    api.failNextPoll();
    await begin(page);
    await expect(page.getByRole('alert')).toContainText('Не удалось обновить статус');
    api.finish();
    await expect(page.getByLabel('Что согласовано')).toHaveValue('Подготовить отчёт');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(api.starts()).toBe(1);
});

test('completed empty result survives refresh and changed source permits a new run', async ({ page }) => {
    const api = await backgroundAPI(page);
    await begin(page);
    api.finish(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Разбор завершён' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Найти поручения и договорённости' })).toBeDisabled();
    await page.getByLabel('Или вставьте текст').fill('Новый исходный текст');
    await page.getByRole('button', { name: 'Найти поручения и договорённости' }).click();
    await expect(page.getByRole('heading', { name: 'Анализ в очереди' })).toBeVisible();
    expect(api.starts()).toBe(2);
});

test('interrupted failure survives refresh and only an explicit action starts a new run', async ({ page }) => {
    const api = await backgroundAPI(page);
    await begin(page);
    api.fail();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Не удалось завершить разбор' })).toBeVisible();
    await expect(page.getByText('Обработка прервана. Можно запустить новый анализ.', { exact: true })).toBeVisible();
    expect(api.starts()).toBe(1);
    await page.getByRole('button', { name: 'Повторить анализ', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Анализ в очереди' })).toBeVisible();
    expect(api.starts()).toBe(2);
});

test('lost acceptance response recovers the accepted background job without reenqueuing', async ({ page }) => {
    const api = await backgroundAPI(page);
    api.loseAcceptance();
    await begin(page);
    api.finish();
    await expect(page.getByLabel('Что согласовано')).toHaveValue('Подготовить отчёт');
    expect(api.starts()).toBe(1);
});

test('a run replaced in another tab is followed rather than leaving polling stuck', async ({ page }) => {
    const api = await backgroundAPI(page);
    await begin(page);
    api.row().analysis_run_id = 'replacement-run'; api.row().version++;
    await expect.poll(api.polls).toBeGreaterThan(1);
    api.finish();
    await expect(page.getByLabel('Что согласовано')).toHaveValue('Подготовить отчёт');
    expect(api.starts()).toBe(1);
});

test('slow history never blocks accepted work, navigation or restored status', async ({ page }) => {
    const api = await backgroundAPI(page);
    let release;
    api.holdHistory(new Promise(resolve => { release = resolve; }));
    await begin(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Анализ в очереди' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Новый разбор', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.testApp.router.onBeforeNavigate('/backlog'))).toBe(true);
    expect(api.starts()).toBe(1);
    release();
});
