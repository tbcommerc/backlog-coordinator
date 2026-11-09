import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const taskTable = read('js/components/backlogPage.js');
const teamBacklog = read('js/components/backlogPage.js');
const expressEstimate = read('js/components/expressEstimate.js');
const quickFilters = read('js/components/quickFilters.js');
const filterToolbar = read('js/components/filterToolbar.js');
const modal = read('js/components/modal.js');
const componentsCss = read('css/components.css');

test('оба бэклога используют один набор из восьми быстрых фильтров', () => {
  assert.match(taskTable, /quickFilters: renderQuickFilters\('backlog'[,)]/);
  assert.match(teamBacklog, /quickFilters: renderQuickFilters\('backlog'[,)]/);
  assert.match(taskTable, /initQuickFilters\('backlog', \(\) => tasksCache\?\.items \|\| \[\]\)/);
  assert.match(teamBacklog, /initQuickFilters\('backlog', \(\) => tasksCache\?\.items \|\| \[\]\)/);
  assert.equal((quickFilters.match(/key: '/g) || []).length, 8);
});

test('отдельный frontend-сигнал PI-доработки удалён из всех поверхностей', () => {
  const sources = [quickFilters, filterToolbar, teamBacklog, expressEstimate, modal, componentsCss];
  const removedSignal = /pip_rework|pipRework|team-pip-rework|qe-pip-rework|task-card-pip-rework|focus_task|data-filter="returned"/;
  sources.forEach(source => assert.doesNotMatch(source, removedSignal));
  [['Возврат', 'из PI'], ['Возвращено', 'с PI']]
    .map(parts => parts.join(' '))
    .forEach(text => sources.forEach(source => assert.equal(source.includes(text), false)));
  assert.equal(existsSync(new URL('../js/pipFlow.js', import.meta.url)), false);
});
