import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const audit = read('js/components/auditLog.js');
const pagesCss = read('css/pages.css');

assert.match(audit, /search:\s*''/, 'audit state must include server-side search');
assert.match(audit, /params\.set\('search', auditState\.search\)/, 'search must be sent to the audit API');
assert.match(audit, /renderViewState\(/, 'loading, empty and error states must use the shared view state');
assert.match(audit, /По заданным условиям ничего не найдено/, 'filtered empty state must explain why the list is empty');
assert.match(audit, /data-view-state-action/, 'the error state must expose retry');
assert.match(audit, /data-remove-filter/, 'applied filters must be individually removable');
assert.match(audit, /data-toggle-audit-filters/, 'mobile users must be able to collapse the filter form');
assert.match(audit, /id="audit-per-page"/, 'table footer must expose page-size selection');
assert.match(audit, /data-copy-request/, 'request ids must be copyable');
assert.match(audit, /Дата начала не может быть позже даты окончания/, 'invalid date ranges must be rejected before loading');
assert.match(audit, /class="audit-page-table-wrap table-container"/, 'audit table must use the shared scroll container');
assert.doesNotMatch(audit, /style="/, 'audit page layout must live in the design system CSS instead of inline styles');

assert.match(pagesCss, /\.audit-filter-panel,\.audit-table-card/);
assert.match(pagesCss, /\.audit-page-table thead\s*\{[\s\S]*?position:sticky/);
assert.match(pagesCss, /\.audit-page-table\s*\{[\s\S]*?min-width:1120px/);
assert.match(pagesCss, /@media\(max-width:820px\)[\s\S]*?\.audit-filter-grid/);
assert.match(pagesCss, /@media\(max-width:560px\)[\s\S]*?\.audit-period-field>div/);
assert.match(pagesCss, /\.audit-filter-panel:not\(\.is-open\) \.audit-filter-grid/);

console.log('audit log page contracts: OK');
