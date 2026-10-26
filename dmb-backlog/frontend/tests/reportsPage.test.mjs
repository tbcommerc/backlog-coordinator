import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bindReportCardNavigation, renderReports, renderReportingMeetingsManagement, renderQuarterlyTeamSummary, renderTeamWeeklyReport, summarizeQuarterlyTeams } from '../js/components/reports.js';

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
assert.match(page, /class="cursor-pointer grad-violet report-card"[^>]*role="link"[^>]*tabindex="0"/);
assert.doesNotMatch(page, /id="count-directorate">0<\/div>/);
assert.match(page, /Светофоры по квартальным целям/);
assert.match(page, /Статус квартальных целей и AD-HOC-задач команд трайба/);
const quarterlyGoalsCard = page.match(/<div class="cursor-pointer grad-cyan report-card"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)?.[0] || '';
assert.match(quarterlyGoalsCard, /data-report="quarterly-goals"/);
assert.doesNotMatch(quarterlyGoalsCard, /В разработке/);
assert.doesNotMatch(page, /Прогресс по задачам/);
assert.doesNotMatch(page, /id="reporting-meetings-panel"/);
assert.match(page, /class="team-weekly-feature report-card" data-report="team-weekly"/);
assert.match(page, /Еженедельная встреча команды/);
assert.match(page, /class="report-count" id="count-team-weekly"[^>]*aria-label="Загрузка количества задач"/);

const weeklyMarkup = renderTeamWeeklyReport({
  meeting: { id: 77, scheduled_date: '2026-09-14', week_end: '2026-09-20' },
  teams: [{ id: 3, name: 'Платформа' }],
  items: [{
    task_id: 11, public_id: 'TASK-011', title: 'Новый сценарий', team_id: 3,
    project_name: 'Личный кабинет', owner_name: 'Анна', status_name: 'В работе',
    progress: 70, progress_delta: 20, result: 'Завершили прототип', next_step: 'Провести пилот',
    next_step_due: '2026-09-18', decision_request: 'Подтвердить объём пилота', signal: 'decision',
    is_ready: true, is_completed_this_week: false,
  }],
});
assert.match(weeklyMarkup, /Пульс команды/);
assert.match(weeklyMarkup, /Завершили прототип/);
assert.match(weeklyMarkup, /Подтвердить объём пилота/);
assert.match(weeklyMarkup, /\+20 п\.п\./);
assert.match(weeklyMarkup, /Обновить пульс/);

const teamSummary = summarizeQuarterlyTeams([
  { team_name: 'Команда А', progress_indicator: 'green', progress_freshness: 'current' },
  { team_name: 'Команда А', progress_indicator: 'red', progress_freshness: 'missing' },
  { team_name: 'Команда Б', progress_indicator: 'yellow', progress_freshness: 'current' },
  { team_name: 'Команда Б', progress_indicator: 'red', progress_freshness: 'current' },
]);
assert.deepEqual(teamSummary.map(item => [item.name, item.green, item.yellow, item.red, item.confirmedAttention, item.dataIssues]), [
  ['Команда Б', 0, 1, 1, 2, 0],
  ['Команда А', 1, 0, 1, 0, 1],
]);
const teamSummaryMarkup = renderQuarterlyTeamSummary([
  { team_name: 'Команда А', progress_indicator: 'green', progress_freshness: 'current', planned_progress: 60, progress: 70 },
  { team_name: 'Команда А', progress_indicator: 'red', progress_freshness: 'missing', planned_progress: 80, progress: null },
]);
assert.match(teamSummaryMarkup, /Сводка по командам/);
assert.match(teamSummaryMarkup, /Средний план/);
assert.match(teamSummaryMarkup, /Средний факт/);
assert.match(teamSummaryMarkup, /Подтверждённое отставание/);
assert.match(teamSummaryMarkup, /Проблемы данных/);
assert.match(teamSummaryMarkup, /Команда А/);
assert.match(reportsSource, /Сводка по командам/);
assert.match(reportsSource, /Детализация целей и AD-HOC/);
assert.match(reportsSource, /'start_shift_name','planned_progress','progress','progress_deviation_percent','progress_indicator','progress_freshness_label'/);
assert.match(reportsSource, /id="progress-green"/);
assert.match(reportsSource, /id="progress-red-context"/);
assert.match(reportsSource, /Качество данных отчёта/);
assert.match(reportsSource, /class="quarterly-report-top"/);
assert.match(reportsSource, /class="quarterly-kpis" id="progress-widgets"/);
assert.match(reportsSource, /class="ui-surface-action quarterly-kpi progress-widget"/);
assert.doesNotMatch(reportsSource, /class="dashboard-stats" id="progress-widgets"/);
assert.match(reportsSource, /Отчёт не зарегистрирован в системе/);
assert.doesNotMatch(reportsSource, /if \(!rep\) \{\s*renderPlaceholderReport/);

const management = renderReportingMeetingsManagement({});
assert.match(management, /Управление отчётными встречами/);
assert.match(management, /id="reporting-meetings-panel"/);
assert.match(management, /class="meeting-status-help"/);
assert.match(management, /Как работают отчётные статусы/);
assert.ok(management.indexOf('meeting-status-help') < management.indexOf('reporting-meetings-panel'));
assert.doesNotMatch(management, /Календарь отчётных встреч/);

assert.match(reportsSource, /if \(!data\.teams\.length\) \{[\s\S]*renderReportTable\(\[\], config\.fields\)/);
assert.doesNotMatch(reportsSource, /if \(!list \|\| !list\.length\) return/);
assert.match(reportsSource, /function setReportCountLoading\(\)/);
assert.match(reportsSource, /bindReportCardNavigation\(app\);\s*setReportCountLoading\(\);\s*try \{/);
assert.doesNotMatch(reportsSource, /querySelectorAll\('\.report-card'\)\.forEach/);

const listeners = {};
const reportCard = { dataset: { report: 'directorate' } };
const root = {
  dataset: {},
  addEventListener(type, handler) { listeners[type] = handler; },
  contains(card) { return card === reportCard; },
};
const target = { closest(selector) { return selector === '.report-card' ? reportCard : null; } };
const navigations = [];
const navigationApp = { router: { navigate(path) { navigations.push(path); } } };
assert.equal(bindReportCardNavigation(navigationApp, root), true);
assert.equal(bindReportCardNavigation(navigationApp, root), false);
listeners.click({ target });
let prevented = false;
listeners.keydown({ target, key: 'Enter', preventDefault() { prevented = true; } });
assert.deepEqual(navigations, ['/reports/detail?r=directorate', '/reports/detail?r=directorate']);
assert.equal(prevented, true);
