import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const moduleUrl = new URL('../js/components/modal.js', import.meta.url);
const source = readFileSync(moduleUrl, 'utf8').replace(
  /from (['"])(\.[^'"]+)\1/g,
  (_, quote, path) => `from '${new URL(path, moduleUrl).href}'`,
);

globalThis.window = { app: {}, location: { hash: '#/tasks' }, toast() {} };
const documentElements = new Map();
globalThis.document = {
  getElementById(id) { return documentElements.get(id) || null; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
};

const testHelpers = `
export function initReportingDraftScenarioForTest(context) {
  currentTask = { id: 42, version: 1 };
  cardState.tab = 'main';
  cardState.editing = false;
  cardState.dirty = false;
  cardState.current = null;
  cardState.draft = null;
  cardReportingLoading = false;
  cardReportingContext = context;
  clearCardReportingDrafts();
}
export function setReportingDraftForTest(kind, meetingId, text, didDemo = false) {
  const textInput = { value: text };
  const demoInput = { checked: didDemo };
  const card = {
    dataset: { reportingKind: kind, reportingMeetingId: String(meetingId) },
    querySelector(selector) { return selector.includes('data-reporting-text') ? textInput : demoInput; },
  };
  const target = {
    dataset: { reportingText: kind, reportingMeetingId: String(meetingId) },
    matches(selector) { return selector === '[data-reporting-text]'; },
    closest() { return card; },
  };
  cardState.tab = 'rep';
  cardOnField({ target, type: 'input' });
  return reportingDraftStateForTest();
}
export function reportingDraftStateForTest() {
  return {
    count: cardReportingDirtyCount(),
    taskDirty: cardState.dirty,
    hasUnsaved: hasUnsavedTaskChanges(),
    names: cardReportingDraftNames(),
    drafts: Array.from(cardReportingDrafts.values()).map(value => ({ ...value })),
  };
}
export async function saveReportingDraftForTest(kind, meetingId, version, app) {
  const button = {
    dataset: { reportingKind: kind, meetingId: String(meetingId), version: String(version) },
    disabled: false,
  };
  cardState.tab = 'main';
  await cardSaveReportingStatus(button, app);
  return reportingDraftStateForTest();
}
export function renderReportingItemForTest(kind, meetingId) {
  const item = cardFindReportingItem(kind, meetingId);
  return item ? cardReportingItem(item) : '';
}
export function clearReportingDraftsForTest() {
  clearCardReportingDrafts();
  return reportingDraftStateForTest();
}
export function renderReportingFooterForTest() {
  cardState.tab = 'rep';
  cardState.editing = false;
  cardRenderFooter();
}`;

const {
  initReportingDraftScenarioForTest,
  setReportingDraftForTest,
  reportingDraftStateForTest,
  saveReportingDraftForTest,
  renderReportingItemForTest,
  clearReportingDraftsForTest,
  renderReportingFooterForTest,
} = await import(`data:text/javascript;base64,${Buffer.from(source + testHelpers).toString('base64')}`);

const initialContext = {
  items: [
    {
      kind: 'directorate',
      title: 'Директорская оперативка',
      can_edit: true,
      current_meeting: { id: 101, scheduled_date: '2026-09-14' },
      current_status: { text: 'Директорский серверный статус', version: 2 },
      previous_status: {},
    },
    {
      kind: 'did',
      title: 'Оперативка ДИД',
      can_edit: true,
      current_meeting: { id: 202, scheduled_date: '2026-09-15' },
      current_status: { text: 'ДИД серверный статус', did_demo: false, version: 7 },
      previous_status: {},
    },
  ],
};

test('сохранение directorate не стирает несохранённый draft did', async () => {
  initReportingDraftScenarioForTest(structuredClone(initialContext));
  setReportingDraftForTest('directorate', 101, 'Новый директорский статус');
  const beforeSave = setReportingDraftForTest('did', 202, 'Новый статус ДИД', true);
  assert.equal(beforeSave.count, 2);
  assert.equal(beforeSave.taskDirty, false);
  assert.equal(beforeSave.hasUnsaved, true);
  const footer = { innerHTML: '' };
  const dirty = { innerHTML: '', style: {} };
  documentElements.set('mfoot', footer);
  documentElements.set('dirty', dirty);
  renderReportingFooterForTest();
  assert.match(footer.innerHTML, /Несохранённых статусов · 2/);
  assert.equal(dirty.style.display, 'inline-flex');
  assert.match(dirty.innerHTML, /Несохранённых статусов · 2/);
  documentElements.clear();

  const refreshedContext = structuredClone(initialContext);
  refreshedContext.items[0].current_status = { text: 'Новый директорский статус', version: 3 };
  const requests = [];
  const app = {
    api: {
      async put(path, payload) { requests.push({ method: 'put', path, payload }); },
      async get(path) { requests.push({ method: 'get', path }); return refreshedContext; },
    },
  };
  window.app = app;

  const afterSave = await saveReportingDraftForTest('directorate', 101, 2, app);
  assert.deepEqual(requests[0], {
    method: 'put',
    path: '/tasks/42/reporting-statuses/101',
    payload: { text: 'Новый директорский статус', did_demo: false, version: 2 },
  });
  assert.deepEqual(requests[1], { method: 'get', path: '/tasks/42/reporting-statuses/context' });
  assert.equal(afterSave.count, 1);
  assert.equal(afterSave.taskDirty, false);
  assert.equal(afterSave.hasUnsaved, true);
  assert.equal(afterSave.drafts[0].kind, 'did');
  assert.equal(afterSave.drafts[0].meetingId, '202');
  assert.equal(afterSave.drafts[0].text, 'Новый статус ДИД');
  assert.equal(afterSave.drafts[0].didDemo, true);

  const directorateHtml = renderReportingItemForTest('directorate', 101);
  assert.match(directorateHtml, /Новый директорский статус/);
  assert.doesNotMatch(directorateHtml, /is-dirty/);
  const didHtml = renderReportingItemForTest('did', 202);
  assert.match(didHtml, /is-dirty/);
  assert.match(didHtml, /Новый статус ДИД/);
  assert.match(didHtml, /data-reporting-demo="did"[^>]*checked/);
});

test('возврат к серверным значениям очищает только соответствующий reporting draft', () => {
  initReportingDraftScenarioForTest(structuredClone(initialContext));
  setReportingDraftForTest('directorate', 101, 'Черновик директората');
  setReportingDraftForTest('did', 202, 'Черновик ДИД', true);
  const afterRevert = setReportingDraftForTest('directorate', 101, 'Директорский серверный статус');
  assert.equal(afterRevert.count, 1);
  assert.equal(afterRevert.drafts[0].kind, 'did');
  assert.equal(afterRevert.taskDirty, false);

  const afterDiscard = clearReportingDraftsForTest();
  assert.equal(afterDiscard.count, 0);
  assert.equal(afterDiscard.hasUnsaved, false);
});

test('guards, footer и вкладки используют отдельное состояние reporting drafts', () => {
  assert.match(source, /function hasUnsavedTaskChanges\(\)[\s\S]*?cardState\?\.dirty[\s\S]*?cardReportingDirtyCount\(\)[\s\S]*?_taskCommentDraftSession\.hasChanges\(currentTask\?\.id\)[\s\S]*?_createTaskDirty/);
  assert.match(source, /cardCaptureReportingDraft\(ev\.target\);[\s\S]*?cardUpdateDirty\(\);[\s\S]*?return;/);
  assert.doesNotMatch(
    source.slice(source.indexOf('function cardOnField'), source.indexOf('async function cardConfirmTabChange')),
    /data-reporting-demo[\s\S]{0,200}cardState\.dirty = true/,
  );
  assert.match(source, /Несохранённых статусов · ' \+ cardReportingDirtyCount\(\)/);
  assert.match(source, /async function cardConfirmTabChange\(nextTab\)[\s\S]*?clearCardReportingDrafts\(\)/);
  assert.match(source, /_cardRouteTabHandler = async event =>[\s\S]*?await cardConfirmTabChange\(requestedTab\)/);
  assert.ok((source.match(/clearCardReportingDrafts\(\)/g) || []).length >= 5);
});

test.after(() => {
  delete globalThis.document;
  delete globalThis.window;
});
