import assert from 'node:assert/strict';
import {
  getReportPayload,
  parseReportJson,
  renderFilterRow,
  renderReportForm,
} from '../js/components/adminReports.js';

const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

assert.deepEqual(parseReportJson('["title"]'), ['title']);
assert.equal(parseReportJson('{broken'), null);

const form = renderReportForm({
  name: '<Отчёт>',
  description: '<Описание>',
  fields: '["title"]',
  filters: '[]',
}, 'edit', escapeHtml);
assert.match(form, /&lt;Отчёт&gt;/);
assert.match(form, /&lt;Описание&gt;/);
assert.ok(!form.includes('<Отчёт>'));

const filter = renderFilterRow({ field: 'title', operator: 'contains', value: 'Тест' }, 0);
assert.match(filter, /data-filter-index="0"/);
assert.match(filter, /value="title" selected/);

const elements = {
  'report-name': { value: 'Мой отчёт' },
  'report-description': { value: 'Описание' },
  'report-is-public': { value: 'true' },
  'report-group-by': { value: 'team_name' },
  'report-sort-by': { value: 'progress' },
  'report-sort-order': { value: 'desc' },
};
const fakeDocument = {
  getElementById: id => elements[id] || null,
  querySelectorAll: selector => {
    if (selector === '.report-field-cb:checked') return [{ value: 'title' }];
    if (selector === '.report-filter-row') return [];
    return [];
  },
};
const payload = getReportPayload({}, fakeDocument);
assert.equal(payload.name, 'Мой отчёт');
assert.equal(payload.fields, '["title"]');
assert.equal(payload.group_by, 'team_name');
assert.equal(payload.sort_order, 'desc');
