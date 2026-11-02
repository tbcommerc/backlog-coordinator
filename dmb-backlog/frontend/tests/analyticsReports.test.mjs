import assert from 'node:assert/strict';
import test from 'node:test';

import { readFileSync } from 'node:fs';
import { renderAnalytics } from '../js/components/analytics.js';

const analyticsSource = readFileSync(new URL('../js/components/analytics.js', import.meta.url), 'utf8');
const analyticsStyles = readFileSync(new URL('../css/analytics-lt.css', import.meta.url), 'utf8');
const appShell = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('LT analytics exposes the seven approved reports on one page', () => {
  const html = renderAnalytics('tribe', {});
  for (const title of [
    'Трудозатраты по типам задач', 'Профиль команд', 'Карта зависимостей',
    'Поток задач', 'Проекты по кварталам', 'Проект 360°',
    'Трудозатраты и финансовый эффект',
  ]) assert.match(html, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('LT analytics uses one report shell, numbered headings and local navigation', () => {
  const html = renderAnalytics('tribe', {});
  assert.match(html, /class="an-report-nav"/);
  assert.match(html, /class="view-state view-state-loading content-loading-state"[^>]*role="status" aria-busy="true"/);
  for (let index = 1; index <= 7; index += 1) {
    const number = String(index).padStart(2, '0');
    assert.match(html, new RegExp(`data-report-index="${number}"`));
    assert.match(html, new RegExp(`class="an-report-index"[^>]*>${number}<`));
  }
  assert.equal((html.match(/\ban-report\b/g) || []).length >= 7, true);
  assert.match(analyticsSource, /function bindAnalyticsNavigation\(\)/);
  assert.match(analyticsSource, /requestAnimationFrame/);
});

test('sticky analytics navigation reaches the scrollport top without a translucent gap', () => {
  assert.match(analyticsStyles, /\.main-content:has\(> \.an-page\)\s*\{\s*padding-top:0/);
  assert.match(analyticsStyles, /\.an-page\s*\{[\s\S]*?padding-top:var\(--space-8\)/);
  assert.match(analyticsStyles, /\.an-report-nav\s*\{[\s\S]*?top:0;[\s\S]*?padding:8px;[\s\S]*?border:1px solid var\(--border-color\);[\s\S]*?border-radius:0 0 var\(--radius-lg\) var\(--radius-lg\);[\s\S]*?background:var\(--bg-primary\)/);
  assert.doesNotMatch(analyticsStyles, /--an-page-gutter|width:calc\(100% \+ 2 \*/);
  assert.doesNotMatch(analyticsStyles, /\.an-report-nav\s*\{[\s\S]*?backdrop-filter/);
});

test('LT analytics shares controls and table primitives without the overflowing period segment', () => {
  const html = renderAnalytics('tribe', {});
  assert.match(html, /id="effort-period"/);
  assert.doesNotMatch(html, /effortPeriodSeg|effort-period-seg/);
  assert.match(html, /class="[^"]*rep-table an-table an-table--standard"/);
  assert.match(html, /class="[^"]*dep-table an-table an-table--compact"/);
  assert.match(html, /class="roi-tree-table[^"]*" role="table"/);
  assert.doesNotMatch(html, /class="an-display-settings"|Настройки отображения/);
  assert.match(analyticsStyles, /ЕДИНАЯ СИСТЕМА ОТЧЁТОВ АНАЛИТИКИ/);
  assert.match(analyticsStyles, /\.kpi-val,\s*\.dc-num\s*\{\s*font-family:var\(--font-family\)/);
});

test('task flow report opens task detail for nodes and links', () => {
  const html = renderAnalytics('tribe', {});
  assert.match(html, /id="sankey-chart"/);
  assert.match(html, /id="sankey-detail" class="an-detail"/);
  assert.match(analyticsSource, /showDetail\('sankey-detail'/);
  assert.match(analyticsSource, /p\.dataType === 'edge'/);
  assert.match(analyticsSource, /nodes\[id\]\.tasks\.push\(t\)/);
});

test('effort and dependency reports keep the original dashboard design', () => {
  const html = renderAnalytics('tribe', {});
  const dependencyReport = html.match(/<section class="[^"]*" id="an-dep"[\s\S]*?<\/section>/)?.[0] || '';
  for (const className of [
    'effort-report', 'rep-card', 'donut', 'rep-table',
    'skp-chart--map', 'dep-layout', 'dep-table',
  ]) assert.match(html, new RegExp(`class="[^"]*\\b${className}\\b`));

  for (const id of ['dep-period', 'dep-type', 'dep-mode', 'dep-threshold']) assert.match(dependencyReport, new RegExp(`id="${id}"`));
  assert.doesNotMatch(dependencyReport, /an-display-settings|Настройки отображения/);
  assert.doesNotMatch(analyticsStyles, /#an-dep \.an-report-toolbar \.an-control select/);
  assert.doesNotMatch(html, /dep-team-chips|dep-kpis|Задач в кооперации|Уникальных взаимосвязей|Самая частая пара/);
  assert.doesNotMatch(analyticsSource, /state\.dep\.teams/);

  assert.match(analyticsSource, /layout:\s*'none'/);
  assert.match(analyticsSource, /roam:\s*false/);
  assert.match(analyticsSource, /edgeLabel:\s*\{/);
  assert.match(analyticsSource, /edgeLabel:\s*\{[^}]*position:\s*'middle'[^}]*distance:\s*0[^}]*fontSize:\s*11[^}]*textBorderWidth:\s*3/);
  assert.doesNotMatch(analyticsSource, /edgeLabel:\s*\{[^}]*padding:\s*\[2, 4\]/);
  assert.match(analyticsSource, /function dependencyGraphLayout\(nodes = \[\]\)/);
  assert.match(analyticsSource, /width:\s*Math\.round\(size\)/);
  assert.match(analyticsSource, /height:\s*Math\.round\(size\)/);
  assert.match(analyticsSource, /top:\s*Math\.round\(topSpace \+ \(availableHeight - size\) \/ 2\)/);
  assert.match(analyticsSource, /charts\['dep-chart'\]\.setOption/);
  assert.match(analyticsSource, /topSpace\s*=\s*Math\.ceil\(radius \+ verticalSpace\('top'\) \+ 22\)/);
  assert.match(analyticsSource, /bottomSpace\s*=\s*Math\.ceil\(radius \+ verticalSpace\('bottom'\) \+ 22\)/);
  assert.match(analyticsSource, /dependencyGraphLayout\(nodes\)/);
  assert.match(html, /Команда<br>привлекает/);
  assert.match(html, /Привлекают<br>команду/);
  assert.doesNotMatch(html, /Топ взаимосвязей|Статистика по командам/);
  assert.match(analyticsSource, /dep-bar-track/);
  assert.match(analyticsSource, /const focusDependencyTeam/);
  assert.match(analyticsSource, /addEventListener\('mouseenter', \(\) => \{ if \(!pinnedDependencyTeam\) focusDependencyTeam/);
  assert.match(analyticsSource, /lineStyle:\s*\{ \.\.\.link\.lineStyle, opacity:/);
  assert.match(analyticsSource, /dep-row-active/);
  assert.match(analyticsStyles, /tr:hover,\.dep-table tbody tr\.dep-row-active/);
  assert.match(analyticsSource, /let pinnedDependencyTeam = ''/);
  assert.match(analyticsSource, /pinnedDependencyTeam === el\.dataset\.team \? '' : el\.dataset\.team/);
  assert.match(analyticsSource, /focusDependencyTeam\(pinnedDependencyTeam\)/);
  assert.match(analyticsSource, /const renderDependencyDetail = team =>/);
  assert.match(analyticsSource, /id="dep-detail" class="an-detail dep-lower-detail"/);
  assert.doesNotMatch(analyticsSource, /dep-expanded-row|anchorRow\.after\(expandedRow\)/);
  assert.match(analyticsSource, />Кто кого привлекает</);
  assert.match(analyticsSource, /Совместные проекты/);
  assert.match(analyticsSource, /data-dep-direction/);
  assert.match(analyticsSource, /data-dep-project/);
  assert.doesNotMatch(analyticsSource, /showDetail\('dep-detail', el\.dataset\.team/);
  assert.match(analyticsStyles, /tr\.dep-row-selected/);
  assert.match(analyticsSource, /index === 0 \? 'open' : ''/);
  assert.match(analyticsSource, /data-project-groups-action="expand"[^>]*>[\s\S]*?<span>Раскрыть все<\/span>/);
  assert.match(analyticsSource, /data-project-groups-action="collapse"[^>]*>[\s\S]*?<span>Свернуть все<\/span>/);
  assert.match(analyticsSource, /group\.open = open/);
  assert.match(analyticsStyles, /\.an-project-group-controls/);
});

test('dependency report follows the compact geometry of the source reference', () => {
  assert.match(analyticsStyles, /\.dep-layout\{[^}]*grid-template-columns:minmax\(0,1\.1fr\) minmax\(420px,\.9fr\)/);
  assert.match(analyticsStyles, /\.skp-chart--map\{height:auto;min-height:420px;max-height:560px;aspect-ratio:5\/4\}/);
  assert.match(analyticsStyles, /@media\(max-width:1100px\)\{\.dep-layout\{grid-template-columns:1fr\}\}/);
  assert.match(analyticsSource, /const symbolSize = 10 \+ Math\.sqrt\(nodeTotal \/ maxNodeTotal\) \* 22/);
  assert.match(analyticsSource, /function dependencyEdgeTier\(count\)/);
  assert.match(analyticsSource, /count >= 10\) return \{ width: 6, arrowSize: 17 \}/);
  assert.match(analyticsSource, /count >= 5\) return \{ width: 4, arrowSize: 13 \}/);
  assert.match(analyticsSource, /return \{ width: 2, arrowSize: 10 \}/);
  assert.match(analyticsSource, /width: tier\.width, cap: 'round', join: 'round'/);
  assert.doesNotMatch(analyticsSource, /dependencyVisualScale/);
  assert.match(analyticsSource, /'Post-Trade \(Products & Service\)': 'Post-Trade \(P&S\)'/);
});

test('effort report keeps a short table aligned to the top of its chart column', () => {
  assert.match(analyticsStyles, /\.effort-report \.table-wrap\{align-self:start\}/);
});

test('analytics period filters mark the current period consistently', () => {
  assert.match(analyticsSource, /function periodOption\(period, selected = '', activePeriod = ltData\?\.active_period\)/);
  assert.match(analyticsSource, /period\.id === activePeriod/);
  assert.match(analyticsSource, /an-period-current/);
  assert.match(analyticsSource, / · текущий/);
  assert.match(analyticsSource, /periodOptions\.map\(period => periodOption\(period, state\.projectFlowPeriod\)\)/);
  assert.match(analyticsStyles, /option\.an-period-current\{[^}]*font-weight:700/);
});

test('analytics owns filter width while the kit owns control height', () => {
  const filterRule = analyticsStyles.match(/\.an-control select,\s*\.roi-toolbar select,\s*\.p360-flow-toolbar select,\s*\.dd-btn,\s*\.an-filter-button\s*\{([^}]*)\}/)?.[1];
  assert.ok(filterRule);
  assert.match(filterRule, /width:180px;[\s\S]*?min-width:180px;[\s\S]*?max-width:180px;/);
  assert.doesNotMatch(filterRule, /(?:height|padding|font-size|line-height):/);
  assert.match(analyticsStyles, /\.p360-project-control\{min-width:310px\}/);
  assert.match(analyticsStyles, /\.p360-project-search\{[^}]*width:min\(42vw,520px\)/);
  assert.doesNotMatch(analyticsStyles, /#an-dep \.an-report-toolbar \.an-control select/);
});

test('PO/PL analytics contains quality reports and no legacy workload reports', () => {
  const html = renderAnalytics('po-pl', {});
  assert.match(html, /Полнота карточек/);
  assert.match(html, /id="complete-period"/);
  assert.match(html, /Конфликты качества/);
  assert.match(html, /Однородность ведения/);
  assert.doesNotMatch(html, /Нагрузка PO|Сроки исполнения|Полнота атрибутов/);
});

test('PO/PL completeness report filters tasks by the selected period', () => {
  assert.match(analyticsSource, /complete:\s*\{ period: '' \}/);
  assert.match(analyticsSource, /poData\.tasks\.filter\(task => inPeriod\(task, state\.complete\.period\)\)/);
  assert.match(analyticsSource, /<option value="">Все периоды<\/option>' \+ periodOptions\(state\.complete\.period, poData\)/);
  assert.match(analyticsSource, /bindSelect\('complete-period', state\.complete\.period, value => \{ state\.complete\.period = value; renderCompleteness\(\); \}\)/);
});

test('PO/PL completeness matrix separates task counts and constrains every column', () => {
  assert.match(analyticsSource, /class="[^"]*an-table an-matrix an-completeness-matrix" style="--profile-columns:\$\{completenessFields\.length \+ 2\}"/);
  assert.match(analyticsSource, /<col class="an-team-column"><col class="an-count-column">/);
  assert.match(analyticsSource, /<th class="an-number">Количество задач<\/th>/);
  assert.match(analyticsSource, /<th title="\$\{escapeHtml\(team\)\}">\$\{escapeHtml\(team\)\}<\/th><td class="an-number an-task-count">\$\{ts\.length\}<\/td>/);
  assert.match(analyticsStyles, /\.an-completeness-matrix\{width:max\(100%,1040px\)\}/);
  assert.match(analyticsStyles, /\.an-completeness-matrix \.an-team-column\{width:180px\}/);
  assert.match(analyticsStyles, /\.an-completeness-matrix \.an-count-column\{width:90px\}/);
  assert.match(analyticsStyles, /\.an-completeness-matrix \.an-number-column\{width:77px\}/);
  assert.match(analyticsStyles, /\.an-completeness-matrix thead th:not\(:first-child\)\{white-space:normal;overflow-wrap:anywhere/);
  assert.match(analyticsStyles, /\.an-matrix th:first-child\{[^}]*overflow:hidden[^}]*text-overflow:ellipsis/);
});

test('LT analytics does not render the removed summary KPI tiles', () => {
  const html = `${renderAnalytics('tribe', {})}${renderAnalytics('po-pl', {})}`;
  assert.doesNotMatch(html, /\ban-kpi\b/);
  assert.doesNotMatch(html, /\bkpi-grid\b/);
  assert.doesNotMatch(html, /\bskp-kpis\b/);
  assert.doesNotMatch(html, /Всего задач в срезе|Трудозатраты, чел\.-дней|Задач с оценкой трудозатрат|Крупнейший тип/);
  assert.doesNotMatch(analyticsSource, /\bkpis\s*\(/);
  assert.doesNotMatch(analyticsSource, /(?:profile|sankey|quarter|roi|complete|quality)-kpi/);
});

test('analytics requests use the backend task-router prefix', () => {
  assert.match(analyticsSource, /\/tasks\/analytics\/lt-reports/);
  assert.match(analyticsSource, /\/tasks\/analytics\/po-pl-reports/);
  assert.doesNotMatch(analyticsSource, /api\.get\('\/analytics\//);
});

test('team profile keeps equal numeric columns and shows each type share within the team', () => {
  assert.match(analyticsSource, /style="--profile-columns:\$\{types\.length \+ 1\}"/);
  assert.match(analyticsSource, /<col class="an-team-column">\$\{types\.map\(\(\) => '<col class="an-number-column">'\)/);
  assert.match(analyticsSource, /<th class="an-number">\$\{escapeHtml\(x\)\}<\/th>/);
  assert.match(analyticsSource, /<th class="an-number">Всего<\/th>/);
  assert.match(analyticsSource, /<td class="an-cell an-number \$\{count \? 'is-actionable' : 'is-empty'\}"/);
  assert.match(analyticsSource, /const teamTasks = tasks\.filter/);
  assert.match(analyticsSource, /share = pct\(count, teamTotal\)/);
  assert.match(analyticsSource, /data-share="\$\{share\}"/);
  assert.match(analyticsSource, /class="an-profile-share">\$\{share\}<\/small>/);
  assert.match(analyticsSource, /class="an-number an-profile-total"/);
  assert.match(analyticsSource, /class="an-profile-share">100%<\/small>/);
  assert.match(analyticsSource, /class="an-profile-count">\$\{count \|\| '—'\}<\/strong>/);
  assert.doesNotMatch(analyticsSource, /class="an-profile-count">\$\{count \|\| '·'\}<\/strong>/);
  assert.match(analyticsStyles, /\.an-profile-value\{/);
  assert.match(analyticsStyles, /\.an-profile-share\{/);
  assert.match(analyticsStyles, /\.an-matrix \.an-number\{text-align:center;font-variant-numeric:tabular-nums\}/);
  assert.match(analyticsStyles, /\.an-matrix \.an-team-column\{width:220px\}/);
  assert.match(analyticsStyles, /\.an-matrix \.an-number-column\{width:140px\}/);
});

test('task flow supports calm loading, connected-node focus and filter-sized column swapping', () => {
  const html = renderAnalytics('tribe', {});
  assert.doesNotMatch(html, /sankey-reset|Сбросить узел/);
  assert.match(html, /<button[^>]*class="[^"]*ui-btn an-filter-button"[^>]*id="sankey-swap"[^>]*><span>Команда ↔ Тип задачи/);
  assert.doesNotMatch(html, /sankey-sort-(?:department|team|type)|an-display-settings|Настройки отображения/);
  assert.doesNotMatch(analyticsSource, /state\.sankey\.sort/);
  assert.match(analyticsSource, /animation:\s*false/);
  assert.match(analyticsSource, /layoutIterations:\s*0/);
  assert.match(analyticsSource, /related\.add\(link\.source\); related\.add\(link\.target\)/);
  assert.match(analyticsSource, /opacity:\s*related\.has\(x\.name\) \? 1 : \.14/);
  assert.match(analyticsSource, /const opening = state\.sankey\.pin !== p\.name/);
  assert.match(analyticsSource, /state\.sankey\.swapColumns = !state\.sankey\.swapColumns/);
  assert.match(analyticsStyles, /\.an-filter-button\s*\{[\s\S]*?text-align:center;[\s\S]*?white-space:nowrap/);
  assert.doesNotMatch(analyticsStyles, /\.sankey-order|\.an-display-settings/);
});

test('team profile hover preserves heat-map cell backgrounds', () => {
  assert.match(analyticsStyles, /\.an-table:not\(\.an-matrix\) tbody tr:hover>\*/);
  assert.match(analyticsStyles, /\.an-matrix tbody tr:hover>\*\{box-shadow:/);
  assert.doesNotMatch(analyticsStyles, /\.an-matrix tbody tr:hover>\*\{[^}]*background:/);
  assert.match(analyticsStyles, /\.an-matrix tbody tr:hover>\*:first-child\{box-shadow:inset 3px 0 var\(--accent\)/);
  assert.doesNotMatch(analyticsStyles, /\.an-matrix tbody tr:hover>\*\{[^}]*--primary-color/);
  assert.match(appShell, /analytics-lt\.css\?v=\d+/);
});

test('Project 360 follows the tribe dashboard reference composition', () => {
  const html = renderAnalytics('tribe', {});
  for (const section of [
    'Контур ответственности', 'Структура работ', 'Управленческие сигналы',
    'Основная команда', 'Все сроки', 'Весь спрос', 'Задачи', 'Трудозатраты',
  ]) assert.match(analyticsSource, new RegExp(section));
  const projectSearch = html.match(/<input[^>]*id="project-search"[^>]*>/)?.[0];
  assert.ok(projectSearch);
  assert.match(projectSearch, /type="search"/);
  assert.match(projectSearch, /list="project-options"/);
  assert.match(html, /<datalist id="project-options"><\/datalist>/);
  assert.match(analyticsSource, /p360-accordion/);
  assert.match(analyticsSource, /name="p360-sections"/);
  assert.match(analyticsSource, /data-p360-section="flow"/);
  assert.match(analyticsSource, /getBoundingClientRect\(\)\.top - top/);
  assert.match(analyticsSource, /window\.scrollBy\(0, delta\)/);
  assert.match(analyticsSource, /p360-flow-svg/);
  assert.match(analyticsSource, /p360-flow-actions/);
  assert.match(analyticsSource, /p360-mixbar/);
  assert.match(analyticsSource, /p360-team-mixes/);
  assert.match(analyticsSource, /p360-timeline-detail/);
  assert.match(analyticsSource, /p360-band-involved/);
  assert.match(analyticsSource, /p360-flow-filter-state/);
  assert.match(analyticsSource, /p360-flow-detail/);
  assert.match(analyticsSource, /Пиковый квартал/);
  assert.match(analyticsSource, /Просроченных незавершённых задач нет/);
  assert.match(analyticsSource, /трудозатрат.*с вовлечением других команд/);
  assert.match(analyticsSource, /По бизнес-плану/);
  assert.match(analyticsSource, /Внеплановый/);
  assert.doesNotMatch(analyticsSource, /p360-summary-grid|data-p360-summary|p360-toggle-empty|p360-flow-chart/);
  assert.match(analyticsSource, /b\.tasks\.length - a\.tasks\.length/);
  assert.match(analyticsSource, /toLocaleLowerCase\('ru'\)/);
  assert.match(analyticsSource, /n\(task\.effort_days\) \/ Math\.max\(1, projectPeriods\.length\)/);
  assert.doesNotMatch(analyticsSource, /PROJECT_HEALTH|Траектория здоровья/);
});

test('report 7 follows tribe-backlog-dashboard ROI quadrant', () => {
  const html = renderAnalytics('tribe', {});
  assert.match(html, /data-report-index="07"/);
  assert.match(html, /<h2>Трудозатраты и финансовый эффект<\/h2>/);
  assert.match(html, /id="roi-count"/);
  assert.match(html, /id="roi-legend"/);
  assert.match(html, /id="roi-period"/);
  assert.match(html, /id="roi-team"/);
  assert.match(html, /id="roi-type"/);
  assert.match(html, /id="roi-svg"[^>]*viewBox="0 0 940 496"/);
  assert.match(html, /id="roi-table-body"/);
  assert.match(analyticsSource, /class="roi-task-row"/);
  assert.match(analyticsSource, /class="roi-team-row is-collapsed"/);
  assert.match(analyticsSource, /class="ui-surface-action roi-team-toggle"/);
  assert.match(analyticsSource, /class="ui-surface-action roi-project-toggle"/);
  for (const quadrant of ['Дёшево и ценно', 'Дорого, но ценно', 'Дёшево и не ценно', 'Дорого и не ценно']) assert.match(analyticsSource, new RegExp(quadrant));
  assert.match(analyticsSource, /размер круга — фин\. эффект/);
  assert.doesNotMatch(analyticsSource, /roi-dot.*is-dim/);
});

test('analytics detail uses one accessible task table and progressive project groups', () => {
  assert.match(analyticsSource, /function clearDetail\(/);
  assert.match(analyticsSource, /function bindAnalyticsDetailEscape\(/);
  assert.match(analyticsSource, /aria-label="Закрыть детализацию"/);
  assert.match(analyticsSource, /class="an-detail-trail"/);
  assert.match(analyticsSource, /class="an-task-list-head[^"]*" role="row"/);
  assert.match(analyticsSource, /<span>Статус<\/span><span>Срок<\/span><span>Трудозатраты<\/span>/);
  assert.match(analyticsSource, /groups\.length === 1/);
  assert.match(analyticsStyles, /\.an-project-groups\{max-height:520px;overflow:auto/);
  assert.match(analyticsStyles, /\.an-task-list-head\{position:sticky/);
  assert.match(analyticsSource, /class="an-tree-toggle-icon"/);
  assert.match(analyticsSource, /class="an-tree-actions"/);
  assert.match(analyticsSource, /class="an-tree-entity"><small>Проект<\/small>/);
  assert.match(analyticsStyles, /\.an-project-groups details\[open\]>summary\{box-shadow:inset 3px 0 var\(--accent\)/);
  assert.match(analyticsStyles, /\.an-tree-children::before\{/);
});

test('analytics detail is synchronized with filters and only non-empty matrix cells are actionable', () => {
  for (const id of ['effort-detail', 'profile-detail', 'dep-detail', 'sankey-detail', 'quarter-detail', 'project-detail']) {
    assert.match(analyticsSource, new RegExp(`clearDetail\\('${id}'`));
  }
  assert.match(analyticsSource, /\.an-cell\.is-actionable/);
  assert.match(analyticsSource, /aria-disabled="true"/);
  assert.match(analyticsSource, /bindDetailCell\(el, 'profile-detail'/);
  assert.match(analyticsSource, /bindDetailCell\(el, 'quarter-detail'/);
});

test('Project 360 renders quarter detail inline from structured period data', () => {
  assert.match(analyticsSource, /const period = quarters\.find\(item => item\.id === state\.projectQuarter\)/);
  assert.match(analyticsSource, /showDetail\('p360-timeline-detail'/);
  assert.match(analyticsSource, /autoScroll: false/);
  assert.match(analyticsSource, /class="an-detail p360-flow-detail"/);
});

test('ROI uses one progressive inline hierarchy without a hidden fifty-project cap', () => {
  const html = renderAnalytics('tribe', {});
  assert.doesNotMatch(html, /id="roi-detail"/);
  assert.doesNotMatch(analyticsSource, /slice\(0, 50\)/);
  assert.match(analyticsSource, /class="roi-team-row is-collapsed" data-roi-parent/);
  assert.match(analyticsSource, /class="roi-task-row" data-roi-parent/);
  assert.match(analyticsSource, /setRoiProjectOpen\(row, true\)/);
  assert.match(analyticsSource, /class="roi-level-label">Проект<\/span>/);
  assert.match(analyticsSource, /class="roi-level-label">Команда<\/span>/);
  assert.match(analyticsSource, /class="roi-level-label">Задача<\/span>/);
  assert.match(analyticsStyles, /\.roi-chevron::after\{/);
  assert.match(analyticsSource, /id="roi-expand-all"/);
  assert.match(analyticsSource, /id="roi-collapse-all"/);
  assert.match(analyticsSource, /const setRoiTeamOpen =/);
  assert.match(analyticsStyles, /\.roi-tree-table\{border-radius:8px;background:var\(--bg-secondary\)/);
  assert.match(analyticsSource, /class="roi-project-children an-tree-children"/);
  assert.match(analyticsSource, /class="roi-team-children an-tree-children"/);
  assert.match(analyticsStyles, /\.roi-tree-head,\.roi-project-row,\.roi-team-row,\.roi-task-row\{display:grid/);
  assert.match(analyticsStyles, /\.roi-tree-table \.an-tree-children::before\{/);
});
