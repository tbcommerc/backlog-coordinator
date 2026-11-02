import { expect, test } from '@playwright/test';

for(const theme of ['light','dark'])test(`comment mentions share popover without closing task ${theme}`,async({page})=>{
 await page.setViewportSize({width:390,height:900});await open(page,'card',theme);
 await page.locator('#task-tab-com').click();const input=page.locator('#comment-textarea');
 await input.fill('@');const panel=page.getByRole('listbox',{name:'Пользователи для упоминания'});
 await expect(panel).toBeVisible();await expect(input).toBeFocused();
 for(const option of await panel.getByRole('option').all())expect((await option.boundingBox()).height).toBeGreaterThanOrEqual(44);
 const box=await panel.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
 await input.press('ArrowDown');await expect(input).toHaveAttribute('aria-activedescendant',/mention-option-/);
 await input.press('Escape');await expect(panel).toBeHidden();await expect(page.locator('#task-detail-overlay')).toBeVisible();await expect(input).toBeFocused();
 await input.fill('@');await expect(panel).toBeVisible();await input.press('Enter');await expect(panel).toBeHidden();
 await expect(input).toHaveValue(/@.+ /);
});

async function open(page, surface = 'card', theme = 'light') {
  await page.goto(`/e2e/fixtures/taskCardIncrement.html?surface=${surface}&theme=${theme}#/tasks?task=42`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.getByRole('dialog')).toBeVisible();
  if (surface === 'card') await expect(page.getByRole('tab', { name: /Ссылки и файлы · 2/ })).toBeVisible();
}

async function fillCreate(page) {
  await expect(page.locator('#create-team')).toHaveValue('1');
  await page.getByLabel('Название', { exact: false }).fill('Новая задача из общей формы');
  await page.locator('#create-task-type').selectOption('6');
  await page.locator('#create-channel').selectOption('2');
}

async function holdFailure(page) {
  await page.evaluate(() => { window.__holdTaskWrite = true; window.__failTaskWrite = true; });
}

test('создание связывает ошибки с полями и не отправляет незаполненную форму', async ({ page }) => {
  await open(page, 'create');
  await expect(page.locator('#create-save-btn')).toBeDisabled();
  await page.keyboard.press('Control+s');
  const title = page.locator('#create-title');
  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toHaveAttribute('aria-describedby', 'create-title-error');
  await expect(page.locator('#create-title-error')).toBeVisible();
  await fillCreate(page);
  await expect(page.locator('#create-title-error')).toBeHidden();
  await expect(page.locator('#create-save-btn')).toBeEnabled();
  expect(await page.evaluate(() => window.__apiCalls.filter(([method, path]) => method === 'post' && path === '/tasks/'))).toHaveLength(0);
});

test('создание сохраняет ввод после ошибки, исключает двойной запрос и позволяет повторить', async ({ page }) => {
  await open(page, 'create');
  await fillCreate(page);
  const description = page.locator('#create-description');
  await description.fill('Сохранённый черновик описания');
  await holdFailure(page);
  const save = page.locator('#create-save-btn');
  await save.click();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await expect(save).toBeDisabled();
  await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => window.__apiCalls.filter(([method, path]) => method === 'post' && path === '/tasks/').length)).toBe(1);
  await page.evaluate(() => window.__releaseTaskWrite());
  await expect(page.locator('#create-title-error')).toHaveText('Уточните название задачи');
  await expect(page.locator('#create-title')).toBeFocused();
  await expect(description).toHaveValue('Сохранённый черновик описания');
  await expect(save).not.toHaveAttribute('aria-busy');
  await expect(save).toHaveText('Создать задачу');
  await expect(save).toBeEnabled();
  await page.locator('#create-title').fill('Уточнённое название задачи');
  await save.click();
  await expect(page.locator('#create-task-overlay')).toHaveCount(0);
  await expect(page.locator('#task-detail-title')).toHaveText('Уточнённое название задачи');
});

test('редактирование восстанавливает кнопку и черновик после ошибки API', async ({ page }) => {
  await open(page);
  await page.locator('[data-action="edit"]').click();
  const title = page.locator('[data-k="title"]');
  await title.fill('Исправленная задача');
  await holdFailure(page);
  const save = page.locator('#saveBtn');
  const idleHeight = await save.evaluate(button => button.getBoundingClientRect().height);
  await save.click();
  await expect(save).toHaveAttribute('aria-busy', 'true');
  await expect(save).toBeDisabled();
  expect(await save.evaluate(button => button.getBoundingClientRect().height)).toBe(idleHeight);
  await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => window.__apiCalls.filter(([method]) => method === 'patch').length)).toBe(1);
  await page.evaluate(() => window.__releaseTaskWrite());
  await expect(title).toHaveValue('Исправленная задача');
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toBeFocused();
  await expect(save).not.toHaveAttribute('aria-busy');
  await expect(save).toHaveText('Сохранить · 1');
  await expect(save).toBeEnabled();
  await title.fill('Уточнённая задача');
  await save.click();
  await expect(page.locator('#task-detail-title')).toHaveText('Уточнённая задача');
  await expect(page.locator('[data-action="edit"]')).toBeEnabled();
});

test('мобильное редактирование не обрезает действия и защищает черновик при отмене', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'card', 'dark');
  await page.locator('[data-action="edit"]').click();
  await page.locator('[data-k="title"]').fill('Незавершённое редактирование');
  const modifiedColor = await page.locator('.task-title-row.field-modified').evaluate(field => {
    const probe = document.createElement('span');
    probe.style.background = 'var(--warning-light)';
    field.appendChild(probe);
    const result = { actual: getComputedStyle(field).backgroundColor, expected: getComputedStyle(probe).backgroundColor };
    probe.remove();
    return result;
  });
  expect(modifiedColor.actual).toBe(modifiedColor.expected);
  const actions = await page.locator('#mfoot .ui-btn').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    return { left: rect.left, right: rect.right, height: rect.height };
  }));
  for (const rect of actions) {
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(390);
    expect(rect.height).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: testInfo.outputPath('task-edit-dark.png') });
  await page.locator('#cardCancelBtn').click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await expect(page.locator('[data-k="title"]')).toHaveValue('Незавершённое редактирование');
  expect(await page.evaluate(() => window.__apiCalls.filter(([method]) => method === 'patch'))).toHaveLength(0);
});

for (const theme of ['light', 'dark']) {
  test(`мобильная форма: общие контролы и действия доступны в ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, 'create', theme);
    await fillCreate(page);
    const geometry = await page.locator('#create-task-modal').evaluate(modal => ({
      left: modal.getBoundingClientRect().left,
      right: modal.getBoundingClientRect().right,
      overflow: modal.scrollWidth - modal.clientWidth,
      controls: [...modal.querySelectorAll('.ui-btn, input.ui-control, select.ui-control, .dict-combobox-trigger')]
        .filter(el => el.getClientRects().length)
        .map(el => { const rect = el.getBoundingClientRect(); return { id: el.id, height: rect.height, left: rect.left, right: rect.right }; }),
    }));
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(390);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    for (const control of geometry.controls) {
      expect(control.height, control.id).toBeGreaterThanOrEqual(44);
      expect(control.left, control.id).toBeGreaterThanOrEqual(geometry.left);
      expect(control.right, control.id).toBeLessThanOrEqual(geometry.right);
    }
    await page.screenshot({ path: testInfo.outputPath(`create-task-${theme}.png`) });
  });
}

for (const width of [320, 390, 1280]) for (const theme of ['light', 'dark']) test(`подсказка расчёта: отступы и границы ${width} ${theme}`,async({page}, testInfo)=>{
  await page.setViewportSize({ width, height: 900 });
  await open(page, 'card', theme);
  const trigger=page.locator('.agent-check-wrap button').first();await expect(trigger).toBeEnabled();await trigger.focus();
  const tooltip=page.getByRole('tooltip');await expect(tooltip).toBeVisible();await expect(tooltip).toContainText('Для расчёта нужны поля');
  const geometry = await tooltip.evaluate(panel => {
    const box = panel.getBoundingClientRect();
    return {
      left: box.left, right: box.right, overflow: panel.scrollWidth - panel.clientWidth,
      padding: parseFloat(getComputedStyle(panel).paddingLeft),
      rows: [...panel.querySelectorAll('.agent-check-item')].map(row => {
        const [mark, label, state] = [...row.children].map(el => el.getBoundingClientRect());
        return { left: mark.left - box.left, gap: state.left - label.right, right: box.right - state.right };
      }),
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(8);
  expect(geometry.right).toBeLessThanOrEqual(width - 8);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  expect(geometry.padding).toBeGreaterThanOrEqual(16);
  for (const row of geometry.rows) {
    expect(row.left).toBeGreaterThanOrEqual(16);
    expect(row.gap).toBeGreaterThanOrEqual(9);
    expect(row.right).toBeGreaterThanOrEqual(16);
  }
  await page.screenshot({ path: testInfo.outputPath('ai-check-tooltip.png') });
  await page.keyboard.press('Escape');await expect(tooltip).toBeHidden();await expect(page.locator('#task-detail-overlay')).toBeVisible();await expect(trigger).toBeFocused();
});
