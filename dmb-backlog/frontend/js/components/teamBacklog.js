console.log('[DMB] teamBacklog.js v20260626.5 loaded');
import { renderToolbar, initToolbar, initToolbarControls, getFilteredList as ftFilteredList, resetToolbarFilters, updateStickyOffsets, initStickyTableHeader } from './filterToolbar.js';
import { renderTaskCard, openTaskModal, openCreateTaskModal, setOnTaskSaved } from './modal.js';

const DEFAULT_COLUMN_LABELS = {
  id: 'ID', title: 'Задача', description: 'Описание', date_received: 'Дата получения',
  status: 'Статус', priority: 'Приоритет', team: 'Команда',
  channel: 'Канал', business_customer: 'Бизнес-заказчик', department: 'Подразделение',
  project: 'Проект', task_type: 'Тип задачи', involved_teams: 'Вовлечённые команды',
  deadline: 'Дедлайн', deadline_po: 'PO-дедлайн',
  effort_days: 'Трудозатраты (дни)', effort_rub: 'Трудозатраты (руб)',
  financial_effect: 'Фин. эффект', cv: 'C/V', ice_score: 'ICE',
  progress: 'Прогресс', owner: 'Владелец',
  responsible_po: 'Ответственный PO', business_analyst: 'Бизнес-аналитик',
  it_product_lead: 'IT Product Lead',
  key_project: 'Ключевой проект', key_project_status: 'Статус ключ. проекта',
  directorate_status: 'Статус для директорской', did_status: 'Статус для ДИД',
  is_from_leadership: 'От руководства', is_regular: 'Регулярная задача',
  what_if: 'What-If', dod: 'Definition of Done',
  link_mockups: 'Ссылка на макеты', link_jira: 'Ссылка на Jira',
  rejection_reason: 'Причина отклонения', comment: 'Комментарий',
  status_comment: 'Статус-комментарий',
  last_updated: 'Последнее обновление', created_at: 'Дата создания', updated_at: 'Дата изменения',

};
let COLUMN_LABELS = { ...DEFAULT_COLUMN_LABELS };

let teamTasksCache = null;
let teamCurrentView = 'table';
let teamSortKey = null;
let teamSortDir = 'asc';
let teamCurrentApp = null;
const TEAM_DEFAULT_COLUMN_SETTINGS = {
    id: true, title: true, priority: true, status: true,
    deadline: true, owner: true, progress: true
};
let teamColumnSettings = { ...TEAM_DEFAULT_COLUMN_SETTINGS };
let teamColumnOrder = Object.keys(teamColumnSettings);

export function renderTeamBacklog(app) {
    const user = app.store.get('currentUser');
    const teamName = user?.team_name || 'Pre-Trade';

    return `
    ${renderToolbar('team', {
      title: `Бэклог команды ${teamName}`,
      subtitle: 'Управление задачами вашей команды',
      columnSettings: teamColumnSettings,
      columnOrder: teamColumnOrder,
      columnLabels: COLUMN_LABELS,
      addTask: true,
    })}

    <div id="bulk-actions" class="flex items-center gap-3" style="margin-bottom: var(--space-4); display: none;">
        <span class="text-secondary">Выбрано: <strong id="selected-count">0</strong></span>
        <button class="btn btn-secondary btn-sm" data-bulk="close" aria-label="Закрыть выбранные задачи">Закрыть</button>
        <button class="btn btn-secondary btn-sm" data-bulk="hold" aria-label="Поставить на холд выбранные задачи">На холд</button>
        <button class="btn btn-danger btn-sm" data-bulk="delete" aria-label="Удалить выбранные задачи">Удалить</button>
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
  try {
    const resp = await app.api.get('/admin/display-settings/team_backlog');
    if (resp && resp.settings) {
      const savedKeys = Object.keys(resp.settings);
      if (savedKeys.length > 0) {
        const VALID_KEYS = new Set(Object.keys(DEFAULT_COLUMN_LABELS));
        const KEY_MAP = { financial: 'financial_effect', effort: 'effort_days' };
        const newSettings = {};
        savedKeys.forEach(key => {
          const mapped = KEY_MAP[key] || key;
          if (VALID_KEYS.has(mapped) && resp.settings[key] !== undefined) {
            newSettings[mapped] = resp.settings[key];
          }
        });
        Object.keys(TEAM_DEFAULT_COLUMN_SETTINGS).forEach(key => {
          if (!(key in newSettings)) newSettings[key] = TEAM_DEFAULT_COLUMN_SETTINGS[key];
        });
        teamColumnSettings = newSettings;
        teamColumnOrder = Object.keys(teamColumnSettings);
      }
    }
  } catch (e) {
    console.log('[DMB] No team display settings, using defaults');
  }
}

async function fetchTeamColumnLabels(app) {
  try {
    const labels = await app.api.get('/admin/column-labels');
    if (labels && typeof labels === 'object') {
      Object.keys(labels).forEach(key => { if (labels[key]) COLUMN_LABELS[key] = labels[key]; });
    }
  } catch (e) {
    // use defaults
  }
}

export async function initTeamBacklog(app) {
    teamCurrentApp = app;
    await fetchTeamColumnLabels(app);
    await applyTeamDefaultDisplaySettings(app);
    await loadTeamTasks(app);

  function onFilterChange() {
    renderTeamCurrentView();
  }

  const tasks = teamTasksCache?.items || [];
  initToolbar('team', tasks, onFilterChange);

    bindTeamSort();
    bindBulkActions(app);
    initToolbarControls('team', {
        columnSettings: teamColumnSettings,
        columnOrder: teamColumnOrder,
        columnLabels: {
            id: 'ID', title: 'Задача', priority: 'Приоритет', status: 'Статус',
            deadline: 'Дедлайн', owner: 'Владелец', progress: 'Прогресс'
        },
        onViewChange: (view) => { teamCurrentView = view; renderTeamCurrentView(); },
        onColumnChange: () => renderTeamCurrentView(),
        onColumnOrderChange: () => renderTeamCurrentView(),
        onExport: () => { const list = ftFilteredList('team', teamTasksCache?.items || []); teamExportExcel(list); },
        onAddTask: () => openCreateTaskModal(app),
        onRefresh: () => loadTeamTasks(app),
    });

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
    switch (col) {
        case 'id': return `<span class="font-mono text-muted">#${task.id}</span>`;
        case 'title': return `<strong>${task.title}</strong>`;
        case 'description': return `<span style="color:var(--text-muted);font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block">${task.description || '—'}</span>`;
        case 'date_received': return task.date_received || '—';
        case 'status': return renderStatus(task.status_name || task.status);
        case 'priority': return renderPriority(task.priority_name || task.priority);
        case 'team': return `<span class="badge badge-info">${task.team_name || '—'}</span>`;
        case 'channel': return task.channel_name || '—';
        case 'business_customer': return task.business_customer_name || task.business_customer || '—';
        case 'department': return task.department_name || '—';
        case 'project': return task.project_name || '—';
        case 'task_type': return task.task_type_name || '—';
        case 'involved_teams': return task.involved_teams || '—';
        case 'deadline': return task.deadline_name || task.deadline || '—';
        case 'deadline_po': return task.deadline_po_name || '—';
        case 'effort_days': return task.effort_days != null ? `${task.effort_days} дн` : '—';
        case 'effort_rub': return `<span class="font-mono">${metricFormat(task.effort_rub)}</span>`;
        case 'financial_effect': return `<span class="font-mono">${metricFormat(task.financial_effect)}</span>`;
        case 'cv': return renderCV(task);
        case 'ice_score': return task.ice_score != null ? task.ice_score.toFixed(1) : '—';
        case 'progress': return renderProgress(task.progress);
        case 'owner': return task.owner_name || task.owner || '—';
        case 'responsible_po': return task.responsible_po_name || '—';
        case 'business_analyst': return task.business_analyst_name || '—';
        case 'it_product_lead': return task.it_product_lead_name || '—';
        case 'key_project': return task.key_project ? '<span class="badge badge-high">Да</span>' : '<span class="badge badge-low">Нет</span>';
        case 'key_project_status': return task.key_project_status || '—';
        case 'directorate_status': return task.directorate_status || '—';
        case 'did_status': return task.did_status || '—';
        case 'is_from_leadership': return task.is_from_leadership ? '<span class="badge badge-warning">Да</span>' : '<span class="badge badge-low">Нет</span>';
        case 'is_regular': return task.is_regular ? '<span class="badge badge-info">Да</span>' : '<span class="badge badge-low">Нет</span>';
        case 'what_if': return task.what_if || '—';
        case 'dod': return task.dod || '—';
        case 'link_mockups': return task.link_mockups ? `<a href="${task.link_mockups}" target="_blank" style="color:var(--accent)">Макеты</a>` : '—';
        case 'link_jira': return task.link_jira ? `<a href="${task.link_jira}" target="_blank" style="color:var(--accent)">Jira</a>` : '—';
        case 'rejection_reason': return task.rejection_reason || '—';
        case 'comment': return task.comment || '—';
        case 'status_comment': return task.status_comment || '—';
        case 'last_updated': return task.last_updated || '—';
        case 'created_at': return task.created_at || '—';
        case 'updated_at': return task.updated_at || '—';
        default: return '';
    }
}

function renderTeamTableRow(task, cols) {
    const cells = cols.map(col => renderTeamCell(col, task));
    return `<tr data-task-id="${task.id}">
        <td><input type="checkbox" class="task-checkbox" value="${task.id}"></td>
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
