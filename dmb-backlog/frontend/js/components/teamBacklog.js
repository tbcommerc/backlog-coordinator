console.log('[DMB] teamBacklog.js v20260701.1 loaded');
import { renderToolbar, initToolbar, initToolbarControls, getFilteredList as ftFilteredList, resetToolbarFilters, updateStickyOffsets, initStickyTableHeader } from './filterToolbar.js';
import { renderTaskCard, openTaskModal, openCreateTaskModal, setOnTaskSaved, importTasksFromExcel, showBulkOpsModal } from './modal.js';
import { buildColumnLabels, buildColumnSettings, getAllColumnKeys } from './taskColumns.js';
import { renderQuickEditToolbar, initQuickEdit, enterQuickEdit, requestExitQuickEdit, isQuickEdit, getQuickEditChanges, getQuickEditField, isEditableField, renderQuickEditCell } from './quickEdit.js';
import { renderQuickFilters, initQuickFilters, syncQuickFilterButtons } from './quickFilters.js';

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

let teamColumnWidths = {};


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

    ${renderQuickFilters()}

    <div id="bulk-actions" class="flex items-center gap-3" style="margin-bottom: var(--space-4); display: none;">
        <span class="text-secondary">Выбрано: <strong id="selected-count">0</strong></span>
        <button class="btn btn-secondary btn-sm" data-bulk="close" aria-label="Закрыть выбранные задачи">Закрыть</button>
        <button class="btn btn-secondary btn-sm" data-bulk="hold" aria-label="Поставить на холд выбранные задачи">На холд</button>
        <button class="btn btn-danger btn-sm" data-bulk="delete" aria-label="Удалить выбранные задачи">Удалить</button>
    </div>

    ${renderQuickEditToolbar('team')}

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
    onColumnChange: () => renderTeamCurrentView(),
    onColumnOrderChange: () => renderTeamCurrentView(),
    onExport: () => { const list = ftFilteredList('team', teamTasksCache?.items || []); teamExportExcel(list); },
    onImport: () => { importTasksFromExcel(app, loadTeamTasks); },
    onAddTask: () => openCreateTaskModal(app),
    onRefresh: () => loadTeamTasks(app),
    onQuickEdit: () => { if (teamCurrentView === 'table') { if (isQuickEdit('team')) { requestExitQuickEdit('team'); } else { enterQuickEdit('team'); } } },
    onBulkOps: () => { if (teamCurrentView === 'table') { showBulkOpsModal(app, 'team', tasks); } },
  });

  initToolbar('team', tasks, onFilterChange);

    bindTeamSort();
    bindBulkActions(app);
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
    const showCheckbox = !isQuickEdit('team') && colHasCheckbox(visibleCols);
    const hasWidths = visibleCols.every(c => teamColumnWidths[c]);

    const sortableCols = ['id', 'priority', 'deadline', 'progress'];

    const headerHtml = visibleCols.map(col => {
        let icon = sortableCols.includes(col) ? ' <span class="sort-icon">↕</span>' : '';
        if (teamSortKey === col) {
            icon = teamSortDir === 'asc' ? ' <span class="sort-icon">↑</span>' : ' <span class="sort-icon">↓</span>';
        }
        if (col === 'title' || col === 'owner') icon = '';
        return `<th data-sort="${col}">${getTeamColumnLabel(col)}${icon}</th>`;
    }).join('');

    const colgroupHtml = visibleCols.map(col => {
        const w = teamColumnWidths[col] ? `width:${teamColumnWidths[col]}px;` : '';
        return `<col style="${w}">`;
    }).join('');

    const checkboxCol = showCheckbox ? '<col style="width:40px;">' : '';
    const tableStyle = (hasWidths && isQuickEdit('team')) ? 'table-layout:fixed;' : '';

    container.innerHTML = `
        <div class="table-container" style="overflow-x:auto;">
            <table class="table" id="team-tasks-table" style="${tableStyle}">
                <colgroup>${checkboxCol}${colgroupHtml}</colgroup>
                <thead>
                    <tr>
                        ${showCheckbox ? '<th><input type="checkbox" id="select-all"></th>' : ''}
                        ${headerHtml}
                    </tr>
                </thead>
                <tbody id="team-tasks-tbody">
                    ${list.length === 0
                        ? '<tr><td colspan="' + (visibleCols.length + (showCheckbox ? 1 : 0)) + '" class="text-center text-muted" style="padding:40px;">Нет задач</td></tr>'
                        : list.map(task => renderTeamTableRow(task, visibleCols, showCheckbox)).join('')}
                </tbody>
            </table>
        </div>
    `;

    if (!isQuickEdit('team')) {
        const measureWidths = () => {
            const ths = document.querySelectorAll('#team-tasks-table thead th');
            const offset = showCheckbox ? 1 : 0;
            ths.forEach((th, i) => {
                if (i >= offset && visibleCols[i - offset]) {
                    teamColumnWidths[visibleCols[i - offset]] = th.offsetWidth;
                }
            });
        };
        measureWidths();
        requestAnimationFrame(measureWidths);
    }

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
    bindTeamSort();
}

function colHasCheckbox(cols) {
    return cols.length > 0;
}

function getTeamColumnLabel(key) {
    return COLUMN_LABELS[key] || key;
}

function renderTeamCell(col, task) {
  const field = getQuickEditField(col);
  if (isQuickEdit('team') && isEditableField(col)) {
    return renderQuickEditCell('team', col, task);
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
        case 'involved_teams': return `<span>${renderInvolvedTeams(task.involved_team_names || task.involved_teams)}</span>`;
        case 'deadline': return `<span>${task.deadline_name || task.deadline || '—'}</span>`;
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
        case 'metric_kr_plan':
        case 'metric_kr_fact':
            return `<span class="font-mono">${task[col] != null ? metricFormat(task[col]) : '—'}</span>`;
        case 'financial_effect': return `<span class="font-mono">${metricFormat(task.financial_effect)}</span>`;
        case 'financial_effect_justification': return `<span>${task.financial_effect_justification || '—'}</span>`;
        case 'cv': return `<span>${renderCV(task)}</span>`;
        case 'progress': return `<span>${renderProgress(task.progress)}</span>`;
        case 'owner': return `<span>${task.owner_name || task.owner || '—'}</span>`;
        case 'created_by': return `<span>${task.created_by_name || '—'}</span>`;
        case 'key_project_status': return `<span>${task.key_project_status || '—'}</span>`;
        case 'key_project_status_updated_at': return `<span>${fmtDate(task.key_project_status_updated_at)}</span>`;
        case 'directorate_status': return `<span>${task.directorate_status || '—'}</span>`;
        case 'directorate_status_updated_at': return `<span>${fmtDate(task.directorate_status_updated_at)}</span>`;
        case 'did_status': return `<span>${task.did_status || '—'}</span>`;
        case 'did_status_updated_at': return `<span>${fmtDate(task.did_status_updated_at)}</span>`;
        case 'did_demo': return `<span>${task.did_demo ? '<span class="badge badge-high">Да</span>' : '<span class="badge badge-low">Нет</span>'}</span>`;
        case 'link_mockups': return `<span>${task.link_mockups ? `<a href="${task.link_mockups}" target="_blank" style="color:var(--accent)">Макеты</a>` : '—'}</span>`;
        case 'link_jira': return `<span>${renderLinkJiraList(task.link_jira)}</span>`;
        case 'rejection_reason': return `<span>${task.rejection_reason || '—'}</span>`;
        case 'comment': return `<span>${task.comment || '—'}</span>`;
        case 'last_updated': return `<span>${task.last_updated || '—'}</span>`;
        case 'created_at': return `<span>${task.created_at || '—'}</span>`;
        case 'updated_at': return `<span>${task.updated_at || '—'}</span>`;
        default: return '';
    }
}

function renderTeamTableRow(task, cols, showCheckbox) {
    const cells = cols.map(col => {
        const field = getQuickEditField(col);
        const change = getQuickEditChanges('team')[task.id]?.[field];
        const isChanged = !!change;
        const cellStyle = isChanged ? 'background: rgba(245, 158, 11, 0.2);' : '';
        return `<td style="${cellStyle}">${renderTeamCell(col, task)}</td>`;
    });
    const hasChanges = getQuickEditChanges('team')[task.id] && Object.keys(getQuickEditChanges('team')[task.id]).length > 0;
    const rowStyle = hasChanges
        ? `cursor:default;border-left:3px solid var(--warning);`
        : (isQuickEdit('team') ? 'cursor:default;' : 'cursor:pointer;');
    const checkboxHtml = showCheckbox ? `<td><input type="checkbox" class="task-checkbox" value="${task.id}"></td>` : '';
    return `<tr data-task-id="${task.id}" style="${rowStyle}">
        ${checkboxHtml}
        ${cells.join('')}
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
            owner: document.getElementById('task-owner')?.value || '',
            tags: document.getElementById('task-tags')?.value || '',
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
