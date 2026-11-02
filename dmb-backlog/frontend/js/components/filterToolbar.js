import { dateRange, numberRange, validateRanges } from '../ui/intervals.js';
import { createPopover, bindPopover } from '../ui/popover.js';
import { selectionList, filterSelectionList } from '../ui/selectionList.js';
import { confirmAction } from '../uiFeedback.js';
import { calculateTaskCv } from '../taskMetrics.js';
import { formatTaskPublicId } from '../taskPublicId.js';
import { TASK_COLUMNS } from './taskColumns.js';
import { pageHeader } from '../ui/primitives.js';
import { setReferenceSortOrders } from './tableUtils.js?v=52';

console.log('[DMB] filterToolbar.js v20260918.1 loaded');
const columnFilters = { backlog: {}, team: {} };
const sortValues = { backlog: 'id-desc', team: 'id-desc' };
const searchValues = { backlog: '', team: '' };
const filterChangeCallbacks = {};
const allTasksCache = { backlog: [], team: [] };
const columnSettingsRefs = { backlog: null, team: null };
const columnOrderRefs = { backlog: null, team: null };
const defaultColumnSettingsRefs = { backlog: null, team: null };
const filterLabelsRefs = { backlog: {}, team: {} };
const SAVED_VIEWS_PREFIX = 'dmb_saved_views_v1_';
const PINNED_FILTERS_PREFIX = 'dmb_pinned_filters_v1_';
const MAX_PINNED_FILTERS = 5;
const EMPTY_FILTER_VALUE = '__EMPTY__';
const FILTER_TOKEN_PREFIX = {
  text: '__text__:',
  min: '__min__:',
  max: '__max__:',
  from: '__from__:',
  to: '__to__:',
};

export const DEFAULT_PINNED_FILTERS = {
  backlog: ['status_name', 'priority_name', 'team_name', 'deadline_name', 'project_name'],
  team: ['status_name', 'priority_name', 'deadline_name', 'owner_name', 'task_type_name'],
};

const directoryCache = {};
const directoryLoading = {};

const PERMISSION_LEVELS = { 'none': 0, 'read': 1, 'read_own': 1, 'read_all': 1, 'write_own': 2, 'read_write': 2, 'write_all': 3 };

const TEAM_EDITOR_ROLES = new Set(['po/pl/cl', 'ba/участник команды', 'it pl']);
const GLOBAL_EDITOR_ROLES = new Set(['проектный офис (админ)', 'администратор']);

function currentUser() {
  return window.app?.store?.get('currentUser') || {};
}

function normalizedRole(user = currentUser()) {
  return String(user.role_name || user.role || '').trim().toLocaleLowerCase('ru-RU');
}

export function hasWritePermission(scope) {
  const user = currentUser();
  const role = normalizedRole(user);
  const roleCanEdit = GLOBAL_EDITOR_ROLES.has(role) || TEAM_EDITOR_ROLES.has(role);
  if (!roleCanEdit) return false;
  const perms = user.permissions || {};
  const permission = scope === 'backlog' ? perms.backlog_dmb : perms.backlog_team;
  if (permission == null) return roleCanEdit;
  return (PERMISSION_LEVELS[permission] || 0) >= 2;
}

export function canEditTaskForScope(scope, task) {
  if (!hasWritePermission(scope)) return false;
  const user = currentUser();
  const role = normalizedRole(user);
  if (GLOBAL_EDITOR_ROLES.has(role)) return true;
  return TEAM_EDITOR_ROLES.has(role) && user.team_id != null && Number(task?.team_id) === Number(user.team_id);
}

export function taskCountLabel(count) {
  const mod100 = Math.abs(count) % 100;
  const mod10 = Math.abs(count) % 10;
  const noun = mod100 >= 11 && mod100 <= 14 ? 'задач' : mod10 === 1 ? 'задача' : mod10 >= 2 && mod10 <= 4 ? 'задачи' : 'задач';
  return `Найдено: ${count} ${noun}`;
}

export function updateToolbarTasks(scope, tasks, visibleTasks = tasks) {
  allTasksCache[scope] = tasks;
  const reason = visibleTasks.some(task => canEditTaskForScope(scope, task)) ? ''
    : visibleTasks.length ? 'Нет прав на изменение задач в этой выборке.' : 'В текущей выборке нет задач для изменения.';
  const hint = document.getElementById(`${scope}-edit-hint`);
  if (hint) { hint.textContent = reason; hint.hidden = !reason; }
  for (const id of [`${scope}-inline-edit`, `${scope}-bulk-open`]) {
    const button = document.getElementById(id);
    if (!button || button.getAttribute('aria-haspopup') === 'menu') continue;
    button.dataset.editUnavailable = reason;
    const cards = document.querySelector(`#${scope}-view-toggle-group [data-view="cards"].active`);
    button.disabled = !!reason || !!cards;
    button.setAttribute('aria-disabled', String(button.disabled));
    if (reason) button.setAttribute('aria-describedby', `${scope}-edit-hint`);
    else button.removeAttribute('aria-describedby');
  }
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
  did_client_group: { url: '/tasks/reference', labelField: 'name', responseField: 'did_client_groups' },
};

async function loadDirectories() {
  const entries = Object.entries(columnDirectoryMap);
  const results = await Promise.allSettled(entries.map(async ([colKey, info]) => {
    if (directoryCache[colKey]) return;
    const resp = await fetch(`/api/v1${info.url}`);
    if (!resp.ok) throw new Error(`Failed to load ${info.url}`);
    const payload = await resp.json();
    const data = info.responseField ? (payload[info.responseField] || []) : payload;
    const items = data.map((item, index) => ({
      value: String(item[info.labelField]),
      label: String(item[info.labelField]),
      sort_order: item.sort_order ?? index,
    }));
    directoryCache[colKey] = items;
    const tableKey = filterColumnsByKey[colKey]?.columnKey || colKey;
    setReferenceSortOrders({ [tableKey]: items });
  }));
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.warn(`[DMB] Failed to load directory for ${entries[i][0]}:`, r.reason);
  });
}

const filterableColumns = [
  { key: 'id', label: 'ID', columnKey: 'id', group: 'Основные', type: 'text', valueKeys: ['public_id', 'id'] },
  { key: 'title', label: 'Задача', columnKey: 'title', group: 'Основные', type: 'text', valueKeys: ['title'] },
  { key: 'description', label: 'Описание', columnKey: 'description', group: 'Основные', type: 'text', valueKeys: ['description'] },
  { key: 'status_name', label: 'Статус', filterLabel: 'Статус', columnKey: 'status', group: 'Основные', type: 'select', valueKeys: ['status_name', 'status'] },
  { key: 'priority_name', label: 'Приоритет', columnKey: 'priority', group: 'Основные', type: 'select', valueKeys: ['priority_name', 'priority'] },
  { key: 'project_name', label: 'Проект', columnKey: 'project', group: 'Основные', type: 'select', valueKeys: ['project_name', 'project'] },
  { key: 'task_type_name', label: 'Тип задачи', columnKey: 'task_type', group: 'Основные', type: 'select', valueKeys: ['task_type_name', 'task_type'] },

  { key: 'team_name', label: 'Команда', columnKey: 'team', group: 'Ответственные', type: 'select', valueKeys: ['team_name', 'team'] },
  { key: 'owner_name', label: 'Исполнитель', columnKey: 'owner', group: 'Ответственные', type: 'select', valueKeys: ['owner_name', 'owner'] },
  { key: 'created_by_name', label: 'Автор задачи', columnKey: 'created_by', group: 'Ответственные', type: 'select', valueKeys: ['created_by_name', 'created_by'] },
  { key: 'business_customer', label: 'Бизнес-заказчик', columnKey: 'business_customer', group: 'Ответственные', type: 'select', valueKeys: ['business_customer_name', 'business_customer'] },
  { key: 'did_client_group', label: 'Клиент ДИД', columnKey: 'did_client_group', group: 'Ответственные', type: 'select', valueKeys: ['did_client_group_name', 'did_client_group_id', 'did_client_group'] },
  { key: 'department_name', label: 'Подразделение', columnKey: 'department', group: 'Ответственные', type: 'select', valueKeys: ['department_name', 'department'] },
  { key: 'involved_teams', label: 'Вовлечённые команды', columnKey: 'involved_teams', group: 'Ответственные', type: 'select', valueKeys: ['involved_team_names', 'involved_teams'], multipleValue: true },
  { key: 'channel_name', label: 'Канал', columnKey: 'channel', group: 'Ответственные', type: 'select', valueKeys: ['channel_name', 'channel'] },

  { key: 'date_received', label: 'Дата получения', columnKey: 'date_received', group: 'Планирование', type: 'date', valueKeys: ['date_received'] },
  { key: 'deadline_name', label: 'Срок выполнения', filterLabel: 'Срок', columnKey: 'deadline', group: 'Планирование', type: 'select', valueKeys: ['deadline_name', 'deadline'] },
  { key: 'progress', label: 'Прогресс', columnKey: 'progress', group: 'Планирование', type: 'number', valueKeys: ['progress'], min: 0, max: 100, step: 1, suffix: '%' },
  { key: 'created_at', label: 'Дата создания', columnKey: 'created_at', group: 'Планирование', type: 'date', valueKeys: ['created_at'] },
  { key: 'updated_at', label: 'Дата последнего изменения', columnKey: 'updated_at', group: 'Планирование', type: 'date', valueKeys: ['updated_at'] },

  { key: 'effort_days', label: 'Трудозатраты (дни)', columnKey: 'effort_days', group: 'Трудозатраты', type: 'number', valueKeys: ['effort_days'], min: 0, step: 1 },
  { key: 'effort_rub', label: 'Трудозатраты (руб)', columnKey: 'effort_rub', group: 'Трудозатраты', type: 'number', valueKeys: ['effort_rub'], min: 0, step: 'any' },
  { key: 'actual_effort_days', label: 'Фактические трудозатраты (ч/д)', columnKey: 'actual_effort_days', group: 'Трудозатраты', type: 'number', valueKeys: ['actual_effort_days'], min: 0, step: 'any' },

  { key: 'financial_effect', label: 'Фин. эффект', columnKey: 'financial_effect', group: 'Ценность', type: 'number', valueKeys: ['financial_effect'], min: 0, step: 'any' },
  { key: 'financial_effect_justification', label: 'Обоснование фин. эффекта', columnKey: 'financial_effect_justification', group: 'Ценность', type: 'text', valueKeys: ['financial_effect_justification'] },
  { key: 'cv', label: 'C/V', columnKey: 'cv', group: 'Ценность', type: 'number', computed: 'cv', min: 0, step: 'any' },
  { key: 'metric_kr_plan', label: 'Метрический KR (план)', columnKey: 'metric_kr_plan', group: 'Ценность', type: 'number', valueKeys: ['metric_kr_plan'], step: 'any' },
  { key: 'metric_kr_fact', label: 'Метрический KR (факт)', columnKey: 'metric_kr_fact', group: 'Ценность', type: 'number', valueKeys: ['metric_kr_fact'], step: 'any' },
  { key: 'metric_kr_unit', label: 'Единица измерения (метрический KR)', columnKey: 'metric_kr_unit', group: 'Ценность', type: 'select', valueKeys: ['metric_kr_unit'] },

  { key: 'key_project_status', label: 'Статус ключ. проекта', columnKey: 'key_project_status', group: 'Отчётность', type: 'text', valueKeys: ['key_project_status'] },
  { key: 'key_project_status_updated_at', label: 'Дата статуса ключ. проекта', columnKey: 'key_project_status_updated_at', group: 'Отчётность', type: 'date', valueKeys: ['key_project_status_updated_at'] },
  { key: 'directorate_status', label: 'Статус для директорской', columnKey: 'directorate_status', group: 'Отчётность', type: 'text', valueKeys: ['directorate_status'] },
  { key: 'directorate_status_updated_at', label: 'Дата статуса (директорская)', columnKey: 'directorate_status_updated_at', group: 'Отчётность', type: 'date', valueKeys: ['directorate_status_updated_at'] },
  { key: 'did_status', label: 'Статус для ДИД', columnKey: 'did_status', group: 'Отчётность', type: 'text', valueKeys: ['did_status'] },
  { key: 'did_status_updated_at', label: 'Дата статуса (ДИД)', columnKey: 'did_status_updated_at', group: 'Отчётность', type: 'date', valueKeys: ['did_status_updated_at'] },
  { key: 'did_demo', label: 'Демо для ДИД', columnKey: 'did_demo', group: 'Отчётность', type: 'boolean', valueKeys: ['did_demo'] },

  { key: 'link_mockups', label: 'Ссылка на макеты', columnKey: 'link_mockups', group: 'Прочее', type: 'text', valueKeys: ['link_mockups'] },
  { key: 'link_jira', label: 'Ссылка на Jira', columnKey: 'link_jira', group: 'Прочее', type: 'text', valueKeys: ['link_jira'], multipleValue: true },
  { key: 'tags', label: 'Метки (теги)', columnKey: 'tags', group: 'Прочее', type: 'select', valueKeys: ['tags'], multipleValue: true, objectLabelKey: 'name' },
  { key: 'rejection_reason', label: 'Причина отклонения', columnKey: 'rejection_reason', group: 'Прочее', type: 'text', valueKeys: ['rejection_reason'] },
  { key: 'comment', label: 'Комментарий', columnKey: 'comment', group: 'Прочее', type: 'text', valueKeys: ['comment'] },
];

const filterColumnsByKey = Object.fromEntries(filterableColumns.map(column => [column.key, column]));
const filterColumnsByTableColumn = Object.fromEntries(filterableColumns.map(column => [column.columnKey, column]));
const FILTER_GROUP_ORDER = ['Основные', 'Ответственные', 'Планирование', 'Трудозатраты', 'Ценность', 'Отчётность', 'Прочее'];
const missingFilterColumns = TASK_COLUMNS.filter(column => !filterColumnsByTableColumn[column.key]);
if (missingFilterColumns.length) {
  console.warn('[DMB] Table columns without filters:', missingFilterColumns.map(column => column.key));
}

function validPinnedFilterKeys(keys) {
  const result = [];
  (Array.isArray(keys) ? keys : []).forEach(key => {
    if (filterColumnsByKey[key] && !result.includes(key) && result.length < MAX_PINNED_FILTERS) result.push(key);
  });
  return result;
}

function readPinnedFilters(scope) {
  const defaults = DEFAULT_PINNED_FILTERS[scope] || DEFAULT_PINNED_FILTERS.backlog;
  try {
    const stored = localStorage.getItem(PINNED_FILTERS_PREFIX + scope);
    if (stored == null) return [...defaults];
    return validPinnedFilterKeys(JSON.parse(stored));
  } catch {
    return [...defaults];
  }
}

function writePinnedFilters(scope, keys) {
  localStorage.setItem(PINNED_FILTERS_PREFIX + scope, JSON.stringify(validPinnedFilterKeys(keys)));
}

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

function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function readSavedViews(scope) {
  try {
    const parsed = JSON.parse(localStorage.getItem(SAVED_VIEWS_PREFIX + scope) || '{"items":[]}');
    return { items: Array.isArray(parsed.items) ? parsed.items : [], defaultId: parsed.defaultId || null };
  } catch {
    return { items: [], defaultId: null };
  }
}

function writeSavedViews(scope, data) {
  localStorage.setItem(SAVED_VIEWS_PREFIX + scope, JSON.stringify(data));
}

export function savedViewStateKey(value) {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || Array.isArray(nested) || typeof nested !== 'object') return nested;
    return Object.keys(nested).sort().reduce((result, key) => { result[key] = nested[key]; return result; }, {});
  });
}

function renderSavedViewsControl(scope) {
  return `<div class="relative saved-view-control" id="${scope}-saved-view-control" style="display:flex;align-items:center;gap:4px;">
    <div class="saved-view-picker" style="position:relative;display:flex;align-items:center;">
      <button type="button" id="${scope}-saved-view-trigger" class="btn btn-secondary btn-sm saved-view-trigger ui-responsive-icon" aria-label="Пользовательские представления" title="Пользовательские представления" aria-expanded="false">
        <svg class="saved-view-trigger-icon" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10h10V2Z"></path><path d="M22 12H12v10h10V12Z"></path><path d="M12 12H2v10h10V12Z"></path><path d="M22 2H12v10h10V2Z"></path></svg>
        <span id="${scope}-saved-view-label" class="saved-view-trigger-label ui-responsive-icon-label">Представление…</span>
        <span id="${scope}-saved-view-dirty" class="saved-view-dirty" style="display:none;" title="Текущее отображение отличается от сохранённого">●</span>
        <svg class="saved-view-chevron ui-responsive-icon-extra" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"></path></svg>
      </button>
      <div id="${scope}-saved-view-dropdown" class="saved-view-dropdown" style="display:none;"></div>
    </div>
    <button class="btn btn-secondary btn-sm square-icon saved-view-save-btn" id="${scope}-saved-view-save" title="Сохранить текущее представление" aria-label="Сохранить представление"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path><path d="M12 7v6"></path><path d="M9 10h6"></path></svg></button>
    <div id="${scope}-saved-view-editor" class="ui-popover-editor" hidden>
      <label class="ui-popover-field" for="${scope}-saved-view-name">Название представления</label>
      <input class="input ui-control" id="${scope}-saved-view-name" maxlength="80" placeholder="Например, Мои активные" style="width:100%;box-sizing:border-box">
      <div class="ui-popover-hint">Сохранятся фильтры, сортировка, видимость и порядок столбцов.</div>
      <label class="ui-selection-option"><input type="checkbox" id="${scope}-saved-view-default"> Открывать по умолчанию</label>
      <div class="ui-popover-actions"><button class="btn btn-secondary btn-sm" id="${scope}-saved-view-cancel">Отмена</button><button class="btn btn-primary btn-sm" id="${scope}-saved-view-confirm">Сохранить</button></div>
    </div>
  </div>`;
}

export function getToolbarViewState(scope) {
  const filters = {};
  Object.entries(columnFilters[scope] || {}).forEach(([key, values]) => { filters[key] = [...values]; });
  return { search: searchValues[scope] || '', sort: sortValues[scope] || 'id-desc', filters };
}

export function applyToolbarViewState(scope, state = {}) {
  searchValues[scope] = state.search || '';
  sortValues[scope] = state.sort || 'id-desc';
  columnFilters[scope] = {};
  Object.entries(state.filters || {}).forEach(([key, values]) => { columnFilters[scope][key] = new Set(Array.isArray(values) ? values : []); });
  const searchInput = $(`f-${scope}-search`);
  if (searchInput) searchInput.value = searchValues[scope];
  renderFilterButtons(scope, allTasksCache[scope] || []);
  document.querySelectorAll('.quick-filter-btn').forEach(btn => {
    const active = !!columnFilters[scope]?.[`_${btn.dataset.filter}`]?.size;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function initSavedViews(scope, getPageState, applyPageState, options = {}) {
  const trigger = $(`${scope}-saved-view-trigger`);
  const dropdown = $(`${scope}-saved-view-dropdown`);
  const label = $(`${scope}-saved-view-label`);
  const dirtyIndicator = $(`${scope}-saved-view-dirty`);
  if (!trigger || !dropdown) return;
  const saveBtn = $(`${scope}-saved-view-save`);
  const editor = $(`${scope}-saved-view-editor`);
  const nameInput = $(`${scope}-saved-view-name`);
  const defaultInput = $(`${scope}-saved-view-default`);
  let activeViewId = '';
  let appliedViewStateKey = '';
  const showRevertAction = options.showRevertAction !== false;

  const currentState = () => ({ toolbar: getToolbarViewState(scope), page: getPageState?.() || {} });

  const updateDirtyIndicator = () => {
    const view = readSavedViews(scope).items.find(item => item.id === activeViewId);
    const baselineStateKey = appliedViewStateKey || savedViewStateKey(view?.state || {});
    const dirty = !!view && baselineStateKey !== savedViewStateKey(currentState());
    if (dirtyIndicator) dirtyIndicator.style.display = dirty ? '' : 'none';
    trigger.classList.toggle('is-dirty', dirty);
    dropdown.querySelector('.saved-view-revert')?.toggleAttribute('disabled', !dirty);
  };

  const refreshOptions = selectedId => {
    const focused = dropdown.contains(document.activeElement) ? document.activeElement : null;
    const focusRow = focused?.closest('.saved-view-item')?.dataset.viewId;
    const focusClass = focused && [...focused.classList].find(name => /^saved-view-(default|rename|delete|apply|update|revert)$/.test(name));
    const data = readSavedViews(scope);
    const nextViewId = selectedId || '';
    if (nextViewId !== activeViewId) appliedViewStateKey = '';
    activeViewId = nextViewId;
    const active = data.items.find(view => view.id === activeViewId);
    if (label) label.textContent = active?.name || 'Представление…';
    dropdown.innerHTML = data.items.length
      ? `<div class="saved-view-list">${data.items.map(view => `<div class="saved-view-item ${view.id === activeViewId ? 'active' : ''}" data-view-id="${escapeAttr(view.id)}"><button type="button" class="ui-surface-action saved-view-apply" data-view-id="${escapeAttr(view.id)}"><span>${escapeAttr(view.name)}</span></button><button type="button" class="btn btn-ghost btn-sm square-icon ui-btn saved-view-default ${view.id === data.defaultId ? 'is-default' : ''}" data-default-view-id="${escapeAttr(view.id)}" title="${view.id === data.defaultId ? 'Снять вид по умолчанию' : 'Установить как вид по умолчанию'}" aria-label="${view.id === data.defaultId ? 'Снять вид по умолчанию' : 'Установить как вид по умолчанию'}: ${escapeAttr(view.name)}" aria-pressed="${view.id === data.defaultId ? 'true' : 'false'}">${view.id === data.defaultId ? '★' : '☆'}</button><button type="button" class="btn btn-ghost btn-sm square-icon ui-btn saved-view-rename" data-rename-view-id="${escapeAttr(view.id)}" title="Переименовать представление" aria-label="Переименовать представление ${escapeAttr(view.name)}"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"></path></svg></button><button type="button" class="btn btn-ghost btn-sm square-icon ui-btn saved-view-delete" data-delete-view-id="${escapeAttr(view.id)}" title="Удалить представление" aria-label="Удалить представление ${escapeAttr(view.name)}"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg></button></div>`).join('')}</div><div class="saved-view-actions">${showRevertAction ? `<button type="button" class="btn btn-secondary btn-sm ui-btn saved-view-revert" ${activeViewId ? '' : 'disabled'}>Вернуть сохранённое</button>` : ''}<button type="button" class="btn btn-secondary btn-sm ui-btn saved-view-update" ${activeViewId ? '' : 'disabled'}>Обновить текущими настройками</button></div>`
      : '<div class="saved-view-empty">Сохранённых представлений пока нет</div>';
    if (focused) {
      const row = focusRow && dropdown.querySelector(`[data-view-id="${CSS.escape(focusRow)}"]`);
      const next = focusClass ? (row || dropdown).querySelector(`.${focusClass}`) : row?.querySelector('.saved-view-rename');
      (next || dropdown.querySelector('button') || dropdown).focus({ preventScroll: true });
    }
    setTimeout(updateDirtyIndicator, 0);
  };

  const applyView = async (id, guard = true) => {
    const view = readSavedViews(scope).items.find(item => item.id === id);
    if (!view) return false;
    if (guard && options.beforeApply && !(await options.beforeApply())) return false;
    applyToolbarViewState(scope, view.state?.toolbar || {});
    applyPageState?.(view.state?.page || {});
    syncColumnControls(scope);
    filterChangeCallbacks[scope]?.();
    // A saved view may predate newly introduced columns or state fields. Page
    // adapters normalize such a view while applying it; that normalized result
    // is the baseline until the user actually changes a setting.
    appliedViewStateKey = savedViewStateKey(currentState());
    return true;
  };

  const clearInlineEditors = () => {
    dropdown.querySelectorAll('.saved-view-rename-editor, .saved-view-delete-confirm').forEach(element => element.remove());
  };

  const viewsPopover = bindPopover({ trigger, panel: dropdown, label: 'Сохранённые представления', align: 'end', onClose: clearInlineEditors });
  const editorPopover = createPopover({ trigger: saveBtn, panel: editor, label: 'Сохранить представление', align: 'end' });
  dropdown.addEventListener('click', async event => {
    const applyButton = event.target.closest('[data-view-id].saved-view-apply');
    if (applyButton) {
      const requestedViewId = applyButton.dataset.viewId;
      if (!(await applyView(requestedViewId))) return;
      activeViewId = requestedViewId;
      refreshOptions(activeViewId);
      viewsPopover.close();
      return;
    }
    const defaultButton = event.target.closest('[data-default-view-id]');
    if (defaultButton) {
      const defaultId = defaultButton.dataset.defaultViewId;
      const data = readSavedViews(scope);
      data.defaultId = data.defaultId === defaultId ? null : defaultId;
      writeSavedViews(scope, data);
      refreshOptions(activeViewId);
      window.toast?.(data.defaultId ? 'Вид установлен по умолчанию' : 'Вид по умолчанию снят', 'success');
      return;
    }
    const renameButton = event.target.closest('[data-rename-view-id]');
    if (renameButton) {
      const renameId = renameButton.dataset.renameViewId;
      const view = readSavedViews(scope).items.find(item => item.id === renameId);
      const row = renameButton.closest('.saved-view-item');
      dropdown.querySelectorAll('.saved-view-rename-editor, .saved-view-delete-confirm').forEach(element => element.remove());
      row?.insertAdjacentHTML('beforeend', `<div class="saved-view-rename-editor" data-ui-local-escape><input class="input ui-control" maxlength="80" value="${escapeAttr(view?.name || '')}" aria-label="Новое название представления"><div><button type="button" class="btn btn-secondary btn-sm ui-btn saved-view-rename-cancel">Отмена</button><button type="button" class="btn btn-primary btn-sm ui-btn saved-view-rename-confirm" data-confirm-rename-id="${escapeAttr(renameId)}">Сохранить</button></div></div>`);
      const input = row?.querySelector('.saved-view-rename-editor input');
      input?.focus(); input?.select();
      return;
    }
    if (event.target.closest('.saved-view-rename-cancel')) {
      event.target.closest('.saved-view-rename-editor')?.remove();
      return;
    }
    const confirmRenameButton = event.target.closest('[data-confirm-rename-id]');
    if (confirmRenameButton) {
      const renameId = confirmRenameButton.dataset.confirmRenameId;
      const name = confirmRenameButton.closest('.saved-view-rename-editor')?.querySelector('input')?.value.trim() || '';
      if (!name) { window.toast?.('Введите название представления', 'warning'); return; }
      const data = readSavedViews(scope);
      if (data.items.some(view => view.id !== renameId && view.name.trim().toLocaleLowerCase('ru-RU') === name.toLocaleLowerCase('ru-RU'))) {
        window.toast?.('Представление с таким названием уже существует', 'warning');
        return;
      }
      data.items = data.items.map(view => view.id === renameId ? { ...view, name, updatedAt: new Date().toISOString() } : view);
      writeSavedViews(scope, data);
      refreshOptions(activeViewId);
      window.toast?.('Представление переименовано', 'success');
      return;
    }
    const deleteButton = event.target.closest('[data-delete-view-id]');
    if (deleteButton) {
      const deleteId = deleteButton.dataset.deleteViewId;
      const data = readSavedViews(scope);
      const view = data.items.find(item => item.id === deleteId);
      const row = deleteButton.closest('.saved-view-item');
      dropdown.querySelectorAll('.saved-view-rename-editor, .saved-view-delete-confirm').forEach(element => element.remove());
      row?.insertAdjacentHTML('beforeend', `<div class="saved-view-delete-confirm"><span>Удалить «${escapeAttr(view?.name || '')}»?</span><div><button type="button" class="btn btn-secondary btn-sm ui-btn saved-view-delete-cancel">Отмена</button><button type="button" class="btn btn-danger btn-sm ui-btn saved-view-delete-approve" data-confirm-delete-id="${escapeAttr(deleteId)}">Удалить</button></div></div>`);
      return;
    }
    if (event.target.closest('.saved-view-delete-cancel')) {
      event.target.closest('.saved-view-delete-confirm')?.remove();
      return;
    }
    const approveDeleteButton = event.target.closest('[data-confirm-delete-id]');
    if (approveDeleteButton) {
      const deleteId = approveDeleteButton.dataset.confirmDeleteId;
      const data = readSavedViews(scope);
      data.items = data.items.filter(item => item.id !== deleteId);
      if (data.defaultId === deleteId) data.defaultId = null;
      writeSavedViews(scope, data);
      refreshOptions(activeViewId === deleteId ? '' : activeViewId);
      window.toast?.('Представление удалено', 'success');
      return;
    }
    if (event.target.closest('.saved-view-update')) {
      if (!activeViewId) return;
      const confirmed = await confirmAction({
        title: 'Обновить представление?',
        message: 'Сохранённые настройки выбранного представления будут заменены текущими.',
        confirmText: 'Обновить',
      });
      if (!confirmed) { refreshOptions(activeViewId); return; }
      const data = readSavedViews(scope);
      data.items = data.items.map(view => view.id === activeViewId
        ? { ...view, state: { toolbar: getToolbarViewState(scope), page: getPageState?.() || {} }, updatedAt: new Date().toISOString() }
        : view);
      writeSavedViews(scope, data);
      refreshOptions(activeViewId);
      appliedViewStateKey = savedViewStateKey(currentState());
      window.toast?.('Представление обновлено', 'success');
      updateDirtyIndicator();
      return;
    }
    if (event.target.closest('.saved-view-revert')) {
      if (!activeViewId) return;
      if (!(await applyView(activeViewId))) return;
      refreshOptions(activeViewId);
      viewsPopover.close();
      window.toast?.('Сохранённое представление восстановлено', 'success');
    }
  });
  dropdown.addEventListener('keydown', event => {
    if (!event.target.matches('.saved-view-rename-editor input')) return;
    if (event.key === 'Enter') { event.preventDefault(); event.target.closest('.saved-view-rename-editor')?.querySelector('[data-confirm-rename-id]')?.click(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); const row = event.target.closest('.saved-view-item'); event.target.closest('.saved-view-rename-editor')?.remove(); row?.querySelector('.saved-view-rename')?.focus(); }
  });
  saveBtn?.addEventListener('click', () => {
    if (!editor || !nameInput) return;
    viewsPopover.close({ restoreFocus: false });
    nameInput.value = '';
    if (defaultInput) defaultInput.checked = false;
    editorPopover.open();
    nameInput.focus();
  });
  $(`${scope}-saved-view-cancel`)?.addEventListener('click', () => { editorPopover.close(); });
  $(`${scope}-saved-view-confirm`)?.addEventListener('click', () => {
    const name = nameInput?.value.trim();
    if (!name) { window.toast?.('Введите название представления', 'warning'); return; }
    const data = readSavedViews(scope);
    if (data.items.some(view => view.name.trim().toLocaleLowerCase('ru-RU') === name.toLocaleLowerCase('ru-RU'))) {
      window.toast?.('Представление с таким названием уже существует', 'warning');
      return;
    }
    const id = globalThis.crypto?.randomUUID?.() || `view-${Date.now()}`;
    const item = { id, name, state: { toolbar: getToolbarViewState(scope), page: getPageState?.() || {} }, updatedAt: new Date().toISOString() };
    data.items = [...data.items, item];
    if (defaultInput?.checked) data.defaultId = id;
    writeSavedViews(scope, data);
    editorPopover.close();
    refreshOptions(id);
    appliedViewStateKey = savedViewStateKey(currentState());
    window.toast?.('Представление сохранено', 'success');
  });
  const defaultId = readSavedViews(scope).defaultId;
  if (defaultId) {
    refreshOptions(defaultId);
    applyView(defaultId, false);
  } else {
    refreshOptions('');
  }

  document.__savedViewDirtyCallbacks ||= {};
  document.__savedViewDirtyCallbacks[scope] = () => setTimeout(updateDirtyIndicator, 0);
  if (!document.__savedViewDirtyBound) {
    document.__savedViewDirtyBound = true;
    ['input', 'change', 'click', 'pointerup'].forEach(eventName => document.addEventListener(eventName, () => {
      Object.values(document.__savedViewDirtyCallbacks || {}).forEach(callback => callback());
    }));
  }
}

function syncColumnControls(scope) {
  const settings = columnSettingsRefs[scope];
  const order = columnOrderRefs[scope];
  const list = $(`${scope}-column-settings-list`);
  if (!settings || !list) return;
  list.querySelectorAll('.col-drag-item').forEach(item => {
    const key = item.dataset.col;
    const checkbox = item.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.checked = !!settings[key];
  });
  if (!Array.isArray(order)) return;
  const items = new Map(Array.from(list.querySelectorAll('.col-drag-item')).map(item => [item.dataset.col, item]));
  order.forEach(key => {
    const item = items.get(key);
    if (item) list.appendChild(item);
  });
  items.forEach((item, key) => { if (!order.includes(key)) list.appendChild(item); });
  updateColumnOrderNumbers(list);
}

export function getToolbarSearchValue(scope) {
  return searchValues[scope] || '';
}

function updateColumnOrderNumbers(list) {
  const items = list?.querySelectorAll('.col-drag-item');
  if (!items) return;
  list.style.setProperty('--ui-column-rows', Math.ceil(items.length / 2));
  items.forEach((item, index) => {
    const number = item.querySelector('.col-order-number');
    if (number) number.textContent = `${index + 1}.`;
  });
}

function getTaskFilterValue(task, column) {
  if (!column || !task) return null;
  if (column.computed === 'cv') return calculateTaskCv(task);
  for (const key of column.valueKeys || [column.key]) {
    const value = task[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function normalizeTaskFilterValues(value, column) {
  const values = column?.multipleValue
    ? (Array.isArray(value) ? value : String(value ?? '').split(','))
    : [value];
  return values.map(item => {
    if (item && typeof item === 'object') return String(item[column?.objectLabelKey || 'name'] ?? '');
    return String(item ?? '');
  }).map(item => item.trim()).filter(Boolean);
}

function isEmptyFilterValue(value, column) {
  return normalizeTaskFilterValues(value, column).length === 0;
}

function tokenValue(values, prefix) {
  const token = [...values].find(value => String(value).startsWith(prefix));
  return token == null ? '' : String(token).slice(prefix.length);
}

function matchesColumnFilter(task, column, values) {
  if (!column || !values?.size) return true;
  const rawValue = getTaskFilterValue(task, column);
  const isEmpty = isEmptyFilterValue(rawValue, column);
  const includeEmpty = values.has(EMPTY_FILTER_VALUE);
  if (isEmpty) return includeEmpty;

  if (column.type === 'text') {
    const query = tokenValue(values, FILTER_TOKEN_PREFIX.text).trim().toLocaleLowerCase('ru-RU');
    const normalizedValues = normalizeTaskFilterValues(rawValue, column);
    if (query) return normalizedValues.join(' ').toLocaleLowerCase('ru-RU').includes(query);
    const legacyValues = [...values].filter(value => value !== EMPTY_FILTER_VALUE && !String(value).startsWith('__'));
    return legacyValues.length ? normalizedValues.some(value => legacyValues.includes(value)) : false;
  }

  if (column.type === 'number') {
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) return includeEmpty;
    const minRaw = tokenValue(values, FILTER_TOKEN_PREFIX.min);
    const maxRaw = tokenValue(values, FILTER_TOKEN_PREFIX.max);
    const min = minRaw === '' ? null : Number(minRaw);
    const max = maxRaw === '' ? null : Number(maxRaw);
    if (column.key === 'progress' && ['0-25', '25-50', '50-75', '75-100'].some(range => values.has(range))) {
      return (values.has('0-25') && numericValue <= 25)
        || (values.has('25-50') && numericValue > 25 && numericValue <= 50)
        || (values.has('50-75') && numericValue > 50 && numericValue <= 75)
        || (values.has('75-100') && numericValue > 75);
    }
    const matchesRange = (min == null || numericValue >= min) && (max == null || numericValue <= max);
    return (min != null || max != null) ? matchesRange : false;
  }

  if (column.type === 'date') {
    const timestamp = Date.parse(rawValue);
    if (!Number.isFinite(timestamp)) return includeEmpty;
    const fromRaw = tokenValue(values, FILTER_TOKEN_PREFIX.from);
    const toRaw = tokenValue(values, FILTER_TOKEN_PREFIX.to);
    const from = fromRaw ? Date.parse(`${fromRaw}T00:00:00`) : null;
    const to = toRaw ? Date.parse(`${toRaw}T23:59:59.999`) : null;
    const legacyValues = [...values].filter(value => value !== EMPTY_FILTER_VALUE && !String(value).startsWith('__'));
    if (from == null && to == null && legacyValues.length) {
      return legacyValues.some(value => String(rawValue).startsWith(value));
    }
    const matchesRange = (from == null || timestamp >= from) && (to == null || timestamp <= to);
    return (from != null || to != null) ? matchesRange : false;
  }

  const normalized = column.type === 'boolean'
    ? [rawValue ? 'Да' : 'Нет']
    : normalizeTaskFilterValues(rawValue, column);
  return normalized.some(value => values.has(value));
}

function matchesQuickFilter(task, key) {
  const terminalStatuses = ['ВЫПОЛНЕНА', 'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА'];
  if (key === '_overdue') return task.deadline_id != null && !terminalStatuses.includes(task.status_name) && isDeadlinePast(task.deadline_name);
  if (key === '_urgent') return task.priority_name === 'ВЫСОКИЙ';
  if (key === '_current') return isCurrentTask(task);
  if (key === '_last_quarter') return isLastQuarterTask(task);
  if (key === '_active') return !!task.status_name && !terminalStatuses.includes(task.status_name) && task.status_name !== 'ХОЛД';
  if (key === '_hold') return task.status_name === 'ХОЛД';
  if (key === '_rejected') return task.status_name === 'ОТКЛОНЕНА';
  if (key === '_high_cv') {
    const cv = calculateTaskCv(task);
    return cv == null || cv > 1;
  }
  return null;
}

function matchesStoredFilter(task, key, values) {
  if (!values?.size) return true;
  if (key.startsWith('_')) return matchesQuickFilter(task, key) === true;
  return matchesColumnFilter(task, filterColumnsByKey[key], values);
}

export function sortFilterOptions(values, configured = []) {
  const configuredOrder = new Map(configured.map((option, index) => [
    String(option.value),
    Number.isFinite(Number(option.sort_order)) ? Number(option.sort_order) : index,
  ]));
  return [...values].sort((a, b) => {
    const ao = configuredOrder.get(String(a));
    const bo = configuredOrder.get(String(b));
    if (ao != null || bo != null) return (ao ?? Number.MAX_SAFE_INTEGER) - (bo ?? Number.MAX_SAFE_INTEGER) || String(a).localeCompare(String(b), 'ru');
    return String(a).localeCompare(String(b), 'ru');
  });
}

function getUniqueValues(scope, key, allTasks) {
  const column = filterColumnsByKey[key];
  if (!column || !['select', 'boolean'].includes(column.type)) return [];
  let list = allTasks || [];
  const cf = columnFilters[scope];
  if (cf) {
    Object.keys(cf).forEach(fk => {
      if (fk === key) return;
      const vals = cf[fk];
      if (vals?.size) list = list.filter(task => matchesStoredFilter(task, fk, vals));
    });
  }

  const hasEmpty = list.some(task => isEmptyFilterValue(getTaskFilterValue(task, column), column));
  if (column.type === 'boolean') {
    return [
      { value: 'Да', label: 'Да' },
      { value: 'Нет', label: 'Нет' },
      ...(hasEmpty ? [{ value: EMPTY_FILTER_VALUE, label: 'Не заполнено' }] : []),
    ];
  }

  const unique = new Set();
  list.forEach(t => {
    normalizeTaskFilterValues(getTaskFilterValue(t, column), column).forEach(value => unique.add(value));
  });
  const configured = directoryCache[key] || [];
  configured.forEach(option => unique.add(String(option.value)));
  const options = sortFilterOptions(unique, configured).map(value => ({ value, label: value }));
  if (hasEmpty) options.unshift({ value: EMPTY_FILTER_VALUE, label: 'Не заполнено' });
  return options;
}

export function renderToolbar(scope, opts = {}) {
  const colOpts = opts.columnSettings || {};
  const colLabels = opts.columnLabels || {};
  filterLabelsRefs[scope] = { ...colLabels };
  const colOrder = opts.columnOrder || Object.keys(colOpts);
  const getLabel = (k) => colLabels[k] || k;

  const viewToggleHtml = `
    <div class="view-toggle" id="${scope}-view-toggle-group" aria-label="Режим отображения">
      <button class="square-icon btn btn-secondary btn-sm ui-btn toggle-btn active" data-view="table" title="Табличное представление" aria-label="Табличное представление">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line></svg>
      </button>
      <button class="square-icon btn btn-secondary btn-sm ui-btn toggle-btn" data-view="cards" title="Карточное представление" aria-label="Карточное представление">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
      </button>
    </div>`;

  const columnSettingsHtml = `
    <div class="relative" id="${scope}-column-settings-wrapper">
      <button class="btn btn-secondary btn-sm square-icon" id="${scope}-btn-column-settings" title="Настройка отображения столбцов" aria-label="Настройка отображения столбцов">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
      </button>
      <div class="column-settings-dropdown ui-popover-columns" id="${scope}-column-settings-dropdown" hidden>
        <div class="ui-popover-header"><strong class="ui-popover-title">Колонки</strong><button type="button" class="btn btn-ghost btn-sm square-icon ui-btn" data-close-columns aria-label="Закрыть настройки колонок">×</button></div>
        <div class="ui-popover-actions">
          <button class="btn btn-ghost btn-sm" id="${scope}-col-select-all">Выбрать все</button>
          <button class="btn btn-ghost btn-sm" id="${scope}-col-default">Стандартный вид</button>
          <button class="btn btn-ghost btn-sm" id="${scope}-col-clear-all">Очистить все</button>
        </div>
        <p class="ui-popover-hint">ID всегда виден первым. Остальные колонки: перетащите строку или используйте Alt + ↑ / ↓ на флажке.</p>
        <div class="column-settings-list" id="${scope}-column-settings-list">
          ${colOrder.map(key => {
            const val = colOpts[key];
            if (val === undefined) return '';
            return `<div class="col-drag-item" data-col="${escapeAttr(key)}">
              <span class="col-drag-handle" aria-hidden="true">⠿</span>
              <span class="col-order-number" aria-hidden="true"></span>
              <label class="ui-selection-option"><input type="checkbox" data-col="${escapeAttr(key)}" ${key === 'id' ? 'checked disabled' : val ? 'checked' : ''}><span>${escapeAttr(getLabel(key))}</span></label>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;

  const title = opts.title || '';
  const subtitle = opts.subtitle || '';
  const canWrite = hasWritePermission(scope);
  const addTaskHtml = (canWrite && opts.addTask) ? `<button class="btn btn-primary btn-sm ui-responsive-icon toolbar-add-task" id="${scope}-add-task-btn" title="Добавить задачу" aria-label="Добавить задачу"><i data-lucide="plus"></i><span class="ui-responsive-icon-label toolbar-add-task-label">Добавить задачу</span></button>` : '';
  const savedViewsHtml = opts.savedViews ? renderSavedViewsControl(scope) : '';

  const bulkOpsTitle = escapeAttr(opts.bulkOpsTitle || 'Массовые операции');
  const bulkOpsMenuAttrs = opts.bulkOpsMenu ? ' aria-haspopup="menu" aria-expanded="false"' : '';
  const bulkOpsBtn = opts.onBulkOps ? `<button class="btn btn-secondary btn-sm square-icon qe-toggle" id="${scope}-bulk-open" title="${bulkOpsTitle}" aria-label="${bulkOpsTitle}"${bulkOpsMenuAttrs} style="white-space:nowrap;flex-shrink:0;"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg></button>` : '';

  const quickEditBtn = opts.onQuickEdit ? `<button class="btn btn-secondary btn-sm square-icon qe-toggle" id="${scope}-inline-edit" title="Быстрое редактирование" style="white-space:nowrap;flex-shrink:0;"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>` : '';

  const importBtn = (canWrite && opts.onImport) ? `<button class="btn btn-secondary btn-sm square-icon" id="${scope}-import-excel" title="Импорт из Excel"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg></button>` : '';
  const exportBtn = opts.excel !== false ? `<button class="btn btn-secondary btn-sm square-icon" id="${scope}-export-excel" title="Экспорт в CSV"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></button>` : '';
  const refreshBtn = opts.refresh !== false ? `<button class="btn btn-secondary btn-sm square-icon" id="${scope}-btn-refresh" title="Обновить"><i data-lucide="refresh-ccw"></i></button>` : '';
  const hasNonTransferActions = !!(addTaskHtml || savedViewsHtml || opts.columnSettings || opts.viewToggle !== false || quickEditBtn || bulkOpsBtn || refreshBtn);
  const transferActionsHtml = (importBtn || exportBtn) ? `
      <span class="toolbar-import-export-group" role="group" aria-label="Импорт и экспорт">
        ${hasNonTransferActions ? '<span class="toolbar-actions-divider" aria-hidden="true"></span>' : ''}
        ${importBtn}
        ${exportBtn}
      </span>` : '';

  const hasActions = !!(addTaskHtml || bulkOpsBtn || quickEditBtn || importBtn || opts.viewToggle !== false || opts.columnSettings || opts.excel !== false || opts.refresh !== false);

  const actionsHtml = hasActions ? `
    <div class="toolbar-actions">
      ${addTaskHtml}
      ${savedViewsHtml}
      ${opts.columnSettings ? columnSettingsHtml : ''}
      ${opts.viewToggle !== false ? viewToggleHtml : ''}
      ${quickEditBtn}${bulkOpsBtn}${transferActionsHtml}${refreshBtn}
    </div>` : '';

  return `
    <div class="sticky-toolbar" data-version="3">
      <div class="ui-toolbar-stack">
        ${pageHeader({ title, description: subtitle, actions: actionsHtml })}
        <div class="filter-panel" data-filter-scope="${scope}">
          <div class="filter-toolbar-row">
            <div class="relative filter-search-wrap">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="position:absolute;left:8px;top:50%;transform:translateY(-50%);color:var(--text-muted);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input class="input ui-control" id="f-${scope}-search" value="${escapeAttr(searchValues[scope] || '')}" aria-label="Поиск по ID, названию и описанию" placeholder="Поиск по ID и названию…">
            </div>
            <div id="f-${scope}-main-filters" class="pinned-filters-row" aria-label="Закреплённые фильтры"></div>
            <div class="filter-toolbar-controls">
              <button id="btn-ext-${scope}" class="btn btn-secondary btn-sm filter-catalog-trigger" aria-expanded="false" aria-controls="f-${scope}-ext-filters">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line><line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line><line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line><line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line><line x1="17" y1="16" x2="23" y2="16"></line></svg>
                <span id="btn-ext-${scope}-text">Все фильтры</span>
                <svg id="chev-ext-${scope}" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <button id="f-${scope}-reset" class="btn btn-secondary btn-sm filter-reset-btn">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                Сброс
              </button>
            </div>
          </div>
          <div id="f-${scope}-ext-filters" class="filter-catalog-panel hidden">
            <div class="filter-catalog-header">
              <div>
                <strong>Все фильтры</strong>
                <span>${scope === 'backlog' ? 'Поиск и полный набор условий' : `Закрепите до ${MAX_PINNED_FILTERS} важных фильтров`}</span>
              </div>
              <div class="filter-catalog-header-actions">
                ${scope === 'backlog' ? '' : `<button type="button" class="btn btn-secondary btn-sm ui-btn filter-pins-reset" data-reset-pinned-filters="${scope}">По умолчанию</button>`}
                <button type="button" class="btn btn-ghost btn-sm square-icon ui-btn filter-catalog-close" data-filter-catalog-close="${scope}" aria-label="Закрыть все фильтры"><i data-lucide="x"></i></button>
              </div>
            </div>
            <label class="filter-catalog-search-wrap">
              <i data-lucide="search" aria-hidden="true"></i>
              <input type="search" id="f-${scope}-catalog-search" class="input ui-control filter-catalog-search" placeholder="Найти фильтр…" aria-label="Найти фильтр">
            </label>
            <div id="f-${scope}-ext-row" class="filter-catalog-groups"></div>
          </div>
        </div>
        <p id="${scope}-edit-hint" class="ui-popover-hint" hidden></p>
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
    showSavedViewRevert = true,
    getSavedViewState,
    applySavedViewState,
    beforeApplySavedView,
  } = opts;

  columnSettingsRefs[scope] = columnSettings;
  columnOrderRefs[scope] = columnOrder;
  defaultColumnSettingsRefs[scope] = defaultColumnSettings || null;

  const getLabel = (k) => columnLabels[k] || k;
  initSavedViews(scope, getSavedViewState, applySavedViewState, {
    showRevertAction: showSavedViewRevert,
    beforeApply: beforeApplySavedView,
  });

  const viewGroup = document.getElementById(`${scope}-view-toggle-group`);
  let switchingView = false;
  if (viewGroup) {
    viewGroup.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (switchingView) return;
        switchingView = true;
        let accepted;
        try { accepted = await onViewChange?.(btn.dataset.view); }
        finally { switchingView = false; }
        if (accepted === false) return;
        viewGroup.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        syncTableOnlyActions(btn.dataset.view === 'table');
      });
    });
  }

  const colBtn = document.getElementById(`${scope}-btn-column-settings`);
  const colDropdown = document.getElementById(`${scope}-column-settings-dropdown`);
  const colList = document.getElementById(`${scope}-column-settings-list`);
  if (colBtn && colDropdown) {
    const columnsPopover = bindPopover({ trigger: colBtn, panel: colDropdown, label: 'Настройка колонок', align: 'end' });
    colDropdown.querySelector('[data-close-columns]')?.addEventListener('click', () => columnsPopover.close());

    function onColCheckChange(e) {
      const cb = e.target;
      const col = cb.dataset.col;
      if (columnSettings && col) columnSettings[col] = col === 'id' || cb.checked;
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
        cb.checked = cb.dataset.col === 'id' || !!columnSettings[cb.dataset.col];
      });
    }

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
          cb.checked = cb.dataset.col === 'id';
          const col = cb.dataset.col;
          if (columnSettings) columnSettings[col] = col === 'id';
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
      updateColumnOrderNumbers(colList);
      colList.addEventListener('keydown', event => {
        if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
        const row = event.target.closest('.col-drag-item');
        if (!row) return;
        event.preventDefault(); event.stopPropagation();
        const sibling = event.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
        if (!sibling || row.dataset.col === 'id' || sibling.dataset.col === 'id') return;
        colList.insertBefore(row, event.key === 'ArrowUp' ? sibling : sibling.nextSibling);
        columnOrder.splice(0, columnOrder.length, ...[...colList.children].map(item => item.dataset.col));
        updateColumnOrderNumbers(colList);
        event.target.focus();
        onColumnOrderChange?.();
      });
      let dragSrc = null;
      let dropTarget = null;
      let dropPosition = null;
      const clearDropIndicators = () => {
        dropTarget?.classList.remove('drop-before', 'drop-after');
        dropTarget = null;
        dropPosition = null;
      };
      const setDropIndicator = (target, position) => {
        if (dropTarget === target && dropPosition === position) return;
        clearDropIndicators();
        dropTarget = target;
        dropPosition = position;
        dropTarget.classList.add(position);
      };
      let dragStartX = 0;
      let dragStartY = 0;
      let dragStarted = false;
      const finishPointerDrag = (commit) => {
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
        document.removeEventListener('pointercancel', onPointerCancel);
        if (commit && dragStarted && dragSrc && dropTarget && dropTarget !== dragSrc) {
          colList.insertBefore(dragSrc, dropPosition === 'drop-before' ? dropTarget : dropTarget.nextSibling);
        }
        const changed = commit && dragStarted && !!dropTarget;
        dragSrc?.classList.remove('is-dragging');
        dragSrc = null;
        dragStarted = false;
        clearDropIndicators();
        if (!changed) return;
        const newOrder = Array.from(colList.querySelectorAll('.col-drag-item')).map(el => el.dataset.col);
        columnOrder.length = 0;
        newOrder.forEach(k => columnOrder.push(k));
        updateColumnOrderNumbers(colList);
        if (onColumnOrderChange) onColumnOrderChange();
      };
      const onPointerMove = (e) => {
        if (!dragSrc) return;
        if (!dragStarted && Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) < 4) return;
        if (!dragStarted) {
          dragStarted = true;
          dragSrc.classList.add('is-dragging');
        }
        e.preventDefault();
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.col-drag-item');
        if (!target || target.dataset.col === 'id' || target === dragSrc || !colList.contains(target)) return;
        const rect = target.getBoundingClientRect();
        const sourceRect = dragSrc.getBoundingClientRect();
        const differentVisualColumn = Math.abs(sourceRect.left - rect.left) > Math.min(sourceRect.width, rect.width) / 2;
        let insertBefore;
        if (differentVisualColumn) {
          const items = Array.from(colList.querySelectorAll('.col-drag-item'));
          insertBefore = items.indexOf(dragSrc) > items.indexOf(target);
        } else {
          insertBefore = e.clientY < rect.top + rect.height / 2;
        }
        setDropIndicator(target, insertBefore ? 'drop-before' : 'drop-after');
      };
      const onPointerUp = () => finishPointerDrag(true);
      const onPointerCancel = () => finishPointerDrag(false);
      colList.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('input, button')) return;
        const item = e.target.closest('.col-drag-item');
        if (item?.dataset.col === 'id') return;
        if (!item) return;
        dragSrc = item;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        document.addEventListener('pointermove', onPointerMove, { passive: false });
        document.addEventListener('pointerup', onPointerUp, { once: true });
        document.addEventListener('pointercancel', onPointerCancel, { once: true });
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

  const tableOnlyActions = [
    document.getElementById(`${scope}-inline-edit`),
    document.getElementById(`${scope}-bulk-open`),
  ].filter(Boolean);
  const activeTableBtn = viewGroup?.querySelector('.toggle-btn.active[data-view="table"]');
  const isTableView = !!(activeTableBtn);

  function syncTableOnlyActions(isTable) {
    tableOnlyActions.forEach(button => {
      button.disabled = !isTable || !!button.dataset.editUnavailable;
      button.setAttribute('aria-disabled', String(button.disabled));
    });
  }

  syncTableOnlyActions(isTableView);

}

export function initToolbar(scope, allTasks, onFilterChange) {
  filterChangeCallbacks[scope] = onFilterChange;
  allTasksCache[scope] = allTasks;

  loadDirectories().then(() => { renderFilterButtons(scope, allTasksCache[scope]); });

  function renderAll() {
    renderFilterButtons(scope, allTasksCache[scope]);
    onFilterChange();
    updateStickyOffsets();
  }

  function applySearchSort() {
    // Не вызываем renderFilterButtons, чтобы не уничтожать открытые дропдауны
    onFilterChange();
    updateStickyOffsets();
  }

  const searchInput = $(`f-${scope}-search`);
  // The toolbar is visible while the initial task request is still loading.
  // Preserve text entered before its input listener could be attached.
  const earlySearchChanged = searchInput && searchInput.value !== (searchValues[scope] || '');
  if (searchInput) searchValues[scope] = searchInput.value;

  let searchTimer;
  searchInput?.addEventListener('input', () => {
    searchValues[scope] = searchInput.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      applySearchSort();
    }, 250);
  });

  $(`f-${scope}-reset`)?.addEventListener('click', () => {
    columnFilters[scope] = {};
    searchValues[scope] = '';
    sortValues[scope] = 'id-desc';
    if (searchInput) searchInput.value = '';
    clearQuickFilterVisualState();
    renderAll();
  });

  const catalogPanel = $(`f-${scope}-ext-filters`);
  const catalogTrigger = $(`btn-ext-${scope}`);
  const catalogPopover = catalogPanel && catalogTrigger ? createPopover({
    trigger: catalogTrigger, panel: catalogPanel, label: 'Все фильтры', align: 'end',
    onClose: () => { catalogPanel.classList.add('hidden');  },
  }) : null;
  function setCatalogOpen(open) {
    if (!catalogPopover) return;
    if (open) {
      catalogPanel.classList.remove('hidden'); catalogPopover.open();
      $(`f-${scope}-catalog-search`)?.focus();
    } else catalogPopover.close();
  }
  catalogTrigger?.addEventListener('click', () => setCatalogOpen(!catalogPopover?.isOpen));

  document.querySelectorAll(`[data-filter-catalog-close="${scope}"]`).forEach(button => {
    button.addEventListener('click', () => setCatalogOpen(false));
  });

  $(`f-${scope}-ext-filters`)?.querySelector(`[data-reset-pinned-filters="${scope}"]`)?.addEventListener('click', () => {
    writePinnedFilters(scope, DEFAULT_PINNED_FILTERS[scope] || DEFAULT_PINNED_FILTERS.backlog);
    renderFilterButtons(scope, allTasksCache[scope] || []);
    window.toast?.('Закреплённые фильтры восстановлены', 'success');
    updateStickyOffsets();
  });

  $(`f-${scope}-catalog-search`)?.addEventListener('input', event => {
    applyFilterCatalogSearch(scope, event.target.value);
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderFilterButtons(scope, allTasksCache[scope]);
      catalogPopover?.position();
    }, 150);
  });

  renderFilterButtons(scope, allTasksCache[scope]);
  if (earlySearchChanged) applySearchSort();
}

export function getFilteredList(scope, allTasks) {
  if (!allTasks || !allTasks.length) return [];
  let list = [...allTasks];

  const q = searchValues[scope] ? searchValues[scope].toLowerCase() : '';
  if (q) {
    list = list.filter(t =>
      String(t.id).includes(q) ||
      formatTaskPublicId(t).toLowerCase().includes(q) ||
      (t.title && t.title.toLowerCase().includes(q)) ||
      (t.description && t.description.toLowerCase().includes(q))
    );
  }

  const cf = columnFilters[scope];
  if (cf) {
    Object.keys(cf).forEach(key => {
      const vals = cf[key];
      if (vals?.size) list = list.filter(task => matchesStoredFilter(task, key, vals));
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
  const tableOrder = [...visibleKeys, ...TASK_COLUMNS.map(column => column.key).filter(key => !visibleKeys.includes(key))];
  return tableOrder.map(key => filterColumnsByTableColumn[key]).filter(Boolean);
}

function getFilterLabel(scope, column) {
  return column.filterLabel || filterLabelsRefs[scope]?.[column.columnKey] || column.label;
}

function getFilterValueText(column, values) {
  if (!values?.size) return 'Все';
  const includeEmpty = values.has(EMPTY_FILTER_VALUE);
  const legacyValues = [...values].filter(value => value !== EMPTY_FILTER_VALUE && !String(value).startsWith('__'));
  if (column.type === 'text') {
    const query = tokenValue(values, FILTER_TOKEN_PREFIX.text);
    if (query && includeEmpty) return `«${query}» или пусто`;
    if (query) return `содержит «${query}»`;
    if (legacyValues.length) return legacyValues.length === 1 ? legacyValues[0] : `${legacyValues.length} выбрано`;
    return includeEmpty ? 'Не заполнено' : 'Все';
  }
  if (column.type === 'number') {
    const min = tokenValue(values, FILTER_TOKEN_PREFIX.min);
    const max = tokenValue(values, FILTER_TOKEN_PREFIX.max);
    if (min && max) return `${min}–${max}${column.suffix || ''}`;
    if (min) return `от ${min}${column.suffix || ''}`;
    if (max) return `до ${max}${column.suffix || ''}`;
    if (legacyValues.length) return legacyValues.length === 1 ? legacyValues[0] : `${legacyValues.length} выбрано`;
    return includeEmpty ? 'Не заполнено' : 'Все';
  }
  if (column.type === 'date') {
    const from = tokenValue(values, FILTER_TOKEN_PREFIX.from);
    const to = tokenValue(values, FILTER_TOKEN_PREFIX.to);
    if (from && to) return `${from} — ${to}`;
    if (from) return `с ${from}`;
    if (to) return `до ${to}`;
    if (legacyValues.length) return legacyValues.length === 1 ? legacyValues[0] : `${legacyValues.length} выбрано`;
    return includeEmpty ? 'Не заполнено' : 'Все';
  }
  const labels = [...values].map(value => value === EMPTY_FILTER_VALUE ? 'Не заполнено' : value);
  return labels.length === 1 ? labels[0] : `${labels.length} выбрано`;
}

function applyFilterCatalogSearch(scope, query = '') {
  const normalized = String(query).trim().toLocaleLowerCase('ru-RU');
  const root = $(`f-${scope}-ext-row`);
  if (!root) return;
  root.querySelectorAll('.filter-catalog-item').forEach(item => {
    item.hidden = normalized !== '' && !item.dataset.filterSearch.includes(normalized);
  });
  root.querySelectorAll('.filter-catalog-group').forEach(group => {
    group.hidden = !group.querySelector('.filter-catalog-item:not([hidden])');
  });
}

function renderFilterButtons(scope, allTasks) {
  allTasksCache[scope] = allTasks || [];
  const mainC = $(`f-${scope}-main-filters`);
  const extC = $(`f-${scope}-ext-row`);
  if (!mainC) return;

  const cf = columnFilters[scope];
  const sortedColumns = getSortedFilterColumns(scope);
  const pinnedKeys = readPinnedFilters(scope);
  const pinnedColumns = pinnedKeys.map(key => filterColumnsByKey[key]).filter(Boolean);

  function clearFilter(e, key) {
    e.stopPropagation();
    delete columnFilters[scope][key];
    renderFilterButtons(scope, allTasks);
    const cb = filterChangeCallbacks[scope];
    if (cb) cb();
  }

  const renderBtn = (col, placement = 'catalog') => {
    const hasValue = cf[col.key] && cf[col.key].size > 0;
    const label = getFilterLabel(scope, col);
    const valueText = getFilterValueText(col, cf[col.key]);
    const isPinned = pinnedKeys.includes(col.key);
    const filterCell = `<div class="filter-cell" data-filter-scope="${scope}" data-filter-key="${col.key}">
      <button type="button" class="btn btn-secondary btn-sm ui-btn filter-btn ${hasValue ? 'has-value' : ''}" data-scope="${scope}" data-key="${col.key}" aria-haspopup="dialog">
        <svg class="filter-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
        <span class="filter-label">${escapeAttr(label)}:</span>
        <span class="filter-value">${escapeAttr(valueText)}</span>
        <svg class="filter-chevron" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>
      ${hasValue ? `<button type="button" class="btn btn-ghost btn-sm square-icon ui-btn filter-clear" data-filter-clear="${col.key}" title="Очистить фильтр" aria-label="Очистить фильтр ${escapeAttr(label)}"><svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>` : ''}
    </div>`;
    if (placement === 'pinned') return filterCell;
    if (scope === 'backlog') return `<div class="filter-catalog-item" data-filter-search="${escapeAttr(`${label} ${col.group}`.toLocaleLowerCase('ru-RU'))}">${filterCell}</div>`;
    const pinTitle = isPinned ? 'Открепить фильтр' : 'Закрепить фильтр на панели';
    return `<div class="filter-catalog-item" data-filter-search="${escapeAttr(`${label} ${col.group}`.toLocaleLowerCase('ru-RU'))}">
      ${filterCell}
      <button type="button" class="btn btn-ghost btn-sm square-icon ui-btn filter-pin ${isPinned ? 'is-pinned' : ''}" data-pin-filter="${col.key}" aria-pressed="${isPinned}" title="${pinTitle}" aria-label="${pinTitle}: ${escapeAttr(label)}">
        <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"></path><path d="M5 4h14l-3 6v4l2 2H6l2-2v-4Z"></path></svg>
      </button>
    </div>`;
  };

  mainC.innerHTML = pinnedColumns.map(column => renderBtn(column, 'pinned')).join('');
  if (extC) {
    extC.innerHTML = FILTER_GROUP_ORDER.map(group => {
      const columns = sortedColumns.filter(column => column.group === group);
      if (!columns.length) return '';
      return `<section class="filter-catalog-group" data-filter-group="${escapeAttr(group)}">
        <h3>${escapeAttr(group)}</h3>
        <div class="filter-catalog-grid">${columns.map(column => renderBtn(column)).join('')}</div>
      </section>`;
    }).join('');
  }

  document.querySelectorAll(`[data-scope="${scope}"].filter-btn`).forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      toggleDropdown(e, scope, key, allTasks);
    });
  });

  document.querySelectorAll(`[data-filter-clear]`).forEach(el => {
    el.addEventListener('click', (e) => clearFilter(e, el.dataset.filterClear));
  });

  document.querySelectorAll(`[data-pin-filter]`).forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      const key = button.dataset.pinFilter;
      const next = readPinnedFilters(scope);
      const index = next.indexOf(key);
      if (index >= 0) next.splice(index, 1);
      else if (next.length >= MAX_PINNED_FILTERS) {
        window.toast?.(`Можно закрепить не более ${MAX_PINNED_FILTERS} фильтров`, 'warning');
        return;
      } else next.push(key);
      writePinnedFilters(scope, next);
      renderFilterButtons(scope, allTasks);
      applyFilterCatalogSearch(scope, $(`f-${scope}-catalog-search`)?.value || '');
      updateStickyOffsets();
    });
  });

  const extActive = Object.keys(cf).filter(k => cf[k] && cf[k].size > 0).length;
  const btnTxt = $(`btn-ext-${scope}-text`);
  if (btnTxt) btnTxt.textContent = extActive > 0 ? `Все фильтры (${extActive})` : 'Все фильтры';
  applyFilterCatalogSearch(scope, $(`f-${scope}-catalog-search`)?.value || '');
  updateActiveFiltersRow(scope);
}

function updateActiveFiltersRow(scope) {
  const container = $(`f-${scope}-active-filters`);
  if (!container) return;
  const cf = columnFilters[scope];
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
    const column = filterColumnsByKey[key];
    const colLabel = column ? getFilterLabel(scope, column) : key;
    const valueText = column ? getFilterValueText(column, vals) : (vals.size === 1 ? [...vals][0] : `${vals.size} выбрано`);
    chips.push({ key, label: colLabel, value: valueText });
  });
  if (chips.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = chips.map(ch => `
    <span class="active-filter-chip" data-key="${ch.key}">
      <span class="chip-label">${escapeAttr(ch.label)}:</span>
      <span class="chip-value">${escapeAttr(ch.value)}</span>
      <button class="btn btn-ghost btn-sm square-icon ui-btn chip-clear" data-clear="${ch.key}" title="Очистить фильтр">
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

let activeFilterPopover = null;
let activeFilterTrigger = null;
function toggleDropdown(event, scope, key, allTasks) {
  const trigger = event.currentTarget;
  const inCatalog = Boolean(trigger.closest('.filter-catalog-item'));
  if (activeFilterPopover?.isOpen && activeFilterTrigger === trigger) { activeFilterPopover.close(); return; }
  activeFilterPopover?.close({ restoreFocus: false });
  activeFilterTrigger = trigger;

  const column = filterColumnsByKey[key];
  if (!column) return;
  const currentSelected = columnFilters[scope][key] ? new Set(columnFilters[scope][key]) : new Set();
  const options = getUniqueValues(scope, key, allTasks);
  const includeEmpty = currentSelected.has(EMPTY_FILTER_VALUE);
  const label = getFilterLabel(scope, column);

  const dd = document.createElement('div');
  dd.className = 'filter-dropdown';
  dd.setAttribute('role', 'dialog');
  dd.setAttribute('aria-label', `Фильтр: ${label}`);
  dd.onclick = (e) => e.stopPropagation();

  const emptyToggle = `<label class="ui-selection-option fd-empty-option">
    <input type="checkbox" class="fd-empty" ${includeEmpty ? 'checked' : ''}>
    <span>Не заполнено</span>
  </label>`;

  let controls = '';
  if (['select', 'boolean'].includes(column.type)) {
    controls = `
      <input type="search" class="input ui-control fd-search" placeholder="Поиск значения…" aria-label="Поиск значения">
      ${selectionList({ items: options, selected: currentSelected, itemAttribute: 'data-val', className: 'fd-options' })}`;
  } else if (column.type === 'text') {
    controls = `
      <label class="fd-field-label" for="fd-text-${scope}-${key}">Содержит текст</label>
      <input type="search" class="input ui-control fd-text" id="fd-text-${scope}-${key}" value="${escapeAttr(tokenValue(currentSelected, FILTER_TOKEN_PREFIX.text))}" placeholder="Введите фрагмент…">
      ${emptyToggle}`;
  } else if (column.type === 'number') {
    controls = `
      ${numberRange({ id: `fd-range-${scope}-${key}`, label, from: { value: tokenValue(currentSelected, FILTER_TOKEN_PREFIX.min), controlClassName: 'fd-min', min: column.min, max: column.max, step: column.step || 'any' }, to: { value: tokenValue(currentSelected, FILTER_TOKEN_PREFIX.max), controlClassName: 'fd-max', min: column.min, max: column.max, step: column.step || 'any' } })}
      ${emptyToggle}`;
  } else if (column.type === 'date') {
    controls = `
      ${dateRange({ id: `fd-range-${scope}-${key}`, label, from: { label: 'С даты', value: tokenValue(currentSelected, FILTER_TOKEN_PREFIX.from), controlClassName: 'fd-from' }, to: { label: 'По дату', value: tokenValue(currentSelected, FILTER_TOKEN_PREFIX.to), controlClassName: 'fd-to' } })}
      ${emptyToggle}`;
  }

  dd.classList.add('ui-filter-popover');
  dd.innerHTML = `<div class="ui-popover-header ui-popover-title fd-title">${escapeAttr(label)}</div>${controls}
    <p class="fd-error" id="fd-error-${scope}-${key}" role="alert" hidden></p>
    <div class="ui-popover-actions fd-actions">
      <button type="button" class="btn btn-secondary btn-sm ui-btn fd-clear">Очистить</button>
      <button type="button" class="btn btn-primary btn-sm ui-btn fd-apply">Применить</button>
    </div>`;

  const popover = createPopover({ trigger, panel: dd, label: `Фильтр: ${label}`, removeOnClose: true,
    resolveTrigger: () => trigger.isConnected ? trigger : document.querySelector(`${inCatalog ? ".filter-catalog-item " : ""}[data-filter-scope="${scope}"][data-filter-key="${key}"] button`) || trigger,
  });
  activeFilterPopover = popover;
  popover.open();

  dd.querySelector('.fd-search')?.addEventListener('input', (e) => {
    filterSelectionList(dd.querySelector('.fd-options'), e.target.value);
  });

  function notifyChange() {
    const cb = filterChangeCallbacks[scope];
    if (cb) cb();
  }

  function showRangeError(selector, message) {
    const field = dd.querySelector(selector);
    const error = dd.querySelector('.fd-error');
    error.textContent = message;
    error.hidden = false;
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', error.id);
    field.focus();
  }
  dd.addEventListener('input', () => {
    dd.querySelectorAll('[aria-invalid]').forEach(field => { field.removeAttribute('aria-invalid'); field.removeAttribute('aria-describedby'); });
    dd.querySelector('.fd-error').hidden = true;
  });

  dd.querySelector('.fd-clear')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dd.querySelectorAll('input:not(:disabled)').forEach(input => {
      if (input.type === 'checkbox') input.checked = false;
      else input.value = '';
    });
    const options = dd.querySelector('.fd-options');
    if (options) filterSelectionList(options, '');
    dd.querySelector('.fd-error').hidden = true;
  });

  dd.querySelector('.fd-apply')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const vals = new Set();
    const invalidEndpoint = [...dd.querySelectorAll('.ui-interval input')].find(input => !input.validity.valid);
    if (invalidEndpoint) { invalidEndpoint.reportValidity(); return; }
    const invalidOrder = Object.keys(validateRanges(dd)).length > 0;
    if (['select', 'boolean'].includes(column.type)) {
      dd.querySelectorAll('.fd-options input[type="checkbox"]:checked').forEach(checkbox => vals.add(checkbox.dataset.val));
    } else if (column.type === 'text') {
      const value = dd.querySelector('.fd-text')?.value.trim();
      if (value) vals.add(FILTER_TOKEN_PREFIX.text + value);
      if (dd.querySelector('.fd-empty')?.checked) vals.add(EMPTY_FILTER_VALUE);
    } else if (column.type === 'number') {
      const min = dd.querySelector('.fd-min')?.value;
      const max = dd.querySelector('.fd-max')?.value;
      if (invalidOrder) {
        showRangeError('.fd-min', 'Значение «От» не может быть больше значения «До»');
        return;
      }
      if (min !== '') vals.add(FILTER_TOKEN_PREFIX.min + min);
      if (max !== '') vals.add(FILTER_TOKEN_PREFIX.max + max);
      if (dd.querySelector('.fd-empty')?.checked) vals.add(EMPTY_FILTER_VALUE);
    } else if (column.type === 'date') {
      const from = dd.querySelector('.fd-from')?.value;
      const to = dd.querySelector('.fd-to')?.value;
      if (invalidOrder) {
        showRangeError('.fd-from', 'Начальная дата не может быть позже конечной');
        return;
      }
      if (from) vals.add(FILTER_TOKEN_PREFIX.from + from);
      if (to) vals.add(FILTER_TOKEN_PREFIX.to + to);
      if (dd.querySelector('.fd-empty')?.checked) vals.add(EMPTY_FILTER_VALUE);
    }
    if (vals.size > 0) {
      columnFilters[scope][key] = vals;
    } else {
      delete columnFilters[scope][key];
    }
    popover.close({ restoreFocus: false });
    renderFilterButtons(scope, allTasks);
    notifyChange();
    popover.restoreFocus();
  });


}

let toolbarOffsetObserver = null;
let observedToolbar = null;
let toolbarMainContentObserver = null;
let observedToolbarMainContent = null;

function syncStickyToolbarWidth(toolbar, mainContent) {
  if (!toolbar || !mainContent) return;
  const mainStyle = getComputedStyle(mainContent);
  const mainBorders = (parseFloat(mainStyle.borderLeftWidth) || 0)
    + (parseFloat(mainStyle.borderRightWidth) || 0);
  const mainContentScrollbarWidth = Math.max(
    0,
    mainContent.offsetWidth - mainContent.clientWidth - mainBorders,
  );
  toolbar.style.setProperty('--main-content-scrollbar-width', `${mainContentScrollbarWidth}px`);
}

export function updateStickyOffsets() {
  // Architecture and regression checklist: docs/STICKY_BACKLOG_TABLES.md
  requestAnimationFrame(() => {
    const toolbar = document.querySelector('.sticky-toolbar');
    if (!toolbar) return;
    if (toolbar !== observedToolbar && typeof ResizeObserver !== 'undefined') {
      toolbarOffsetObserver?.disconnect();
      observedToolbar = toolbar;
      toolbarOffsetObserver = new ResizeObserver(() => updateStickyOffsets());
      toolbarOffsetObserver.observe(toolbar);
    }
    const style = getComputedStyle(document.documentElement);
    const navbarHeight = parseFloat(style.getPropertyValue('--navbar-height')) || 64;
    const mainContent = document.querySelector('.main-content');
    if (mainContent !== observedToolbarMainContent && typeof ResizeObserver !== 'undefined') {
      toolbarMainContentObserver?.disconnect();
      observedToolbarMainContent = mainContent;
      if (mainContent) {
        toolbarMainContentObserver = new ResizeObserver(() => updateStickyOffsets());
        toolbarMainContentObserver.observe(mainContent);
      }
    }
    syncStickyToolbarWidth(toolbar, mainContent);
    const toolbarIsFixed = getComputedStyle(toolbar).position === 'fixed';
    const toolbarBottom = Math.max(navbarHeight, toolbar.getBoundingClientRect().bottom);

    const qe = Array.from(document.querySelectorAll('.qe-toolbar'))
      .find(el => getComputedStyle(el).display !== 'none');
    if (qe) qe.style.top = 'auto';

    // .qe-toolbar is sticky inside .main-content, so its `top` is relative to
    // the scroll container's padding box rather than to the viewport used by
    // fixed headers.
    const mainContentTop = mainContent?.getBoundingClientRect().top || navbarHeight;
    const mainPaddingTop = mainContent ? parseFloat(getComputedStyle(mainContent).paddingTop) || 0 : 0;
    const qeStickyTop = toolbarIsFixed
      ? Math.max(0, toolbarBottom - mainContentTop - mainPaddingTop)
      : toolbar.offsetHeight;
    document.documentElement.style.setProperty('--qe-sticky-top', qeStickyTop + 'px');

    const offset = (qe && getComputedStyle(qe).position === 'sticky')
      ? Math.ceil(Math.max(toolbarBottom, qe.getBoundingClientRect().bottom))
      : Math.ceil(toolbarBottom);
    document.documentElement.style.setProperty('--sticky-thead-offset', offset + 'px');

    const contentWrappers = document.querySelectorAll('#tasks-content, #team-backlog-content');
    const baseContentMargin = toolbarIsFixed
      ? Math.max(0, toolbarBottom - mainContentTop - mainPaddingTop)
      : 0;
    contentWrappers.forEach(el => {
      el.style.marginTop = baseContentMargin + 'px';
    });
    if (qe && toolbarIsFixed) {
      const naturalQuickEditTopAtOrigin = qe.getBoundingClientRect().top
        + (mainContent?.scrollTop || window.scrollY || 0);
      const flowCorrection = Math.max(0, toolbarBottom - naturalQuickEditTopAtOrigin);
      if (flowCorrection > 0) {
        contentWrappers.forEach(el => {
          el.style.marginTop = (baseContentMargin + flowCorrection) + 'px';
        });
      }
    }
    if (qe) qe.style.top = 'var(--qe-sticky-top, 0px)';
    if (resizeHandler) resizeHandler();
  });
}

let stickyHeaderWrapper = null;
let stickyHeaderTable = null;
let stickyHeaderObserver = null;
let scrollHandler = null;
let resizeHandler = null;
let observedScrollContainer = null;
let observedMainContent = null;

export function initStickyTableHeader(tableId) {
  if (stickyHeaderTable) {
    const previousThead = stickyHeaderTable.querySelector('thead');
    if (previousThead) previousThead.style.visibility = '';
  }
  if (stickyHeaderObserver) {
    stickyHeaderObserver.disconnect();
    stickyHeaderObserver = null;
  }
  if (scrollHandler) {
    window.removeEventListener('scroll', scrollHandler);
    observedScrollContainer?.removeEventListener('scroll', scrollHandler);
    observedMainContent?.removeEventListener('scroll', scrollHandler);
    scrollHandler = null;
  }
  observedScrollContainer = null;
  observedMainContent = null;
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
  const mainContent = document.querySelector('.main-content');

  function getOffsetTop() {
    const style = getComputedStyle(document.documentElement);
    const navbarHeight = parseFloat(style.getPropertyValue('--navbar-height')) || 64;
    const toolbar = document.querySelector('.sticky-toolbar');
    const baseOffset = toolbar
      ? Math.max(navbarHeight, Math.ceil(toolbar.getBoundingClientRect().bottom))
      : navbarHeight;
    const qe = Array.from(document.querySelectorAll('.qe-toolbar'))
      .find(el => {
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.position === 'sticky';
      });
    return qe
      ? Math.max(baseOffset, Math.ceil(qe.getBoundingClientRect().bottom))
      : baseOffset;
  }

  function update() {
    if (!stickyHeaderTable) return;
    const tableRect = stickyHeaderTable.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const verticalScrollTop = Math.max(
      window.scrollY || document.documentElement.scrollTop || 0,
      mainContent?.scrollTop || 0,
    );
    const activeQuickEditToolbar = Array.from(document.querySelectorAll('.qe-toolbar'))
      .find(el => getComputedStyle(el).display !== 'none');
    if (activeQuickEditToolbar) {
      // Keep one inset before and after scrolling. Switching from `auto` on the
      // first scroll tick makes both the toolbar and header visibly jump.
      activeQuickEditToolbar.style.top = 'var(--qe-sticky-top, 0px)';
    }
    const offsetTop = getOffsetTop();
    const theadHeight = thead.offsetHeight;

    if (verticalScrollTop > 0.5 && tableRect.top < offsetTop - 0.5 && tableRect.bottom > offsetTop + theadHeight) {
      if (!stickyHeaderWrapper) {
        stickyHeaderWrapper = document.createElement('div');
        stickyHeaderWrapper.id = 'sticky-header-wrapper';
        stickyHeaderWrapper.style.cssText = `
          position: fixed;
          z-index: 20;
          overflow: hidden;
          border-radius: var(--radius-lg) var(--radius-lg) 0 0;
          background: var(--bg-tertiary);
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        `;
        
        const clonedTable = document.createElement('table');
        clonedTable.className = table.className;
        clonedTable.dataset.sourceTable = tableId;
        clonedTable.style.cssText = 'margin: 0; border-collapse: collapse; table-layout: fixed;';

        const sourceColgroup = table.querySelector('colgroup');
        if (sourceColgroup) clonedTable.appendChild(sourceColgroup.cloneNode(true));
        
        const clonedThead = thead.cloneNode(true);
        clonedThead.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
        clonedThead.querySelectorAll('input[type="checkbox"]').forEach((checkbox, index) => {
          checkbox.addEventListener('change', () => {
            const original = thead.querySelectorAll('input[type="checkbox"]')[index];
            if (!original) return;
            original.checked = checkbox.checked;
            original.dispatchEvent(new Event('change', { bubbles: true }));
          });
        });
        clonedTable.appendChild(clonedThead);
        stickyHeaderWrapper.appendChild(clonedTable);
        document.body.appendChild(stickyHeaderWrapper);
      }

      thead.style.visibility = 'hidden';

      const clonedThs = stickyHeaderWrapper.querySelectorAll('th');
      const origThs = thead.querySelectorAll('th');
      const clonedCols = stickyHeaderWrapper.querySelectorAll('colgroup col');

      origThs.forEach((th, i) => {
        const width = th.getBoundingClientRect().width + 'px';
        if (clonedCols[i]) {
          clonedCols[i].style.width = width;
          clonedCols[i].style.minWidth = width;
          clonedCols[i].style.maxWidth = width;
        } else if (clonedThs[i]) {
          clonedThs[i].style.width = width;
          clonedThs[i].style.minWidth = width;
          clonedThs[i].style.maxWidth = width;
        }
      });

      const scrollLeft = container.scrollLeft;
      const tableOriginLeft = tableRect.left + scrollLeft;
      // Include the container's right border in the clipping area. clientWidth
      // starts at the padding edge while tableOriginLeft starts after the left
      // border, so using it directly cuts one pixel from the header on the right.
      const visibleWidth = Math.max(0, containerRect.right - tableOriginLeft);
      // Fixed and sticky geometry can land on different fractional pixels. A
      // one-pixel overlap prevents the scrolling rows from showing through.
      const stickyOverlap = 1;
      
      stickyHeaderWrapper.style.left = tableOriginLeft + 'px';
      stickyHeaderWrapper.style.width = visibleWidth + 'px';
      stickyHeaderWrapper.style.top = (offsetTop - stickyOverlap) + 'px';
      stickyHeaderWrapper.style.height = (theadHeight + stickyOverlap) + 'px';
      
      const innerTable = stickyHeaderWrapper.querySelector('table');
      if (innerTable) {
        innerTable.style.transform = `translateX(-${scrollLeft}px)`;
        innerTable.style.width = tableRect.width + 'px';
        innerTable.querySelectorAll('.table-pinned-id, .table-pinned-selection').forEach(cell => {
          cell.style.transform = `translateX(${scrollLeft}px)`;
        });
      }
    } else {
      if (stickyHeaderWrapper) {
        stickyHeaderWrapper.remove();
        stickyHeaderWrapper = null;
      }
      thead.style.visibility = '';
    }
  }

  scrollHandler = () => update();
  resizeHandler = () => update();
  
  window.addEventListener('scroll', scrollHandler, { passive: true });
  window.addEventListener('resize', resizeHandler, { passive: true });
  container.addEventListener('scroll', scrollHandler, { passive: true });
  if (mainContent) mainContent.addEventListener('scroll', scrollHandler, { passive: true });
  observedScrollContainer = container;
  observedMainContent = mainContent;

  stickyHeaderObserver = new ResizeObserver(() => {
    if (stickyHeaderWrapper) {
      stickyHeaderWrapper.remove();
      stickyHeaderWrapper = null;
      thead.style.visibility = '';
    }
    update();
  });
  stickyHeaderObserver.observe(table);

  update();

  // updateStickyOffsets() applies the fixed-toolbar compensation in the next
  // animation frame. Recalculate once that layout change has landed; otherwise
  // the table can be mistaken for already scrolled under the toolbar on first
  // render, leaving its original thead hidden until the user starts scrolling.
  requestAnimationFrame(update);
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
  clearQuickFilterVisualState();
}

function clearQuickFilterVisualState() {
  document.querySelectorAll('.quick-filter-btn').forEach(btn => {
    btn.classList.remove('active');
    btn.setAttribute('aria-pressed', 'false');
  });
  const count = document.getElementById('quick-filters-active-count');
  const toggle = document.getElementById('quick-filters-mobile-toggle');
  if (count) {
    count.textContent = '0';
    count.classList.add('hidden');
  }
  toggle?.classList.remove('has-active-filters');
}

export { columnFilters, renderFilterButtons, filterChangeCallbacks, isDeadlinePast, isCurrentTask, isLastQuarterTask };


