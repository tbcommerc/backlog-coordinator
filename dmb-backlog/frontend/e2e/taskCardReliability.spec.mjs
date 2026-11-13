import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

test.use({ viewport: { width: 1440, height: 960 } });
const statesOutput = resolve('artifacts/task-card-states-2026-11-11');
async function captureState(page, name) {
  await mkdir(statesOutput, {recursive:true});
  await page.screenshot({path:resolve(statesOutput,name+'.png')});
}

async function open(page) {
  await page.goto('/e2e/fixtures/taskCardIncrement.html#/tasks?task=42');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.locator('#task-tab-sys')).toContainText('2');
  await page.evaluate(async () => {
    const { initModalAccessibility } = await import('/js/modalAccessibility.js');
    window.__disposeReliabilityDialogs = initModalAccessibility();
    window.__originalGet = window.app.api.get.bind(window.app.api);
  });
}

async function reopen(page) {
  await page.evaluate(async () => (await import('/js/components/modal.js?v=99')).closeModal());
  await expect(page.locator('#task-detail-overlay')).toHaveCount(0);
  await page.evaluate(async () => (await import('/js/components/modal.js?v=99')).openTaskModal(window.__taskCardFixture.task));
  await expect(page.locator('#task-tab-main')).toBeVisible();
}

const surfaces = [
  { tab: 'sys', suffix: 'attachments', subject: 'файлы', retained: 'ux-audit.pdf' },
  { tab: 'log', suffix: 'history', subject: 'историю изменений', retained: 'Анна Смирнова' },
  { tab: 'rep', suffix: 'reporting-statuses/context', subject: 'отчётные статусы', retained: 'Директорская оперативка' },
];

for (const surface of surfaces) {
  test(`${surface.tab}: первая ошибка и локальный повтор отличаются от пустоты`, async ({ page }) => {
    await open(page);
    await page.evaluate(({ suffix }) => {
      window.app.api.get = async (path, options) => {
        if (path === '/tasks/42/' + suffix && !window.__readRecovered) throw new Error('503 fixture');
        return window.__originalGet(path, options);
      };
    }, surface);
    await reopen(page);
    await page.locator('#task-tab-' + surface.tab).click();
    await expect(page.locator('#mbody')).toContainText('Не удалось загрузить ' + surface.subject);
    await expect(page.locator('#mbody')).not.toContainText(surface.retained);
    await captureState(page, surface.tab+'-initial-error');
    await page.evaluate(() => { window.__readRecovered = true; });
    await page.locator('#mbody').getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(page.locator('#mbody')).toContainText(surface.retained);
    await expect(page.locator('#mbody')).not.toContainText('Не удалось загрузить');
    await captureState(page, surface.tab+'-retry-success');
  });

  test(`${surface.tab}: данные и счётчик переживают ошибку обновления`, async ({ page }) => {
    await open(page);
    await page.locator('#task-tab-' + surface.tab).click();
    await expect(page.locator('#mbody')).toContainText(surface.retained);
    const tabText = await page.locator('#task-tab-' + surface.tab).textContent();
    await page.locator('#task-tab-main').click();
    await page.evaluate(({ suffix }) => {
      window.app.api.get = async (path, options) => {
        if (path === '/tasks/42/' + suffix && !window.__readRecovered) throw new Error('503 fixture');
        return window.__originalGet(path, options);
      };
    }, surface);
    await page.locator('#task-tab-' + surface.tab).click();
    await expect(page.locator('#mbody')).toContainText('Не удалось обновить ' + surface.subject);
    await expect(page.locator('#mbody')).toContainText(surface.retained);
    await expect(page.locator('#task-tab-' + surface.tab)).toHaveText(tabText);
    await captureState(page, surface.tab+'-stale-error');
    await page.evaluate(() => { window.__readRecovered = true; });
    await page.locator('#mbody').getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(page.locator('#mbody')).not.toContainText('Не удалось обновить');
  });
}

test('медленная история немедленно активирует вкладку; timeout сохраняет результат', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.app.api.get = (path, options) => path.endsWith('/history') ? new Promise(() => {}) : window.__originalGet(path, options);
  });
  await page.clock.install();
  await page.locator('#task-tab-log').click();
  await expect(page.locator('#task-tab-log')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#mbody')).toContainText('Загружаем историю изменений');
  await captureState(page, 'history-loading');
  await page.clock.fastForward(16000);
  await expect(page.locator('#mbody')).toContainText('Не удалось обновить историю изменений');
  await expect(page.locator('#mbody')).toContainText('Анна Смирнова');
});

test('priority/deadline требуют явного save; Escape не пишет', async ({ page }) => {
  await open(page);
  for (const field of ['priority', 'deadline']) {
    await page.locator(`[data-inline-edit="${field}"]`).click();
    await page.locator(`[data-k="${field}"]`).selectOption('');
    await page.waitForTimeout(400); // Больше прежнего скрытого автосохранения250ms.
    expect(await page.evaluate(() => window.__apiCalls.filter(([method]) => method === 'patch'))).toHaveLength(0);
    await page.locator(`[data-k="${field}"]`).press('Escape');
    await expect(page.locator('#confirm-modal-overlay')).toBeVisible();
    await captureState(page, field+'-exit-dirty');
    await page.locator('[data-edit-exit="discard"]').click();
    await expect(page.locator('#saveBtn')).toHaveCount(0);
  }
  expect(await page.evaluate(() => window.__apiCalls.filter(([method]) => method === 'patch'))).toHaveLength(0);
});

test('save busy блокирует повтор, ошибка сохраняет ввод, явный повтор успешен', async ({ page }) => {
  await open(page);
  await page.locator('[data-action="edit"]').click();
  await page.locator('[data-k="title"]').fill('Исправленная задача');
  await page.evaluate(() => { window.__holdTaskWrite = true; window.__failTaskWrite = true; });
  await page.locator('#saveBtn').click();
  await expect(page.locator('#saveBtn')).toBeDisabled();
  await captureState(page, 'save-busy');
  await page.keyboard.press('Control+Enter');
  expect(await page.evaluate(() => window.__apiCalls.filter(([method]) => method === 'patch'))).toHaveLength(1);
  await page.evaluate(() => window.__releaseTaskWrite());
  await expect(page.locator('#card-form-error-summary')).toBeVisible();
  await expect(page.locator('[data-k="title"]')).toHaveValue('Исправленная задача');
  await expect(page.locator('#saveBtn')).toBeEnabled();
  await captureState(page, 'save-error');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#saveBtn')).toHaveCount(0);
  expect(await page.evaluate(() => window.__taskCardFixture.task.title)).toBe('Исправленная задача');
});

test('явное сохранение priority/deadline пишет ровно выбранное поле', async ({ page }) => {
  await open(page);
  for (const field of ['priority', 'deadline']) {
    await page.locator(`[data-inline-edit="${field}"]`).click();
    await page.locator(`[data-k="${field}"]`).selectOption('');
    const before = await page.evaluate(() => window.__apiCalls.filter(([method]) => method === 'patch').length);
    await page.locator('#saveBtn').click();
    await expect(page.locator('#saveBtn')).toHaveCount(0);
    const writes = await page.evaluate(() => window.__apiCalls.filter(([method]) => method === 'patch'));
    expect(writes).toHaveLength(before + 1);
    expect(writes.at(-1)[2][field + '_id']).toBe(null);
    expect(Object.keys(writes.at(-1)[2]).sort()).toEqual(['client_request_id', field + '_id', 'version'].sort());
  }
});

test('конфликт версий сохраняет локальный черновик после отмены диалога', async ({ page }) => {
  await open(page);
  await page.locator('[data-action="edit"]').click();
  await page.locator('[data-k="title"]').fill('Мой черновик');
  await page.evaluate(() => {
    window.app.api.patch = async () => { throw Object.assign(new Error('Conflict'), { status: 409, data: { detail: {
      task: { ...window.__taskCardFixture.task, version: 5, title: 'Чужая редакция' }, current_version: 5, submitted_version: 4,
    } } }); };
  });
  await page.locator('#saveBtn').click();
  await expect(page.locator('#card-conflict-overlay')).toContainText('Мой черновик');
  const columnSizes=await page.locator('.ui-task-conflict-table th').evaluateAll(headers=>headers.slice(0,2).map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})));
  expect(columnSizes.every(size=>size.width>=90&&size.height<80)).toBe(true);
  await captureState(page, 'save-conflict');
  await page.locator('#cc-btn-cancel').click();
  await expect(page.locator('[data-k="title"]')).toHaveValue('Мой черновик');
  await expect(page.locator('#saveBtn')).toBeEnabled();
});

test('undo привязан к версии PATCH и не использует более новую версию reload', async ({ page }) => {
  await open(page);
  await page.locator('[data-action="edit"]').click();
  await page.locator('[data-k="title"]').fill('Моё сохранение');
  await page.evaluate(() => {
    const patch = window.app.api.patch.bind(window.app.api);
    window.app.api.patch = async (...args) => {
      const own = await patch(...args);
      Object.assign(window.__taskCardFixture.task, { version: own.version + 1, title: 'Чужая новая версия' });
      return own;
    };
  });
  await page.locator('#saveBtn').click();
  await expect(page.locator('#saveBtn')).toHaveCount(0);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  expect(await page.evaluate(() => window.__apiCalls.filter(([method]) => method === 'patch'))).toHaveLength(1);
  expect(await page.evaluate(() => window.__taskCardFixture.task.title)).toBe('Чужая новая версия');
  await expect(page.locator('#card-toast')).toContainText('Отмена этого сохранения недоступна');
  await captureState(page, 'undo-newer-version');
});

test('AI диалог: общий padding, Tab и Escape только верхнего слоя, фокус на инициаторе', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.evaluate(() => { window.__taskCardFixture.task.effort_days = null; });
  await reopen(page);
  const trigger = page.locator('[data-action="ps-calc"]');
  const section = trigger.locator('xpath=ancestor::details');
  if (await section.count() && await section.getAttribute('open') === null) await section.locator('summary').click();
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const overlay = page.locator('#prioritiser-requirements-overlay');
  await expect(overlay).toBeVisible();
  await captureState(page, 'ai-requirements');
  expect(await overlay.locator('.app-modal__header').evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThan(0);
  await overlay.getByRole('button', { name: 'Закрыть', exact: true }).last().focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.closest('[role="dialog"]')?.id === 'task-detail-modal')).toBe(false);
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(page.locator('#task-detail-overlay')).toBeVisible();
  await expect(trigger).toBeFocused();
  // Возвращённый фокус открывает tooltip инициатора. Проверяем Escape карточки
  // с вкладки, где нет промежуточной немодальной подсказки.
  await page.locator('#task-tab-main').focus();
  await page.mouse.move(0, 0);
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
  await expect(page.locator('#task-detail-overlay')).toHaveCount(0);
});

test('toggle тегов объявляет выбор и удерживает фокус по значению', async ({ page }) => {
  await open(page);
  await page.locator('[data-inline-edit="tags"]').click();
  const chip = page.locator('[data-toggle="tags"][data-val="Q4"]');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await chip.focus();
  await chip.press('Space');
  await expect(chip).toHaveAttribute('aria-pressed', 'false');
  await expect(chip).toBeFocused();
  await chip.press('Enter');
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(chip).toBeFocused();
});

test('успешный undo отправляет версию собственного сохранения и возвращает исходное название', async ({ page }) => {
  await open(page);
  const previousTitle = await page.evaluate(() => window.__taskCardFixture.task.title);
  await page.locator('[data-action="edit"]').click();
  await page.locator('[data-k="title"]').fill('Временно изменённое название');
  await page.locator('#saveBtn').click();
  await expect(page.locator('#saveBtn')).toHaveCount(0);
  const version = await page.evaluate(() => window.__taskCardFixture.task.version);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(page.locator('#card-toast')).toContainText('Последнее сохранение отменено');
  await captureState(page, 'undo-success');
  expect(await page.evaluate(() => window.__taskCardFixture.task.title)).toBe(previousTitle);
  expect(await page.evaluate(() => window.__apiCalls.filter(([method]) => method === 'patch').at(-1)[2].version)).toBe(version);
});

test('поздний ответ истории прежней карточки не заменяет новую карточку', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.app.api.get = (path, options) => path.endsWith('/history') && !window.__newRead
      ? new Promise(resolve => { window.__resolveOldHistory = resolve; })
      : window.__originalGet(path, options);
  });
  await page.locator('#task-tab-log').click();
  await expect(page.locator('#mbody')).toContainText('Загружаем историю изменений');
  await page.evaluate(() => { window.__newRead = true; });
  await reopen(page);
  await page.locator('#task-tab-log').click();
  await expect(page.locator('#mbody')).toContainText('Анна Смирнова');
  await page.evaluate(() => window.__resolveOldHistory([{ user_name: 'УСТАРЕВШИЙ ОТВЕТ', field_name: 'title', old_value: 'x', new_value: 'y' }]));
  await expect(page.locator('#mbody')).not.toContainText('УСТАРЕВШИЙ ОТВЕТ');
  await expect(page.locator('#mbody')).toContainText('Анна Смирнова');
});

test('ошибка обновления отчётных статусов и повтор сохраняют локальный текст', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { window.__taskCardFixture.reportingContext.items[0].can_edit = true; });
  await page.locator('#task-tab-rep').click();
  await page.locator('[data-action="edit-reporting-status"]').first().click();
  const field = page.locator('[data-reporting-text]').first();
  await field.fill('Несохранённый статус встречи');
  await page.evaluate(() => {
    window.app.api.get = async (path, options) => {
      if (path.endsWith('/reporting-statuses/context') && !window.__readRecovered) throw new Error('503 fixture');
      return window.__originalGet(path, options);
    };
    document.dispatchEvent(new CustomEvent('task-tab-change', { detail: { taskId: 42, tab: 'rep' } }));
  });
  await expect(page.locator('#mbody')).toContainText('Не удалось обновить отчётные статусы');
  await expect(field).toHaveValue('Несохранённый статус встречи');
  await captureState(page, 'reporting-stale-draft');
  await page.evaluate(() => { window.__readRecovered = true; });
  await page.locator('#mbody').getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('#mbody')).not.toContainText('Не удалось обновить');
  await expect(field).toHaveValue('Несохранённый статус встречи');
});

test('таблица трудозатрат различает ноль, неизвестное значение и отсутствие ставки', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    Object.assign(window.__taskCardFixture.task, {
      effort_designee: 0, actual_effort_designee: 0,
      effort_analytics: null, actual_effort_analytics: null,
    });
    window.__taskCardFixture.competencyCosts.splice(0);
  });
  await reopen(page);
  await expect(page.locator('#task-tab-sys')).toContainText('2');
  const measuredZero = page.locator('.tbl tbody tr').filter({ has: page.getByText('Designee', { exact: true }) });
  const unknown = page.locator('.tbl tbody tr').filter({ has: page.getByText('Аналитика', { exact: true }) });
  await expect(measuredZero.locator('td').nth(1)).toHaveText('—');
  await expect(measuredZero.locator('td').nth(2)).toHaveText('0');
  await expect(measuredZero.locator('td').nth(3)).toHaveText('0');
  await expect(measuredZero.locator('td').nth(4)).toHaveText('0 ₽');
  await expect(measuredZero.locator('td').nth(6)).toHaveText('0%');
  await expect(unknown.locator('td').nth(2)).toHaveText('—');
  await expect(unknown.locator('td').nth(4)).toHaveText('—');
  await measuredZero.scrollIntoViewIfNeeded();
  await captureState(page, 'effort-zero-null');
});
