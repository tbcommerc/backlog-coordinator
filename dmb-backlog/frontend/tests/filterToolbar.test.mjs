import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const toolbar = read('js/components/filterToolbar.js');
const taskColumns = read('js/components/taskColumns.js');
const quickFilters = read('js/components/quickFilters.js');
const componentsCss = read('css/components.css');
const responsiveCss = read('css/responsive.css');

function arrayBody(source, declaration) {
  const match = source.match(new RegExp(`${declaration}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  assert.ok(match, `missing array declaration ${declaration}`);
  return match[1];
}

const taskColumnKeys = [...arrayBody(taskColumns, 'export const TASK_COLUMNS').matchAll(/\{\s*key:\s*'([^']+)'/g)]
  .map(match => match[1]);
const filterColumnKeys = [...arrayBody(toolbar, 'const filterableColumns').matchAll(/columnKey:\s*'([^']+)'/g)]
  .map(match => match[1]);

assert.deepEqual(
  [...filterColumnKeys].sort(),
  [...taskColumnKeys].sort(),
  'every user-visible task table column must have one filter descriptor',
);
assert.equal(new Set(filterColumnKeys).size, filterColumnKeys.length, 'table columns must not have duplicate filter descriptors');
assert.match(taskColumns, /owner:\s*'Исполнитель'/, 'owner column fallback must use the product term Исполнитель');
assert.match(toolbar, /key:\s*'owner_name',\s*label:\s*'Исполнитель',\s*columnKey:\s*'owner'/, 'owner filter must use the product term Исполнитель');
assert.doesNotMatch(toolbar, /key:\s*'owner_name'[^\r\n]*filterLabel:/, 'owner filter must follow the configured column label');

assert.match(
  toolbar,
  /backlog:\s*\['status_name', 'priority_name', 'team_name', 'deadline_name', 'project_name'\]/,
  'DMB backlog must start with the agreed pinned filters',
);
assert.match(
  toolbar,
  /team:\s*\['status_name', 'priority_name', 'deadline_name', 'owner_name', 'task_type_name'\]/,
  'team backlog must start with the agreed pinned filters',
);
assert.match(toolbar, /const MAX_PINNED_FILTERS = 5/);
assert.match(toolbar, /PINNED_FILTERS_PREFIX \+ scope/, 'pinned filters must be stored independently for each backlog scope');
assert.match(toolbar, /data-pin-filter=/, 'the complete catalog must expose pin controls');
assert.match(toolbar, /data-reset-pinned-filters=/, 'users must be able to restore the recommended pinned set');
assert.doesNotMatch(quickFilters, /data-pin-filter|PINNED_FILTERS_PREFIX/, 'quick scenarios must remain fixed');

for (const contract of [
  /columnKey: 'progress'.*type: 'number'/,
  /columnKey: 'tags'.*type: 'select'/,
  /columnKey: 'date_received'.*type: 'date'/,
  /columnKey: 'description'.*type: 'text'/,
  /columnKey: 'did_demo'.*type: 'boolean'/,
]) {
  assert.match(toolbar, contract, `missing typed filter contract ${contract}`);
}

assert.match(componentsCss, /\.filter-catalog-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,/);
assert.match(responsiveCss, /@media \(max-width: 1024px\)[\s\S]*?\.filter-catalog-panel\s*\{[\s\S]*?position:\s*fixed/);
assert.match(responsiveCss, /@media \(max-width: 640px\)[\s\S]*?\.pinned-filters-row\s*\{[\s\S]*?overflow-x:\s*auto/);
assert.match(responsiveCss, /\.filter-catalog-panel\s*\{[\s\S]*?max-height:\s*min\(82dvh/);

console.log('filter toolbar contracts: OK');
