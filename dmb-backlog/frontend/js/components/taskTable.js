console.log('[DMB] taskTable.js v20260626.5 loaded');
import { renderToolbar, initToolbar, initToolbarControls, getFilteredList as ftFilteredList, resetToolbarFilters, updateStickyOffsets, initStickyTableHeader } from './filterToolbar.js';
import { renderTaskCard, openTaskModal, setOnTaskSaved } from './modal.js';

let tasksCache = null;
let currentView = 'table';
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
const DEFAULT_COLUMN_SETTINGS = {
  id: true, title: true, status: true, priority: true, team: true,
  progress: true, financial_effect: true, effort_days: true, cv: true,
  deadline: true, owner: false, channel: false,
  department: false, task_type: false,
  key_project_status: false, ice_score: false
};
let columnSettings = { ...DEFAULT_COLUMN_SETTINGS };
let columnOrder = Object.keys(columnSettings);

export function renderTasksPage(app) {
  return `
    ${renderToolbar('backlog', {
      title: 'Бэклог DMB',
      subtitle: 'Все задачи платформы',
      columnSettings,
      columnOrder,
      columnLabels: COLUMN_LABELS,
    })}

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
    const resp = await app.api.get('/admin/display-settings/backlog_dmb');
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
        Object.keys(DEFAULT_COLUMN_SETTINGS).forEach(key => {
          if (!(key in newSettings)) newSettings[key] = DEFAULT_COLUMN_SETTINGS[key];
        });
        columnSettings = newSettings;
        columnOrder = Object.keys(columnSettings);
      }
    }
  } catch (e) {
    console.log('[DMB] No display settings, using defaults');
  }
}

async function fetchColumnLabels(app) {
  try {
    const labels = await app.api.get('/admin/column-labels');
    if (labels && typeof labels === 'object') {
      Object.keys(labels).forEach(key => { if (labels[key]) COLUMN_LABELS[key] = labels[key]; });
    }
  } catch (e) {
    // use defaults
  }
}

export async function initTasksPage(app) {
  await fetchColumnLabels(app);
  await applyDefaultDisplaySettings(app);
  await loadTasks(app);

  function onFilterChange() {
    renderCurrentView();
  }

  const tasks = tasksCache?.items || [];
  initToolbar('backlog', tasks, onFilterChange);

  initToolbarControls('backlog', {
    columnSettings,
    columnOrder,
    columnLabels: COLUMN_LABELS,
    onViewChange: (view) => { currentView = view; renderCurrentView(); },
    onColumnChange: () => renderCurrentView(),
    onColumnOrderChange: () => renderCurrentView(),
    onExport: () => { const list = getFilteredList(); exportExcel(list); },
    onRefresh: () => loadTasks(app),
  });

  setOnTaskSaved(() => loadTasks(app));
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

function getColumnLabel(key) {
  return COLUMN_LABELS[key] || key;
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
  return ftFilteredList('backlog', tasksCache.items || []);
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

  container.innerHTML = `
    <div class="table-container" style="overflow-x:auto;">
      <table class="table" id="tasks-table">
        <thead>
          <tr>
            ${visibleCols.map(col => {
              const sortable = ['id', 'priority', 'deadline', 'progress', 'financial_effect', 'effort_days', 'cv'];
              const icon = sortable.includes(col) ? ' <span class="sort-icon">↕</span>' : '';
              return `<th data-sort="${col}">${getColumnLabel(col)}${icon}</th>`;
            }).join('')}
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

  updateStickyOffsets();
  initStickyTableHeader('tasks-table');

  document.getElementById('tasks-tbody')?.querySelectorAll('tr').forEach(tr => {
    tr.addEventListener('click', () => {
      const t = list.find(x => x.id == tr.dataset.taskId);
      if (t) openTaskModal(t);
    });
  });
}

function renderCell(col, task) {
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

function renderTableRow(task, cols) {
  const cells = cols.map(col => renderCell(col, task));
  return `<tr data-task-id="${task.id}" style="cursor:pointer">${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
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

function renderTags(task) {
  if (!task.tags) return '—';
  return task.tags.split(',').map(t => t.trim()).filter(Boolean).map(t =>
    `<span class="badge badge-info" style="font-size:10px;">${t}</span>`
  ).join(' ');
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
