import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const inputDir = path.resolve('../docs/dev-testing/evidence/import-testing-2026-09-20/inputs');

async function mockApplication(page) {
  let importResponse = { total: 1, created: 1, skipped: 0, errors: [], task_ids: [900001] };
  const requests = [];
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const apiPath = url.pathname.replace('/api/v1', '');
    if (apiPath === '/events/stream') return route.abort();
    if (apiPath === '/auth/refresh') return json(route, { access_token: 'e2e-token', user: { id: 101, name: 'QA' } });
    if (apiPath === '/auth/me') return json(route, {
      id: 101,
      name: 'QA Import',
      email: 'qa-import@example.test',
      team_id: 1,
      team_name: 'Проектный офис',
      role_name: 'Администратор',
      permissions: {customer_portal_mode:'all',backlog_dmb:'read_write',backlog_team:'write_all',task_edit:'all'},
    });
    if (apiPath === '/admin/field-labels') return json(route, {});
    if (apiPath === '/admin/display-settings/shared') return json(route, { settings: {} });
    if (apiPath === '/tasks/reference') return json(route, {
      statuses: [], priorities: [], deadlines: [], teams: [{ id: 1, name: 'Проектный офис' }],
      projects: [], task_types: [], channels: [], departments: [], business_customers: [],
      did_client_groups: [], tags: [], users: [],
    });
    if (apiPath === '/tasks/' && request.method() === 'GET') return json(route, { items: [], total: 0, page: 1, per_page: 1000, pages: 1 });
    if (apiPath === '/tasks/import' && request.method() === 'POST') {
      requests.push({ contentType: request.headers()['content-type'] || '', bodyLength: (await request.postDataBuffer())?.length || 0 });
      return json(route, importResponse);
    }
    if (apiPath === '/notifications/snapshot') return json(route, { revision: 1, summary: { unread: 0, requires_action: 0, today: 0, by_category: {} }, recent_items: [], recent_total: 0, action_items: [], action_total: 0 });
    if (apiPath === '/reporting-meetings') return json(route, { items: [] });
    if (apiPath === '/timeline') return json(route, { items: [] });
    return json(route, {});
  });

  return {
    setImportResponse(value) { importResponse = value; },
    requests,
  };
}

async function openImport(page) {
  await page.getByRole('button', { name: 'Импорт из Excel' }).click({ timeout: 5_000 });
  await page.locator('#import-tasks-overlay').waitFor({ state: 'visible' });
}

async function closeImport(page) {
  const overlay=page.locator('#import-tasks-overlay');
  if(await overlay.count() && !(await page.locator('#import-tasks-overlay.modal-closing').count())) {
    try {await overlay.locator('#import-close-btn').click({timeout:5000});}
    catch(error) {if(await overlay.count())throw error;}
  }
  await overlay.waitFor({state:'detached',timeout:5000});
}

async function uploadAndSnapshot(page, file) {
  await openImport(page);
  const overlay = page.locator('#import-tasks-overlay');
  await overlay.locator('#import-file-input').setInputFiles(path.join(inputDir, file));
  await page.waitForTimeout(250);
  const snapshot = await overlay.evaluate(node => {
    const preview = node.querySelector('#import-preview-section');
    const headerErrors = node.querySelector('#import-error-summary');
    const rowErrors = node.querySelector('#import-row-errors');
    const submit = node.querySelector('#import-submit-btn');
    return {
      submitEnabled: !submit.disabled,
      previewVisible: getComputedStyle(preview).display !== 'none',
      previewHeaders: [...node.querySelectorAll('#import-preview-thead th')].map(el => el.textContent.trim()),
      previewRows: node.querySelectorAll('#import-preview-tbody tr').length,
      previewText: node.querySelector('#import-preview-section')?.innerText?.slice(0, 500) || '',
      headerErrorsVisible: getComputedStyle(headerErrors).display !== 'none',
      headerErrorsText: node.querySelector('#import-error-list')?.innerText || '',
      rowErrorsVisible: getComputedStyle(rowErrors).display !== 'none',
      rowErrorsCount: Number(node.querySelector('#import-row-errors-count')?.textContent || 0),
      rowErrorsText: node.querySelector('#import-row-errors-list')?.innerText?.slice(0, 1000) || '',
    };
  });
  await closeImport(page);
  return snapshot;
}

const smallFixtures = [
    '01_valid_utf8_bom_semicolon.csv',
    '03_valid_cp1251_semicolon.csv',
    '09_empty_zero_bytes.csv',
    '10_missing_title_header.csv',
    '23_blank_first_line_semicolon.csv',
    '26_quoted_multiline.csv',
    '28_utf16le_bom.csv',
    '29_undecodable_byte_98.csv',
    '33_numeric_formats.csv',
    '35_reference_not_found.csv',
    '37_length_and_injection.csv',
    '40_valid_minimal.xlsx',
    '42_multisheet_instructions_first.xlsx',
    '44_valid_spreadsheetml_2003.xls',
    '45_corrupt_excel.xlsx',
    '55_many_preview_errors.csv',
  ];


for(const file of smallFixtures)test('import preflight '+file,async({page},testInfo)=>{
 await mockApplication(page);await page.goto('/#/team-backlog');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');await expect(page.getByRole('heading',{name:/^Бэклог$/})).toBeVisible();
 const snapshot=await uploadAndSnapshot(page,file);await fs.mkdir(testInfo.outputPath('evidence'),{recursive:true});await fs.writeFile(testInfo.outputPath('evidence/preflight.json'),JSON.stringify({file,snapshot},null,2));
});

test('evidence-based import UX/UI audit', async ({ page }, testInfo) => {
  const evidenceDir = testInfo.outputPath('evidence');
  const screenshotDir = path.join(evidenceDir, 'ui-screenshots');
  test.setTimeout(300_000);
  await fs.mkdir(screenshotDir, { recursive: true });
  const mock = await mockApplication(page);
  const results = { generatedAt: new Date().toISOString(), preflight: {}, layout: {}, accessibility: {}, resultStates: {}, consoleErrors: [] };
  page.on('console', msg => { if (msg.type() === 'error') results.consoleErrors.push(msg.text()); });
  page.on('pageerror', error => results.consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto('/#/team-backlog');await expect(page.locator('#tasks-content')).toHaveAttribute('data-ready','true');
  await page.getByRole('heading', { name: /^Бэклог$/ }).waitFor({ state: 'visible' });

  for (const viewport of [
    { name: 'desktop-1440x900', width: 1440, height: 900 },
    { name: 'desktop-1280x720', width: 1280, height: 720 },
    { name: 'tablet-768x800', width: 768, height: 800 },
    { name: 'mobile-390x844', width: 390, height: 844 },
    { name: 'mobile-360x640', width: 360, height: 640 },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openImport(page);
    const overlay = page.locator('#import-tasks-overlay');
    results.layout[viewport.name] = await overlay.evaluate((node, vp) => {
      const dialog = node.querySelector('[role="dialog"]');
      const body = node.querySelector('.app-modal__body');
      const footer = node.querySelector('.app-modal__footer');
      const rect = el => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const dr = rect(dialog);
      const fr = rect(footer);
      return {
        viewport: vp,
        dialog: dr,
        body: rect(body),
        footer: fr,
        dialogInsideViewport: dr.left >= -1 && dr.top >= -1 && dr.right <= vp.width + 1 && dr.bottom <= vp.height + 1,
        footerInsideDialog: fr.left >= dr.left - 1 && fr.right <= dr.right + 1 && fr.bottom <= dr.bottom + 1,
        documentHorizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyScrollable: body.scrollHeight > body.clientHeight,
        dialogOverflowY: getComputedStyle(dialog).overflowY,
        bodyOverflowY: getComputedStyle(body).overflowY,
      };
    }, { width: viewport.width, height: viewport.height });
    await page.screenshot({ path: path.join(screenshotDir, `${viewport.name}-initial.png`), fullPage: true });
    await closeImport(page);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await openImport(page);
  const overlay = page.locator('#import-tasks-overlay');
  results.accessibility.initialActive = await page.evaluate(() => ({ id: document.activeElement?.id || '', insideDialog: Boolean(document.activeElement?.closest?.('#import-tasks-overlay')) }));
  results.accessibility.dropZone = await overlay.locator('#import-drop-zone').evaluate(el => ({ tabIndex: el.tabIndex, role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label') }));
  const tabSequence = [];
  for (let i = 0; i < 10; i += 1) {
    await page.keyboard.press('Tab');
    tabSequence.push(await page.evaluate(() => ({ id: document.activeElement?.id || '', tag: document.activeElement?.tagName || '', insideDialog: Boolean(document.activeElement?.closest?.('#import-tasks-overlay')) })));
  }
  results.accessibility.tabSequence = tabSequence;
  await page.keyboard.press('Escape');
  await expect(page.locator('#import-tasks-overlay')).toHaveCount(0);
  results.accessibility.escapeCloses = true;
  await closeImport(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await openImport(page);
  await page.locator('#import-file-input').setInputFiles(path.join(inputDir, '55_many_preview_errors.csv'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-390x844-many-errors.png'), fullPage: true });
  results.layout['mobile-many-errors'] = await page.locator('#import-tasks-overlay').evaluate(node => {
    const dialog = node.querySelector('[role="dialog"]');
    const footer = node.querySelector('.app-modal__footer');
    const d = dialog.getBoundingClientRect();
    const f = footer.getBoundingClientRect();
    return { dialogBottom: d.bottom, footerBottom: f.bottom, viewportHeight: innerHeight, footerVisible: f.top < innerHeight && f.bottom <= innerHeight + 1, dialogScrollHeight: dialog.scrollHeight, dialogClientHeight: dialog.clientHeight };
  });
  await closeImport(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  await openImport(page);
  await page.locator('#import-file-input').setInputFiles(path.join(inputDir, '01_valid_utf8_bom_semicolon.csv'));
  mock.setImportResponse({ total: 1, created: 1, skipped: 0, errors: [], task_ids: [900001] });
  await page.getByRole('button', { name: 'Импортировать' }).click();
  await page.locator('#import-result').waitFor({ state: 'visible' });
  results.resultStates.success = await page.locator('#import-result').innerText();
  await page.screenshot({ path: path.join(screenshotDir, 'desktop-success-result.png'), fullPage: true });
  await page.waitForTimeout(1600);
  results.resultStates.successAutoClosed = (await page.locator('#import-tasks-overlay').count()) === 0;
  expect(results.resultStates.successAutoClosed).toBe(false);
  await closeImport(page);

  await openImport(page);
  await page.locator('#import-file-input').setInputFiles(path.join(inputDir, '56_long_server_messages.csv'));
  mock.setImportResponse({
    total: 1,
    created: 0,
    skipped: 1,
    errors: [{ row: null, field: '', field_label: '', value: 'X'.repeat(500), type: 'unknown_error', message: 'Очень длинное сообщение '.repeat(80), fatal: true }],
    task_ids: [],
  });
  await page.getByRole('button', { name: 'Импортировать' }).click();
  await page.locator('#import-result').waitFor({ state: 'visible' });
  results.resultStates.longError = await page.locator('#import-result').evaluate(el => ({ text: el.innerText.slice(0, 1200), horizontalOverflow: el.scrollWidth - el.clientWidth }));
  await page.screenshot({ path: path.join(screenshotDir, 'desktop-long-error-result.png'), fullPage: true });
  await closeImport(page);

  results.importRequests = mock.requests;
  await fs.writeFile(path.join(evidenceDir, 'ui-ux-results.json'), JSON.stringify(results, null, 2), 'utf8');
  await page.close();
});
