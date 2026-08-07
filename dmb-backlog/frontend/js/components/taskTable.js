console.log('[DMB] taskTable.js v20260806 loaded');
import { renderToolbar, initToolbar, initToolbarControls, getFilteredList as ftFilteredList, resetToolbarFilters, updateStickyOffsets, initStickyTableHeader, setToolbarSortValue } from './filterToolbar.js?v=45';
import { renderTaskCard, openTaskModal, setOnTaskSaved, importTasksFromExcel, showBulkOpsModal } from './modal.js';
import { buildColumnLabels, buildColumnSettings, getAllColumnKeys } from './taskColumns.js';
import { renderQuickEditToolbar, initQuickEdit, enterQuickEdit, requestExitQuickEdit, isQuickEdit, getQuickEditChanges, getQuickEditField, isEditableField, renderQuickEditCell } from './quickEdit.js?v=45';
import { renderQuickFilters, initQuickFilters, syncQuickFilterButtons } from './quickFilters.js?v=45';
import { autoSizeColumns, applyColumnWidths, applyColumnSort, toggleSortState, headerCellHtml, registerTableInteractions } from './tableUtils.js?v=45';

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
    })}

    ${renderQuickFilters()}

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
  await loadTasks(app);

  function onFilterChange() {
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
    onColumnChange: () => renderCurrentView(),
    onColumnOrderChange: () => renderCurrentView(),
    onExport: () => { const list = getFilteredList(); exportExcel(list); },
    onImport: () => { importTasksFromExcel(app, loadTasks); },
    onRefresh: () => loadTasks(app),
    onQuickEdit: () => { if (currentView === 'table') { if (isQuickEdit('backlog')) { requestExitQuickEdit('backlog'); } else { enterQuickEdit('backlog'); } } },
    onBulkOps: () => { if (currentView === 'table') { showBulkOpsModal(app, 'backlog', tasks); } },
  });

  setOnTaskSaved(() => loadTasks(app));

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
    getLayout: () => ({ cols: columnOrder.filter(k => columnSettings[k]), offset: 0 }),
    getFixed: () => columnFixed,
    onUnfix: () => renderCurrentView(),
    onSort: (key) => {
      toggleSortState(columnSort, key);
      setToolbarSortValue('backlog', 'id-desc');
      renderCurrentView();
    },
  });
}

function getColumnLabel(key) {
  return COLUMN_LABELS[key] || key;
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
  try {
    const data = await app.api.get('/tasks?per_page=500');
    tasksCache = data;
    renderCurrentView();
  
  } catch (e) {
    document.getElementById('tasks-tbody').innerHTML =
      `<tr><td colspan="13" class="text-center text-muted" style="padding: 40px;">Ошибка загрузки: ${e.message}</td></tr>`;
  }
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
  const isMobile = window.innerWidth <= 768;
  const view = isMobile ? 'cards' : currentView;
  if (view === 'cards') {
    renderCardView(list);
  } else {
    renderTableView(list);
  }
}

function renderTableView(list) {
  const container = document.getElementById('tasks-container');
  if (!container) return;

  const visibleCols = columnOrder.filter(k => columnSettings[k]);

  const hasWidths = visibleCols.every(c => columnWidths[c]);

  const colgroupHtml = visibleCols.map((col, i) => {
    const w = columnWidths[col] ? `width:${columnWidths[col]}px;` : '';
    return `<col style="${w}">`;
  }).join('');

  const tableStyle = hasWidths ? 'table-layout:fixed;' : '';

  container.innerHTML = `
    <div class="table-container" style="overflow-x:auto;">
      <table class="table" id="tasks-table" style="${tableStyle}">
        <colgroup>${colgroupHtml}</colgroup>
        <thead>
          <tr>
            ${visibleCols.map(col => headerCellHtml(getColumnLabel(col), col, columnSort.key, columnSort.dir)).join('')}
          </tr>
        </thead>
        <tbody id="tasks-tbody">
          ${list.length === 0
            ? '<tr><td colspan="' + visibleCols.length + '" class="text-center text-muted" style="padding:40px;">Нет задач</td></tr>'
            : list.map(task => renderTableRow(task, visibleCols)).join('')}
        </tbody>
      </table>
    </div>
  `;

  if (!isQuickEdit('backlog')) {
    const table = document.getElementById('tasks-table');
    if (!hasWidths) {
      autoSizeColumns(table, visibleCols, columnWidths, columnMinWidths, { offset: 0 });
    }
    applyColumnWidths(table, visibleCols, columnWidths, { offset: 0, fixed: columnFixed });
  }

  updateStickyOffsets();
  initStickyTableHeader('tasks-table');

  if (!isQuickEdit('backlog')) {
    document.getElementById('tasks-tbody')?.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const t = list.find(x => x.id == tr.dataset.taskId);
        if (t) openTaskModal(t);
      });
    });
  }
}

function renderCell(col, task) {
  if (isQuickEdit('backlog') && isEditableField(col)) {
    return renderQuickEditCell('backlog', col, task);
  }

  switch (col) {
    case 'id': return `<span class="font-mono text-muted">#${task.id}</span>`;
    case 'title': return `<strong>${task.title}</strong>`;
    case 'description': return `<span style="color:var(--text-muted);font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;">${task.description || '—'}</span>`;
    case 'date_received': return `<span>${task.date_received || '—'}</span>`;
    case 'status': return `<span>${renderStatus(task.status_name || task.status)}</span>`;
    case 'priority': return `<span>${renderPriority(task.priority_name || task.priority)}</span>`;
    case 'team': return `<span class="badge badge-info">${task.team_name || '—'}</span>`;
    case 'channel': return `<span>${task.channel_name || '—'}</span>`;
    case 'business_customer': return `<span>${task.business_customer_name || task.business_customer || '—'}</span>`;
    case 'department': return `<span>${task.department_name || '—'}</span>`;
    case 'project': return `<span>${task.project_name || '—'}</span>`;
    case 'task_type': return `<span>${task.task_type_name || '—'}</span>`;
    case 'involved_teams': return `<span>${task.involved_teams || '—'}</span>`;
    case 'deadline': return `<span>${task.deadline_name || task.deadline || '—'}</span>`;
    case 'deadline_po': return `<span>${task.deadline_po_name || '—'}</span>`;
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
    case 'owner': return `<span>${task.owner_name || task.owner || '—'}</span>`;
    case 'key_project_status': return `<span>${task.key_project_status || '—'}</span>`;
    case 'directorate_status': return `<span>${task.directorate_status || '—'}</span>`;
    case 'did_status': return `<span>${task.did_status || '—'}</span>`;
    case 'link_mockups': return `<span>${task.link_mockups ? `<a href="${task.link_mockups}" target="_blank" style="color:var(--accent)">Макеты</a>` : '—'}</span>`;
    case 'link_jira': return `<span>${task.link_jira ? `<a href="${task.link_jira}" target="_blank" style="color:var(--accent)">Jira</a>` : '—'}</span>`;
    case 'rejection_reason': return `<span>${task.rejection_reason || '—'}</span>`;
    case 'comment': return `<span>${task.comment || '—'}</span>`;
    case 'created_at': return `<span>${task.created_at || '—'}</span>`;
    case 'updated_at': return `<span>${task.updated_at || '—'}</span>`;
    case 'metric_kr_plan':
    case 'metric_kr_fact': return `<span class="font-mono">${metricFormat(task[col])}${task.metric_kr_unit ? ' ' + task.metric_kr_unit : ''}</span>`;
    case 'metric_kr_unit': return `<span>${task.metric_kr_unit || '—'}</span>`;
    case 'tags': return renderTags(task.tags);
    default: return '';
  }
}

function renderTableRow(task, cols) {
  const changes = getQuickEditChanges('backlog');
  const cells = cols.map(col => {
    const field = getQuickEditField(col);
    const change = changes[task.id]?.[field];
    const isChanged = !!change;
    const cellStyle = isChanged ? 'background: rgba(245, 158, 11, 0.2);' : '';
    return `<td style="${cellStyle}">${renderCell(col, task)}</td>`;
  });
  const hasChanges = changes[task.id] && Object.keys(changes[task.id]).length > 0;
  const rowStyle = hasChanges
    ? `cursor:default;border-left:3px solid var(--warning);`
    : (isQuickEdit('backlog') ? 'cursor:default;' : 'cursor:pointer;');
  return `<tr data-task-id="${task.id}" style="${rowStyle}">${cells.join('')}</tr>`;
}

function renderCardView(list) {
  const container = document.getElementById('tasks-container');
  if (!container) return;
    container.innerHTML = `
    <div class="task-card-grid">
      ${list.length === 0
        ? '<div class="text-center text-muted" style="padding:40px;width:100%;">Нет задач</div>'
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
}

function renderCard(task) {
  return renderTaskCard(task);
}

function renderPriority(priority) {
  const map = { 'ВЫСОКИЙ': 'high', 'СРЕДНИЙ': 'medium', 'НИЗКИЙ': 'low' };
  const cls = map[priority] || 'medium';
  return `<span class="badge badge-${cls}">${priority || 'СРЕДНИЙ'}</span>`;
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
  return `<span class="badge ${colors[statusClass] || 'badge-status-backlog'}">${status || 'СБОР ТРЕБОВАНИЙ'}</span>`;
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
    const style = t.color ? `background:${t.color}22;color:${t.color};border:1px solid ${t.color}55;` : '';
    return `<span class="badge" style="font-size:10px;${style}">${t.name}</span>`;
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
