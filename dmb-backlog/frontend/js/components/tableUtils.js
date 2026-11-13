import { COLUMN_BASE, DEFAULT_MIN, MIN_RESIZE, registerColumnInteractions } from '../ui/tableColumns.js';
export { autoSizeColumns, applyColumnWidths } from '../ui/tableColumns.js';
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

const registered = { sort: {} };
let bound = false;

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
  return `<th data-sort="${key}"${cls} aria-sort="${order}"><button type="button" class="btn btn-ghost btn-sm ui-btn table-sort-button" title="${escapeHtml(label)}" aria-label="Сортировать: ${escapeHtml(label)}"><span class="th-label">${escapeHtml(label)}</span><span class="sort-icon" aria-hidden="true">${icon}</span></button><span class="th-resize-handle" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Ширина колонки: ${escapeHtml(label)}" aria-valuemin="${key === 'id' ? COLUMN_BASE.id : MIN_RESIZE}" aria-valuenow="${COLUMN_BASE[key] || DEFAULT_MIN}" title="Изменить ширину: ← / →; Home — автоматическая ширина"></span></th>`;
}

export function visibleTaskColumns(order, settings) {
  settings.id = true;
  if (order[0] !== 'id') order.splice(0, order.length, 'id', ...order.filter(key => key !== 'id'));
  return ['id', ...order.filter(key => key !== 'id' && settings[key])];
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
  registerColumnInteractions(tableId, opts);
  if (!bound) {
    bound = true;
    document.addEventListener('click', onHeaderClick);
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
