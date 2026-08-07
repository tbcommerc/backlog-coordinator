console.log('[DMB] tableUtils.js v20260806.6 loaded');

const PRIORITY_WEIGHT = { 'ВЫСОКИЙ': 3, 'СРЕДНИЙ': 2, 'НИЗКИЙ': 1 };

const NAME_KEYS = {
  status: 'status_name',
  priority: 'priority_name',
  team: 'team_name',
  channel: 'channel_name',
  deadline: 'deadline_name',
  department: 'department_name',
  task_type: 'task_type_name',
  project: 'project_name',
  owner: 'owner_name',
  business_customer: 'business_customer_name',
};

const COLUMN_MAX = {
  id: 90, title: 320, description: 220, comment: 220, rejection_reason: 220,
  financial_effect_justification: 220,
  status: 210, priority: 125, team: 200, channel: 170, business_customer: 190,
  department: 200, project: 210, task_type: 170, involved_teams: 210,
  deadline: 135, effort_days: 95, effort_rub: 115, financial_effect: 135,
  cv: 75, progress: 180, owner: 210, link_mockups: 105, link_jira: 105,
  date_received: 130, created_at: 155, updated_at: 155, tags: 180,
  metric_kr_plan: 135, metric_kr_fact: 135, metric_kr_unit: 95,
  key_project_status: 190, directorate_status: 190, did_status: 190,
  created_by: 210, did_demo: 95,
  key_project_status_updated_at: 155, directorate_status_updated_at: 155, did_status_updated_at: 155,
};

const COLUMN_MIN = { progress: 115, effort_days: 90, id: 90, cv: 90 };
const DEFAULT_MAX = 340;
const DEFAULT_MIN = 90;
const MIN_RESIZE = 90;
const MIN_LABEL_PX = 32;
const MAX_SAMPLES = 25;

const registered = { sort: {}, widths: {}, minWidths: {}, layout: {}, fixed: {}, unfix: {} };
let bound = false;
let suppressClick = false;

export function autoSizeColumns(table, cols, widths, minWidths, opts = {}) {
  const offset = opts.offset || 0;
  const ths = Array.from(table.querySelectorAll('thead th'));
  const colEls = Array.from(table.querySelectorAll('colgroup > col'));
  const sampleRows = Array.from(table.querySelectorAll('tbody tr')).slice(0, MAX_SAMPLES);
  cols.forEach((key, i) => {
    const th = ths[i + offset];
    const col = colEls[i + offset];
    if (!th || !col) return;
    if (widths[key]) return;
    let w = th.offsetWidth || DEFAULT_MIN;
    const maxCell = Math.max(0, ...sampleRows.map(tr => tr.children[i + offset]?.scrollWidth || 0));
    w = Math.max(w, maxCell);
    const cap = COLUMN_MAX[key] || DEFAULT_MAX;
    const min = COLUMN_MIN[key] || DEFAULT_MIN;
    widths[key] = Math.min(Math.max(w, min), cap);
    const icon = th.querySelector('.sort-icon');
    const iconW = icon ? (icon.offsetWidth || 14) : 14;
    minWidths[key] = Math.max(MIN_RESIZE, iconW + 42 + MIN_LABEL_PX);
  });
}

export function applyColumnWidths(table, cols, widths, opts = {}) {
  const offset = opts.offset || 0;
  const fixed = opts.fixed || {};
  const colEls = Array.from(table.querySelectorAll('colgroup > col'));
  const autoCols = cols.filter(k => !fixed[k]);
  const baseSumAuto = autoCols.reduce((s, k) => s + (widths[k] || 0), 0);
  const fixedSum = cols.reduce((s, k) => s + (fixed[k] || 0), 0);
  const prefixSum = colEls.slice(0, offset).reduce((s, c) => s + (parseFloat(c.style.width) || c.offsetWidth || 0), 0);
  const container = table.parentElement?.clientWidth || table.clientWidth || 0;
  const free = container - fixedSum - baseSumAuto - prefixSum;
  const extraPer = autoCols.length > 0 ? Math.max(0, free) / autoCols.length : 0;
  cols.forEach((key, i) => {
    const col = colEls[i + offset];
    if (!col) return;
    col.style.width = (fixed[key] || ((widths[key] || 0) + extraPer)) + 'px';
  });
  table.style.tableLayout = 'fixed';
}

function sortValue(task, key) {
  if (key === 'priority') return PRIORITY_WEIGHT[task.priority_name] ?? 0;
  if (key === 'progress') return task.progress ?? 0;
  if (key === 'cv') {
    return task.financial_effect && task.effort_rub > 0
      ? task.financial_effect / task.effort_rub : null;
  }
  if (key === 'deadline') return task.deadline_id ?? task.deadline_name ?? task.deadline;
  const nameKey = NAME_KEYS[key];
  if (nameKey && task[nameKey] != null) return task[nameKey];
  return task[key];
}

export function applyColumnSort(list, key, dir) {
  if (!key || !Array.isArray(list)) return list;
  const m = dir === 'desc' ? -1 : 1;
  const arr = [...list];
  arr.sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * m;
    const sa = String(va);
    const sb = String(vb);
    const na = parseFloat(sa);
    const nb = parseFloat(sb);
    if (!isNaN(na) && !isNaN(nb) && sa.trim() !== '' && sb.trim() !== '') return (na - nb) * m;
    return sa.localeCompare(sb, 'ru') * m;
  });
  return arr;
}

export function toggleSortState(state, key) {
  if (state.key === key) {
    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.key = key;
    state.dir = 'asc';
  }
}

export function headerCellHtml(label, key, sortKey, sortDir) {
  const icon = key === sortKey ? (sortDir === 'asc' ? '↑' : '↓') : '↕';
  const cls = key === sortKey ? ' class="th-sorted"' : '';
  return `<th data-sort="${key}"${cls}><span class="th-label">${label}</span><span class="sort-icon">${icon}</span><span class="th-resize-handle"></span></th>`;
}

export function registerTableInteractions(tableId, opts = {}) {
  if (opts.onSort) registered.sort[tableId] = opts.onSort;
  if (opts.getWidths) registered.widths[tableId] = opts.getWidths;
  if (opts.getMinWidths) registered.minWidths[tableId] = opts.getMinWidths;
  if (opts.getLayout) registered.layout[tableId] = opts.getLayout;
  if (opts.getFixed) registered.fixed[tableId] = opts.getFixed;
  if (opts.onUnfix) registered.unfix[tableId] = opts.onUnfix;
  if (!bound) {
    bound = true;
    document.addEventListener('click', onHeaderClick);
    document.addEventListener('dblclick', onHeaderDblClick);
    document.addEventListener('mousedown', onHeaderMouseDown);
  }
}

function getOriginalTable(th) {
  const t = th.closest('table');
  if (!t) return null;
  if (t.id) return t;
  const src = t.dataset && t.dataset.sourceTable;
  return src ? document.getElementById(src) : null;
}

function onHeaderClick(e) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  if (e.target.closest('.th-resize-handle')) return;
  const table = getOriginalTable(th);
  if (!table || !registered.sort[table.id]) return;
  e.preventDefault();
  registered.sort[table.id](th.dataset.sort, th);
}

function onHeaderMouseDown(e) {
  const handle = e.target.closest('.th-resize-handle');
  if (!handle) return;
  const th = handle.closest('th');
  const table = getOriginalTable(th);
  if (!table || !registered.widths[table.id]) return;
  e.preventDefault();
  e.stopPropagation();
  startResize(e, th, table);
}

function onHeaderDblClick(e) {
  const handle = e.target.closest('.th-resize-handle');
  if (!handle) return;
  const th = handle.closest('th');
  const key = th.dataset.sort;
  const table = getOriginalTable(th);
  if (!table || !key) return;
  const getFixed = registered.fixed[table.id];
  const fixed = getFixed ? getFixed() : null;
  if (!fixed || !(key in fixed)) return;
  e.preventDefault();
  e.stopPropagation();
  const getWidths = registered.widths[table.id];
  const widths = getWidths ? getWidths() : null;
  fixed[key] = (widths && widths[key]) || fixed[key];
  if (registered.unfix[table.id]) registered.unfix[table.id](key);
}

function startResize(e, th, table) {
  const key = th.dataset.sort;
  const colEls = table.querySelectorAll('colgroup > col');
  const colEl = colEls[th.cellIndex];
  if (!colEl) return;
  const getFixed = registered.fixed[table.id];
  const fixed = getFixed ? getFixed() : null;
  const widths = registered.widths[table.id]();
  const layout = registered.layout[table.id] ? registered.layout[table.id]() : null;
  const cols = layout?.cols || [];
  const offset = layout?.offset || 0;
  const minWidths = registered.minWidths[table.id] ? registered.minWidths[table.id]() : null;
  const minW = Math.max(MIN_RESIZE, (key && minWidths && minWidths[key]) || 0);
  const startX = e.clientX;
  const startWidth = parseFloat(colEl.style.width) || colEl.offsetWidth || 0;
  const floor = Math.min(minW, startWidth);
  let moved = false;
  document.body.classList.add('resizing-table');
  const onMove = (ev) => {
    moved = true;
    const w = Math.max(floor, startWidth + (ev.clientX - startX));
    if (key && fixed) fixed[key] = w;
    applyColumnWidths(table, cols, widths, { offset, fixed });
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('resizing-table');
    if (moved) {
      suppressClick = true;
    }
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
