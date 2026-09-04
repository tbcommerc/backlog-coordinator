import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderReports, renderReportingMeetingsManagement } from '../js/components/reports.js';

const reportsSource = await readFile(new URL('../js/components/reports.js', import.meta.url), 'utf8');

const page = renderReports({});

assert.match(page, /data-report="pd-estimates"/);
assert.match(page, /Сбор оценок для PD/);
assert.match(page, /Сбор оценок от бизнес-заказчиков по итогам выполнения квартальных задач/);
assert.doesNotMatch(page, /id="count-pd-estimates"/);
const pdCard = page.match(/<div class="cursor-pointer grad-emerald report-card"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)?.[0] || '';
assert.match(pdCard, /В разработке/);
assert.equal((pdCard.match(/В разработке/g) || []).length, 1);
assert.match(page, /class="report-count"[^>]*role="status"[^>]*aria-live="polite"/);
assert.match(page, /report-count-spinner/);
assert.doesNotMatch(page, /id="count-directorate">0<\/div>/);
assert.match(page, /Светофоры по квартальным задачам/);
assert.doesNotMatch(page, /Прогресс по задачам/);
assert.doesNotMatch(page, /id="reporting-meetings-panel"/);

const management = renderReportingMeetingsManagement({});
assert.match(management, /Управление отчётными встречами/);
assert.match(management, /id="reporting-meetings-panel"/);
assert.match(management, /Историческая версия/);

assert.match(reportsSource, /if \(!data\.teams\.length\) \{[\s\S]*renderReportTable\(\[\], config\.fields\)/);
assert.doesNotMatch(reportsSource, /if \(!list \|\| !list\.length\) return/);
assert.match(reportsSource, /function setReportCountLoading\(\)/);
assert.match(reportsSource, /setReportCountLoading\(\);[\s\S]*try \{/);
