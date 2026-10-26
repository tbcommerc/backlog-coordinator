console.log('[DMB] tableUtils.js v20260901.1 loaded');
import { calculateTaskCv } from '../taskMetrics.js';
import { escapeHtml } from '../htmlUtils.js';

const PRIORITY_ORDER = { 'ВЫСОКИЙ': 1, 'СРЕДНИЙ': 2, 'НИЗКИЙ': 3 };
const referenceSortOrders = {
  status: new Map([
    'НОВАЯ ЗАДАЧА', 'НАЗНАЧЕНА КОМАНДА', 'СБОР ТРЕБОВАНИЙ', 'ПРОВЕРКА ТРЕБОВАНИЙ',
    'УТОЧНЕНИЕ ТРЕБОВАНИЙ', 'ЭКСПРЕСС-ОЦЕНКА', 'ПРИНЯТИЕ РЕШЕНИЯ', 'ПРИНЯТА В РАБОТУ',
    'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА', 'ВЫПОЛНЕНА', 'ЭСКАЛАЦИЯ НА ЛТ', 'ХОЛД',
  ].map((name, index) => [name.toLocaleLowerCase('ru-RU'), index + 1])),
};

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
  did_client_group: 'did_client_group_name',
  created_by: 'created_by_name',
};

export function setReferenceSortOrders(orders = {}) {
  Object.entries(orders).forEach(([key, entries]) => {
    referenceSortOrders[key] = new Map(
      (entries || []).map((entry, index) => [
        String(entry.value ?? entry.name ?? '').trim().toLocaleLowerCase('ru-RU'),
        Number.isFinite(Number(entry.sort_order)) ? Number(entry.sort_order) : index,
      ])
    );
  });
}

function referenceOrder(key, value) {
  if (value == null) return null;
  return referenceSortOrders[key]?.get(String(value).trim().toLocaleLowerCase('ru-RU')) ?? null;
}

function deadlineOrder(value) {
  const text = String(value || '').trim().toLocaleUpperCase('ru-RU');
  if (!text) return null;
  if (/^(?:БЕЗ\s+СРОКА|NO[_\s-]?DEADLINE)$/.test(text)) return Number.MAX_SAFE_INTEGER;
  const quarter = text.match(/^(?:([1-4])\s*Q|Q\s*([1-4]))\s*(20\d{2})$/);
  if (quarter) return Number(quarter[3]) * 10 + Number(quarter[1] || quarter[2]);
  const year = text.match(/^(?:Y\s*)?(20\d{2})(?:\s*Г(?:ОД)?\.?)?$/);
  if (year) return Number(year[1]) * 10 + 5;
  return null;
}

// Base widths follow rendered value formats rather than potentially long labels.
const COLUMN_BASE = {
  id: 170, title: 220, description: 180, comment: 180, rejection_reason: 180,
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
  id: 190, title: 300, description: 240, comment: 240, rejection_reason: 220,
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
const widthObservers = {};
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
  if (fixed.id) fixed.id = Math.max(COLUMN_BASE.id, fixed.id);
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
  const intrinsicWidth = prefixSum + fixedSum + baseSumAuto;
  const containerWidth = table.parentElement?.clientWidth || 0;
  const extraWidth = autoCols.length > 0 ? Math.max(0, containerWidth - intrinsicWidth) : 0;
  cols.forEach((key, i) => {
    const col = colEls[i + offset];
    if (!col) return;
    const baseWidth = fixed[key] || widths[key] || COLUMN_BASE[key] || DEFAULT_MIN;
    const share = !fixed[key] && baseSumAuto > 0
      ? extraWidth * ((widths[key] || 0) / baseSumAuto)
      : 0;
    col.style.width = (baseWidth + share) + 'px';
  });
  table.style.width = Math.ceil(intrinsicWidth + extraWidth) + 'px';
  table.style.minWidth = '0';
  table.style.tableLayout = 'fixed';
  pinIdentityColumn(table, cols, offset);

  if (typeof ResizeObserver !== 'undefined' && table.id && table.parentElement) {
    const current = widthObservers[table.id];
    if (!current || current.table !== table) {
      current?.observer.disconnect();
      const observer = new ResizeObserver(() => applyColumnWidths(table, cols, widths, opts));
      observer.observe(table.parentElement);
      widthObservers[table.id] = { table, observer };
    }
  }
}

function sortValue(task, key) {
  const nameKey = NAME_KEYS[key];
  const displayValue = nameKey && task[nameKey] != null ? task[nameKey] : task[key];
  const configuredOrder = referenceOrder(key, displayValue);
  if (configuredOrder != null) return configuredOrder;
  if (displayValue == null || displayValue === '') return null;
  if (key === 'priority') return PRIORITY_ORDER[task.priority_name] ?? Number.MAX_SAFE_INTEGER;
  if (key === 'progress') return task.progress ?? 0;
  if (key === 'cv') {
    return calculateTaskCv(task);
  }
  if (key === 'deadline') return deadlineOrder(task.deadline_name ?? task.deadline);
  if (key === 'did_demo') return task.did_demo ? 1 : 0;
  if (Array.isArray(displayValue)) {
    return displayValue.map(item => String(item?.name ?? item)).sort((a, b) => a.localeCompare(b, 'ru')).join(', ');
  }
  return displayValue;
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
    if (typeof va === 'number' && typeof vb === 'number') return ((va - vb) * m) || (Number(a.id) - Number(b.id));
    const sa = String(va);
    const sb = String(vb);
    const na = parseFloat(sa);
    const nb = parseFloat(sb);
    if (!isNaN(na) && !isNaN(nb) && sa.trim() !== '' && sb.trim() !== '') return ((na - nb) * m) || (Number(a.id) - Number(b.id));
    return (sa.localeCompare(sb, 'ru') * m) || (Number(a.id) - Number(b.id));
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
  const order = key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
  return `<th data-sort="${key}"${cls} aria-sort="${order}"><button type="button" class="btn btn-ghost btn-sm ui-btn table-sort-button" aria-label="Сортировать: ${escapeHtml(label)}"><span class="th-label">${escapeHtml(label)}</span><span class="sort-icon" aria-hidden="true">${icon}</span></button><span class="th-resize-handle" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Ширина колонки: ${escapeHtml(label)}" aria-valuemin="${key === 'id' ? COLUMN_BASE.id : MIN_RESIZE}" aria-valuenow="${COLUMN_BASE[key] || DEFAULT_MIN}" title="Изменить ширину: ← / →; Home — автоматическая ширина"></span></th>`;
}

export function visibleTaskColumns(order, settings) {
  settings.id = true;
  if (order[0] !== 'id') order.splice(0, order.length, 'id', ...order.filter(key => key !== 'id'));
  return ['id', ...order.filter(key => key !== 'id' && settings[key])];
}

function pinIdentityColumn(table, cols, offset) {
  if (!['tasks-table', 'team-tasks-table'].includes(table.id)) return;
  const index = cols.indexOf('id') + offset;
  const left = offset ? 40 : 0;
  table.querySelectorAll('tr').forEach(row => {
    if (offset && row.children.length > 1) row.children[0].classList.add('table-pinned-selection');
    const cell = row.children[index];
    if (cell && !cell.hasAttribute('colspan')) {
      cell.classList.add('table-pinned-id');
      cell.style.setProperty('--pinned-id-left', `${left}px`);
    }
  });
  table.querySelectorAll('th[data-sort]').forEach(th => {
    th.querySelector('.th-resize-handle')?.setAttribute('aria-valuenow', String(Math.round(th.getBoundingClientRect().width)));
  });
}

export function scrollTableToStart(containerId) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const container = document.getElementById(containerId);
    const scroller = container?.closest('.main-content');
    if (!container || !scroller) return;
    const toolbar = document.querySelector('.sticky-toolbar');
    const toolbarBottom = toolbar && ['fixed', 'sticky'].includes(getComputedStyle(toolbar).position) ? toolbar.getBoundingClientRect().bottom : scroller.getBoundingClientRect().top;
    const editor = [...document.querySelectorAll('.qe-toolbar')].find(el => getComputedStyle(el).display !== 'none');
    const top = editor && getComputedStyle(editor).position === 'sticky' ? Math.max(toolbarBottom, editor.getBoundingClientRect().bottom) : toolbarBottom;
    scroller.scrollTop += container.getBoundingClientRect().top - top;
    const table = container.querySelector('table') || container;
    table.tabIndex = -1;
    table.focus({ preventScroll: true });
  }));
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
    document.addEventListener('keydown', onHeaderKeyDown);
    document.addEventListener('click', async event => {
      const copy = event.target.closest('[data-copy-task-id]');
      if (!copy) return;
      event.stopPropagation();
      try { await navigator.clipboard.writeText(copy.dataset.copyTaskId); window.toast?.('ID скопирован', 'success'); }
      catch { window.toast?.('Не удалось скопировать ID. Выделите и скопируйте текст вручную.', 'warning'); }
    });
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
  requestAnimationFrame(() => {
    const selector = `th[data-sort="${th.dataset.sort}"] .table-sort-button`;
    const target = document.querySelector(`#sticky-header-wrapper [data-source-table="${table.id}"] ${selector}`)
      || document.getElementById(table.id)?.querySelector(selector);
    target?.focus({ preventScroll: true });
  });
}

function onHeaderKeyDown(event) {
  const handle = event.target.closest('.th-resize-handle');
  if (!handle || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
  const th = handle.closest('th');
  const table = getOriginalTable(th);
  const layout = table && registered.layout[table.id]?.();
  const fixed = table && registered.fixed[table.id]?.();
  if (!layout || !fixed) return;
  event.preventDefault();
  event.stopPropagation();
  const key = th.dataset.sort;
  if (event.key === 'Home') delete fixed[key];
  else fixed[key] = Math.max(key === 'id' ? COLUMN_BASE.id : MIN_RESIZE, th.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10));
  const offset = Math.max(0, table.querySelectorAll('colgroup > col').length - layout.cols.length);
  applyColumnWidths(table, layout.cols, registered.widths[table.id](), { offset, fixed });
  handle.setAttribute('aria-valuenow', String(Math.round(table.querySelector(`th[data-sort="${key}"]`).getBoundingClientRect().width)));
  registered.resizeEnd[table.id]?.(key, fixed[key]);
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
