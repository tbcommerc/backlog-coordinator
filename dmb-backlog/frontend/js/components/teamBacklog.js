console.log('[DMB] teamBacklog.js v20260907.1 loaded');
import { renderToolbar, initToolbar, initToolbarControls, getFilteredList as ftFilteredList, getToolbarSearchValue, resetToolbarFilters, updateStickyOffsets, initStickyTableHeader, setToolbarSortValue, isDeadlinePast, canEditTaskForScope } from './filterToolbar.js?v=98';
import { renderTaskCard, openTaskModal, openCreateTaskModal, setOnTaskSaved, importTasksFromExcel, showBulkOpsModal } from './modal.js?v=92';
import { buildColumnLabels, buildColumnSettings, getAllColumnKeys } from './taskColumns.js';
import { renderQuickEditToolbar, initQuickEdit, enterQuickEdit, requestExitQuickEdit, isQuickEdit, getQuickEditChanges, getQuickEditError, getQuickEditField, isEditableField, renderQuickEditCell } from './quickEdit.js?v=83';
import { renderQuickFilters, initQuickFilters, syncQuickFilterButtons } from './quickFilters.js?v=80';
import { autoSizeColumns, applyColumnWidths, applyColumnSort, toggleSortState, headerCellHtml, registerTableInteractions, persistColumnState, readColumnState } from './tableUtils.js?v=51';
import { safeExternalUrl } from '../urlUtils.js';
import { bindViewStateAction, fitTableViewState, renderViewState } from './viewState.js?v=2';
import { formatTaskPublicId } from '../taskPublicId.js';
import { highlightSearchText } from '../htmlUtils.js';
import { getSelectedItems, reconcileSelection, setAllSelection } from './tableSelection.js';
import { calculateTaskCv, cvZone } from '../taskMetrics.js';
import { canUseReportingStatusWorkspace, reportingStatusHref } from './reportingStatuses.js?v=11';

function renderExternalTeamLink(value, label) {
  const url = safeExternalUrl(value);
  return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">${label}</a>` : '—';
}

let COLUMN_LABELS = { ...buildColumnLabels(window.app?.fieldLabels || {}) };

let teamTasksCache = null;
let teamCurrentView = 'table';
const teamSort = { key: null, dir: 'asc' };
let teamCurrentApp = null;
const TEAM_DEFAULT_OVERRIDES = {
    owner: true, team: false, effort_days: false,
    financial_effect: false, cv: false
};
let teamColumnSettings = buildColumnSettings({}, TEAM_DEFAULT_OVERRIDES);
let teamColumnOrder = getAllColumnKeys();

let teamColumnWidths = {};
let teamColumnMinWidths = {};
const teamColumnFixed = {};
let teamPaginationPage = 1;
const TEAM_PAGE_SIZE = 100;
const TEAM_COLUMNS_STORAGE_KEY = 'dmb_team_columns_v1';
let teamAutoRefreshTimer = null;
let teamKeyboardHandler = null;
let teamTasksLoadInProgress = false;
let teamTasksReloadQueued = false;
const teamSelectedTaskIds = new Set();
const TERMINAL_STATUSES = ['ВЫПОЛНЕНА', 'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА'];
let teamOperationsMenuCleanup = null;


export function renderTeamBacklog(app) {
    const user = app.store.get('currentUser');
    if (!user?.team_id) {
      return `
        <div style="margin-bottom:var(--space-6);">
          <h1 style="margin:0 0 var(--space-2);">Бэклог команды</h1>
          <p class="text-secondary" style="margin:0;">Задачи и планирование вашей команды</p>
        </div>
        <div id="team-tasks-container">
          ${renderViewState({
            kind: 'empty',
            title: 'Команда не назначена',
            message: 'Вы не привязаны к команде. Обратитесь к администратору.',
          })}
        </div>`;
    }
    const teamName = user.team_name || `#${user.team_id}`;
    COLUMN_LABELS = { ...buildColumnLabels(window.app?.fieldLabels || {}) };

    return `
    ${renderToolbar('team', {
      title: `Бэклог команды ${teamName}`,
      subtitle: 'Управление задачами вашей команды',
      columnSettings: teamColumnSettings,
      columnOrder: teamColumnOrder,
      columnLabels: COLUMN_LABELS,
      addTask: true,
      onImport: true,
      excel: true,
      onQuickEdit: true,
      onBulkOps: true,
      bulkOpsTitle: 'Операции',
      bulkOpsMenu: true,
      savedViews: true,
      quickFilters: renderQuickFilters(),
    })}

    <div id="team-backlog-content">
      <div id="bulk-actions" class="flex items-center gap-3" style="margin-bottom: var(--space-4); display: none;">
          <span class="text-secondary">Выбрано: <strong id="selected-count">0</strong></span>
          <button class="btn btn-secondary btn-sm" id="team-bulk-selected">Массовые операции (0)</button>
      </div>

      ${renderQuickEditToolbar('team')}

      <div id="team-tasks-container">
          ${renderTeamTableStateMarkup({ kind: 'loading', title: 'Загружаем задачи команды…' })}
      </div>
    </div>

    <div class="flex justify-between items-center" style="margin-top: var(--space-6);">
        <span class="text-secondary" id="team-tasks-count" role="status" aria-live="polite">Загрузка…</span>
        <div class="flex gap-2" id="team-pagination"></div>
    </div>
    `;
}

function renderTeamSkeletonRows(count) {
  return Array.from({ length: count }, () => `
    <tr class="skeleton-row">
      <td><div class="skeleton skeleton-block w-30"></div></td>
      <td><div class="skeleton skeleton-block w-80"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-60"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-40"></div></td>
      <td><div class="skeleton skeleton-block w-60"></div></td>
      <td><div class="skeleton skeleton-block w-30"></div></td>
    </tr>
  `).join('');
}

async function applyTeamDefaultDisplaySettings(app) {
  const saved = {};
  try {
    const resp = await app.api.get('/admin/display-settings/shared');
    if (resp && resp.settings) {
      const KEY_MAP = { financial: 'financial_effect', effort: 'effort_days' };
      Object.keys(resp.settings).forEach(key => {
        const mapped = KEY_MAP[key] || key;
        saved[mapped] = resp.settings[key];
      });
    }
  } catch (e) {
    console.log('[DMB] No team display settings, using defaults');
  }
  teamColumnSettings = buildColumnSettings(saved, TEAM_DEFAULT_OVERRIDES);
  teamColumnOrder = getAllColumnKeys();
}

export async function initTeamBacklog(app) {
    teamSelectedTaskIds.clear();
    teamCurrentApp = app;
    const user = app.store.get('currentUser');
    if (!user?.team_id) {
      teamTasksCache = { items: [], total: 0, page: 1, per_page: TEAM_PAGE_SIZE, pages: 0 };
      if (teamAutoRefreshTimer) {
        clearInterval(teamAutoRefreshTimer);
        teamAutoRefreshTimer = null;
      }
      if (teamKeyboardHandler) {
        window.removeEventListener('keydown', teamKeyboardHandler);
        teamKeyboardHandler = null;
      }
      return;
    }
    await applyTeamDefaultDisplaySettings(app);
    loadTeamColumnState();
    renderTeamTableState({ kind: 'loading', title: 'Загружаем задачи команды…' });
    await loadTeamTasks(app);

  function onFilterChange() {
    teamPaginationPage = 1;
    syncQuickFilterButtons('team');
    renderTeamCurrentView();
  }

  const tasks = teamTasksCache?.items || [];

  initToolbarControls('team', {
    columnSettings: teamColumnSettings,
    columnOrder: teamColumnOrder,
    columnLabels: COLUMN_LABELS,
    defaultColumnSettings: buildColumnSettings({}, TEAM_DEFAULT_OVERRIDES),
    onViewChange: (view) => { teamCurrentView = view; renderTeamCurrentView(); },
    onColumnChange: () => { saveTeamColumnState(); renderTeamCurrentView(); },
    onColumnOrderChange: () => { saveTeamColumnState(); renderTeamCurrentView(); },
    onExport: () => { const list = getTeamFilteredList(); teamExportExcel(list); },
    onImport: () => { importTasksFromExcel(app, loadTeamTasks); },
    onAddTask: () => openCreateTaskModal(app),
    onRefresh: () => loadTeamTasks(app),
    onQuickEdit: () => { if (teamCurrentView === 'table') { if (isQuickEdit('team')) { requestExitQuickEdit('team'); } else { enterQuickEdit('team'); } } },
    onBulkOps: () => { if (teamCurrentView === 'table') openTeamOperationsMenu(app); },
    showSavedViewRevert: false,
    getSavedViewState: () => ({
      view: teamCurrentView,
      columns: { ...teamColumnSettings },
      columnOrder: [...teamColumnOrder],
      widths: { ...teamColumnWidths },
      fixed: { ...teamColumnFixed },
      columnSort: { ...teamSort },
    }),
    applySavedViewState: applyTeamSavedViewState,
  });

    initToolbar('team', tasks, onFilterChange);

    initQuickEdit('team', {
      app,
      getTasks: () => teamTasksCache?.items || [],
      getColumnLabel: getTeamColumnLabel,
      renderView: renderTeamCurrentView,
      afterSave: () => loadTeamTasks(app),
      tableContainer: '#team-tasks-container .table-container',
    });

    initQuickFilters('team', () => teamTasksCache?.items || []);
    setOnTaskSaved(() => loadTeamTasks(app));

    if (teamAutoRefreshTimer) clearInterval(teamAutoRefreshTimer);
    teamAutoRefreshTimer = setInterval(() => {
        if (!isTeamBacklogRouteActive()) {
            clearInterval(teamAutoRefreshTimer);
            teamAutoRefreshTimer = null;
            return;
        }
        if (!isTeamBacklogInteractionActive()) loadTeamTasks(app);
    }, 60000);

    if (teamKeyboardHandler) window.removeEventListener('keydown', teamKeyboardHandler);
    teamKeyboardHandler = (e) => {
        if (e.defaultPrevented) return;
        const tag = document.activeElement?.tagName;
        const editing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
        if (e.key === '/' && !editing) {
            e.preventDefault();
            document.getElementById('f-team-search')?.focus();
        } else if (e.key.toLowerCase() === 'r' && !editing && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            loadTeamTasks(app);
        }
    };
    window.addEventListener('keydown', teamKeyboardHandler);

    registerTableInteractions('team-tasks-table', {
      getWidths: () => teamColumnWidths,
      getMinWidths: () => teamColumnMinWidths,
      getLayout: () => {
        const cols = teamColumnOrder.filter(k => teamColumnSettings[k]);
        return { cols, offset: (!isQuickEdit('team') && colHasCheckbox(cols)) ? 1 : 0 };
      },
      getFixed: () => teamColumnFixed,
      onResizeEnd: saveTeamColumnState,
      onUnfix: () => { saveTeamColumnState(); renderTeamCurrentView(); },
      onSort: (key) => {
        toggleSortState(teamSort, key);
        teamPaginationPage = 1;
        setToolbarSortValue('team', 'id-desc');
        saveTeamColumnState();
        renderTeamCurrentView();
      },
    });
}

function isTeamBacklogRouteActive() {
    return (window.location.hash.slice(1).split('?')[0] || '/') === '/team-backlog';
}

function isTeamBacklogInteractionActive() {
    return isQuickEdit('team')
        || teamSelectedTaskIds.size > 0
        || document.getElementById('task-detail-overlay') !== null
        || document.getElementById('create-task-overlay') !== null
        || document.getElementById('bulk-modal-overlay') !== null;
}

function applyTeamSavedViewState(state = {}) {
    if (state.view === 'table' || state.view === 'cards') teamCurrentView = state.view;
    if (state.columns) {
        Object.keys(teamColumnSettings).forEach(key => { teamColumnSettings[key] = !!state.columns[key]; });
    }
    if (Array.isArray(state.columnOrder)) {
        const valid = new Set(getAllColumnKeys());
        const savedOrder = state.columnOrder.filter(key => valid.has(key));
        teamColumnOrder.splice(0, teamColumnOrder.length, ...savedOrder, ...getAllColumnKeys().filter(key => !savedOrder.includes(key)));
    }
    teamColumnWidths = state.widths ? { ...state.widths } : {};
    Object.keys(teamColumnFixed).forEach(key => delete teamColumnFixed[key]);
    Object.assign(teamColumnFixed, state.fixed || {});
    teamSort.key = state.columnSort?.key || null;
    teamSort.dir = state.columnSort?.dir || 'asc';
    document.querySelectorAll('#team-view-toggle-group [data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === teamCurrentView));
    saveTeamColumnState();
    renderTeamCurrentView();
}

async function loadTeamTasks(app) {
    if (teamTasksLoadInProgress) {
        teamTasksReloadQueued = true;
        return;
    }
    teamTasksLoadInProgress = true;
    const existingContainer = document.getElementById('team-tasks-container');
    if (!teamTasksCache || existingContainer?.querySelector('.view-state-error')) {
        renderTeamTableState({ kind: 'loading', title: 'Загружаем задачи команды…' });
        const countEl = document.getElementById('team-tasks-count');
        if (countEl) countEl.textContent = 'Загрузка…';
    }
    try {
        const user = app.store.get('currentUser');
        const teamId = user?.team_id || null;

        const data = await loadAllTeamTaskPages(app, teamId);
        teamTasksCache = data;
        renderTeamCurrentView();
        const countEl = document.getElementById('team-tasks-count');
        if (countEl) countEl.textContent = `Найдено: ${data.items.length} задач`;
    
    } catch (e) {
        const container = document.getElementById('team-tasks-container');
        if (container) {
            renderTeamTableState({
                kind: 'error',
                message: window.formatErrorMessage?.(e) || 'Повторите попытку позже.',
                actionLabel: 'Повторить',
            });
            bindViewStateAction(container, () => loadTeamTasks(app));
        }
        const countEl = document.getElementById('team-tasks-count');
        if (countEl) countEl.textContent = 'Не удалось загрузить задачи';
        const pagination = document.getElementById('team-pagination');
        if (pagination) pagination.innerHTML = '';
    } finally {
        teamTasksLoadInProgress = false;
        if (teamTasksReloadQueued) {
            teamTasksReloadQueued = false;
            if (isTeamBacklogRouteActive()) await loadTeamTasks(app);
        }
    }
}

async function loadAllTeamTaskPages(app, teamId) {
    const perPage = 1000;
    const teamQuery = teamId ? `&team_id=${encodeURIComponent(teamId)}` : '';
    const first = await app.api.get(`/tasks/?page=1&per_page=${perPage}${teamQuery}`);
    const pages = Math.max(1, Number(first.pages) || 1);
    if (pages === 1) return first;

    const requests = [];
    for (let page = 2; page <= pages; page++) {
        requests.push(app.api.get(`/tasks/?page=${page}&per_page=${perPage}${teamQuery}`));
    }
    const rest = await Promise.all(requests);
    const items = [first, ...rest].flatMap(part => part.items || []);
    return { ...first, items, total: Number(first.total) || items.length, page: 1, per_page: items.length, pages: 1 };
}

function getTeamFilteredList() {
  let list = ftFilteredList('team', teamTasksCache?.items || []);
  if (teamSort.key) list = applyColumnSort(list, teamSort.key, teamSort.dir);
  return list;
}

function renderTeamCurrentView() {
    const list = getTeamFilteredList();
    reconcileSelection(teamSelectedTaskIds, list, task => canEditTaskForScope('team', task));
    const countEl = document.getElementById('team-tasks-count');
    if (countEl) countEl.textContent = `Найдено: ${list.length} задач`;
    const totalPages = Math.max(1, Math.ceil(list.length / TEAM_PAGE_SIZE));
    if (teamPaginationPage > totalPages) teamPaginationPage = totalPages;
    const pageList = list.slice((teamPaginationPage - 1) * TEAM_PAGE_SIZE, teamPaginationPage * TEAM_PAGE_SIZE);
    if (teamCurrentView === 'cards') {
        renderTeamCards(pageList);
    } else {
        renderTeamTableView(pageList);
    }
    renderTeamPagination(totalPages);
}

function renderTeamPagination(totalPages) {
    const container = document.getElementById('team-pagination');
    if (!container) return;
    if (totalPages <= 1) { container.innerHTML = ''; return; }
    const pages = [];
    for (let p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || Math.abs(p - teamPaginationPage) <= 1) pages.push(p);
    }
    let html = '';
    let prev = 0;
    pages.forEach(p => {
        if (p - prev > 1) html += '<button class="btn btn-sm btn-ghost" disabled style="opacity:.4;min-width:34px;">…</button>';
        html += `<button class="btn btn-sm ${p === teamPaginationPage ? 'btn-primary' : 'btn-secondary'}" data-page="${p}" style="min-width:34px;">${p}</button>`;
        prev = p;
    });
    container.innerHTML = html;
    container.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            teamPaginationPage = parseInt(btn.dataset.page);
            renderTeamCurrentView();
        });
    });
}

function renderTeamTableView(list) {
    const container = document.getElementById('team-tasks-container');
    if (!container) return;

    const visibleCols = teamColumnOrder.filter(k => teamColumnSettings[k]);
    const showCheckbox = !isQuickEdit('team') && colHasCheckbox(visibleCols) && list.some(task => canEditTaskForScope('team', task));
    const hasWidths = visibleCols.every(c => teamColumnWidths[c]);

    const headerHtml = visibleCols.map(col =>
        headerCellHtml(getTeamColumnLabel(col), col, teamSort.key, teamSort.dir)
    ).join('');

    const colgroupHtml = visibleCols.map((col, i) => {
        const w = teamColumnWidths[col] ? `width:${teamColumnWidths[col]}px;` : '';
        return `<col style="${w}">`;
    }).join('');

    const checkboxCol = showCheckbox ? '<col style="width:40px;">' : '';
    const tableStyle = hasWidths ? 'table-layout:fixed;' : '';

    container.innerHTML = `
        <div class="table-container" style="overflow-x:auto;">
            <table class="table" id="team-tasks-table" style="${tableStyle}">
                <colgroup>${checkboxCol}${colgroupHtml}</colgroup>
                <thead>
                    <tr>
                        ${showCheckbox ? '<th class="table-selection-cell"><input type="checkbox" id="select-all" aria-label="Выбрать все отфильтрованные задачи"></th>' : ''}
                        ${headerHtml}
                    </tr>
                </thead>
                <tbody id="team-tasks-tbody">
                    ${list.length === 0
                        ? '<tr><td class="table-view-state-cell" colspan="' + (visibleCols.length + (showCheckbox ? 1 : 0)) + '">' + renderViewState({ kind: 'empty', title: 'Задачи команды не найдены', message: 'Измените фильтры или создайте новую задачу.' }) + '</td></tr>'
                        : list.map(task => renderTeamTableRow(task, visibleCols, showCheckbox)).join('')}
                </tbody>
            </table>
        </div>
    `;

    if (!isQuickEdit('team')) {
        const table = document.getElementById('team-tasks-table');
        const offset = showCheckbox ? 1 : 0;
        if (!hasWidths) {
            autoSizeColumns(table, visibleCols, teamColumnWidths, teamColumnMinWidths, { offset });
        }
        applyColumnWidths(table, visibleCols, teamColumnWidths, { offset, fixed: teamColumnFixed });
        saveTeamColumnState();
    }

    fitTableViewState(container);
    updateStickyOffsets();
    initStickyTableHeader('team-tasks-table');

    if (list.length > 0) {
        if (showCheckbox) bindSelectAll();
        if (!isQuickEdit('team')) {
            document.querySelectorAll('#team-tasks-tbody tr').forEach(tr => {
                tr.addEventListener('click', (e) => {
                    if (e.target.closest('.task-checkbox, input')) return;
                    const t = list.find(x => x.id == tr.dataset.taskId);
                    if (t) openTaskModal(t);
                });
            });
        }
    }
}

function colHasCheckbox(cols) {
    return cols.length > 0;
}

function getTeamColumnLabel(key) {
    return COLUMN_LABELS[key] || key;
}

function saveTeamColumnState() {
    persistColumnState(TEAM_COLUMNS_STORAGE_KEY, {
        settings: teamColumnSettings,
        order: teamColumnOrder,
        widths: teamColumnWidths,
        fixed: teamColumnFixed,
        sort: teamSort,
    });
}

function loadTeamColumnState() {
    const st = readColumnState(TEAM_COLUMNS_STORAGE_KEY);
    if (!st) return;
    const validKeys = new Set(getAllColumnKeys());
    if (st.settings) {
        const newSettings = {};
        Object.keys(st.settings).forEach(k => { if (validKeys.has(k)) newSettings[k] = st.settings[k]; });
        teamColumnSettings = buildColumnSettings(newSettings, TEAM_DEFAULT_OVERRIDES);
    }
    if (Array.isArray(st.order)) teamColumnOrder = st.order.filter(k => validKeys.has(k));
    if (st.widths) {
        teamColumnWidths = {};
        Object.keys(st.widths).forEach(k => { teamColumnWidths[k] = st.widths[k]; });
    }
    if (st.fixed) {
        Object.keys(teamColumnFixed).forEach(k => delete teamColumnFixed[k]);
        Object.keys(st.fixed).forEach(k => { if (st.fixed[k]) teamColumnFixed[k] = st.fixed[k]; });
    }
    if (st.sort && st.sort.key) {
        teamSort.key = st.sort.key;
        teamSort.dir = st.sort.dir || 'asc';
    }
}

function renderTeamCell(col, task) {
  const field = getQuickEditField(col);
  if (isQuickEdit('team') && canEditTaskForScope('team', task) && isEditableField(col)) {
    return renderQuickEditCell('team', col, task);
  }

    const highlight = value => highlightSearchText(value, getToolbarSearchValue('team'));
    switch (col) {
        case 'id': return `<span class="font-mono text-muted">${highlight(formatTaskPublicId(task))}</span>`;
        case 'title': return `<strong class="cell-truncate">${highlight(task.title)}</strong>`;
        case 'description': return `<span class="cell-truncate">${highlight(task.description || '—')}</span>`;
        case 'date_received': return `<span>${escapeHtml(task.date_received || '—')}</span>`;
        case 'status': return `<span>${renderStatus(task.status_name || task.status)}</span>`;
        case 'priority': return `<span>${renderPriority(task.priority_name || task.priority)}</span>`;
        case 'team': return `<span class="badge badge-info">${escapeHtml(task.team_name || '—')}</span>`;
        case 'channel': return `<span>${escapeHtml(task.channel_name || '—')}</span>`;
        case 'did_client_group': return `<span>${escapeHtml(task.did_client_group_name || '—')}</span>`;
    case 'business_customer': return `<span>${escapeHtml(task.business_customer_name || task.business_customer || '—')}</span>`;
        case 'department': return `<span>${escapeHtml(task.department_name || '—')}</span>`;
        case 'project': return `<span>${escapeHtml(task.project_name || '—')}</span>`;
        case 'task_type': return `<span>${escapeHtml(task.task_type_name || '—')}</span>`;
        case 'involved_teams': return `<span class="cell-truncate">${escapeHtml(renderInvolvedTeams(task.involved_team_names || task.involved_teams))}</span>`;
        case 'deadline': return `<span>${renderTeamDeadline(task)}</span>`;
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
        case 'actual_effort_fe':
        case 'actual_effort_test':
        case 'actual_effort_test_auto':
        case 'actual_effort_python_be':
        case 'actual_effort_delivery':
            return `<span class="font-mono">${task[col] != null && task[col] !== '' ? metricFormat(task[col]) : '—'}</span>`;
        case 'metric_kr_plan':
        case 'metric_kr_fact':
            return `<span class="font-mono">${task[col] != null ? metricFormat(task[col]) + (task.metric_kr_unit ? ' ' + escapeHtml(task.metric_kr_unit) : '') : '—'}</span>`;
        case 'metric_kr_unit': return `<span>${escapeHtml(task.metric_kr_unit || '—')}</span>`;
        case 'financial_effect': return `<span class="font-mono">${metricFormat(task.financial_effect)}</span>`;
        case 'financial_effect_justification': return `<span class="cell-truncate">${escapeHtml(task.financial_effect_justification || '—')}</span>`;
        case 'cv': return `<span>${renderCV(task)}</span>`;
        case 'progress': return `<span>${renderProgress(task.progress)}</span>`;
        case 'owner': return `<span>${escapeHtml(task.owner_name || task.owner || '—')}</span>`;
        case 'created_by': return `<span>${escapeHtml(task.created_by_name || '—')}</span>`;
        case 'key_project_status': return `<span class="cell-truncate">${escapeHtml(task.key_project_status || '—')}</span>`;
        case 'key_project_status_updated_at': return `<span>${fmtDate(task.key_project_status_updated_at)}</span>`;
        case 'directorate_status': return `<span class="cell-truncate">${escapeHtml(task.directorate_status || '—')}</span>`;
        case 'directorate_status_updated_at': return `<span>${fmtDate(task.directorate_status_updated_at)}</span>`;
        case 'did_status': return `<span class="cell-truncate">${escapeHtml(task.did_status || '—')}</span>`;
        case 'did_status_updated_at': return `<span>${fmtDate(task.did_status_updated_at)}</span>`;
        case 'did_demo': return `<span>${task.did_demo ? '<span class="badge badge-high">Да</span>' : '<span class="badge badge-low">Нет</span>'}</span>`;
        case 'link_mockups': return `<span>${renderExternalTeamLink(task.link_mockups, 'Макеты')}</span>`;
        case 'link_jira': return `<span>${renderLinkJiraList(task.link_jira)}</span>`;
        case 'rejection_reason': return `<span class="cell-truncate">${escapeHtml(task.rejection_reason || '—')}</span>`;
        case 'comment': return `<span class="cell-truncate">${escapeHtml(task.comment || '—')}</span>`;
        case 'created_at': return `<span>${escapeHtml(task.created_at || '—')}</span>`;
        case 'updated_at': return `<span>${escapeHtml(task.updated_at || '—')}</span>`;
        case 'tags': return renderTeamTags(task.tags);
        default: return '';
    }
}

function renderTeamTableRow(task, cols, showCheckbox) {
    const saveError = getQuickEditError('team', task.id);
    const cells = cols.map(col => {
        const field = getQuickEditField(col);
        const change = getQuickEditChanges('team')[task.id]?.[field];
        const isChanged = !!change;
        const cellStyle = isChanged ? 'background: rgba(245, 158, 11, 0.2);' : '';
        return `<td style="${cellStyle}">${renderTeamCell(col, task)}</td>`;
    });
    const hasChanges = getQuickEditChanges('team')[task.id] && Object.keys(getQuickEditChanges('team')[task.id]).length > 0;
    const rowStyle = saveError
        ? `cursor:default;border-left:3px solid var(--danger);background:rgba(239,68,68,.06);`
        : hasChanges
        ? `cursor:default;border-left:3px solid var(--warning);`
        : (isQuickEdit('team') ? 'cursor:default;' : 'cursor:pointer;');
    const checkboxHtml = showCheckbox ? `<td class="table-selection-cell">${canEditTaskForScope('team', task) ? `<input type="checkbox" class="task-checkbox" value="${task.id}" aria-label="Выбрать задачу ${task.id}" ${teamSelectedTaskIds.has(Number(task.id)) ? 'checked' : ''}>` : '<span title="Нет прав на изменение этой задачи" style="color:var(--text-muted);">—</span>'}</td>` : '';
    const errorCells = saveError && cells.length > 0
        ? cells.map((cell, index) => index === 0
            ? cell.replace('>', ` title="${escapeHtml(saveError)}">⚠ `).replace('</td>', `<div style="margin-top:4px;color:var(--danger);font-size:11px;white-space:normal;">${escapeHtml(saveError)}</div></td>`)
            : cell)
        : cells;
    return `<tr data-task-id="${task.id}" style="${rowStyle}" ${saveError ? `aria-label="Ошибка сохранения: ${escapeHtml(saveError)}"` : ''}>
        ${checkboxHtml}
        ${errorCells.join('')}
    </tr>`;
}

function renderTeamCards(list) {
    const container = document.getElementById('team-tasks-container');
    if (!container) return;
    container.innerHTML = `
        <div class="task-card-grid">
            ${list.length === 0
                ? renderViewState({ kind: 'empty', title: 'Задачи команды не найдены', message: 'Измените фильтры или создайте новую задачу.' })
                : list.map(task => renderTaskCard(task, getToolbarSearchValue('team'))).join('')}
        </div>
    `;
    container.querySelectorAll('.task-card').forEach(card => {
        card.addEventListener('click', () => {
            const t = list.find(x => x.id == card.dataset.id);
            if (t) openTaskModal(t);
        });
    });
    updateBulkBar();
}

async function populateTeamSelect(selectedTeamId) {
    const select = document.getElementById('task-team');
    if (!select) return;
    try {
        const teams = await window.app?.api?.get('/teams/') || [];
        select.innerHTML = teams.map(t =>
            `<option value="${t.id}" ${t.id === selectedTeamId ? 'selected' : ''}>${escapeHtml(t.name)}</option>`
        ).join('');
    } catch {
        select.innerHTML = '<option value="">Нет команд</option>';
    }
}

function setupTaskFormSave(modal, task, app) {
    document.getElementById('modal-confirm')?.addEventListener('click', async () => {
        const data = {
            version: task?.version ?? 0,
            team_id: parseInt(document.getElementById('task-team').value),
            title: document.getElementById('task-title').value,
            description: document.getElementById('task-description')?.value || '',
            priority: document.querySelector('input[name="priority"]:checked')?.value || 'СРЕДНИЙ',
            status: document.getElementById('task-status')?.value || 'СБОР ТРЕБОВАНИЙ',
            deadline: document.getElementById('task-deadline')?.value || null,
            effort_days: parseInt(document.getElementById('task-effort-days')?.value) || null,
            effort_rub: parseFloat(document.getElementById('task-effort-rub')?.value) || null,
            financial_effect: parseFloat(document.getElementById('task-financial-effect')?.value) || null,
            source_channel: document.getElementById('task-source-channel')?.value || null,
            business_customer: document.getElementById('task-business-customer')?.value || null,
            customer_department: document.getElementById('task-customer-department')?.value || null,
            key_project_status: document.getElementById('task-key-project-status')?.value || null,
            progress: parseInt(document.getElementById('task-progress')?.value) || 0,
            owner: document.getElementById('task-owner')?.value || '',
            tags: (document.getElementById('task-tags')?.value || '').split(',').map(x => x.trim()).filter(Boolean),
            metric_kr_plan: parseFloat(document.getElementById('task-metric-kr-plan')?.value) || null,
            metric_kr_fact: parseFloat(document.getElementById('task-metric-kr-fact')?.value) || null,
            metric_kr_unit: document.getElementById('task-metric-kr-unit')?.value || null,
        };
        try {
            if (task) {
                await app.api.put(`/tasks/${task.id}`, data);
            } else {
                await app.api.post('/tasks/', data);
            }
            document.querySelector('.modal-close')?.click();
            await loadTeamTasks(app);
        } catch (e) {
            window.toast?.(window.formatErrorMessage?.(e) || 'Не удалось сохранить задачу', 'error');
        }
    });
}

function bindSelectAll() {
    document.getElementById('select-all')?.addEventListener('change', function () {
        setAllSelection(teamSelectedTaskIds, getTeamFilteredList(), this.checked, task => canEditTaskForScope('team', task));
        document.querySelectorAll('.task-checkbox').forEach(cb => { cb.checked = teamSelectedTaskIds.has(Number(cb.value)); });
        updateBulkBar();
    });
    document.querySelectorAll('.task-checkbox').forEach(cb => {
        cb.addEventListener('change', function () {
            const id = Number(this.value);
            if (this.checked) teamSelectedTaskIds.add(id);
            else teamSelectedTaskIds.delete(id);
            updateBulkBar();
        });
    });
    document.getElementById('team-bulk-selected')?.addEventListener('click', () => openTeamBulkOps(teamCurrentApp));
    updateBulkBar();
}

function updateBulkBar() {
    const editable = getTeamFilteredList().filter(task => canEditTaskForScope('team', task));
    reconcileSelection(teamSelectedTaskIds, editable);
    const checked = teamSelectedTaskIds.size;
    const bar = document.getElementById('bulk-actions');
    if (bar) {
        bar.style.display = checked > 0 ? 'flex' : 'none';
        document.getElementById('selected-count').textContent = checked;
    }
    const action = document.getElementById('team-bulk-selected');
    if (action) action.textContent = `Массовые операции (${checked})`;
    const toolbarAction = document.getElementById('team-bulk-open');
    if (toolbarAction) {
        toolbarAction.title = checked > 0 ? `Операции (${checked} задач выбрано)` : 'Операции';
        toolbarAction.setAttribute('aria-label', toolbarAction.title);
    }
    const selectAll = document.getElementById('select-all');
    if (selectAll) {
        selectAll.checked = editable.length > 0 && checked === editable.length;
        selectAll.indeterminate = checked > 0 && checked < editable.length;
    }
}

function renderTeamTableStateMarkup(state) {
    const visibleCols = teamColumnOrder.filter(key => teamColumnSettings[key]);
    const colspan = Math.max(1, visibleCols.length);
    return `
        <div class="table-container" style="overflow-x:auto;">
            <table class="table" id="team-tasks-table" aria-busy="${state.kind === 'loading'}">
                <thead>
                    <tr>${visibleCols.map(col => headerCellHtml(getTeamColumnLabel(col), col, teamSort.key, teamSort.dir)).join('')}</tr>
                </thead>
                <tbody id="team-tasks-tbody" aria-live="polite">
                    <tr><td class="table-view-state-cell" colspan="${colspan}">${renderViewState(state)}</td></tr>
                </tbody>
            </table>
        </div>`;
}

function renderTeamTableState(state) {
    const container = document.getElementById('team-tasks-container');
    if (!container) return;
    container.innerHTML = renderTeamTableStateMarkup(state);
    fitTableViewState(container);
    updateStickyOffsets();
    initStickyTableHeader('team-tasks-table');
    window.lucide?.createIcons();
}

function getTeamSelectedTasks() {
    return getSelectedItems(teamSelectedTaskIds, getTeamFilteredList());
}

async function openTeamBulkOps(app) {
    const selected = getTeamSelectedTasks();
    const editable = getTeamFilteredList().filter(task => canEditTaskForScope('team', task));
    const result = await showBulkOpsModal(app, 'team', selected.length > 0 ? selected : editable);
    if (result?.success) {
        teamSelectedTaskIds.clear();
        await loadTeamTasks(app);
    }
}

function closeTeamOperationsMenu({ restoreFocus = false } = {}) {
    if (teamOperationsMenuCleanup) {
        const cleanup = teamOperationsMenuCleanup;
        teamOperationsMenuCleanup = null;
        cleanup(restoreFocus);
        return;
    }
    document.getElementById('team-operations-menu')?.remove();
    document.getElementById('team-bulk-open')?.setAttribute('aria-expanded', 'false');
}

function openTeamOperationsMenu(app) {
    const trigger = document.getElementById('team-bulk-open');
    if (!trigger) return;
    if (document.getElementById('team-operations-menu')) {
        closeTeamOperationsMenu({ restoreFocus: true });
        return;
    }

    const selectedCount = getTeamSelectedTasks().length;
    const bulkHint = selectedCount > 0
        ? `Изменить выбранные задачи: ${selectedCount}`
        : 'Выбрать задачи и поля для изменения';
    const canOpenReporting = canUseReportingStatusWorkspace(app);
    const isAdmin = app.store.get('currentUser')?.permissions?.admin === 'full';
    const menu = document.createElement('div');
    menu.id = 'team-operations-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Операции с задачами');
    menu.style.cssText = [
        'position:fixed',
        'z-index:1200',
        'width:min(340px,calc(100vw - 24px))',
        'padding:8px',
        'border:1px solid var(--border-color)',
        'border-radius:12px',
        'background:var(--bg-primary)',
        'box-shadow:0 16px 40px rgba(15,23,42,.18)',
        'display:grid',
        'gap:6px',
    ].join(';');
    menu.innerHTML = `
      <button type="button" role="menuitem" data-team-operation="bulk" style="display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:center;width:100%;padding:10px;border:0;border-radius:9px;background:transparent;color:var(--text-primary);text-align:left;cursor:pointer;font:inherit;">
        <span aria-hidden="true" style="width:34px;height:34px;border-radius:9px;background:var(--accent-light);color:var(--accent);display:grid;place-items:center;"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="m16 3 5 5"/><path d="M14 10 21 3"/><path d="M8 12h3"/><path d="M8 16h8"/></svg></span>
        <span style="min-width:0;"><strong style="display:block;font-size:13px;line-height:1.35;">Конструктор массовых изменений</strong><small style="display:block;margin-top:2px;color:var(--text-secondary);font-size:11px;line-height:1.35;">${bulkHint}</small></span>
      </button>
      ${canOpenReporting ? `
      <button type="button" role="menuitem" data-team-operation="reporting" style="display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:center;width:100%;padding:10px;border:0;border-radius:9px;background:transparent;color:var(--text-primary);text-align:left;cursor:pointer;font:inherit;">
        <span aria-hidden="true" style="width:34px;height:34px;border-radius:9px;background:var(--success-light);color:var(--success);display:grid;place-items:center;"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/></svg></span>
        <span style="min-width:0;"><strong style="display:block;font-size:13px;line-height:1.35;">Статусы к отчётным встречам</strong><small style="display:block;margin-top:2px;color:var(--text-secondary);font-size:11px;line-height:1.35;">${isAdmin ? 'Заполнить статусы всех команд' : 'Заполнить статусы задач своей команды'}</small></span>
      </button>` : ''}`;
    document.body.appendChild(menu);
    trigger.setAttribute('aria-expanded', 'true');

    const positionMenu = () => {
        const rect = trigger.getBoundingClientRect();
        const menuWidth = menu.offsetWidth;
        const menuHeight = menu.offsetHeight;
        const left = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, rect.right - menuWidth));
        const below = rect.bottom + 8;
        const top = below + menuHeight <= window.innerHeight - 12
            ? below
            : Math.max(12, rect.top - menuHeight - 8);
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
    };
    const setHover = (button, active) => {
        button.style.background = active ? 'var(--bg-secondary)' : 'transparent';
    };
    menu.querySelectorAll('[role="menuitem"]').forEach(button => {
        button.addEventListener('mouseenter', () => setHover(button, true));
        button.addEventListener('mouseleave', () => setHover(button, false));
        button.addEventListener('focus', () => setHover(button, true));
        button.addEventListener('blur', () => setHover(button, false));
    });

    const onDocumentClick = (event) => {
        if (!menu.contains(event.target) && event.target !== trigger) closeTeamOperationsMenu();
    };
    const onKeydown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeTeamOperationsMenu({ restoreFocus: true });
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const items = [...menu.querySelectorAll('[role="menuitem"]')];
            const current = items.indexOf(document.activeElement);
            if (current >= 0) {
                event.preventDefault();
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                items[(current + direction + items.length) % items.length]?.focus();
            }
        }
    };
    const onViewportChange = () => closeTeamOperationsMenu();
    teamOperationsMenuCleanup = (restoreFocus) => {
        document.removeEventListener('click', onDocumentClick, true);
        document.removeEventListener('keydown', onKeydown);
        window.removeEventListener('resize', onViewportChange);
        window.removeEventListener('scroll', onViewportChange, true);
        window.removeEventListener('hashchange', onViewportChange);
        menu.remove();
        trigger.setAttribute('aria-expanded', 'false');
        if (restoreFocus && trigger.isConnected) trigger.focus();
    };

    menu.querySelector('[data-team-operation="bulk"]')?.addEventListener('click', () => {
        closeTeamOperationsMenu();
        openTeamBulkOps(app);
    });
    menu.querySelector('[data-team-operation="reporting"]')?.addEventListener('click', () => {
        closeTeamOperationsMenu();
        window.location.hash = reportingStatusHref({ source: 'team-backlog' });
    });
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('hashchange', onViewportChange);
    positionMenu();
    menu.querySelector('[role="menuitem"]')?.focus();
}

function metricFormat(val) {
  if (val === null || val === undefined) return '—';
  return new Intl.NumberFormat('ru-RU').format(val);
}

function renderTeamTags(tags) {
  if (!tags || (Array.isArray(tags) && tags.length === 0)) return '—';
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

function fmtDate(val) {
  if (!val) return '—';
  return String(val).slice(0, 10);
}

function excelValue(val) {
  if (Array.isArray(val)) return val.join(', ');
  if (val === null || val === undefined) return '';
  return val;
}

function renderCV(task) {
  const cv = calculateTaskCv(task);
  const zone = cvZone(cv);
  if (zone === 'missing') return '<span class="badge badge-danger">Нет данных</span>';
  const cls = zone === 'good' ? 'badge-status-done' : zone === 'warning' ? 'badge-warning' : 'badge-danger';
  return `<span class="badge ${cls}">${cv.toFixed(2)}</span>`;
}

function renderTeamDeadline(task) {
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
    return `
        <div style="display:flex;align-items:center;gap:8px;min-width:100px;">
            <div class="progress-bar" style="flex:1;">
                <div class="progress-fill ${colorClass}" style="width:${p}%"></div>
            </div>
            <span style="font-size:var(--text-xs);color:var(--text-secondary);min-width:30px;text-align:right;">${p}%</span>
        </div>
    `;
}

function teamExportExcel(list) {
    if (!list || !list.length) return;
    const visibleCols = Object.keys(teamColumnSettings).filter(k => teamColumnSettings[k]);
    const fields = visibleCols;
    const labels = visibleCols.map(k => COLUMN_LABELS[k] || k);
    let csv = '\uFEFF';
    csv += labels.join(';') + '\n';
    list.forEach(t => {
        const row = fields.map(f => {
            let val = t[f] ?? '';
            if (f === 'cv') {
                const cv = calculateTaskCv(t);
                val = cv == null ? 'Нет данных' : cv.toFixed(2);
            } else if (f === 'involved_teams') {
                val = (t.involved_team_names || t.involved_teams || []).join(', ');
            } else if (f === 'link_jira') {
                val = excelValue(t.link_jira);
            } else if (f === 'created_by') {
                val = t.created_by_name || '';
            } else if (f === 'owner') {
                val = t.owner_name || t.owner || '';
            } else if (typeof val === 'object') {
                val = excelValue(val);
            }
            if (typeof val === 'string' && (val.includes(';') || val.includes('"') || val.includes('\n'))) val = '"' + val.replace(/"/g, '""') + '"';
            return val;
        });
        csv += row.join(';') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `team_backlog_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
}

function renderInvolvedTeams(teams) {
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
  const teamMap = new Map((window.app?.teams || []).map(team => [Number(team.id), team.name || '']));
  return items.map(v => {
    const key = Number(v);
    return Number.isNaN(key) ? String(v) : (teamMap.get(key) || String(v));
  }).join(', ');
}

function parseLinkList(links) {
  if (!links) return [];
  if (Array.isArray(links)) return links.filter(Boolean);
  if (typeof links === 'string') {
    const s = links.trim();
    if (s.charAt(0) === '[') {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) return arr.filter(Boolean);
      } catch (e) { /* fall through */ }
    }
    return s.split(',').map(x => x.trim()).filter(Boolean);
  }
  return [];
}

function renderLinkJiraList(links) {
  const arr = parseLinkList(links);
  if (!arr.length) return '—';
  return arr.map(url => {
    const safeUrl = safeExternalUrl(url);
    return safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">Jira</a>` : 'Некорректная ссылка';
  }).join(', ');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
