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
  dep: { period: '', type: '', threshold: 1, mode: 'directed', teams: [] },
  sankey: { period: '', channel: '', mode: 'tasks', pin: '' },
  quarters: { teams: [], types: [] }, project: ''
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

function options(values, selected = '', all = 'Все') {
  return `<option value="">${escapeHtml(all)}</option>` + values.map(v => `<option value="${escapeHtml(v)}" ${v === selected ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

function periodOptions(selected) {
  return (ltData?.periods || []).map(p => `<option value="${escapeHtml(p.id)}" ${p.id === selected ? 'selected' : ''}>${escapeHtml(p.label)}</option>`).join('');
}

function taskRows(tasks, empty = 'Нет задач') {
  if (!tasks.length) return `<div class="an-empty">${escapeHtml(empty)}</div>`;
  return `<div class="an-task-list">${tasks.map(t => `
    <button class="an-task" data-task-id="${t.id}">
      <span class="an-task-id">${escapeHtml(taskName(t))}</span>
      <span class="an-task-title">${escapeHtml(t.title)}</span>
      <span>${escapeHtml(t.project_name || 'Без проекта')}</span>
      <span>${escapeHtml(t.team_name || 'Без команды')}</span>
      <span>${t.effort_days == null ? 'Без оценки' : `${fmt(t.effort_days, 1)} дн.`}</span>
    </button>`).join('')}</div>`;
}

function projectTaskRows(tasks, empty = 'Нет задач') {
  if (!tasks.length) return `<div class="an-empty">${escapeHtml(empty)}</div>`;
  const groups = Object.entries(by(tasks, t => t.project_name || 'Без проекта')).sort((a, b) => b[1].length - a[1].length);
  return `<div class="an-project-groups">${groups.map(([project, projectTasks], index) => `<details ${groups.length === 1 || index === 0 ? 'open' : ''}><summary><span>${escapeHtml(project)}</span><strong>${projectTasks.length}</strong></summary>${taskRows(projectTasks)}</details>`).join('')}</div>`;
}

function bindTasks(root = document) {
  root.querySelectorAll('.an-task[data-task-id]').forEach(el => el.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: Number(el.dataset.taskId) } }));
  }));
}

function showDetail(id, title, tasks, subtitle = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<div class="an-detail-head"><div><strong>${escapeHtml(title)}</strong>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}</div><button class="an-detail-close">×</button></div>${projectTaskRows(tasks)}`;
  el.classList.add('is-open');
  el.querySelector('.an-detail-close')?.addEventListener('click', () => el.classList.remove('is-open'));
  bindTasks(el);
}

function card(id, title, description, controls, body) {
  return `<section class="an-card" id="${id}"><div class="an-card-head"><div><h2>${title}</h2><p>${description}</p></div><div class="an-controls">${controls}</div></div>${body}</section>`;
}

function control(label, id, content) { return `<label class="an-control"><span>${label}</span><select id="${id}">${content}</select></label>`; }

function originalEffortTemplate() {
  return `<section class="effort-report" id="an-effort">
    <div class="kpi-grid">
      <article class="kpi" style="--kc:#6366f1;--kc-bg:rgba(99,102,241,.12)"><div class="kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3.5 8.5 4.7L12 12.9 3.5 8.2 12 3.5Z"/><path d="m4.2 13 7.8 4.3 7.8-4.3"/><path d="m4.2 17 7.8 4.3 7.8-4.3"/></svg></div><div><div class="kpi-val" id="kTasks">0</div><div class="kpi-lab">Всего задач в срезе</div></div></article>
      <article class="kpi" style="--kc:#f59e0b;--kc-bg:rgba(245,158,11,.12)"><div class="kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg></div><div><div class="kpi-val" id="kDays">0</div><div class="kpi-lab">Трудозатраты, чел.-дней</div></div></article>
      <article class="kpi" style="--kc:#10b981;--kc-bg:rgba(16,185,129,.12)"><div class="kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12.5h3.5l2.5-6 4 11 2.5-5H21"/></svg></div><div><div class="kpi-val" id="kEvaluated">0%</div><div class="kpi-lab">Задач с оценкой трудозатрат</div></div></article>
      <article class="kpi" style="--kc:#8b5cf6;--kc-bg:rgba(139,92,246,.12)"><div class="kpi-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3.8 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8L12 3.8Z"/></svg></div><div><div class="kpi-val k-topname"><span class="dot" id="kTopDot" style="--c:#6366f1;--ring:rgba(99,102,241,.15)"></span><span id="kTop">—</span></div><div class="kpi-lab">Крупнейший тип · <b id="kTopPct">0%</b></div></div></article>
    </div>
    <div class="rep-card">
      <div class="rep-head"><div class="rep-title"><h3>Трудозатраты по типам задач</h3><div class="rep-sub" id="repSub">—</div></div><div class="rep-controls">
        <div class="dd" id="effortTeamDd"><button class="dd-btn" id="effortTeamBtn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg><span class="dd-label" id="effortTeamName">Весь трайб</span><svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></button><div class="dd-panel" id="effortTeamPanel"></div></div>
        <div class="seg effort-period-seg" id="effortPeriodSeg"></div>
      </div></div>
      <div class="rep-body"><div><div class="donut-wrap"><svg class="donut" viewBox="0 0 200 200"><circle class="donut-track" cx="100" cy="100" r="78"/><g id="effortSegGroup" transform="rotate(-90 100 100)"></g></svg><div class="donut-center"><div class="dc-num" id="dcNum">0</div><div class="dc-lab">чел.-дней</div><div class="dc-sub" id="dcSub">0 задач</div></div></div><div class="donut-cap">Распределение оценённых трудозатрат по типам задач</div></div>
        <div class="table-wrap"><table class="rep-table"><colgroup><col style="width:34%"><col style="width:12%"><col style="width:15%"><col style="width:39%"></colgroup><thead><tr><th class="sortable" data-col="name"><span class="th-in">Тип задачи <span class="arr">↕</span></span></th><th class="sortable" data-col="tasks"><span class="th-in">Задач <span class="arr">↕</span></span></th><th class="sortable" data-col="days"><span class="th-in">Чел.-дни <span class="arr">↕</span></span></th><th class="sortable sorted" data-col="share"><span class="th-in">Доля <span class="arr">↓</span></span></th></tr></thead><tbody id="repTbody"></tbody><tfoot><tr><td>Итого</td><td id="tTasks">0</td><td id="tDays">0</td><td>100%</td></tr></tfoot></table></div>
      </div>
    </div><div id="effort-detail" class="an-detail"></div>
  </section>`;
}

function originalDependencyTemplate() {
  return `<section class="skp-card" id="an-dep"><h2>3. Карта зависимостей</h2><p class="skp-sub">Основная команда вовлекает команды-партнёры. Толщина ребра и число на нём — количество совместных задач. Команды расположены по кругу.</p>
    <div class="skp-controls"><div class="an-controls">${control('Период', 'dep-period', '')}${control('Тип задачи', 'dep-type', '')}${control('Режим', 'dep-mode', '<option value="directed">Направленный</option><option value="undirected">Без направления</option>')}${control('Порог', 'dep-threshold', '<option>1</option><option>3</option><option>5</option><option>10</option>')}</div></div>
    <div id="dep-team-chips" class="an-chips"></div><div id="dep-kpis" class="skp-kpis"></div><div id="dep-chart" class="skp-chart skp-chart--map"></div>
    <div class="skp-tables"><div><h3>Топ взаимосвязей</h3><table class="skp-table"><thead><tr><th>#</th><th>Основная команда</th><th>Вовлечённая команда</th><th>Совместных задач</th></tr></thead><tbody id="dep-pairs-body"></tbody></table></div><div><h3>Статистика по командам</h3><table class="skp-table"><thead><tr><th>Команда</th><th>Как основная</th><th>Как партнёр</th><th>Всего</th></tr></thead><tbody id="dep-teams-body"></tbody></table></div></div><div id="dep-detail" class="an-detail"></div>
  </section>`;
}

function ltTemplate() {
  return `<div class="an-page animate-fade-in">
    <div class="page-header"><h1>Аналитика ЛТ</h1><p>Единый обзор потока, взаимодействий, проектов и экономики</p></div>
    ${originalEffortTemplate()}
    ${card('an-profile', '2. Профиль команд', 'Матрица специализации команд по типам задач.',
      control('Период', 'profile-period', '') + control('Канал', 'profile-channel', ''),
      '<div id="profile-matrix"></div><div id="profile-detail" class="an-detail"></div>')}
    ${originalDependencyTemplate()}
    ${card('an-sankey', '4. Поток задач', 'Подразделение → команда → тип задачи; объём в задачах или человеко-днях.',
      control('Период', 'sankey-period', '') + control('Канал', 'sankey-channel', '') + control('Мера', 'sankey-mode', '<option value="tasks">Задачи</option><option value="days">Человеко-дни</option>') + '<button class="btn btn-secondary" id="sankey-reset">Сбросить узел</button>',
      '<div id="sankey-chart" class="an-chart an-chart-xl"></div><div id="sankey-detail" class="an-detail"></div>')}
    ${card('an-quarters', '5. Проекты по кварталам', 'Активность проектов в доступных периодах; фильтры по основной или привлечённой команде.', '',
      '<div class="an-filter-block"><span>Команды</span><div id="quarter-teams" class="an-chips"></div><span>Типы задач</span><div id="quarter-types" class="an-chips"></div></div><div id="quarter-grid"></div><div id="quarter-detail" class="an-detail"></div>')}
    ${card('an-project360', '6. Проект 360°', 'Полный профиль проекта: динамика, ответственность, состав работ, сигналы и экономика.',
      control('Проект', 'project-select', ''), '<div id="project-content"></div><div id="project-detail" class="an-detail"></div>')}
    ${card('an-roi', '7. Стоимость и финансовый эффект', 'C/V = стоимость в рублях / финансовый эффект в рублях. Чем ниже, тем лучше.', '',
      '<div class="an-two"><div id="roi-chart" class="an-chart an-chart-lg"></div><div id="roi-table"></div></div><div id="roi-detail" class="an-detail"></div>')}
  </div>`;
}

function poTemplate() {
  return `<div class="an-page animate-fade-in"><div class="page-header"><h1>Аналитика PO/PL</h1><p>Полнота данных, логические конфликты и однородность ведения бэклога</p></div>
    ${card('an-complete', 'Полнота карточек', 'Девять обязательных полей. Нажмите на ячейку, чтобы увидеть задачи с пропусками.', '', '<div id="complete-matrix"></div><div id="complete-detail" class="an-detail"></div>')}
    ${card('an-quality', 'Конфликты качества', 'Проверки согласованности статуса, прогресса, сроков, факта и классификации.', '', '<div id="quality-checks" class="an-quality-grid"></div><div id="quality-detail" class="an-detail"></div>')}
    ${card('an-uniform', 'Однородность ведения', 'Информационный сигнал: доминирующее значение статуса или приоритета при доле от 80% (минимум 10 задач).', control('Поле', 'uniform-field', '<option value="status_name">Статус</option><option value="priority_name">Приоритет</option>'), '<div id="uniform-content"></div><div id="uniform-detail" class="an-detail"></div>')}
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
  const tasks = effortTasks(), evaluated = tasks.filter(t => t.effort_days != null), grouped = by(tasks, t => t.task_type_name || 'Без типа');
  const totalDays = evaluated.reduce((sum, task) => sum + n(task.effort_days), 0);
  const items = Object.entries(grouped).map(([name, typeTasks], index) => ({ name, typeTasks, tasks: typeTasks.length, days: typeTasks.reduce((sum, task) => sum + n(task.effort_days), 0), color: LT_TYPE_COLORS[index % LT_TYPE_COLORS.length] }));
  items.forEach(item => item.share = totalDays ? item.days / totalDays * 100 : 0);
  const top = [...items].sort((a, b) => b.days - a.days)[0];
  document.getElementById('kTasks').textContent = fmt(tasks.length);
  document.getElementById('kDays').textContent = fmt(totalDays, 1);
  document.getElementById('kEvaluated').textContent = pct(evaluated.length, tasks.length);
  document.getElementById('kTop').textContent = top?.name || '—';
  document.getElementById('kTopPct').textContent = top ? `${fmt(top.share, 1)}%` : '0%';
  document.getElementById('kTopDot').style.cssText = `--c:${top?.color || '#6366f1'};--ring:${top?.color || '#6366f1'}26`;
  document.getElementById('repSub').textContent = `${state.effort.team || 'Весь трайб'} · ${ltData.periods.find(p => p.id === state.effort.period)?.label || state.effort.period}`;
  document.getElementById('dcNum').textContent = fmt(totalDays, 1);
  document.getElementById('dcSub').textContent = `${tasks.length} ${effortPlural(tasks.length)}`;
  document.getElementById('tTasks').textContent = fmt(tasks.length);
  document.getElementById('tDays').textContent = fmt(totalDays, 1);

  const svgGroup = document.getElementById('effortSegGroup'); svgGroup.innerHTML = '';
  let offset = 0;
  state.effort.arcs = items.map((item, index) => { const arc = document.createElementNS(SVG_NS, 'circle'); arc.setAttribute('cx', '100'); arc.setAttribute('cy', '100'); arc.setAttribute('r', '78'); arc.setAttribute('pathLength', '100'); arc.setAttribute('class', 'arc'); arc.setAttribute('stroke', item.color); const dash = item.share > .5 ? Math.max(item.share - 1.3, .4) : 0; arc.setAttribute('stroke-dasharray', `${dash} ${100 - dash}`); arc.setAttribute('stroke-dashoffset', String(-(offset + .65))); offset += item.share; arc.addEventListener('mouseenter', () => focusEffort(index)); arc.addEventListener('mouseleave', () => focusEffort(null)); arc.addEventListener('click', () => showDetail('effort-detail', item.name, item.typeTasks, 'Тип → проекты → задачи')); svgGroup.appendChild(arc); return arc; });

  const tbody = document.getElementById('repTbody'); tbody.innerHTML = '';
  state.effort.rows = items.map((item, index) => { const tr = document.createElement('tr'); if (!item.days) tr.classList.add('zero'); tr.innerHTML = `<td><div class="t-name"><span class="dot" style="--c:${item.color};--ring:${item.color}26"></span><span class="lbl">${escapeHtml(item.name)}</span>${item.tasks > 0 && item.days === 0 ? '<span class="no-eff">нет оценки</span>' : ''}</div></td><td>${item.tasks}</td><td>${fmt(item.days, 1)}</td><td><div class="t-share"><div class="bar"><i style="--c:${item.color};width:${Math.max(0, item.share)}%"></i></div><span class="pct">${fmt(item.share, 1)}%</span></div></td>`; tr.style.animation = `rowIn .45s ${.05 + index * .05}s both`; tr.addEventListener('mouseenter', () => focusEffort(index)); tr.addEventListener('mouseleave', () => focusEffort(null)); tr.addEventListener('click', () => showDetail('effort-detail', item.name, item.typeTasks, 'Тип → проекты → задачи')); tbody.appendChild(tr); return { el: tr, name: item.name, tasks: item.tasks, days: item.days, share: item.share }; });
  sortEffortRows();
}

function renderProfile() {
  const tasks = ltData.tasks.filter(t => inPeriod(t, state.profile.period) && (!state.profile.channel || t.channel_name === state.profile.channel));
  const teams = uniq(tasks.map(t => t.team_name)), types = uniq(tasks.map(t => t.task_type_name || 'Без типа'));
  const max = Math.max(1, ...teams.flatMap(team => types.map(type => tasks.filter(t => t.team_name === team && (t.task_type_name || 'Без типа') === type).length)));
  document.getElementById('profile-matrix').innerHTML = `<div class="an-table-scroll"><table class="an-table an-matrix"><thead><tr><th>Команда</th>${types.map(x => `<th>${escapeHtml(x)}</th>`).join('')}<th>Всего</th></tr></thead><tbody>${teams.map(team => `<tr><th>${escapeHtml(team)}</th>${types.map(type => { const count = tasks.filter(t => t.team_name === team && (t.task_type_name || 'Без типа') === type).length; return `<td class="an-cell" data-team="${escapeHtml(team)}" data-type="${escapeHtml(type)}" style="--heat:${count / max}">${count || '·'}</td>`; }).join('')}<td>${tasks.filter(t => t.team_name === team).length}</td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('#profile-matrix .an-cell').forEach(el => {
    el.addEventListener('click', () => showDetail('profile-detail', `${el.dataset.team} · ${el.dataset.type}`, tasks.filter(t => t.team_name === el.dataset.team && (t.task_type_name || 'Без типа') === el.dataset.type)));
  });
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
  return Object.values(map).filter(e => e.tasks.length >= state.dep.threshold && (!state.dep.teams.length || state.dep.teams.includes(e.source) || state.dep.teams.includes(e.target))).sort((a, b) => b.tasks.length - a.tasks.length);
}

function renderDep() {
  const edges = dependencyEdges(), names = uniq(edges.flatMap(edge => [edge.source, edge.target])), maxCount = Math.max(1, ...edges.map(edge => edge.tasks.length));
  const stat = Object.fromEntries(names.map(name => [name, { asMain: 0, asPartner: 0, tasks: [] }]));
  edges.forEach(edge => { stat[edge.source].asMain += edge.tasks.length; stat[edge.target].asPartner += edge.tasks.length; stat[edge.source].tasks.push(...edge.tasks); stat[edge.target].tasks.push(...edge.tasks); });
  const nodeSizes = {};
  const nodes = names.map((name, index) => { const nodeTotal = stat[name].asMain + stat[name].asPartner, angle = index / Math.max(1, names.length) * Math.PI * 2 - Math.PI / 2, cos = Math.cos(angle), sin = Math.sin(angle), position = cos > .5 ? 'right' : cos < -.5 ? 'left' : sin > 0 ? 'bottom' : 'top'; const symbolSize = Math.min(26 + nodeTotal * 2.2, 72); nodeSizes[name] = symbolSize; return { name, x: cos * 100, y: sin * 100, symbolSize, itemStyle: { color: LT_MAP_COLORS[index % LT_MAP_COLORS.length] }, label: { show: true, position, fontSize: 12, fontWeight: 600, color: chartTextColor() } }; });
  const edgeLookup = new Map(edges.map(edge => [`${edge.source}\u0001${edge.target}`, edge]));
  const links = edges.map(edge => { const count = edge.tasks.length, width = Math.min(1.5 + count / maxCount * 16, Math.min(nodeSizes[edge.source] || 30, nodeSizes[edge.target] || 30) * .65); return { source: edge.source, target: edge.target, value: count, lineStyle: { width, curveness: edgeLookup.has(`${edge.target}\u0001${edge.source}`) ? .3 : .12, opacity: .5, color: LT_MAP_COLORS[names.indexOf(edge.source) % LT_MAP_COLORS.length] }, symbol: state.dep.mode === 'directed' ? ['none', 'arrow'] : ['none', 'none'], symbolSize: [0, Math.max(6, Math.min(12, width * .7))] }; });
  const totalTasks = edges.reduce((sum, edge) => sum + edge.tasks.length, 0), top = edges[0];
  document.getElementById('dep-kpis').innerHTML = edges.length
    ? `<div class="skp-kpi"><div class="v">${totalTasks}</div><div class="l">Задач в кооперации</div></div><div class="skp-kpi"><div class="v">${edges.length}</div><div class="l">Уникальных взаимосвязей</div></div><div class="skp-kpi"><div class="v">${escapeHtml(top.source)} ${state.dep.mode === 'directed' ? '→' : '—'} ${escapeHtml(top.target)}</div><div class="l">Самая частая пара (${top.tasks.length} задач)</div></div>`
    : '<div class="skp-kpi"><div class="v">Нет данных</div><div class="l">Вовлечённые команды не заполнены или не прошли фильтр</div></div>';
  const chartBg = getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim() || '#fff';
  makeChart('dep-chart', { tooltip: { formatter: p => { if (p.dataType === 'edge') return `${escapeHtml(p.data.source)} → ${escapeHtml(p.data.target)}<br>Совместных задач: <b>${p.data.value}</b>`; const s = stat[p.name] || { asMain: 0, asPartner: 0 }; return `<b>${escapeHtml(p.name)}</b><br>Как основная: ${s.asMain} задач<br>Как партнёр: ${s.asPartner} участий`; } }, series: [{ type: 'graph', layout: 'none', data: nodes, links, directed: state.dep.mode === 'directed', roam: false, draggable: false, left: 130, right: 210, top: 40, bottom: 40, edgeSymbol: state.dep.mode === 'directed' ? ['none', 'arrow'] : ['none', 'none'], edgeLabel: { show: true, fontSize: 10, color: chartTextColor(), formatter: p => p.data.value, backgroundColor: chartBg, padding: [2, 4], borderRadius: 4 }, emphasis: { focus: 'adjacency', lineStyle: { opacity: .85 } } }] }, p => { if (p.dataType === 'edge') { const edge = edgeLookup.get(`${p.data.source}\u0001${p.data.target}`); if (edge) showDetail('dep-detail', `${edge.source} → ${edge.target}`, edge.tasks, 'Направление → проекты → задачи'); } else if (p.dataType === 'node') { const nodeTasks = [...new Map(stat[p.name].tasks.map(t => [t.id, t])).values()]; showDetail('dep-detail', p.name, nodeTasks, 'Все связи команды'); } });
  document.getElementById('dep-pairs-body').innerHTML = edges.slice(0, 10).map((edge, index) => `<tr data-edge="${index}"><td>${index + 1}</td><td>${escapeHtml(edge.source)}</td><td>${escapeHtml(edge.target)}</td><td><b>${edge.tasks.length}</b></td></tr>`).join('') || '<tr><td colspan="4">Нет данных</td></tr>';
  document.getElementById('dep-teams-body').innerHTML = names.map(name => `<tr data-team="${escapeHtml(name)}"><td>${escapeHtml(name)}</td><td>${stat[name].asMain}</td><td>${stat[name].asPartner}</td><td><b>${stat[name].asMain + stat[name].asPartner}</b></td></tr>`).join('') || '<tr><td colspan="4">Нет данных</td></tr>';
  document.querySelectorAll('#dep-pairs-body tr[data-edge]').forEach(el => el.addEventListener('click', () => { const edge = edges[Number(el.dataset.edge)]; showDetail('dep-detail', `${edge.source} → ${edge.target}`, edge.tasks, 'Направление → проекты → задачи'); }));
  document.querySelectorAll('#dep-teams-body tr[data-team]').forEach(el => el.addEventListener('click', () => { const s = stat[el.dataset.team], uniqueTasks = [...new Map(s.tasks.map(t => [t.id, t])).values()]; showDetail('dep-detail', el.dataset.team, uniqueTasks, 'Все связи команды'); }));
}

function renderSankey() {
  const tasks = ltData.tasks.filter(t => inPeriod(t, state.sankey.period) && (!state.sankey.channel || t.channel_name === state.sankey.channel));
  const links = {}, nodes = {}, value = t => state.sankey.mode === 'days' ? n(t.effort_days) : 1;
  tasks.forEach(t => {
    const d = `d:${t.department_name || 'Без подразделения'}`, tm = `t:${t.team_name || 'Без команды'}`, ty = `y:${t.task_type_name || 'Без типа'}`;
    [[d, t.department_name || 'Без подразделения', 0], [tm, t.team_name || 'Без команды', 1], [ty, t.task_type_name || 'Без типа', 2]].forEach(([id, name, depth]) => nodes[id] = { name: id, display: name, depth });
    [[d, tm], [tm, ty]].forEach(([source, target]) => { const key = `${source}\u0001${target}`; (links[key] ||= { source, target, value: 0, tasks: [] }); links[key].value += value(t); links[key].tasks.push(t); });
  });
  const linkList = Object.values(links).filter(x => x.value > 0);
  const pinned = state.sankey.pin;
  makeChart('sankey-chart', { tooltip: { formatter: p => p.dataType === 'edge' ? `${nodes[p.data.source]?.display} → ${nodes[p.data.target]?.display}: ${fmt(p.data.value, 1)}` : nodes[p.name]?.display }, series: [{ type: 'sankey', data: Object.values(nodes).map(x => ({ name: x.name, depth: x.depth, itemStyle: { opacity: !pinned || x.name === pinned ? 1 : .35 }, label: { formatter: x.display } })), links: linkList.map(x => ({ ...x, lineStyle: { opacity: !pinned || x.source === pinned || x.target === pinned ? .55 : .08 } })), emphasis: { focus: 'adjacency' }, lineStyle: { color: 'gradient', curveness: .5 }, nodeGap: 12, nodeWidth: 18 }] }, p => {
    if (p.dataType === 'node') { state.sankey.pin = p.name; renderSankey(); showDetail('sankey-detail', nodes[p.name]?.display || p.name, tasks.filter(t => [t.department_name, t.team_name, t.task_type_name].includes(nodes[p.name]?.display))); }
    if (p.dataType === 'edge') { const l = links[`${p.data.source}\u0001${p.data.target}`]; showDetail('sankey-detail', `${nodes[l.source].display} → ${nodes[l.target].display}`, l.tasks); }
  });
}

function chipSet(id, values, selected, render) {
  const el = document.getElementById(id);
  el.innerHTML = values.map(v => `<button class="an-chip ${selected.includes(v) ? 'active' : ''}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('');
  el.querySelectorAll('.an-chip').forEach(btn => btn.addEventListener('click', () => { const v = btn.dataset.value, i = selected.indexOf(v); i >= 0 ? selected.splice(i, 1) : selected.push(v); btn.classList.toggle('active', selected.includes(v)); render(); }));
}

function renderQuarters() {
  const tasks = ltData.tasks.filter(t => (!state.quarters.teams.length || allTeams(t).some(x => state.quarters.teams.includes(x))) && (!state.quarters.types.length || state.quarters.types.includes(t.task_type_name || 'Без типа')));
  const quarters = ltData.periods.filter(p => /^q\d_\d{4}$/.test(p.id)), projects = uniq(tasks.map(t => t.project_name || 'Без проекта'));
  chipSet('quarter-teams', uniq(ltData.tasks.flatMap(allTeams)), state.quarters.teams, renderQuarters);
  chipSet('quarter-types', uniq(ltData.tasks.map(t => t.task_type_name || 'Без типа')), state.quarters.types, renderQuarters);
  document.getElementById('quarter-grid').innerHTML = `<div class="an-table-scroll"><table class="an-table an-quarter"><thead><tr><th>Проект</th>${quarters.map(q => `<th>${escapeHtml(q.label)}</th>`).join('')}<th>Всего</th></tr></thead><tbody>${projects.map(project => `<tr><th>${escapeHtml(project)}</th>${quarters.map(q => { const ts = tasks.filter(t => (t.project_name || 'Без проекта') === project && inPeriod(t, q.id)); return `<td class="an-cell" data-project="${escapeHtml(project)}" data-period="${q.id}" style="--heat:${Math.min(1, ts.length / 8)}">${ts.length || '·'}</td>`; }).join('')}<td>${tasks.filter(t => (t.project_name || 'Без проекта') === project).length}</td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('#quarter-grid .an-cell').forEach(el => {
    el.addEventListener('click', () => showDetail('quarter-detail', `${el.dataset.project} · ${quarters.find(q => q.id === el.dataset.period)?.label}`, tasks.filter(t => (t.project_name || 'Без проекта') === el.dataset.project && inPeriod(t, el.dataset.period))));
  });
}

function aggregateEconomics(tasks) {
  const groups = {};
  tasks.forEach(t => { const key = t.project_name ? `p:${t.project_name}` : `t:${t.id}`; (groups[key] ||= { name: t.project_name || `${taskName(t)} · ${t.title}`, tasks: [] }).tasks.push(t); });
  return Object.values(groups).map(g => {
    const complete = g.tasks.every(t => t.effort_rub != null && n(t.effort_rub) > 0 && t.financial_effect != null && n(t.financial_effect) > 0);
    const cost = g.tasks.reduce((s, t) => s + n(t.effort_rub), 0), effect = g.tasks.reduce((s, t) => s + n(t.financial_effect), 0);
    return { ...g, cost, effect, cv: complete ? cost / (effect * 1000000) : null, complete };
  }).sort((a, b) => (b.effect || 0) - (a.effect || 0));
}

function project360() {
  const tasks = ltData.tasks.filter(t => (t.project_name || 'Без проекта') === state.project);
  if (!tasks.length) { document.getElementById('project-content').innerHTML = '<div class="an-empty">Выберите проект</div>'; return; }
  const quarters = ltData.periods.filter(p => /^q/.test(p.id));
  const statuses = Object.entries(by(tasks, t => t.status_name || 'Без статуса')).sort((a, b) => b[1].length - a[1].length);
  const types = Object.entries(by(tasks, t => t.task_type_name || 'Без типа')).sort((a, b) => b[1].length - a[1].length);
  const risk = tasks.filter(t => isRiskStatus(t.status_name) || (t.is_completed && n(t.progress) < 100) || (!t.deadline_code));
  document.getElementById('project-content').innerHTML = `<div class="an-p360">
      <div><h3>Динамика</h3>${quarters.map(q => `<button class="an-stat-row" data-p360-period="${q.id}"><span>${escapeHtml(q.label)}</span><strong>${tasks.filter(t => inPeriod(t, q.id)).length}</strong></button>`).join('') || '<div class="an-empty">Нет квартальных сроков</div>'}</div>
      <div><h3>Ответственность</h3>${Object.entries(by(tasks, t => t.team_name || 'Без команды')).map(([x, ts]) => `<button class="an-stat-row" data-p360-team="${escapeHtml(x)}"><span>${escapeHtml(x)}</span><strong>${ts.length}</strong></button>`).join('')}</div>
      <div><h3>Состав работ</h3>${types.map(([x, ts]) => `<button class="an-stat-row" data-p360-type="${escapeHtml(x)}"><span>${escapeHtml(x)}</span><strong>${ts.length}</strong></button>`).join('')}</div>
      <div><h3>Сигналы</h3><button class="an-stat-row an-risk" id="p360-risk"><span>Риски и пропуски</span><strong>${risk.length}</strong></button>${statuses.slice(0, 5).map(([x, ts]) => `<div class="an-stat-row"><span>${escapeHtml(x)}</span><strong>${ts.length}</strong></div>`).join('')}</div>
    </div>${taskRows(tasks)}`;
  bindTasks(document.getElementById('project-content'));
  document.querySelectorAll('[data-p360-period]').forEach(el => el.addEventListener('click', () => showDetail('project-detail', `${state.project} · ${el.textContent.trim()}`, tasks.filter(t => inPeriod(t, el.dataset.p360Period)))));
  document.querySelectorAll('[data-p360-team]').forEach(el => el.addEventListener('click', () => showDetail('project-detail', el.dataset.p360Team, tasks.filter(t => t.team_name === el.dataset.p360Team))));
  document.querySelectorAll('[data-p360-type]').forEach(el => el.addEventListener('click', () => showDetail('project-detail', el.dataset.p360Type, tasks.filter(t => (t.task_type_name || 'Без типа') === el.dataset.p360Type))));
  document.getElementById('p360-risk')?.addEventListener('click', () => showDetail('project-detail', 'Риски и пропуски', risk));
}

function renderRoi() {
  const groups = aggregateEconomics(ltData.tasks), ready = groups.filter(g => g.complete), missing = groups.filter(g => !g.complete);
  makeChart('roi-chart', { tooltip: { formatter: p => `${escapeHtml(p.data.name)}<br>Стоимость: ${fmt(p.data.value[0], 0)} ₽<br>Эффект: ${fmt(p.data.value[1], 2)} млн ₽<br>C/V: ${fmt(p.data.cv, 2)}` }, xAxis: { name: 'Стоимость, ₽', type: 'log' }, yAxis: { name: 'Финансовый эффект, млн ₽', type: 'log' }, series: [{ type: 'scatter', symbolSize: p => Math.max(12, Math.min(42, 10 + Math.log10(p[1] + 1) * 8)), data: ready.map(g => ({ name: g.name, value: [g.cost, g.effect], cv: g.cv, itemStyle: { color: g.cv <= .3 ? '#16a34a' : g.cv <= 1 ? '#f59e0b' : '#dc2626' } })) }] }, p => { const g = ready.find(x => x.name === p.data.name); if (g) showDetail('roi-detail', g.name, g.tasks, `C/V ${fmt(g.cv, 2)}`); });
  document.getElementById('roi-table').innerHTML = `<h3>Нет расчёта — красная зона</h3><div class="an-table-scroll"><table class="an-table"><thead><tr><th>Проект / задача</th><th>Задач</th><th>Причина</th></tr></thead><tbody>${missing.map((g, i) => `<tr data-missing="${i}"><td>${escapeHtml(g.name)}</td><td>${g.tasks.length}</td><td>Нет стоимости или эффекта</td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('#roi-table tr[data-missing]').forEach(el => el.addEventListener('click', () => { const g = missing[Number(el.dataset.missing)]; showDetail('roi-detail', g.name, g.tasks, 'C/V не рассчитан'); }));
}

function bindSelect(id, value, handler) { const el = document.getElementById(id); if (!el) return; el.value = value; el.addEventListener('change', () => handler(el.value)); }

function initEffortControls(teams) {
  const segment = document.getElementById('effortPeriodSeg'), periods = ltData.periods || [], activeIndex = Math.max(0, periods.findIndex(period => period.id === state.effort.period));
  segment.style.gridTemplateColumns = `repeat(${Math.max(1, periods.length)},minmax(96px,1fr))`;
  const thumbWidth = periods.length > 6 ? '96px' : `calc(${100 / Math.max(1, periods.length)}% - 1.2px)`;
  segment.innerHTML = `<div class="seg-thumb" id="effortSegThumb" style="width:${thumbWidth};transform:translateX(${activeIndex * 100}%)"></div>${periods.map(period => `<button class="seg-btn ${period.id === state.effort.period ? 'active' : ''}" data-period="${period.id}" type="button">${escapeHtml(period.label)}</button>`).join('')}`;
  segment.querySelectorAll('.seg-btn').forEach((button, index) => button.addEventListener('click', () => { state.effort.period = button.dataset.period; segment.querySelectorAll('.seg-btn').forEach(item => item.classList.toggle('active', item === button)); document.getElementById('effortSegThumb').style.transform = `translateX(${index * 100}%)`; renderEffort(); }));
  const dropdown = document.getElementById('effortTeamDd'), panel = document.getElementById('effortTeamPanel'), label = document.getElementById('effortTeamName');
  panel.innerHTML = [{ value: '', label: 'Весь трайб' }, ...teams.map(team => ({ value: team, label: team }))].map(item => `<button class="dd-item ${item.value === state.effort.team ? 'sel' : ''}" data-value="${escapeHtml(item.value)}" type="button"><span>${escapeHtml(item.label)}</span><svg class="chk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></button>`).join('');
  document.getElementById('effortTeamBtn').addEventListener('click', event => { event.stopPropagation(); dropdown.classList.toggle('open'); });
  panel.querySelectorAll('.dd-item').forEach(button => button.addEventListener('click', () => { state.effort.team = button.dataset.value; label.textContent = state.effort.team || 'Весь трайб'; panel.querySelectorAll('.dd-item').forEach(item => item.classList.toggle('sel', item === button)); dropdown.classList.remove('open'); renderEffort(); }));
  if (window.__analyticsEffortOutside) document.removeEventListener('click', window.__analyticsEffortOutside);
  window.__analyticsEffortOutside = event => { if (!dropdown.contains(event.target)) dropdown.classList.remove('open'); };
  document.addEventListener('click', window.__analyticsEffortOutside);
  document.querySelectorAll('#an-effort .rep-table th.sortable').forEach(th => th.addEventListener('click', () => { const col = th.dataset.col; if (state.effort.sortCol === col) state.effort.sortDir *= -1; else { state.effort.sortCol = col; state.effort.sortDir = col === 'name' ? 1 : -1; } sortEffortRows(true); }));
}

function initLt() {
  const tasks = ltData.tasks || [];
  state.effort.period ||= ltData.active_period; state.profile.period ||= ltData.active_period; state.dep.period ||= ltData.active_period; state.sankey.period ||= ltData.active_period;
  const teams = uniq(tasks.flatMap(allTeams)), channels = uniq(tasks.map(t => t.channel_name)), types = uniq(tasks.map(t => t.task_type_name));
  initEffortControls(uniq(tasks.map(t => t.team_name)));
  document.getElementById('profile-period').innerHTML = periodOptions(state.profile.period); document.getElementById('profile-channel').innerHTML = options(channels, state.profile.channel);
  document.getElementById('dep-period').innerHTML = periodOptions(state.dep.period); document.getElementById('dep-type').innerHTML = options(types, state.dep.type);
  document.getElementById('sankey-period').innerHTML = periodOptions(state.sankey.period); document.getElementById('sankey-channel').innerHTML = options(channels, state.sankey.channel);
  const projects = uniq(tasks.map(t => t.project_name || 'Без проекта')); state.project ||= projects[0] || ''; document.getElementById('project-select').innerHTML = projects.map(x => `<option ${x === state.project ? 'selected' : ''}>${escapeHtml(x)}</option>`).join('');
  chipSet('dep-team-chips', teams, state.dep.teams, renderDep);
  bindSelect('profile-period', state.profile.period, v => { state.profile.period = v; renderProfile(); }); bindSelect('profile-channel', state.profile.channel, v => { state.profile.channel = v; renderProfile(); });
  bindSelect('dep-period', state.dep.period, v => { state.dep.period = v; renderDep(); }); bindSelect('dep-type', state.dep.type, v => { state.dep.type = v; renderDep(); }); bindSelect('dep-mode', state.dep.mode, v => { state.dep.mode = v; renderDep(); }); bindSelect('dep-threshold', String(state.dep.threshold), v => { state.dep.threshold = Number(v); renderDep(); });
  bindSelect('sankey-period', state.sankey.period, v => { state.sankey.period = v; renderSankey(); }); bindSelect('sankey-channel', state.sankey.channel, v => { state.sankey.channel = v; renderSankey(); }); bindSelect('sankey-mode', state.sankey.mode, v => { state.sankey.mode = v; renderSankey(); });
  document.getElementById('sankey-reset').addEventListener('click', () => { state.sankey.pin = ''; renderSankey(); document.getElementById('sankey-detail').classList.remove('is-open'); });
  bindSelect('project-select', state.project, v => { state.project = v; project360(); });
  renderEffort(); renderProfile(); renderDep(); renderSankey(); renderQuarters(); project360(); renderRoi();
  window.addEventListener('resize', () => Object.values(charts).forEach(c => c.resize()), { passive: true });
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
  const tasks = poData.tasks, teams = uniq(tasks.map(t => t.team_name || 'Без команды')), rows = [['Все команды', tasks], ...teams.map(team => [team, tasks.filter(t => (t.team_name || 'Без команды') === team)])];
  document.getElementById('complete-matrix').innerHTML = `<div class="an-table-scroll"><table class="an-table an-matrix"><thead><tr><th>Команда</th>${completenessFields.map(([, l]) => `<th>${escapeHtml(l)}</th>`).join('')}<th>Итого</th></tr></thead><tbody>${rows.map(([team, ts], ri) => `<tr class="${ri === 0 ? 'an-total' : ''}"><th>${escapeHtml(team)} <small>${ts.length}</small></th>${completenessFields.map(([f, l]) => { const count = ts.filter(t => filled(t, f)).length, share = ts.length ? count / ts.length : 0; return `<td class="an-cell ${share < .8 ? 'an-cell-bad' : ''}" data-team="${escapeHtml(team)}" data-field="${f}" data-label="${escapeHtml(l)}" style="--heat:${share}">${pct(count, ts.length)}</td>`; }).join('')}<td>${pct(completenessFields.reduce((s, [f]) => s + ts.filter(t => filled(t, f)).length, 0), ts.length * completenessFields.length)}</td></tr>`).join('')}</tbody></table></div>`;
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

function initPo() { renderCompleteness(); renderQuality(); renderUniformity(); bindSelect('uniform-field', 'status_name', renderUniformity); }

export async function initAnalytics(type, app) {
  disposeCharts();
  try {
    if (type === 'tribe') { ltData = await app.api.get('/tasks/analytics/lt-reports'); initLt(); }
    else if (type === 'po-pl') { poData = await app.api.get('/tasks/analytics/po-pl-reports'); initPo(); }
    if (window.lucide) window.lucide.createIcons();
  } catch (error) {
    console.error('Analytics load error:', error);
    const page = document.querySelector('.an-page');
    if (page) page.innerHTML += `<div class="an-error">Не удалось загрузить аналитику: ${escapeHtml(error.message || error)}</div>`;
  }
}
