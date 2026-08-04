console.log('[DMB] taskTable.js v20260703 loaded');
import { renderToolbar, initToolbar, initToolbarControls, getFilteredList as ftFilteredList, resetToolbarFilters, updateStickyOffsets, initStickyTableHeader } from './filterToolbar.js';
import { renderTaskCard, openTaskModal, setOnTaskSaved, importTasksFromExcel, showConfirmModal, showBulkOpsModal } from './modal.js';
import { buildColumnLabels, buildColumnSettings, getAllColumnKeys } from './taskColumns.js';

let tasksCache = null;
let currentView = 'table';
const DMB_DEFAULT_OVERRIDES = {
  id: true, title: true, status: true, priority: true, team: true,
  progress: true, financial_effect: true, effort_days: true, cv: true,
  deadline: true, owner: false, channel: false,
  department: false, task_type: false,
  key_project_status: false, ice_score: false
};
let COLUMN_LABELS = { ...buildColumnLabels(window.app?.fieldLabels || {}) };
let columnSettings = buildColumnSettings({}, DMB_DEFAULT_OVERRIDES);
let columnOrder = getAllColumnKeys();

let quickEditMode = false;
let quickEditChanges = {};
let quickEditHistory = [];
let quickEditHistoryIndex = -1;
let currentApp = null;

const EDITABLE_FIELDS = {
  text: ['title', 'description', 'what_if', 'dod', 'comment', 'status_comment', 'link_mockups', 'rejection_reason'],
  number: ['effort_days', 'effort_rub', 'effort_designee', 'effort_analytics', 'effort_be', 'effort_fe', 'effort_test', 'effort_test_auto', 'effort_delivery', 'effort_python_be',
    'actual_effort_days', 'actual_effort_designee', 'actual_effort_analytics', 'actual_effort_be', 'actual_effort_fe', 'actual_effort_test', 'actual_effort_test_auto',
    'financial_effect', 'ice_impact', 'ice_confidence', 'ice_ease', 'metric_kr_plan', 'metric_kr_fact'],
  select: ['status_id', 'priority_id', 'team_id', 'deadline_id', 'task_type_id', 'channel_id', 'department_id', 'project_id', 'owner_id', 'responsible_po_id', 'business_analyst_id', 'it_product_lead_id'],
  checkbox: ['key_project', 'is_from_leadership', 'is_regular', 'did_demo'],
  date: ['date_received']
};

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

    <div id="inline-edit-banner" class="hidden" style="display:none;padding:10px 16px;background:var(--accent-light);border:1px solid var(--accent);border-radius:8px;margin-bottom:12px;display:flex;align-items:center;gap:12px;">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--accent);flex-shrink:0;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
      <span style="font-size:13px;color:var(--text-primary);flex:1;">Режим редактирования — значения меняются прямо в таблице. Выбор строк и массовые операции недоступны.</span>
      <button class="btn btn-secondary btn-sm" id="ie-exit" style="white-space:nowrap;">Выйти из режима</button>
    </div>

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

    <div id="inline-edit-bar" class="hidden" style="display:none;position:sticky;bottom:16px;background:var(--text-primary);color:var(--bg-primary);padding:10px 16px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.25);z-index:100;display:flex;align-items:center;gap:12px;margin-top:12px;">
      <button class="btn btn-ghost btn-sm" id="ie-undo" title="Отменить (Ctrl+Z)" disabled style="color:var(--bg-primary);border-color:var(--bg-primary);">↩</button>
      <button class="btn btn-ghost btn-sm" id="ie-redo" title="Вернуть (Ctrl+Y)" disabled style="color:var(--bg-primary);border-color:var(--bg-primary);">↪</button>
      <span id="ie-change-count" style="font-size:13px;color:var(--bg-primary);"></span>
      <span style="flex:1;"></span>
      <span style="font-size:12px;color:var(--text-muted);">Ctrl+S — сохранить · Ctrl+Z — назад · Esc — выйти</span>
      <button class="btn btn-secondary btn-sm" id="ie-cancel-all" style="background:var(--bg-primary);color:var(--text-primary);border-color:var(--bg-primary);">Отменить всё</button>
      <button class="btn btn-primary btn-sm" id="ie-save" style="background:var(--accent);color:white;border:none;">Сохранить</button>
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
    renderCurrentView();
  }

  const tasks = tasksCache?.items || [];
  initToolbar('backlog', tasks, onFilterChange);

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
    onQuickEdit: () => { if (currentView === 'table') { if (quickEditMode) { exitQuickEditMode(); } else { enterQuickEditMode(); } } },
    onBulkOps: () => { if (currentView === 'table') { showBulkOpsModal(app, 'backlog', tasks); } },
  });

  setOnTaskSaved(() => loadTasks(app));

  bindQuickEditEvents();
}

function bindQuickEditEvents() {
  document.getElementById('qe-save')?.addEventListener('click', async () => {
    const changes = getQuickEditChanges();
    const count = Object.keys(changes).length;
    if (count === 0) {
      window.toast?.('Нет изменений для сохранения', 'info');
      return;
    }
    const confirmed = await showConfirmModal(`Будет сохранено ${count} изменений. Продолжить?`, 'Сохранить изменения');
    if (!confirmed) return;
    await saveQuickEditChanges();
  });

  document.getElementById('ie-cancel-all')?.addEventListener('click', async () => {
    if (Object.keys(quickEditChanges).length === 0) {
      exitQuickEditMode();
      return;
    }
    const confirmed = await showConfirmModal('Отменить все изменения? Значения вернутся к исходным. Пошаговый откат будет недоступен.', 'Отменить все изменения?');
    if (!confirmed) return;
    quickEditChanges = {};
    quickEditHistory = [];
    quickEditHistoryIndex = -1;
    updateQuickEditCount();
    renderCurrentView();
  });

  document.getElementById('ie-save')?.addEventListener('click', () => {
    saveChanges();
  });

  document.getElementById('ie-undo')?.addEventListener('click', () => {
    performUndo();
  });

  document.getElementById('ie-redo')?.addEventListener('click', () => {
    performRedo();
  });

  document.getElementById('ie-exit')?.addEventListener('click', () => {
    exitQuickEditMode();
  });

  document.addEventListener('keydown', handleQuickEditKeydown);
}

function handleQuickEditKeydown(e) {
  if (!quickEditMode) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
    if (e.key === 'Escape') {
      exitQuickEditMode();
    }
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z') { e.preventDefault(); performUndo(); return; }
    if (e.key === 'y' || (e.shiftKey && e.key === 'z')) { e.preventDefault(); performRedo(); return; }
    if (e.key === 's') { e.preventDefault(); saveChanges(); return; }
  }
  if (e.key === 'Escape') { exitQuickEditMode(); }
}

function enterQuickEditMode() {
  quickEditMode = true;
  const banner = document.getElementById('inline-edit-banner');
  const bar = document.getElementById('inline-edit-bar');
  const container = document.querySelector('.table-container');
  if (banner) banner.style.display = 'flex';
  if (bar) bar.style.display = 'flex';
  if (container) container.classList.add('ie-editing');
  renderCurrentView();
}

function exitQuickEditMode() {
  quickEditMode = false;
  quickEditChanges = {};
  quickEditHistory = [];
  quickEditHistoryIndex = -1;
  const banner = document.getElementById('inline-edit-banner');
  const bar = document.getElementById('inline-edit-bar');
  const container = document.querySelector('.table-container');
  if (banner) banner.style.display = 'none';
  if (bar) bar.style.display = 'none';
  if (container) container.classList.remove('ie-editing');
  updateQuickEditCount();
  renderCurrentView();
}

function getQuickEditChanges() {
  return quickEditChanges;
}

function updateQuickEditCount() {
  const countEl = document.getElementById('ie-change-count');
  const undoBtn = document.getElementById('ie-undo');
  const redoBtn = document.getElementById('ie-redo');
  const saveBtn = document.getElementById('ie-save');
  if (countEl) {
    const taskCount = Object.keys(quickEditChanges).length;
    const fieldCount = Object.keys(quickEditChanges).reduce((acc, tid) => acc + Object.keys(quickEditChanges[tid]).length, 0);
    countEl.textContent = `Изменено ${fieldCount} ${pluralize(fieldCount, 'значение', 'значения', 'значений')} в ${taskCount} ${pluralize(taskCount, 'задаче', 'задачах', 'задачах')}`;
  }
  if (undoBtn) undoBtn.disabled = quickEditHistoryIndex < 0;
  if (redoBtn) redoBtn.disabled = quickEditHistoryIndex >= quickEditHistory.length - 1;
  if (saveBtn) saveBtn.disabled = Object.keys(quickEditChanges).length === 0;
}

function pluralize(n, one, few, many) {
  const m = Math.abs(n);
  const mod10 = m % 10;
  const mod100 = m % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function recordChange(taskId, field, oldValue, newValue) {
  quickEditHistory = quickEditHistory.slice(0, quickEditHistoryIndex + 1);
  quickEditHistory.push({ taskId, field, oldValue, newValue });
  quickEditHistoryIndex = quickEditHistory.length - 1;
  updateQuickEditCount();
}

function performUndo() {
  if (quickEditHistoryIndex < 0) return;
  const action = quickEditHistory[quickEditHistoryIndex];
  if (quickEditChanges[action.taskId] && quickEditChanges[action.taskId][action.field]) {
    if (quickEditChanges[action.taskId][action.field].oldValue === action.oldValue) {
      delete quickEditChanges[action.taskId][action.field];
      if (Object.keys(quickEditChanges[action.taskId]).length === 0) {
        delete quickEditChanges[action.taskId];
      }
    }
  }
  quickEditHistoryIndex--;
  updateQuickEditCount();
  renderCurrentView();
}

function performRedo() {
  if (quickEditHistoryIndex >= quickEditHistory.length - 1) return;
  quickEditHistoryIndex++;
  const action = quickEditHistory[quickEditHistoryIndex];
  if (!quickEditChanges[action.taskId]) quickEditChanges[action.taskId] = {};
  quickEditChanges[action.taskId][action.field] = { oldValue: action.oldValue, newValue: action.newValue };
  updateQuickEditCount();
  renderCurrentView();
}

async function saveChanges() {
  const changes = getQuickEditChanges();
  const taskCount = Object.keys(changes).length;
  if (taskCount === 0) {
    window.toast?.('Нет изменений для сохранения', 'info');
    return;
  }
  const saveBtn = document.getElementById('ie-save');
  if (saveBtn) {
    saveBtn.textContent = 'Сохраняю…';
    saveBtn.disabled = true;
  }
  let saved = 0;
  let errors = 0;
  const taskList = tasksCache?.items || [];
  for (const [taskId, fields] of Object.entries(changes)) {
    const task = taskList.find(t => t.id == taskId);
    if (!task) continue;
    const data = {};
    for (const [field, changes] of Object.entries(fields)) {
      data[field] = changes.newValue;
    }
    data.version = task.version;
    try {
      await currentApp.api.put(`/tasks/${taskId}`, data);
      saved++;
    } catch (e) {
      errors++;
      console.error(`Failed to save task ${taskId}:`, e);
    }
  }
  if (saveBtn) {
    saveBtn.textContent = 'Сохранить';
    saveBtn.disabled = false;
  }
  if (errors > 0) {
    window.toast?.(`Сохранено: ${saved}, ошибок: ${errors}`, errors > 0 ? 'warning' : 'success');
  } else {
    window.toast?.(`Сохранено ${saved} ${pluralize(saved, 'задача', 'задачи', 'задач')}`, 'success');
  }
  quickEditChanges = {};
  quickEditHistory = [];
  quickEditHistoryIndex = -1;
  exitQuickEditMode();
  await loadTasks(currentApp);
}

async function saveQuickEditChanges() {
  const tasks = tasksCache?.items || [];
  let saved = 0;
  let errors = 0;

  for (const [taskId, fields] of Object.entries(quickEditChanges)) {
    const task = tasks.find(t => t.id == taskId);
    if (!task) continue;
    const data = {};
    for (const [field, changes] of Object.entries(fields)) {
      data[field] = changes.newValue;
    }
    data.version = task.version;

    try {
      await currentApp.api.put(`/tasks/${taskId}`, data);
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

  exitQuickEditMode();
  await loadTasks(currentApp);
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

  if (!quickEditMode) {
    document.getElementById('tasks-tbody')?.querySelectorAll('tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const t = list.find(x => x.id == tr.dataset.taskId);
        if (t) openTaskModal(t);
      });
    });
  }

  bindQuickEditCellListeners();
}

function isEditableField(col) {
  return EDITABLE_FIELDS.text.includes(col) ||
         EDITABLE_FIELDS.number.includes(col) ||
         EDITABLE_FIELDS.select.includes(col) ||
         EDITABLE_FIELDS.checkbox.includes(col) ||
         EDITABLE_FIELDS.date.includes(col);
}

function renderEditableCell(col, task) {
  const taskId = task.id;
  const field = col;
  const currentValue = task[col];
  const change = quickEditChanges[taskId]?.[field];
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
    return renderSelectForEdit(col, taskId, field, value, currentValue, isChanged, bgStyle);
  }
  return renderCell(col, task);
}

function renderSelectForEdit(col, taskId, field, value, currentValue, isChanged, bgStyle) {
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

function renderCell(col, task) {
  if (quickEditMode && isEditableField(col)) {
    return renderEditableCell(col, task);
  }

  const taskId = task.id;
  const change = quickEditChanges[taskId]?.[col];
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
    case 'involved_teams': return `<span style="${bgStyle}">${task.involved_teams || '—'}</span>`;
    case 'deadline': return `<span style="${bgStyle}">${task.deadline_name || task.deadline || '—'}</span>`;
    case 'deadline_po': return `<span style="${bgStyle}">${task.deadline_po_name || '—'}</span>`;
    case 'effort_days': return `<span style="${bgStyle}">${task.effort_days != null ? task.effort_days + ' дн' : '—'}</span>`;
    case 'effort_rub': return `<span class="font-mono" style="${bgStyle}">${metricFormat(task.effort_rub)}</span>`;
    case 'financial_effect': return `<span class="font-mono" style="${bgStyle}">${metricFormat(task.financial_effect)}</span>`;
    case 'cv': return `<span style="${bgStyle}">${renderCV(task)}</span>`;
    case 'ice_score': return `<span style="${bgStyle}">${task.ice_score != null ? task.ice_score.toFixed(1) : '—'}</span>`;
    case 'progress': return `<span style="${bgStyle}">${renderProgress(task.progress)}</span>`;
    case 'owner': return `<span style="${bgStyle}">${task.owner_name || task.owner || '—'}</span>`;
    case 'responsible_po': return `<span style="${bgStyle}">${task.responsible_po_name || '—'}</span>`;
    case 'business_analyst': return `<span style="${bgStyle}">${task.business_analyst_name || '—'}</span>`;
    case 'it_product_lead': return `<span style="${bgStyle}">${task.it_product_lead_name || '—'}</span>`;
    case 'key_project': return `<span style="${bgStyle}">${task.key_project ? '<span class="badge badge-high">Да</span>' : '<span class="badge badge-low">Нет</span>'}</span>`;
    case 'key_project_status': return `<span style="${bgStyle}">${task.key_project_status || '—'}</span>`;
    case 'directorate_status': return `<span style="${bgStyle}">${task.directorate_status || '—'}</span>`;
    case 'did_status': return `<span style="${bgStyle}">${task.did_status || '—'}</span>`;
    case 'is_from_leadership': return `<span style="${bgStyle}">${task.is_from_leadership ? '<span class="badge badge-warning">Да</span>' : '<span class="badge badge-low">Нет</span>'}</span>`;
    case 'is_regular': return `<span style="${bgStyle}">${task.is_regular ? '<span class="badge badge-info">Да</span>' : '<span class="badge badge-low">Нет</span>'}</span>`;
    case 'what_if': return `<span style="${bgStyle}">${task.what_if || '—'}</span>`;
    case 'dod': return `<span style="${bgStyle}">${task.dod || '—'}</span>`;
    case 'link_mockups': return `<span style="${bgStyle}">${task.link_mockups ? `<a href="${task.link_mockups}" target="_blank" style="color:var(--accent)">Макеты</a>` : '—'}</span>`;
    case 'link_jira': return `<span style="${bgStyle}">${task.link_jira ? `<a href="${task.link_jira}" target="_blank" style="color:var(--accent)">Jira</a>` : '—'}</span>`;
    case 'rejection_reason': return `<span style="${bgStyle}">${task.rejection_reason || '—'}</span>`;
    case 'comment': return `<span style="${bgStyle}">${task.comment || '—'}</span>`;
    case 'status_comment': return `<span style="${bgStyle}">${task.status_comment || '—'}</span>`;
    case 'last_updated': return `<span style="${bgStyle}">${task.last_updated || '—'}</span>`;
    case 'created_at': return `<span style="${bgStyle}">${task.created_at || '—'}</span>`;
    case 'updated_at': return `<span style="${bgStyle}">${task.updated_at || '—'}</span>`;
    default: return '';
  }
}

function renderTableRow(task, cols) {
  const cells = cols.map(col => renderCell(col, task));
  const hasChanges = quickEditChanges[task.id] && Object.keys(quickEditChanges[task.id]).length > 0;
  const rowStyle = hasChanges ? 'cursor:pointer;background:rgba(245,158,11,0.1);' : (quickEditMode ? 'cursor:default;' : 'cursor:pointer;');
  return `<tr data-task-id="${task.id}" style="${rowStyle}">${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function bindQuickEditCellListeners() {
  if (!quickEditMode) return;

  document.querySelectorAll('[data-task][data-field]').forEach(el => {
    const handler = (e) => {
      const taskId = parseInt(el.dataset.task);
      const field = el.dataset.field;
      const original = el.dataset.original;
      let newValue = el.type === 'checkbox' ? el.checked : el.value;
      let oldValue = original;

      if (el.type === 'checkbox') {
        oldValue = original === 'true';
      } else if (el.type === 'number') {
        newValue = newValue !== '' ? parseFloat(newValue) : null;
        oldValue = original !== '' ? parseFloat(original) : null;
      }

      if (String(newValue) === String(oldValue)) {
        if (quickEditChanges[taskId] && quickEditChanges[taskId][field]) {
          delete quickEditChanges[taskId][field];
          if (Object.keys(quickEditChanges[taskId]).length === 0) {
            delete quickEditChanges[taskId];
          }
        }
      } else {
        if (!quickEditChanges[taskId]) quickEditChanges[taskId] = {};
        quickEditChanges[taskId][field] = { oldValue, newValue };
        recordChange(taskId, field, oldValue, newValue);
      }

      if (!quickEditMode) return;
      const row = el.closest('tr');
      if (row) {
        const taskId = parseInt(row.dataset.taskId);
        if (quickEditChanges[taskId] && Object.keys(quickEditChanges[taskId]).length > 0) {
          row.style.background = 'rgba(245, 158, 11, 0.1)';
        } else {
          row.style.background = '';
        }
      }
    };

    el.removeEventListener('change', handler);
    el.removeEventListener('input', handler);
    el.addEventListener('change', handler);
    el.addEventListener('input', handler);
  });
}

export function setQuickEditMode(mode) {
  if (mode === quickEditMode) return;
  if (mode) {
    enterQuickEditMode();
  } else {
    exitQuickEditMode();
  }
}

export function getQuickEditMode() {
  return quickEditMode;
}
