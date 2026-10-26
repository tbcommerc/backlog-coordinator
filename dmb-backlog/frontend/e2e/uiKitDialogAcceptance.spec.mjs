import { test, expect } from '@playwright/test';

// Expose existing private openers in served test responses only. Production
// modules, markup and listeners are unchanged; every API remains in-memory.
const exportsByModule = {
  modal: ['showCreateDuplicateWarning', 'showConflictModal', 'showConfirmModal', 'showEditExitModal', 'showErrorModal', 'showBulkResultModal', 'showBulkOpsModal', 'showPrioritiserRequirementsModal'],
  expressEstimate: ['showImportModal', 'showConfirm', 'showIncompleteEstimateModal', 'showCompleteEstimateModal', 'showEstimateHandoffModal'],
  reports: ['showReportingMeetingForm', 'showMeetingDataDialog', 'showReportingMeetingPlanner', 'showReportingMeetingHistory', 'showReportingMeetingPreparation', 'showPipDecisionModal'],
  agentChat: ['showTeamSelectModal', 'showSectionEditModal'],
  customerReferences: ['openCustomerReferences'],
  admin: ['showConfirmModal'],
};
const cases = Object.entries(exportsByModule).flatMap(([module, names]) => names.map(name => [module, name]));
for (const [module, name] of cases) test(`real dialog: ${module}.${name}`, async ({ browser, browserName }, testInfo) => {
  test.setTimeout(120000);
  for (const [theme, compact, width, touch] of [['light', false, 1280, false], ['dark', true, 1280, false], ['light', true, 390, false], ['dark', false, 390, true], ['dark', false, 320, true]]) {
    const height = width === 320 ? 568 : 950;
    const context = await browser.newContext({ viewport: { width, height }, ...(browserName === 'firefox' ? {} : { hasTouch: touch }) });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`**/js/components/${module}.js*`, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: `${await response.text()}\nwindow.__dialogFns = {${exportsByModule[module].join(',')}};` });
    });
    const fixture = module === 'expressEstimate' ? 'uiKitExpress.html?' : 'uiKitAdminReports.html?surface=customer&';
    await page.goto(`/e2e/fixtures/${fixture}theme=${theme}&ready=${name === 'showCompleteEstimateModal'}`);
    await expect(page.locator('html')).toHaveAttribute('data-fixture-ready', 'true');
    await page.evaluate(async ({ module, compact }) => {
      document.documentElement.dataset.compact = String(compact);
      const { initModalAccessibility } = await import('/js/modalAccessibility.js');
      initModalAccessibility();
      if (!window.__dialogFns) await import(`/js/components/${module}.js`);
      const trigger = document.createElement('button'); trigger.id = 'dialog-origin'; trigger.textContent = 'Открыть'; document.body.prepend(trigger); trigger.focus();
    }, { module, compact });
    await page.evaluate(({ module, name }) => {
      const task = { id: 11, title: 'Длинное название задачи для проверки переноса текста и действий в диалоге', version: 1 };
      const meeting = { id: 1, kind: 'did', title: 'Отчётная встреча', state: 'planned', scheduled_date: '2026-10-12' };
      const app = window.app, trigger = document.getElementById('dialog-origin');
      const originalGet = app.api.get.bind(app.api);
      app.api.get = async path => {
        if (path === '/agent/teams') return [{ id: 1, name: 'Команда маршрутизации' }];
        if (path.startsWith('/admin/customer-references/')) return [{ id: 1, name: 'Клиент', code: 'CLIENT', is_active: true }];
        if (path.endsWith('/preparation')) return { items: [{ task_id: 11, public_id: 'TASK-11', title: task.title, filled: false, can_edit: true, text: '', version: 1 }] };
        if (path.endsWith('/history')) return { items: [] };
        return originalGet(path);
      };
      const args = {
        showCreateDuplicateWarning: [[task]], showConflictModal: [{ task, current_version: 2, submitted_version: 1 }, app],
        showConfirmModal: module === 'admin' ? ['Подтвердить действие?', () => {}] : ['Подтвердить действие?'],
        showEditExitModal: [], showErrorModal: [1, 1, [{ taskId: 11, httpStatus: 409, error: 'Версия изменена' }]],
        showBulkResultModal: [{ changed_task_ids: [11], error_task_ids: [12], errors: ['Не удалось сохранить'] }, [task]],
        showBulkOpsModal: [app, 'team', [task]], showPrioritiserRequirementsModal: ['value', [{ label: 'Описание', ok: false }]],
        showImportModal: [], showConfirm: [{ title: 'Подтверждение', message: 'Удалить оценку?', confirmLabel: 'Удалить', onConfirm: () => {} }],
        showIncompleteEstimateModal: [{ blocking_tasks: [{ task_id: 11, title: task.title, blockers: [{ message: 'Не заполнена оценка' }] }], total_blockers: 1 }],
        showCompleteEstimateModal: [], showEstimateHandoffModal: [2, 'Задачи переданы на принятие решения'],
        showReportingMeetingForm: [meeting, 'schedule'], showMeetingDataDialog: [{ title: 'Данные встречи', subtitle: meeting.title, body: '<p>Статусы задач</p>' }],
        showReportingMeetingPlanner: [meeting, app], showReportingMeetingHistory: [meeting, app], showReportingMeetingPreparation: [meeting, app], showPipDecisionModal: [task, app],
        showTeamSelectModal: ['fixture-session', { title: task.title, problem_statement: 'Проблема', target_process: 'Результат' }, trigger],
        showSectionEditModal: [{ problem_statement: 'Проблема' }, 'problem_statement'], openCustomerReferences: ['did-client-groups', app],
      };
      window.__openError = null;
      const result = window.__dialogFns[name](...args[name]);
      if (result?.catch) result.catch(error => { window.__openError = error.message; });
    }, { module, name });
    const dialog = page.locator('[role="dialog"], [role="alertdialog"], dialog[open]').last();
    await expect(dialog).toBeVisible();
    if (name === 'showCompleteEstimateModal') await expect(dialog.getByRole('heading', { name: 'Завершить экспресс-оценку?' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const typography = await dialog.evaluate(root => {
      const id=root.getAttribute('aria-labelledby')?.split(' ')[0];
      const heading=id ? document.getElementById(id) : root.querySelector('h1,h2,h3,.modal-title');
      const s=getComputedStyle(heading);return{id:heading.id,size:s.fontSize,weight:s.fontWeight,line:s.lineHeight};
    });
    const compactTitle=['feedback-confirm-title','confirm-modal-title','qe-confirm-title','admin-confirm-title','edit-exit-title','create-duplicate-title'].includes(typography.id);
    const workspace=['task-detail-title','create-task-title','chat-edit-title'].includes(typography.id);
    expect(typography.size).toBe(workspace?'20px':compactTitle?'16px':'18px');
    expect(typography.weight).toBe('600');expect(typography.line).toBe(workspace?'26px':compactTitle?'22px':'24px');
    if(name==='showBulkOpsModal' && width<=390){
      const title=dialog.locator('.bc-task-title').first();await expect(title).toBeVisible();
      expect((await title.boundingBox()).width).toBeGreaterThan(120);
      expect(await title.evaluate(e=>e.scrollWidth-e.clientWidth)).toBeLessThanOrEqual(1);
      await title.scrollIntoViewIfNeeded();await expect(title).toBeInViewport({ratio:.99});
      // Ignore a subpixel border intersection; require the actual glyphs in full.
      expect(await title.evaluate(e=>{const range=document.createRange();range.selectNodeContents(e);const r=range.getBoundingClientRect(),c=e.closest('.bc-rows-container').getBoundingClientRect();return r.top>=c.top-1&&r.bottom<=c.bottom+1&&r.left>=c.left-1&&r.right<=c.right+1;})).toBe(true);
    }
    const geometry = await dialog.evaluate(root => ({
      overflow: root.scrollWidth - root.clientWidth,
      box: { left: root.getBoundingClientRect().left, right: root.getBoundingClientRect().right, top: root.getBoundingClientRect().top, bottom: root.getBoundingClientRect().bottom },
      controls: [...root.querySelectorAll('.btn,.iconbtn,input.input:not([type="checkbox"]):not([type="radio"]),select.input')].filter(e => e.getClientRects().length).map(e => {
        const s = getComputedStyle(e), b = e.getBoundingClientRect();
        return { name: e.textContent.trim() || e.id, w: b.width, h: b.height, size: Math.max(parseFloat(s.getPropertyValue('--ui-size')) || 28, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--control-target-min')) || 0), square: e.matches('.square-icon,.btn-icon,.iconbtn') };
      }),
    }));
    expect(geometry.overflow, `${name}: dialog overflow`).toBeLessThanOrEqual(1);
    expect(geometry.box.left).toBeGreaterThanOrEqual(-1); expect(geometry.box.right).toBeLessThanOrEqual(width + 1);
    expect(geometry.box.top).toBeGreaterThanOrEqual(-1); expect(geometry.box.bottom).toBeLessThanOrEqual(height + 1);
    if (width === 320) await page.screenshot({ path: testInfo.outputPath('dialog-320-dark.png') });
    for (const c of geometry.controls) {
      expect(c.h, `${name}: ${c.name}`).toBeGreaterThanOrEqual(c.size - 0.1);
      if (c.square) expect(c.w, c.name).toBeCloseTo(c.h, 0);
    }
    const lastControl = await dialog.evaluate(root => {
      const controls = [...root.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')].filter(e => e.getClientRects().length && !e.closest('[hidden],[inert]'));
      controls.at(-1)?.focus(); return controls.length;
    });
    if (lastControl) { await page.keyboard.press('Tab'); expect(await dialog.evaluate(root => root.contains(document.activeElement))).toBe(true); }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#dialog-origin')).toBeFocused();
    expect(await page.evaluate(() => window.__openError)).toBeNull();
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.__writes || window.__blockedWrites)).toEqual([]);
    await context.close();
  }
});
