import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canUseQuarterlyGoalsUpdate,
  quarterlyGoalsUpdateHref,
  renderQuarterlyGoalsUpdate,
} from '../js/components/quarterlyGoalsUpdate.js';

const componentSource = await readFile(new URL('../js/components/quarterlyGoalsUpdate.js', import.meta.url), 'utf8');
const reportsSource = await readFile(new URL('../js/components/reports.js', import.meta.url), 'utf8');
const backlogSource = await readFile(new URL('../js/components/taskTable.js', import.meta.url), 'utf8');
const teamBacklogSource = await readFile(new URL('../js/components/teamBacklog.js', import.meta.url), 'utf8');
const routerSource = await readFile(new URL('../js/router.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
const pagesCss = await readFile(new URL('../css/pages.css', import.meta.url), 'utf8');

const appFor = currentUser => ({ store: { get: key => key === 'currentUser' ? currentUser : null } });
assert.equal(canUseQuarterlyGoalsUpdate(appFor({ team_id: 7, role_name: 'PO/PL/CL' })), true);
assert.equal(canUseQuarterlyGoalsUpdate(appFor({ team_id: 7, role_name: 'BA/Участник команды' })), true);
assert.equal(canUseQuarterlyGoalsUpdate(appFor({ permissions: { admin: 'full' } })), true);
assert.equal(canUseQuarterlyGoalsUpdate(appFor({ team_id: 8, role_name: 'Заказчик' })), false);
assert.equal(canUseQuarterlyGoalsUpdate(appFor({ role_name: 'PO/PL/CL' })), false);
assert.equal(quarterlyGoalsUpdateHref({ source: 'backlog' }), '#/quarterly-goals-update?source=backlog');

const page = renderQuarterlyGoalsUpdate();
assert.match(page, /Обновить прогресс и статусы/);
assert.match(componentSource, /\/reports\/quarterly-goals\/preparation/);
assert.match(componentSource, /\/reports\/quarterly-goals\/tasks\/\$\{taskId\}/);
assert.match(componentSource, /type="range" min="0" max="100" step="5"/);
assert.match(componentSource, /quarterly-update-fact-value/);
assert.match(componentSource, /--quarterly-progress/);
assert.doesNotMatch(componentSource, /class="quarterly-fact-value"/);
assert.doesNotMatch(componentSource, /data-quarterly-toggle-fact/);
assert.doesNotMatch(componentSource, /quarterly-fact-toggle/);
assert.match(componentSource, /node\.disabled = !item\.can_edit/);
assert.match(componentSource, /if \(item && draft\.progress == null\)/);
assert.match(pagesCss, /\.quarterly-update-fact-value output/);
assert.match(pagesCss, /\.quarterly-fact-control input\[type="range"\]::-webkit-slider-runnable-track/);
assert.match(componentSource, /Старт в квартале/);
assert.match(componentSource, /data-quarterly-card-list/);
assert.match(componentSource, /data-shift-id/);
assert.match(componentSource, /quarterly-update-summary/);
assert.doesNotMatch(componentSource, /<table class="data-table quarterly-update-table"/);
assert.doesNotMatch(componentSource, /function renderRow/);
assert.match(componentSource, /saveQueues: new Map\(\)/);
assert.match(componentSource, /processSaveQueue/);
assert.match(componentSource, /aria-label="Поиск по задачам квартала"/);
assert.match(componentSource, /aria-valuetext/);
assert.doesNotMatch(page, /aria-modal="true"/);
assert.match(reportsSource, /Обновить прогресс и статусы/);
assert.match(backlogSource, /bulkOpsMenu: true/);
assert.match(backlogSource, /openBacklogOperationsMenu\(app\)/);
assert.match(backlogSource, /data-backlog-operation="quarterly-goals"/);
assert.match(backlogSource, /Обновить прогресс и статусы/);
assert.match(backlogSource, /quarterlyGoalsUpdateHref\(\{ source: 'backlog' \}\)/);
assert.match(teamBacklogSource, /data-team-operation="quarterly-goals"/);
assert.match(teamBacklogSource, /Обновить прогресс и статусы/);
assert.match(routerSource, /'\/quarterly-goals-update':/);

const taskLiveRefreshRoutes = appSource.match(/task: new Set\(\[([^\]]*)\]\)/s)?.[1] || '';
const reportLiveRefreshRoutes = appSource.match(/report: new Set\(\[([^\]]*)\]\)/s)?.[1] || '';
assert.doesNotMatch(taskLiveRefreshRoutes, /quarterly-goals-update/);
assert.doesNotMatch(reportLiveRefreshRoutes, /quarterly-goals-update/);
