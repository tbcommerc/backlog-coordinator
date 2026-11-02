import { test, expect } from '@playwright/test';

const aliases = ['badge badge-warning', 'ui-tag', 'notification-deadline-badge is-warning',
  'notification-topic', 'notification-priority', 'notification-new-label', 'notification-resolved-label',
  'pip-context-badge has-gaps', 'role-access-badge role-access-write', 'audit-action-badge',
  'audit-entity-badge', 'did-badge', 'directorate-meeting-badge', 'meeting-date-chip',
  'review-signal-chip has-value', 'task-detail-report-badge', 'task-detail-chip', 'task-detail-tag',
  'task-detail-badge', 'vchip', 'editbadge', 'pill', 'ttype', 'chip static', 'chat-session-state',
  'work-priority', 'work-list-status', 'ui-info-chip', 'work-queue-note', 'no-eff',
  'b-head-channel', 'b-delta', 'diff', 'directorate-type', 'quarterly-light',
  'team-weekly-signal', 'team-weekly-delta'];

for (const theme of ['light', 'dark']) for (const width of [1440, 320]) {
  test(`informational chip contract and single-line overflow ${theme}/${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/ui-catalog/index.html');
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.addStyleTag({ url: '/css/work-tasks.css' });
    await page.evaluate(async aliases => {
      const { badge } = await import('/js/ui/primitives.js');
      const { tag } = await import('/js/ui/dataDisplay.js');
      const panel = document.createElement('section');
      panel.id = 'chip-contract';
      panel.style.cssText = 'width:100%;max-width:280px;display:flex;flex-wrap:wrap;gap:8px';
      panel.innerHTML = aliases.map(className => `<span class="${className}"><strong>Метка</strong></span>`).join('')
        + '<span class="dirty" id="inactive-dirty">Не сохранено</span><span class="qe-unestimated-label" id="inactive-estimate">Без оценки</span>'
        + tag({ label: 'Платформа', color: '#6366f1' })
        + badge({ label: 'ОченьДлинноеНазваниеБезПробелов'.repeat(5), tone: 'warning', icon: 'calendar-clock', attrs: { id: 'long-chip' } })
        + badge({ label: 'Скрыт', attrs: { id: 'hidden-chip', hidden: true } });
      document.querySelector('main').prepend(panel);
      await document.fonts.ready;
    }, aliases);
    const geometry = await page.locator('#chip-contract > span:visible').evaluateAll(nodes => nodes.map(node => {
      const c = getComputedStyle(node);
      return { name: node.className, size: c.fontSize, line: c.lineHeight, weight: c.fontWeight,
        border: c.borderTopWidth, shadow: c.boxShadow, radius: c.borderRadius, padding: c.padding,
        family: c.fontFamily, height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width,
        nestedWeight: node.querySelector('strong') ? getComputedStyle(node.querySelector('strong')).fontWeight : '500' };
    }));
    for (const c of geometry) {
      expect(c, c.name).toMatchObject({ size: '12px', line: '18px', weight: '500', border: '0px',
        shadow: 'none', radius: '6px', padding: '3px 8px', nestedWeight: '500' });
      expect(c.family).toContain('Inter');
      expect(c.height).toBe(24);
      expect(c.width).toBeLessThanOrEqual(280);
    }
    await expect(page.locator('#hidden-chip')).toBeHidden();
    await expect(page.locator('#inactive-dirty')).toBeHidden();
    await expect(page.locator('#inactive-estimate')).toBeHidden();
    const overflow = await page.locator('#long-chip').evaluate(el => el.scrollWidth > el.clientWidth);
    expect(overflow).toBe(false);
    expect(await page.locator('.ui-tag[style]').first().evaluate(el => getComputedStyle(el, '::before').width)).toBe('6px');
    await expect(page.locator('#statuses .ui-filter-chip').first()).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#info-chips').screenshot({ path: `test-results/info-chips-${theme}-${width}.png` });
  });
}

for (const theme of ['light', 'dark']) {
  test(`real surfaces retain the shared chip geometry: ${theme}`, async ({ page }) => {
    test.setTimeout(90000);
    for (const fixture of ['uiKitRegistries.html?surface=notifications', 'uiKitRegistries.html?surface=audit',
      'uiKitConsistency.html?surface=workTasks', 'taskCardIncrement.html?surface=card',
      'uiKitAdminReports.html?surface=directorate']) {
      await page.goto(`/e2e/fixtures/${fixture}&theme=${theme}`);
      await page.waitForFunction(() => document.documentElement.dataset.fixtureReady === 'true'
        || document.documentElement.dataset.ready === 'true', null, { timeout: 15000 });
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const chips = page.locator(['.badge', ...aliases.map(classes => '.' + classes.split(' ').join('.'))].map(selector => selector + ':visible').join(','));
      expect(await chips.count(), fixture).toBeGreaterThan(0);
      for (const chip of await chips.all()) {
        await expect(chip, fixture).toHaveCSS('border-radius', '6px');
        await expect(chip, fixture).toHaveCSS('font-size', '12px');
        await expect(chip, fixture).toHaveCSS('font-weight', '500');
        await expect(chip, fixture).toHaveCSS('border-top-width', '0px');
      }
    }
  });
}

test('status chips never wrap in narrow table cells', async ({ page }) => {
  await page.goto('/ui-catalog/index.html');
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
  await page.evaluate(() => {
    const table = document.createElement('table');
    table.id = 'narrow-status';
    table.style.cssText = 'table-layout:fixed;width:104px';
    table.innerHTML = '<tbody><tr><td><span class="badge">НОВАЯ ЗАДАЧА</span></td></tr><tr><td><span class="badge"><span>Очень длинный статус задачи</span></span></td></tr></tbody>';
    document.querySelector('main').prepend(table);
  });
  for (const chip of await page.locator('#narrow-status .badge').all()) {
    await expect(chip).toHaveCSS('white-space', 'nowrap');
    expect(await chip.evaluate(el => el.getBoundingClientRect().height)).toBe(24);
  }
});
