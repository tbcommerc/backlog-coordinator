console.log('[DMB] tableUtils.js v20260826.2 loaded');
import { calculateTaskCv } from '../taskMetrics.js';

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

// Base widths follow rendered value formats rather than potentially long labels.
const COLUMN_BASE = {
  id: 105, title: 220, description: 180, comment: 180, rejection_reason: 180,
  financial_effect_justification: 180,
  date_received: 110, status: 120, priority: 105, team: 130, channel: 110,
  business_customer: 150, department: 150, project: 150, task_type: 125,
  involved_teams: 170, deadline: 110, owner: 140, created_by: 140,
  created_at: 140, updated_at: 140,
  effort_days: 95, effort_rub: 115, actual_effort_days: 105,
  financial_effect: 120, cv: 75, progress: 120,
  metric_kr_plan: 110, metric_kr_fact: 110, metric_kr_unit: 110,
  key_project_status: 160, directorate_status: 160, did_status: 160,
  key_project_status_updated_at: 130, directorate_status_updated_at: 130,
  did_status_updated_at: 130, did_demo: 80,
  link_mockups: 90, link_jira: 90, tags: 140,
};

const COLUMN_MAX = {
  id: 110, title: 300, description: 240, comment: 240, rejection_reason: 220,
  financial_effect_justification: 220,
  date_received: 120, status: 150, priority: 115, team: 170, channel: 140,
  business_customer: 180, department: 180, project: 180, task_type: 150,
  involved_teams: 220, deadline: 120, owner: 170, created_by: 170,
  created_at: 150, updated_at: 150,
  effort_days: 105, effort_rub: 130, actual_effort_days: 115,
  financial_effect: 140, cv: 80, progress: 140,
  metric_kr_plan: 125, metric_kr_fact: 125, metric_kr_unit: 120,
  key_project_status: 200, directorate_status: 200, did_status: 200,
  key_project_status_updated_at: 140, directorate_status_updated_at: 140,
  did_status_updated_at: 140, did_demo: 90,
  link_mockups: 100, link_jira: 100, tags: 170,
};
const DEFAULT_MAX = 340;
const DEFAULT_MIN = 90;
const MIN_RESIZE = 90;
const MIN_LABEL_PX = 32;
const MAX_SAMPLES = 25;

const registered = { sort: {}, widths: {}, minWidths: {}, layout: {}, fixed: {}, unfix: {}, resizeEnd: {} };
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
    const icon = th.querySelector('.sort-icon');
    const iconW = icon ? (icon.offsetWidth || 14) : 14;
    const labelW = th.querySelector('.th-label')?.scrollWidth || 0;
    let w = Math.max(COLUMN_BASE[key] || DEFAULT_MIN, labelW + iconW + 46);
    const maxCell = Math.max(0, ...sampleRows.map(tr => tr.children[i + offset]?.scrollWidth || 0));
    w = Math.max(w, maxCell);
    const cap = COLUMN_MAX[key] || DEFAULT_MAX;
    const min = COLUMN_BASE[key] || DEFAULT_MIN;
    widths[key] = Math.min(Math.max(w, min), cap);
    minWidths[key] = Math.max(MIN_RESIZE, iconW + 42 + MIN_LABEL_PX);
  });
}

export function applyColumnWidths(table, cols, widths, opts = {}) {
  const offset = opts.offset || 0;
  const fixed = opts.fixed || {};
  const colEls = Array.from(table.querySelectorAll('colgroup > col'));
  const autoCols = cols.filter(k => !fixed[k]);
  autoCols.forEach(key => {
    const min = COLUMN_BASE[key] || DEFAULT_MIN;
    const max = COLUMN_MAX[key] || DEFAULT_MAX;
    widths[key] = Math.min(Math.max(widths[key] || min, min), max);
  });
  const baseSumAuto = autoCols.reduce((s, k) => s + (widths[k] || 0), 0);
  const fixedSum = cols.reduce((s, k) => s + (fixed[k] || 0), 0);
  const prefixSum = colEls.slice(0, offset).reduce((s, c) => s + (parseFloat(c.style.width) || c.offsetWidth || 0), 0);
  cols.forEach((key, i) => {
    const col = colEls[i + offset];
    if (!col) return;
    col.style.width = (fixed[key] || widths[key] || COLUMN_BASE[key] || DEFAULT_MIN) + 'px';
  });
  table.style.width = Math.ceil(prefixSum + fixedSum + baseSumAuto) + 'px';
  table.style.minWidth = '0';
  table.style.tableLayout = 'fixed';
}

function sortValue(task, key) {
  if (key === 'priority') return PRIORITY_WEIGHT[task.priority_name] ?? 0;
  if (key === 'progress') return task.progress ?? 0;
  if (key === 'cv') {
    return calculateTaskCv(task);
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
  if (opts.onResizeEnd) registered.resizeEnd[tableId] = opts.onResizeEnd;
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
  const getFixed = registered.fixed[table.id];
  const fixed = getFixed ? getFixed() : null;
  const widths = registered.widths[table.id]();
  const layout = registered.layout[table.id] ? registered.layout[table.id]() : null;
  const cols = layout?.cols || [];
  // The selection column is conditional, so its offset can differ from the
  // value captured by the page callback. Derive it from the rendered colgroup.
  const offset = Math.max(0, colEls.length - cols.length);
  const columnIndex = cols.indexOf(key);
  const colEl = columnIndex >= 0 ? colEls[columnIndex + offset] : null;
  if (!colEl) return;
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
      if (registered.resizeEnd[table.id]) registered.resizeEnd[table.id](key, fixed?.[key]);
    }
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

export function persistColumnState(storageKey, state) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state));
  } catch (e) { /* ignore */ }
}

export function readColumnState(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}
