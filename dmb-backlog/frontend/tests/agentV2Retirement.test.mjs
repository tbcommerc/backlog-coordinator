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

test('retired service has no UI modules, task prefill hook or feature flag', async () => {
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(new URL('../js/assistant-v2/', import.meta.url)), false);
  const modal = await read('../js/components/modal.js');
  const app = await read('../js/app.js');
  assert.equal(modal.includes('applyAssistantV2TaskPrefill'), false);
  assert.equal(modal.includes('assistant-v2-task-prefill'), false);
  assert.equal(app.includes('assistant_v2:'), false);
});
