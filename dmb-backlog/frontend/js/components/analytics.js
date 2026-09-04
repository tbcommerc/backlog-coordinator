import { escapeHtml } from '../htmlUtils.js';
import { formatTaskPublicId } from '../taskPublicId.js';

const charts = {};
let ltData = null;
let poData = null;
const LT_TYPE_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#8b5cf6', '#0ea5e9', '#f43f5e', '#94a3b8', '#14b8a6', '#f97316', '#ec4899'];
const LT_MAP_COLORS = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#6366f1', '#14b8a6', '#f97316', '#ec4899'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const state = {
  effort: { period: '', team: '', sortCol: 'share', sortDir: -1, rows: [], arcs: [] }, profile: { period: '', channel: '' },
  dep: { period: '', type: '', threshold: 1, mode: 'directed' },
  sankey: { period: '', channel: '', mode: 'tasks', pin: '', swapColumns: false },
  quarters: { teams: [], types: [] }, project: '', projectMetric: 'count', projectFlowPeriod: '', projectFlowChannel: '', projectQuarter: '', projectOpenSection: '', projectFlowSelection: null, roi: { period: '', team: '', type: '', quad: '' }, complete: { period: '' }
};

export function isRiskStatus(s) { return ['ХОЛД', 'ЭСКАЛАЦИЯ НА ЛТ'].includes(String(s || '').toUpperCase()); }
export function isActiveStatus(s) { return !['ВЫПОЛНЕНА', 'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА', 'ЗАВЕРШЕНА'].includes(String(s || '').toUpperCase()); }

const n = v => Number(v || 0);
const fmt = (v, d = 0) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: d });
const pct = (a, b) => b ? `${fmt(a * 100 / b, 1)}%` : '0%';
const uniq = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
const by = (items, key) => items.reduce((r, x) => ((r[key(x)] ||= []).push(x), r), {});
const taskName = t => t.public_id || formatTaskPublicId(t) || `#${t.id}`;
const allTeams = t => uniq([t.team_name, ...(t.involved_team_names || [])]);
const inPeriod = (t, id) => !id || (t.period_ids || []).includes(id);
const chartTextColor = () => document.documentElement.getAttribute('data-theme') === 'dark' ? '#e2e8f0' : '#334155';
const median = values => {
  const sorted = values.slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function disposeCharts() {
  Object.values(charts).forEach(c => { try { c.dispose(); } catch (_) {} });
  Object.keys(charts).forEach(k => delete charts[k]);
}

function makeChart(id, option, onClick) {
  const el = document.getElementById(id);
  if (!el || !window.echarts) return;
  charts[id]?.dispose();
  const chart = window.echarts.init(el);
  chart.setOption({ backgroundColor: 'transparent', textStyle: { fontFamily: 'Inter, sans-serif' }, ...option });
  if (onClick) chart.on('click', onClick);
  charts[id] = chart;
}

function dependencyGraphLayout(nodes = []) {
  const el = document.getElementById('dep-chart');
  if (!el) return { left: 32, top: 32, width: 0, height: 0 };
  const radius = Math.max(20, ...nodes.map(node => Number(node.symbolSize || 0) / 2));
  const labelWidth = node => Math.max(48, String(node.displayName || node.name || '').length * 6);
  const labelHeight = () => 16;
  const sideSpace = position => Math.max(0, ...nodes.filter(node => node.label?.position === position).map(labelWidth));
  const verticalSpace = position => Math.max(16, ...nodes.filter(node => node.label?.position === position).map(labelHeight));
  const leftSpace = Math.ceil(radius + sideSpace('left') + 18);
  const rightSpace = Math.ceil(radius + sideSpace('right') + 18);
  const topSpace = Math.ceil(radius + verticalSpace('top') + 22);
  const bottomSpace = Math.ceil(radius + verticalSpace('bottom') + 22);
  const availableWidth = Math.max(0, el.clientWidth - leftSpace - rightSpace);
  const availableHeight = Math.max(0, el.clientHeight - topSpace - bottomSpace);
  const size = Math.max(0, Math.min(availableWidth, availableHeight));
  return {
    left: Math.round(leftSpace + (availableWidth - size) / 2),
    top: Math.round(topSpace + (availableHeight - size) / 2),
    width: Math.round(size),
    height: Math.round(size),
  };
}

function resizeCharts() {
  Object.values(charts).forEach(chart => chart.resize());
  if (charts['dep-chart']) {
    const nodes = charts['dep-chart'].getOption()?.series?.[0]?.data || [];
    charts['dep-chart'].setOption({ series: [{ ...dependencyGraphLayout(nodes) }] });
  }
}

function options(values, selected = '', all = 'Все') {
  return `<option value="">${escapeHtml(all)}</option>` + values.map(v => `<option value="${escapeHtml(v)}" ${v === selected ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

function periodOption(period, selected = '', activePeriod = ltData?.active_period) {
  const current = period.id === activePeriod;
  return `<option value="${escapeHtml(period.id)}" class="${current ? 'an-period-current' : ''}" ${current ? 'data-current="true"' : ''} ${period.id === selected ? 'selected' : ''}>${escapeHtml(period.label)}${current ? ' · текущий' : ''}</option>`;
}

function periodOptions(selected, data = ltData) {
  return (data?.periods || []).map(period => periodOption(period, selected, data?.active_period)).join('');
}

function taskRows(tasks, empty = 'Нет задач', { showProject = true } = {}) {
  if (!tasks.length) return `<div class="an-empty">${escapeHtml(empty)}</div>`;
  const projectHead = showProject ? '<span>Проект</span>' : '';
  const projectCell = task => showProject ? `<span>${escapeHtml(task.project_name || 'Без проекта')}</span>` : '';
  return `<div class="an-task-list ${showProject ? 'has-project' : ''}" role="table" aria-label="Задачи">
    <div class="an-task-list-head" role="row"><span>ID</span><span>Задача</span>${projectHead}<span>Команда</span><span>Статус</span><span>Срок</span><span>Трудозатраты</span></div>
    ${tasks.map(t => `
    <button type="button" class="an-task" data-task-id="${t.id}" role="row" aria-label="Открыть задачу ${escapeHtml(taskName(t))}: ${escapeHtml(t.title)}">
      <span class="an-task-id">${escapeHtml(taskName(t))}</span>
      <span class="an-task-title">${escapeHtml(t.title)}</span>
      ${projectCell(t)}
      <span>${escapeHtml(t.team_name || 'Без команды')}</span>
      <span>${escapeHtml(t.status_name || 'Без статуса')}</span>
      <span>${escapeHtml(t.deadline_name || t.deadline_code || 'Без срока')}</span>
      <span>${t.effort_days == null ? 'Без оценки' : `${fmt(t.effort_days, 1)} дн.`}</span>
    </button>`).join('')}</div>`;
}

function treeActionIcon(direction) {
  return `<svg class="an-tree-action-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="${direction === 'down' ? 'M3 3.5 8 8l5-4.5M3 8 8 12.5 13 8' : 'M3 8 8 3.5 13 8M3 12.5 8 8l5 4.5'}"></path></svg>`;
}

function projectTaskRows(tasks, empty = 'Нет задач') {
  if (!tasks.length) return `<div class="an-empty">${escapeHtml(empty)}</div>`;
  const groups = Object.entries(by(tasks, t => t.project_name || 'Без проекта')).sort((a, b) => b[1].length - a[1].length);
  if (groups.length === 1) {
    const [project, projectTasks] = groups[0];
    return `<div class="an-project-single"><span class="an-tree-static-icon" aria-hidden="true"></span><span class="an-tree-entity"><small>Проект</small><strong>${escapeHtml(project)}</strong></span><span class="an-tree-count">${projectTasks.length} ${effortPlural(projectTasks.length)}</span></div><div class="an-tree-children an-tree-children--single">${taskRows(projectTasks, empty, { showProject: false })}</div>`;
  }
  return `<div class="an-project-group-controls"><div class="an-tree-actions"><button type="button" data-project-groups-action="expand">${treeActionIcon('down')}<span>Раскрыть все</span></button><button type="button" data-project-groups-action="collapse">${treeActionIcon('up')}<span>Свернуть все</span></button></div><span>${groups.length} проектов · ${tasks.length} ${effortPlural(tasks.length)}</span></div><div class="an-project-groups">${groups.map(([project, projectTasks], index) => `<details ${index === 0 ? 'open' : ''}><summary><span class="an-tree-toggle-icon" aria-hidden="true"></span><span class="an-tree-entity"><small>Проект</small><strong>${escapeHtml(project)}</strong></span><span class="an-tree-count">${projectTasks.length} ${effortPlural(projectTasks.length)}</span></summary><div class="an-tree-children">${taskRows(projectTasks, empty, { showProject: false })}</div></details>`).join('')}</div>`;
}

function bindTasks(root = document) {
  root.querySelectorAll('.an-task[data-task-id]').forEach(el => el.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: Number(el.dataset.taskId) } }));
  }));
}

function clearDetail(id, { restoreFocus = false, notify = false } = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const source = el.__detailSource;
  document.querySelectorAll(`[data-detail-target="${id}"]`).forEach(item => {
    item.classList.remove('is-selected');
    item.setAttribute('aria-pressed', 'false');
  });
  el.classList.remove('is-open');
  el.innerHTML = '';
  el.__detailSource = null;
  const onClose = el.__detailOnClose;
  el.__detailOnClose = null;
  if (restoreFocus && source?.isConnected) source.focus({ preventScroll: true });
  if (notify && onClose) onClose();
}

function showDetail(id, title, tasks, options = '') {
  const config = typeof options === 'string' ? { subtitle: options } : options;
  const { subtitle = '', breadcrumbs = [], source = null, sourceKey = '', onClose = null, autoScroll = true } = config || {};
  const el = document.getElementById(id);
  if (!el) return;
  clearDetail(id);
  const trail = breadcrumbs.length ? `<div class="an-detail-trail" aria-label="Путь детализации">${breadcrumbs.map(item => `<span>${escapeHtml(item)}</span>`).join('<i aria-hidden="true">›</i>')}</div>` : '';
  el.innerHTML = `<div class="an-detail-head"><div>${trail}<strong tabindex="-1">${escapeHtml(title)}</strong>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}</div><button type="button" class="an-detail-close" aria-label="Закрыть детализацию">×</button></div>${projectTaskRows(tasks)}`;
  el.classList.add('is-open');
  el.__detailSource = source;
  el.__detailOnClose = onClose;
  if (source) {
    source.dataset.detailTarget = id;
    if (sourceKey) source.dataset.detailKey = sourceKey;
  }
  const selected = sourceKey ? document.querySelectorAll(`[data-detail-target="${id}"][data-detail-key="${sourceKey}"]`) : source ? [source] : [];
  selected.forEach(item => { item.classList.add('is-selected'); item.setAttribute('aria-pressed', 'true'); });
  el.querySelector('.an-detail-close')?.addEventListener('click', () => clearDetail(id, { restoreFocus: true, notify: true }));
  el.querySelectorAll('[data-project-groups-action]').forEach(button => button.addEventListener('click', () => {
    const open = button.dataset.projectGroupsAction === 'expand';
    el.querySelectorAll('.an-project-groups details').forEach(group => group.open = open);
  }));
  bindTasks(el);
  window.requestAnimationFrame(() => {
    const rect = el.getBoundingClientRect();
    if (autoScroll && (rect.bottom > window.innerHeight || rect.top < 0)) el.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    el.querySelector('.an-detail-head strong')?.focus({ preventScroll: true });
  });
}

function bindDetailCell(el, detailId, handler) {
  el.dataset.detailTarget = detailId;
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-pressed', 'false');
  const activate = event => {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    if (event.type === 'keydown') event.preventDefault();
    handler(el);
  };
  el.addEventListener('click', activate);
  el.addEventListener('keydown', activate);
}

function bindAnalyticsDetailEscape() {
  if (window.__analyticsDetailEscape) document.removeEventListener('keydown', window.__analyticsDetailEscape);
  window.__analyticsDetailEscape = event => {
    if (event.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.an-detail.is-open')].at(-1);
    if (open?.id) clearDetail(open.id, { restoreFocus: true, notify: true });
  };
  document.addEventListener('keydown', window.__analyticsDetailEscape);
}

const LT_REPORTS = [
  ['an-effort', 'Трудозатраты'], ['an-profile', 'Профиль команд'], ['an-dep', 'Зависимости'],
  ['an-sankey', 'Поток задач'], ['an-quarters', 'Кварталы'], ['an-project360', 'Проект 360°'], ['an-roi', 'Эффект'],
];

function reportIndex(value) { return value ? String(value).padStart(2, '0') : ''; }

function reportHeader(index, title, description, controls = '', meta = '') {
  return `<div class="an-report-head">
    <div class="an-report-heading ${index ? '' : 'an-report-heading--plain'}"><span class="an-report-mark" aria-hidden="true"></span>${index ? `<span class="an-report-index" aria-hidden="true">${reportIndex(index)}</span>` : ''}<div class="an-report-copy"><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}${meta ? `<div class="an-report-meta">${meta}</div>` : ''}</div></div>
    ${controls ? `<div class="an-controls an-report-toolbar">${controls}</div>` : ''}
  </div>`;
}

function card(id, index, title, description, controls, body, extraClass = '') {
  return `<section class="an-card an-report ${extraClass}" id="${id}" data-report-index="${reportIndex(index)}">${reportHeader(index, title, description, controls)}<div class="an-report-body">${body}</div></section>`;
}

function control(label, id, content, extraClass = '') { return `<label class="an-control ${extraClass}"><span>${label}</span><select id="${id}">${content}</select></label>`; }

function projectSearchControl() {
  return `<label class="an-control p360-project-control"><span>Проект</span><div class="p360-project-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg><input id="project-search" type="search" list="project-options" autocomplete="off" placeholder="Найти проект" aria-label="Найти и выбрать проект"><datalist id="project-options"></datalist></div></label>`;
}

function analyticsNavigation() {
  return `<nav class="an-report-nav" aria-label="Навигация по отчётам">${LT_REPORTS.map(([id, label], index) => `<button type="button" data-analytics-target="${id}"><span>${reportIndex(index + 1)}</span>${label}</button>`).join('')}</nav>`;
}

function originalEffortTemplate() {
  const controls = `<div class="an-control"><span>Команда</span><div class="dd" id="effortTeamDd"><button class="dd-btn" id="effortTeamBtn" type="button" aria-haspopup="listbox" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg><span class="dd-label" id="effortTeamName">Весь трайб</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button><div class="dd-panel" id="effortTeamPanel" role="listbox"></div></div></div>${control('Период', 'effort-period', '')}`;
  return `<section class="effort-report rep-card an-card an-report" id="an-effort" data-report-index="01">
    ${reportHeader(1, 'Трудозатраты по типам задач', 'Распределение оценённых трудозатрат по типам задач.', controls, '<span class="rep-sub" id="repSub">—</span>')}
    <div class="rep-body an-report-body"><div><div class="donut-wrap"><svg class="donut" viewBox="0 0 200 200"><circle class="donut-track" cx="100" cy="100" r="78"/><g id="effortSegGroup" transform="rotate(-90 100 100)"></g></svg><div class="donut-center"><div class="dc-num" id="dcNum">0</div><div class="dc-lab">чел.-дней</div><div class="dc-sub" id="dcSub">0 задач</div></div></div><div class="donut-cap">Распределение оценённых трудозатрат по типам задач</div></div>
      <div class="table-wrap an-table-scroll"><table class="rep-table an-table an-table--standard"><colgroup><col style="width:34%"><col style="width:12%"><col style="width:15%"><col style="width:39%"></colgroup><thead><tr><th class="sortable" data-col="name"><span class="th-in">Тип задачи <span class="arr">↕</span></span></th><th class="sortable" data-col="tasks"><span class="th-in">Задач <span class="arr">↕</span></span></th><th class="sortable" data-col="days"><span class="th-in">Чел.-дни <span class="arr">↕</span></span></th><th class="sortable sorted" data-col="share"><span class="th-in">Доля <span class="arr">↓</span></span></th></tr></thead><tbody id="repTbody"></tbody><tfoot><tr><td>Итого</td><td id="tTasks">0</td><td id="tDays">0</td><td>100%</td></tr></tfoot></table></div>
    </div><div id="effort-detail" class="an-detail an-report-detail"></div>
  </section>`;
}

function originalDependencyTemplate() {
  const filters = control('Период', 'dep-period', '') + control('Тип задачи', 'dep-type', '') + control('Режим', 'dep-mode', '<option value="directed">Направленный</option><option value="undirected">Без направления</option>') + control('Порог связей', 'dep-threshold', '<option>1</option><option>3</option><option>5</option><option>10</option>');
  return `<section class="skp-card an-card an-report" id="an-dep" data-report-index="03">${reportHeader(3, 'Карта зависимостей', 'Основная команда вовлекает команды-партнёры. Толщина ребра и число на нём — количество совместных задач.', filters)}
    <div class="an-report-body"><div class="dep-layout"><div class="dep-chart-wrap"><div id="dep-chart" class="skp-chart skp-chart--map"></div></div><div class="dep-side-wrap an-table-scroll"><table class="dep-table an-table an-table--compact"><thead><tr><th>Команда</th><th class="dep-bar-cell">Связи</th><th class="dep-num">Команда<br>привлекает</th><th class="dep-num">Привлекают<br>команду</th></tr></thead><tbody id="dep-teams-body"></tbody></table></div></div><div id="dep-detail" class="an-detail dep-lower-detail"></div></div>
  </section>`;
}

function ltTemplate() {
  return `<div class="an-page animate-fade-in is-loading">
    <div class="page-header"><h1>Аналитика ЛТ</h1><p>Единый обзор потока, взаимодействий, проектов и экономики</p></div>
    ${analyticsNavigation()}
    <div class="an-loading-state" role="status"><span aria-hidden="true"></span>Загружаем данные отчётов…</div>
    ${originalEffortTemplate()}
    ${card('an-profile', 2, 'Профиль команд', 'Матрица специализации команд по типам задач.',
      control('Период', 'profile-period', '') + control('Канал', 'profile-channel', ''),
      '<div id="profile-matrix"></div><div id="profile-detail" class="an-detail"></div>')}
    ${originalDependencyTemplate()}
    ${card('an-sankey', 4, 'Поток задач', 'Подразделение → команда → тип задачи; объём в задачах или человеко-днях.',
      control('Период', 'sankey-period', '') + control('Канал', 'sankey-channel', '') + control('Мера', 'sankey-mode', '<option value="tasks">Задачи</option><option value="days">Человеко-дни</option>') + '<button class="an-filter-button" id="sankey-swap" type="button">Команда ↔ Тип задачи</button>',
      '<div id="sankey-chart" class="an-chart an-chart-xl"></div><div id="sankey-detail" class="an-detail"></div>') }
    ${card('an-quarters', 5, 'Проекты по кварталам', 'Активность проектов в доступных периодах; фильтры по основной или привлечённой команде.', '',
      '<div class="an-filter-block"><div class="an-filter-band"><span>Команды</span><div id="quarter-teams" class="an-chips"></div></div><div class="an-filter-band"><span>Типы задач</span><div id="quarter-types" class="an-chips"></div></div></div><div id="quarter-grid"></div><div id="quarter-detail" class="an-detail"></div>')}
    ${card('an-project360', 6, 'Проект 360°', 'Полная картина проекта: сроки, ответственность, структура работ, экономика и задачи.',
      projectSearchControl(), '<div id="project-content"></div><div id="project-detail" class="an-detail"></div>')}
    <section class="an-card an-report an-roi-card" id="an-roi" data-report-index="07">${reportHeader(7, 'Трудозатраты и финансовый эффект', 'Сопоставление стоимости работ и ожидаемого финансового результата.', control('Период', 'roi-period', '') + control('Команда', 'roi-team', '') + control('Тип задачи', 'roi-type', '') + '<button id="roi-reset" class="btn btn-secondary btn-sm an-reset-btn" type="button">Сбросить</button>', '<span id="roi-count" class="roi-count"></span>')}<div class="an-report-body"><div id="roi-legend" class="roi-legend"></div><div class="roi-wrap"><svg id="roi-svg" viewBox="0 0 940 496" role="img" aria-label="Квадрант: трудозатраты против финансового эффекта по группам проектов"></svg><div id="roi-tooltip" class="roi-tooltip" role="tooltip"></div></div><div class="roi-selection-head"><div class="roi-selection-main"><h3 id="roi-table-title">Все группы</h3><div class="an-tree-actions roi-tree-actions"><button id="roi-expand-all" type="button">${treeActionIcon('down')}<span>Раскрыть все</span></button><button id="roi-collapse-all" type="button">${treeActionIcon('up')}<span>Свернуть все</span></button></div></div><button id="roi-clear-quad" type="button">Показать все квадранты</button></div><div class="roi-tree-table" role="table" aria-label="Проекты, команды и задачи с финансовым эффектом"><div class="roi-tree-head" role="row"><span>Проект</span><span>Команда</span><span>Задач</span><span>Трудозатраты</span><span>Фин. эффект</span><span>CIR</span></div><div id="roi-table-body" class="roi-tree-body" role="rowgroup"></div></div></div></section>
  </div>`;
}

function poTemplate() {
  return `<div class="an-page animate-fade-in"><div class="page-header"><h1>Аналитика PO/PL</h1><p>Полнота данных, логические конфликты и однородность ведения бэклога</p></div>
    ${card('an-complete', '', 'Полнота карточек', 'Девять обязательных полей. Нажмите на ячейку, чтобы увидеть задачи с пропусками.', control('Период', 'complete-period', ''), '<div id="complete-matrix"></div><div id="complete-detail" class="an-detail"></div>')}
    ${card('an-quality', '', 'Конфликты качества', 'Проверки согласованности статуса, прогресса, сроков, факта и классификации.', '', '<div id="quality-checks" class="an-quality-grid"></div><div id="quality-detail" class="an-detail"></div>')}
    ${card('an-uniform', '', 'Однородность ведения', 'Информационный сигнал: доминирующее значение статуса или приоритета при доле от 80% (минимум 10 задач).', control('Поле', 'uniform-field', '<option value="status_name">Статус</option><option value="priority_name">Приоритет</option>'), '<div id="uniform-content"></div><div id="uniform-detail" class="an-detail"></div>')}
  </div>`;
}

export function renderAnalytics(type, app) {
  if (typeof window !== 'undefined') window.__app = app;
  if (type === 'it') return `<div class="an-page"><div class="page-header"><h1>Аналитика для ИТ</h1><p>Раздел в разработке</p></div></div>`;
  return type === 'tribe' ? ltTemplate() : poTemplate();
}

function effortTasks() { return ltData.tasks.filter(t => inPeriod(t, state.effort.period) && (!state.effort.team || t.team_name === state.effort.team)); }
function effortPlural(value) { const x = Math.abs(Math.round(value)) % 100, y = x % 10; return x > 10 && x < 20 ? 'задач' : y === 1 ? 'задача' : y > 1 && y < 5 ? 'задачи' : 'задач'; }
function focusEffort(index) {
  state.effort.arcs.forEach((arc, i) => { arc.style.opacity = index == null || i === index ? '1' : '.2'; arc.style.strokeWidth = i === index ? '30' : '25'; });
  state.effort.rows.forEach((row, i) => row.el.classList.toggle('hot', index === i));
}
function sortEffortRows(animate = false) {
  const tbody = document.getElementById('repTbody');
  if (!tbody) return;
  const rows = [...state.effort.rows], col = state.effort.sortCol, dir = state.effort.sortDir;
  rows.sort((a, b) => col === 'name' ? a.name.localeCompare(b.name, 'ru') * dir : (a[col] - b[col]) * dir);
  rows.forEach((row, index) => { tbody.appendChild(row.el); if (animate) { row.el.style.animation = 'none'; void row.el.offsetWidth; row.el.style.animation = `rowIn .4s ${index * .04}s both`; } });
  document.querySelectorAll('#an-effort .rep-table th.sortable').forEach(th => { const active = th.dataset.col === col; th.classList.toggle('sorted', active); th.querySelector('.arr').textContent = active ? (dir > 0 ? '↑' : '↓') : '↕'; });
}
function renderEffort() {
  clearDetail('effort-detail');
  const tasks = effortTasks(), evaluated = tasks.filter(t => t.effort_days != null), grouped = by(tasks, t => t.task_type_name || 'Без типа');
  const totalDays = evaluated.reduce((sum, task) => sum + n(task.effort_days), 0);
  const items = Object.entries(grouped).map(([name, typeTasks], index) => ({ name, typeTasks, tasks: typeTasks.length, days: typeTasks.reduce((sum, task) => sum + n(task.effort_days), 0), color: LT_TYPE_COLORS[index % LT_TYPE_COLORS.length] }));
  items.forEach(item => item.share = totalDays ? item.days / totalDays * 100 : 0);
  document.getElementById('repSub').textContent = `${state.effort.team || 'Весь трайб'} · ${ltData.periods.find(p => p.id === state.effort.period)?.label || state.effort.period}`;
  document.getElementById('dcNum').textContent = fmt(totalDays, 1);
  document.getElementById('dcSub').textContent = `${tasks.length} ${effortPlural(tasks.length)}`;
  document.getElementById('tTasks').textContent = fmt(tasks.length);
  document.getElementById('tDays').textContent = fmt(totalDays, 1);

  const svgGroup = document.getElementById('effortSegGroup'); svgGroup.innerHTML = '';
  let offset = 0;
  state.effort.arcs = items.map((item, index) => { const arc = document.createElementNS(SVG_NS, 'circle'); arc.setAttribute('cx', '100'); arc.setAttribute('cy', '100'); arc.setAttribute('r', '78'); arc.setAttribute('pathLength', '100'); arc.setAttribute('class', 'arc'); arc.setAttribute('stroke', item.color); arc.setAttribute('tabindex', '0'); arc.setAttribute('role', 'button'); arc.setAttribute('aria-label', `Показать задачи типа ${item.name}`); arc.dataset.detailTarget = 'effort-detail'; arc.dataset.detailKey = String(index); const dash = item.share > .5 ? Math.max(item.share - 1.3, .4) : 0; arc.setAttribute('stroke-dasharray', `${dash} ${100 - dash}`); arc.setAttribute('stroke-dashoffset', String(-(offset + .65))); offset += item.share; const open = () => showDetail('effort-detail', item.name, item.typeTasks, { subtitle: `${state.effort.team || 'Весь трайб'} · ${ltData.periods.find(p => p.id === state.effort.period)?.label || state.effort.period}`, breadcrumbs: ['Трудозатраты', item.name], source: arc, sourceKey: String(index) }); arc.addEventListener('mouseenter', () => focusEffort(index)); arc.addEventListener('mouseleave', () => focusEffort(null)); arc.addEventListener('click', open); arc.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); open(); } }); svgGroup.appendChild(arc); return arc; });

  const tbody = document.getElementById('repTbody'); tbody.innerHTML = '';
  state.effort.rows = items.map((item, index) => { const tr = document.createElement('tr'); if (!item.days) tr.classList.add('zero'); tr.innerHTML = `<td><div class="t-name"><span class="dot" style="--c:${item.color};--ring:${item.color}26"></span><span class="lbl">${escapeHtml(item.name)}</span>${item.tasks > 0 && item.days === 0 ? '<span class="no-eff">нет оценки</span>' : ''}</div></td><td>${item.tasks}</td><td>${fmt(item.days, 1)}</td><td><div class="t-share"><div class="bar"><i style="--c:${item.color};width:${Math.max(0, item.share)}%"></i></div><span class="pct">${fmt(item.share, 1)}%</span></div></td>`; tr.style.animation = `rowIn .45s ${.05 + index * .05}s both`; tr.dataset.detailKey = String(index); tr.addEventListener('mouseenter', () => focusEffort(index)); tr.addEventListener('mouseleave', () => focusEffort(null)); bindDetailCell(tr, 'effort-detail', source => showDetail('effort-detail', item.name, item.typeTasks, { subtitle: `${state.effort.team || 'Весь трайб'} · ${ltData.periods.find(p => p.id === state.effort.period)?.label || state.effort.period}`, breadcrumbs: ['Трудозатраты', item.name], source, sourceKey: String(index) })); tbody.appendChild(tr); return { el: tr, name: item.name, tasks: item.tasks, days: item.days, share: item.share }; });
  sortEffortRows();
}

function renderProfile() {
  clearDetail('profile-detail');
  const tasks = ltData.tasks.filter(t => inPeriod(t, state.profile.period) && (!state.profile.channel || t.channel_name === state.profile.channel));
  const teams = uniq(tasks.map(t => t.team_name)), types = uniq(tasks.map(t => t.task_type_name || 'Без типа'));
  const max = Math.max(1, ...teams.flatMap(team => types.map(type => tasks.filter(t => t.team_name === team && (t.task_type_name || 'Без типа') === type).length)));
  const rows = teams.map(team => {
    const teamTasks = tasks.filter(t => t.team_name === team), teamTotal = teamTasks.length;
    const cells = types.map(type => {
      const count = teamTasks.filter(t => (t.task_type_name || 'Без типа') === type).length, share = pct(count, teamTotal);
      return `<td class="an-cell an-number ${count ? 'is-actionable' : 'is-empty'}" data-team="${escapeHtml(team)}" data-type="${escapeHtml(type)}" data-share="${share}" data-count="${count}" style="--heat:${count / max}" aria-label="${escapeHtml(`${team} · ${type}: ${count} задач, ${share}`)}" ${count ? '' : 'aria-disabled="true"'}><span class="an-profile-value"><strong class="an-profile-count">${count || '—'}</strong><small class="an-profile-share">${share}</small></span></td>`;
    }).join('');
    return `<tr><th>${escapeHtml(team)}</th>${cells}<td class="an-number an-profile-total"><span class="an-profile-value"><strong class="an-profile-count">${teamTotal}</strong><small class="an-profile-share">100%</small></span></td></tr>`;
  }).join('');
  document.getElementById('profile-matrix').innerHTML = `<div class="an-table-scroll"><table class="an-table an-matrix" style="--profile-columns:${types.length + 1}"><colgroup><col class="an-team-column">${types.map(() => '<col class="an-number-column">').join('')}<col class="an-number-column"></colgroup><thead><tr><th>Команда</th>${types.map(x => `<th class="an-number">${escapeHtml(x)}</th>`).join('')}<th class="an-number">Всего</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  document.querySelectorAll('#profile-matrix .an-cell.is-actionable').forEach(el => bindDetailCell(el, 'profile-detail', source => showDetail('profile-detail', `${source.dataset.team} · ${source.dataset.type}`, tasks.filter(t => t.team_name === source.dataset.team && (t.task_type_name || 'Без типа') === source.dataset.type), { subtitle: `${source.dataset.count} ${effortPlural(source.dataset.count)} · ${source.dataset.share}`, breadcrumbs: ['Профиль команд', source.dataset.team, source.dataset.type], source })));
}

function dependencyEdges() {
  const tasks = ltData.tasks.filter(t => inPeriod(t, state.dep.period) && (!state.dep.type || t.task_type_name === state.dep.type));
  const map = {};
  tasks.forEach(t => (t.involved_team_names || []).forEach(target => {
    if (!t.team_name || target === t.team_name) return;
    const pair = state.dep.mode === 'undirected' ? [t.team_name, target].sort((a, b) => a.localeCompare(b, 'ru')) : [t.team_name, target];
    const key = pair.join('\u0001');
    (map[key] ||= { source: pair[0], target: pair[1], tasks: [] }).tasks.push(t);
  }));
  return Object.values(map).filter(e => e.tasks.length >= state.dep.threshold).sort((a, b) => b.tasks.length - a.tasks.length);
}

function dependencyEdgeTier(count) {
  if (count >= 10) return { width: 6, arrowSize: 17 };
  if (count >= 5) return { width: 4, arrowSize: 13 };
  return { width: 2, arrowSize: 10 };
}

function renderDep() {
  clearDetail('dep-detail');
  const edges = dependencyEdges(), names = uniq(edges.flatMap(edge => [edge.source, edge.target]));
  const stat = Object.fromEntries(names.map(name => [name, { asMain: 0, asPartner: 0, tasks: [] }]));
  edges.forEach(edge => { stat[edge.source].asMain += edge.tasks.length; stat[edge.target].asPartner += edge.tasks.length; stat[edge.source].tasks.push(...edge.tasks); stat[edge.target].tasks.push(...edge.tasks); });
  const chartBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim() || '#fff';
  const maxNodeTotal = Math.max(1, ...names.map(name => stat[name].asMain + stat[name].asPartner));
  const shortName = name => ({ 'Post-Trade (Products & Service)': 'Post-Trade (P&S)', 'Post-Trade (Finance)': 'Post-Trade (Fin.)' }[name] || name);
  const nodes = names.map((name, index) => { const nodeTotal = stat[name].asMain + stat[name].asPartner, angle = index / Math.max(1, names.length) * Math.PI * 2 - Math.PI / 2, cos = Math.cos(angle), sin = Math.sin(angle), position = cos > .5 ? 'right' : cos < -.5 ? 'left' : sin > 0 ? 'bottom' : 'top'; const symbolSize = 10 + Math.sqrt(nodeTotal / maxNodeTotal) * 22; return { name, displayName: shortName(name), x: cos * 100, y: sin * 100, symbolSize, itemStyle: { color: LT_MAP_COLORS[index % LT_MAP_COLORS.length], borderColor: chartBg, borderWidth: 2 }, label: { show: true, formatter: shortName(name), position, distance: 15, fontSize: 11, fontWeight: 500, color: chartTextColor() } }; });
  const edgeLookup = new Map(edges.map(edge => [`${edge.source}\u0001${edge.target}`, edge]));
  const links = edges.map(edge => { const count = edge.tasks.length, tier = dependencyEdgeTier(count); return { source: edge.source, target: edge.target, value: count, lineStyle: { width: tier.width, cap: 'round', join: 'round', curveness: edgeLookup.has(`${edge.target}\u0001${edge.source}`) ? .3 : .12, opacity: .45, color: LT_MAP_COLORS[names.indexOf(edge.source) % LT_MAP_COLORS.length] }, symbol: state.dep.mode === 'directed' ? ['none', 'arrow'] : ['none', 'none'], symbolSize: [0, tier.arrowSize] }; });
  let pinnedDependencyTeam = '', selectedDependencyDirection = '', selectedDependencyProject = '';
  const renderDependencyDetail = team => {
    const detail = document.getElementById('dep-detail');
    if (!detail || !team) { detail?.classList.remove('is-open'); if (detail) detail.innerHTML = ''; return; }
    const directions = edges.filter(edge => edge.source === team || edge.target === team);
    const selectedEdge = directions.find(edge => `${edge.source}\u0001${edge.target}` === selectedDependencyDirection);
    const projectGroups = selectedEdge ? Object.entries(by(selectedEdge.tasks, task => task.project_name || 'Без проекта')).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ru')) : [];
    const selectedTasks = projectGroups.find(([project]) => project === selectedDependencyProject)?.[1] || [];
    const relationSymbol = state.dep.mode === 'directed' ? '→' : '↔';
    detail.innerHTML = `<div class="dep-detail-head"><div><div class="an-detail-trail" aria-label="Путь детализации"><span>Зависимости</span><i aria-hidden="true">›</i><span>${escapeHtml(team)}</span></div><strong tabindex="-1">${escapeHtml(team)}</strong><small>задач со связями: ${new Set(stat[team].tasks.map(task => task.id)).size} · связей: ${directions.length}</small></div><button type="button" class="dep-detail-clear" aria-label="Снять выбор команды">Снять выбор ×</button></div>
      <div class="dep-detail-grid"><div><h3>Кто кого привлекает</h3>${directions.length ? directions.map((edge, index) => `<button type="button" class="dep-direction ${edge === selectedEdge ? 'is-open' : ''}" data-dep-direction="${index}"><span>${escapeHtml(edge.source)}</span><b>${relationSymbol}</b><span>${escapeHtml(edge.target)}</span><strong>${edge.tasks.length}</strong></button>`).join('') : '<div class="dep-empty">Прямых связей команды нет</div>'}</div>
      <div><h3>${selectedEdge ? `Совместные проекты · ${escapeHtml(selectedEdge.source)} ${relationSymbol} ${escapeHtml(selectedEdge.target)}` : 'Совместные проекты'}</h3>${selectedEdge ? `<div class="dep-projects">${projectGroups.map(([project, tasks], index) => `<button type="button" class="dep-project ${project === selectedDependencyProject ? 'is-open' : ''}" data-dep-project="${index}"><span>${escapeHtml(project)}</span><i style="--dep-project-share:${tasks.length / Math.max(1, projectGroups[0][1].length) * 100}%"></i><strong>${tasks.length}</strong></button>`).join('')}</div>` : '<p class="dep-direction-hint">Выберите связь слева, чтобы увидеть проекты, в которых она возникает</p>'}</div></div>
      ${selectedDependencyProject ? `<div class="dep-project-tasks"><div class="dep-project-tasks-head"><strong>${escapeHtml(selectedDependencyProject)}</strong><small>${selectedTasks.length} ${effortPlural(selectedTasks.length)}</small></div>${taskRows(selectedTasks, 'Нет задач', { showProject: false })}</div>` : ''}`;
    detail.classList.add('is-open');
    detail.querySelector('.dep-detail-clear')?.addEventListener('click', () => selectDependencyTeam(''));
    detail.querySelectorAll('[data-dep-direction]').forEach(button => button.addEventListener('click', () => { const edge = directions[Number(button.dataset.depDirection)]; const key = `${edge.source}\u0001${edge.target}`; selectedDependencyDirection = selectedDependencyDirection === key ? '' : key; selectedDependencyProject = ''; renderDependencyDetail(team); }));
    detail.querySelectorAll('[data-dep-project]').forEach(button => button.addEventListener('click', () => { const project = projectGroups[Number(button.dataset.depProject)]?.[0] || ''; selectedDependencyProject = selectedDependencyProject === project ? '' : project; renderDependencyDetail(team); }));
    bindTasks(detail);
  };
  makeChart('dep-chart', { tooltip: { formatter: p => { if (p.dataType === 'edge') return `${escapeHtml(p.data.source)} → ${escapeHtml(p.data.target)}<br>Совместных задач: <b>${p.data.value}</b>`; const s = stat[p.name] || { asMain: 0, asPartner: 0 }; return `<b>${escapeHtml(p.name)}</b><br>Как основная: ${s.asMain} задач<br>Как партнёр: ${s.asPartner} участий`; } }, series: [{ type: 'graph', layout: 'none', data: nodes, links, directed: state.dep.mode === 'directed', roam: false, draggable: false, ...dependencyGraphLayout(nodes), edgeSymbol: state.dep.mode === 'directed' ? ['none', 'arrow'] : ['none', 'none'], edgeLabel: { show: true, position: 'middle', distance: 0, rotate: false, align: 'center', verticalAlign: 'middle', fontSize: 9.5, fontWeight: 600, color: chartTextColor(), formatter: p => p.data.value, backgroundColor: 'transparent', padding: 0, textBorderColor: chartBg, textBorderWidth: 3 }, emphasis: { focus: 'adjacency', lineStyle: { opacity: .85 } } }] }, p => { if (p.dataType === 'node') selectDependencyTeam(p.name); else if (p.dataType === 'edge') { selectDependencyTeam(p.data.source); selectedDependencyDirection = `${p.data.source}\u0001${p.data.target}`; selectedDependencyProject = ''; renderDependencyDetail(p.data.source); } });
  const maxTeamTotal = Math.max(1, ...names.map(name => stat[name].asMain + stat[name].asPartner));
  document.getElementById('dep-teams-body').innerHTML = names.map(name => { const color = LT_MAP_COLORS[names.indexOf(name) % LT_MAP_COLORS.length], s = stat[name]; return `<tr data-team="${escapeHtml(name)}"><td><span class="dep-swatch" style="background:${color}"></span>${escapeHtml(name)}</td><td class="dep-bar-cell"><div class="dep-bar-track" title="привлекает ${s.asMain}, привлекают ${s.asPartner}"><div class="dep-bar-fill" style="width:${s.asMain / maxTeamTotal * 100}%;background:${color}"></div><div class="dep-bar-fill dep-bar-fill-in" style="width:${s.asPartner / maxTeamTotal * 100}%;background:${color}"></div></div></td><td class="dep-num">${s.asMain}</td><td class="dep-num">${s.asPartner}</td></tr>`; }).join('') || '<tr><td colspan="4" class="dep-empty">Нет связей под выбранным порогом</td></tr>';
  const teamRows = [...document.querySelectorAll('#dep-teams-body tr[data-team]')], depChart = charts['dep-chart'];
  const focusDependencyTeam = team => {
    const related = new Set(team ? [team] : names);
    if (team) links.forEach(link => { if (link.source === team || link.target === team) { related.add(link.source); related.add(link.target); } });
    depChart?.setOption({ series: [{
      data: nodes.map(node => ({ ...node, itemStyle: { ...node.itemStyle, opacity: related.has(node.name) ? 1 : .12 }, label: { ...node.label, opacity: related.has(node.name) ? 1 : .35 } })),
      links: links.map(link => ({ ...link, lineStyle: { ...link.lineStyle, opacity: !team ? link.lineStyle.opacity : link.source === team || link.target === team ? .65 : .08 } })),
    }] }, { lazyUpdate: true });
    teamRows.forEach(row => {
      row.classList.toggle('dep-row-selected', Boolean(pinnedDependencyTeam) && row.dataset.team === pinnedDependencyTeam);
      row.classList.toggle('dep-row-active', !pinnedDependencyTeam && Boolean(team) && row.dataset.team === team);
      row.setAttribute('aria-pressed', String(Boolean(pinnedDependencyTeam) && row.dataset.team === pinnedDependencyTeam));
    });
  };
  const selectDependencyTeam = team => {
    const changed = pinnedDependencyTeam !== team;
    pinnedDependencyTeam = team;
    if (changed) { selectedDependencyDirection = ''; selectedDependencyProject = ''; }
    focusDependencyTeam(team);
    renderDependencyDetail(team);
  };
  teamRows.forEach(el => {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-pressed', 'false');
    el.addEventListener('mouseenter', () => { if (!pinnedDependencyTeam) focusDependencyTeam(el.dataset.team); });
    el.addEventListener('mouseleave', () => focusDependencyTeam(pinnedDependencyTeam));
    el.addEventListener('click', () => selectDependencyTeam(pinnedDependencyTeam === el.dataset.team ? '' : el.dataset.team));
    el.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); selectDependencyTeam(pinnedDependencyTeam === el.dataset.team ? '' : el.dataset.team); } });
  });
  depChart?.on('mouseover', params => { if (!pinnedDependencyTeam && params.dataType === 'node') focusDependencyTeam(params.name); });
  depChart?.on('mouseout', params => { if (params.dataType === 'node') focusDependencyTeam(pinnedDependencyTeam); });
}

function renderSankey() {
  clearDetail('sankey-detail');
  const tasks = ltData.tasks.filter(t => inPeriod(t, state.sankey.period) && (!state.sankey.channel || t.channel_name === state.sankey.channel));
  const links = {}, nodes = {}, value = t => state.sankey.mode === 'days' ? n(t.effort_days) : 1;
  tasks.forEach(t => {
    const d = `d:${t.department_name || 'Без подразделения'}`, tm = `t:${t.team_name || 'Без команды'}`, ty = `y:${t.task_type_name || 'Без типа'}`;
    const middle = state.sankey.swapColumns ? ty : tm, last = state.sankey.swapColumns ? tm : ty;
    [[d, t.department_name || 'Без подразделения', 0, 'department'], [tm, t.team_name || 'Без команды', state.sankey.swapColumns ? 2 : 1, 'team'], [ty, t.task_type_name || 'Без типа', state.sankey.swapColumns ? 1 : 2, 'type']].forEach(([id, name, depth, kind]) => {
      nodes[id] ||= { name: id, display: name, depth, kind, value: 0, tasks: [] };
      nodes[id].value += value(t);
      nodes[id].tasks.push(t);
    });
    [[d, middle], [middle, last]].forEach(([source, target]) => { const key = `${source}\u0001${target}`; (links[key] ||= { source, target, value: 0, tasks: [] }); links[key].value += value(t); links[key].tasks.push(t); });
  });
  const linkList = Object.values(links).filter(x => x.value > 0);
  const pinned = state.sankey.pin;
  const related = new Set(pinned ? [pinned] : Object.keys(nodes));
  if (pinned) linkList.forEach(link => { if (link.source === pinned || link.target === pinned) { related.add(link.source); related.add(link.target); } });
  const sortedNodes = Object.values(nodes).sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return b.value - a.value || a.display.localeCompare(b.display, 'ru');
  });
  makeChart('sankey-chart', { animation: false, tooltip: { formatter: p => p.dataType === 'edge' ? `${nodes[p.data.source]?.display} → ${nodes[p.data.target]?.display}: ${fmt(p.data.value, 1)}<br>Нажмите, чтобы увидеть задачи` : `${nodes[p.name]?.display}<br>Нажмите, чтобы увидеть задачи` }, series: [{ type: 'sankey', layoutIterations: 0, data: sortedNodes.map(x => ({ name: x.name, depth: x.depth, itemStyle: { opacity: related.has(x.name) ? 1 : .14 }, label: { formatter: x.display, opacity: related.has(x.name) ? 1 : .28 } })), links: linkList.map(x => ({ ...x, lineStyle: { opacity: !pinned || x.source === pinned || x.target === pinned ? .62 : .05 } })), emphasis: { focus: 'adjacency' }, lineStyle: { color: 'gradient', curveness: .5 }, nodeGap: 12, nodeWidth: 18 }] }, p => {
    if (p.dataType === 'node') {
      const opening = state.sankey.pin !== p.name;
      state.sankey.pin = opening ? p.name : '';
      renderSankey();
      if (opening) {
        const node = nodes[p.name];
        showDetail('sankey-detail', node.display, node.tasks, { subtitle: `${node.tasks.length} ${effortPlural(node.tasks.length)}`, breadcrumbs: ['Поток задач', node.kind === 'department' ? 'Подразделение' : node.kind === 'team' ? 'Команда' : 'Тип задачи', node.display], onClose: () => { state.sankey.pin = ''; renderSankey(); } });
      }
    } else if (p.dataType === 'edge') {
      state.sankey.pin = p.data.source;
      renderSankey();
      const source = nodes[p.data.source]?.display || p.data.source, target = nodes[p.data.target]?.display || p.data.target;
      showDetail('sankey-detail', `${source} → ${target}`, p.data.tasks || [], { subtitle: `${p.data.tasks?.length || 0} ${effortPlural(p.data.tasks?.length || 0)}`, breadcrumbs: ['Поток задач', 'Связь', `${source} → ${target}`], onClose: () => { state.sankey.pin = ''; renderSankey(); } });
    }
  });
}

function chipSet(id, values, selected, render) {
  const el = document.getElementById(id);
  el.innerHTML = values.map(v => `<button class="an-chip ${selected.includes(v) ? 'active' : ''}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('');
  el.querySelectorAll('.an-chip').forEach(btn => btn.addEventListener('click', () => { const v = btn.dataset.value, i = selected.indexOf(v); i >= 0 ? selected.splice(i, 1) : selected.push(v); btn.classList.toggle('active', selected.includes(v)); render(); }));
}

function renderQuarters() {
  clearDetail('quarter-detail');
  const tasks = ltData.tasks.filter(t => (!state.quarters.teams.length || allTeams(t).some(x => state.quarters.teams.includes(x))) && (!state.quarters.types.length || state.quarters.types.includes(t.task_type_name || 'Без типа')));
  const quarters = ltData.periods.filter(p => /^q\d_\d{4}$/.test(p.id)), projects = uniq(tasks.map(t => t.project_name || 'Без проекта'));
  chipSet('quarter-teams', uniq(ltData.tasks.flatMap(allTeams)), state.quarters.teams, renderQuarters);
  chipSet('quarter-types', uniq(ltData.tasks.map(t => t.task_type_name || 'Без типа')), state.quarters.types, renderQuarters);
  document.getElementById('quarter-grid').innerHTML = `<div class="an-table-scroll"><table class="an-table an-quarter"><thead><tr><th>Проект</th>${quarters.map(q => `<th>${escapeHtml(q.label)}</th>`).join('')}<th>Всего</th></tr></thead><tbody>${projects.map(project => `<tr><th>${escapeHtml(project)}</th>${quarters.map(q => { const ts = tasks.filter(t => (t.project_name || 'Без проекта') === project && inPeriod(t, q.id)); return `<td class="an-cell ${ts.length ? 'is-actionable' : 'is-empty'}" data-project="${escapeHtml(project)}" data-period="${q.id}" data-count="${ts.length}" style="--heat:${Math.min(1, ts.length / 8)}" ${ts.length ? `aria-label="${escapeHtml(`${project} · ${q.label}: ${ts.length} ${effortPlural(ts.length)}`)}"` : 'aria-disabled="true"'}>${ts.length || '·'}</td>`; }).join('')}<td>${tasks.filter(t => (t.project_name || 'Без проекта') === project).length}</td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('#quarter-grid .an-cell.is-actionable').forEach(el => bindDetailCell(el, 'quarter-detail', source => { const period = quarters.find(q => q.id === source.dataset.period); showDetail('quarter-detail', `${source.dataset.project} · ${period?.label || source.dataset.period}`, tasks.filter(t => (t.project_name || 'Без проекта') === source.dataset.project && inPeriod(t, source.dataset.period)), { subtitle: `${source.dataset.count} ${effortPlural(source.dataset.count)}`, breadcrumbs: ['Проекты по кварталам', source.dataset.project, period?.label || source.dataset.period], source }); }));
}

function p360ProjectKey(value) { return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru'); }

function p360ProjectGroups(tasks) {
  const groups = new Map();
  tasks.forEach(task => {
    const name = String(task.project_name || '').replace(/\s+/g, ' ').trim();
    if (!name) return;
    const key = p360ProjectKey(name);
    if (!groups.has(key)) groups.set(key, { key, name, tasks: [] });
    groups.get(key).tasks.push(task);
  });
  return [...groups.values()].sort((a, b) => b.tasks.length - a.tasks.length || a.name.localeCompare(b.name, 'ru'));
}

function p360IsDone(task) { return !isActiveStatus(task.status_name) || Boolean(task.is_completed) || n(task.progress) >= 100; }
function p360ChannelKey(task) { return !String(task.channel_name || '').trim() ? 'none' : String(task.channel_name).trim() === 'Бизнес-план' ? 'plan' : 'adhoc'; }
const P360_CHANNELS = [{ value: 'plan', label: 'По бизнес-плану' }, { value: 'adhoc', label: 'Внеплановый' }, { value: 'none', label: 'Канал не указан' }];

function project360() {
  clearDetail('project-detail');
  clearDetail('p360-timeline-detail');
  clearDetail('p360-flow-detail');
  const project = p360ProjectGroups(ltData.tasks).find(item => item.key === p360ProjectKey(state.project));
  const tasks = project?.tasks || [];
  if (!tasks.length) { document.getElementById('project-content').innerHTML = '<div class="an-empty">Выберите проект</div>'; return; }
  state.project = project.name;
  const quarters = ltData.periods.filter(period => /^q\d_\d{4}$/.test(period.id));
  const visibleQuarters = quarters.filter(period => tasks.some(task => inPeriod(task, period.id)));
  if (state.projectQuarter && !visibleQuarters.some(period => period.id === state.projectQuarter)) state.projectQuarter = '';
  const typeNames = uniq(tasks.map(task => task.task_type_name || 'Без типа'));
  const typeColors = Object.fromEntries(typeNames.map((name, index) => [name, LT_TYPE_COLORS[index % LT_TYPE_COLORS.length]]));
  const typeStats = rows => Object.entries(by(rows, task => task.task_type_name || 'Без типа')).map(([name, typeTasks]) => ({ name, tasks: typeTasks, count: typeTasks.length, effort: typeTasks.reduce((sum, task) => sum + n(task.effort_days), 0) })).sort((a, b) => (state.projectMetric === 'effort' ? b.effort - a.effort : b.count - a.count) || a.name.localeCompare(b.name, 'ru'));
  const metricValue = item => state.projectMetric === 'effort' ? item.effort : item.count;
  const renderMixBar = (stats, total, team = '') => stats.filter(item => metricValue(item) > 0).map(item => { const share = total ? metricValue(item) / total * 100 : 0; return `<button class="p360-mixseg ${team ? 'is-mini' : ''}" data-p360-type="${escapeHtml(item.name)}" ${team ? `data-p360-team="${escapeHtml(team)}"` : ''} style="width:${share}%;background:${typeColors[item.name]}" title="${escapeHtml(`${item.name}: ${fmt(metricValue(item), 1)} · ${fmt(share, 1)}%`)}"><span>${share >= 8 ? `${fmt(share, 1)}%` : ''}</span></button>`; }).join('');
  const types = typeStats(tasks);
  const metricTotal = types.reduce((sum, item) => sum + metricValue(item), 0);
  const totalEffort = tasks.reduce((sum, task) => sum + n(task.effort_days), 0);
  const teams = Object.entries(by(tasks, task => task.team_name || 'Без команды')).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ru'));
  const involved = Object.entries(by(tasks.flatMap(task => (task.involved_team_names || []).map(name => ({ name, task }))), item => item.name)).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ru'));
  const teamMixes = teams.map(([team, teamTasks]) => { const stats = typeStats(teamTasks), total = stats.reduce((sum, item) => sum + metricValue(item), 0); return { team, teamTasks, stats, total }; }).filter(item => item.total > 0);
  const quarterTaskEffort = (task, periodId) => { const projectPeriods = (task.period_ids || []).filter(id => quarters.some(period => period.id === id)); return projectPeriods.includes(periodId) ? n(task.effort_days) / Math.max(1, projectPeriods.length) : 0; };
  const timeline = visibleQuarters.map(period => {
    const periodTasks = tasks.filter(task => inPeriod(task, period.id));
    const done = periodTasks.filter(p360IsDone).length;
    const effort = periodTasks.reduce((sum, task) => sum + quarterTaskEffort(task, period.id), 0);
    const owners = Object.entries(by(periodTasks, task => task.team_name || 'Без команды'));
    const partners = Object.entries(by(periodTasks.flatMap(task => (task.involved_team_names || []).map(name => ({ name }))), item => item.name));
    const partnerTotal = partners.reduce((sum, [, rows]) => sum + rows.length, 0);
    return `<button class="p360-quarter ${period.id === ltData.active_period ? 'is-current' : ''} ${period.id === state.projectQuarter ? 'is-selected' : ''}" data-p360-period="${period.id}" type="button" aria-pressed="${period.id === state.projectQuarter}"><span class="p360-quarter-head"><b>${escapeHtml(period.label)}</b><small>${periodTasks.length} ${effortPlural(periodTasks.length)}</small></span><span class="p360-quarter-metrics">${fmt(effort, 1)} ч·д · ${done}/${periodTasks.length} завершено</span><span class="p360-band-label">Основная команда</span><span class="p360-band">${owners.map(([name, rows], index) => `<i style="width:${rows.length / periodTasks.length * 100}%;background:${LT_MAP_COLORS[index % LT_MAP_COLORS.length]}" title="${escapeHtml(name)}: ${rows.length}"></i>`).join('')}</span><span class="p360-band-label">Вовлечённые</span><span class="p360-band p360-band-involved">${partners.map(([name, rows], index) => `<i style="width:${partnerTotal ? rows.length / partnerTotal * 100 : 0}%;background:${LT_MAP_COLORS[(index + 3) % LT_MAP_COLORS.length]}" title="${escapeHtml(name)}: ${rows.length}"></i>`).join('')}</span></button>`;
  }).join('');
  const adhoc = tasks.filter(task => /AD.?HOC|ВНЕПЛАН/i.test(task.task_type_name || ''));
  const involvedTasks = tasks.filter(task => (task.involved_team_names || []).length);
  const involvedEffort = involvedTasks.reduce((sum, task) => sum + n(task.effort_days), 0);
  const peak = visibleQuarters.map(period => ({ period, tasks: tasks.filter(task => inPeriod(task, period.id)) })).sort((a, b) => b.tasks.length - a.tasks.length)[0];
  const activeIndex = quarters.findIndex(period => period.id === ltData.active_period);
  const overdue = tasks.filter(task => { if (p360IsDone(task) || activeIndex < 0) return false; const indexes = (task.period_ids || []).map(id => quarters.findIndex(period => period.id === id)).filter(index => index >= 0); return indexes.length > 0 && Math.max(...indexes) < activeIndex; });
  const signals = [
    { cls: teams.length >= 4 ? 'is-warn' : 'is-good', text: `${teams.length} команд в контуре проекта${teams.length >= 4 ? ' — требуется явная координация' : ''}`, tasks: [] },
    { cls: totalEffort && involvedEffort / totalEffort >= .5 ? 'is-warn' : involvedTasks.length ? '' : 'is-good', text: involvedTasks.length ? `${totalEffort ? `${fmt(involvedEffort / totalEffort * 100)}% трудозатрат` : `${involvedTasks.length} задач`} — с вовлечением других команд` : 'Межкомандные зависимости не указаны', tasks: involvedTasks },
    ...(peak ? [{ cls: '', text: `Пиковый квартал — ${peak.period.label}: ${peak.tasks.length} ${effortPlural(peak.tasks.length)}`, tasks: peak.tasks }] : []),
    { cls: adhoc.length / tasks.length >= .3 ? 'is-warn' : '', text: `Доля ad-hoc — ${fmt(adhoc.length / tasks.length * 100)}% (${adhoc.length} ${effortPlural(adhoc.length)})`, tasks: adhoc },
    { cls: overdue.length ? 'is-danger' : 'is-good', text: overdue.length ? `${overdue.length} незавершённых задач с прошедшим сроком` : 'Просроченных незавершённых задач нет', tasks: overdue },
    ...(involved.length ? [{ cls: involved[0][1].length >= Math.ceil(tasks.length / 3) ? 'is-warn' : '', text: `Ключевая зависимость — ${involved[0][0]}: ${involved[0][1].length} ${effortPlural(involved[0][1].length)}`, tasks: involved[0][1].map(item => item.task) }] : []),
  ];
  const accordionOpen = section => state.projectOpenSection === section ? ' open' : '';
  document.getElementById('project-content').innerHTML = `<div class="p360-accordions">
    <section class="p360-accordion p360-always-open"><div class="p360-accordion-body"><div class="p360-timeline-toolbar"><span>Сроки и состав команд по кварталам</span><small>${visibleQuarters.length} ${visibleQuarters.length === 1 ? 'квартал' : visibleQuarters.length < 5 ? 'квартала' : 'кварталов'}</small></div><div class="p360-timeline">${timeline || '<div class="an-empty">У задач проекта нет квартальных сроков</div>'}</div><div id="p360-timeline-detail" class="an-detail p360-timeline-detail"></div></div></section>
    <details class="p360-accordion" name="p360-sections" data-p360-section="flow"${accordionOpen('flow')}><summary><span>Контур ответственности</span><small class="p360-panel-meta">${teams.length} основных · ${involved.length} вовлечённых</small></summary><div class="p360-accordion-body"><div class="p360-flow-toolbar"><div><select id="p360-flow-period" aria-label="Срок выполнения"></select><select id="p360-flow-channel" aria-label="Спрос"></select><span id="p360-flow-filter-state"></span></div><button id="p360-flow-reset" class="p360-flow-reset" type="button">× Сбросить</button></div><div id="p360-flow" class="p360-flow-wrap"><svg id="p360-flow-svg" viewBox="0 0 940 420" role="img" aria-label="Поток ответственности: заказчики, основные и вовлечённые команды"></svg></div><div id="p360-flow-actions" class="p360-flow-actions"><button id="p360-flow-view-tasks" type="button">Посмотреть задачи</button></div><div id="p360-flow-detail" class="an-detail p360-flow-detail"></div></div></details>
    <details class="p360-accordion" name="p360-sections" data-p360-section="mix"${accordionOpen('mix')}><summary><span>Структура работ</span><small class="p360-panel-meta">${types.length} типов задач</small></summary><div class="p360-accordion-body"><div class="p360-panel-head"><small>Распределение по типам задач</small><span class="p360-toggle"><button class="${state.projectMetric === 'count' ? 'is-on' : ''}" data-p360-metric="count" type="button">Задачи</button><button class="${state.projectMetric === 'effort' ? 'is-on' : ''}" data-p360-metric="effort" type="button" ${totalEffort ? '' : 'disabled'}>Трудозатраты</button></span></div><div class="p360-mixbar">${renderMixBar(types, metricTotal)}</div><div class="p360-mixlegend">${types.map(item => `<button data-p360-type="${escapeHtml(item.name)}"><i style="background:${typeColors[item.name]}"></i><span>${escapeHtml(item.name)} · ${state.projectMetric === 'effort' ? `${fmt(item.effort, 1)} ч·д` : `${item.count} ${effortPlural(item.count)}`}</span></button>`).join('')}</div><div class="p360-team-mixes"><div class="p360-team-mixes-title">По основным командам</div><div class="p360-team-mix-list">${teamMixes.map(item => `<div class="p360-team-mix-row"><button class="p360-team-mix-name" data-p360-team="${escapeHtml(item.team)}" type="button">${escapeHtml(item.team)}</button><div class="p360-team-mixbar">${renderMixBar(item.stats, item.total, item.team)}</div></div>`).join('')}</div></div></div></details>
    <details class="p360-accordion" name="p360-sections" data-p360-section="signals"${accordionOpen('signals')}><summary><span>Управленческие сигналы</span><small class="p360-panel-meta">${signals.length} сигналов</small></summary><div class="p360-accordion-body"><div class="p360-signal-list">${signals.map((signal, index) => signal.tasks.length ? `<button class="p360-signal ${signal.cls}" data-p360-signal="${index}" type="button"><i></i><span>${escapeHtml(signal.text)}</span></button>` : `<div class="p360-signal ${signal.cls}"><i></i><span>${escapeHtml(signal.text)}</span></div>`).join('')}</div></div></details>
  </div>`;
  bindTasks(document.getElementById('project-content'));

  const renderTimelineDetail = () => {
    clearDetail('p360-timeline-detail');
    document.querySelectorAll('[data-p360-period]').forEach(button => { const selected = button.dataset.p360Period === state.projectQuarter; button.classList.toggle('is-selected', selected); button.setAttribute('aria-pressed', String(selected)); });
    if (!state.projectQuarter) return;
    const period = quarters.find(item => item.id === state.projectQuarter);
    const periodTasks = tasks.filter(task => inPeriod(task, state.projectQuarter));
    const done = periodTasks.filter(p360IsDone).length;
    const source = document.querySelector(`[data-p360-period="${state.projectQuarter}"]`);
    showDetail('p360-timeline-detail', `${period?.label || state.projectQuarter} — задачи`, periodTasks, { subtitle: `${done} завершено · ${periodTasks.length - done} в работе`, breadcrumbs: ['Проект 360°', state.project, period?.label || state.projectQuarter], source, autoScroll: false, onClose: () => { state.projectQuarter = ''; } });
  };
  document.querySelectorAll('[data-p360-period]').forEach(button => button.addEventListener('click', () => { state.projectQuarter = state.projectQuarter === button.dataset.p360Period ? '' : button.dataset.p360Period; renderTimelineDetail(); }));
  renderTimelineDetail();

  document.querySelectorAll('[data-p360-type]').forEach(button => button.addEventListener('click', () => { const team = button.dataset.p360Team || ''; const rows = tasks.filter(task => (task.task_type_name || 'Без типа') === button.dataset.p360Type && (!team || (task.team_name || 'Без команды') === team)); showDetail('project-detail', team ? `${team} · ${button.dataset.p360Type}` : button.dataset.p360Type, rows, { subtitle: state.project, breadcrumbs: ['Проект 360°', state.project, 'Структура работ', ...(team ? [team] : []), button.dataset.p360Type], source: button }); }));
  document.querySelectorAll('.p360-team-mix-name[data-p360-team]').forEach(button => button.addEventListener('click', () => { const rows = tasks.filter(task => (task.team_name || 'Без команды') === button.dataset.p360Team); showDetail('project-detail', button.dataset.p360Team, rows, { subtitle: state.project, breadcrumbs: ['Проект 360°', state.project, 'Структура работ', button.dataset.p360Team], source: button }); }));
  document.querySelectorAll('[data-p360-metric]').forEach(button => button.addEventListener('click', () => { state.projectMetric = button.dataset.p360Metric; state.projectOpenSection = 'mix'; project360(); }));
  document.querySelectorAll('[data-p360-signal]').forEach(button => button.addEventListener('click', () => { const signal = signals[Number(button.dataset.p360Signal)]; showDetail('project-detail', signal.text, signal.tasks, { subtitle: state.project, breadcrumbs: ['Проект 360°', state.project, 'Управленческие сигналы'], source: button }); }));

  document.querySelectorAll('#an-project360 details.p360-accordion>summary').forEach(summary => summary.addEventListener('click', event => {
    event.preventDefault();
    const details = summary.parentElement;
    const top = summary.getBoundingClientRect().top;
    const opening = !details.open;
    document.querySelectorAll('#an-project360 details.p360-accordion').forEach(item => { item.open = false; });
    details.open = opening;
    state.projectOpenSection = opening ? details.dataset.p360Section : '';
    requestAnimationFrame(() => { const delta = summary.getBoundingClientRect().top - top; if (Math.abs(delta) > 1) window.scrollBy(0, delta); summary.focus({ preventScroll: true }); });
  }));

  let flowNodes = [], flowEdges = [];
  const updateFlowSelection = () => {
    const selection = state.projectFlowSelection;
    const related = new Set();
    if (selection?.kind === 'node') { related.add(selection.key); flowEdges.filter(edge => edge.source === selection.key || edge.target === selection.key).forEach(edge => { related.add(edge.source); related.add(edge.target); }); }
    if (selection?.kind === 'edge') { const edge = flowEdges.find(item => item.key === selection.key); if (edge) { related.add(edge.source); related.add(edge.target); } }
    document.querySelectorAll('[data-p360-flow-node]').forEach(element => { const node = flowNodes[Number(element.dataset.p360FlowNode)]; element.classList.toggle('is-selected', selection?.kind === 'node' && selection.key === node.key); element.classList.toggle('is-active', related.has(node.key)); element.classList.toggle('is-dim', Boolean(selection) && !related.has(node.key)); });
    document.querySelectorAll('[data-p360-flow-edge]').forEach(element => { const edge = flowEdges[Number(element.dataset.p360FlowEdge)]; const direct = selection?.kind === 'edge' ? selection.key === edge.key : selection?.kind === 'node' && (selection.key === edge.source || selection.key === edge.target); element.classList.toggle('is-direct', direct); element.classList.toggle('is-dim', Boolean(selection) && !direct); });
    const actions = document.getElementById('p360-flow-actions');
    if (actions) actions.classList.toggle('is-visible', Boolean(selection));
    document.getElementById('p360-flow-reset')?.classList.toggle('is-visible', Boolean(selection || state.projectFlowPeriod || state.projectFlowChannel));
    if (!selection) clearDetail('p360-flow-detail');
  };
  const renderFlow = () => {
    clearDetail('p360-flow-detail');
    state.projectFlowSelection = null;
    for (let pass = 0; pass < 2; pass += 1) {
      const periods = visibleQuarters.filter(period => tasks.some(task => inPeriod(task, period.id) && (!state.projectFlowChannel || p360ChannelKey(task) === state.projectFlowChannel)));
      if (state.projectFlowPeriod && !periods.some(period => period.id === state.projectFlowPeriod)) state.projectFlowPeriod = '';
      const channels = P360_CHANNELS.filter(channel => tasks.some(task => p360ChannelKey(task) === channel.value && (!state.projectFlowPeriod || inPeriod(task, state.projectFlowPeriod))));
      if (state.projectFlowChannel && !channels.some(channel => channel.value === state.projectFlowChannel)) state.projectFlowChannel = '';
    }
    const periodOptions = visibleQuarters.filter(period => tasks.some(task => inPeriod(task, period.id) && (!state.projectFlowChannel || p360ChannelKey(task) === state.projectFlowChannel)));
    const channelOptions = P360_CHANNELS.filter(channel => tasks.some(task => p360ChannelKey(task) === channel.value && (!state.projectFlowPeriod || inPeriod(task, state.projectFlowPeriod))));
    const periodSelect = document.getElementById('p360-flow-period'), channelSelect = document.getElementById('p360-flow-channel');
    periodSelect.innerHTML = '<option value="">Все сроки</option>' + periodOptions.map(period => periodOption(period, state.projectFlowPeriod)).join('');
    channelSelect.innerHTML = '<option value="">Весь спрос</option>' + channelOptions.map(channel => `<option value="${channel.value}" ${channel.value === state.projectFlowChannel ? 'selected' : ''}>${channel.label}</option>`).join('');
    const flowTasks = tasks.filter(task => (!state.projectFlowPeriod || inPeriod(task, state.projectFlowPeriod)) && (!state.projectFlowChannel || p360ChannelKey(task) === state.projectFlowChannel));
    document.getElementById('p360-flow-filter-state').textContent = `${flowTasks.length} ${effortPlural(flowTasks.length)}`;
    const stats = (rows, value) => Object.entries(by(rows, value)).map(([name, statTasks]) => ({ name, tasks: statTasks, value: statTasks.length, effort: statTasks.reduce((sum, task) => sum + n(task.effort_days), 0) })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'ru'));
    const rawCustomers = stats(flowTasks, task => task.department_name || 'Заказчик не указан');
    const customerMap = new Map(), customers = rawCustomers.slice(0, 6);
    customers.forEach(item => customerMap.set(item.name, item.name));
    if (rawCustomers.length > 6) { const otherTasks = rawCustomers.slice(6).flatMap(item => item.tasks); rawCustomers.slice(6).forEach(item => customerMap.set(item.name, 'Прочие заказчики')); customers.push({ name: 'Прочие заказчики', tasks: otherTasks, value: otherTasks.length, effort: otherTasks.reduce((sum, task) => sum + n(task.effort_days), 0) }); }
    const owners = stats(flowTasks, task => task.team_name || 'Без команды');
    const partners = stats(flowTasks.flatMap(task => (task.involved_team_names || []).map(name => ({ ...task, __p360Partner: name }))), task => task.__p360Partner);
    flowNodes = [...customers.map(item => ({ ...item, kind: 'customer', key: `customer:${item.name}` })), ...owners.map(item => ({ ...item, kind: 'owner', key: `owner:${item.name}` })), ...partners.map(item => ({ ...item, kind: 'involved', key: `involved:${item.name}` }))];
    const edgeMap = new Map();
    const addEdge = (source, target, task) => { const key = `${source}\u0001${target}`; if (!edgeMap.has(key)) edgeMap.set(key, { key, source, target, tasks: [], value: 0, effort: 0 }); const edge = edgeMap.get(key); edge.tasks.push(task); edge.value += 1; edge.effort += n(task.effort_days); };
    flowTasks.forEach(task => { addEdge(`customer:${customerMap.get(task.department_name || 'Заказчик не указан') || task.department_name || 'Заказчик не указан'}`, `owner:${task.team_name || 'Без команды'}`, task); (task.involved_team_names || []).forEach(name => addEdge(`owner:${task.team_name || 'Без команды'}`, `involved:${name}`, task)); });
    flowEdges = [...edgeMap.values()];
    const columns = [['customer', 18, 'Заказчики'], ['owner', 365, 'Основные команды'], ['involved', 712, 'Вовлечённые команды']];
    const nodeWidth = 210, nodeHeight = 36, top = 50, bottom = 22, maxCount = Math.max(1, ...columns.map(([kind]) => flowNodes.filter(node => node.kind === kind).length));
    const height = Math.max(250, top + maxCount * nodeHeight + Math.max(0, maxCount - 1) * 10 + bottom);
    const positions = new Map();
    columns.forEach(([kind, x]) => { const nodes = flowNodes.filter(node => node.kind === kind), used = nodes.length * nodeHeight, gap = nodes.length > 1 ? Math.max(8, (height - top - bottom - used) / (nodes.length - 1)) : 0, block = used + Math.max(0, nodes.length - 1) * gap; let y = top + Math.max(0, (height - top - bottom - block) / 2); nodes.forEach(node => { positions.set(node.key, { x, y }); y += nodeHeight + gap; }); });
    const curve = edge => { const source = positions.get(edge.source), target = positions.get(edge.target), x0 = source.x + nodeWidth, y0 = source.y + nodeHeight / 2, x1 = target.x, y1 = target.y + nodeHeight / 2, middle = (x0 + x1) / 2; return `M${x0},${y0} C${middle},${y0} ${middle},${y1} ${x1},${y1}`; };
    const short = value => value.length > 29 ? `${value.slice(0, 28)}…` : value;
    const svg = document.getElementById('p360-flow-svg');
    svg.setAttribute('viewBox', `0 0 940 ${height}`);
    svg.innerHTML = columns.map(([, x, label]) => `<text class="p360-flow-stage" x="${x}" y="20">${label}</text>`).join('') + flowEdges.map((edge, index) => { const target = flowNodes.find(node => node.key === edge.target), color = target?.kind === 'owner' || target?.kind === 'involved' ? LT_MAP_COLORS[Math.max(0, flowNodes.filter(node => node.kind === target.kind).findIndex(node => node.key === target.key)) % LT_MAP_COLORS.length] : '#94a3b8'; return `<path class="p360-flow-link" data-p360-flow-edge="${index}" d="${curve(edge)}" stroke="${color}" stroke-width="${Math.min(8, 1.4 + Math.sqrt(edge.value) * 1.25)}"><title>${escapeHtml(`${flowNodes.find(node => node.key === edge.source)?.name} → ${target?.name}: ${edge.value} ${effortPlural(edge.value)} · ${fmt(edge.effort, 1)} ч·д`)}</title></path>`; }).join('') + flowNodes.map((node, index) => { const position = positions.get(node.key), colorIndex = flowNodes.filter(item => item.kind === node.kind).findIndex(item => item.key === node.key), color = node.kind === 'customer' ? '#94a3b8' : LT_MAP_COLORS[colorIndex % LT_MAP_COLORS.length]; return `<g class="p360-flow-node" data-p360-flow-node="${index}" tabindex="0" role="button" aria-label="${escapeHtml(`${node.name}: ${node.value} ${effortPlural(node.value)}`)}"><rect x="${position.x}" y="${position.y}" width="${nodeWidth}" height="${nodeHeight}" rx="9"></rect><circle cx="${position.x + 13}" cy="${position.y + 13}" r="4" fill="${color}"></circle><text class="p360-flow-node-title" x="${position.x + 24}" y="${position.y + 16}">${escapeHtml(short(node.name))}</text><text class="p360-flow-node-meta" x="${position.x + 24}" y="${position.y + 29}">${node.value} ${effortPlural(node.value)}${node.effort ? ` · ${fmt(node.effort, 1)} ч·д` : ''}</text></g>`; }).join('');
    const selectFlowItem = (kind, item) => { const same = state.projectFlowSelection?.kind === kind && state.projectFlowSelection.key === item.key; state.projectFlowSelection = same ? null : { kind, key: item.key }; updateFlowSelection(); };
    document.querySelectorAll('[data-p360-flow-node]').forEach(element => { const activate = event => { if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return; if (event.type === 'keydown') event.preventDefault(); selectFlowItem('node', flowNodes[Number(element.dataset.p360FlowNode)]); }; element.addEventListener('click', activate); element.addEventListener('keydown', activate); });
    document.querySelectorAll('[data-p360-flow-edge]').forEach(element => element.addEventListener('click', () => selectFlowItem('edge', flowEdges[Number(element.dataset.p360FlowEdge)])));
    updateFlowSelection();
  };
  document.getElementById('p360-flow-period').addEventListener('change', event => { state.projectFlowPeriod = event.target.value; renderFlow(); });
  document.getElementById('p360-flow-channel').addEventListener('change', event => { state.projectFlowChannel = event.target.value; renderFlow(); });
  document.getElementById('p360-flow-reset').addEventListener('click', () => { state.projectFlowPeriod = ''; state.projectFlowChannel = ''; state.projectFlowSelection = null; renderFlow(); });
  document.getElementById('p360-flow-view-tasks').addEventListener('click', () => { const selection = state.projectFlowSelection; const item = selection?.kind === 'node' ? flowNodes.find(node => node.key === selection.key) : flowEdges.find(edge => edge.key === selection?.key); if (!item) return; const title = selection.kind === 'node' ? item.name : `${flowNodes.find(node => node.key === item.source)?.name} → ${flowNodes.find(node => node.key === item.target)?.name}`; showDetail('p360-flow-detail', title, item.tasks, { subtitle: `${item.tasks.length} ${effortPlural(item.tasks.length)}`, breadcrumbs: ['Проект 360°', state.project, 'Контур ответственности', title], autoScroll: false }); });
  renderFlow();
}

function renderRoi() {
  const tasks = (ltData.tasks || []).filter(task => (!state.roi.period || inPeriod(task, state.roi.period)) && (!state.roi.team || task.team_name === state.roi.team) && (!state.roi.type || task.task_type_name === state.roi.type)), groups = {};
  tasks.forEach(task => {
    const effort = n(task.effort_days), effect = n(task.financial_effect);
    if (!effort || !effect) return;
    const project = task.project_name || 'Без проекта';
    const group = groups[project] ||= { name: project, value: 0, effort: 0, tasks: [], teams: {} };
    group.value = Math.max(group.value, effect); group.effort += effort; group.tasks.push(task); group.teams[task.team_name || 'Без команды'] = (group.teams[task.team_name || 'Без команды'] || 0) + 1;
  });
  const list = Object.values(groups).map(group => {
    group.team = Object.entries(group.teams).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Без команды';
    group.teamNames = Object.keys(group.teams).sort((a, b) => a.localeCompare(b, 'ru'));
    return group;
  }).sort((a, b) => b.effort - a.effort);
  const teamNames = uniq(list.map(group => group.team)), colors = Object.fromEntries(teamNames.map((team, index) => [team, LT_MAP_COLORS[index % LT_MAP_COLORS.length]]));
  document.getElementById('roi-count').innerHTML = `<b>${list.length}</b> групп · ${list.reduce((sum, group) => sum + group.tasks.length, 0)} задач из ${tasks.length} с обеими метриками`;
  document.getElementById('roi-legend').innerHTML = teamNames.map(team => `<span class="roi-leg"><i style="background:${colors[team]}"></i>${escapeHtml(team)}</span>`).join('') + '<span class="roi-leg">размер круга — фин. эффект</span>';
  const svg = document.getElementById('roi-svg');
  if (!list.length) { svg.setAttribute('viewBox', '0 0 940 120'); svg.innerHTML = '<text x="470" y="60" text-anchor="middle" class="roi-axis-title">Нет задач, где заполнены и трудозатраты, и фин. эффект</text>'; document.getElementById('roi-table-title').textContent = 'Нет групп'; document.getElementById('roi-clear-quad').hidden = true; document.getElementById('roi-table-body').innerHTML = '<div class="an-empty">Нет групп в выбранном срезе</div>'; return; }
  const W = 940, ML = 66, MR = 24, MT = 26, plotH = 430, bottom = 46, x0 = ML, y0 = MT, pw = W - ML - MR, yBase = y0 + plotH;
  const medEffort = median(list.map(group => group.effort)), medValue = median(list.map(group => group.value));
  list.forEach(group => { group.quad = (group.effort >= medEffort ? 1 : 0) + (group.value >= medValue ? 0 : 2); });
  const maxEffort = Math.max(...list.map(group => group.effort)) * 1.08 || 1, maxValue = Math.max(...list.map(group => group.value)) * 1.14 || 1;
  const X = value => x0 + value / maxEffort * pw, Y = value => yBase - value / maxValue * plotH, maxBubble = Math.max(...list.map(group => group.value), 1), R = value => 6 + Math.sqrt(value / maxBubble) * 12;
  const sx = X(medEffort), sy = Y(medValue), zone = (q, x, y, width, height, danger = false) => `<rect class="roi-zone${danger ? ' roi-zone-danger' : ''}" data-quad="${q}" x="${x}" y="${y}" width="${Math.max(0, width)}" height="${Math.max(0, height)}"></rect>`;
  let content = zone(0, x0, y0, sx - x0, sy - y0) + zone(1, sx, y0, x0 + pw - sx, sy - y0) + zone(2, x0, sy, sx - x0, yBase - sy) + zone(3, sx, sy, x0 + pw - sx, yBase - sy, true);
  for (let index = 0; index <= 4; index += 1) {
    const gy = yBase - index / 4 * plotH, gx = x0 + index / 4 * pw;
    content += `<line class="roi-grid" x1="${x0}" y1="${gy}" x2="${x0 + pw}" y2="${gy}"></line><text class="roi-tick" x="${x0 - 8}" y="${gy + 3.5}" text-anchor="end">${Math.round(maxValue * index / 4)}</text><text class="roi-tick" x="${gx}" y="${yBase + 16}" text-anchor="middle">${Math.round(maxEffort * index / 4)}</text>`;
  }
  content += `<line class="roi-axis" x1="${x0}" y1="${yBase}" x2="${x0 + pw}" y2="${yBase}"></line><line class="roi-axis" x1="${x0}" y1="${y0}" x2="${x0}" y2="${yBase}"></line><text class="roi-axis-title" x="${x0 + pw}" y="${yBase + 34}" text-anchor="end">Трудозатраты, ч/д</text><text class="roi-axis-title" x="${x0}" y="${y0 - 10}">Фин. эффект, млн руб.</text><line class="roi-split" x1="${sx}" y1="${y0}" x2="${sx}" y2="${yBase}"></line><line class="roi-split" x1="${x0}" y1="${sy}" x2="${x0 + pw}" y2="${sy}"></line>`;
  content += `<g class="roi-chip-group" data-roi-quad="0"><rect class="roi-chip" x="${x0 + 4}" y="${y0 + 1}" width="112" height="18" rx="5"></rect><text class="roi-quad-label" x="${x0 + 10}" y="${y0 + 14}">Дёшево и ценно</text></g><g class="roi-chip-group" data-roi-quad="1"><rect class="roi-chip" x="${x0 + pw - 130}" y="${y0 + 1}" width="126" height="18" rx="5"></rect><text class="roi-quad-label" x="${x0 + pw - 10}" y="${y0 + 14}" text-anchor="end">Дорого, но ценно</text></g><g class="roi-chip-group" data-roi-quad="2"><rect class="roi-chip" x="${x0 + 4}" y="${sy + 21}" width="138" height="18" rx="5"></rect><text class="roi-quad-label" x="${x0 + 10}" y="${sy + 34}">Дёшево и не ценно</text></g><g class="roi-chip-group" data-roi-quad="3"><rect class="roi-chip roi-chip-danger" x="${x0 + pw - 146}" y="${sy + 21}" width="142" height="18" rx="5"></rect><text class="roi-quad-label roi-quad-danger" x="${x0 + pw - 10}" y="${sy + 34}" text-anchor="end">Дорого и не ценно</text></g>`;
  list.forEach((group, index) => {
    const cx = X(group.effort), cy = Y(group.value), radius = R(group.value), short = group.name.length > 22 ? `${group.name.slice(0, 21)}…` : group.name;
    content += `<circle class="roi-dot" cx="${cx}" cy="${cy}" r="${radius}" fill="${colors[group.team]}" fill-opacity=".75" stroke="var(--bg-secondary)" stroke-width="1.5" data-roi-index="${index}"></circle><text class="roi-dot-label" x="${cx + radius + 4}" y="${cy + 3}">${escapeHtml(short)}</text>`;
  });
  svg.setAttribute('viewBox', `0 0 ${W} ${yBase + bottom}`); svg.innerHTML = content;
  const quadNames = ['Дёшево и ценно', 'Дорого, но ценно', 'Дёшево и не ценно', 'Дорого и не ценно'];
  const tableGroups = state.roi.quad === '' ? list : list.filter(group => group.quad === Number(state.roi.quad));
  document.getElementById('roi-table-title').textContent = state.roi.quad === '' ? `Все группы · ${tableGroups.length}` : `${quadNames[Number(state.roi.quad)]} · ${tableGroups.length}`;
  document.getElementById('roi-clear-quad').hidden = state.roi.quad === '';
  const sortedTableGroups = [...tableGroups].sort((a, b) => (b.effort * 18000 / 1000000 / b.value) - (a.effort * 18000 / 1000000 / a.value));
  document.getElementById('roi-table-body').innerHTML = sortedTableGroups.map(group => {
    const index = list.indexOf(group);
    const cir = group.effort * 18000 / 1000000 / group.value * 100;
    const children = group.teamNames.map((team, teamIndex) => {
      const teamTasks = group.tasks.filter(task => (task.team_name || 'Без команды') === team);
      const teamEffort = teamTasks.reduce((sum, task) => sum + n(task.effort_days), 0);
      const teamKey = `${index}-${teamIndex}`;
      return `<div class="roi-team-group"><div class="roi-team-row is-collapsed" data-roi-parent="${index}" data-roi-team-row="${teamKey}" role="row"><button type="button" class="roi-team-toggle" aria-expanded="false"><span class="an-tree-toggle-icon roi-chevron" aria-hidden="true"></span><span class="roi-level-label">Команда</span><b>${escapeHtml(team)}</b><small>${teamTasks.length} ${effortPlural(teamTasks.length)}</small></button><span></span><span>${teamTasks.length}</span><span>${fmt(teamEffort, 1)} ч/д</span><span></span><span></span></div><div class="roi-team-children an-tree-children" hidden>${teamTasks.map(task => `<div class="roi-task-row" data-roi-parent="${index}" data-roi-team-task="${teamKey}" role="row"><button type="button" class="roi-task-link" data-task-id="${task.id}"><span class="roi-level-label">Задача</span><span class="roi-task-id">${escapeHtml(taskName(task))}</span><span class="roi-task-title">${escapeHtml(task.title)}</span></button><span></span><span></span><span>${task.effort_days == null ? '—' : `${fmt(task.effort_days, 1)} ч/д`}</span><span>${task.financial_effect == null ? '—' : `${fmt(task.financial_effect, 1)} млн ₽`}</span><span></span></div>`).join('')}</div></div>`;
    }).join('');
    const teamLabel = group.teamNames.length === 1 ? group.teamNames[0] : `${group.teamNames.length} ${group.teamNames.length < 5 ? 'команды' : 'команд'}`;
    return `<div class="roi-project-group"><div class="roi-project-row" data-roi-row="${index}" role="row"><button type="button" class="roi-project-toggle" aria-expanded="false"><span class="an-tree-toggle-icon roi-chevron" aria-hidden="true"></span><span class="roi-level-label">Проект</span><span>${escapeHtml(group.name)}</span></button><span>${escapeHtml(teamLabel)}</span><span>${group.tasks.length}</span><span>${fmt(group.effort, 1)} ч/д</span><span>${fmt(group.value, 1)} млн ₽</span><span class="${cir > 100 ? 'roi-cell-bad' : cir <= 30 ? 'roi-cell-good' : ''}">${fmt(cir, 1)}%</span></div><div class="roi-project-children an-tree-children" hidden>${children}</div></div>`;
  }).join('') || '<div class="an-empty">Нет групп в выбранном срезе</div>';
  const setRoiProjectOpen = (row, open) => {
    const index = row.dataset.roiRow;
    row.classList.toggle('is-open', open);
    row.querySelector('.roi-project-toggle').setAttribute('aria-expanded', String(open));
    const children = row.nextElementSibling;
    if (children?.classList.contains('roi-project-children')) children.hidden = !open;
    document.querySelectorAll(`#roi-table-body .roi-team-children`).forEach(taskGroup => { if (taskGroup.closest('.roi-project-group') === row.closest('.roi-project-group')) taskGroup.hidden = true; });
    if (!open) document.querySelectorAll(`#roi-table-body [data-roi-team-row^="${index}-"]`).forEach(teamRow => { teamRow.classList.add('is-collapsed'); teamRow.querySelector('.roi-team-toggle').setAttribute('aria-expanded', 'false'); });
  };
  const setRoiTeamOpen = (row, open) => {
    row.classList.toggle('is-collapsed', !open);
    row.querySelector('.roi-team-toggle').setAttribute('aria-expanded', String(open));
    const children = row.nextElementSibling;
    if (children?.classList.contains('roi-team-children')) children.hidden = !open;
  };
  document.querySelectorAll('#roi-table-body .roi-project-toggle').forEach(button => button.addEventListener('click', () => {
    const row = button.closest('[data-roi-row]');
    setRoiProjectOpen(row, !row.classList.contains('is-open'));
  }));
  document.querySelectorAll('#roi-table-body .roi-team-toggle').forEach(button => button.addEventListener('click', () => {
    const row = button.closest('[data-roi-team-row]');
    setRoiTeamOpen(row, row.classList.contains('is-collapsed'));
  }));
  document.getElementById('roi-expand-all')?.addEventListener('click', () => {
    document.querySelectorAll('#roi-table-body .roi-project-row').forEach(row => setRoiProjectOpen(row, true));
    document.querySelectorAll('#roi-table-body .roi-team-row').forEach(row => setRoiTeamOpen(row, true));
  });
  document.getElementById('roi-collapse-all')?.addEventListener('click', () => {
    document.querySelectorAll('#roi-table-body .roi-project-row').forEach(row => setRoiProjectOpen(row, false));
  });
  document.querySelectorAll('#roi-table-body .roi-task-link').forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: Number(button.dataset.taskId) } }));
  }));
  svg.querySelectorAll('[data-roi-quad]').forEach(chip => chip.addEventListener('click', () => { state.roi.quad = chip.dataset.roiQuad; renderRoi(); }));
  const tooltip = document.getElementById('roi-tooltip'), wrap = document.querySelector('.roi-wrap');
  svg.querySelectorAll('[data-roi-index]').forEach(dot => {
    const group = list[Number(dot.dataset.roiIndex)], cost = group.effort * 18000 / 1000000, cir = cost / group.value * 100;
    dot.addEventListener('mouseenter', event => { tooltip.innerHTML = `<b>${escapeHtml(group.name)}</b><div class="roi-tt-row">${escapeHtml(group.team)} · ${group.tasks.length} задач</div><div class="roi-tt-row">Трудозатраты: ${fmt(group.effort, 1)} ч/д · ${fmt(cost, 1)} млн руб.</div><div class="roi-tt-row">Фин. эффект: ${fmt(group.value, 1)} млн руб.</div><div class="${cir > 100 ? 'roi-tt-bad' : cir <= 30 ? 'roi-tt-good' : 'roi-tt-row'}">CIR: ${fmt(cir, 1)}%</div>`; tooltip.classList.add('is-visible'); const box = wrap.getBoundingClientRect(); tooltip.style.left = `${Math.min(event.clientX - box.left + 14, box.width - 290)}px`; tooltip.style.top = `${event.clientY - box.top + 14}px`; });
    dot.addEventListener('mouseleave', () => tooltip.classList.remove('is-visible'));
    dot.setAttribute('tabindex', '0');
    dot.setAttribute('role', 'button');
    dot.setAttribute('aria-label', `Открыть проект ${group.name} в таблице`);
    const openProject = () => {
      const index = dot.dataset.roiIndex;
      const reveal = () => {
        const row = document.querySelector(`#roi-table-body [data-roi-row="${index}"]`);
        if (!row) return;
        document.querySelectorAll('#roi-svg .roi-dot.is-selected, #roi-table-body .roi-project-row.is-selected').forEach(item => item.classList.remove('is-selected'));
        document.querySelector(`#roi-svg .roi-dot[data-roi-index="${index}"]`)?.classList.add('is-selected');
        row.classList.add('is-selected');
        setRoiProjectOpen(row, true);
        row.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
        row.querySelector('.roi-project-toggle')?.focus({ preventScroll: true });
      };
      if (!document.querySelector(`#roi-table-body [data-roi-row="${index}"]`) && state.roi.quad !== '') {
        state.roi.quad = '';
        renderRoi();
        window.requestAnimationFrame(reveal);
      } else reveal();
    };
    dot.addEventListener('click', openProject);
    dot.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); openProject(); } });
  });
}

function bindSelect(id, value, handler) { const el = document.getElementById(id); if (!el) return; el.value = value; el.addEventListener('change', () => handler(el.value)); }

function bindAnalyticsNavigation() {
  const nav = document.querySelector('.an-report-nav');
  if (!nav) return;
  const buttons = [...nav.querySelectorAll('[data-analytics-target]')];
  const root = document.getElementById('page-content');
  const updateActive = () => {
    const marker = nav.getBoundingClientRect().bottom + 24;
    let current = LT_REPORTS[0][0];
    LT_REPORTS.forEach(([id]) => { const report = document.getElementById(id); if (report && report.getBoundingClientRect().top <= marker) current = id; });
    buttons.forEach(item => item.classList.toggle('is-active', item.dataset.analyticsTarget === current));
  };
  buttons.forEach(button => button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.analyticsTarget);
    if (!target) return;
    buttons.forEach(item => item.classList.toggle('is-active', item === button));
    target.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }));
  if (root) {
    if (window.__analyticsNavScroll) root.removeEventListener('scroll', window.__analyticsNavScroll);
    let scheduled = false;
    window.__analyticsNavScroll = () => { if (scheduled) return; scheduled = true; window.requestAnimationFrame(() => { scheduled = false; updateActive(); }); };
    root.addEventListener('scroll', window.__analyticsNavScroll, { passive: true });
  }
  updateActive();
}

function initEffortControls(teams) {
  const period = document.getElementById('effort-period');
  period.innerHTML = periodOptions(state.effort.period);
  bindSelect('effort-period', state.effort.period, value => { state.effort.period = value; renderEffort(); });
  const dropdown = document.getElementById('effortTeamDd'), panel = document.getElementById('effortTeamPanel'), label = document.getElementById('effortTeamName');
  panel.innerHTML = [{ value: '', label: 'Весь трайб' }, ...teams.map(team => ({ value: team, label: team }))].map(item => `<button class="dd-item ${item.value === state.effort.team ? 'sel' : ''}" data-value="${escapeHtml(item.value)}" type="button"><span>${escapeHtml(item.label)}</span><svg class="chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button>`).join('');
  document.getElementById('effortTeamBtn').addEventListener('click', event => { event.stopPropagation(); const open = dropdown.classList.toggle('open'); event.currentTarget.setAttribute('aria-expanded', String(open)); });
  panel.querySelectorAll('.dd-item').forEach(button => button.addEventListener('click', () => { state.effort.team = button.dataset.value; label.textContent = state.effort.team || 'Весь трайб'; panel.querySelectorAll('.dd-item').forEach(item => item.classList.toggle('sel', item === button)); dropdown.classList.remove('open'); document.getElementById('effortTeamBtn').setAttribute('aria-expanded', 'false'); renderEffort(); }));
  if (window.__analyticsEffortOutside) document.removeEventListener('click', window.__analyticsEffortOutside);
  window.__analyticsEffortOutside = event => { if (!dropdown.contains(event.target)) dropdown.classList.remove('open'); };
  document.addEventListener('click', window.__analyticsEffortOutside);
  document.querySelectorAll('#an-effort .rep-table th.sortable').forEach(th => th.addEventListener('click', () => { const col = th.dataset.col; if (state.effort.sortCol === col) state.effort.sortDir *= -1; else { state.effort.sortCol = col; state.effort.sortDir = col === 'name' ? 1 : -1; } sortEffortRows(true); }));
}

function initLt() {
  const tasks = ltData.tasks || [];
  bindAnalyticsDetailEscape();
  state.effort.period ||= ltData.active_period; state.profile.period ||= ltData.active_period; state.dep.period ||= ltData.active_period; state.sankey.period ||= ltData.active_period; state.roi.period ||= ltData.active_period;
  const channels = uniq(tasks.map(t => t.channel_name)), types = uniq(tasks.map(t => t.task_type_name));
  bindAnalyticsNavigation();
  initEffortControls(uniq(tasks.map(t => t.team_name)));
  document.getElementById('roi-period').innerHTML = '<option value="">Все периоды</option>' + periodOptions(state.roi.period);
  document.getElementById('roi-team').innerHTML = options(uniq(tasks.map(task => task.team_name)), state.roi.team, 'Все команды');
  document.getElementById('roi-type').innerHTML = options(types, state.roi.type, 'Все типы');
  bindSelect('roi-period', state.roi.period, value => { state.roi.period = value; state.roi.quad = ''; renderRoi(); });
  bindSelect('roi-team', state.roi.team, value => { state.roi.team = value; state.roi.quad = ''; renderRoi(); });
  bindSelect('roi-type', state.roi.type, value => { state.roi.type = value; state.roi.quad = ''; renderRoi(); });
  document.getElementById('roi-reset').addEventListener('click', () => { state.roi = { period: '', team: '', type: '', quad: '' }; document.getElementById('roi-period').value = ''; document.getElementById('roi-team').value = ''; document.getElementById('roi-type').value = ''; renderRoi(); });
  document.getElementById('roi-clear-quad').addEventListener('click', () => { state.roi.quad = ''; renderRoi(); });
  document.getElementById('profile-period').innerHTML = periodOptions(state.profile.period); document.getElementById('profile-channel').innerHTML = options(channels, state.profile.channel);
  document.getElementById('dep-period').innerHTML = periodOptions(state.dep.period); document.getElementById('dep-type').innerHTML = options(types, state.dep.type);
  document.getElementById('sankey-period').innerHTML = periodOptions(state.sankey.period); document.getElementById('sankey-channel').innerHTML = options(channels, state.sankey.channel);
  const projects = p360ProjectGroups(tasks);
  if (!projects.some(project => project.key === p360ProjectKey(state.project))) state.project = projects[0]?.name || '';
  const projectSearch = document.getElementById('project-search');
  document.getElementById('project-options').innerHTML = projects.map(project => `<option value="${escapeHtml(project.name)}" label="${project.tasks.length} ${effortPlural(project.tasks.length)}"></option>`).join('');
  projectSearch.value = state.project;
  const applyProjectSearch = () => {
    const project = projects.find(item => item.key === p360ProjectKey(projectSearch.value));
    if (!project) { projectSearch.value = state.project; return false; }
    if (project.name === state.project) return true;
    state.project = project.name;
    state.projectQuarter = '';
    state.projectOpenSection = '';
    state.projectFlowPeriod = '';
    state.projectFlowChannel = '';
    state.projectFlowSelection = null;
    projectSearch.value = project.name;
    project360();
    return true;
  };
  projectSearch.addEventListener('input', () => { if (projects.some(project => project.key === p360ProjectKey(projectSearch.value))) applyProjectSearch(); });
  projectSearch.addEventListener('change', applyProjectSearch);
  projectSearch.addEventListener('blur', () => { if (!projects.some(project => project.key === p360ProjectKey(projectSearch.value))) projectSearch.value = state.project; });
  projectSearch.addEventListener('keydown', event => { if (event.key === 'Escape') { projectSearch.value = state.project; projectSearch.blur(); } });
  bindSelect('profile-period', state.profile.period, v => { state.profile.period = v; renderProfile(); }); bindSelect('profile-channel', state.profile.channel, v => { state.profile.channel = v; renderProfile(); });
  bindSelect('dep-period', state.dep.period, v => { state.dep.period = v; renderDep(); }); bindSelect('dep-type', state.dep.type, v => { state.dep.type = v; renderDep(); }); bindSelect('dep-mode', state.dep.mode, v => { state.dep.mode = v; renderDep(); }); bindSelect('dep-threshold', String(state.dep.threshold), v => { state.dep.threshold = Number(v); renderDep(); });
  bindSelect('sankey-period', state.sankey.period, v => { state.sankey.period = v; state.sankey.pin = ''; renderSankey(); }); bindSelect('sankey-channel', state.sankey.channel, v => { state.sankey.channel = v; state.sankey.pin = ''; renderSankey(); }); bindSelect('sankey-mode', state.sankey.mode, v => { state.sankey.mode = v; state.sankey.pin = ''; renderSankey(); });
  document.getElementById('sankey-swap').addEventListener('click', () => { state.sankey.swapColumns = !state.sankey.swapColumns; state.sankey.pin = ''; renderSankey(); });
  renderEffort(); renderProfile(); renderDep(); renderSankey(); renderQuarters(); project360(); renderRoi();
  document.querySelector('.an-page')?.classList.remove('is-loading');
  document.querySelector('.an-loading-state')?.remove();
  window.addEventListener('resize', resizeCharts, { passive: true });
}

const completenessFields = [
  ['status_name', 'Статус'], ['progress', 'Прогресс'], ['effort', 'Трудозатраты'], ['financial_effect', 'Фин. эффект'], ['owner_name', 'Ответственный'], ['priority_name', 'Приоритет'], ['deadline', 'Срок'], ['project_name', 'Проект'], ['business_customer_name', 'Подразделение бизнес-заказчика']
];
function filled(t, field) {
  if (field === 'progress') return t.progress !== null && t.progress !== undefined && t.progress !== '';
  if (field === 'effort') return t.effort_days != null || t.effort_role_total > 0;
  if (field === 'deadline') return Boolean(t.deadline_id || t.deadline_code || t.deadline_name);
  return t[field] !== null && t[field] !== undefined && String(t[field]).trim() !== '';
}
function deadlineEnd(code) {
  let m = String(code || '').match(/^Q([1-4])_(\d{4})$/i); if (m) return new Date(Number(m[2]), Number(m[1]) * 3, 0, 23, 59, 59);
  m = String(code || '').match(/^Y(\d{4})$/i); if (m) return new Date(Number(m[1]), 11, 31, 23, 59, 59);
  return null;
}

function renderCompleteness() {
  const tasks = poData.tasks.filter(task => inPeriod(task, state.complete.period)), teams = uniq(tasks.map(t => t.team_name || 'Без команды')), rows = [['Все команды', tasks], ...teams.map(team => [team, tasks.filter(t => (t.team_name || 'Без команды') === team)])];
  document.getElementById('complete-matrix').innerHTML = `<div class="an-table-scroll"><table class="an-table an-matrix an-completeness-matrix" style="--profile-columns:${completenessFields.length + 2}"><colgroup><col class="an-team-column"><col class="an-count-column">${completenessFields.map(() => '<col class="an-number-column">').join('')}<col class="an-number-column"></colgroup><thead><tr><th>Команда</th><th class="an-number">Количество задач</th>${completenessFields.map(([, l]) => `<th class="an-number">${escapeHtml(l)}</th>`).join('')}<th class="an-number">Итого</th></tr></thead><tbody>${rows.map(([team, ts], ri) => `<tr class="${ri === 0 ? 'an-total' : ''}"><th title="${escapeHtml(team)}">${escapeHtml(team)}</th><td class="an-number an-task-count">${ts.length}</td>${completenessFields.map(([f, l]) => { const count = ts.filter(t => filled(t, f)).length, share = ts.length ? count / ts.length : 0; return `<td class="an-cell an-number ${share < .8 ? 'an-cell-bad' : ''}" data-team="${escapeHtml(team)}" data-field="${f}" data-label="${escapeHtml(l)}" style="--heat:${share}">${pct(count, ts.length)}</td>`; }).join('')}<td class="an-number">${pct(completenessFields.reduce((s, [f]) => s + ts.filter(t => filled(t, f)).length, 0), ts.length * completenessFields.length)}</td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('#complete-matrix .an-cell').forEach(el => el.addEventListener('click', () => { const scope = el.dataset.team === 'Все команды' ? tasks : tasks.filter(t => (t.team_name || 'Без команды') === el.dataset.team); showDetail('complete-detail', `${el.dataset.team} · нет поля «${el.dataset.label}»`, scope.filter(t => !filled(t, el.dataset.field))); }));
}

function qualityChecks(tasks) {
  const now = new Date(), reasonStatuses = ['ОТКЛОНЕНА', 'ХОЛД', 'ЭСКАЛАЦИЯ НА ЛТ'];
  return [
    ['done-progress', 'Завершена, но прогресс < 100%', tasks.filter(t => t.is_completed && n(t.progress) < 100), 'critical'],
    ['progress-status', 'Прогресс 100%, но статус не финальный', tasks.filter(t => n(t.progress) === 100 && !t.is_terminal), 'critical'],
    ['no-deadline', 'Нет срока', tasks.filter(t => !t.deadline_id && !t.deadline_code), 'critical'],
    ['overdue', 'Срок прошёл, задача не завершена', tasks.filter(t => { const end = deadlineEnd(t.deadline_code); return end && end < now && !t.is_terminal; }), 'critical'],
    ['no-reason', 'Нет причины отклонения / холда / эскалации', tasks.filter(t => reasonStatuses.includes(String(t.status_name || '').toUpperCase()) && !String(t.rejection_reason || '').trim()), 'critical'],
    ['no-actual', 'Завершена без фактических трудозатрат', tasks.filter(t => t.is_completed && t.actual_effort_days == null && n(t.actual_effort_role_total) === 0), 'critical'],
    ['progress-no-status', 'Есть прогресс, но нет статуса', tasks.filter(t => n(t.progress) > 0 && !t.status_name), 'technical'],
    ['no-type', 'Не указан тип задачи', tasks.filter(t => !t.task_type_name), 'technical'],
    ['no-channel', 'Не указан канал поступления', tasks.filter(t => !t.channel_name), 'technical']
  ];
}
function renderQuality() {
  const checks = qualityChecks(poData.tasks);
  document.getElementById('quality-checks').innerHTML = checks.map(([, label, ts, level], i) => `<button class="an-check ${level} ${ts.length ? 'has-items' : ''}" data-check="${i}"><span>${escapeHtml(label)}</span><strong>${ts.length}</strong><small>${level === 'critical' ? 'Критично' : 'Техническое'}</small></button>`).join('');
  document.querySelectorAll('#quality-checks [data-check]').forEach(el => el.addEventListener('click', () => { const c = checks[Number(el.dataset.check)]; showDetail('quality-detail', c[1], c[2], c[3] === 'critical' ? 'Критическая проверка' : 'Техническая проверка'); }));
}

function renderUniformity(field = 'status_name') {
  const tasks = poData.tasks, min = poData.quality_thresholds?.uniform_min_tasks || 10, threshold = (poData.quality_thresholds?.uniform_share_pct || 80) / 100;
  const teams = uniq(tasks.map(t => t.team_name || 'Без команды')).map(team => { const ts = tasks.filter(t => (t.team_name || 'Без команды') === team), values = Object.entries(by(ts, t => t[field] || 'Не заполнено')).sort((a, b) => b[1].length - a[1].length), top = values[0] || ['—', []]; return { team, tasks: ts, top: top[0], topTasks: top[1], share: ts.length ? top[1].length / ts.length : 0, enough: ts.length >= min }; });
  document.getElementById('uniform-content').innerHTML = `<div class="an-uniform-list">${teams.map((r, i) => `<button class="an-uniform-row ${r.enough && r.share >= threshold ? 'signal' : ''}" data-uniform="${i}"><span><strong>${escapeHtml(r.team)}</strong><small>${r.tasks.length} задач</small></span><span>${escapeHtml(r.top)}</span><strong>${pct(r.topTasks.length, r.tasks.length)}</strong><small>${!r.enough ? `Мало данных (< ${min})` : r.share >= threshold ? 'Сигнал однородности' : 'Разнообразное распределение'}</small></button>`).join('')}</div>`;
  document.querySelectorAll('[data-uniform]').forEach(el => el.addEventListener('click', () => { const r = teams[Number(el.dataset.uniform)]; showDetail('uniform-detail', `${r.team} · ${r.top}`, r.topTasks, `Доля ${pct(r.topTasks.length, r.tasks.length)}`); }));
}

function initPo() {
  bindAnalyticsDetailEscape();
  document.getElementById('complete-period').innerHTML = '<option value="">Все периоды</option>' + periodOptions(state.complete.period, poData);
  bindSelect('complete-period', state.complete.period, value => { state.complete.period = value; renderCompleteness(); });
  renderCompleteness(); renderQuality(); renderUniformity(); bindSelect('uniform-field', 'status_name', renderUniformity);
}

export async function initAnalytics(type, app) {
  disposeCharts();
  try {
    if (type === 'tribe') { ltData = await app.api.get('/tasks/analytics/lt-reports'); initLt(); }
    else if (type === 'po-pl') { poData = await app.api.get('/tasks/analytics/po-pl-reports'); initPo(); }
    if (window.lucide) window.lucide.createIcons();
  } catch (error) {
    console.error('Analytics load error:', error);
    const page = document.querySelector('.an-page');
    page?.classList.remove('is-loading');
    page?.querySelector('.an-loading-state')?.remove();
    if (page) page.innerHTML += `<div class="an-error">Не удалось загрузить аналитику: ${escapeHtml(error.message || error)}</div>`;
  }
}
