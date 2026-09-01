import assert from 'node:assert/strict';
import { renderReports, renderReportingMeetingsManagement } from '../js/components/reports.js';

const page = renderReports({});

assert.match(page, /data-report="pd-estimates"/);
assert.match(page, /Сбор оценок для PD/);
assert.match(page, /Сбор оценок от бизнес-заказчиков по итогам выполнения квартальных задач/);
assert.doesNotMatch(page, /id="count-pd-estimates"/);
assert.match(page, /Светофоры по квартальным задачам/);
assert.doesNotMatch(page, /Прогресс по задачам/);
assert.doesNotMatch(page, /id="reporting-meetings-panel"/);

const management = renderReportingMeetingsManagement({});
assert.match(management, /Управление отчётными встречами/);
assert.match(management, /id="reporting-meetings-panel"/);
assert.match(management, /Историческая версия/);
