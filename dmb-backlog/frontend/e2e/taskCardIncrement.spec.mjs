import { expect, test } from '@playwright/test';

async function openTaskCard(page, hash = '#/tasks?task=42') {
  await page.goto(`/e2e/fixtures/taskCardIncrement.html${hash}`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.getByRole('tab', { name: /Ссылки и файлы · 2/ })).toBeVisible();
}

test('sys показывает число и список файлов, а загрузка работает с клавиатуры', async ({ page }) => {
  await openTaskCard(page);
  const filesTab = page.getByRole('tab', { name: /Ссылки и файлы · 2/ });
  await filesTab.click();

  await expect(filesTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Скачать ux-audit.pdf' })).toBeVisible();
  const dropZone = page.getByRole('button', { name: 'Добавить файлы к задаче' });
  await expect(dropZone).toHaveAttribute('tabindex', '0');
  await expect(dropZone).toHaveAttribute('aria-describedby', 'attachment-drop-hint');
  await expect(dropZone.locator('svg')).toHaveAttribute('aria-hidden', 'true');

  await page.locator('#attachment-file-input').evaluate(input => {
    input.click = () => { window.__fileDialogClicks += 1; };
  });
  await dropZone.press('Enter');
  await dropZone.press('Space');
  await expect.poll(() => page.evaluate(() => window.__fileDialogClicks)).toBe(2);
});

test('legacy hash tab=files открывает каноническую вкладку sys', async ({ page }) => {
  await openTaskCard(page, '#/tasks?task=42&tab=files');
  const filesTab = page.getByRole('tab', { name: /Ссылки и файлы · 2/ });
  await expect(filesTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Скачать ux-audit.pdf' })).toBeVisible();
  await expect(page.locator('#mbody')).toHaveAttribute('aria-labelledby', 'task-tab-sys');
});

test('deep-link открывает, подсвечивает и фокусирует указанный комментарий', async ({ page }) => {
  await openTaskCard(page, '#/backlog?task=42&tab=com&comment=21');

  await expect(page.locator('#task-tab-com')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#mbody')).toHaveAttribute('aria-labelledby', 'task-tab-com');
  const target = page.locator('#task-comment-21');
  await expect(target).toBeVisible();
  await expect(target).toHaveClass(/\bis-targeted\b/);
  await expect(target).toBeFocused();
});

test('неотправленный комментарий сохраняется при переключении com → main → com', async ({ page }) => {
  await openTaskCard(page);
  await page.locator('#task-tab-com').click();
  await expect(page.locator('#task-comment-21')).toBeVisible();

  const draftText = 'Черновик комментария без отправки';
  const textarea = page.getByRole('textbox', { name: 'Текст нового комментария' });
  await textarea.fill(draftText);
  try {
    await expect(textarea).toHaveValue(draftText);
    await expect(page.locator('#comment-submit-btn')).toBeEnabled();

    await page.locator('#task-tab-main').click();
    await expect(page.locator('#task-tab-main')).toHaveAttribute('aria-selected', 'true');
    await page.locator('#task-tab-com').click();
    await expect(page.locator('#task-comment-21')).toBeVisible();

    const restoredTextarea = page.getByRole('textbox', { name: 'Текст нового комментария' });
    await expect(restoredTextarea).toHaveValue(draftText);
    const commentPosts = await page.evaluate(() => window.__apiCalls.filter(([method, path]) => method === 'post' && path === '/tasks/42/comments'));
    expect(commentPosts).toHaveLength(0);
  } finally {
    const activeTextarea = page.getByRole('textbox', { name: 'Текст нового комментария' });
    if (await activeTextarea.count()) await activeTextarea.fill('');
  }
});

test('вкладки имеют ARIA-семантику и управляются стрелками, Home и End', async ({ page }) => {
  await openTaskCard(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAttribute('aria-labelledby', 'task-detail-title');
  await expect(page.getByRole('heading', { level: 1, name: 'Карточка для проверки' })).toHaveCount(1);

  const tabs = page.locator('#tabs [role="tab"]');
  await expect(tabs).toHaveCount(6);
  expect(await tabs.evaluateAll(items => items.map(item => item.id))).toEqual([
    'task-tab-main', 'task-tab-rep', 'task-tab-com', 'task-tab-sys', 'task-tab-log', 'task-tab-work',
  ]);
  const main = page.locator('#task-tab-main');
  await main.focus();
  await main.press('ArrowRight');
  await expect(main).toHaveAttribute('aria-selected', 'true');
  await page.locator('#task-tab-rep').press('Enter');
  await expect(page.locator('#task-tab-rep')).toBeFocused();
  await expect(page.locator('#task-tab-rep')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#mbody')).toHaveAttribute('aria-labelledby', 'task-tab-rep');

  await page.locator('#task-tab-rep').press('End');
  await page.locator('#task-tab-work').press('Enter');
  await expect(page.locator('#task-tab-work')).toBeFocused();
  await expect(page.locator('#task-tab-work')).toHaveAttribute('tabindex', '0');
  await expect(page.locator('#mbody')).toHaveAttribute('aria-labelledby', 'task-tab-work');

  await page.locator('#task-tab-work').press('Home');
  await page.locator('#task-tab-main').press('Enter');
  await expect(page.locator('#task-tab-main')).toBeFocused();
  await expect(page.locator('#task-tab-main')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tabs [role="tab"][tabindex="0"]')).toHaveCount(1);
  await main.press('ArrowLeft');
  await page.locator('#task-tab-work').press('Enter');
  await expect(page.locator('#task-tab-work')).toBeFocused();
  await expect(page.locator('#task-tab-work')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#task-tab-work').press('ArrowRight');
  await page.locator('#task-tab-main').press('Enter');
  await expect(main).toBeFocused();
  await expect(main).toHaveAttribute('aria-selected', 'true');
});

test('V30 показывает и редактирует четыре возвращённых атрибута', async ({ page }) => {
  await openTaskCard(page);
  await expect(page.locator('.task-comment')).toContainText('Только для рабочей группы');
  const assessment = page.locator('.cl-grid.assessment');
  await expect(assessment).toContainText('17 ч/д');
  await expect(assessment).toContainText('40%');
  await expect(assessment).toContainText('75%');

  await page.locator('[data-action="edit"]').click();
  await expect(page.locator('[data-k="comment"]')).toHaveValue('Только для рабочей группы');
  await expect(page.locator('[data-k="effortDays"]')).toHaveValue('17');
  await expect(page.locator('[data-k="effortDays"]')).toHaveAttribute('max', '10000');
  await expect(page.locator('[data-k="weightPercent"]')).toHaveValue('40');
  await expect(page.locator('[data-k="weightPercent"]')).toHaveAttribute('max', '100');
  await expect(page.locator('[data-k="forecastPercent"]')).toHaveValue('75');
  await expect(page.locator('[data-k="forecastPercent"]')).toHaveAttribute('max', '100');
});

test('read-only режим сохраняет просмотр, но убирает все изменяющие действия', async ({ page }) => {
  await openTaskCard(page, '?mode=readonly#/tasks?task=42');
  await expect(page.getByRole('button', { name: /Только просмотр/ })).toBeDisabled();
  await expect(page.locator('[data-action="edit"]')).toHaveCount(0);

  await page.locator('#task-tab-com').click();
  await expect(page.locator('#task-comment-21')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Текст нового комментария' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Ответить/ })).toHaveCount(0);

  await page.locator('#task-tab-sys').click();
  await expect(page.getByRole('button', { name: 'Скачать ux-audit.pdf' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить файлы к задаче' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Удалить/ })).toHaveCount(0);

  const writes = await page.evaluate(() => window.__apiCalls.filter(([method]) => ['post', 'patch', 'put', 'delete', 'upload'].includes(method)));
  expect(writes.filter(([, path]) => !path.endsWith('/viewers') && !path.endsWith('/lock'))).toHaveLength(0);
});
