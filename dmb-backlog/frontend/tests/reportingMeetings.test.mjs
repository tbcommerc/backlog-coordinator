import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reports = await readFile(new URL('../js/components/reports.js', import.meta.url), 'utf8');
const modal = await readFile(new URL('../js/components/modal.js', import.meta.url), 'utf8');
const pagesCss = await readFile(new URL('../css/pages.css', import.meta.url), 'utf8');
const router = await readFile(new URL('../js/router.js', import.meta.url), 'utf8');
const sidebar = await readFile(new URL('../js/components/sidebar.js', import.meta.url), 'utf8');

assert.match(reports, /\/reporting-meetings\?include_closed=true/);
assert.match(reports, /data-meeting-action="schedule"/);
assert.match(reports, /class="meeting-date-action"/);
assert.match(reports, /class="meeting-date-actions"/);
assert.match(reports, /class="meeting-primary-date-main"/);
assert.match(reports, /class="meeting-date-action is-danger" data-meeting-action="cancel"/);
assert.match(reports, /Изменить дату/);
assert.match(reports, /Назначить дату/);
assert.match(reports, /data-meeting-action="complete"/);
assert.match(reports, /data-meeting-action="cancel"/);
assert.match(reports, /isOpen && canComplete/);
assert.match(reports, /Boolean\(meeting\.scheduled_date\) && meeting\.scheduled_date <= localToday/);
assert.equal((reports.match(/data-meeting-action="cancel"/g) || []).length, 1);
assert.match(reports, /showReportingMeetingForm/);
assert.match(reports, /showReportingMeetingForm\(meeting, 'complete'\)/);
assert.match(reports, /id="meeting-scheduled-date"/);
assert.match(reports, /id="meeting-cancel-reason"/);
assert.match(reports, /function getUpcomingMeetingDates/);
assert.match(reports, /Ближайшие даты/);
assert.match(reports, /meeting-progress-track/);
assert.match(reports, /data-meeting-view="timeline"/);
assert.match(reports, /data-meeting-filter="kind"/);
assert.match(reports, /data-meeting-filter="state"/);
assert.match(reports, /data-meeting-action="prepare"/);
assert.match(reports, /data-meeting-action="history"/);
assert.match(reports, /data-meeting-export/);
assert.match(reports, /BEGIN:VCALENDAR/);
assert.match(reports, /\/preparation/);
assert.match(reports, /\/history/);
assert.match(reports, /Array\.isArray\(meeting\.history\)/);
assert.match(reports, /backend перезапущен после обновления/);
assert.match(reports, /HTTP \$\{error\.status\}/);
assert.match(reports, /data-preparation-retry/);
assert.match(reports, /data-preparation-missing/);
assert.match(reports, /Зафиксированный срез статусов/);
assert.match(reports, /История изменений/);
assert.match(reports, /force: !!form\.elements\.force/);
assert.match(reports, /Показаны актуальные данные/);
assert.match(reports, /Первая дата оперативки ДИД должна быть вторником/);
assert.match(reports, /function getMeetingCards/);
assert.match(reports, /cards\.map\(item => renderReportingMeetingCard\(item, false\)\)/);
assert.doesNotMatch(reports, /filtered\.map\(item => renderReportingMeetingCard/);
assert.match(reports, /meeting-upcoming-slot/);
assert.match(reports, /meeting-messages/);
assert.match(reports, /<div class="meeting-actions">\$\{actions\}<\/div>/);
assert.match(pagesCss, /grid-template-rows:104px 104px 112px 104px 48px minmax\(58px,auto\)/);
assert.match(pagesCss, /\.reporting-meeting-card \{[^}]*align-content:start;/);
assert.match(pagesCss, /\.meeting-card-head \{ display:grid;/);
assert.match(pagesCss, /\.meeting-date-chip \{[^}]*flex:0 0 auto;/);
assert.match(pagesCss, /\.meeting-date-action\.is-danger \{[^}]*color:var\(--danger\);/);
assert.match(pagesCss, /\.meeting-primary-date-main \{[^}]*justify-content:space-between;/);
assert.match(pagesCss, /\.meeting-actions \{[^}]*flex-wrap:wrap;/);
assert.match(pagesCss, /\.meeting-actions \{ align-self:start;/);
assert.match(pagesCss, /\.meeting-action\.is-primary \{ flex:1 1 160px;/);
assert.match(router, /'\/reporting-meetings'/);
assert.match(router, /requiresFullAdmin[\s\S]*\/reporting-meetings/);
assert.match(sidebar, /Управление отчётными встречами/);

const meetingActionSource = reports.slice(
  reports.indexOf('async function handleReportingMeetingAction'),
  reports.indexOf('function resolveReportFields'),
);
assert.doesNotMatch(meetingActionSource, /window\.prompt|window\.confirm/);

assert.match(modal, /\/reporting-statuses\/context/);
assert.match(modal, /save-reporting-status/);
assert.match(modal, /Статус прошлой встречи/);
assert.match(modal, /item\.edit_reason/);
assert.match(modal, /Несохранённый отчётный статус будет потерян/);

const payloadSource = modal.slice(modal.indexOf('function cardPayload'), modal.indexOf('function cardPatchPayload'));
assert.doesNotMatch(payloadSource, /directorate_status|did_status|key_project_status|did_demo/);
