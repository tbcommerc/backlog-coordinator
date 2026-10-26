import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const moduleUrl = new URL('../js/components/modal.js', import.meta.url);
const source = readFileSync(moduleUrl, 'utf8').replace(/from (['"])(\.[^'"]+)\1/g, (_, quote, path) => `from '${new URL(path, moduleUrl).href}'`);
globalThis.window = { app: {}, location: { hash: '#/reports/detail?r=did-backlog' } };
const testHelpers = `
export function renderInitialBody() { return cardBodyMainV30(cardState.current, false); }
export function renderCardBodyForTest(task, editing = false, entryField = null) {
  currentTask = task;
  cardState.current = buildCardState(task);
  cardState.draft = JSON.parse(JSON.stringify(cardState.current));
  cardState.editing = editing;
  cardState.entryField = entryField;
  cardState.history = [];
  return cardBodyMainV30(editing ? cardState.draft : cardState.current, editing);
}
export function cardDiffPayloadForTest(task, patch) {
  currentTask = task;
  cardState.current = buildCardState(task);
  cardState.draft = JSON.parse(JSON.stringify(cardState.current));
  Object.assign(cardState.draft, patch);
  cardMaps = null;
  return {
    changes: cardDiffChanges(cardState.current, cardState.draft),
    payload: cardPayload(cardState.draft),
    patch: cardPatchPayload(),
  };
}`;
const {
  renderTaskDetailModal,
  renderInitialBody,
  renderCardBodyForTest,
  cardDiffPayloadForTest,
  normalizeTaskCardTab,
} = await import(`data:text/javascript;base64,${Buffer.from(source + testHelpers).toString('base64')}`);

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

test('активная V30-компоновка показывает комментарий, оценку, вес и прогноз', () => {
  globalThis.window = { app: {}, location: { hash: '#/tasks' } };
  const body = renderCardBodyForTest({
    id: 35,
    title: 'Задача с оценкой',
    comment: 'Только для рабочей группы',
    effort_days: 17,
    assessment_weight: 40,
    completion_forecast: 75,
  });
  assert.match(body, /Внутренний комментарий задачи/);
  assert.match(body, /Только для рабочей группы/);
  assert.match(body, /Общая оценка трудозатрат, ч\/д/);
  assert.match(body, />17 ч\/д</);
  assert.match(body, /Вес оценки, %/);
  assert.match(body, />40%</);
  assert.match(body, /Прогноз выполнения, %/);
  assert.match(body, />75%</);
  delete globalThis.window;
});

test('возвращённые атрибуты доступны в полном и быстром режиме редактирования', () => {
  globalThis.window = { app: {}, location: { hash: '#/tasks' } };
  const task = {
    id: 36,
    title: 'Редактируемая задача',
    comment: 'Комментарий',
    effort_days: 8,
    assessment_weight: 30,
    completion_forecast: 60,
  };
  const fullEdit = renderCardBodyForTest(task, true);
  assert.match(fullEdit, /data-k="comment"/);
  assert.match(fullEdit, /max="10000"[^>]*data-k="effortDays"/);
  assert.match(fullEdit, /max="100"[^>]*data-k="weightPercent"/);
  assert.match(fullEdit, /max="100"[^>]*data-k="forecastPercent"/);

  const quickEdit = renderCardBodyForTest(task, true, 'comment');
  assert.match(quickEdit, /data-k="comment"/);
  assert.doesNotMatch(quickEdit, /data-k="effortDays"/);
  delete globalThis.window;
});

test('diff и PATCH-поля сохраняют комментарий, оценку, вес и прогноз', () => {
  globalThis.window = { app: {}, location: { hash: '#/tasks' } };
  const result = cardDiffPayloadForTest({
    id: 37,
    version: 4,
    title: 'Проверка payload',
    comment: 'Было',
    effort_days: 5,
    assessment_weight: 10,
    completion_forecast: 20,
  }, {
    comment: 'Стало',
    effortDays: 13,
    weightPercent: 45,
    forecastPercent: 80,
  });
  assert.deepEqual(result.changes.map(change => change.key), [
    'comment',
    'effortDays',
    'weightPercent',
    'forecastPercent',
  ]);
  assert.equal(result.payload.comment, 'Стало');
  assert.equal(result.payload.effort_days, 13);
  assert.equal(result.payload.assessment_weight, 45);
  assert.equal(result.payload.completion_forecast, 80);
  assert.deepEqual(result.patch, {
    version: 4,
    comment: 'Стало',
    effort_days: 13,
    assessment_weight: 45,
    completion_forecast: 80,
  });
  delete globalThis.window;
});

test('legacy-вкладка files канонизируется в sys', () => {
  assert.equal(normalizeTaskCardTab('files'), 'sys');
  assert.equal(normalizeTaskCardTab('sys'), 'sys');
  assert.equal(normalizeTaskCardTab('rep'), 'rep');
  assert.equal(normalizeTaskCardTab('unknown'), 'main');
});
