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
const teamBacklog = read('js/components/backlogPage.js');
const filterToolbar = read('js/components/filterToolbar.js');
const router = read('js/router.js');
const app = read('js/app.js');
const pagesCss = read('css/pages.css');
const directorateReportCss = read('css/directorate-report.css');
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
assert.deepEqual(
  statusModule.filterReportingStatusItems([
    { task_id: 1, team_id: 7, text: '', is_ready: false },
    { task_id: 2, team_id: 7, text: 'Черновик', is_ready: false },
    { task_id: 3, team_id: 8, text: 'Готово', is_ready: true },
  ], { teamId: '7', readiness: 'drafts' }).map(item => item.task_id),
  [2],
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
assert.deepEqual(
  statusModule.confirmableReportingStatusIds([
    { task_id: 6, text: 'Недельный результат', weekly: { signal: 'decision', next_step: 'Запустить пилот', decision_request: '' }, is_ready: false, can_edit: true },
    { task_id: 7, text: 'Недельный результат', weekly: { signal: 'decision', next_step: 'Запустить пилот', decision_request: 'Согласовать объём' }, is_ready: false, can_edit: true },
  ]),
  [7],
);

assert.match(router, /'\/reporting-statuses': \{ render: renderReportingStatuses, init: initReportingStatuses \}/);
assert.match(app, /confirmReportingStatusNavigation/);
assert.doesNotMatch(app, /task: new Set\(\[[^\]]*'\/reporting-statuses'/);
assert.doesNotMatch(app, /report: new Set\(\[[^\]]*'\/reporting-statuses'/);
assert.match(workspace, /\/reporting-meetings\?include_closed=false&include_completeness=false/);
assert.match(workspace, /\/reporting-meetings\/\$\{meeting\.id\}\/preparation/);
assert.match(workspace, /\/tasks\/\$\{taskId\}\/reporting-statuses\/\$\{meeting\.id\}/);
assert.match(workspace, /\/reporting-meetings\/\$\{meeting\.id\}\/statuses\/batch/);
assert.match(workspace, /data-save-reporting-all/);
assert.match(workspace, /data-confirm-reporting-all/);
assert.match(workspace, /Сохранить и подтвердить/);
assert.match(workspace, /Сохранить черновики/);
assert.match(workspace, /Просмотрите, обновите и подтвердите готовность статусов всех команд/);
assert.match(workspace, /reporting-status-heading/);
assert.match(workspace, /class="modal-overlay reporting-status-workspace/);
assert.match(workspace, /id="reporting-status-workspace" aria-labelledby="reporting-status-title"/);
assert.doesNotMatch(workspace, /aria-modal="true"/);
assert.match(workspace, /data-modal-close/);
assert.match(workspace, /reporting-status-editor-label">\$\{isWeekly \? 'Результат недели' : 'Статус к выбранной встрече'\}/);
assert.match(workspace, /reporting-status-toolbar[\s\S]*reporting-readiness[\s\S]*data-save-reporting-all/);
assert.match(workspace, /data-lucide="alert-triangle"/);
assert.doesNotMatch(workspace, /data-lucide="circle-check"/);
assert.doesNotMatch(workspace, /reporting-preparation-head|reporting-status-savebar/);
assert.match(workspace, /previous_status/);
assert.match(workspace, /is_ready/);
assert.match(workspace, /data-reporting-readiness/);
assert.match(workspace, /data-reporting-team/);
assert.match(workspace, /aria-label="Показать лидеру трайба"/);
assert.match(workspace, /classList\.toggle\('is-active', event\.target\.checked\)/);
assert.doesNotMatch(directorateReportCss, /\.reporting-attention-toggle:focus-within \{ outline: 2px/);
assert.match(directorateReportCss, /\.reporting-attention-toggle:has\(input:focus-visible\) \{ outline: 2px/);
assert.match(workspace, /data-reporting-load-more/);
assert.match(workspace, /team_weekly: \{ label: 'Еженедельная встреча команды'/);
assert.match(workspace, /data-reporting-weekly-signal/);
assert.match(workspace, /data-reporting-weekly-next/);
assert.match(workspace, /data-reporting-weekly-decision/);
assert.match(workspace, /Следующий шаг/);
assert.match(workspace, /role="tabpanel"/);
assert.match(workspace, /tabindex="\$\{active \? '0' : '-1'\}"/);
assert.match(workspace, /recentlySavedIds\.add\(item\.task_id\)/);
assert.match(workspace, /function refreshSavedStatusCards\(taskIds\)/);
assert.match(workspace, /card\.outerHTML = renderStatusCard\(item, meeting\)/);
assert.match(workspace, /refreshSavedStatusCards\(\[taskId\]\)/);
assert.match(workspace, /refreshSavedStatusCards\(\(result\.items \|\| \[\]\)\.map\(saved => saved\.task_id\)\)/);
const singleSaveFlow = workspace.match(/async function saveTaskStatus[\s\S]*?\n}\n\nasync function saveStatusBatch/)?.[0] || '';
assert.doesNotMatch(singleSaveFlow, /renderPreparation\(/);
assert.match(workspace, /confirmAction\(/);
assert.doesNotMatch(workspace, /window\.confirm|window\.prompt/);
assert.match(reports, /source: 'report'/);
assert.match(didBacklog, /kind: 'did'/);
assert.match(filterToolbar, /bulkOpsTitle \|\| 'Массовые операции'/);
assert.match(teamBacklog, /bulkOpsTitle: 'Операции'/);
assert.match(teamBacklog, /bulkOpsMenu: true/);
assert.match(teamBacklog, /openBacklogOperationsMenu\(app\)/);
assert.match(teamBacklog, /Конструктор массовых изменений/);
assert.match(teamBacklog, /Статусы к отчётным встречам/);
assert.match(teamBacklog, /reportingStatusHref\(\{source:'team-backlog'\}\)/);
assert.doesNotMatch(teamBacklog, /reporting-status-entry/);
assert.match(teamBacklog, /backlog-bulk-selected'\)\?\.addEventListener\('click', \(\) => openBacklogBulkOps/);
assert.match(pagesCss, /\.reporting-meeting-tabs \{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
assert.match(pagesCss, /\.main-content:has\(> \.reporting-status-workspace\) \{[^}]*min-height:0;[^}]*overflow:clip/);
assert.match(pagesCss, /\.reporting-status-workspace \{[^}]*min-width:0;[^}]*padding:16px;[^}]*backdrop-filter:blur\(5px\)/);
assert.match(pagesCss, /\.reporting-status-dialog \{[^}]*grid-template-rows:auto minmax\(0,1fr\);[^}]*width:min\(100%,1540px\);[^}]*max-width:100%;[^}]*height:100%;[^}]*overflow:hidden/);
assert.match(pagesCss, /\.reporting-preparation \{[^}]*display:flex;[^}]*min-height:0;[^}]*overflow:hidden/);
assert.match(pagesCss, /\.reporting-task-status-list \{[^}]*flex:1 1 auto;[^}]*min-height:0;[^}]*overflow-y:auto/);
assert.match(pagesCss, /\.reporting-status-toolbar \{[^}]*grid-template-areas:"search team status result readiness bulk"/);
assert.match(pagesCss, /\.reporting-task-status \{[^}]*grid-template-areas:"head head" "previous editor" "footer footer";[^}]*grid-template-rows:auto 132px auto/);
assert.match(pagesCss, /\.reporting-status-editor \{[^}]*height:100%;[^}]*border:1px solid var\(--border-color\)/);
assert.match(pagesCss, /\.reporting-status-editor textarea\.input \{[^}]*height:100%;[^}]*resize:none;[^}]*border:0/);
assert.doesNotMatch(pagesCss, /\.reporting-status-savebar \{/);
assert.doesNotMatch(pagesCss, /\.reporting-task-status-list \{[^}]*max-height:min\(58vh/);
assert.match(pagesCss, /@media \(max-width: 820px\) \{[\s\S]*?\.reporting-status-dialog \{[^}]*height:100dvh;[^}]*border-radius:0/);
assert.match(pagesCss, /@media \(max-width: 820px\) \{[\s\S]*?\.reporting-meeting-tabs \{[^}]*scroll-snap-type:x proximity/);
assert.match(pagesCss, /@media \(max-width: 560px\) \{[\s\S]*?\.reporting-status-toolbar \{[^}]*grid-template-areas:"readiness" "search" "team" "status" "result" "bulk"/);
assert.match(pagesCss, /@media \(max-width: 820px\) \{[\s\S]*?\.reporting-task-status-list \{[^}]*overflow-y:auto/);
assert.match(workspace, /root\.closest\('\.main-content'\)/);
assert.match(workspace, /pageScroller\.scrollTop = 0/);
assert.match(workspace, /workspaceState\?\.listeners\?\.abort\(\)/);
assert.match(workspace, /\{ signal: listeners\.signal \}/);

console.log('reporting status workspace contracts passed');
