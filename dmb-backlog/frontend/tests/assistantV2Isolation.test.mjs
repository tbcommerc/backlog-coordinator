import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('legacy greenfield V2 route redirects to the canonical fork-based V2 page', async () => {
  const router = await read('../js/router.js');
  assert.ok(router.includes("history.replaceState(null, '', '#/agent-v2')"));
  assert.equal(router.includes("import('./assistant-v2/routes.js"), false);
  assert.equal(router.includes("from './assistant-v2/"), false);
});

test('sidebar exposes only one V2 entry point', async () => {
  const sidebar = await read('../js/components/sidebar.js');
  assert.ok(sidebar.includes('href="#/customer/create"'));
  assert.ok(sidebar.includes('href="#/agent-v2"'));
  assert.equal(sidebar.includes('href="#/assistant-v2"'), false);
  assert.equal(sidebar.includes('ИИ-ассистент 2.0'), false);
});

test('Task form prefill has a fixed safe field allowlist and does not auto-save', async () => {
  const modal = await read('../js/components/modal.js');
  const start = modal.indexOf('export async function applyAssistantV2TaskPrefill');
  const end = modal.indexOf('// ============================================================', start);
  const prefillFunction = modal.slice(start, end);
  for (const field of ['title', 'description', 'comment', 'link_mockups', 'link_requirements']) {
    assert.match(prefillFunction, new RegExp(`\\b${field}:`));
  }
  for (const protectedField of ['owner_id', 'team_id', 'role_id', 'status_id']) {
    assert.equal(prefillFunction.includes(protectedField), false);
  }
  assert.equal(/api\.(post|put|patch|delete)/.test(prefillFunction), false);
  assert.ok(prefillFunction.includes('сохраните изменения вручную'));
});

test('V2 API client uses only the DMB gateway prefix', async () => {
  const api = await read('../js/assistant-v2/api.js');
  assert.ok(api.includes("/api/v2/assistant"));
  assert.equal(api.includes('127.0.0.1:9200'), false);
});

test('case workspace exposes human decisions without technical client paths', async () => {
  const workspace = await read('../js/assistant-v2/caseWorkspace.js');
  assert.ok(workspace.includes('только синтетические тестовые данные'));
  assert.ok(workspace.includes('/gaps/${card.dataset.gapId}/decisions'));
  assert.ok(workspace.includes('/conflicts/${card.dataset.conflictId}/decisions'));
  assert.ok(workspace.includes("decision: gapDecision.dataset.decision"));
  assert.ok(workspace.includes("decision: conflictDecision.dataset.decision"));
  assert.equal(workspace.includes('<label>Rule ID'), false);
  assert.equal(workspace.includes('<label>Путь'), false);
  assert.equal(workspace.includes('Технический ID'), false);
  assert.ok(workspace.includes('Поручение'));
  assert.ok(workspace.includes('Уточнение'));
  assert.ok(workspace.includes('Требование'));
});

test('V2 presentation translates internal statuses and paths for the UI', async () => {
  const presentation = await import('../js/assistant-v2/presentation.js');
  assert.equal(presentation.statusLabel('ready_for_analysis'), 'Готово к подготовке требования');
  assert.equal(presentation.fieldLabel('/passport/business_problem'), 'Бизнес-проблема и ценность');
  assert.equal(presentation.operationLabel('replace'), 'Изменить');
  assert.equal(presentation.findingMessage({ rule_id: 'S1_FIDELITY_CONFIRMATION' }), 'Подтвердите, что паспорт соответствует исходному тексту.');
});

test('V2 entry screens present one guided business flow', async () => {
  const cases = await import('../js/assistant-v2/caseWorkspace.js');
  const requirements = await import('../js/assistant-v2/requirementWorkspace.js');
  const list = cases.renderCaseList();
  const newCase = cases.renderNewCase();
  const directRequirement = requirements.renderNewRequirement();
  assert.ok(list.includes('Поручение'));
  assert.ok(list.includes('Уточнение'));
  assert.equal(list.includes('/requirements/new'), false);
  assert.ok(newCase.includes('Продолжить к уточнению'));
  assert.equal(directRequirement.includes('name="case_id"'), false);
  assert.ok(directRequirement.includes('Начните с поручения'));
});
