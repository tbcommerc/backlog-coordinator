import { expect, test } from '@playwright/test';

const TAB_IDS = ['main', 'rep', 'com', 'sys', 'log', 'work'];

async function openTaskCard(page, { tab = 'main', theme = 'light' } = {}) {
  await page.goto(`/e2e/fixtures/taskCardIncrement.html?theme=${theme}#/tasks?task=42&tab=${tab}`);
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
  await expect(page.getByRole('tab')).toHaveCount(6);
  await expect(page.getByRole('tab', { name: /Комментарии · 3/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Ссылки и файлы · 2/ })).toBeVisible();
}

async function activateTab(page, tab) {
  const control = page.locator(`#task-tab-${tab}`);
  await control.click();
  await expect(control).toHaveAttribute('aria-selected', 'true');
  await expect(control).toHaveAttribute('tabindex', '0');
  await expect(page.locator('#mbody')).toHaveAttribute('aria-labelledby', `task-tab-${tab}`);
  return page.locator('#mbody');
}

test('полная API fixture проходит через все шесть вкладок реального modal.js', async ({ page }) => {
  await openTaskCard(page);

  const tabNames = await page.getByRole('tab').evaluateAll(tabs => tabs.map(tab => tab.textContent.replace(/\s+/g, ' ').trim()));
  expect(tabNames).toEqual([
    'Основное',
    'Отчётные статусы',
    'Комментарии · 3',
    'Ссылки и файлы · 2',
    'Лог изменений · 2',
    'Рабочие задачи',
  ]);

  const main = page.locator('#mbody');
  await expect(page.getByRole('heading', { level: 1, name: 'Карточка для проверки' })).toBeVisible();
  await expect(main).not.toContainText('Карточка для проверки');
  await expect(main).toContainText('Только для рабочей группы');
  await expect(main).toContainText('Data Platform');
  await expect(main).toContainText('Mobile Experience');
  await expect(main).toContainText('Клиентский путь');
  await expect(main).toContainText('Q4');
  await page.locator('[data-action="toggle-card-attributes"]').click();
  await expect(page.locator('#task-extra-attributes')).toBeVisible();
  await expect(main).toContainText('План: 100 %');
  await expect(main).toContainText('Факт: 63 %');
  await expect(main).toContainText('Priority Score');
  await expect(main).toContainText('82 / 100');
  await expect(main).toContainText('125,5 млн ₽');
  await page.locator('.effort-disclosure > summary').click();
  await expect(main.locator('.ui-task-detail-grid.assessment')).toBeVisible();
  await expect(main).toContainText('Экономия за счёт автоматизации клиентского пути');
  await expect(main).toContainText('Высокий клиентский эффект и достижимый срок');
  await expect(main.locator('.ui-readonly-field').filter({ hasText: 'Оценка завершённости (Hard)' })).toContainText('B');
  await expect(main.locator('.ui-readonly-field').filter({ hasText: 'Оценка взаимодействия (Soft)' })).toContainText('A');
  const effortTotals = main.locator('.effort-disclosure tfoot td');
  await expect(effortTotals.nth(2)).toHaveText('36');
  await expect(effortTotals.nth(3)).toHaveText('40');

  const reporting = await activateTab(page, 'rep');
  await expect(reporting.locator('.ui-task-report')).toHaveCount(3);
  await expect(reporting).toContainText('Директорская оперативка');
  await expect(reporting).toContainText('Идём по плану для директората');
  await expect(reporting).toContainText('Готовим демонстрацию ДИД');
  await expect(reporting).toContainText('Ключевой релиз в графике');
  await expect(reporting.locator('[data-reporting-kind="did"]')).toContainText('Демо для ДИД: да');
  await expect(reporting.locator('[data-reporting-demo="did"]')).toHaveCount(0);
  await expect(reporting.locator('[data-action="save-reporting-status"]')).toHaveCount(0);

  const comments = await activateTab(page, 'com');
  await expect(comments.getByRole('feed', { name: 'Комментарии задачи' })).toBeVisible();
  await expect(comments.locator('article.comment-item')).toHaveCount(3);
  await expect(comments).toContainText('Проверила клиентский сценарий с @Павел Орлов');
  await expect(comments).toContainText('Подтверждаю готовность аналитики');
  await expect(comments).toContainText('Материалы для демонстрации приложены');

  const files = await activateTab(page, 'sys');
  await expect(files.getByRole('list', { name: 'Вложения задачи' })).toBeVisible();
  await expect(files.getByRole('listitem')).toHaveCount(2);
  for (const filename of ['ux-audit.pdf', 'customer-flow.png']) {
    const controls = files.getByRole('button', { name: `Скачать ${filename}`, exact: true });
    await expect(controls).toHaveCount(2);
    await expect(controls.filter({hasText:filename})).toBeVisible();
    await expect(controls.filter({has:page.locator('svg')})).toBeVisible();
  }
  await expect(files.getByRole('link', { name: 'https://design.example.test/tasks/42' })).toBeVisible();
  await expect(files.getByRole('link', { name: 'https://jira.example.test/browse/DMB-42' })).toBeVisible();
  await expect(files.getByRole('link', { name: 'https://jira.example.test/browse/DMB-43' })).toBeVisible();
  await expect(files.getByRole('link', { name: 'https://docs.example.test/requirements/task-42' })).toBeVisible();

  const log = await activateTab(page, 'log');
  await expect(log.getByRole('heading', {name:'История изменений'})).toBeVisible();
  await expect(log).toContainText('2 записи');
  await expect(log).toContainText('Прогресс');
  await expect(log).toContainText('25');
  await expect(log).toContainText('35');
  await expect(log).toContainText('Высокий');

  await activateTab(page, 'work');

  const calls = await page.evaluate(() => window.__apiCalls.map(([, path]) => path));
  expect(calls).toEqual(expect.arrayContaining([
    '/admin/competency-costs',
    '/tasks/reference',
    '/tasks/42/history',
    '/tasks/42/comments',
    '/tasks/42/attachments',
    '/tasks/42/reporting-statuses/context',
  ]));
});

test('Markdown-описание безопасно форматируется и раскрывается без смены режима', async ({ page }) => {
  await openTaskCard(page);

  const description = page.locator('.task-description-content');
  await expect(description.locator('h5')).toHaveText('Контекст');
  await expect(description.locator('strong')).toHaveText('Проблема:');
  await expect(description.locator('li')).toHaveCount(10);
  await expect(description.getByRole('link', { name: 'документации' })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(description).not.toContainText('**Проблема:**');

  const shell = page.locator('.task-description-shell');
  const toggle = page.locator('.task-description-toggle');
  await expect(shell).toHaveClass(/\bis-collapsible\b/);
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText('Показать полностью');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveText('Свернуть');
  await expect(shell).toHaveClass(/\bis-expanded\b/);
});

test('на ширине 390px все вкладки остаются внутри viewport в dark theme', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTaskCard(page, { theme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const rightArrow = page.getByRole('button', { name: 'Прокрутить вкладки вправо' });
  await expect(rightArrow).toBeVisible();
  await expect(rightArrow).toBeEnabled();
  await rightArrow.click();
  await expect.poll(() => page.locator('#tabs').evaluate(tabs => tabs.scrollLeft)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Прокрутить вкладки влево' })).toBeVisible();

  const colors = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;background:var(--bg-secondary);color:var(--text-primary)';
    document.body.appendChild(probe);
    const result = {
      modal: getComputedStyle(document.getElementById('task-detail-modal')).backgroundColor,
      title: getComputedStyle(document.getElementById('task-detail-title')).color,
      expectedModal: getComputedStyle(probe).backgroundColor,
      expectedTitle: getComputedStyle(probe).color,
    };
    probe.remove();
    return result;
  });
  expect(colors.modal).toBe(colors.expectedModal);
  expect(colors.title).toBe(colors.expectedTitle);
  expect(colors.modal).not.toBe('rgb(255, 255, 255)');

  for (const tab of TAB_IDS) {
    await activateTab(page, tab);
    if (tab === 'rep') await expect(page.locator('.ui-task-report')).toHaveCount(3);
    if (tab === 'com') await expect(page.getByRole('feed', { name: 'Комментарии задачи' })).toBeVisible();
    if (tab === 'sys') await expect(page.getByRole('list', { name: 'Вложения задачи' })).toBeVisible();

    const geometry = await page.evaluate(() => {
      const modal = document.getElementById('task-detail-modal').getBoundingClientRect();
      const overlay = document.getElementById('task-detail-overlay').getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        modalLeft: modal.left,
        modalRight: modal.right,
        overlayLeft: overlay.left,
        overlayRight: overlay.right,
      };
    });

    expect(geometry.documentOverflow, `${tab}: document не должен иметь горизонтальный overflow`).toBeLessThanOrEqual(1);
    expect(geometry.bodyOverflow, `${tab}: body не должен иметь горизонтальный overflow`).toBeLessThanOrEqual(1);
    expect(geometry.modalLeft, `${tab}: modal не должен выходить влево`).toBeGreaterThanOrEqual(0);
    expect(geometry.modalRight, `${tab}: modal не должен выходить вправо`).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.overlayLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.overlayRight).toBeLessThanOrEqual(geometry.viewportWidth);
  }
});
