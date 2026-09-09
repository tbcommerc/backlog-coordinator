import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const moduleUrl = new URL('../js/components/modal.js', import.meta.url);
const source = readFileSync(moduleUrl, 'utf8').replace(/from (['"])(\.[^'"]+)\1/g, (_, quote, path) => `from '${new URL(path, moduleUrl).href}'`);
globalThis.window = { app: {}, location: { hash: '#/reports/detail?r=did-backlog' } };
const { renderTaskDetailModal, renderInitialBody } = await import(`data:text/javascript;base64,${Buffer.from(source + '\nexport function renderInitialBody() { return cardBodyMainV30(cardState.current, false); }').toString('base64')}`);

test('карточка показывает данные до загрузки справочников', () => {
  globalThis.window = { app: {}, location: { hash: '#/reports/detail?r=did-backlog' } };
  const task = { id: 33, title: 'Проверка первого открытия', description: 'Описание задачи', department_id: 2, department_name: 'РИСКИ', did_client_group_id: 5, did_client_group_name: 'Клиенты ДИД' };
  renderTaskDetailModal(task, window.app);
  const body = renderInitialBody();
  assert.match(body, /Проверка первого открытия/);
  assert.match(body, /Описание задачи/);
  assert.match(body, /РИСКИ/);
  assert.match(body, /Клиенты ДИД/);
  delete globalThis.window;
});

test('метрический KR показан в основных свойствах, а не в финансах', () => {
  globalThis.window = { app: {}, location: { hash: '#/tasks' } };
  const task = { id: 34, title: 'KR-задача', metric_kr_plan: 80, metric_kr_fact: 65, metric_kr_unit: '%' };
  renderTaskDetailModal(task, window.app);
  const body = renderInitialBody();
  const krPosition = body.indexOf('Метрический KR');
  const kpiPosition = body.indexOf('Ключевые показатели');
  assert.ok(krPosition >= 0 && krPosition < kpiPosition);
  assert.match(body, /План:\s*80\s*%/);
  assert.match(body, /Факт:\s*65\s*%/);
  assert.doesNotMatch(body.slice(kpiPosition), /Метрический KR/);
  delete globalThis.window;
});
