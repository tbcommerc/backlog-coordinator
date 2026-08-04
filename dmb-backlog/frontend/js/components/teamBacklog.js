console.log('[DMB] teamBacklog.js v20260701.1 loaded');
import { renderToolbar, initToolbar, initToolbarControls, getFilteredList as ftFilteredList, resetToolbarFilters, updateStickyOffsets, initStickyTableHeader, columnFilters, renderFilterButtons, filterChangeCallbacks, isDeadlinePast, isCurrentTask, isLastQuarterTask } from './filterToolbar.js';
import { renderTaskCard, openTaskModal, openCreateTaskModal, setOnTaskSaved, importTasksFromExcel, showConfirmModal, showBulkOpsModal } from './modal.js';
import { buildColumnLabels, buildColumnSettings, getAllColumnKeys } from './taskColumns.js';

let COLUMN_LABELS = { ...buildColumnLabels(window.app?.fieldLabels || {}) };

let teamTasksCache = null;
let teamCurrentView = 'table';
let teamSortKey = null;
let teamSortDir = 'asc';
let teamCurrentApp = null;
const TEAM_DEFAULT_OVERRIDES = {
    owner: true, team: false, effort_days: false,
    financial_effect: false, cv: false
};
let teamColumnSettings = buildColumnSettings({}, TEAM_DEFAULT_OVERRIDES);
let teamColumnOrder = getAllColumnKeys();

let teamQuickEditMode = false;
let teamQuickEditChanges = {};
let teamQuickEditHistory = [];
let teamQuickEditHistoryIndex = -1;

const EDITABLE_FIELDS = {
  text: ['title', 'description', 'what_if', 'dod', 'comment', 'status_comment', 'link_mockups', 'rejection_reason'],
  number: ['effort_days', 'effort_rub', 'effort_designee', 'effort_analytics', 'effort_be', 'effort_fe', 'effort_test', 'effort_test_auto', 'effort_delivery', 'effort_python_be',
    'actual_effort_days', 'actual_effort_designee', 'actual_effort_analytics', 'actual_effort_be', 'actual_effort_fe', 'actual_effort_test', 'actual_effort_test_auto',
    'financial_effect', 'ice_impact', 'ice_confidence', 'ice_ease', 'metric_kr_plan', 'metric_kr_fact'],
  select: ['status_id', 'priority_id', 'team_id', 'deadline_id', 'task_type_id', 'channel_id', 'department_id', 'project_id', 'owner_id', 'responsible_po_id', 'business_analyst_id', 'it_product_lead_id'],
  checkbox: ['key_project', 'is_from_leadership', 'is_regular', 'did_demo'],
  date: ['date_received']
};

export function renderTeamBacklog(app) {
    const user = app.store.get('currentUser');
    const teamName = user?.team_name || 'Pre-Trade';
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
    })}

    <div id="team-quick-filters" class="flex gap-2" style="margin-bottom:var(--space-4);flex-wrap:wrap;">
      <button class="quick-filter-btn" data-filter="overdue">
        <span class="quick-filter-icon" style="background:var(--danger-light);color:var(--danger);">
          <i data-lucide="alert-circle" style="width:16px;height:16px;"></i>
        </span>
        <span class="quick-filter-info">
          <span class="quick-filter-label">Просрочено</span>
          <span class="quick-filter-count" id="qf-overdue-count">0</span>
        </span>
      </button>
      <button class="quick-filter-btn" data-filter="urgent">
        <span class="quick-filter-icon" style="background:var(--warning-light);color:var(--warning);">
          <i data-lucide="flame" style="width:16px;height:16px;"></i>
        </span>
        <span class="quick-filter-info">
          <span class="quick-filter-label">Важные задачи</span>
          <span class="quick-filter-count" id="qf-urgent-count">0</span>
        </span>
      </button>
      <button class="quick-filter-btn" data-filter="current">
        <span class="quick-filter-icon" style="background:var(--info-light);color:var(--info);">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M9 16l2 2 4-4"></path></svg>
        </span>
        <span class="quick-filter-info">
          <span class="quick-filter-label">Текущие задачи</span>
          <span class="quick-filter-count" id="qf-current-count">0</span>
        </span>
      </button>
      <button class="quick-filter-btn" data-filter="last_quarter">
        <span class="quick-filter-icon" style="background:var(--bg-tertiary);color:var(--text-secondary);">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        </span>
        <span class="quick-filter-info">
          <span class="quick-filter-label">Прошлый квартал</span>
          <span class="quick-filter-count" id="qf-last-quarter-count">0</span>
        </span>
      </button>
    </div>

    <div id="bulk-actions" class="flex items-center gap-3" style="margin-bottom: var(--space-4); display: none;">
        <span class="text-secondary">Выбрано: <strong id="selected-count">0</strong></span>
        <button class="btn btn-secondary btn-sm" data-bulk="close" aria-label="Закрыть выбранные задачи">Закрыть</button>
        <button class="btn btn-secondary btn-sm" data-bulk="hold" aria-label="Поставить на холд выбранные задачи">На холд</button>
        <button class="btn btn-danger btn-sm" data-bulk="delete" aria-label="Удалить выбранные задачи">Удалить</button>
    </div>

    <div id="team-quick-edit-toolbar" style="display:none;padding:12px;background:var(--bg-secondary);border-radius:8px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span style="color:var(--warning);font-weight:600;">⚠ Режим быстрого редактирования</span>
        <span id="team-qe-change-count" style="color:var(--text-secondary);font-size:13px;">Изменено: 0</span>
        <div style="flex:1;"></div>
        <button class="btn btn-ghost btn-sm" id="team-qe-undo" title="Отменить 1 шаг" disabled>↩</button>
        <button class="btn btn-ghost btn-sm" id="team-qe-redo" title="Вернуть изменения" disabled>↪</button>
        <button class="btn btn-secondary btn-sm" id="team-qe-cancel-all">Отменить все</button>
        <button class="btn btn-primary btn-sm" id="team-qe-save">Сохранить</button>
      </div>
    </div>

    <div id="team-tasks-container">
        <div class="table-container" style="overflow-x:auto;">
            <table class="table" id="team-tasks-table">
                <thead>
                    <tr id="team-table-header-row"></tr>
                </thead>
                <tbody id="team-tasks-tbody">
                    ${renderTeamSkeletonRows(6)}
                </tbody>
            </table>
        </div>
    </div>

    <div class="flex justify-between items-center" style="margin-top: var(--space-6);">
        <span class="text-secondary" id="team-tasks-count">Найдено: 0 задач</span>
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
    teamCurrentApp = app;
    await applyTeamDefaultDisplaySettings(app);
    await loadTeamTasks(app);

  function onFilterChange() {
    syncQuickFilterButtons();
    renderTeamCurrentView();
  }

  const tasks = teamTasksCache?.items || [];

  initToolbarControls('team', {
    columnSettings: teamColumnSettings,
    columnOrder: teamColumnOrder,
    columnLabels: COLUMN_LABELS,
    defaultColumnSettings: buildColumnSettings({}, TEAM_DEFAULT_OVERRIDES),
    onViewChange: (view) => { teamCurrentView = view; renderTeamCurrentView(); },
    onColumnChange: () => renderTeamCurrentView(),
    onColumnOrderChange: () => renderTeamCurrentView(),
    onExport: () => { const list = ftFilteredList('team', teamTasksCache?.items || []); teamExportExcel(list); },
    onImport: () => { importTasksFromExcel(app, loadTeamTasks); },
    onAddTask: () => openCreateTaskModal(app),
    onRefresh: () => loadTeamTasks(app),
    onQuickEdit: () => { if (teamCurrentView === 'table') { if (teamQuickEditMode) { exitTeamQuickEditMode(); } else { enterTeamQuickEditMode(); } } },
    onBulkOps: () => { if (teamCurrentView === 'table') { showBulkOpsModal(app, 'team', tasks); } },
  });

  initToolbar('team', tasks, onFilterChange);

    bindTeamSort();
    bindBulkActions(app);
    bindTeamQuickEditEvents();

    initTeamQuickFilters(app);
    setOnTaskSaved(() => loadTeamTasks(app));
}

function syncQuickFilterButtons() {
  const cf = columnFilters['team'] || {};
  document.querySelectorAll('.quick-filter-btn').forEach(btn => {
    const fk = `_${btn.dataset.filter}`;
    btn.classList.toggle('active', !!(cf[fk] && cf[fk].size > 0));
  });
}

function initTeamQuickFilters(app) {
  const terminalStatuses = ['ВЫПОЛНЕНА', 'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА'];

  function updateCounts() {
    const tasks = teamTasksCache?.items || [];
    const overdue = tasks.filter(t => t.deadline_id != null && !terminalStatuses.includes(t.status_name) && isDeadlinePast(t.deadline_name));
    const urgent = tasks.filter(t => t.priority_name === 'ВЫСОКИЙ');
    const current = tasks.filter(isCurrentTask);
    const lastQuarter = tasks.filter(isLastQuarterTask);
    const overdueEl = document.getElementById('qf-overdue-count');
    const urgentEl = document.getElementById('qf-urgent-count');
    const currentEl = document.getElementById('qf-current-count');
    const lastQuarterEl = document.getElementById('qf-last-quarter-count');
    if (overdueEl) overdueEl.textContent = overdue.length;
    if (urgentEl) urgentEl.textContent = urgent.length;
    if (currentEl) currentEl.textContent = current.length;
    if (lastQuarterEl) lastQuarterEl.textContent = lastQuarter.length;
  }

  function applyFilter(key) {
    const cf = columnFilters['team'];
    const fk = `_${key}`;
    if (cf[fk] && cf[fk].size > 0) {
      delete cf[fk];
    } else {
      cf[fk] = new Set(['yes']);
    }
  }

  function refreshView() {
    const tasks = teamTasksCache?.items || [];
    renderFilterButtons('team', tasks);
    const cb = filterChangeCallbacks?.team;
    if (cb) cb();
  }

  document.querySelectorAll('.quick-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyFilter(btn.dataset.filter);
      refreshView();
    });
  });

  updateCounts();
}

async function loadTeamTasks(app) {
    try {
        const user = app.store.get('currentUser');
        const teamsResp = await app.api.get('/teams');
        const teams = teamsResp.items || [];
        const teamId = user?.team_id || null;

        let url = '/tasks?per_page=500';
        if (teamId) url += `&team_id=${teamId}`;

        const data = await app.api.get(url);
        teamTasksCache = data;
        renderTeamCurrentView();
        const countEl = document.getElementById('team-tasks-count');
        if (countEl) countEl.textContent = `Найдено: ${data.items.length} задач`;
    
    } catch (e) {
        document.getElementById('team-tasks-tbody').innerHTML =
            `<tr><td colspan="9" class="text-center text-muted" style="padding: 40px;">Ошибка загрузки: ${e.message}</td></tr>`;
    }
}

function renderTeamCurrentView() {
    const tasks = teamTasksCache?.items || [];
    const list = ftFilteredList('team', tasks);
    const countEl = document.getElementById('team-tasks-count');
    if (countEl) countEl.textContent = `Найдено: ${list.length} задач`;
    const isMobile = window.innerWidth <= 768;
    const view = isMobile ? 'cards' : teamCurrentView;
    if (view === 'cards') {
        renderTeamCards(list);
    } else {
        renderTeamTableView(list);
    }
}

function renderTeamTableView(list) {
    const container = document.getElementById('team-tasks-container');
    if (!container) return;

    const visibleCols = teamColumnOrder.filter(k => teamColumnSettings[k]);

    const sortableCols = ['id', 'priority', 'deadline', 'progress'];

    const headerHtml = visibleCols.map(col => {
        let icon = sortableCols.includes(col) ? ' <span class="sort-icon">↕</span>' : '';
        if (teamSortKey === col) {
            icon = teamSortDir === 'asc' ? ' <span class="sort-icon">↑</span>' : ' <span class="sort-icon">↓</span>';
        }
        if (col === 'title' || col === 'owner') icon = '';
        return `<th data-sort="${col}">${getTeamColumnLabel(col)}${icon}</th>`;
    }).join('');

    container.innerHTML = `
        <div class="table-container" style="overflow-x:auto;">
            <table class="table" id="team-tasks-table">
                <thead>
                    <tr>
                        ${colHasCheckbox(visibleCols) ? '<th><input type="checkbox" id="select-all"></th>' : ''}
                        ${headerHtml}
                    </tr>
                </thead>
                <tbody id="team-tasks-tbody">
                    ${list.length === 0
                        ? '<tr><td colspan="' + (visibleCols.length + 1) + '" class="text-center text-muted" style="padding:40px;">Нет задач</td></tr>'
                        : list.map(task => renderTeamTableRow(task, visibleCols)).join('')}
                </tbody>
            </table>
        </div>
    `;

    updateStickyOffsets();
    initStickyTableHeader('team-tasks-table');

    if (list.length > 0) {
        bindSelectAll();
        document.querySelectorAll('#team-tasks-tbody tr').forEach(tr => {
            tr.addEventListener('click', (e) => {
                if (e.target.closest('.task-checkbox, input')) return;
                const t = list.find(x => x.id == tr.dataset.taskId);
                if (t) openTaskModal(t);
            });
        });
    }
    bindTeamSort();
}

function colHasCheckbox(cols) {
    return cols.length > 0;
}

function getTeamColumnLabel(key) {
    return COLUMN_LABELS[key] || key;
}

function renderTeamCell(col, task) {
    if (teamQuickEditMode && isTeamEditableField(col)) {
        return renderTeamEditableCell(col, task);
    }

    const taskId = task.id;
    const change = teamQuickEditChanges[taskId]?.[col];
    const isChanged = !!change;
    const bgStyle = isChanged ? 'background: rgba(245, 158, 11, 0.2);' : '';

    switch (col) {
        case 'id': return `<span class="font-mono text-muted">#${task.id}</span>`;
        case 'title': return `<strong style="${bgStyle}">${task.title}</strong>`;
        case 'description': return `<span style="color:var(--text-muted);font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;${bgStyle}">${task.description || '—'}</span>`;
        case 'date_received': return `<span style="${bgStyle}">${task.date_received || '—'}</span>`;
        case 'status': return `<span style="${bgStyle}">${renderStatus(task.status_name || task.status)}</span>`;
        case 'priority': return `<span style="${bgStyle}">${renderPriority(task.priority_name || task.priority)}</span>`;
        case 'team': return `<span class="badge badge-info" style="${bgStyle}">${task.team_name || '—'}</span>`;
        case 'channel': return `<span style="${bgStyle}">${task.channel_name || '—'}</span>`;
        case 'business_customer': return `<span style="${bgStyle}">${task.business_customer_name || task.business_customer || '—'}</span>`;
        case 'department': return `<span style="${bgStyle}">${task.department_name || '—'}</span>`;
        case 'project': return `<span style="${bgStyle}">${task.project_name || '—'}</span>`;
        case 'task_type': return `<span style="${bgStyle}">${task.task_type_name || '—'}</span>`;
        case 'involved_teams': return `<span style="${bgStyle}">${renderInvolvedTeams(task.involved_team_names || task.involved_teams)}</span>`;
        case 'deadline': return `<span style="${bgStyle}">${task.deadline_name || task.deadline || '—'}</span>`;
        case 'effort_days': return `<span style="${bgStyle}">${task.effort_days != null ? task.effort_days + ' дн' : '—'}</span>`;
        case 'effort_rub': return `<span class="font-mono" style="${bgStyle}">${metricFormat(task.effort_rub)}</span>`;
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
        case 'ice_impact':
        case 'ice_confidence':
        case 'ice_ease':
        case 'metric_kr_plan':
        case 'metric_kr_fact':
            return `<span class="font-mono" style="${bgStyle}">${task[col] != null ? metricFormat(task[col]) : '—'}</span>`;
        case 'financial_effect': return `<span class="font-mono" style="${bgStyle}">${metricFormat(task.financial_effect)}</span>`;
        case 'financial_effect_justification': return `<span style="${bgStyle}">${task.financial_effect_justification || '—'}</span>`;
        case 'cv': return `<span style="${bgStyle}">${renderCV(task)}</span>`;
        case 'ice_score': return `<span style="${bgStyle}">${task.ice_score != null ? task.ice_score.toFixed(1) : '—'}</span>`;
        case 'progress': return `<span style="${bgStyle}">${renderProgress(task.progress)}</span>`;
        case 'owner': return `<span style="${bgStyle}">${task.owner_name || task.owner || '—'}</span>`;
        case 'responsible_po': return `<span style="${bgStyle}">${task.responsible_po_name || '—'}</span>`;
        case 'business_analyst': return `<span style="${bgStyle}">${task.business_analyst_name || '—'}</span>`;
        case 'it_product_lead': return `<span style="${bgStyle}">${task.it_product_lead_name || '—'}</span>`;
        case 'created_by': return `<span style="${bgStyle}">${task.created_by_name || '—'}</span>`;
        case 'key_project': return `<span style="${bgStyle}">${task.key_project ? '<span class="badge badge-high">Да</span>' : '<span class="badge badge-low">Нет</span>'}</span>`;
        case 'key_project_status': return `<span style="${bgStyle}">${task.key_project_status || '—'}</span>`;
        case 'key_project_status_updated_at': return `<span style="${bgStyle}">${fmtDate(task.key_project_status_updated_at)}</span>`;
        case 'directorate_status': return `<span style="${bgStyle}">${task.directorate_status || '—'}</span>`;
        case 'directorate_status_updated_at': return `<span style="${bgStyle}">${fmtDate(task.directorate_status_updated_at)}</span>`;
        case 'did_status': return `<span style="${bgStyle}">${task.did_status || '—'}</span>`;
        case 'did_status_updated_at': return `<span style="${bgStyle}">${fmtDate(task.did_status_updated_at)}</span>`;
        case 'did_demo': return `<span style="${bgStyle}">${task.did_demo ? '<span class="badge badge-high">Да</span>' : '<span class="badge badge-low">Нет</span>'}</span>`;
        case 'is_from_leadership': return `<span style="${bgStyle}">${task.is_from_leadership ? '<span class="badge badge-warning">Да</span>' : '<span class="badge badge-low">Нет</span>'}</span>`;
        case 'is_regular': return `<span style="${bgStyle}">${task.is_regular ? '<span class="badge badge-info">Да</span>' : '<span class="badge badge-low">Нет</span>'}</span>`;
        case 'what_if': return `<span style="${bgStyle}">${task.what_if || '—'}</span>`;
        case 'dod': return `<span style="${bgStyle}">${task.dod || '—'}</span>`;
        case 'link_mockups': return `<span style="${bgStyle}">${task.link_mockups ? `<a href="${task.link_mockups}" target="_blank" style="color:var(--accent)">Макеты</a>` : '—'}</span>`;
        case 'link_jira': return `<span style="${bgStyle}">${renderLinkJiraList(task.link_jira)}</span>`;
        case 'rejection_reason': return `<span style="${bgStyle}">${task.rejection_reason || '—'}</span>`;
        case 'comment': return `<span style="${bgStyle}">${task.comment || '—'}</span>`;
        case 'status_comment': return `<span style="${bgStyle}">${task.status_comment || '—'}</span>`;
        case 'last_updated': return `<span style="${bgStyle}">${task.last_updated || '—'}</span>`;
        case 'created_at': return `<span style="${bgStyle}">${task.created_at || '—'}</span>`;
        case 'updated_at': return `<span style="${bgStyle}">${task.updated_at || '—'}</span>`;
        default: return '';
    }
}

function renderTeamTableRow(task, cols) {
    const cells = cols.map(col => renderTeamCell(col, task));
    const hasChanges = teamQuickEditChanges[task.id] && Object.keys(teamQuickEditChanges[task.id]).length > 0;
    const rowStyle = hasChanges ? 'background:rgba(245,158,11,0.1);' : '';
    const checkboxHtml = teamQuickEditMode ? '' : `<td><input type="checkbox" class="task-checkbox" value="${task.id}"></td>`;
    return `<tr data-task-id="${task.id}" style="${rowStyle}">
        ${checkboxHtml}
        ${cells.map(c => `<td>${c}</td>`).join('')}
    </tr>`;
}

function renderTeamCards(list) {
    const container = document.getElementById('team-tasks-container');
    if (!container) return;
    container.innerHTML = `
        <div class="task-card-grid">
            ${list.length === 0
                ? '<div class="text-center text-muted" style="padding:40px;width:100%;">Нет задач</div>'
                : list.map(task => renderTaskCard(task)).join('')}
        </div>
    `;
    container.querySelectorAll('.task-card').forEach(card => {
        card.addEventListener('click', () => {
            const t = list.find(x => x.id == card.dataset.id);
            if (t) openTaskModal(t);
        });
    });
}

function bindTeamSort() {
    document.querySelectorAll('#team-tasks-table th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const key = th.dataset.sort;
            if (teamSortKey === key) {
                teamSortDir = teamSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                teamSortKey = key;
                teamSortDir = 'asc';
            }
            renderTeamCurrentView();
        });
    });
}

async function populateTeamSelect(selectedTeamId) {
    const select = document.getElementById('task-team');
    if (!select) return;
    try {
        const teams = await window.app?.api?.get('/teams') || [];
        select.innerHTML = teams.map(t =>
            `<option value="${t.id}" ${t.id === selectedTeamId ? 'selected' : ''}>${t.name}</option>`
        ).join('');
    } catch {
        select.innerHTML = '<option value="">Нет команд</option>';
    }
}

function setupTaskFormSave(modal, task, app) {
    document.getElementById('modal-confirm')?.addEventListener('click', async () => {
        const data = {
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
            status_comment: document.getElementById('task-status-comment')?.value || '',
            owner: document.getElementById('task-owner')?.value || '',
            tags: document.getElementById('task-tags')?.value || '',
            key_project: document.getElementById('task-key-project')?.checked || false,
        };
        try {
            if (task) {
                await app.api.put(`/tasks/${task.id}`, data);
            } else {
                await app.api.post('/tasks', data);
            }
            document.querySelector('.modal-close')?.click();
            await loadTeamTasks(app);
        } catch (e) {
            alert('Ошибка: ' + e.message);
        }
    });
}

function bindBulkActions(app) {
    document.querySelectorAll('[data-bulk]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const checked = document.querySelectorAll('.task-checkbox:checked');
            const ids = Array.from(checked).map(cb => parseInt(cb.value));
            if (!ids.length) return;
            const action = btn.dataset.bulk;
            try {
                await app.api.post('/tasks/bulk', { action, task_ids: ids });
                await loadTeamTasks(app);
            } catch (e) {
                alert('Ошибка: ' + e.message);
            }
        });
    });
}

function bindSelectAll() {
    document.getElementById('select-all')?.addEventListener('change', function () {
        document.querySelectorAll('.task-checkbox').forEach(cb => cb.checked = this.checked);
        updateBulkBar();
    });
    document.querySelectorAll('.task-checkbox').forEach(cb => {
        cb.addEventListener('change', updateBulkBar);
    });
}

function updateBulkBar() {
    const checked = document.querySelectorAll('.task-checkbox:checked').length;
    const bar = document.getElementById('bulk-actions');
    if (bar) {
        bar.style.display = checked > 0 ? 'flex' : 'none';
        document.getElementById('selected-count').textContent = checked;
    }
}

function metricFormat(val) {
  if (val === null || val === undefined) return '—';
  return new Intl.NumberFormat('ru-RU').format(val);
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
  const cv = task.financial_effect && task.effort_rub && task.effort_rub > 0
    ? (task.financial_effect / task.effort_rub).toFixed(2) : null;
  if (cv === null) return '<span class="badge badge-low">—</span>';
  const cls = parseFloat(cv) > 1.5 ? 'badge-high' : parseFloat(cv) > 1.0 ? 'badge-warning' : 'badge-danger';
  return `<span class="badge ${cls}">${cv}</span>`;
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
                val = t.financial_effect && t.effort_rub && t.effort_rub > 0
                    ? (t.financial_effect / t.effort_rub).toFixed(2) : '—';
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

function bindTeamQuickEditEvents() {
  document.getElementById('team-qe-save')?.addEventListener('click', async () => {
    const changes = getTeamQuickEditChanges();
    const count = Object.keys(changes).reduce((acc, tid) => acc + Object.keys(changes[tid]).length, 0);
    if (count === 0) {
      window.toast?.('Нет изменений для сохранения', 'info');
      return;
    }
    const confirmed = await showConfirmModal(`Будет сохранено ${count} изменений. Продолжить?`, 'Сохранить изменения');
    if (!confirmed) return;
    await saveTeamQuickEditChanges();
  });

  document.getElementById('team-qe-cancel-all')?.addEventListener('click', async () => {
    if (Object.keys(teamQuickEditChanges).length === 0) {
      exitTeamQuickEditMode();
      return;
    }
    const confirmed = await showConfirmModal('Все несохранённые изменения будут потеряны. Продолжить?', 'Отменить все изменения');
    if (!confirmed) return;
    exitTeamQuickEditMode();
  });

  document.getElementById('team-qe-undo')?.addEventListener('click', () => {
    performTeamUndo();
  });

  document.getElementById('team-qe-redo')?.addEventListener('click', () => {
    performTeamRedo();
  });
}

function enterTeamQuickEditMode() {
  teamQuickEditMode = true;
  const toolbar = document.getElementById('team-quick-edit-toolbar');
  if (toolbar) toolbar.style.display = 'block';
  renderTeamCurrentView();
}

function exitTeamQuickEditMode() {
  teamQuickEditMode = false;
  teamQuickEditChanges = {};
  teamQuickEditHistory = [];
  teamQuickEditHistoryIndex = -1;
  const toolbar = document.getElementById('team-quick-edit-toolbar');
  if (toolbar) toolbar.style.display = 'none';
  updateTeamQuickEditCount();
  renderTeamCurrentView();
}

function getTeamQuickEditChanges() {
  return teamQuickEditChanges;
}

function updateTeamQuickEditCount() {
  const countEl = document.getElementById('team-qe-change-count');
  const undoBtn = document.getElementById('team-qe-undo');
  const redoBtn = document.getElementById('team-qe-redo');
  if (countEl) {
    const count = Object.keys(teamQuickEditChanges).reduce((acc, tid) => acc + Object.keys(teamQuickEditChanges[tid]).length, 0);
    countEl.textContent = `Изменено: ${count}`;
  }
  if (undoBtn) undoBtn.disabled = teamQuickEditHistoryIndex < 0;
  if (redoBtn) redoBtn.disabled = teamQuickEditHistoryIndex >= teamQuickEditHistory.length - 1;
}

function recordTeamChange(taskId, field, oldValue, newValue) {
  teamQuickEditHistory = teamQuickEditHistory.slice(0, teamQuickEditHistoryIndex + 1);
  teamQuickEditHistory.push({ taskId, field, oldValue, newValue });
  teamQuickEditHistoryIndex = teamQuickEditHistory.length - 1;
  updateTeamQuickEditCount();
}

function performTeamUndo() {
  if (teamQuickEditHistoryIndex < 0) return;
  const action = teamQuickEditHistory[teamQuickEditHistoryIndex];
  if (teamQuickEditChanges[action.taskId] && teamQuickEditChanges[action.taskId][action.field]) {
    if (teamQuickEditChanges[action.taskId][action.field].oldValue === action.oldValue) {
      delete teamQuickEditChanges[action.taskId][action.field];
      if (Object.keys(teamQuickEditChanges[action.taskId]).length === 0) {
        delete teamQuickEditChanges[action.taskId];
      }
    }
  }
  teamQuickEditHistoryIndex--;
  updateTeamQuickEditCount();
  renderTeamCurrentView();
}

function performTeamRedo() {
  if (teamQuickEditHistoryIndex >= teamQuickEditHistory.length - 1) return;
  teamQuickEditHistoryIndex++;
  const action = teamQuickEditHistory[teamQuickEditHistoryIndex];
  if (!teamQuickEditChanges[action.taskId]) teamQuickEditChanges[action.taskId] = {};
  teamQuickEditChanges[action.taskId][action.field] = { oldValue: action.oldValue, newValue: action.newValue };
  updateTeamQuickEditCount();
  renderTeamCurrentView();
}

async function saveTeamQuickEditChanges() {
  const tasks = teamTasksCache?.items || [];
  let saved = 0;
  let errors = 0;

  for (const [taskId, fields] of Object.entries(teamQuickEditChanges)) {
    const task = tasks.find(t => t.id == taskId);
    if (!task) continue;
    const data = {};
    for (const [field, changes] of Object.entries(fields)) {
      data[field] = changes.newValue;
    }
    data.version = task.version;

    try {
      await teamCurrentApp.api.put(`/tasks/${taskId}`, data);
      saved++;
    } catch (e) {
      errors++;
      console.error(`Failed to save task ${taskId}:`, e);
    }
  }

  if (errors > 0) {
    window.toast?.(`Сохранено: ${saved}, ошибок: ${errors}`, errors > 0 ? 'warning' : 'success');
  } else {
    window.toast?.(`Сохранено ${saved} изменений`, 'success');
  }

  exitTeamQuickEditMode();
  await loadTeamTasks(teamCurrentApp);
}

function isTeamEditableField(col) {
  return EDITABLE_FIELDS.text.includes(col) ||
         EDITABLE_FIELDS.number.includes(col) ||
         EDITABLE_FIELDS.select.includes(col) ||
         EDITABLE_FIELDS.checkbox.includes(col) ||
         EDITABLE_FIELDS.date.includes(col);
}

function renderTeamEditableCell(col, task) {
  const taskId = task.id;
  const field = col;
  const currentValue = task[col];
  const change = teamQuickEditChanges[taskId]?.[field];
  const value = change ? change.newValue : currentValue;
  const isChanged = !!change;
  const bgStyle = isChanged ? 'background: rgba(245, 158, 11, 0.2);' : '';

  if (EDITABLE_FIELDS.text.includes(col)) {
    return `<input type="text" value="${escapeHtml(value || '')}" data-task="${taskId}" data-field="${field}" data-original="${escapeHtml(currentValue || '')}" style="${bgStyle}width:100%;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;font-size:12px;box-sizing:border-box;">`;
  }
  if (EDITABLE_FIELDS.number.includes(col)) {
    return `<input type="number" value="${value != null ? value : ''}" data-task="${taskId}" data-field="${field}" data-original="${currentValue != null ? currentValue : ''}" style="${bgStyle}width:80px;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;font-size:12px;box-sizing:border-box;">`;
  }
  if (EDITABLE_FIELDS.checkbox.includes(col)) {
    return `<input type="checkbox" ${value ? 'checked' : ''} data-task="${taskId}" data-field="${field}" data-original="${currentValue ? 'true' : 'false'}" style="${bgStyle}margin:0;">`;
  }
  if (EDITABLE_FIELDS.date.includes(col)) {
    return `<input type="date" value="${value || ''}" data-task="${taskId}" data-field="${field}" data-original="${currentValue || ''}" style="${bgStyle}padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;font-size:12px;box-sizing:border-box;">`;
  }
  if (EDITABLE_FIELDS.select.includes(col)) {
    return renderTeamSelectForEdit(col, taskId, field, value, currentValue, isChanged, bgStyle);
  }
  return renderTeamCell(col, task);
}

function renderTeamSelectForEdit(col, taskId, field, value, currentValue, isChanged, bgStyle) {
  let options = '';
  let displayValue = value;

  switch (col) {
    case 'status_id':
      options = window.app?.statuses?.map(s => `<option value="${s.id}" ${s.id == value ? 'selected' : ''}>${s.name}</option>`).join('') || '';
      displayValue = window.app?.statuses?.find(s => s.id == value)?.name || value;
      break;
    case 'priority_id':
      options = window.app?.priorities?.map(p => `<option value="${p.id}" ${p.id == value ? 'selected' : ''}>${p.name}</option>`).join('') || '';
      displayValue = window.app?.priorities?.find(p => p.id == value)?.name || value;
      break;
    case 'team_id':
      options = window.app?.teams?.map(t => `<option value="${t.id}" ${t.id == value ? 'selected' : ''}>${t.name}</option>`).join('') || '';
      displayValue = window.app?.teams?.find(t => t.id == value)?.name || value;
      break;
    case 'deadline_id':
      options = window.app?.deadlines?.map(d => `<option value="${d.id}" ${d.id == value ? 'selected' : ''}>${d.name}</option>`).join('') || '';
      displayValue = window.app?.deadlines?.find(d => d.id == value)?.name || value;
      break;
    case 'task_type_id':
      options = window.app?.taskTypes?.map(t => `<option value="${t.id}" ${t.id == value ? 'selected' : ''}>${t.name}</option>`).join('') || '';
      displayValue = window.app?.taskTypes?.find(t => t.id == value)?.name || value;
      break;
    case 'channel_id':
      options = window.app?.channels?.map(c => `<option value="${c.id}" ${c.id == value ? 'selected' : ''}>${c.name}</option>`).join('') || '';
      displayValue = window.app?.channels?.find(c => c.id == value)?.name || value;
      break;
    case 'department_id':
      options = window.app?.departments?.map(d => `<option value="${d.id}" ${d.id == value ? 'selected' : ''}>${d.name}</option>`).join('') || '';
      displayValue = window.app?.departments?.find(d => d.id == value)?.name || value;
      break;
    case 'project_id':
      options = window.app?.projects?.map(p => `<option value="${p.id}" ${p.id == value ? 'selected' : ''}>${p.name}</option>`).join('') || '';
      displayValue = window.app?.projects?.find(p => p.id == value)?.name || value;
      break;
    case 'owner_id':
    case 'responsible_po_id':
    case 'business_analyst_id':
    case 'it_product_lead_id':
      const users = window.app?.users || [];
      options = users.map(u => `<option value="${u.id}" ${u.id == value ? 'selected' : ''}>${u.name}</option>`).join('');
      displayValue = users.find(u => u.id == value)?.name || value;
      break;
    default:
      return `<span style="${bgStyle}">${displayValue || '—'}</span>`;
  }

  return `<select data-task="${taskId}" data-field="${field}" data-original="${currentValue || ''}" style="${bgStyle}width:100%;padding:4px 6px;border:1px solid var(--border-color);border-radius:4px;font-size:12px;box-sizing:border-box;background:var(--bg-primary);">${options}</select>`;
}

function renderInvolvedTeams(teams) {
  if (!teams || !teams.length) return '—';
  return Array.isArray(teams) ? teams.join(', ') : teams;
}

function renderLinkJiraList(links) {
  if (!links || !links.length) return '—';
  if (typeof links === 'string') links = [links];
  return links.filter(Boolean).map(url => `<a href="${escapeHtml(url)}" target="_blank" style="color:var(--accent)">Jira</a>`).join(', ');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
