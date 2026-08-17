console.log('[DMB] filterToolbar.js v20260804.2 loaded');
const columnFilters = { backlog: {}, team: {} };
const sortValues = { backlog: 'id-desc', team: 'id-desc' };
const searchValues = { backlog: '', team: '' };
const filterChangeCallbacks = {};
const allTasksCache = { backlog: [], team: [] };
const columnSettingsRefs = { backlog: null, team: null };
const columnOrderRefs = { backlog: null, team: null };
const defaultColumnSettingsRefs = { backlog: null, team: null };

const directoryCache = {};
const directoryLoading = {};

const PERMISSION_LEVELS = { 'none': 0, 'read': 1, 'read_own': 1, 'write_own': 2, 'read_write': 2, 'write_all': 3 };

function hasWritePermission(scope) {
  return true; // TODO: enable permission check when backend returns permissions
  // const perms = window.app?.store?.get('currentUser')?.permissions || {};
  // const backlogLevel = PERMISSION_LEVELS[perms.backlog_dmb] || 0;
  // const teamLevel = PERMISSION_LEVELS[perms.backlog_team] || 0;
  // if (scope === 'backlog') { return backlogLevel >= 2; }
  // return teamLevel >= 2;
}

const columnDirectoryMap = {
  status_name: { url: '/admin/statuses', labelField: 'name' },
  priority_name: { url: '/admin/priorities', labelField: 'name' },
  task_type_name: { url: '/admin/task-types', labelField: 'name' },
  channel_name: { url: '/admin/channels', labelField: 'name' },
  deadline_name: { url: '/admin/deadlines', labelField: 'name' },
  department_name: { url: '/admin/departments', labelField: 'name' },
  team_name: { url: '/admin/teams', labelField: 'name' },
  project_name: { url: '/admin/projects', labelField: 'name' },
  owner_name: { url: '/admin/users', labelField: 'name' },
  business_customer: { url: '/admin/business-customers', labelField: 'name' },
};

async function loadDirectories() {
  const entries = Object.entries(columnDirectoryMap);
  const results = await Promise.allSettled(entries.map(async ([colKey, info]) => {
    if (directoryCache[colKey]) return;
    const resp = await fetch(`/api/v1${info.url}`);
    if (!resp.ok) throw new Error(`Failed to load ${info.url}`);
    const data = await resp.json();
    const items = data.map(item => ({ value: String(item[info.labelField]), label: String(item[info.labelField]) }));
    directoryCache[colKey] = items;
  }));
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.warn(`[DMB] Failed to load directory for ${entries[i][0]}:`, r.reason);
  });
}

const filterableColumns = [
  { key: 'status_name', label: 'Статус', columnKey: 'status_name' },
  { key: 'priority_name', label: 'Приоритет', columnKey: 'priority_name' },
  { key: 'team_name', label: 'Команда', columnKey: 'team_name' },
  { key: 'project_name', label: 'Проект', columnKey: 'project_name' },
  { key: 'task_type_name', label: 'Тип задачи', columnKey: 'task_type_name' },
  { key: 'deadline_name', label: 'Срок выполнения', columnKey: 'deadline_name' },
  { key: 'owner_name', label: 'Владелец', columnKey: 'owner_name' },
  { key: 'business_customer', label: 'Заказчик', columnKey: 'business_customer' },
  { key: 'channel_name', label: 'Канал', columnKey: 'channel_name' },
  { key: 'department_name', label: 'Подразделение', columnKey: 'department_name' },
  { key: 'key_project_status', label: 'Статус ключ. проектов', columnKey: 'key_project_status' },
  { key: 'directorate_status', label: 'Статус для директорской' },
  { key: 'did_status', label: 'Статус для ДИД' },
  { key: 'date_received', label: 'Дата получения' },
  { key: 'involved_teams', label: 'Вовлечённые команды' },
];

const priorityWeight = { 'ВЫСОКИЙ': 3, 'СРЕДНИЙ': 2, 'НИЗКИЙ': 1 };

function isDeadlinePast(deadlineName) {
  if (!deadlineName) return false;
  const m = deadlineName.match(/^(\d)Q\s*(\d{4})$/i);
  if (!m) return false;
  const q = parseInt(m[1]);
  const y = parseInt(m[2]);
  const now = new Date();
  const curYear = now.getFullYear();
  const curQuarter = Math.floor(now.getMonth() / 3) + 1;
  return y < curYear || (y === curYear && q < curQuarter);
}

function isCurrentTask(task) {
  if (!task || !task.deadline_name) return false;
  const now = new Date();
  const curYear = now.getFullYear();
  const curQuarter = Math.floor(now.getMonth() / 3) + 1;
  if (task.deadline_name === `${curQuarter}Q ${curYear}`) return true;
  if (curQuarter === 4 && task.deadline_name === `Y${curYear}`) return true;
  return false;
}

function isLastQuarterTask(task) {
  if (!task || !task.deadline_name) return false;
  const now = new Date();
  const curYear = now.getFullYear();
  const curQuarter = Math.floor(now.getMonth() / 3) + 1;

  if (curQuarter === 1) {
    const prevYear = curYear - 1;
    const lastQ = `4Q ${prevYear}`;
    const yearDeadline = `Y${curYear}`;
    return task.deadline_name === lastQ || task.deadline_name === yearDeadline;
  } else {
    const prevQuarter = curQuarter - 1;
    const prevYear = curYear;
    const expected = `${prevQuarter}Q ${prevYear}`;
    return task.deadline_name === expected;
  }
}

function $(id) {
  const el = document.getElementById(id);
  return el;
}

function getUniqueValues(scope, key, allTasks) {
  if (directoryCache[key]) {
    return directoryCache[key];
  }

  let list = allTasks;

  const cf = columnFilters[scope];
  const terminalStatuses = ['ВЫПОЛНЕНА', 'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА'];

  if (cf) {
    Object.keys(cf).forEach(fk => {
      if (fk === key) return;
      const vals = cf[fk];
      if (vals && vals.size > 0) {
        if (fk === '_overdue') {
          list = list.filter(t => t.deadline_id != null && !terminalStatuses.includes(t.status_name) && isDeadlinePast(t.deadline_name));
          return;
        }
        if (fk === '_urgent') {
          list = list.filter(t => t.priority_name === 'ВЫСОКИЙ');
          return;
        }
        if (fk === '_current') {
          list = list.filter(isCurrentTask);
          return;
        }
        if (fk === '_last_quarter') {
          list = list.filter(isLastQuarterTask);
          return;
        }
        if (fk === '_active') {
          list = list.filter(t => !!t.status_name && !terminalStatuses.includes(t.status_name) && t.status_name !== 'ХОЛД');
          return;
        }
        if (fk === '_hold') {
          list = list.filter(t => t.status_name === 'ХОЛД');
          return;
        }
        if (fk === '_rejected') {
          list = list.filter(t => t.status_name === 'ОТКЛОНЕНА');
          return;
        }
        if (fk === '_high_cv') {
          list = list.filter(t => t.financial_effect != null && t.effort_rub > 0 && (t.financial_effect / t.effort_rub) > 1);
          return;
        }
        list = list.filter(t => {
          let v = t[fk];
          if (fk === 'progress') {
            if (vals.has('0-25')) return (v || 0) <= 25;
            if (vals.has('25-50')) return (v || 0) > 25 && (v || 0) <= 50;
            if (vals.has('50-75')) return (v || 0) > 50 && (v || 0) <= 75;
            if (vals.has('75-100')) return (v || 0) > 75;
            return true;
          }
          if (fk === 'tags') {
            const taskTags = Array.isArray(v)
              ? v.map(x => typeof x === 'object' && x !== null ? String(x.name || '') : String(x)).filter(Boolean)
              : String(v).split(',').map(s => s.trim());
            return taskTags.some(tag => vals.has(tag));
          }
          if (fk === 'involved_teams' && typeof v === 'string') {
            const teams = v.split(',').map(s => s.trim());
            return teams.some(tm => vals.has(tm));
          }
          return v != null && vals.has(String(v));
        });
      }
    });
  }

  const unique = new Set();
  list.forEach(t => {
    let v = t[key];
    if (v == null || v === '') return;
    if (key === 'tags') {
      const arr = Array.isArray(v)
        ? v.map(x => typeof x === 'object' && x !== null ? String(x.name || '') : String(x)).filter(Boolean)
        : String(v).split(',').map(s => s.trim()).filter(Boolean);
      arr.forEach(tag => unique.add(tag));
    } else if (key === 'involved_teams' && typeof v === 'string') {
      v.split(',').map(s => s.trim()).filter(Boolean).forEach(tm => unique.add(tm));
    } else {
      unique.add(key === 'team_name' ? v : String(v));
    }
  });

  return [...unique].sort().map(v => ({ value: v, label: v }));
}

export function renderToolbar(scope, opts = {}) {
  const colOpts = opts.columnSettings || {};
  const colLabels = opts.columnLabels || {};
  const colOrder = opts.columnOrder || Object.keys(colOpts);
  const getLabel = (k) => colLabels[k] || k;

  const viewToggleHtml = `
    <div class="view-toggle" id="${scope}-view-toggle-group">
      <button class="toggle-btn active" data-view="table">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line></svg>
      </button>
      <button class="toggle-btn" data-view="cards">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
      </button>
    </div>`;

  const columnSettingsHtml = `
    <div class="relative" id="${scope}-column-settings-wrapper">
      <button class="btn btn-secondary btn-sm square-icon" id="${scope}-btn-column-settings" title="Столбцы">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
      </button>
      <div class="column-settings-dropdown" id="${scope}-column-settings-dropdown" style="display:none;position:absolute;right:0;top:100%;z-index:100;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:10px;padding:0;min-width:380px;max-height:420px;box-shadow:0 8px 24px rgba(0,0,0,0.25);margin-top:6px;">
        <div style="padding:10px 10px 6px 10px;background:var(--bg-primary);position:sticky;top:0;z-index:1;border-radius:10px 10px 0 0;">
          <div class="text-sm font-semibold mb-2" style="color:var(--text-primary);padding:4px 6px;">Колонки</div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-ghost btn-sm" id="${scope}-col-select-all" style="flex:1;font-size:11px;padding:4px 8px;">Выбрать все</button>
            <button class="btn btn-ghost btn-sm" id="${scope}-col-default" style="flex:1;font-size:11px;padding:4px 8px;">Стандартный вид</button>
            <button class="btn btn-ghost btn-sm" id="${scope}-col-clear-all" style="flex:1;font-size:11px;padding:4px 8px;">Очистить все</button>
          </div>
        </div>
        <div class="column-settings-list" id="${scope}-column-settings-list" style="display:flex;flex-wrap:wrap;gap:4px;padding:6px 10px 10px 10px;overflow-y:auto;max-height:340px;">
          ${colOrder.map(key => {
            const val = colOpts[key];
            if (val === undefined) return '';
            return `<div class="col-drag-item" draggable="true" data-col="${key}" style="display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:4px;cursor:grab;font-size:12px;color:var(--text-primary);user-select:none;border:1px solid transparent;width:calc(50% - 2px);box-sizing:border-box;">
              <span style="cursor:grab;color:var(--text-muted);display:flex;align-items:center;opacity:0.5;" class="col-drag-handle">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="16" y2="6"></line><line x1="8" y1="12" x2="16" y2="12"></line><line x1="8" y1="18" x2="16" y2="18"></line></svg>
              </span>
              <input type="checkbox" data-col="${key}" ${val ? 'checked' : ''} style="margin:0;flex-shrink:0;">
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${getLabel(key)}</span>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;

  const addTaskHtml = opts.addTask ? `<button class="btn btn-primary btn-sm" id="${scope}-add-task-btn"><i data-lucide="plus" style="width:15px;height:15px;flex-shrink:0;"></i> Добавить задачу</button>` : '';

  const title = opts.title || '';
  const subtitle = opts.subtitle || '';
  const canWrite = hasWritePermission(scope);

  const bulkOpsBtn = (canWrite && opts.onBulkOps) ? `<button class="btn btn-secondary btn-sm square-icon qe-toggle" id="${scope}-bulk-open" title="Массовые операции" style="white-space:nowrap;flex-shrink:0;"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg></button>` : '';

  const quickEditBtn = (canWrite && opts.onQuickEdit) ? `<button class="btn btn-secondary btn-sm square-icon qe-toggle" id="${scope}-inline-edit" title="Быстрое редактирование" style="white-space:nowrap;flex-shrink:0;"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>` : '';

  const importBtn = (canWrite && opts.onImport) ? `<button class="btn btn-secondary btn-sm square-icon" id="${scope}-import-excel" title="Импорт из Excel"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></button>` : '';

  const hasActions = !!(addTaskHtml || bulkOpsBtn || quickEditBtn || importBtn || opts.viewToggle !== false || opts.columnSettings || opts.excel !== false || opts.refresh !== false);

  const actionsHtml = hasActions ? `
    <div class="toolbar-actions">
      ${addTaskHtml}
      ${bulkOpsBtn}
      ${quickEditBtn}
      ${opts.viewToggle !== false ? viewToggleHtml : ''}
      ${opts.columnSettings ? columnSettingsHtml : ''}
      ${opts.excel !== false ? `<button class="btn btn-secondary btn-sm square-icon" id="${scope}-export-excel" title="Экспорт в CSV"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>` : ''}
      ${importBtn}
      ${opts.refresh !== false ? `<button class="btn btn-secondary btn-sm square-icon" id="${scope}-btn-refresh" title="Обновить"><i data-lucide="refresh-ccw" style="width:15px;height:15px;"></i></button>` : ''}
    </div>` : '';

  return `
    <div class="sticky-toolbar" data-version="3">
      <div style="display:flex;flex-direction:column;gap:var(--space-2);">
        <div class="toolbar-title-row">
          ${title ? `
          <div class="toolbar-title-wrap">
            <h2 class="toolbar-title">${title}</h2>
            ${subtitle ? `<p class="toolbar-subtitle">${subtitle}</p>` : ''}
          </div>` : ''}
          ${actionsHtml}
        </div>
        <div class="filter-panel">
          <div class="flex items-center gap-2 filter-toolbar-row">
            <div class="relative filter-search-wrap" style="flex:1;min-width:0;">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);color:var(--text-muted);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input id="f-${scope}-search" placeholder="Поиск..." style="width:100%;padding:6px 8px 6px 28px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-color);border-radius:8px;font-size:12px;">
            </div>
            <div id="f-${scope}-main-filters" class="flex items-center gap-2" style="flex:1;min-width:0;"></div>
            <button id="btn-ext-${scope}" class="btn btn-secondary btn-sm" style="font-size:12px;display:flex;align-items:center;gap:4px;flex-shrink:0;padding:7px 10px;min-height:32px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
              <span id="btn-ext-${scope}-text">Фильтры</span>
              <svg id="chev-ext-${scope}" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            <button id="f-${scope}-reset" class="btn btn-secondary btn-sm" style="font-size:12px;display:flex;align-items:center;gap:4px;flex-shrink:0;padding:7px 10px;min-height:32px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
              Сброс
            </button>
          </div>
          <div id="f-${scope}-ext-filters" class="hidden" style="margin-top:6px;padding-top:6px;border-top:1px dashed var(--border-color);">
            <div id="f-${scope}-ext-row" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px;"></div>
          </div>
        </div>
        <div id="f-${scope}-active-filters" class="active-filters-row"></div>
        ${opts.quickFilters || ''}
      </div>
    </div>
  `;
}

export function initToolbarControls(scope, opts = {}) {
  const {
    columnSettings,
    columnLabels = {},
    columnOrder,
    defaultColumnSettings,
    onViewChange,
    onExport,
    onImport,
    onRefresh,
    onAddTask,
    onColumnChange,
    onColumnOrderChange,
    onQuickEdit,
    onBulkOps,
  } = opts;

  columnSettingsRefs[scope] = columnSettings;
  columnOrderRefs[scope] = columnOrder;
  defaultColumnSettingsRefs[scope] = defaultColumnSettings || null;

  const getLabel = (k) => columnLabels[k] || k;

  const viewGroup = document.getElementById(`${scope}-view-toggle-group`);
  if (viewGroup) {
    viewGroup.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        viewGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (onViewChange) onViewChange(btn.dataset.view);
      });
    });
  }

  const colBtn = document.getElementById(`${scope}-btn-column-settings`);
  const colDropdown = document.getElementById(`${scope}-column-settings-dropdown`);
  const colList = document.getElementById(`${scope}-column-settings-list`);
  if (colBtn && colDropdown) {
    colBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      colDropdown.style.display = colDropdown.style.display === 'none' ? 'block' : 'none';
    });

    function onColCheckChange(e) {
      const cb = e.target;
      const col = cb.dataset.col;
      if (columnSettings && col) columnSettings[col] = cb.checked;
      renderFilterButtons(scope, allTasksCache[scope]);
      if (onColumnChange) onColumnChange();
    }

    colDropdown.addEventListener('change', (e) => {
      if (e.target.matches('input[type="checkbox"]')) {
        onColCheckChange(e);
      }
    });

    if (colList && columnSettings) {
      colList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = !!columnSettings[cb.dataset.col];
      });
    }

    document.addEventListener('click', (e) => {
      if (!colBtn.contains(e.target) && !colDropdown.contains(e.target)) {
        colDropdown.style.display = 'none';
      }
    });

    const selectAllBtn = document.getElementById(`${scope}-col-select-all`);
    const clearAllBtn = document.getElementById(`${scope}-col-clear-all`);
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', () => {
        colDropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          cb.checked = true;
          const col = cb.dataset.col;
          if (columnSettings) columnSettings[col] = true;
        });
        renderFilterButtons(scope, allTasksCache[scope]);
        if (onColumnChange) onColumnChange();
      });
    }
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        colDropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          cb.checked = false;
          const col = cb.dataset.col;
          if (columnSettings) columnSettings[col] = false;
        });
        renderFilterButtons(scope, allTasksCache[scope]);
        if (onColumnChange) onColumnChange();
      });
    }

    const defaultBtn = document.getElementById(`${scope}-col-default`);
    if (defaultBtn) {
      defaultBtn.addEventListener('click', () => {
        const defaults = defaultColumnSettingsRefs[scope];
        if (!defaults) return;
        colDropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          const col = cb.dataset.col;
          const isDefault = defaults[col] === true;
          cb.checked = isDefault;
          if (columnSettings) columnSettings[col] = isDefault;
        });
        renderFilterButtons(scope, allTasksCache[scope]);
        if (onColumnChange) onColumnChange();
      });
    }

    if (colList && columnOrder) {
      let dragSrc = null;
      colList.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.col-drag-item');
        if (!item) return;
        dragSrc = item;
        item.style.opacity = '0.5';
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
      });
      colList.addEventListener('dragend', (e) => {
        const item = e.target.closest('.col-drag-item');
        if (item) item.style.opacity = '';
        dragSrc = null;
        colList.querySelectorAll('.col-drag-item').forEach(el => {
          el.style.borderColor = 'transparent';
          el.style.background = '';
        });
      });
      colList.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const target = e.target.closest('.col-drag-item');
        if (!target || target === dragSrc) return;
        const rect = target.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        target.style.borderColor = e.clientY < midY ? 'var(--accent)' : 'var(--accent)';
        target.style.background = 'color-mix(in srgb, var(--accent) 10%, transparent)';
      });
      colList.addEventListener('dragleave', (e) => {
        const target = e.target.closest('.col-drag-item');
        if (target) {
          target.style.borderColor = 'transparent';
          target.style.background = '';
        }
      });
      colList.addEventListener('drop', (e) => {
        e.preventDefault();
        const target = e.target.closest('.col-drag-item');
        if (!target || !dragSrc || target === dragSrc) return;
        colList.querySelectorAll('.col-drag-item').forEach(el => {
          el.style.borderColor = 'transparent';
          el.style.background = '';
        });
        const srcIdx = Array.from(colList.children).indexOf(dragSrc);
        const tgtIdx = Array.from(colList.children).indexOf(target);
        const rect = target.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const insertBefore = e.clientY < midY;
        if (insertBefore) {
          if (srcIdx < tgtIdx) {
            colList.insertBefore(dragSrc, target.nextSibling);
          } else {
            colList.insertBefore(dragSrc, target);
          }
        } else {
          if (srcIdx > tgtIdx) {
            colList.insertBefore(dragSrc, target);
          } else {
            colList.insertBefore(dragSrc, target.nextSibling);
          }
        }
        const newOrder = Array.from(colList.querySelectorAll('.col-drag-item')).map(el => el.dataset.col);
        columnOrder.length = 0;
        newOrder.forEach(k => columnOrder.push(k));
        if (onColumnOrderChange) onColumnOrderChange();
      });

    }
  }

  document.getElementById(`${scope}-export-excel`)?.addEventListener('click', () => {
    if (onExport) onExport();
  });

  document.getElementById(`${scope}-import-excel`)?.addEventListener('click', () => {
    if (onImport) onImport();
  });

  document.getElementById(`${scope}-btn-refresh`)?.addEventListener('click', () => {
    if (onRefresh) onRefresh();
  });

  document.getElementById(`${scope}-add-task-btn`)?.addEventListener('click', () => {
    if (onAddTask) onAddTask();
  });

  document.getElementById(`${scope}-inline-edit`)?.addEventListener('click', () => {
    if (onQuickEdit) onQuickEdit();
  });

  document.getElementById(`${scope}-bulk-open`)?.addEventListener('click', () => {
    if (onBulkOps) onBulkOps();
  });

  const qeToggles = document.querySelectorAll(`.qe-toggle`);
  const activeTableBtn = viewGroup?.querySelector('.toggle-btn.active[data-view="table"]');
  const isTableView = !!(activeTableBtn);

  if (qeToggles.length > 0) {
    qeToggles.forEach(btn => {
      btn.style.display = isTableView ? '' : 'none';
    });
  }

  if (viewGroup) {
    viewGroup.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const isTable = btn.dataset.view === 'table';
        qeToggles.forEach(b => b.style.display = isTable ? '' : 'none');
      });
    });
  }
}

export function initToolbar(scope, allTasks, onFilterChange) {
  filterChangeCallbacks[scope] = onFilterChange;
  allTasksCache[scope] = allTasks;

  loadDirectories().then(() => { renderFilterButtons(scope, allTasks); });

  function renderAll() {
    renderFilterButtons(scope, allTasks);
    onFilterChange();
    updateStickyOffsets();
  }

  function applySearchSort() {
    // Не вызываем renderFilterButtons, чтобы не уничтожать открытые дропдауны
    onFilterChange();
    updateStickyOffsets();
  }

  const searchInput = $(`f-${scope}-search`);

  let searchTimer;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchValues[scope] = searchInput.value;
      applySearchSort();
    }, 250);
  });

  $(`f-${scope}-reset`)?.addEventListener('click', () => {
    columnFilters[scope] = {};
    searchValues[scope] = '';
    sortValues[scope] = 'id-desc';
    if (searchInput) searchInput.value = '';
    renderAll();
  });

  $(`btn-ext-${scope}`)?.addEventListener('click', () => {
    const ext = $(`f-${scope}-ext-filters`);
    const chev = $(`chev-ext-${scope}`);
    if (!ext) return;
    ext.classList.toggle('hidden');
    if (chev) {
      chev.innerHTML = ext.classList.contains('hidden')
        ? '<polyline points="6 9 12 15 18 9"></polyline>'
        : '<polyline points="18 15 12 9 6 15"></polyline>';
    }
    updateStickyOffsets();
  });

  document.addEventListener('click', (e) => {
    const dd = e.target.closest('.filter-dropdown');
    if (!dd && !e.target.closest('.filter-cell')) {
      document.querySelectorAll('.filter-dropdown').forEach(d => d.remove());
    }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderFilterButtons(scope, allTasks);
    }, 150);
  });

  renderFilterButtons(scope, allTasks);
}

export function getFilteredList(scope, allTasks) {
  if (!allTasks || !allTasks.length) return [];
  let list = [...allTasks];

  const q = searchValues[scope] ? searchValues[scope].toLowerCase() : '';
  if (q) {
    list = list.filter(t =>
      (t.title && t.title.toLowerCase().includes(q)) ||
      String(t.id).includes(q) ||
      (t.project && t.project.toLowerCase().includes(q)) ||
      (t.description && t.description.toLowerCase().includes(q)) ||
      (t.owner && t.owner.toLowerCase().includes(q)) ||
      (t.team_name && t.team_name.toLowerCase().includes(q)) ||
      (t.status && t.status.toLowerCase().includes(q)) ||
      (t.business_customer_name && t.business_customer_name.toLowerCase().includes(q)) || (t.business_customer && t.business_customer.toLowerCase().includes(q))
    );
  }

  const cf = columnFilters[scope];
  const terminalStatuses = ['ВЫПОЛНЕНА', 'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА'];
  if (cf) {
    Object.keys(cf).forEach(key => {
      const vals = cf[key];
      if (vals && vals.size > 0) {
        if (key === '_overdue') {
          list = list.filter(t => t.deadline_id != null && !terminalStatuses.includes(t.status_name) && isDeadlinePast(t.deadline_name));
          return;
        }
        if (key === '_urgent') {
          list = list.filter(t => t.priority_name === 'ВЫСОКИЙ');
          return;
        }
        if (key === '_current') {
          list = list.filter(isCurrentTask);
          return;
        }
        if (key === '_last_quarter') {
          list = list.filter(isLastQuarterTask);
          return;
        }
        if (key === '_active') {
          list = list.filter(t => !!t.status_name && !terminalStatuses.includes(t.status_name) && t.status_name !== 'ХОЛД');
          return;
        }
        if (key === '_hold') {
          list = list.filter(t => t.status_name === 'ХОЛД');
          return;
        }
        if (key === '_rejected') {
          list = list.filter(t => t.status_name === 'ОТКЛОНЕНА');
          return;
        }
        if (key === '_high_cv') {
          list = list.filter(t => t.financial_effect != null && t.effort_rub > 0 && (t.financial_effect / t.effort_rub) > 1);
          return;
        }
        list = list.filter(t => {
          let v = t[key];
          if (key === 'progress') {
            if (vals.has('0-25')) return (v || 0) <= 25;
            if (vals.has('25-50')) return (v || 0) > 25 && (v || 0) <= 50;
            if (vals.has('50-75')) return (v || 0) > 50 && (v || 0) <= 75;
            if (vals.has('75-100')) return (v || 0) > 75;
            return true;
          }
          if (key === 'tags') {
            const taskTags = Array.isArray(v)
              ? v.map(x => typeof x === 'object' && x !== null ? String(x.name || '') : String(x)).filter(Boolean)
              : String(v).split(',').map(s => s.trim());
            return taskTags.some(tag => vals.has(tag));
          }
          if (key === 'involved_teams' && typeof v === 'string') {
            const teams = v.split(',').map(s => s.trim());
            return teams.some(tm => vals.has(tm));
          }
          return v != null && vals.has(String(v));
        });
      }
    });
  }

  list = sortList(scope, list);
  return list;
}

function sortList(scope, list) {
  const sortKey = sortValues[scope] || 'id-desc';
  const [k, dir] = sortKey.split('-');
  const m = dir === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    let va = a[k], vb = b[k];
    if (k === 'priority') { va = priorityWeight[va] || 0; vb = priorityWeight[vb] || 0; }
    if (k === 'prog') { va = a.progress || 0; vb = b.progress || 0; }
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * m;
    if (va == null) return 1; if (vb == null) return -1;
    return String(va).localeCompare(String(vb)) * m;
  });
}

function getVisibleColumnKeys(scope) {
  const cs = columnSettingsRefs[scope];
  const order = columnOrderRefs[scope];
  if (!cs) return [];
  if (order && order.length > 0) {
    return order.filter(k => cs[k]);
  }
  return Object.keys(cs).filter(k => cs[k]);
}

function getSortedFilterColumns(scope) {
  const visibleKeys = getVisibleColumnKeys(scope);
  return [...filterableColumns].sort((a, b) => {
    const aCol = a.columnKey || a.key;
    const bCol = b.columnKey || b.key;
    const ai = visibleKeys.indexOf(aCol);
    const bi = visibleKeys.indexOf(bCol);
    if (ai !== -1 && bi === -1) return -1;
    if (ai === -1 && bi !== -1) return 1;
    if (ai !== -1 && bi !== -1) return ai - bi;
    return filterableColumns.indexOf(a) - filterableColumns.indexOf(b);
  });
}

function renderFilterButtons(scope, allTasks) {
  allTasksCache[scope] = allTasks || [];
  const mainC = $(`f-${scope}-main-filters`);
  const extC = $(`f-${scope}-ext-row`);
  if (!mainC) return;

  const cf = columnFilters[scope];
  const sortedColumns = getSortedFilterColumns(scope);

  function clearFilter(e, key) {
    e.stopPropagation();
    delete columnFilters[scope][key];
    renderFilterButtons(scope, allTasks);
    const cb = filterChangeCallbacks[scope];
    if (cb) cb();
  }

  const renderBtn = (col) => {
    const hasValue = cf[col.key] && cf[col.key].size > 0;
    let valueText = 'Все';
    if (hasValue) {
      const labels = [...cf[col.key]];
      valueText = labels.length === 1 ? labels[0] : `${labels.length} выбрано`;
    }
    return `<div class="filter-cell" data-filter-scope="${scope}" data-filter-key="${col.key}">
      <button class="filter-btn ${hasValue ? 'has-value' : ''}" data-scope="${scope}" data-key="${col.key}">
        <svg class="filter-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
        <span class="filter-label">${col.label}:</span>
        <span class="filter-value">${valueText}</span>
        <svg class="filter-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>
      ${hasValue ? `<button class="filter-clear" data-clear="${col.key}" title="Очистить фильтр"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : ''}
    </div>`;
  };

  const allHtml = sortedColumns.map(renderBtn).join('');
  mainC.innerHTML = '';
  if (extC) extC.innerHTML = allHtml;

  document.querySelectorAll(`[data-scope="${scope}"].filter-btn`).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      toggleDropdown(e, scope, key, allTasks);
    });
  });

  document.querySelectorAll(`[data-clear]`).forEach(el => {
    el.addEventListener('click', (e) => clearFilter(e, el.dataset.clear));
  });

  const extActive = Object.keys(cf).filter(k => cf[k] && cf[k].size > 0).length;
  const btnTxt = $(`btn-ext-${scope}-text`);
  if (btnTxt) btnTxt.textContent = extActive > 0 ? `Фильтры (${extActive})` : 'Фильтры';
  updateActiveFiltersRow(scope);
}

function updateActiveFiltersRow(scope) {
  const container = $(`f-${scope}-active-filters`);
  if (!container) return;
  const cf = columnFilters[scope];
  const labels = {};
  filterableColumns.forEach(c => { labels[c.key] = c.label; });
  const chips = [];
  Object.keys(cf).forEach(key => {
    const vals = cf[key];
    if (!vals || vals.size === 0) return;
    if (key === '_overdue') { chips.push({ key, label: 'Просрочено', value: 'да' }); return; }
    if (key === '_urgent') { chips.push({ key, label: 'Важные задачи', value: 'да' }); return; }
    if (key === '_current') { chips.push({ key, label: 'Текущие задачи', value: 'да' }); return; }
    if (key === '_last_quarter') { chips.push({ key, label: 'Прошлый квартал', value: 'да' }); return; }
    if (key === '_active') { chips.push({ key, label: 'В работе', value: 'да' }); return; }
    if (key === '_hold') { chips.push({ key, label: 'Холд', value: 'да' }); return; }
    if (key === '_rejected') { chips.push({ key, label: 'Отклонённые', value: 'да' }); return; }
    if (key === '_high_cv') { chips.push({ key, label: 'C/V > 1', value: 'да' }); return; }
    const colLabel = labels[key] || key;
    const valueText = vals.size === 1 ? [...vals][0] : `${vals.size} выбрано`;
    chips.push({ key, label: colLabel, value: valueText });
  });
  if (chips.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = chips.map(ch => `
    <span class="active-filter-chip" data-key="${ch.key}">
      <span class="chip-label">${ch.label}:</span>
      <span class="chip-value">${ch.value}</span>
      <button class="chip-clear" data-clear="${ch.key}" title="Очистить фильтр">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </span>
  `).join('');
  container.querySelectorAll('.chip-clear').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = el.dataset.clear;
      delete columnFilters[scope][key];
      renderFilterButtons(scope, allTasksCache[scope] || []);
      const cb = filterChangeCallbacks[scope];
      if (cb) cb();
    });
  });
}

function toggleDropdown(event, scope, key, allTasks) {
  const wrapper = event.currentTarget.parentElement;
  const existing = wrapper.querySelector('.filter-dropdown');
  document.querySelectorAll('.filter-dropdown').forEach(d => d.remove());
  if (existing) return;

  const options = getUniqueValues(scope, key, allTasks);
  const currentSelected = columnFilters[scope][key] ? new Set(columnFilters[scope][key]) : new Set();

  const dd = document.createElement('div');
  dd.className = 'filter-dropdown';
  dd.style.cssText = 'position:absolute;top:calc(100% + 4px);left:0;min-width:220px;max-height:340px;overflow-y:auto;z-index:40;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:10px;box-shadow:0 10px 25px -5px var(--shadow-color),0 8px 10px -6px var(--shadow-color);padding:8px;';
  dd.onclick = (e) => e.stopPropagation();

  dd.innerHTML = `
    <input type="text" class="fd-search" placeholder="Поиск..." style="width:100%;padding:6px 10px;font-size:12px;background:var(--bg-input);border:1px solid var(--border-color);border-radius:6px;margin-bottom:6px;color:var(--text-primary);box-sizing:border-box;">
    <div class="fd-options" style="max-height:220px;overflow-y:auto;">
      ${options.map(o => {
        const checked = currentSelected.has(o.value) ? 'checked' : '';
        return `<label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--text-secondary);transition:background-color 0.1s;">
          <input type="checkbox" ${checked} data-val="${o.value.replace(/"/g, '&quot;')}" style="margin:0;">
          <span>${o.label}</span>
        </label>`;
      }).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;padding-top:6px;margin-top:6px;border-top:1px solid var(--border-subtle);">
      <button class="fd-clear" style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;background:none;border:none;color:var(--text-muted);cursor:pointer;">Очистить</button>
      <button class="fd-apply" style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;background:var(--accent);color:white;border:none;cursor:pointer;">Готово</button>
    </div>
  `;

  wrapper.appendChild(dd);

  dd.querySelector('.fd-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    dd.querySelectorAll('.fd-options label').forEach(label => {
      const text = label.querySelector('span').textContent.toLowerCase();
      label.style.display = text.includes(q) ? 'flex' : 'none';
    });
  });

  function notifyChange() {
    const cb = filterChangeCallbacks[scope];
    if (cb) cb();
  }

  dd.querySelector('.fd-clear')?.addEventListener('click', (e) => {
    e.stopPropagation();
    // Очищаем фильтр для этой колонки
    delete columnFilters[scope][key];

    // Снимаем все чекбоксы в дропдауне
    dd.querySelectorAll('.fd-options input[type="checkbox"]').forEach(cb => {
      cb.checked = false;
    });

    // Обновляем текст на кнопке-родителе и убираем крестик, не перерисовывая весь тулбар
    const filterCell = wrapper.matches('.filter-cell') ? wrapper : wrapper.closest('.filter-cell');
    if (filterCell) {
      const valueSpan = filterCell.querySelector('.filter-value');
      if (valueSpan) valueSpan.textContent = 'Все';

      const btn = filterCell.querySelector('.filter-btn');
      if (btn) btn.classList.remove('has-value');

      const clearBtn = filterCell.querySelector('.filter-clear');
      if (clearBtn) clearBtn.remove();
    }

    // Возвращаем фокус в поле поиска для продолжения выбора
    const searchInput = dd.querySelector('.fd-search');
    if (searchInput) searchInput.focus();

    notifyChange();
  });

  dd.querySelector('.fd-apply')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const checked = dd.querySelectorAll('.fd-options input[type="checkbox"]:checked');
    const vals = new Set();
    checked.forEach(cb => vals.add(cb.dataset.val));
    if (vals.size > 0) {
      columnFilters[scope][key] = vals;
    } else {
      delete columnFilters[scope][key];
    }
    dd.remove();
    renderFilterButtons(scope, allTasks);
    notifyChange();
  });
}

export function updateStickyOffsets() {
  requestAnimationFrame(() => {
    const toolbar = document.querySelector('.sticky-toolbar');
    if (!toolbar) return;
    const style = getComputedStyle(document.documentElement);
    const navbarHeight = parseFloat(style.getPropertyValue('--navbar-height'));
    const offset = navbarHeight + toolbar.offsetHeight;
    document.documentElement.style.setProperty('--sticky-thead-offset', offset + 'px');
    const contentContainers = document.querySelectorAll('#tasks-container, #team-tasks-container');
    contentContainers.forEach(el => {
      el.style.marginTop = toolbar.offsetHeight + 'px';
    });
  });
}

let stickyHeaderWrapper = null;
let stickyHeaderTable = null;
let stickyHeaderObserver = null;
let scrollHandler = null;
let resizeHandler = null;

export function initStickyTableHeader(tableId) {
  if (stickyHeaderObserver) {
    stickyHeaderObserver.disconnect();
    stickyHeaderObserver = null;
  }
  if (scrollHandler) {
    window.removeEventListener('scroll', scrollHandler);
    scrollHandler = null;
  }
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }
  if (stickyHeaderWrapper) {
    stickyHeaderWrapper.remove();
    stickyHeaderWrapper = null;
  }
  stickyHeaderTable = null;

  const table = document.getElementById(tableId);
  if (!table) return;

  const thead = table.querySelector('thead');
  if (!thead) return;

  const container = table.closest('.table-container');
  if (!container) return;

  stickyHeaderTable = table;

  function getOffsetTop() {
    const style = getComputedStyle(document.documentElement);
    const navbarHeight = parseFloat(style.getPropertyValue('--navbar-height')) || 64;
    const toolbar = document.querySelector('.sticky-toolbar');
    const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;
    return navbarHeight + toolbarHeight;
  }

  function update() {
    if (!stickyHeaderTable) return;
    const tableRect = stickyHeaderTable.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const offsetTop = getOffsetTop();
    const theadHeight = thead.offsetHeight;

    if (tableRect.top < offsetTop && tableRect.bottom > offsetTop + theadHeight) {
      if (!stickyHeaderWrapper) {
        stickyHeaderWrapper = document.createElement('div');
        stickyHeaderWrapper.id = 'sticky-header-wrapper';
        stickyHeaderWrapper.style.cssText = `
          position: fixed;
          z-index: 26;
          overflow: hidden;
          background: var(--bg-tertiary);
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        `;
        
        const clonedTable = document.createElement('table');
        clonedTable.className = table.className;
        clonedTable.dataset.sourceTable = tableId;
        clonedTable.style.cssText = 'margin: 0; border-collapse: collapse;';
        
        const clonedThead = thead.cloneNode(true);
        clonedTable.appendChild(clonedThead);
        stickyHeaderWrapper.appendChild(clonedTable);
        document.body.appendChild(stickyHeaderWrapper);
      }

      const clonedThs = stickyHeaderWrapper.querySelectorAll('th');
      const origThs = thead.querySelectorAll('th');
      
      clonedThs.forEach((th, i) => {
        if (origThs[i]) {
          const origRect = origThs[i].getBoundingClientRect();
          th.style.width = origRect.width + 'px';
          th.style.minWidth = origRect.width + 'px';
          th.style.maxWidth = origRect.width + 'px';
        }
      });

      const scrollLeft = container.scrollLeft;
      const visibleWidth = containerRect.width;
      
      stickyHeaderWrapper.style.left = containerRect.left + 'px';
      stickyHeaderWrapper.style.width = visibleWidth + 'px';
      stickyHeaderWrapper.style.top = offsetTop + 'px';
      stickyHeaderWrapper.style.height = theadHeight + 'px';
      
      const innerTable = stickyHeaderWrapper.querySelector('table');
      if (innerTable) {
        innerTable.style.transform = `translateX(-${scrollLeft}px)`;
        innerTable.style.width = tableRect.width + 'px';
      }
    } else if (stickyHeaderWrapper) {
      stickyHeaderWrapper.remove();
      stickyHeaderWrapper = null;
    }
  }

  scrollHandler = () => update();
  resizeHandler = () => update();
  
  const mainContent = document.querySelector('.main-content');
  window.addEventListener('scroll', scrollHandler, { passive: true });
  window.addEventListener('resize', resizeHandler, { passive: true });
  container.addEventListener('scroll', scrollHandler, { passive: true });
  if (mainContent) mainContent.addEventListener('scroll', scrollHandler, { passive: true });

  stickyHeaderObserver = new ResizeObserver(() => {
    if (stickyHeaderWrapper) {
      stickyHeaderWrapper.remove();
      stickyHeaderWrapper = null;
    }
    update();
  });
  stickyHeaderObserver.observe(table);

  update();
}

export function setToolbarSortValue(scope, value) {
  sortValues[scope] = value;
}

export function resetToolbarFilters(scope) {
  columnFilters[scope] = {};
  searchValues[scope] = '';
  sortValues[scope] = 'id-desc';
  const searchInput = $(`f-${scope}-search`);
  if (searchInput) searchInput.value = '';
}

export { columnFilters, renderFilterButtons, filterChangeCallbacks, isDeadlinePast, isCurrentTask, isLastQuarterTask };


