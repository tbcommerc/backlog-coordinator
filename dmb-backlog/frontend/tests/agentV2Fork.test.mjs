import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('fork-based V2 has a dedicated route while API access stays server-gated', async () => {
  const router = await read('../js/router.js');
  const dynamicImport = router.search(/import\('\.\/agent-v2\/routes\.js(?:\?v=\d+)?'\)/);
  assert.ok(dynamicImport > 0);
  assert.equal(router.includes('isAgentV2Route && !(agentV2?.enabled'), false);
  const allowedDeclaration = router.match(/const businessCustomerAllowedPaths = new Set\(\[([^\]]+)\]\)/);
  assert.ok(allowedDeclaration, 'Customer-only routes must have an explicit allowlist');
  const allowedPaths = new Set([...allowedDeclaration[1].matchAll(/'([^']+)'/g)].map(match => match[1]));
  for (const path of ['/customer', '/customer/create', '/agent-v2']) assert.ok(allowedPaths.has(path), path);
  for (const path of ['/admin', '/audit-log', '/outbox-dead-letters']) assert.equal(allowedPaths.has(path), false, path);
  assert.match(router, /customer_portal_mode === 'only' && !businessCustomerAllowedPaths\.has\(path\)/);
  assert.equal(router.includes("from './agent-v2/"), false);
});

test('fork-based V2 API client only calls the authenticated DMB gateway', async () => {
  const api = await read('../js/agent-v2/api.js');
  assert.ok(api.includes("this.base = '/api/v2/agent'"));
  assert.equal(api.includes('127.0.0.1:9300'), false);
  assert.equal(api.includes('X-Agent-Secret'), false);
});

test('workspace is document-first and keeps controlled review integrations', async () => {
  const workspace = await read('../js/agent-v2/workspace.js');
  const css = await read('../css/agent-v2.css');
  assert.ok(workspace.includes('assignment_capture'));
  assert.ok(workspace.includes('requirement_copilot'));
  assert.ok(workspace.includes('Рабочее место требований'));
  assert.ok(workspace.includes('Рабочий документ'));
  assert.ok(workspace.includes('Контекстный помощник'));
  assert.ok(workspace.includes('Контроль качества'));
  assert.ok(workspace.includes('Что нужно подготовить?'));
  assert.ok(workspace.includes('Проверить готовый документ'));
  assert.ok(workspace.includes('Расскажите о задаче своими словами'));
  assert.ok(workspace.includes('Описать задачу'));
  assert.ok(workspace.includes('Проверить документ'));
  assert.ok(workspace.includes('Добавить раздел'));
  assert.ok(workspace.includes('Проверить критерии'));
  assert.ok(workspace.includes('Найти противоречия'));
  assert.ok(workspace.includes('Этапы работы'));
  assert.ok(workspace.includes("business_requirement_v2: 'Бизнес-требование'"));
  assert.ok(workspace.includes("artifact?.revision ? `Редакция ${artifact.revision}` : 'Черновик'"));
  assert.ok(workspace.includes('/import-requirement-document'));
  assert.ok(workspace.includes('agent-v2-section-form'));
  assert.ok(workspace.includes('/objects/search?object_type='));
  assert.ok(workspace.includes('Предварительный просмотр'));
  assert.ok(workspace.includes('Версии'));
  assert.ok(workspace.includes('доступна только для чтения'));
  assert.ok(workspace.includes("data-decision=\"accepted\""));
  assert.ok(workspace.includes("data-decision=\"rejected\""));
  assert.ok(workspace.includes('/send-for-review'));
  assert.ok(css.includes('container:agent-workspace/inline-size'));
  assert.ok(css.includes('@container agent-workspace (max-width:920px)'));
  assert.ok(css.includes('@media(max-width:1180px){.agent-v2-shell{grid-template-columns:1fr}'));
  assert.equal(css.includes('container:agent-page/inline-size'), false);
  assert.ok(css.includes('.agent-v2-workbench>*{min-width:0}'));
  assert.equal(css.includes('minmax(440px,1fr)'), false);
});

test('returned V2 review resumes in the fork route while V1 fallback stays intact', async () => {
  const portal = await read('../js/components/customerPortal.js');
  assert.ok(portal.includes("startsWith('v2:') ? 'v2' : 'v1'"));
  assert.ok(portal.includes("agentV2Api(app).post(`/requests/${requestId}/resume`"));
  assert.ok(portal.includes("window.location.hash = '#/customer/create'"));
});

test('sidebar always exposes fork-based V2 as a separate page', async () => {
  const sidebar = await read('../js/components/sidebar.js');
  assert.ok(sidebar.includes('href="#/agent-v2"'));
  assert.ok(sidebar.includes('aria-label="ИИ-ассистент V2"'));
  assert.equal(sidebar.includes('const agentV2Link = agentV2?.enabled'), false);
  assert.ok(sidebar.includes("'ИИ-ассистент V2'"));
});

test('visible V2 page does not call the gateway until feature, pilot and role are ready', async () => {
  const workspace = await read('../js/agent-v2/workspace.js');
  assert.ok(workspace.includes('function hasAgentV2Access(app)'));
  assert.ok(workspace.includes('feature?.enabled && feature?.pilot_allowed && feature?.operator_role'));
  assert.ok(workspace.includes('if (!hasAgentV2Access(app)) return;'));
  assert.ok(workspace.includes('Страница V2 подключена'));
});
