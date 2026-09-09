import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const read = relative => fs.readFileSync(path.join(frontend, relative), 'utf8');
const workspace = read('js/components/reportingStatuses.js');
const reports = read('js/components/reports.js');
const didBacklog = read('js/components/didBacklog.js');
const teamBacklog = read('js/components/teamBacklog.js');
const filterToolbar = read('js/components/filterToolbar.js');
const router = read('js/router.js');
const app = read('js/app.js');
const pagesCss = read('css/pages.css');
const statusModule = await import('../js/components/reportingStatuses.js');

const appFor = currentUser => ({ store: { get: key => key === 'currentUser' ? currentUser : null } });
assert.equal(statusModule.canUseReportingStatusWorkspace(appFor({ team_id: 7, role_name: 'PO/PL/CL' })), true);
assert.equal(statusModule.canUseReportingStatusWorkspace(appFor({ team_id: 7, role_name: 'BA/Участник команды' })), true);
assert.equal(statusModule.canUseReportingStatusWorkspace(appFor({ team_id: null, role_name: 'Администратор', permissions: { admin: 'full' } })), true);
assert.equal(statusModule.canUseReportingStatusWorkspace(appFor({ team_id: 8, role_name: 'Лидер трайба' })), false);
assert.equal(statusModule.reportingStatusHref({ source: 'notification', meetingId: 42 }), '#/reporting-statuses?source=notification&meeting_id=42');

const statusItems = [
  { task_id: 1, public_id: 'TASK-001', title: 'Без статуса', team_name: 'Команда', filled: false },
  { task_id: 2, public_id: 'TASK-002', title: 'Только что сохранён', team_name: 'Команда', filled: true },
  { task_id: 3, public_id: 'TASK-003', title: 'Заполнен ранее', team_name: 'Команда', filled: true },
];
assert.deepEqual(
  statusModule.filterReportingStatusItems(statusItems, { missingOnly: true, recentlySavedIds: new Set([2]) }).map(item => item.task_id),
  [1, 2],
);
assert.deepEqual(
  statusModule.filterReportingStatusItems(statusItems, { missingOnly: true }).map(item => item.task_id),
  [1],
);
const confirmableItems = [
  { task_id: 1, text: 'Сохранённый черновик', is_ready: false, can_edit: true },
  { task_id: 2, text: 'Уже подтверждён', is_ready: true, can_edit: true },
  { task_id: 3, text: '', is_ready: false, can_edit: true },
  { task_id: 4, text: 'Только чтение', is_ready: false, can_edit: false },
  { task_id: 5, text: '', is_ready: false, can_edit: true },
];
assert.deepEqual(
  statusModule.confirmableReportingStatusIds(confirmableItems, new Map([[5, { text: 'Новый заполненный статус', is_ready: false }]])),
  [1, 5],
);

assert.match(router, /'\/reporting-statuses': \{ render: renderReportingStatuses, init: initReportingStatuses \}/);
assert.match(app, /confirmReportingStatusNavigation/);
assert.match(workspace, /\/reporting-meetings\?include_closed=false&include_completeness=false/);
assert.match(workspace, /\/reporting-meetings\/\$\{meeting\.id\}\/preparation/);
assert.match(workspace, /\/tasks\/\$\{taskId\}\/reporting-statuses\/\$\{meeting\.id\}/);
assert.match(workspace, /data-save-reporting-all/);
assert.match(workspace, /data-confirm-reporting-all/);
assert.match(workspace, /Подтвердить все/);
assert.match(workspace, /Подтвердить готовность/);
assert.match(workspace, /Просмотрите, обновите и подтвердите готовность статусов всех команд/);
assert.match(workspace, /reporting-status-heading/);
assert.match(workspace, /class="modal-overlay reporting-status-workspace/);
assert.match(workspace, /class="reporting-status-dialog" role="dialog" aria-modal="true" aria-labelledby="reporting-status-title"/);
assert.match(workspace, /data-modal-close/);
assert.match(workspace, /reporting-status-editor-label">Статус к выбранной встрече/);
assert.match(workspace, /reporting-status-toolbar[\s\S]*reporting-readiness[\s\S]*data-save-reporting-all/);
assert.match(workspace, /data-lucide="alert-circle"/);
assert.doesNotMatch(workspace, /data-lucide="circle-alert"/);
assert.doesNotMatch(workspace, /reporting-preparation-head|reporting-status-savebar/);
assert.match(workspace, /previous_status/);
assert.match(workspace, /is_ready/);
assert.match(workspace, /data-reporting-missing/);
assert.match(workspace, /recentlySavedIds\.add\(taskId\)/);
assert.match(workspace, /confirmAction\(/);
assert.doesNotMatch(workspace, /window\.confirm|window\.prompt/);
assert.match(reports, /source: 'report'/);
assert.match(didBacklog, /kind: 'did'/);
assert.match(filterToolbar, /bulkOpsTitle \|\| 'Массовые операции'/);
assert.match(teamBacklog, /bulkOpsTitle: 'Операции'/);
assert.match(teamBacklog, /bulkOpsMenu: true/);
assert.match(teamBacklog, /openTeamOperationsMenu\(app\)/);
assert.match(teamBacklog, /Конструктор массовых изменений/);
assert.match(teamBacklog, /Статусы к отчётным встречам/);
assert.match(teamBacklog, /reportingStatusHref\(\{ source: 'team-backlog' \}\)/);
assert.doesNotMatch(teamBacklog, /reporting-status-entry/);
assert.match(teamBacklog, /team-bulk-selected'\)\?\.addEventListener\('click', \(\) => openTeamBulkOps/);
assert.match(pagesCss, /\.reporting-meeting-tabs \{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(pagesCss, /\.main-content:has\(> \.reporting-status-workspace\) \{[^}]*min-height:0;[^}]*overflow:clip/);
assert.match(pagesCss, /\.reporting-status-workspace \{[^}]*padding:12px;[^}]*backdrop-filter:blur\(5px\)/);
assert.match(pagesCss, /\.reporting-status-dialog \{[^}]*grid-template-rows:auto minmax\(0,1fr\);[^}]*width:min\(100%,1800px\);[^}]*height:100%;[^}]*overflow:hidden/);
assert.match(pagesCss, /\.reporting-preparation \{[^}]*display:flex;[^}]*min-height:0;[^}]*overflow:hidden/);
assert.match(pagesCss, /\.reporting-task-status-list \{[^}]*flex:1 1 auto;[^}]*min-height:0;[^}]*overflow-y:auto/);
assert.match(pagesCss, /\.reporting-status-toolbar \{[^}]*grid-template-areas:"search missing result readiness bulk"/);
assert.match(pagesCss, /\.reporting-task-status \{[^}]*grid-template-areas:"head head" "previous editor" "footer footer"/);
assert.match(pagesCss, /\.reporting-status-editor textarea \{[^}]*height:76px;[^}]*resize:none/);
assert.doesNotMatch(pagesCss, /\.reporting-status-savebar \{/);
assert.doesNotMatch(pagesCss, /\.reporting-task-status-list \{[^}]*max-height:min\(58vh/);
assert.match(pagesCss, /@media \(max-width: 820px\) \{[\s\S]*?\.reporting-status-dialog \{[^}]*height:100dvh;[^}]*border-radius:0/);
assert.match(pagesCss, /@media \(max-width: 820px\) \{[\s\S]*?\.reporting-task-status-list \{[^}]*overflow-y:auto/);
assert.match(workspace, /root\.closest\('\.main-content'\)/);
assert.match(workspace, /pageScroller\.scrollTop = 0/);

console.log('reporting status workspace contracts passed');
