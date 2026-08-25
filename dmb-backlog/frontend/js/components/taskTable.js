console.log('[DMB] taskTable.js v20260807 loaded');
import { renderToolbar, initToolbar, initToolbarControls, getFilteredList as ftFilteredList, resetToolbarFilters, updateStickyOffsets, initStickyTableHeader, setToolbarSortValue, isDeadlinePast, canEditTaskForScope } from './filterToolbar.js?v=81';
import { renderTaskCard, openTaskModal, setOnTaskSaved, importTasksFromExcel, showBulkOpsModal } from './modal.js?v=90';
import { buildColumnLabels, buildColumnSettings, getAllColumnKeys } from './taskColumns.js';
import { renderQuickEditToolbar, initQuickEdit, enterQuickEdit, requestExitQuickEdit, isQuickEdit, getQuickEditChanges, getQuickEditError, getQuickEditField, isEditableField, renderQuickEditCell } from './quickEdit.js?v=71';
import { renderQuickFilters, initQuickFilters, syncQuickFilterButtons } from './quickFilters.js?v=66';
import { autoSizeColumns, applyColumnWidths, applyColumnSort, toggleSortState, headerCellHtml, registerTableInteractions, persistColumnState, readColumnState } from './tableUtils.js?v=48';
import { safeExternalUrl } from '../urlUtils.js';
import { escapeHtml } from '../htmlUtils.js';
import { bindViewStateAction, renderViewState } from './viewState.js';

function renderExternalTaskLink(value, label) {
  const raw = Array.isArray(value) ? value[0] : value;
  const url = safeExternalUrl(raw);
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">${label}</a>` : '—';
}

let tasksCache = null;
let currentView = 'table';
const DMB_DEFAULT_OVERRIDES = {
  id: true, title: true, status: true, priority: true, team: true,
  progress: true, financial_effect: true, effort_days: true, cv: true,
  deadline: true, owner: false, channel: false,
  department: false, task_type: false,
  key_project_status: false
};
let COLUMN_LABELS = { ...buildColumnLabels(window.app?.fieldLabels || {}) };
let columnSettings = buildColumnSettings({}, DMB_DEFAULT_OVERRIDES);
let columnOrder = getAllColumnKeys();

let currentApp = null;
let columnWidths = {};
let columnMinWidths = {};
const columnFixed = {};
const columnSort = { key: null, dir: 'asc' };
let paginationPage = 1;
const PAGE_SIZE = 100;
const COLUMNS_STORAGE_KEY = 'dmb_backlog_columns_v1';
let autoRefreshTimer = null;
let keyboardHandler = null;
let tasksLoadInProgress = false;
let tasksReloadQueued = false;
const TERMINAL_STATUSES = ['ВЫПОЛНЕНА', 'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА'];

export function renderTasksPage(app) {
  currentApp = app;
  return `
    ${renderToolbar('backlog', {
      title: 'Бэклог DMB',
      subtitle: 'Все задачи платформы',
      columnSettings,
      columnOrder,
      columnLabels: COLUMN_LABELS,
      onImport: true,
      excel: true,
      onQuickEdit: true,
      onBulkOps: true,
      savedViews: true,
      quickFilters: renderQuickFilters(),
    })}

    <div id="tasks-content">
      <div id="backlog-bulk-actions" class="flex items-center gap-3" style="margin-bottom:var(--space-4);display:none;">
        <span class="text-secondary">Выбрано: <strong id="backlog-selected-count">0</strong></span>
        <button class="btn btn-secondary btn-sm" id="backlog-bulk-selected">Массовые операции (0)</button>
      </div>

      ${renderQuickEditToolbar('backlog')}

      <div id="tasks-container">
        <div class="table-container" style="overflow-x:auto;">
          <table class="table" id="tasks-table">
            <thead>
              <tr id="table-header-row"></tr>
            </thead>
            <tbody id="tasks-tbody">
              ${renderSkeletonRows(8)}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="flex justify-between items-center pagination-footer" style="margin-top: var(--space-6);">
      <span class="text-secondary" id="tasks-count">Найдено: 0 задач</span>
      <div class="flex gap-2" id="pagination"></div>
    </div>
  `;
}

async function applyDefaultDisplaySettings(app) {
  try {
    const resp = await app.api.get('/admin/display-settings/shared');
    if (resp && resp.settings) {
      const savedKeys = Object.keys(resp.settings);
      if (savedKeys.length > 0) {
        const validKeys = new Set(getAllColumnKeys());
        const KEY_MAP = { financial: 'financial_effect', effort: 'effort_days' };
        const newSettings = {};
        savedKeys.forEach(key => {
          const mapped = KEY_MAP[key] || key;
          if (validKeys.has(mapped) && resp.settings[key] !== undefined) {
            newSettings[mapped] = resp.settings[key];
          }
        });
        columnSettings = buildColumnSettings(newSettings, DMB_DEFAULT_OVERRIDES);
        columnOrder = getAllColumnKeys();
      }
    }
  } catch (e) {
    console.log('[DMB] No display settings, using defaults');
  }
}

export async function initTasksPage(app) {
  COLUMN_LABELS = { ...buildColumnLabels(window.app?.fieldLabels || {}) };
  await applyDefaultDisplaySettings(app);
  loadBacklogColumnState();
  await loadTasks(app);

  function onFilterChange() {
    paginationPage = 1;
    syncQuickFilterButtons('backlog');
    renderCurrentView();
  }

  const tasks = tasksCache?.items || [];
  initToolbar('backlog', tasks, onFilterChange);

  initQuickFilters('backlog', () => tasksCache?.items || []);

  initToolbarControls('backlog', {
    columnSettings,
    columnOrder,
    columnLabels: COLUMN_LABELS,
    defaultColumnSettings: buildColumnSettings({}, DMB_DEFAULT_OVERRIDES),
    onViewChange: (view) => { currentView = view; renderCurrentView(); },
    onColumnChange: () => { saveBacklogColumnState(); renderCurrentView(); },
    onColumnOrderChange: () => { saveBacklogColumnState(); renderCurrentView(); },
    onExport: () => { const list = getFilteredList(); exportExcel(list); },
    onImport: () => { importTasksFromExcel(app, loadTasks); },
    onRefresh: () => loadTasks(app),
    onQuickEdit: () => { if (currentView === 'table') { if (isQuickEdit('backlog')) { requestExitQuickEdit('backlog'); } else { enterQuickEdit('backlog'); } } },
    onBulkOps: () => { if (currentView === 'table') openBacklogBulkOps(app); },
    showSavedViewRevert: false,
    getSavedViewState: () => ({
      view: currentView,
      columns: { ...columnSettings },
      columnOrder: [...columnOrder],
      widths: { ...columnWidths },
      fixed: { ...columnFixed },
      columnSort: { ...columnSort },
    }),
    applySavedViewState: applyBacklogSavedViewState,
  });

  setOnTaskSaved(() => loadTasks(app));

  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    if (!isBacklogRouteActive()) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
      return;
    }
    if (!isBacklogInteractionActive()) loadTasks(app);
  }, 60000);

  if (keyboardHandler) window.removeEventListener('keydown', keyboardHandler);
  keyboardHandler = (e) => {
    if (e.defaultPrevented) return;
    const tag = document.activeElement?.tagName;
    const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    if (e.key === '/' && !editing) {
      e.preventDefault();
      document.getElementById('f-backlog-search')?.focus();
    } else if (e.key.toLowerCase() === 'r' && !editing && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      loadTasks(app);
    }
  };
  window.addEventListener('keydown', keyboardHandler);

  initQuickEdit('backlog', {
    app: currentApp,
    getTasks: () => tasksCache?.items || [],
    getColumnLabel,
    renderView: renderCurrentView,
    afterSave: () => loadTasks(currentApp),
    tableContainer: '#tasks-container .table-container',
  });

  registerTableInteractions('tasks-table', {
    getWidths: () => columnWidths,
    getMinWidths: () => columnMinWidths,
    getLayout: () => ({ cols: columnOrder.filter(k => columnSettings[k]), offset: isQuickEdit('backlog') ? 0 : 1 }),
    getFixed: () => columnFixed,
    onResizeEnd: saveBacklogColumnState,
    onUnfix: () => { saveBacklogColumnState(); renderCurrentView(); },
    onSort: (key) => {
      toggleSortState(columnSort, key);
      paginationPage = 1;
      setToolbarSortValue('backlog', 'id-desc');
      saveBacklogColumnState();
      renderCurrentView();
    },
  });
}

function getColumnLabel(key) {
  return COLUMN_LABELS[key] || key;
}

function saveBacklogColumnState() {
  persistColumnState(COLUMNS_STORAGE_KEY, {
    settings: columnSettings,
    order: columnOrder,
    widths: columnWidths,
    fixed: columnFixed,
    sort: columnSort,
  });
}

function loadBacklogColumnState() {
  const st = readColumnState(COLUMNS_STORAGE_KEY);
  if (!st) return;
  const validKeys = new Set(getAllColumnKeys());
  if (st.settings) {
    const newSettings = {};
    Object.keys(st.settings).forEach(k => { if (validKeys.has(k)) newSettings[k] = st.settings[k]; });
    columnSettings = buildColumnSettings(newSettings, DMB_DEFAULT_OVERRIDES);
  }
  if (Array.isArray(st.order)) columnOrder = st.order.filter(k => validKeys.has(k));
  if (st.widths) {
    columnWidths = {};
    Object.keys(st.widths).forEach(k => { columnWidths[k] = st.widths[k]; });
  }
  if (st.fixed) {
    Object.keys(columnFixed).forEach(k => delete columnFixed[k]);
    Object.keys(st.fixed).forEach(k => { if (st.fixed[k]) columnFixed[k] = st.fixed[k]; });
  }
  if (st.sort && st.sort.key) {
    columnSort.key = st.sort.key;
    columnSort.dir = st.sort.dir || 'asc';
  }
}

function renderSkeletonRows(count) {
  return Array.from({ length: count }, () => `
    <tr class="skeleton-row">
      <td><div class="skeleton skeleton-block w-30"></div></td>
      <td><div class="skeleton skeleton-block w-80"></div></td>
      <td><div class="skeleton skeleton-block w-60"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-60"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-30"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
    </tr>
  `).join('');
}

async function loadTasks(app) {
  if (tasksLoadInProgress) {
    tasksReloadQueued = true;
    return;
  }
  tasksLoadInProgress = true;
  try {
    const data = await loadAllTaskPages(app, '');
    tasksCache = data;
    renderCurrentView();
  
  } catch (e) {
    const container = document.getElementById('tasks-container');
    if (container) {
      container.innerHTML = renderViewState({
        kind: 'error',
        message: window.formatErrorMessage?.(e) || 'Повторите попытку позже.',
        actionLabel: 'Повторить',
      });
      bindViewStateAction(container, () => loadTasks(app));
      window.lucide?.createIcons();
    }
  } finally {
    tasksLoadInProgress = false;
    if (tasksReloadQueued) {
      tasksReloadQueued = false;
      if (isBacklogRouteActive()) await loadTasks(app);
    }
  }
}

function isBacklogRouteActive() {
  return (window.location.hash.slice(1).split('?')[0] || '/') === '/backlog';
}

function isBacklogInteractionActive() {
  return isQuickEdit('backlog')
    || document.querySelector('.backlog-task-checkbox:checked') !== null
    || document.getElementById('task-detail-overlay') !== null
    || document.getElementById('create-task-overlay') !== null
    || document.getElementById('bulk-modal-overlay') !== null;
}

function applyBacklogSavedViewState(state = {}) {
  if (state.view === 'table' || state.view === 'cards') currentView = state.view;
  if (state.columns) {
    Object.keys(columnSettings).forEach(key => { columnSettings[key] = !!state.columns[key]; });
  }
  if (Array.isArray(state.columnOrder)) {
    const valid = new Set(getAllColumnKeys());
    const savedOrder = state.columnOrder.filter(key => valid.has(key));
    columnOrder.splice(0, columnOrder.length, ...savedOrder, ...getAllColumnKeys().filter(key => !savedOrder.includes(key)));
  }
  columnWidths = state.widths ? { ...state.widths } : {};
  Object.keys(columnFixed).forEach(key => delete columnFixed[key]);
  Object.assign(columnFixed, state.fixed || {});
  columnSort.key = state.columnSort?.key || null;
  columnSort.dir = state.columnSort?.dir || 'asc';
  document.querySelectorAll('#backlog-view-toggle-group [data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === currentView));
  saveBacklogColumnState();
  renderCurrentView();
}

async function loadAllTaskPages(app, extraQuery) {
  const perPage = 1000;
  const suffix = extraQuery ? `&${extraQuery}` : '';
  const first = await app.api.get(`/tasks/?page=1&per_page=${perPage}${suffix}`);
  const pages = Math.max(1, Number(first.pages) || 1);
  if (pages === 1) return first;

  const requests = [];
  for (let page = 2; page <= pages; page++) {
    requests.push(app.api.get(`/tasks/?page=${page}&per_page=${perPage}${suffix}`));
  }
  const rest = await Promise.all(requests);
  const items = [first, ...rest].flatMap(part => part.items || []);
  return { ...first, items, total: Number(first.total) || items.length, page: 1, per_page: items.length, pages: 1 };
}

function getFilteredList() {
  if (!tasksCache) return [];
  let list = ftFilteredList('backlog', tasksCache.items || []);
  if (columnSort.key) list = applyColumnSort(list, columnSort.key, columnSort.dir);
  return list;
}

function renderCurrentView() {
  const list = getFilteredList();
  const countEl = document.getElementById('tasks-count');
  if (countEl) countEl.textContent = `Найдено: ${list.length} задач`;
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (paginationPage > totalPages) paginationPage = totalPages;
  const pageList = list.slice((paginationPage - 1) * PAGE_SIZE, paginationPage * PAGE_SIZE);
  if (currentView === 'cards') {
    renderCardView(pageList);
  } else {
    renderTableView(pageList);
  }
  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const container = document.getElementById('pagination');
  if (!container) return;
  if (totalPages <= 1) { container.innerHTML = ''; return; }
  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - paginationPage) <= 1) pages.push(p);
  }
  let html = '';
  let prev = 0;
  pages.forEach(p => {
    if (p - prev > 1) html += '<button class="btn btn-sm btn-ghost" disabled style="opacity:.4;min-width:34px;">…</button>';
    html += `<button class="btn btn-sm ${p === paginationPage ? 'btn-primary' : 'btn-secondary'}" data-page="${p}" style="min-width:34px;">${p}</button>`;
    prev = p;
  });
  container.innerHTML = html;
  container.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
      paginationPage = parseInt(btn.dataset.page);
      renderCurrentView();
    });
  });
}

function renderTableView(list) {
  const container = document.getElementById('tasks-container');
  if (!container) return;

  const visibleCols = columnOrder.filter(k => columnSettings[k]);
  const showCheckbox = !isQuickEdit('backlog') && list.some(task => canEditTaskForScope('backlog', task));

  const hasWidths = visibleCols.every(c => columnWidths[c]);

  const colgroupHtml = visibleCols.map((col, i) => {
    const w = columnWidths[col] ? `width:${columnWidths[col]}px;` : '';
    return `<col style="${w}">`;
  }).join('');

  const checkboxCol = showCheckbox ? '<col style="width:40px;">' : '';
  const tableStyle = hasWidths ? 'table-layout:fixed;' : '';

  container.innerHTML = `
    <div class="table-container" style="overflow-x:auto;">
      <table class="table" id="tasks-table" style="${tableStyle}">
        <colgroup>${checkboxCol}${colgroupHtml}</colgroup>
        <thead>
          <tr>
            ${showCheckbox ? '<th><input type="checkbox" id="backlog-select-all" aria-label="Выбрать все задачи на странице"></th>' : ''}
            ${visibleCols.map(col => headerCellHtml(getColumnLabel(col), col, columnSort.key, columnSort.dir)).join('')}
          </tr>
        </thead>
        <tbody id="tasks-tbody">
          ${list.length === 0
            ? '<tr><td colspan="' + (visibleCols.length + (showCheckbox ? 1 : 0)) + '">' + renderViewState({ kind: 'empty', title: 'Задачи не найдены', message: 'Измените фильтры или создайте новую задачу.' }) + '</td></tr>'
            : list.map(task => renderTableRow(task, visibleCols, showCheckbox)).join('')}
        </tbody>
      </table>
    </div>
  `;

  if (!isQuickEdit('backlog')) {
    const table = document.getElementById('tasks-table');
    if (!hasWidths) {
      autoSizeColumns(table, visibleCols, columnWidths, columnMinWidths, { offset: showCheckbox ? 1 : 0 });
    }
    applyColumnWidths(table, visibleCols, columnWidths, { offset: showCheckbox ? 1 : 0, fixed: columnFixed });
    saveBacklogColumnState();
  }

  updateStickyOffsets();
  initStickyTableHeader('tasks-table');

  if (!isQuickEdit('backlog')) {
    bindBacklogSelection();
    document.getElementById('tasks-tbody')?.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.backlog-task-checkbox, input, button, a')) return;
        const t = list.find(x => x.id == tr.dataset.taskId);
        if (t) openTaskModal(t);
      });
    });
  }
}

function renderCell(col, task) {
  if (isQuickEdit('backlog') && canEditTaskForScope('backlog', task) && isEditableField(col)) {
    return renderQuickEditCell('backlog', col, task);
  }

  switch (col) {
    case 'id': return `<span class="font-mono text-muted">#${task.id}</span>`;
    case 'title': return `<strong class="cell-truncate">${escapeHtml(task.title)}</strong>`;
    case 'description': return `<span class="cell-truncate">${escapeHtml(task.description || '—')}</span>`;
    case 'date_received': return `<span>${escapeHtml(task.date_received || '—')}</span>`;
    case 'status': return `<span>${renderStatus(task.status_name || task.status)}</span>`;
    case 'priority': return `<span>${renderPriority(task.priority_name || task.priority)}</span>`;
    case 'team': return `<span class="badge badge-info">${escapeHtml(task.team_name || '—')}</span>`;
    case 'channel': return `<span>${escapeHtml(task.channel_name || '—')}</span>`;
    case 'business_customer': return `<span>${escapeHtml(task.business_customer_name || task.business_customer || '—')}</span>`;
    case 'department': return `<span>${escapeHtml(task.department_name || '—')}</span>`;
    case 'project': return `<span>${escapeHtml(task.project_name || '—')}</span>`;
    case 'task_type': return `<span>${escapeHtml(task.task_type_name || '—')}</span>`;
    case 'involved_teams': return `<span class="cell-truncate">${escapeHtml(resolveInvolvedTeams(task.involved_team_names || task.involved_teams))}</span>`;
    case 'deadline': return `<span>${renderDeadline(task)}</span>`;
    case 'deadline_po': return `<span>${escapeHtml(task.deadline_po_name || '—')}</span>`;
    case 'effort_days': return `<span>${task.effort_days != null ? task.effort_days + ' дн' : '—'}</span>`;
    case 'effort_rub': return `<span class="font-mono">${metricFormat(task.effort_rub)}</span>`;
    case 'effort_designee':
    case 'effort_analytics':
    case 'effort_be':
    case 'effort_python_be':
    case 'effort_fe':
    case 'effort_test':
    case 'effort_test_auto':
    case 'effort_delivery':
    case 'actual_effort_days':
    case 'actual_effort_designee':
    case 'actual_effort_analytics':
    case 'actual_effort_be':
    case 'actual_effort_python_be':
    case 'actual_effort_fe':
    case 'actual_effort_test':
    case 'actual_effort_test_auto':
    case 'actual_effort_delivery':
        return `<span class="font-mono">${task[col] != null && task[col] !== '' ? metricFormat(task[col]) : '—'}</span>`;
    case 'financial_effect': return `<span class="font-mono">${metricFormat(task.financial_effect)}</span>`;
    case 'cv': return `<span>${renderCV(task)}</span>`;
    case 'progress': return `<span>${renderProgress(task.progress)}</span>`;
    case 'owner': return `<span>${escapeHtml(task.owner_name || task.owner || '—')}</span>`;
    case 'key_project_status': return `<span class="cell-truncate">${escapeHtml(task.key_project_status || '—')}</span>`;
    case 'directorate_status': return `<span class="cell-truncate">${escapeHtml(task.directorate_status || '—')}</span>`;
    case 'did_status': return `<span class="cell-truncate">${escapeHtml(task.did_status || '—')}</span>`;
    case 'link_mockups': return `<span>${renderExternalTaskLink(task.link_mockups, 'Макеты')}</span>`;
    case 'link_jira': return `<span>${renderExternalTaskLink(task.link_jira, 'Jira')}</span>`;
    case 'rejection_reason': return `<span class="cell-truncate">${escapeHtml(task.rejection_reason || '—')}</span>`;
    case 'comment': return `<span class="cell-truncate">${escapeHtml(task.comment || '—')}</span>`;
    case 'created_at': return `<span>${escapeHtml(task.created_at || '—')}</span>`;
    case 'updated_at': return `<span>${escapeHtml(task.updated_at || '—')}</span>`;
    case 'metric_kr_plan':
    case 'metric_kr_fact': return `<span class="font-mono">${metricFormat(task[col])}${task.metric_kr_unit ? ' ' + task.metric_kr_unit : ''}</span>`;
    case 'metric_kr_unit': return `<span>${escapeHtml(task.metric_kr_unit || '—')}</span>`;
    case 'tags': return renderTags(task.tags);
    default: return '';
  }
}

function resolveInvolvedTeams(teams) {
  if (!teams || !teams.length) return '—';
  const items = Array.isArray(teams) ? teams : (() => {
    if (typeof teams === 'string') {
      const trimmed = teams.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) return parsed;
        } catch (_) {}
      }
      return trimmed.split(',').map(x => x.trim()).filter(Boolean);
    }
    return [teams];
  })();
  if (!items.length) return '—';
  if (!Array.isArray(items)) return '—';
  const teamNames = (window.app?.teams || []).map(team => ({ id: Number(team.id), name: team.name || '' }));
  const map = new Map(teamNames.map(x => [x.id, x.name]));
  return items.map(v => {
    const key = Number(v);
    return Number.isNaN(key) ? String(v) : (map.get(key) || String(v));
  }).join(', ');
}

function renderTableRow(task, cols, showCheckbox) {
  const changes = getQuickEditChanges('backlog');
  const saveError = getQuickEditError('backlog', task.id);
  const cells = cols.map(col => {
    const field = getQuickEditField(col);
    const change = changes[task.id]?.[field];
    const isChanged = !!change;
    const cellStyle = isChanged ? 'background: rgba(245, 158, 11, 0.2);' : '';
    return `<td style="${cellStyle}">${renderCell(col, task)}</td>`;
  });
  const hasChanges = changes[task.id] && Object.keys(changes[task.id]).length > 0;
  const rowStyle = saveError
    ? `cursor:default;border-left:3px solid var(--danger);background:rgba(239,68,68,.06);`
    : hasChanges
    ? `cursor:default;border-left:3px solid var(--warning);`
    : (isQuickEdit('backlog') ? 'cursor:default;' : 'cursor:pointer;');
  const checkboxHtml = showCheckbox ? `<td>${canEditTaskForScope('backlog', task) ? `<input type="checkbox" class="backlog-task-checkbox" value="${task.id}" aria-label="Выбрать задачу ${task.id}">` : '<span title="Нет прав на изменение этой задачи" style="color:var(--text-muted);">—</span>'}</td>` : '';
  const errorCell = saveError && cells.length > 0
    ? cells.map((cell, index) => index === 0
      ? cell.replace('>', ` title="${escapeHtml(saveError)}">⚠ `).replace('</td>', `<div style="margin-top:4px;color:var(--danger);font-size:11px;white-space:normal;">${escapeHtml(saveError)}</div></td>`)
      : cell)
    : cells;
  return `<tr data-task-id="${task.id}" style="${rowStyle}" ${saveError ? `aria-label="Ошибка сохранения: ${escapeHtml(saveError)}"` : ''}>${checkboxHtml}${errorCell.join('')}</tr>`;
}

function getBacklogSelectedTasks() {
  const ids = new Set([...document.querySelectorAll('.backlog-task-checkbox:checked')].map(cb => Number(cb.value)));
  return (tasksCache?.items || []).filter(task => ids.has(task.id));
}

function updateBacklogBulkBar() {
  const count = document.querySelectorAll('.backlog-task-checkbox:checked').length;
  const bar = document.getElementById('backlog-bulk-actions');
  if (bar) bar.style.display = count > 0 ? 'flex' : 'none';
  const countEl = document.getElementById('backlog-selected-count');
  if (countEl) countEl.textContent = String(count);
  const action = document.getElementById('backlog-bulk-selected');
  if (action) action.textContent = `Массовые операции (${count})`;
  const toolbarAction = document.getElementById('backlog-bulk-open');
  if (toolbarAction) toolbarAction.title = count > 0 ? `Массовые операции (${count} выбрано)` : 'Массовые операции';
}

function bindBacklogSelection() {
  document.getElementById('backlog-select-all')?.addEventListener('change', function () {
    document.querySelectorAll('.backlog-task-checkbox').forEach(cb => { cb.checked = this.checked; });
    updateBacklogBulkBar();
  });
  document.querySelectorAll('.backlog-task-checkbox').forEach(cb => cb.addEventListener('change', updateBacklogBulkBar));
  document.getElementById('backlog-bulk-selected')?.addEventListener('click', () => openBacklogBulkOps(currentApp));
  updateBacklogBulkBar();
}

async function openBacklogBulkOps(app) {
  const selected = getBacklogSelectedTasks();
  const editable = getFilteredList().filter(task => canEditTaskForScope('backlog', task));
  const result = await showBulkOpsModal(app, 'backlog', selected.length > 0 ? selected : editable);
  if (result?.success) await loadTasks(app);
}

function renderCardView(list) {
  const container = document.getElementById('tasks-container');
  if (!container) return;
    container.innerHTML = `
    <div class="task-card-grid">
      ${list.length === 0
        ? renderViewState({ kind: 'empty', title: 'Задачи не найдены', message: 'Измените фильтры или создайте новую задачу.' })
        : list.map(task => renderCard(task)).join('')}
    </div>
  `;
  container.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-icon')) return;
      const t = list.find(x => x.id == card.dataset.id);
      if (t) openTaskModal(t);
    });
  });
  updateBacklogBulkBar();
}

function renderCard(task) {
  return renderTaskCard(task);
}

function renderDeadline(task) {
  const dl = task.deadline_name || task.deadline || '—';
  const overdue = dl !== '—' && task.deadline_id != null && !TERMINAL_STATUSES.includes(task.status_name) && isDeadlinePast(dl);
  return overdue ? `<span style="color:#ef4444;font-weight:600;">${escapeHtml(dl)}</span>` : `<span>${escapeHtml(dl)}</span>`;
}

function renderPriority(priority) {
  const map = { 'ВЫСОКИЙ': 'high', 'СРЕДНИЙ': 'medium', 'НИЗКИЙ': 'low' };
  const cls = map[priority] || 'medium';
  return `<span class="badge badge-${cls}">${escapeHtml(priority || 'СРЕДНИЙ')}</span>`;
}

function renderStatus(status) {
  const statusClass = status ? status.replace(/\s+/g, '_') : 'backlog';
  const colors = {
    'НОВАЯ_ЗАДАЧА': 'badge-status-backlog',
    'НАЗНАЧЕНА_КОМАНДА': 'badge-status-backlog',
    'СБОР_ТРЕБОВАНИЙ': 'badge-status-backlog',
    'ПРОВЕРКА_ТРЕБОВАНИЙ': 'badge-status-backlog',
    'УТОЧНЕНИЕ_ТРЕБОВАНИЙ': 'badge-status-backlog',
    'ЭКСПРЕСС-ОЦЕНКА': 'badge-status-backlog',
    'ПРИНЯТИЕ_РЕШЕНИЯ': 'badge-status-review',
    'ПРИНЯТА_В_РАБОТУ': 'badge-status-in_progress',
    'ЭСКАЛАЦИЯ_НА_ЛТ': 'badge-status-on_hold',
    'ХОЛД': 'badge-status-on_hold',
    'ОТКЛОНЕНА': 'badge-danger',
    'НЕ_АКТУАЛЬНА': 'badge-low',
    'ВЫПОЛНЕНА': 'badge-status-done'
  };
  return `<span class="badge ${colors[statusClass] || 'badge-status-backlog'}">${escapeHtml(status || 'СБОР ТРЕБОВАНИЙ')}</span>`;
}

function renderProgress(progress) {
  const p = progress || 0;
  let colorClass = '';
  if (p >= 100) colorClass = 'success';
  else if (p > 0) colorClass = 'warning';
  return `
    <div style="display:flex;align-items:center;gap:8px;min-width:100px;">
      <div class="progress-bar" style="flex:1;">
        <div class="progress-fill ${colorClass}" style="width:${p}%"></div>
      </div>
      <span style="font-size:var(--text-xs);color:var(--text-secondary);min-width:30px;text-align:right;">${p}%</span>
    </div>
  `;
}

function renderCV(task) {
  const cv = task.financial_effect && task.effort_rub && task.effort_rub > 0
    ? (task.financial_effect / task.effort_rub).toFixed(2) : null;
  if (cv === null) return '<span class="badge badge-low">—</span>';
  const cls = parseFloat(cv) > 1.5 ? 'badge-high' : parseFloat(cv) > 1.0 ? 'badge-warning' : 'badge-danger';
  return `<span class="badge ${cls}">${cv}</span>`;
}

function renderTags(tags) {
  if (!tags || (Array.isArray(tags) && tags.length === 0) || (typeof tags === 'string' && !tags.trim())) return '—';
  let list;
  if (Array.isArray(tags)) {
    list = tags.map(t => typeof t === 'object' && t !== null
      ? { name: String(t.name || ''), color: t.color || '' }
      : { name: String(t), color: '' });
  } else {
    list = String(tags).split(',').map(t => t.trim()).filter(Boolean).map(t => ({ name: t, color: '' }));
  }
  return list.filter(t => t.name).map(t => {
    const color = /^#[0-9a-f]{6}$/i.test(t.color || '') ? t.color : '';
    const style = color ? `background:${color}22;color:${color};border:1px solid ${color}55;` : '';
    return `<span class="badge" style="font-size:10px;${style}">${escapeHtml(t.name)}</span>`;
  }).join(' ');
}

function metricFormat(val) {
  if (val === null || val === undefined) return '—';
  return new Intl.NumberFormat('ru-RU').format(val);
}


function exportExcel(list) {
  if (!list || !list.length) return;
  const visibleCols = Object.keys(columnSettings).filter(k => columnSettings[k]);
  const fields = visibleCols;
  const labels = visibleCols.map(k => COLUMN_LABELS[k] || k);
  let csv = '\uFEFF';
  csv += labels.join(';') + '\n';
  list.forEach(t => {
    const row = fields.map(f => {
      let val = t[f] ?? '';
      if (f === 'cv') {
        val = t.financial_effect && t.effort_rub && t.effort_rub > 0
          ? (t.financial_effect / t.effort_rub).toFixed(2) : '—';
      }
      if (typeof val === 'string' && (val.includes(';') || val.includes('"') || val.includes('\n'))) val = '"' + val.replace(/"/g, '""') + '"';
      return val;
    });
    csv += row.join(';') + '\n';
  });
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `backlog_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}
