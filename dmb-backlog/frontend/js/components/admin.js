import { TASK_COLUMNS, buildColumnLabels, buildColumnSettings, getAllColumnKeys } from './taskColumns.js';
import { renderDictionariesTab } from './adminDictionaries.js';
import { acquireDictionaryLock, DICTIONARY_CONFIG, getDictionaryChanges, persistDictionaryItems, releaseDictionaryLock, renderDictionaryForm } from './adminDictionaries.js';
import { executeAdminReport, getReportFields, getReportPayload, parseReportJson, renderFilterRow, renderReportForm, REPORT_GROUP_OPTIONS, scriptManagedReportKeys, updateReportFilterRow, validateReportForm } from './adminReports.js';

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeHtmlAttribute(value) {
  return escapeHtml(String(value ?? '')).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function safeHexColor(value, fallback = '#64748b') {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
}

function getAdminAccess(app) {
  return app?.store?.get('currentUser')?.permissions?.admin || 'none';
}

let adminTab = 'teams';
let adminData = { teams: [], users: [], roles: [], priorities: [], statuses: [], taskTypes: [], businessCustomers: [], channels: [], deadlines: [], departments: [], teamTypes: [], projectStatuses: [], competencyCosts: [], projects: [], reports: [], teamTypeRefs: [], tags: [], auditLog: { items: [], total: 0, pages: 0 }, auditFilters: { actions: [], entity_types: [], users: [] } };
let adminModal = { show: false, mode: 'add', type: 'team', data: {} };
let currentAdminUser = null;
let userSort = { field: 'role', dir: 'asc' };
let userSearch = '';
let userFilters = { role: '', team: '', status: '' };
let dictLocks = {};
let currentDictLockType = null;
let currentDictVersion = 0;
let adminLoadState = {};
let adminModalReturnFocus = null;
let adminModalKeyHandler = null;
let competencyEditorReturnFocus = null;
let adminFormInitialSnapshot = '';
let adminFormSaving = false;
let auditState = { page: 1, perPage: 50, search: '', action: '', entityType: '', userId: '', dateFrom: '', dateTo: '' };
let roleCompare = { left: '', right: '' };
const dictionaryViewState = {};
let adminDictHistoryPushed = false;

const ADMIN_URL_KEYS = ['admin_q', 'admin_filter', 'admin_page', 'admin_role', 'admin_team', 'admin_status', 'admin_action', 'admin_entity', 'admin_user', 'admin_from', 'admin_to', 'admin_dict', 'admin_dict_q'];

function hydrateAdminUrlState() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('admin_tab') || 'teams';
  const page = Math.max(1, Number(params.get('admin_page')) || 1);
  if (adminListState[tab]) {
    if ('search' in adminListState[tab]) adminListState[tab].search = params.get('admin_q') || '';
    if ('filter' in adminListState[tab]) adminListState[tab].filter = params.get('admin_filter') || '';
    adminListState[tab].page = page;
  }
  if (tab === 'users') {
    userSearch = params.get('admin_q') || '';
    userFilters = { role: params.get('admin_role') || '', team: params.get('admin_team') || '', status: params.get('admin_status') || '' };
    adminListState.users.page = page;
  }
  if (tab === 'audit') auditState = { ...auditState, page, search: params.get('admin_q') || '', action: params.get('admin_action') || '', entityType: params.get('admin_entity') || '', userId: params.get('admin_user') || '', dateFrom: params.get('admin_from') || '', dateTo: params.get('admin_to') || '' };
  const dictKey = params.get('admin_dict') || '';
  if (dictKey) dictionaryViewState[dictKey] = { ...(dictionaryViewState[dictKey] || {}), search: params.get('admin_dict_q') || '' };
  return { tab, dictKey };
}

function updateAdminUrl(mode = 'replace', extra = {}) {
  const url = new URL(window.location.href); const params = url.searchParams;
  params.set('admin_tab', adminTab); ADMIN_URL_KEYS.forEach(key => params.delete(key));
  const listState = adminListState[adminTab];
  if (listState?.search) params.set('admin_q', listState.search);
  if (listState?.filter) params.set('admin_filter', listState.filter);
  if (listState?.page > 1) params.set('admin_page', listState.page);
  if (adminTab === 'users') {
    if (userSearch) params.set('admin_q', userSearch);
    if (userFilters.role) params.set('admin_role', userFilters.role);
    if (userFilters.team) params.set('admin_team', userFilters.team);
    if (userFilters.status) params.set('admin_status', userFilters.status);
    if (adminListState.users.page > 1) params.set('admin_page', adminListState.users.page);
  }
  if (adminTab === 'audit') {
    if (auditState.search) params.set('admin_q', auditState.search); if (auditState.page > 1) params.set('admin_page', auditState.page);
    if (auditState.action) params.set('admin_action', auditState.action); if (auditState.entityType) params.set('admin_entity', auditState.entityType);
    if (auditState.userId) params.set('admin_user', auditState.userId); if (auditState.dateFrom) params.set('admin_from', auditState.dateFrom); if (auditState.dateTo) params.set('admin_to', auditState.dateTo);
  }
  Object.entries(extra).forEach(([key, value]) => value ? params.set(key, value) : params.delete(key));
  window.history[mode === 'push' ? 'pushState' : 'replaceState'](window.history.state, '', url);
}
const ADMIN_PAGE_SIZE = 20;
const adminListState = {
  teams: { search: '', filter: '', page: 1 }, projects: { search: '', filter: '', page: 1 },
  businessCustomers: { search: '', filter: '', page: 1 }, users: { page: 1 }, roles: { search: '', filter: '', page: 1 },
};

function paginateAdminItems(items, tab) {
  const state = adminListState[tab];
  const pages = Math.max(1, Math.ceil(items.length / ADMIN_PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pages);
  return { items: items.slice((state.page - 1) * ADMIN_PAGE_SIZE, state.page * ADMIN_PAGE_SIZE), total: items.length, pages, page: state.page };
}

function renderAdminListTools(tab, total, filterOptions = [], filterLabel = 'Все') {
  const state = adminListState[tab];
  const hasCriteria = Boolean(state.search || state.filter);
  return `<div class="admin-list-tools"><div class="admin-list-search"><i data-lucide="search" aria-hidden="true"></i><input class="input admin-list-search-input" data-list-tab="${tab}" value="${escapeHtmlAttribute(state.search)}" placeholder="Поиск" aria-label="Поиск"></div>${filterOptions.length ? `<select class="input admin-list-filter" data-list-tab="${tab}" aria-label="Фильтр"><option value="">${escapeHtml(filterLabel)}</option>${filterOptions.map(option => `<option value="${escapeHtmlAttribute(option.value)}"${String(state.filter) === String(option.value) ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>` : ''}<span class="admin-list-count" role="status" aria-live="polite">Найдено: ${total}</span>${hasCriteria ? `<button type="button" class="btn btn-ghost btn-sm admin-list-reset" data-list-tab="${tab}">Сбросить фильтры</button>` : ''}</div>`;
}

function renderAdminPagination(tab, page, pages, total, pageSize = ADMIN_PAGE_SIZE) {
  if (pages <= 1) return '';
  return `<nav class="admin-pagination" aria-label="Страницы списка"><span>${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} из ${total}</span><div><button type="button" class="btn btn-ghost btn-sm admin-list-page" data-list-tab="${tab}" data-page="${page - 1}"${page === 1 ? ' disabled' : ''}>Назад</button><span>${page} / ${pages}</span><button type="button" class="btn btn-ghost btn-sm admin-list-page" data-list-tab="${tab}" data-page="${page + 1}"${page === pages ? ' disabled' : ''}>Далее</button></div></nav>`;
}

function adminFormSnapshot() {
  const form = document.getElementById('modal-form-body');
  if (!form) return '';
  const controls = Array.from(form.querySelectorAll('input, select, textarea')).map(control => ({
    key: control.id || control.name || control.className,
    value: control.type === 'checkbox' || control.type === 'radio' ? control.checked : control.value,
  }));
  const dictionaryRows = Array.from(form.querySelectorAll('.dict-editor-row')).map((row, index) => ({ id: row.dataset.itemId || `new-${index}`, active: row.dataset.active, parent: row.parentElement?.id, index }));
  return JSON.stringify({ controls, dictionaryRows });
}

function isAdminFormDirty() {
  return Boolean(adminFormInitialSnapshot && adminFormSnapshot() !== adminFormInitialSnapshot);
}

function clearAdminFormErrors() {
  const overlay = document.getElementById('admin-modal-overlay');
  overlay?.querySelectorAll('.admin-field-error').forEach(error => error.remove());
  overlay?.querySelectorAll('.admin-field-invalid').forEach(field => {
    field.classList.remove('admin-field-invalid'); field.removeAttribute('aria-invalid'); field.removeAttribute('aria-describedby');
  });
  const summary = document.getElementById('admin-form-error-summary');
  if (summary) { summary.hidden = true; summary.innerHTML = ''; }
}

function clearAdminFieldError(field) {
  if (!field?.classList.contains('admin-field-invalid')) return;
  const describedBy = field.getAttribute('aria-describedby');
  if (describedBy) document.getElementById(describedBy)?.remove();
  field.classList.remove('admin-field-invalid'); field.removeAttribute('aria-invalid'); field.removeAttribute('aria-describedby');
}

function setAdminFormSaving(saving) {
  adminFormSaving = saving;
  const button = document.querySelector('#admin-modal-overlay .modal-save-btn');
  if (!button) return;
  if (saving) {
    button.dataset.originalText ||= button.textContent;
    button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = 'Сохранение…';
  } else {
    button.disabled = false; button.removeAttribute('aria-busy'); button.textContent = button.dataset.originalText || 'Сохранить';
  }
}

function showAdminFormErrors(errors, focus = true) {
  clearAdminFormErrors();
  if (!errors.length) return false;
  const summary = document.getElementById('admin-form-error-summary');
  if (summary) {
    summary.hidden = false;
    summary.innerHTML = `<strong>Исправьте ошибки (${errors.length})</strong><ul>${errors.map(error => `<li>${escapeHtml(error.message)}</li>`).join('')}</ul>`;
  }
  errors.forEach((error, index) => {
    const field = document.getElementById(error.field);
    if (!field) return;
    const errorId = `admin-field-error-${index}`;
    field.classList.add('admin-field-invalid'); field.setAttribute('aria-invalid', 'true'); field.setAttribute('aria-describedby', errorId);
    const message = document.createElement('div'); message.id = errorId; message.className = 'admin-field-error'; message.textContent = error.message;
    field.closest('.form-group')?.appendChild(message);
  });
  if (focus) {
    const first = document.getElementById(errors[0].field);
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' }); first?.focus({ preventScroll: true });
  }
  return true;
}

function validateAdminEntityForm(type, data) {
  const required = {
    team: [['modal-name', 'Введите название команды']],
    user: [['modal-name', 'Введите ФИО'], ['modal-email', 'Введите email']],
    role: [['modal-name', 'Введите название роли']],
    project: [['project-code', 'Введите код проекта'], ['project-name', 'Введите название проекта']],
    bc: [['bc-name', 'Введите ФИО бизнес-заказчика']],
  };
  const errors = (required[type] || []).filter(([field]) => !getFieldVal(field).trim()).map(([field, message]) => ({ field, message }));
  if (type === 'user' && getFieldVal('modal-email').trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(getFieldVal('modal-email').trim())) errors.push({ field: 'modal-email', message: 'Введите корректный email' });
  if (type === 'user') {
    const name = getFieldVal('modal-name').trim().toLocaleLowerCase();
    if ((adminData.users || []).some(user => user.id !== data.id && String(user.name || '').trim().toLocaleLowerCase() === name)) errors.push({ field: 'modal-name', message: 'Пользователь с таким именем уже существует' });
  }
  return errors;
}

function validateRolePolicy(payload) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  if (payload.customer_portal_only) {
    if (payload.customer_access === 'none') add('modal-customer_access', 'Для режима бизнес-заказчика разрешите доступ к порталу');
    if (payload.admin_access !== 'none') add('modal-admin_access', 'В режиме бизнес-заказчика администрирование должно быть запрещено');
    if (payload.review_access !== 'none') add('modal-review-access', 'В режиме бизнес-заказчика ревью должно быть запрещено');
    [['task_edit_scope', 'modal-task-edit-scope', 'редактирование'], ['task_comment_scope', 'modal-task-comment-scope', 'комментирование'], ['task_delete_scope', 'modal-task-delete-scope', 'удаление']].forEach(([key, field, label]) => { if (payload[key] !== 'none') add(field, `В режиме бизнес-заказчика ${label} должно быть запрещено`); });
    if (payload.pip_decision_access) add('modal-pip-decision-access', 'В режиме бизнес-заказчика PIP-решения должны быть запрещены');
  }
  const rank = { none: 0, team: 1, all: 2 };
  if (rank[payload.task_delete_scope] > rank[payload.task_edit_scope]) add('modal-task-delete-scope', 'Область удаления не может быть шире области редактирования');
  if (payload.pip_decision_access && payload.reports_access === 'none') add('modal-pip-decision-access', 'Для PIP-решений нужен доступ к статусам для встреч');
  return errors;
}

function prepareAdminFormValidation(type) {
  const requiredIds = {
    team: ['modal-name'], user: ['modal-name', 'modal-email'], role: ['modal-name'],
    project: ['project-code', 'project-name'], bc: ['bc-name'], report: ['report-name'],
  }[type] || [];
  requiredIds.forEach(id => { const field = document.getElementById(id); if (field) { field.required = true; field.setAttribute('aria-required', 'true'); } });
}

function deactivateAdminModalFocus() {
  if (adminModalKeyHandler) document.removeEventListener('keydown', adminModalKeyHandler);
  adminModalKeyHandler = null;
  const target = adminModalReturnFocus;
  adminModalReturnFocus = null;
  if (target?.isConnected) target.focus({ preventScroll: true });
}

function activateAdminModalFocus() {
  const dialog = document.querySelector('#admin-modal-overlay [role="dialog"]');
  if (!dialog) return;
  if (!adminModalReturnFocus) adminModalReturnFocus = document.activeElement;
  if (adminModalKeyHandler) document.removeEventListener('keydown', adminModalKeyHandler);
  adminModalKeyHandler = event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.querySelector('.modal-close-x, .modal-cancel-btn')?.click();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', adminModalKeyHandler);
  (dialog.querySelector('input, select, textarea, button') || dialog).focus();
}

function getRoleDisplayName(role) {
    if (!role) return '';
    return escapeHtml(role.name);
}

function showConfirmModal(message, onConfirm, options = {}) {
    const details = options.details || '';
    const canConfirm = options.canConfirm !== false;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal" role="alertdialog" aria-modal="true" aria-label="Подтверждение действия" tabindex="-1" style="max-width:420px;text-align:center;">
            <div style="margin-bottom:var(--space-6);">
                <div style="width:48px;height:48px;border-radius:50%;background:var(--danger-light, rgba(244,63,94,0.12));display:flex;align-items:center;justify-content:center;margin:0 auto var(--space-4);">
                    <i data-lucide="alert-triangle" style="width:24px;height:24px;color:var(--danger);"></i>
                </div>
                <div style="font-size:15px;font-weight:500;color:var(--text-primary);line-height:1.5;">${escapeHtml(message)}</div>
                ${details ? `<div class="admin-impact-details">${details}</div>` : ''}
            </div>
            <div style="display:flex;gap:var(--space-3);justify-content:center;">
                <button class="btn btn-ghost modal-cancel-btn" style="min-width:100px;">Отмена</button>
                <button class="btn btn-danger modal-confirm-btn" style="min-width:100px;"${canConfirm ? '' : ' disabled'}>${escapeHtml(options.confirmText || 'Подтвердить')}</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    if (window.lucide) window.lucide.createIcons({ attrs: { 'data-lucide': '' }, nameAttr: 'data-lucide' });
    const close = () => overlay.remove();
    overlay.querySelector('.modal-cancel-btn').addEventListener('click', close);
    overlay.querySelector('.modal-confirm-btn').addEventListener('click', () => { if (!canConfirm) return; close(); onConfirm(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

const TEAM_ABBR = {
  'Pre-Trade': 'Pre',
  'Post-Trade (Products & Service)': 'Pst',
  'Core': 'Cr',
  'IB': 'IB',
  'Delivery': 'Dev',
  'Post-Trade (Finance)': 'Fin',
  'Methodology': 'Met',
  'ИТ ЛТ': 'ЛТ',
  'AI': 'AI',
  'Проектный офис': 'POf',
};

function getTeamAbbr(name, abbr) {
  if (abbr) return abbr;
  return TEAM_ABBR[name] || (name ? name.substring(0, 2).toUpperCase() : '??');
}

const COLOR_BGS = {
  indigo: 'linear-gradient(135deg, #6366f1, #4f46e5)',
  emerald: 'linear-gradient(135deg, #10b981, #059669)',
  amber: 'linear-gradient(135deg, #f59e0b, #d97706)',
  rose: 'linear-gradient(135deg, #f43f5e, #e11d48)',
  sky: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
  violet: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
  cyan: 'linear-gradient(135deg, #06b6d4, #0891b2)',
  orange: 'linear-gradient(135deg, #f97316, #ea580c)',
  teal: 'linear-gradient(135deg, #14b8a6, #0d9488)',
  purple: 'linear-gradient(135deg, #a855f7, #9333ea)',
  slate: 'linear-gradient(135deg, #64748b, #475569)',
};

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

function getColorGradient(color) {
  return COLOR_BGS[color] || COLOR_BGS.slate;
}

window.updateUserAvatarPreview = function(name) {
  const el = document.getElementById('user-avatar-preview');
  if (!el) return;
  el.textContent = window.getUserInitials(name);
  el.style.background = window.getAvatarColor(name);
  const emailInput = document.getElementById('modal-email');
  if (emailInput) {
    emailInput.value = generateEmail(name);
  }
};

const CYR_TO_LAT = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e',
  'ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m',
  'н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
  'ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch',
  'ы':'y','э':'e','ю':'yu','я':'ya',
  'А':'a','Б':'b','В':'v','Г':'g','Д':'d','Е':'e','Ё':'e',
  'Ж':'zh','З':'z','И':'i','Й':'y','К':'k','Л':'l','М':'m',
  'Н':'n','О':'o','П':'p','Р':'r','С':'s','Т':'t','У':'u',
  'Ф':'f','Х':'kh','Ц':'ts','Ч':'ch','Ш':'sh','Щ':'shch',
  'Ы':'y','Э':'e','Ю':'yu','Я':'ya',
};

function transliterate(text) {
  return text.split('').map(ch => CYR_TO_LAT[ch] || ch).join('');
}

function generateEmail(name) {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  let firstInitial, lastName;
  if (parts.length >= 2) {
    firstInitial = parts[0][0];
    lastName = parts.slice(1).join('').replace(/\./g, '');
  } else {
    const dotParts = name.split('.');
    if (dotParts.length >= 2) {
      firstInitial = dotParts[0];
      lastName = dotParts.slice(1).join('').replace(/\./g, '');
    } else {
      firstInitial = name[0];
      lastName = '';
    }
  }
  const latFirst = transliterate(firstInitial);
  const latLast = transliterate(lastName);
  return (latFirst + (latLast ? '.' + latLast : '')).toLowerCase() + '@dmb.ru';
}

function getAccessLabel(level) {
  const map = {
    none: 'Нет доступа',
    read: 'Только просмотр',
    read_own: 'Своя команда',
    write_own: 'Редакт. свою',
    read_all: 'Все команды',
    read_write: 'Просмотр и ред.',
    write_all: 'Редакт. все',
    available: 'Доступно',
    partial: 'Частичный',
    full: 'Полный доступ',
  };
  return map[level] || level;
}

function getAccessTone(level) {
  if (level === 'none') return 'none';
  if (['read', 'read_own', 'available'].includes(level)) return 'read';
  if (['partial', 'read_all', 'read_write', 'write_own'].includes(level)) return 'write';
  return 'full';
}

function renderAccessBadge(level) {
  return `<span class="role-access-badge role-access-${getAccessTone(level)}" title="Уровень: ${escapeHtmlAttribute(getAccessLabel(level))}">${escapeHtml(getAccessLabel(level))}</span>`;
}

const DICT_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#f97316', '#f59e0b', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#6b7280', '#84cc16', '#22c55e',
];

function autoDictCode(name) {
  if (!name) return '';
  const code = transliterate(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return code || name.toLowerCase().slice(0, 10);
}

function autoDictColor(name) {
  if (!name) return DICT_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return DICT_COLORS[Math.abs(hash) % DICT_COLORS.length];
}

window.autoFillDictRow = function(input) {
  if ((adminModal.data || {}).dictKey === 'competencyCosts') return;
  const row = input.closest('.dict-editor-row, div[style]');
  if (!row) return;
  const name = input.value.trim();
  const codeInput = row.querySelector('.dict-code-input');
  if (codeInput && !codeInput.value && !codeInput.dataset.userEdited) {
    codeInput.value = autoDictCode(name);
  }
  const colorInput = row.querySelector('.dict-color-input');
  if (colorInput && !colorInput.dataset.userEdited && name) {
    const c = autoDictColor(name);
    colorInput.value = c;
    const swatch = row.querySelector('.dict-color-swatch');
    if (swatch) swatch.style.background = c;
  }
};

window.markDictEdited = function(input) {
  input.dataset.userEdited = '1';
  const row = input.closest('.dict-editor-row'); row?.classList.add('is-dirty');
  const state = row?.querySelector('.dict-row-state'); if (state && !state.textContent.trim()) state.textContent = 'Изменено';
  updateDictionaryEditorState();
};

function dictCodePlaceholder(dictKey) {
  return dictKey === 'competencyCosts' ? 'Ставка (руб/день)' : 'Код';
}

function getStatusBadge(active) {
  return active
    ? '<span class="badge badge-success" style="font-size:11px">Активен</span>'
    : '<span class="badge badge-muted" style="font-size:11px">Неактивен</span>';
}

function getRoleStatusBadge(status) {
  const map = {
    active: '<span class="badge badge-success" style="font-size:11px">Активна</span>',
    in_dev: '<span class="badge badge-warning" style="font-size:11px">В разработке</span>',
    archived: '<span class="badge badge-muted" style="font-size:11px">Архивная</span>',
  };
  return map[status] || map.active;
}

// ==================== RENDER ADMIN ====================

export function renderAdmin(app) {
  const requestedTab = hydrateAdminUrlState().tab;
  adminLoadState = {};
  const adminAccess = getAdminAccess(app);
  if (adminAccess === 'none') {
    return '<div class="state-page state-forbidden"><h1>Недостаточно прав</h1><p>Раздел администрирования недоступен для вашей роли.</p></div>';
  }
  const tabs = ['teams', 'projects', 'businessCustomers', 'users', 'roles', 'home', 'dictionaries', 'display', 'notifications', 'reports', ...(adminAccess === 'full' ? ['audit'] : [])];
  adminTab = tabs.includes(requestedTab) ? requestedTab : (tabs.includes(adminTab) ? adminTab : 'teams');
  const tabLabels = { teams: 'Команды', projects: 'Проекты', businessCustomers: 'Бизнес-заказчики', users: 'Пользователи', roles: 'Роли', home: 'Таймлайн', dictionaries: 'Справочники', display: 'Отображение', notifications: 'Уведомления', reports: 'Отчёты', audit: 'Журнал действий' };
  const tabIcons = { teams: 'users', projects: 'briefcase', businessCustomers: 'user-cog', users: 'user', roles: 'shield', home: 'calendar', dictionaries: 'book-open', display: 'eye', notifications: 'bell-ring', reports: 'bar-chart-3', audit: 'scroll-text' };

  const tabButton = t => `<button class="admin-tab${adminTab === t ? ' active' : ''}" data-tab="${t}" role="tab" aria-selected="${adminTab === t}" aria-controls="admin-content" tabindex="${adminTab === t ? '0' : '-1'}">
      <i data-lucide="${tabIcons[t]}" aria-hidden="true" style="width:22px;height:22px;"></i>
      <span>${tabLabels[t]}</span>
    </button>`;
  const groups = [
    ['Структура', ['teams', 'projects', 'businessCustomers']], ['Доступы', ['users', 'roles']],
    ['Настройки', ['dictionaries', 'display']], ['Инструменты', ['home', 'notifications', 'reports']], ['Контроль', ['audit']],
  ];
  const tabBar = `<div class="admin-tab-groups">${groups.map(([label, groupTabs]) => {
    const visible = groupTabs.filter(tab => tabs.includes(tab));
    return visible.length ? `<div class="admin-tab-group"><span class="admin-tab-group-label">${label}</span><div class="admin-tab-group-buttons">${visible.map(tabButton).join('')}</div></div>` : '';
  }).join('')}</div><select class="input admin-tab-mobile-select" id="admin-tab-mobile-select" aria-label="Раздел администрирования">${tabs.map(tab => `<option value="${tab}"${adminTab === tab ? ' selected' : ''}>${tabLabels[tab]}</option>`).join('')}</select>`;

  const content = renderTabContent(adminTab, app);

  return `<div class="admin-access-${adminAccess}">
    <div class="page-header animate-fade-in">
      <div>
        <h1>Администрирование</h1>
        <p>Настройки системы, справочники и управление доступами</p>
      </div>
    </div>
    <div style="position:sticky;top:var(--navbar-height);z-index:30;background:var(--bg-primary);padding-bottom:var(--space-2)">
      <div class="admin-tabs" id="admin-tab-bar" role="tablist" aria-label="Разделы администрирования">${tabBar}</div>
      <div id="admin-sticky-bar"></div>
    </div>
    <div id="admin-content" role="tabpanel" aria-live="polite" style="padding-top:var(--space-2)">${content}</div>
    <div id="admin-modal-root"></div></div>
  `;
}

function pullStickyBars() {
  const container = document.getElementById('admin-sticky-bar');
  const content = document.getElementById('admin-content');
  if (!container || !content) return;
  container.innerHTML = '';

  const bars = content.querySelectorAll('.admin-action-row');
  bars.forEach(b => container.appendChild(b));
  initAdminStickyThead();
}

let stickyHeader = null;
let stickyScroll = null;

function initAdminStickyThead() {
  if (stickyScroll) { window.removeEventListener('scroll', stickyScroll); stickyScroll = null; }
  if (stickyHeader) { stickyHeader.remove(); stickyHeader = null; }

  const table = document.querySelector('#admin-content table');
  const thead = table?.querySelector('thead');
  if (!table || !thead) return;

  const style = getComputedStyle(document.documentElement);
  const navbarH = parseFloat(style.getPropertyValue('--navbar-height')) || 64;
  const wrapper = document.querySelector('#admin-tab-bar')?.parentElement;

  function update() {
    if (!table.isConnected) { if (stickyHeader) { stickyHeader.remove(); stickyHeader = null; } return; }
    const rect = table.getBoundingClientRect();
    const wrapperH = wrapper ? wrapper.offsetHeight : 56;
    const offsetTop = navbarH + wrapperH;
    const theadH = thead.offsetHeight;

    if (rect.top < offsetTop && rect.bottom > offsetTop + theadH) {
      if (!stickyHeader) {
        stickyHeader = document.createElement('div');
        stickyHeader.style.cssText = 'position:fixed;z-index:20;overflow:hidden;background:var(--bg-tertiary);box-shadow:0 2px 8px rgba(0,0,0,0.15)';
        const cloneTable = document.createElement('table');
        cloneTable.style.cssText = 'margin:0;border-collapse:collapse;font-size:13px;width:' + table.offsetWidth + 'px';
        cloneTable.appendChild(thead.cloneNode(true));
        stickyHeader.appendChild(cloneTable);
        document.body.appendChild(stickyHeader);

        const clonedThs = stickyHeader.querySelectorAll('th');
        const origThs = thead.querySelectorAll('th');
        clonedThs.forEach((th, i) => {
          if (origThs[i]) {
            const w = origThs[i].getBoundingClientRect().width;
            th.style.width = w + 'px';
            th.style.minWidth = w + 'px';
            th.style.maxWidth = w + 'px';
          }
        });
      }
      const cRect = document.querySelector('#admin-content').getBoundingClientRect();
      stickyHeader.style.left = cRect.left + 'px';
      stickyHeader.style.width = cRect.width + 'px';
      stickyHeader.style.top = offsetTop + 'px';
      stickyHeader.style.height = theadH + 'px';
    } else if (stickyHeader) {
      stickyHeader.remove();
      stickyHeader = null;
    }
  }

  stickyScroll = () => update();
  window.addEventListener('scroll', stickyScroll, {passive: true});
  window.addEventListener('resize', stickyScroll, {passive: true});
  update();
}

function normalizeAdminTables() {
  const content = document.getElementById('admin-content');
  if (!content) return;
  content.dataset.adminTab = adminTab;
  content.querySelectorAll('table').forEach(table => {
    if (table.id === 'comp-cost-table') return;
    table.classList.add('admin-unified-table');
    if (adminTab === 'roles') table.classList.add('admin-role-matrix');
    const headers = Array.from(table.querySelector('thead tr:first-child')?.querySelectorAll('th') || []).map(header => header.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(row => {
      const cells = Array.from(row.children).filter(cell => cell.tagName === 'TD');
      if (cells.length <= 1 || cells[0]?.colSpan > 1) return;
      cells.forEach((cell, index) => {
        const label = headers[index] || '';
        cell.dataset.label = label;
        const isPrimary = index < 2 || index === cells.length - 1 || /статус|результат|название|пользователь|фио/i.test(label);
        cell.classList.toggle('admin-secondary-cell', !isPrimary);
      });
      if (adminTab !== 'roles' && cells.length > 3 && !cells[0].querySelector('.admin-row-details-toggle')) {
        const toggle = document.createElement('button');
        toggle.type = 'button'; toggle.className = 'admin-row-details-toggle'; toggle.setAttribute('aria-expanded', 'false'); toggle.textContent = 'Подробнее';
        cells[0].appendChild(toggle);
      }
    });
  });
}

function enhanceAdminAccessibility(root = document) {
  root.querySelectorAll('button[title]:not([aria-label])').forEach(button => button.setAttribute('aria-label', button.title));
  root.querySelectorAll('button svg, button i[data-lucide]').forEach(icon => icon.setAttribute('aria-hidden', 'true'));
  root.querySelectorAll('.form-group').forEach((group, index) => {
    const control = group.querySelector('input:not([type="hidden"]), select, textarea'); const label = group.querySelector('label');
    if (!control || !label) return;
    if (!control.id) control.id = `admin-field-${index}`;
    if (!label.htmlFor) label.htmlFor = control.id;
  });
  root.querySelectorAll('.dict-color-swatch:not([aria-label])').forEach(button => button.setAttribute('aria-label', 'Выбрать цвет значения'));
}

// ==================== TAB CONTENT RENDERER ====================

function renderTabContent(tab, app) {
  const state = adminLoadState[tab];
  if (!state || state.status === 'loading') {
    return '<div class="admin-state" role="status" aria-live="polite"><div class="spinner" aria-hidden="true"></div><p>Загрузка данных…</p></div>';
  }
  if (state.status === 'error') {
    const message = state.statusCode === 403
      ? 'Недостаточно прав для просмотра этого раздела.'
      : 'Не удалось загрузить данные. Проверьте соединение и повторите попытку.';
    return `<div class="admin-state admin-state-error" role="alert"><i data-lucide="triangle-alert" aria-hidden="true"></i><p>${message}</p><button class="btn btn-secondary" id="admin-retry-btn">Повторить</button></div>`;
  }
  switch (tab) {
    case 'teams': return renderTeamsTab(app);
    case 'projects': return renderProjectsTab(app);
      case 'businessCustomers': return renderBusinessCustomersTab(app);
    case 'users': return renderUsersTab(app);
    case 'roles': return renderRolesTab(app);
    case 'home': return renderHomeTab(app);
    case 'dictionaries': return renderDictionariesTab(adminData, dictLocks, escapeHtml);
    case 'display': return renderDisplayTab(app);
    case 'notifications': return renderNotificationTemplatesTab(app);
    case 'reports': return renderReportsTab(app);
    case 'audit': return renderAuditTab();
    default: return '<p class="text-muted">Выберите вкладку</p>';
  }
}

// ==================== TEAMS TAB ====================

function renderTeamsTab(app) {
  const state = adminListState.teams;
  const query = state.search.trim().toLocaleLowerCase();
  const filtered = (adminData.teams || []).filter(team => !query || [team.name, team.description, team.pl, team.po, team.cl, team.it_pl].some(value => String(value || '').toLocaleLowerCase().includes(query)));
  const pageData = paginateAdminItems(filtered, 'teams');
  const teams = pageData.items;
  const cards = teams.length
    ? teams.map(t => {
        const leads = [];
        if (t.pl) leads.push(`<div style="font-size:11px;color:var(--text-muted);line-height:1.6">PL: ${escapeHtml(t.pl)}</div>`);
        if (t.po) leads.push(`<div style="font-size:11px;color:var(--text-muted);line-height:1.6">PO: ${escapeHtml(t.po)}</div>`);
        if (t.cl) leads.push(`<div style="font-size:11px;color:var(--text-muted);line-height:1.6">CL: ${escapeHtml(t.cl)}</div>`);
        if (t.it_pl) leads.push(`<div style="font-size:11px;color:var(--text-muted);line-height:1.6">IT PL: ${escapeHtml(t.it_pl)}</div>`);
        const leadInfo = leads.length ? leads.join('') : '<div style="font-size:11px;color:var(--text-muted);line-height:1.6">Нет руководителей</div>';
        const abbr = getTeamAbbr(t.name, t.abbr);
        const gradient = getColorGradient(t.color);
        return `
          <div class="card card-hover admin-hover-card" style="cursor:pointer;padding:16px;display:flex;flex-direction:column;min-height:180px;transition:box-shadow 0.2s,transform 0.15s">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
              <div style="width:44px;height:44px;border-radius:12px;background:${gradient};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:white;flex-shrink:0">${escapeHtml(abbr)}</div>
              <div style="flex:1;min-width:0">
                <div style="font-weight:600;font-size:14px;color:var(--text-primary);word-break:break-word">${escapeHtml(t.name)}</div>
              </div>
              <div style="flex-shrink:0;display:flex;align-items:flex-start;gap:4px">
                <button class="admin-edit-btn" data-type="team" data-id="${t.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Редактировать команду">
                  <i data-lucide="pen-line" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:var(--text-muted)"></i>
                </button>
                <button class="admin-delete-btn" data-type="team" data-id="${t.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Удалить команду">
                  <i data-lucide="trash-2" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:#f43f5e"></i>
                </button>
              </div>
            </div>
            <div style="flex:1">${leadInfo}</div>
            ${t.description ? `<div style="font-size:12px;color:var(--text-muted);margin-top:8px;padding-top:8px;border-top:1px solid var(--border-color)">${escapeHtml(t.description)}</div>` : ''}
          </div>
        `;
      }).join('')
    : '<div class="text-muted" style="grid-column:1/-1;text-align:center;padding:40px">По заданным условиям ничего не найдено</div>';

  return `
    <div class="admin-action-row admin-list-action-row">
      ${renderAdminListTools('teams', pageData.total)}
      <button class="btn btn-primary btn-sm admin-add-btn" data-type="team">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Новая команда
      </button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">${cards}</div>
    ${renderAdminPagination('teams', pageData.page, pageData.pages, pageData.total)}
  `;
}

// ==================== PROJECTS TAB ====================

function renderProjectsTab(app) {
  const statuses = adminData.projectStatuses || [];
  const users = adminData.users || [];
  const state = adminListState.projects;
  const query = state.search.trim().toLocaleLowerCase();
  const filtered = (adminData.projects || []).filter(project => {
    const status = statuses.find(item => item.id === project.status_id);
    const responsible = users.find(item => item.id === project.responsible_pl);
    return (!state.filter || String(project.status_id || '') === state.filter) && (!query || [project.code, project.name, project.description, status?.name, responsible?.name].some(value => String(value || '').toLocaleLowerCase().includes(query)));
  });
  const pageData = paginateAdminItems(filtered, 'projects');
  const projects = pageData.items;
  const rows = projects.map(p => {
    const status = statuses.find(s => s.id === p.status_id);
    const pl = users.find(u => u.id === p.responsible_pl);
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-muted)">#${p.id}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(p.code)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:13px;color:var(--text-primary)">${escapeHtml(p.name)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.description || '—')}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-secondary)">${escapeHtml(status ? status.name : '—')}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-secondary)">${escapeHtml(pl ? pl.name : '—')}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:11px;color:var(--text-muted)">${p.created_at ? p.created_at.slice(0, 10) : '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);text-align:right">
          <div style="display:flex;gap:4px;justify-content:flex-end">
            <button class="admin-edit-btn" data-type="project" data-id="${p.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Редактировать">
              <i data-lucide="pen-line" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:var(--text-muted)"></i>
            </button>
            <button class="admin-delete-btn" data-type="project" data-id="${p.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Удалить">
              <i data-lucide="trash-2" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:#f43f5e"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="admin-action-row admin-list-action-row">
      ${renderAdminListTools('projects', pageData.total, statuses.map(status => ({ value: status.id, label: status.name })), 'Все статусы')}
      <button class="btn btn-primary btn-sm" id="project-add-btn">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Добавить проект
      </button>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color);width:50px">ID</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Код</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Название</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Описание</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Статус</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Ответственный PL</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Создан</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color);width:80px"></th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="8" style="padding:20px;text-align:center;font-size:13px;color:var(--text-muted)">По заданным условиям ничего не найдено</td></tr>'}</tbody>
      </table>
    </div>
    ${renderAdminPagination('projects', pageData.page, pageData.pages, pageData.total)}
  `;
}

// ==================== BUSINESS CUSTOMERS TAB ====================

function renderBusinessCustomersTab(app) {
  const departments = adminData.departments || [];
  const deptMap = {};
  departments.forEach(d => { deptMap[d.id] = d.name; });
  const state = adminListState.businessCustomers;
  const query = state.search.trim().toLocaleLowerCase();
  const filtered = (adminData.businessCustomers || []).filter(customer => (!state.filter || String(customer.department_id || '') === state.filter) && (!query || [customer.name, customer.department_name, deptMap[customer.department_id]].some(value => String(value || '').toLocaleLowerCase().includes(query))));
  const pageData = paginateAdminItems(filtered, 'businessCustomers');
  const customers = pageData.items;

  const rows = customers.map(c => {
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-muted)">#${c.id}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(c.name)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--text-secondary)">${escapeHtml(c.department_name || (c.department_id && deptMap[c.department_id]) || '—')}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);font-size:11px;color:var(--text-muted)">${c.created_at ? c.created_at.slice(0, 10) : '—'}</td>
        <td style="padding:10px 12px;border-bottom:1px solid var(--border-color);text-align:right">
          <div style="display:flex;gap:4px;justify-content:flex-end">
            <button class="admin-edit-btn" data-type="bc" data-id="${c.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Редактировать">
              <i data-lucide="pen-line" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:var(--text-muted)"></i>
            </button>
            <button class="admin-delete-btn" data-type="bc" data-id="${c.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Удалить">
              <i data-lucide="trash-2" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:#f43f5e"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="admin-action-row admin-list-action-row">
      ${renderAdminListTools('businessCustomers', pageData.total, departments.map(department => ({ value: department.id, label: department.name })), 'Все подразделения')}
      <button class="btn btn-primary btn-sm" id="bc-add-btn">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Добавить бизнес-заказчика
      </button>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color);width:50px">ID</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">ФИО</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Подразделение</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color)">Создан</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;border-bottom:2px solid var(--border-color);width:80px"></th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5" style="padding:20px;text-align:center;font-size:13px;color:var(--text-muted)">По заданным условиям ничего не найдено</td></tr>'}</tbody>
      </table>
    </div>
    ${renderAdminPagination('businessCustomers', pageData.page, pageData.pages, pageData.total)}
  `;
}

function renderBusinessCustomerForm(data) {
  const departments = adminData.departments || [];
  const deptOpts = departments.map(d => `<option value="${d.id}"${data.department_id == d.id ? ' selected' : ''}>${escapeHtml(d.name)}</option>`).join('');
  const isEdit = adminModal.mode === 'edit';
  return `
    <div class="form-group">
      <label class="form-label">ID</label>
      <input class="input modal-field" value="${data.id || '—'}" readonly style="color:var(--text-muted)">
    </div>
    <div class="form-group">
      <label class="form-label">ФИО <span class="required">*</span></label>
      <input class="input modal-field" id="bc-name" value="${escapeHtml(data.name || '')}" placeholder="ФИО бизнес-заказчика">
    </div>
    <div class="form-group">
      <label class="form-label">Подразделение</label>
      <select class="input modal-field" id="bc-department"><option value="">—</option>${deptOpts}</select>
    </div>
  `;
}

function getBusinessCustomerPayload() {
  return {
    name: getFieldVal('bc-name'),
    department_id: parseInt(getFieldVal('bc-department')) || null,
  };
}

// ==================== USERS TAB ====================

function renderUsersTab(app) {
  const teams = adminData.teams || [];
  const roles = adminData.roles || [];

  let users = [...(adminData.users || [])];

  // Search filter
  if (userSearch) {
    const q = userSearch.toLowerCase();
    users = users.filter(u =>
      (u.name || '').toLowerCase().includes(q)
    );
  }

  // Column filters
  if (userFilters.role) {
    const rid = parseInt(userFilters.role);
    users = users.filter(u => u.role_id === rid);
  }
  if (userFilters.team) {
    const tid = parseInt(userFilters.team);
    users = users.filter(u => u.team_id === tid);
  }
  if (userFilters.status) {
    const active = userFilters.status === '1';
    users = users.filter(u => u.is_active === active);
  }

  // Sort
  const sortDir = userSort.dir === 'asc' ? 1 : -1;
  users.sort((a, b) => {
    let va, vb;
    switch (userSort.field) {
      case 'name':
        va = a.name || ''; vb = b.name || '';
        return va.localeCompare(vb) * sortDir;
      case 'role':
        const ra = (roles.find(r => r.id === a.role_id) || {}).name || '';
        const rb = (roles.find(r => r.id === b.role_id) || {}).name || '';
        const prioA = ra.includes('Tribe') ? 0 : ra.includes('Project Office') ? 1 : 2;
        const prioB = rb.includes('Tribe') ? 0 : rb.includes('Project Office') ? 1 : 2;
        if (prioA !== prioB) return (prioA - prioB) * sortDir;
        return (ra.localeCompare(rb) || (a.name || '').localeCompare(b.name || '')) * sortDir;
      case 'team':
        const ta = (teams.find(t => t.id === a.team_id) || {}).name || '';
        const tb = (teams.find(t => t.id === b.team_id) || {}).name || '';
        return ta.localeCompare(tb) * sortDir;
      case 'email':
        va = a.email || ''; vb = b.email || '';
        return va.localeCompare(vb) * sortDir;
      case 'status':
        va = a.is_active ? 1 : 0; vb = b.is_active ? 1 : 0;
        return (va - vb) * sortDir;
      default:
        return 0;
    }
  });
  const userPageData = paginateAdminItems(users, 'users');
  users = userPageData.items;

  const sortArrow = (field) => {
    if (userSort.field !== field) return '';
    return userSort.dir === 'asc' ? ' ↑' : ' ↓';
  };

  const th = (field, label) => `
    <th style="padding:7px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px;white-space:nowrap" class="admin-sort-th" data-sort="${field}">
      ${label}${sortArrow(field)}
    </th>`;

  const selStyle = 'font-size:12px;padding:6px 8px;border:1px solid var(--border-color);border-radius:6px;background:var(--bg-primary);color:var(--text-primary)';
  const fOpt = (val, label) => `<option value="${val}"${userFilters[label] === val ? ' selected' : ''}>`;
  const roleFilter = `<select class="input admin-user-filter" id="admin-filter-role" style="${selStyle}"><option value="">Все роли</option>${roles.map(r => `<option value="${r.id}"${userFilters.role == r.id ? ' selected' : ''}>${getRoleDisplayName(r)}</option>`).join('')}</select>`;
  const teamFilter = `<select class="input admin-user-filter" id="admin-filter-team" style="${selStyle}"><option value="">Все команды</option>${teams.map(t => `<option value="${t.id}"${userFilters.team == t.id ? ' selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select>`;
  const statusFilter = `<select class="input admin-user-filter" id="admin-filter-status" style="${selStyle}"><option value="">Все статусы</option><option value="1"${userFilters.status == '1' ? ' selected' : ''}>Активен</option><option value="0"${userFilters.status == '0' ? ' selected' : ''}>Неактивен</option></select>`;

  const rows = users.length
    ? users.map(u => {
        const team = teams.find(t => t.id === u.team_id || t.name === u.team);
        const role = roles.find(r => r.id === u.role_id);
        const teamName = team ? team.name : (u.team || '—');
        const initials = window.getUserInitials(u.name);
        const avatarColor = window.getAvatarColor(u.name);
        return `
          <tr>
            <td style="padding:12px 16px;border-bottom:1px solid var(--border-color)">
              <div style="display:flex;align-items:center;gap:10px">
                <div style="width:32px;height:32px;border-radius:50%;background:${safeHexColor(avatarColor)};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;color:white;flex-shrink:0">${escapeHtml(initials)}</div>
                <div>
                  <div style="font-weight:600;font-size:13px;color:var(--text-primary)">${escapeHtml(u.name)}</div>
                </div>
              </div>
            </td>
            <td style="padding:12px 16px;border-bottom:1px solid var(--border-color)">
              ${role ? `<span class="badge badge-info" style="font-size:11px">${getRoleDisplayName(role)}</span>` : '<span class="text-muted" style="font-size:12px">—</span>'}
            </td>
            <td style="padding:12px 16px;border-bottom:1px solid var(--border-color);color:var(--text-secondary);font-size:13px">${escapeHtml(teamName)}</td>
            <td style="padding:12px 16px;border-bottom:1px solid var(--border-color);color:var(--text-muted);font-size:12px">${escapeHtml(u.email || '—')}</td>
            <td style="padding:12px 16px;border-bottom:1px solid var(--border-color)">${getStatusBadge(u.is_active)}</td>
            <td style="padding:12px 16px;border-bottom:1px solid var(--border-color);text-align:right">
              <div style="display:flex;gap:4px;justify-content:flex-end">
                <button class="admin-edit-btn" data-type="user" data-id="${u.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Редактировать">
                  <i data-lucide="pen-line" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:var(--text-muted)"></i>
                </button>
                ${u.is_active ? `<button class="admin-delete-btn" data-type="user" data-id="${u.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Деактивировать пользователя">
                  <i data-lucide="user-x" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:#f43f5e"></i>
                </button>` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">По заданным условиям ничего не найдено</td></tr>';

  return `
    <div class="admin-action-row admin-list-action-row">
      <div class="admin-list-tools">
        <div class="admin-list-search">
          <i data-lucide="search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text-muted)"></i>
          <input class="input" id="admin-user-search" value="${escapeHtmlAttribute(userSearch)}" placeholder="Поиск пользователей" style="padding-left:32px;padding-right:32px">
          ${userSearch ? `<button id="admin-user-search-clear" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);border:none;background:transparent;cursor:pointer;padding:2px;color:var(--text-muted);line-height:1" title="Очистить"><i data-lucide="x" style="width:12px;height:12px"></i></button>` : ''}
        </div>
        ${roleFilter}${teamFilter}${statusFilter}
        <span class="admin-list-count" role="status" aria-live="polite">Найдено: ${userPageData.total}</span>
        ${(userSearch || userFilters.role || userFilters.team || userFilters.status) ? '<button type="button" class="btn btn-ghost btn-sm" id="admin-user-filters-reset">Сбросить фильтры</button>' : ''}
      </div>
      <button class="btn btn-primary btn-sm admin-add-btn" data-type="user"><i data-lucide="plus" style="width:14px;height:14px"></i> Новый пользователь</button>
    </div>
    <div class="admin-section" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--bg-tertiary)">
            ${th('name', 'Пользователь')}
            ${th('role', 'Роль')}
            ${th('team', 'Команда')}
            ${th('email', 'Email')}
            ${th('status', 'Статус')}
            <th style="padding:10px 16px;text-align:right;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${renderAdminPagination('users', userPageData.page, userPageData.pages, userPageData.total)}
  `;
}

// ==================== ROLES TAB ====================

function renderRoleComparison(allRoles, permissions) {
  const left = allRoles.find(role => String(role.id) === roleCompare.left);
  const right = allRoles.find(role => String(role.id) === roleCompare.right);
  if (!left || !right || left.id === right.id) return '';
  const rows = permissions.map(permission => {
    const leftLevel = left[permission.key] || 'none'; const rightLevel = right[permission.key] || 'none';
    return `<div class="role-compare-row${leftLevel !== rightLevel ? ' is-different' : ''}"><span>${escapeHtml(permission.label)}</span><span>${renderAccessBadge(leftLevel)}</span><span>${renderAccessBadge(rightLevel)}</span></div>`;
  }).join('');
  return `<section class="role-compare-panel" aria-label="Сравнение ролей"><div class="role-compare-head"><strong>Сравнение ролей</strong><button type="button" class="btn btn-ghost btn-sm" id="role-compare-clear">Закрыть сравнение</button></div><div class="role-compare-row role-compare-titles"><span>Право</span><strong>${getRoleDisplayName(left)}</strong><strong>${getRoleDisplayName(right)}</strong></div>${rows}</section>`;
}

function getRolePreview(role) {
  const roleName = String(role.name || '').trim().toLocaleLowerCase('ru-RU');
  const legacyCustomer = roleName === 'бизнес-заказчик';
  const legacyReview = ['проектный офис (админ)', 'администратор'].includes(roleName) ? 'all' : ['po/pl/cl', 'ba/участник команды', 'ba/бизнес-аналитик', 'лидер трайба'].includes(roleName) ? 'team' : 'none';
  const isCustomer = role.customer_portal_only ?? legacyCustomer;
  const reviewAccess = role.review_access || legacyReview;
  const canReview = reviewAccess !== 'none';
  const globalEditor = ['проектный офис (админ)', 'администратор'].includes(roleName);
  const teamEditor = ['po/pl/cl', 'ba/участник команды', 'it pl'].includes(roleName);
  const taskScopes = {
    edit: role.task_edit_scope || (globalEditor ? 'all' : teamEditor ? 'team' : 'none'),
    comment: role.task_comment_scope || (globalEditor || teamEditor || roleName === 'лидер трайба' ? 'all' : 'none'),
    delete: role.task_delete_scope || (globalEditor ? 'all' : 'none'),
    pip: role.pip_decision_access ?? (globalEditor || roleName === 'лидер трайба'),
  };
  const access = key => role[`${key}_access`] || 'none';
  const items = [
    ['Главная', !isCustomer, 'Базовый раздел'],
    ['Бэклог DMB и канбан', !isCustomer && access('backlog_dmb') !== 'none', getAccessLabel(access('backlog_dmb'))],
    ['Бэклог команды и экспресс-оценка', !isCustomer && access('backlog_team') !== 'none', getAccessLabel(access('backlog_team'))],
    ['Статусы для встреч', !isCustomer && access('reports') !== 'none', getAccessLabel(access('reports'))],
    ['Аналитика', !isCustomer && access('analytics') !== 'none', getAccessLabel(access('analytics'))],
    ['Мои задачи и ИИ-ассистент', isCustomer || access('customer') !== 'none', isCustomer ? 'Специальный режим роли' : getAccessLabel(access('customer'))],
    ['Ревью запросов', !isCustomer && canReview, reviewAccess === 'all' ? 'Все команды' : reviewAccess === 'team' ? 'Своя команда' : 'Нет доступа'],
    ['Мои уведомления', !isCustomer, 'Базовый раздел'],
    ['Настройки', !isCustomer && access('settings') !== 'none', getAccessLabel(access('settings'))],
    ['Администрирование и аудит', !isCustomer && access('admin') !== 'none', getAccessLabel(access('admin'))],
  ].map(([label, visible, detail]) => ({ label, visible, detail }));
  const writable = ['backlog_dmb', 'backlog_team', 'reports', 'analytics', 'customer'].filter(key => ['read_write', 'write_own', 'write_all', 'full'].includes(access(key))).length;
  const warnings = [];
  if (isCustomer && access('customer') === 'none') warnings.push('Режим портала включён, но доступ к порталу запрещён матрицей.');
  if (role.status === 'archived' && (writable || access('admin') !== 'none')) warnings.push('Архивная роль сохраняет права изменения или администрирования.');
  if (!isCustomer && items.filter(item => item.visible).length <= 2) warnings.push('У роли почти нет рабочих разделов.');
  return { items, warnings, writable, taskScopes };
}

function renderRolePreview(role) {
  const preview = getRolePreview(role); const visible = preview.items.filter(item => item.visible).length;
  const menu = preview.items.map(item => `<div class="role-preview-item ${item.visible ? 'is-visible' : 'is-hidden'}"><i data-lucide="${item.visible ? 'eye' : 'eye-off'}"></i><div><strong>${escapeHtml(item.label)}</strong><span>${item.visible ? 'Виден' : 'Скрыт'} · ${escapeHtml(item.detail)}</span></div></div>`).join('');
  const warnings = preview.warnings.length ? `<section class="role-preview-warnings"><h4><i data-lucide="triangle-alert"></i> Нужно проверить</h4><ul>${preview.warnings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : `<div class="role-preview-ok"><i data-lucide="circle-check"></i> Явных противоречий не найдено</div>`;
  const scopeLabel = value => ({ none: 'Запрещено', team: 'Своя команда', all: 'Все команды' }[value]);
  const actions = `<h4 class="role-preview-heading">Операции с задачами</h4><div class="role-preview-actions">${[['Редактирование', scopeLabel(preview.taskScopes.edit)], ['Комментирование', scopeLabel(preview.taskScopes.comment)], ['Удаление', scopeLabel(preview.taskScopes.delete)], ['PIP-решения', preview.taskScopes.pip ? 'Разрешены' : 'Запрещены']].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`;
  return `<div class="role-preview"><div class="role-preview-banner" role="status"><i data-lucide="scan-eye"></i><div><strong>Симуляция интерфейса</strong><span>Права не применены, токены и текущая сессия не изменены.</span></div></div><div class="role-preview-summary"><div><span>Видимо разделов</span><strong>${visible} из ${preview.items.length}</strong></div><div><span>Разделы с записью</span><strong>${preview.writable}</strong></div><div><span>Админ-доступ</span>${renderAccessBadge(role.admin_access || 'none')}</div></div>${actions}<h4 class="role-preview-heading">Как будет выглядеть меню</h4><div class="role-preview-menu">${menu}</div>${warnings}<p class="role-preview-note">Доступ к отдельным записям может также зависеть от команды и назначений пользователя.</p></div>`;
}

function renderRolesTab(app) {
  const state = adminListState.roles;
  const query = state.search.trim().toLocaleLowerCase();
  const allRoles = adminData.roles || [];
  const filtered = allRoles.filter(role => (!state.filter || String(role.status || 'active') === state.filter) && (!query || [role.name, role.description].some(value => String(value || '').toLocaleLowerCase().includes(query))));
  const pageData = paginateAdminItems(filtered, 'roles');
  const roles = pageData.items;
  const permLevels = [
    { key: 'backlog_dmb_access', label: 'Бэклог DMB', help: 'Просмотр и изменение общего бэклога DMB' },
    { key: 'backlog_team_access', label: 'Бэклог команды', help: 'Доступ к задачам своей или всех команд' },
    { key: 'reports_access', label: 'Статусы встреч', help: 'Просмотр и изменение статусов для встреч' },
    { key: 'analytics_access', label: 'Аналитика', help: 'Доступ к аналитическим представлениям' },
    { key: 'customer_access', label: 'Бизнес-заказчик', help: 'Работа с порталом бизнес-заказчика' },
    { key: 'settings_access', label: 'Настройки', help: 'Доступ к пользовательским настройкам' },
    { key: 'admin_access', label: 'Админ', help: 'Доступ к административным функциям' },
  ];

  const rows = roles.length
    ? roles.map(r => {
        const perms = permLevels.map(p =>
          `<td style="text-align:center">${renderAccessBadge(r[p.key] || 'none')}</td>`
        ).join('');
        const powerful = permLevels.filter(permission => getAccessTone(r[permission.key] || 'none') === 'full').length;
        const warning = (r.admin_access === 'full' || powerful >= 3) ? '<span class="role-risk-warning" title="Роль имеет расширенные или административные права"><i data-lucide="triangle-alert"></i> Повышенные права</span>' : '';
        const compared = [roleCompare.left, roleCompare.right].includes(String(r.id));
        return `
          <tr class="${compared ? 'role-is-compared' : ''}" data-role-id="${r.id}">
            <td style="padding:10px 12px;border-bottom:1px solid var(--border-color)">
              <div style="font-weight:600;font-size:13px;color:var(--text-primary)">${getRoleDisplayName(r)}</div>
              ${r.description ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escapeHtml(r.description)}</div>` : ''}
              ${warning}
            </td>
            ${perms}
            <td style="padding:10px 12px;text-align:center;border-bottom:1px solid var(--border-color)">${getRoleStatusBadge(r.status)}</td>
            <td style="padding:10px 12px;text-align:right;border-bottom:1px solid var(--border-color)">
              <div style="display:flex;gap:4px;justify-content:flex-end">
                <button class="admin-edit-btn" data-type="role" data-id="${r.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Редактировать">
                  <i data-lucide="pen-line" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:var(--text-muted)"></i>
                </button>
                <button class="role-preview-btn" data-id="${r.id}" title="Предпросмотреть интерфейс роли" aria-label="Предпросмотреть интерфейс роли"><i data-lucide="scan-eye"></i></button>
                <button class="admin-delete-btn" data-type="role" data-id="${r.id}" style="padding:6px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Удалить">
                  <i data-lucide="trash-2" width="18" height="18" style="width:18px;height:18px;flex-shrink:0;min-width:18px;min-height:18px;color:#f43f5e"></i>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">По заданным условиям ничего не найдено</td></tr>';

  return `
    <div class="admin-action-row admin-list-action-row">
      ${renderAdminListTools('roles', pageData.total, [{ value: 'active', label: 'Активные' }, { value: 'in_dev', label: 'В разработке' }, { value: 'archived', label: 'Архивные' }], 'Все статусы')}
      <button class="btn btn-primary btn-sm admin-add-btn" data-type="role">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Новая роль
      </button>
    </div>
    <div class="role-matrix-meta"><div class="role-access-legend"><span>${renderAccessBadge('none')}</span><span>${renderAccessBadge('read')}</span><span>${renderAccessBadge('read_write')}</span><span>${renderAccessBadge('full')}</span></div><div class="role-compare-controls"><select class="input role-compare-select" id="role-compare-left"><option value="">Первая роль</option>${allRoles.map(role => `<option value="${role.id}"${roleCompare.left === String(role.id) ? ' selected' : ''}>${getRoleDisplayName(role)}</option>`).join('')}</select><span>и</span><select class="input role-compare-select" id="role-compare-right"><option value="">Вторая роль</option>${allRoles.map(role => `<option value="${role.id}"${roleCompare.right === String(role.id) ? ' selected' : ''}>${getRoleDisplayName(role)}</option>`).join('')}</select></div></div>
    ${renderRoleComparison(allRoles, permLevels)}
    <div class="admin-section" style="padding:0;overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:var(--bg-tertiary)">
            <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Роль</th>
            ${permLevels.map(permission => `<th style="text-align:center" title="${escapeHtmlAttribute(permission.help)}">${escapeHtml(permission.label)} <span class="role-header-help" aria-label="${escapeHtmlAttribute(permission.help)}">?</span></th>`).join('')}
            <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px">Статус</th>
            <th style="padding:10px 12px;text-align:right;font-size:11px;text-transform:uppercase;color:var(--text-muted);letter-spacing:0.5px"></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${renderAdminPagination('roles', pageData.page, pageData.pages, pageData.total)}
  `;
}


// ==================== DICTIONARIES TAB ====================


// ==================== REPORTS TAB ====================



// ==================== HOME / TIMELINE TAB ====================

function auditDetails(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : (value || {}); } catch (_) { return {}; }
}

function renderAuditTab() {
  const data = adminData.auditLog || { items: [], total: 0, pages: 0 };
  const filters = adminData.auditFilters || { actions: [], entity_types: [], users: [] };
  const rows = data.items.length ? data.items.map(item => {
    const details = auditDetails(item.details);
    const fields = Array.isArray(details.changed_fields) && details.changed_fields.length ? details.changed_fields.join(', ') : '—';
    const success = details.success !== false && Number(details.status_code || 200) < 400;
    return `<tr><td>${escapeHtml(item.created_at ? new Date(item.created_at).toLocaleString('ru-RU') : '—')}</td><td>${escapeHtml(item.user_name || 'Система')}</td><td><span class="badge ${success ? 'badge-success' : 'badge-danger'}">${success ? 'Успешно' : 'Ошибка'}</span></td><td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.entity_type)}${item.entity_id ? ` #${item.entity_id}` : ''}</td><td class="audit-fields" title="${escapeHtmlAttribute(fields)}">${escapeHtml(fields)}</td><td>${escapeHtml(item.ip_address || '—')}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="admin-empty-cell">По заданным условиям ничего не найдено</td></tr>';
  const option = (value, label, selected) => `<option value="${escapeHtmlAttribute(value)}"${String(value) === String(selected) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  return `<div class="admin-action-row audit-toolbar">
    <input class="input" id="audit-search" value="${escapeHtmlAttribute(auditState.search)}" placeholder="Поиск по журналу" aria-label="Поиск по журналу">
    <select class="input audit-filter" id="audit-action"><option value="">Все действия</option>${filters.actions.map(value => option(value, value, auditState.action)).join('')}</select>
    <select class="input audit-filter" id="audit-entity"><option value="">Все сущности</option>${filters.entity_types.map(value => option(value, value, auditState.entityType)).join('')}</select>
    <select class="input audit-filter" id="audit-user"><option value="">Все пользователи</option>${filters.users.map(user => option(user.id, user.name, auditState.userId)).join('')}</select>
    <input class="input audit-filter" type="date" id="audit-date-from" value="${escapeHtmlAttribute(auditState.dateFrom)}" aria-label="Дата с">
    <input class="input audit-filter" type="date" id="audit-date-to" value="${escapeHtmlAttribute(auditState.dateTo)}" aria-label="Дата по">
    <span class="admin-list-count" role="status" aria-live="polite">Записей: ${data.total || 0}</span>
    <button type="button" class="btn btn-ghost btn-sm" id="audit-reset">Сбросить</button>
  </div><div class="admin-section audit-table-wrap"><table class="admin-table audit-table"><thead><tr><th>Дата</th><th>Пользователь</th><th>Результат</th><th>Действие</th><th>Сущность</th><th>Изменённые поля</th><th>IP</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${renderAdminPagination('audit', data.page || 1, data.pages || 1, data.total || 0, auditState.perPage)}`;
}

async function refreshAuditTab(app, focusSearch = false) {
  adminLoadState.audit = { status: 'loading' };
  const content = document.getElementById('admin-content');
  if (content) content.innerHTML = renderTabContent('audit', app);
  await loadAdminTab(app, 'audit', true);
  if (content) content.innerHTML = renderTabContent('audit', app);
  pullStickyBars(); bindAdminEvents(app);
  if (window.lucide) lucide.createIcons();
  if (focusSearch) restoreAdminSearchFocus('#audit-search');
}

function restoreAdminSearchFocus(selector) {
  const input = document.querySelector(selector);
  if (!input) return;
  input.focus({ preventScroll: true });
  const end = input.value.length;
  if (typeof input.setSelectionRange === 'function') input.setSelectionRange(end, end);
}

let tlAdminData = { events: [], year: new Date().getFullYear() };

const MONTH_NAMES = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function formatDateRu(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
}

const RECUR_LABELS = {
  daily: 'Ежедневно', weekly: 'Еженедельно', monthly: 'Ежемесячно',
  quarterly: 'Ежеквартально', yearly: 'Ежегодно',
};

const VIS_LABELS = { all: 'Все уровни', quarter: 'Только квартал', month: 'Только месяц' };

function renderHomeTab(app) {
  return `
    <div class="admin-section">
      <div class="admin-section-header">
        <h2>События таймлайна</h2>
        <button class="btn btn-primary btn-sm add-btn" data-action="add-tl-event">
          <i data-lucide="plus" style="width:16px;height:16px;"></i> Добавить событие
        </button>
      </div>
      <div id="tl-admin-list">${renderTimelineEventList(app)}</div>
    </div>`;
}

function renderTimelineEventList(app) {
  const events = tlAdminData.events;
  const rows = events.length === 0
    ? '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:var(--space-6)">Нет событий</td></tr>'
    : events.map(ev => {
        const recurLabel = ev.is_recurring && ev.recurring_interval ? (RECUR_LABELS[ev.recurring_interval] || ev.recurring_interval) : 'Нет';
        const visLabel = VIS_LABELS[ev.visibility_level] || ev.visibility_level || 'Все уровни';
        return `
        <tr>
          <td style="white-space:nowrap">${formatDateRu(ev.date)}</td>
          <td><span class="tl-admin-dot" style="background:${ev.color};"></span>${escapeHtml(ev.title)}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ev.description ? escapeHtml(ev.description.substring(0, 60)) : '—'}</td>
          <td>${recurLabel}</td>
          <td>${visLabel}</td>
          <td>
            <button class="btn btn-ghost btn-sm" data-action="edit-tl-event" data-id="${ev.id}"><i data-lucide="pencil" style="width:14px;height:14px;"></i></button>
            <button class="btn btn-ghost btn-sm" data-action="delete-tl-event" data-id="${ev.id}"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
          </td>
        </tr>`;
      }).join('');

  return `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Дата</th>
          <th>Название</th>
          <th>Описание</th>
          <th>Повторение</th>
          <th>Уровень</th>
          <th>Действия</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>`;
}

function renderTimelineEventModal(data, app) {
  const isEdit = !!data.id;

  const recurOpts = [
    { value: '', label: 'Нет' },
    { value: 'daily', label: 'Ежедневно' },
    { value: 'weekly', label: 'Еженедельно' },
    { value: 'monthly', label: 'Ежемесячно' },
    { value: 'quarterly', label: 'Ежеквартально' },
    { value: 'yearly', label: 'Ежегодно' },
  ];

  const visOpts = [
    { value: 'all', label: 'Все уровни' },
    { value: 'quarter', label: 'Только квартал' },
    { value: 'month', label: 'Только месяц' },
  ];

  return `
    <div class="modal-backdrop" id="tl-modal-backdrop">
      <div class="modal" style="max-width:480px;">
        <div class="modal-header">
          <h3>${isEdit ? 'Редактировать событие' : 'Новое событие'}</h3>
          <button class="modal-close" id="tl-modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Название <span class="required">*</span></label>
            <input class="input" id="tl-field-title" value="${escapeHtml(data.title || '')}" placeholder="Название события">
          </div>
          <div class="form-group">
            <label class="form-label">Описание</label>
            <textarea class="input" id="tl-field-desc" placeholder="Описание события" style="min-height:60px">${escapeHtml(data.description || '')}</textarea>
          </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="form-group">
                <label class="form-label">Дата <span class="required">*</span></label>
                <input class="input" type="date" id="tl-field-date" value="${data.date || ''}">
              </div>
              <div class="form-group">
                <label class="form-label">Цвет</label>
                <input type="hidden" id="tl-field-color" value="${data.color || '#6366f1'}">
                <div id="tl-color-palette" style="display:flex;flex-wrap:wrap;gap:4px;padding:4px 0;">${COLOR_PALETTE.map(c => `<span class="color-swatch ${(data.color || '#6366f1') === c ? 'active' : ''}" data-color="${c}" style="background:${c};"></span>`).join('')}</div>
              </div>
            </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-group">
              <label class="form-label">Повторение</label>
              <select class="input" id="tl-field-interval">
                ${recurOpts.map(o => `<option value="${o.value}"${(data.is_recurring ? (data.recurring_interval || '') : '') === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Показывать на уровне</label>
              <select class="input" id="tl-field-visibility">
                ${visOpts.map(o => `<option value="${o.value}"${(data.visibility_level || 'all') === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <button class="btn btn-primary" style="width:100%;margin-top:12px" id="tl-modal-save" data-edit-id="${data.id || ''}">${isEdit ? 'Сохранить' : 'Создать'}</button>
        </div>
      </div>
    </div>`;
}

async function loadTimelineAdminEvents(app) {
  try {
    const url = `/timeline?year=${tlAdminData.year}`;
    const resp = await app.api.get(url);
    tlAdminData.events = resp.items || [];
    const container = document.getElementById('tl-admin-list');
    if (container) {
      container.innerHTML = renderTimelineEventList(app);
      try { if (window.lucide) window.lucide.createIcons({ attrs: { 'data-lucide': '' }, nameAttr: 'data-lucide' }); } catch (_) {}
    }
  } catch (e) {
    console.error('TL admin load error:', e);
    const statusInfo = e.status ? ` (HTTP ${e.status})` : '';
    toast('Ошибка загрузки событий: ' + (e.message || '') + statusInfo, 'error');
  }
}

function bindHomeTabEvents(app) {
  const page = document.getElementById('page-content');
  if (!page) return;

  page.removeEventListener('click', window._tlAdminClick);
  window._tlAdminClick = (e) => handleHomeTabClick(e, app);
  page.addEventListener('click', window._tlAdminClick);
}

function handleHomeTabClick(e, app) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'add-tl-event') {
    const root = document.getElementById('admin-modal-root');
    root.innerHTML = renderTimelineEventModal({}, app);
    bindTimelineEventModal(app);
  } else if (action === 'edit-tl-event') {
    const id = parseInt(btn.dataset.id);
    const ev = tlAdminData.events.find(e => e.id === id);
    if (ev) {
      const root = document.getElementById('admin-modal-root');
      root.innerHTML = renderTimelineEventModal(ev, app);
      bindTimelineEventModal(app);
    }
  } else if (action === 'delete-tl-event') {
    deleteTimelineEvent(btn.dataset.id, app);
  }
}

function bindTimelineEventModal(app) {
  const backdrop = document.getElementById('tl-modal-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });
  }
  const close = document.getElementById('tl-modal-close');
  if (close) close.addEventListener('click', () => backdrop?.remove());

  const saveBtn = document.getElementById('tl-modal-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => saveTimelineEvent(saveBtn.dataset.editId, app));
  }

  const palette = document.getElementById('tl-color-palette');
  if (palette) {
    palette.addEventListener('click', (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;
      palette.querySelectorAll('.color-swatch').forEach(s => s.style.borderColor = 'transparent');
      swatch.style.borderColor = 'var(--accent)';
      const input = document.getElementById('tl-field-color');
      if (input) input.value = swatch.dataset.color;
    });
  }
}

async function saveTimelineEvent(editId, app) {
  const title = document.getElementById('tl-field-title')?.value?.trim();
  if (!title) { toast('Название обязательно', 'error'); return; }

  const date = document.getElementById('tl-field-date')?.value;
  if (!date) { toast('Дата обязательна', 'error'); return; }

  const interval = document.getElementById('tl-field-interval')?.value || '';

  const payload = {
    title,
    description: document.getElementById('tl-field-desc')?.value?.trim() || null,
    date,
    color: document.getElementById('tl-field-color')?.value || '#6366f1',
    is_recurring: interval !== '',
    recurring_interval: interval || null,
    visibility_level: document.getElementById('tl-field-visibility')?.value || 'all',
  };

  try {
    if (editId) {
      await app.api.put(`/timeline/admin/${editId}`, payload);
      toast('Событие обновлено', 'success');
    } else {
      await app.api.post('/timeline/admin', payload);
      toast('Событие создано', 'success');
    }
    document.getElementById('admin-modal-root').innerHTML = '';
    deactivateAdminModalFocus();
    await loadTimelineAdminEvents(app);
  } catch (e) {
    toast('Ошибка: ' + (e.message || ''), 'error');
  }
}

async function deleteTimelineEvent(id, app) {
  showConfirmModal('Удалить событие?', async () => {
    try {
      await app.api.delete(`/timeline/admin/${id}`);
      toast('Событие удалено', 'success');
      await loadTimelineAdminEvents(app);
    } catch (e) {
      toast('Ошибка: ' + (e.message || ''), 'error');
    }
  });
}

let adminReportView = null;


function renderReportsTab(app) {
  const dbReports = adminData.reports || [];
  const standardOrder = ['directorate', 'did-operational', 'projects', 'reg-directors', 'pip', 'did-backlog', 'progress'];
  const standardReports = dbReports
    .filter(r => r.type === 'standard')
    .sort((a, b) => {
      const ia = a.key ? standardOrder.indexOf(a.key) : -1;
      const ib = b.key ? standardOrder.indexOf(b.key) : -1;
      return ia - ib;
    });

  if (adminReportView) {
    return renderReportView(app);
  }

  const standardCards = standardReports.map(r => `
    <div class="card rounded-xl admin-hover-card" style="padding:20px;min-height:150px;display:flex;flex-direction:column;background:linear-gradient(135deg,#64748b,#475569);color:white;cursor:pointer;transition:box-shadow 0.15s" data-admin-report-id="${r.id}">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:8px;min-height:40px">
        <i data-lucide="file-text" style="width:18px;height:18px;opacity:0.8;flex-shrink:0;margin-top:1px"></i>
        <h4 style="margin:0;font-size:13px;font-weight:600;color:white;line-height:1.3;flex:1;min-height:34px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${escapeHtml(r.name)}</h4>
        <div style="display:flex;gap:2px;flex-shrink:0">
          <button class="admin-edit-btn" data-type="report" data-id="${r.id}" style="padding:4px;border:none;background:rgba(255,255,255,0.15);border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Настроить отчёт">
            <i data-lucide="settings" style="width:14px;height:14px;color:white"></i>
          </button>
        </div>
      </div>
      <div style="font-size:12px;opacity:0.8;flex:1">${escapeHtml(r.description || '')}</div>
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
        <span style="font-size:10px;background:rgba(255,255,255,0.2);padding:2px 6px;border-radius:4px;flex-shrink:0">Стандартный</span>
        ${r.key ? `<span style="font-size:10px;background:rgba(255,255,255,0.15);padding:2px 6px;border-radius:4px">${escapeHtml(r.key)}</span>` : ''}
      </div>
    </div>
  `).join('');

  const customCards = dbReports.filter(r => r.type === 'custom').map(r => {
    const filters = parseReportJson(r.filters);
    const fields = parseReportJson(r.fields);
    const filterCount = filters ? (Array.isArray(filters) ? filters.length : 0) : 0;
    const fieldCount = fields ? (Array.isArray(fields) ? fields.length : 0) : 0;
    const isOwn = r.created_by === (currentAdminUser ? currentAdminUser.id : null);

    return `
      <div class="card rounded-xl admin-hover-card" style="padding:20px;min-height:140px;display:flex;flex-direction:column;border:1px solid var(--border-color);cursor:pointer;transition:box-shadow 0.15s"
        data-admin-report-id="${r.id}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <i data-lucide="bar-chart-3" style="width:18px;height:18px;color:var(--accent)"></i>
            <h4 style="margin:0;font-size:13px;font-weight:600;color:var(--text-primary)">${escapeHtml(r.name)}</h4>
            ${r.is_public ? '<span style="font-size:10px;background:var(--success-light);color:var(--success);padding:2px 6px;border-radius:4px">Публичный</span>' : ''}
          </div>
          <div style="display:flex;gap:2px">
            <button class="admin-edit-btn" data-type="report" data-id="${r.id}" style="padding:4px;border:none;background:transparent;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Редактировать">
              <i data-lucide="pen-line" style="width:14px;height:14px;color:var(--text-muted)"></i>
            </button>
            <button class="admin-delete-btn" data-type="report" data-id="${r.id}" style="padding:4px;border:none;background:transparent;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center" title="Удалить">
              <i data-lucide="trash-2" style="width:14px;height:14px;color:#f43f5e"></i>
            </button>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text-muted);flex:1">${escapeHtml(r.description || 'Без описания')}</div>
        <div style="display:flex;gap:12px;margin-top:10px;font-size:11px;color:var(--text-muted)">
          <span>Фильтров: ${filterCount}</span>
          <span>Полей: ${fieldCount || 'все'}</span>
          ${r.group_by ? `<span>Группировка: ${escapeHtml(r.group_by)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="admin-action-row" style="display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <button class="btn btn-primary btn-sm admin-add-btn" data-type="report">
        <i data-lucide="plus" style="width:14px;height:14px"></i> Добавить новый отчёт
      </button>
    </div>
    ${standardReports.length ? `
    <div style="margin-bottom:24px">
      <h4 style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px">Стандартные отчёты</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">${standardCards}</div>
    </div>` : ''}
    <div>
      <h4 style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:12px">Пользовательские отчёты</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
        ${customCards || '<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1/-1">Нет пользовательских отчётов. Нажмите «Добавить новый отчёт».</div>'}
      </div>
    </div>
  `;
}

function renderReportView(app) {
  const report = adminReportView;
  const filters = parseReportJson(report.filters);
  const fields = parseReportJson(report.fields);
  const groupOptions = REPORT_GROUP_OPTIONS.map(g =>
    `<option value="${g.value}"${report.group_by === g.value ? ' selected' : ''}>${g.label}</option>`
  ).join('');
  const opLabels = { equals: '=', not_equals: '≠', contains: 'содержит', in: 'в списке', gt: '>', lt: '<' };

  return `
    <div class="admin-action-row" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-ghost btn-sm" id="report-view-back" title="Назад к списку">
          <i data-lucide="arrow-left" style="width:16px;height:16px"></i> Назад
        </button>
        <h3 style="margin:0;font-size:16px;font-weight:600;color:var(--text-primary)">${escapeHtml(report.name)}</h3>
      </div>
      <div style="display:flex;gap:8px">
        ${scriptManagedReportKeys.includes(report.key) ? `
          <span class="badge badge-info" style="font-size:11px;padding:6px 10px;line-height:1.4;white-space:normal;text-align:left">Управляется сценарием страницы «Статусы для встреч»</span>
        ` : `
          <button class="btn btn-primary btn-sm" id="report-execute-btn" data-report-id="${report.id}">
            <i data-lucide="play" style="width:14px;height:14px"></i> Выполнить
          </button>
        `}
      </div>
    </div>
    ${report.description ? `<p style="color:var(--text-muted);font-size:13px;margin:0 0 16px 0">${escapeHtml(report.description)}</p>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
      <div class="card" style="padding:12px">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px">Фильтры</div>
        <div style="font-size:13px;color:var(--text-primary)">${filters && filters.length ? filters.map(f => `<span style="display:inline-block;padding:2px 8px;margin:2px;border-radius:4px;background:var(--bg-tertiary);font-size:12px">${escapeHtml(f.field)} ${escapeHtml(opLabels[f.operator] || f.operator || '=')} ${escapeHtml(Array.isArray(f.value) ? f.value.join(', ') : f.value)}</span>`).join('') : '<span style="color:var(--text-muted)">Нет фильтров</span>'}</div>
      </div>
      <div class="card" style="padding:12px">
        <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:6px">Группировка / Сортировка</div>
        <div style="font-size:13px;color:var(--text-primary)">
          Группировка: ${escapeHtml(report.group_by || 'нет')} · Сортировка: ${escapeHtml(report.sort_by || 'нет')} ${report.sort_by ? `(${escapeHtml(report.sort_order || 'asc')})` : ''}
        </div>
      </div>
    </div>
    <div id="report-execution-result">
      <div style="text-align:center;padding:40px;color:var(--text-muted);font-size:13px">
        <i data-lucide="play-circle" style="width:32px;height:32px;color:var(--text-muted);margin-bottom:8px;display:block;margin-left:auto;margin-right:auto"></i>
        Нажмите «Выполнить» для запуска отчёта
      </div>
    </div>
  `;
}






// ==================== NOTIFICATIONS TAB ====================

// ==================== DISPLAY TAB ====================

const DISPLAY_COLUMNS = TASK_COLUMNS.map(c => ({ key: c.key, labelKey: c.labelKey, label: buildColumnLabels(window.app?.fieldLabels || {})[c.key] || c.key }));
const DISPLAY_DEFAULTS = buildColumnSettings();

let displaySettingsData = {};
let columnLabelsData = {};

function renderDisplayTab(app) {
  const KEY_MAP = { financial: 'financial_effect', effort: 'effort_days' };
  const raw = displaySettingsData.shared || displaySettingsData.backlog_dmb || {};
  const defaultOrder = getAllColumnKeys();
  const validKeys = new Set(defaultOrder);
  const cleaned = {};
  Object.keys(raw).forEach(k => {
    const mapped = KEY_MAP[k] || k;
    if (validKeys.has(mapped)) cleaned[mapped] = raw[k];
  });
  const visibility = Object.keys(cleaned).length > 0 ? cleaned : DISPLAY_DEFAULTS;
  defaultOrder.forEach(k => { if (!(k in visibility)) visibility[k] = DISPLAY_DEFAULTS[k] || false; });

  const fieldLabels = buildColumnLabels(window.app?.fieldLabels || {});
  const items = defaultOrder.map(key => {
    const colDef = DISPLAY_COLUMNS.find(c => c.key === key) || {};
    const label = columnLabelsData[key] || fieldLabels[key] || colDef.label || key;
    const checked = visibility[key];
    return `
      <div class="display-col-item" data-col="${key}" draggable="true" style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;font-size:13px;color:var(--text-primary);background:var(--bg-secondary);border:1px solid var(--border-color);cursor:grab;user-select:none;transition:background 0.15s, border-color 0.15s;">
        <span style="cursor:grab;color:var(--text-muted);display:flex;align-items:center;flex-shrink:0;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="16" y2="6"></line><line x1="8" y1="12" x2="16" y2="12"></line><line x1="8" y1="18" x2="16" y2="18"></line></svg>
        </span>
        <input type="checkbox" class="display-col-cb" data-col="${key}" ${checked ? 'checked' : ''} style="width:16px;height:16px;margin:0;flex-shrink:0;">
        <input type="text" class="display-col-label-input" value="${escapeHtml(label)}" style="flex:1;min-width:100px;font-size:13px;padding:2px 6px;border:1px solid transparent;border-radius:4px;background:transparent;color:var(--text-primary);">
        <span style="font-size:10px;color:var(--text-muted);font-family:monospace">${key}</span>
      </div>
    `;
  }).join('');

  return `
    <div style="max-width:900px">
      <div class="admin-action-row" style="display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        <button class="btn btn-primary btn-sm" id="save-display-settings">
          <i data-lucide="save" style="width:14px;height:14px"></i> Сохранить настройки
        </button>
      </div>
      <div class="card" style="padding:20px;margin-bottom:20px">
        <h3 style="font-size:15px;font-weight:600;margin:0 0 4px 0;color:var(--text-primary)">Колонки бэклогов</h3>
        <p style="font-size:12px;color:var(--text-muted);margin:0 0 16px 0">Настройка применяется к обеим страницам (Бэклог DMB и Бэклог команды). Перетаскивайте колонки для изменения порядка. Отмечайте галочками видимые по умолчанию. Редактируйте названия колонок — изменения сохранятся в БД.</p>
        <div style="display:flex;gap:8px;margin-bottom:12px;">
          <button class="btn btn-sm btn-ghost" id="display-select-all" style="font-size:11px;">Выбрать всё</button>
          <button class="btn btn-sm btn-ghost" id="display-deselect-all" style="font-size:11px;">Снять всё</button>
        </div>
        <div class="display-col-list" style="display:flex;flex-direction:column;gap:4px;max-height:520px;overflow-y:auto;padding-right:4px;">${items}</div>
      </div>
    </div>
  `;
}

function bindDisplayEvents(app) {
  initDisplayDragDrop();
  document.getElementById('display-select-all')?.addEventListener('click', () => {
    document.querySelectorAll('.display-col-cb').forEach(cb => { cb.checked = true; });
  });
  document.getElementById('display-deselect-all')?.addEventListener('click', () => {
    document.querySelectorAll('.display-col-cb').forEach(cb => { cb.checked = false; });
  });
  document.getElementById('save-display-settings')?.addEventListener('click', async () => {
    const items = document.querySelectorAll('.display-col-item');
    const validKeys = new Set(getAllColumnKeys());
    const settings = {};
    const labels = {};
    items.forEach(item => {
      const cb = item.querySelector('.display-col-cb');
      const labelInput = item.querySelector('.display-col-label-input');
      const key = item.dataset.col;
      if (!validKeys.has(key)) return;
      settings[key] = cb.checked;
      const label = labelInput.value.trim();
      if (label) labels[key] = label;
    });
    try {
      await app.api.put('/admin/display-settings/shared', { settings });
      await app.api.put('/admin/field-labels', { labels });
      columnLabelsData = {};
      displaySettingsData.shared = { ...settings };
      if (window.app) window.app.fieldLabels = { ...(window.app.fieldLabels || {}), ...labels };
      toast('Настройки отображения и названия колонок сохранены', 'success');
    } catch (e) {
      toast('Ошибка сохранения: ' + (e.message || 'Неизвестная ошибка'), 'error');
    }
  });
}

function initDisplayDragDrop() {
  document.querySelectorAll('.display-col-list').forEach(list => {
    let dragSrc = null;
    list.addEventListener('dragstart', (e) => {
      const item = e.target.closest('.display-col-item');
      if (!item) return;
      dragSrc = item;
      item.dataset.dragging = 'true';
      item.style.opacity = '0.4';
      item.style.borderColor = 'var(--accent)';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
    });
    list.addEventListener('dragend', (e) => {
      const item = e.target.closest('.display-col-item');
      if (item) {
        item.dataset.dragging = 'false';
        item.style.opacity = '';
        item.style.borderColor = 'var(--border-color)';
      }
      list.querySelectorAll('.display-col-item').forEach(el => {
        el.dataset.dragging = 'false';
        el.style.borderColor = 'var(--border-color)';
        el.style.background = '';
      });
      dragSrc = null;
    });
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const target = e.target.closest('.display-col-item');
      if (!target || target === dragSrc) return;
      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      target.style.borderColor = 'var(--accent)';
      target.style.background = 'color-mix(in srgb, var(--accent) 20%, transparent)';
      target.dataset.dragging = 'true';
    });
    list.addEventListener('dragleave', (e) => {
      const target = e.target.closest('.display-col-item');
      if (target) {
        target.style.borderColor = 'var(--border-color)';
        target.style.background = '';
        target.dataset.dragging = 'false';
      }
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      const target = e.target.closest('.display-col-item');
      if (!target || !dragSrc || target === dragSrc) return;
      list.querySelectorAll('.display-col-item').forEach(el => {
        el.style.borderColor = 'var(--border-color)';
        el.style.background = '';
        el.dataset.dragging = 'false';
      });
      const srcIdx = Array.from(list.children).indexOf(dragSrc);
      const tgtIdx = Array.from(list.children).indexOf(target);
      const rect = target.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) {
        if (srcIdx < tgtIdx) {
          list.insertBefore(dragSrc, target.nextSibling);
        } else {
          list.insertBefore(dragSrc, target);
        }
      } else {
        if (srcIdx > tgtIdx) {
          list.insertBefore(dragSrc, target);
        } else {
          list.insertBefore(dragSrc, target.nextSibling);
        }
      }
    });
  });
}

// ==================== NOTIFICATIONS TAB ====================

const NOTIFICATION_EVENTS = {
  task_deadline: 'Приближается дедлайн', task_overdue: 'Задача просрочена',
  task_status_changed: 'Изменён статус', task_assigned: 'Назначен владелец',
  mention: 'Упоминание', review_requested: 'Запрошено ревью', periodic_digest: 'Периодическая сводка',
};
const NOTIFICATION_FREQUENCIES = { daily: 'Ежедневно', weekly: 'Еженедельно', monthly: 'Ежемесячно', quarterly: 'Ежеквартально' };
const NOTIFICATION_VARIABLES = ['task_id', 'title', 'status', 'deadline', 'owner', 'team', 'project', 'days_left'];

function notificationRecipientOptions() {
  const roles = (adminData.notificationRoles || []).map(role => ({ value: `role:${role.id}`, label: role.name }));
  return [...roles, { value: 'task_owner', label: 'Владелец задачи' }, { value: 'task_team', label: 'Команда задачи' }, { value: 'reviewers', label: 'Ревьюеры' }, { value: 'admins', label: 'Администраторы' }];
}

function renderNotificationTemplatesTab(app) {
  const templates = adminData.notificationTemplates || [];
  const canManage = getAdminAccess(app) !== 'read';
  const rows = templates.length ? templates.map(item => `<tr>
    <td><strong>${escapeHtml(item.name)}</strong><div class="notification-template-excerpt">${escapeHtml(item.text)}</div></td>
    <td>${escapeHtml(NOTIFICATION_EVENTS[item.event_type] || item.event_type)}</td>
    <td>${(item.recipients || []).map(value => `<span class="badge badge-muted">${escapeHtml(notificationRecipientOptions().find(option => option.value === value)?.label || value)}</span>`).join(' ')}</td>
    <td>${item.repeat_frequency ? escapeHtml(NOTIFICATION_FREQUENCIES[item.repeat_frequency] || item.repeat_frequency) : 'Однократно'}</td>
    <td><button type="button" class="notification-template-toggle ${item.is_active ? 'is-active' : ''}" data-id="${item.id}" aria-pressed="${item.is_active}" aria-label="${item.is_active ? 'Отключить' : 'Включить'} шаблон"${canManage ? '' : ' disabled'}><span></span>${item.is_active ? 'Включён' : 'Выключен'}</button></td>
    <td class="actions"><button class="admin-edit-btn" data-type="notificationTemplate" data-id="${item.id}" title="Редактировать"><i data-lucide="pen-line"></i></button><button class="admin-delete-btn" data-type="notificationTemplate" data-id="${item.id}" title="Удалить"><i data-lucide="trash-2"></i></button></td>
  </tr>`).join('') : '<tr><td colspan="6" class="admin-empty-cell">Шаблоны пока не созданы</td></tr>';
  return `<div class="admin-action-row admin-list-action-row"><div><h2 style="margin:0">Шаблоны уведомлений</h2><p class="text-muted" style="margin:4px 0 0">Тестовая отправка не выполняется</p></div><button class="btn btn-primary btn-sm admin-add-btn" data-type="notificationTemplate"><i data-lucide="plus"></i> Новый шаблон</button></div>
    <div class="admin-section audit-table-wrap"><table class="admin-table"><thead><tr><th>Шаблон</th><th>Событие</th><th>Получатели</th><th>Периодичность</th><th>Статус</th><th>Действия</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderNotificationTemplateForm(data) {
  const recipients = new Set(data.recipients || []);
  const eventOptions = Object.entries(NOTIFICATION_EVENTS).map(([value, label]) => `<option value="${value}"${data.event_type === value ? ' selected' : ''}>${label}</option>`).join('');
  const frequencyOptions = Object.entries(NOTIFICATION_FREQUENCIES).map(([value, label]) => `<option value="${value}"${data.repeat_frequency === value ? ' selected' : ''}>${label}</option>`).join('');
  return `<div class="notification-template-form">
    <div class="form-group"><label class="form-label">Название <span class="required">*</span></label><input class="input modal-field" id="notification-template-name" maxlength="150" value="${escapeHtml(data.name || '')}"></div>
    <div class="form-group"><label class="form-label">Событие <span class="required">*</span></label><select class="input modal-field" id="notification-template-event"><option value="">Выберите событие</option>${eventOptions}</select></div>
    <div class="form-group"><label class="form-label">Получатели <span class="required">*</span></label><div class="notification-recipient-grid">${notificationRecipientOptions().map(option => `<label><input type="checkbox" class="notification-recipient" value="${escapeHtmlAttribute(option.value)}"${recipients.has(option.value) ? ' checked' : ''}> ${escapeHtml(option.label)}</label>`).join('')}</div></div>
    <div class="form-group"><label class="form-label">Текст <span class="required">*</span></label><textarea class="input modal-field" id="notification-template-text" maxlength="4000" rows="6">${escapeHtml(data.text || '')}</textarea><div class="notification-variable-list">${NOTIFICATION_VARIABLES.map(variable => `<button type="button" class="notification-variable" data-variable="${variable}">{${variable}}</button>`).join('')}</div><div id="notification-template-variable-error" class="admin-field-error" hidden></div></div>
    <div class="notification-schedule-grid"><div class="form-group"><label class="form-label">За сколько дней</label><input class="input" type="number" min="0" max="365" id="notification-template-deadline" value="${data.deadline_days ?? ''}"></div><div class="form-group"><label class="form-label">Периодичность</label><select class="input" id="notification-template-frequency"><option value="">Однократно</option>${frequencyOptions}</select></div><div class="form-group"><label class="form-label">День повтора</label><input class="input" type="number" min="1" max="31" id="notification-template-repeat-day" value="${data.repeat_day ?? ''}"></div></div>
    <label class="notification-active-field"><input type="checkbox" id="notification-template-active"${data.is_active !== false ? ' checked' : ''}> Шаблон включён</label>
    <div class="notification-preview"><span>Предпросмотр</span><strong id="notification-template-preview-title">${escapeHtml(data.name || 'Название уведомления')}</strong><p id="notification-template-preview-text"></p></div>
  </div>`;
}

function getNotificationTemplatePayload() {
  const numberOrNull = id => { const value = getFieldVal(id); return value === '' ? null : Number(value); };
  return {
    name: getFieldVal('notification-template-name').trim(), event_type: getFieldVal('notification-template-event'),
    text: getFieldVal('notification-template-text').trim(),
    recipients: Array.from(document.querySelectorAll('.notification-recipient:checked')).map(input => input.value),
    deadline_days: numberOrNull('notification-template-deadline'), repeat_frequency: getFieldVal('notification-template-frequency') || null,
    repeat_day: numberOrNull('notification-template-repeat-day'), is_active: getCheckVal('notification-template-active'),
  };
}

function validateNotificationTemplate(payload) {
  const errors = [];
  if (!payload.name) errors.push({ field: 'notification-template-name', message: 'Введите название шаблона' });
  if (!payload.event_type) errors.push({ field: 'notification-template-event', message: 'Выберите событие' });
  if (!payload.recipients.length) errors.push({ field: null, message: 'Выберите хотя бы одного получателя' });
  if (!payload.text) errors.push({ field: 'notification-template-text', message: 'Введите текст уведомления' });
  const variables = [...payload.text.matchAll(/\{([a-z_][a-z0-9_]*)\}/g)].map(match => match[1]);
  const unknown = [...new Set(variables.filter(variable => !NOTIFICATION_VARIABLES.includes(variable)))];
  if (unknown.length) errors.push({ field: 'notification-template-text', message: `Недопустимые переменные: ${unknown.join(', ')}` });
  if (payload.repeat_frequency === 'daily' && payload.repeat_day !== null) errors.push({ field: 'notification-template-repeat-day', message: 'Для ежедневного повтора день не указывается' });
  if (payload.repeat_frequency === 'weekly' && payload.repeat_day !== null && payload.repeat_day > 7) errors.push({ field: 'notification-template-repeat-day', message: 'Для недели укажите день от 1 до 7' });
  return errors;
}

function updateNotificationTemplatePreview() {
  const title = document.getElementById('notification-template-preview-title');
  const preview = document.getElementById('notification-template-preview-text');
  if (!title || !preview) return;
  const samples = { task_id: '142', title: 'Интеграция с MOEX API', status: 'В работе', deadline: '30.09.2026', owner: 'Анна Смирнова', team: 'Core', project: 'Core Integrations', days_left: '3' };
  title.textContent = getFieldVal('notification-template-name') || 'Название уведомления';
  preview.textContent = (getFieldVal('notification-template-text') || 'Здесь появится текст уведомления').replace(/\{([a-z_][a-z0-9_]*)\}/g, (match, key) => samples[key] || match);
}

// ==================== MODALS ====================

function renderModal() {
  if (!adminModal.show) return '';
  const { mode, type, data } = adminModal;
  const isEdit = mode === 'edit';
  const isView = mode === 'view';
  const titleLabels = { team: 'команды', user: 'пользователя', role: 'роли', dict: 'справочника', project: 'проекта', bc: 'бизнес-заказчика', report: 'отчёта', notificationTemplate: 'шаблона уведомления' };
  const title = type === 'rolePreview' ? `Интерфейс роли «${getRoleDisplayName(data)}»` : type === 'dict' ? `Редактирование ${titleLabels[type]}` : isEdit ? `Редактирование ${titleLabels[type] || type}` : (isView ? `Просмотр ${titleLabels[type] || type}` : `Добавление ${titleLabels[type] || type}`);

  let body = '';
  if (type === 'team') body = renderTeamForm(data);
  else if (type === 'user') body = renderUserForm(data);
  else if (type === 'role') body = renderRoleForm(data);
  else if (type === 'rolePreview') body = renderRolePreview(data);
  else if (type === 'dict') body = renderDictionaryForm(data, { escapeHtml, safeHexColor, autoDictColor, dictCodePlaceholder });
  else if (type === 'project') body = renderProjectForm(data);
  else if (type === 'bc') body = renderBusinessCustomerForm(data);
  else if (type === 'report') body = renderReportForm(data, adminModal.mode, escapeHtml);
  else if (type === 'notificationTemplate') body = renderNotificationTemplateForm(data);

  return `
    <div class="admin-modal-overlay" id="admin-modal-overlay" style="z-index:1000">
      <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title" tabindex="-1" style="max-width:${type === 'rolePreview' ? '860' : type === 'role' ? '940' : (type === 'project' || type === 'bc' || type === 'notificationTemplate') ? '600' : type === 'report' ? '720' : '520'}px">
        <div class="modal-header-sticky">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
            <h3 id="admin-modal-title" style="margin:0;font-size:16px;font-weight:600">${title}</h3>
            <button class="modal-close-x" aria-label="Закрыть" style="width:32px;height:32px;border:none;background:transparent;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center">
              <i data-lucide="x" style="width:18px;height:18px;color:var(--text-muted)"></i>
            </button>
          </div>
        </div>
        <div class="modal-body-scroll">
          <div class="admin-form-error-summary" id="admin-form-error-summary" role="alert" tabindex="-1" hidden></div>
          <div id="modal-form-body">${body}</div>
        </div>
        <div class="modal-footer-sticky">
          ${(type === 'project' && isView) || type === 'rolePreview' ? `
          <div style="display:flex;justify-content:flex-end;gap:var(--space-3)">
            <button class="btn btn-secondary modal-cancel-btn">Закрыть</button>
          </div>` : type !== 'dict' ? `
          <div style="display:flex;justify-content:flex-end;gap:var(--space-3)">
            <button class="btn btn-secondary modal-cancel-btn">Отмена</button>
            <button class="btn btn-primary modal-save-btn">${isEdit ? 'Сохранить' : 'Создать'}</button>
          </div>` : `
          <div style="display:flex;justify-content:flex-end;gap:var(--space-3)">
            <button class="btn btn-secondary modal-cancel-btn">Отмена</button>
            <button class="btn btn-primary modal-save-btn">Сохранить</button>
          </div>`}
        </div>
      </div>
    </div>
  `;
}

const COLOR_PALETTE = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#2563eb', '#7c3aed', '#475569',
  '#64748b', '#94a3b8', '#78716c', '#d97706', '#dc2626',
  '#059669', '#0284c7', '#9333ea', '#db2777', '#65a30d',
];

function renderTeamForm(data) {
  const colorSwatches = COLOR_PALETTE.map(c =>
    `<span class="color-swatch ${data.color === c ? 'active' : ''}" data-color="${c}" style="background:${c};"></span>`
  ).join('');
  const users = adminData.users || [];
  const teamTypes = adminData.teamTypeRefs || [];
  const typeOpts = teamTypes.map(tt => `<option value="${tt.id}"${data.team_type_id == tt.id ? ' selected' : ''}>${escapeHtml(tt.name)}</option>`).join('');
  return `
    <div class="form-group">
      <label class="form-label">Название команды <span class="required">*</span></label>
      <input class="input modal-field" id="modal-name" value="${escapeHtml(data.name || '')}" placeholder="Название">
    </div>
    <div class="form-group">
      <label class="form-label">Аббревиатура (на аватаре)</label>
      <input class="input modal-field" id="modal-abbr" value="${escapeHtml(data.abbr || '')}" placeholder="Напр: PT" maxlength="4" style="width:100px">
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">1-4 буквы, отображаются на аватаре команды</div>
    </div>
    <div class="form-group">
      <label class="form-label">Тип команды</label>
      <select class="input modal-field" id="modal-team-type"><option value="">—</option>${typeOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Цвет</label>
      <input type="hidden" id="modal-color" value="${safeHexColor(data.color, '#6366f1')}">
      <div id="color-palette" style="display:flex;flex-wrap:wrap;gap:4px;padding:4px 0;">${colorSwatches}</div>
    </div>
    <div class="form-group">
      <label class="form-label">Product Leader (PL)</label>
      <select class="input modal-field" id="modal-pl">
        <option value="">—</option>
        ${users.map(u => `<option value="${escapeHtml(u.name)}"${data.pl === u.name ? ' selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Product Owner (PO)</label>
      <select class="input modal-field" id="modal-po">
        <option value="">—</option>
        ${users.map(u => `<option value="${escapeHtml(u.name)}"${data.po === u.name ? ' selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Cluster Lead (CL)</label>
      <select class="input modal-field" id="modal-cl">
        <option value="">—</option>
        ${users.map(u => `<option value="${escapeHtml(u.name)}"${data.cl === u.name ? ' selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">IT Product Lead (IT PL)</label>
      <select class="input modal-field" id="modal-it-pl">
        <option value="">—</option>
        ${users.map(u => `<option value="${escapeHtml(u.name)}"${data.it_pl === u.name ? ' selected' : ''}>${escapeHtml(u.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Описание</label>
      <textarea class="input modal-field" id="modal-description" placeholder="Описание команды" style="min-height:60px">${escapeHtml(data.description || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Домен</label>
      <input class="input modal-field" id="modal-domain" value="${escapeHtml(data.domain || '')}" placeholder="Домен">
    </div>
  `;
}

function renderUserForm(data) {
  const teams = adminData.teams || [];
  const roles = adminData.roles || [];
  const businessCustomers = adminData.businessCustomers || [];
  const teamOpts = teams.map(t => `<option value="${t.id}"${data.team_id == t.id ? ' selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
  const roleOpts = roles.map(r => `<option value="${r.id}"${data.role_id == r.id ? ' selected' : ''}>${getRoleDisplayName(r)}</option>`).join('');
  const customerOpts = businessCustomers.map(c => `<option value="${c.id}"${data.business_customer_id == c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  const initials = window.getUserInitials(data.name);
  const avatarColor = window.getAvatarColor(data.name);
  return `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
      <div id="user-avatar-preview" style="width:56px;height:56px;border-radius:50%;background:${safeHexColor(avatarColor)};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;color:white;flex-shrink:0">${escapeHtml(initials)}</div>
      <div style="font-size:13px;color:var(--text-muted)">Аватар формируется автоматически по первой букве имени и фамилии</div>
    </div>
    <div class="form-group">
      <label class="form-label">ФИО</label>
      <input class="input modal-field" id="modal-name" value="${escapeHtml(data.name || '')}" placeholder="ФИО пользователя">
    </div>
    <div class="form-group">
      <label class="form-label">Email</label>
      <input class="input modal-field" id="modal-email" value="${escapeHtml(data.email || '')}" placeholder="Email" type="email">
    </div>
    <div class="form-group">
      <label class="form-label">Роль</label>
      <select class="input modal-field" id="modal-role"><option value="">—</option>${roleOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Команда</label>
      <select class="input modal-field" id="modal-team"><option value="">—</option>${teamOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Бизнес-заказчик</label>
      <select class="input modal-field" id="modal-business-customer"><option value="">—</option>${customerOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Статус</label>
      <select class="input modal-field" id="modal-is-active">
        <option value="1"${data.is_active !== false ? ' selected' : ''}>Активен</option>
        <option value="0"${data.is_active === false ? ' selected' : ''}>Неактивен</option>
      </select>
    </div>
  `;
}

function renderRoleForm(data) {
  const permFields = [
    { key: 'backlog_dmb_access', label: 'Бэклог DMB', opts: ['none','read','read_write'] },
    { key: 'backlog_team_access', label: 'Бэклог команды', opts: ['none','read_own','write_own','read_all','write_all'] },
    { key: 'reports_access', label: 'Статусы для встреч', opts: ['none','read','read_write'] },
    { key: 'analytics_access', label: 'Аналитика', opts: ['none','read','read_write'] },
    { key: 'customer_access', label: 'Портал бизнес-заказчика', opts: ['none','read','read_write'] },
    { key: 'settings_access', label: 'Настройки', opts: ['none','available'] },
    { key: 'admin_access', label: 'Администрирование', opts: ['none','partial','full'] },
  ];
  const permHtml = permFields.map(p => {
    const isAdminField = p.key === 'admin_access';
    const isOwnRole = currentAdminUser && data.id === currentAdminUser.role_id;
    const blocked = isAdminField && isOwnRole;
    const opts = p.opts.map(o => {
      const disabled = blocked && o === 'none' ? ' disabled' : '';
      const selected = data[p.key] === o ? ' selected' : '';
      return `<option value="${o}"${selected}${disabled}>${getAccessLabel(o)}${disabled ? ' (заблокировано)' : ''}</option>`;
    }).join('');
    return `
      <div class="form-group">
        <label class="form-label">${p.label}${blocked ? ' <span style="color:#f43f5e;font-size:11px">— нельзя лишить себя доступа</span>' : ''}</label>
        <select class="input modal-field" id="modal-${p.key}">${opts}</select>
      </div>
    `;
  }).join('');
  const roleName = String(data.name || '').trim().toLocaleLowerCase('ru-RU');
  const portalOnly = data.customer_portal_only ?? roleName === 'бизнес-заказчик';
  const reviewAccess = data.review_access || (['проектный офис (админ)', 'администратор'].includes(roleName) ? 'all' : ['po/pl/cl', 'ba/участник команды', 'ba/бизнес-аналитик', 'лидер трайба'].includes(roleName) ? 'team' : 'none');
  const taskScopes = getRolePreview(data).taskScopes;
  const scopeOptions = selected => [['none', 'Запрещено'], ['team', 'Только своя команда'], ['all', 'Все команды']].map(([value, label]) => `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`).join('');

  return `
    <div class="form-group">
      <label class="form-label">Название роли <span class="required">*</span></label>
      <input class="input modal-field" id="modal-name" value="${getRoleDisplayName(data) || escapeHtml(data.name || '')}" placeholder="Название">
    </div>
    <div class="form-group">
      <label class="form-label">Описание</label>
      <input class="input modal-field" id="modal-description" value="${escapeHtml(data.description || '')}" placeholder="Описание">
    </div>
    <div style="margin:16px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--border-color)">
      <strong style="font-size:14px">Права доступа</strong>
    </div>
    ${permHtml}
    <div style="margin:20px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--border-color)"><strong style="font-size:14px">Сценарии интерфейса</strong><div style="font-size:11px;color:var(--text-muted);margin-top:4px">Эти настройки не зависят от названия роли.</div></div>
    <div class="form-group"><label class="form-label" for="modal-customer-portal-only">Режим бизнес-заказчика</label><select class="input modal-field" id="modal-customer-portal-only"><option value="0"${!portalOnly ? ' selected' : ''}>Обычный интерфейс</option><option value="1"${portalOnly ? ' selected' : ''}>Только «Мои задачи» и ИИ-ассистент</option></select></div>
    <div class="form-group"><label class="form-label" for="modal-review-access">Ревью запросов</label><select class="input modal-field" id="modal-review-access"><option value="none"${reviewAccess === 'none' ? ' selected' : ''}>Нет доступа</option><option value="team"${reviewAccess === 'team' ? ' selected' : ''}>Только запросы своей команды</option><option value="all"${reviewAccess === 'all' ? ' selected' : ''}>Запросы всех команд</option></select></div>
    <div style="margin:20px 0 12px;padding-bottom:8px;border-bottom:1px solid var(--border-color)"><strong style="font-size:14px">Операции с задачами</strong></div>
    <div class="form-group"><label class="form-label" for="modal-task-edit-scope">Редактирование</label><select class="input modal-field" id="modal-task-edit-scope">${scopeOptions(taskScopes.edit)}</select></div>
    <div class="form-group"><label class="form-label" for="modal-task-comment-scope">Комментирование</label><select class="input modal-field" id="modal-task-comment-scope">${scopeOptions(taskScopes.comment)}</select></div>
    <div class="form-group"><label class="form-label" for="modal-task-delete-scope">Удаление</label><select class="input modal-field" id="modal-task-delete-scope">${scopeOptions(taskScopes.delete)}</select></div>
    <div class="form-group"><label class="form-label" for="modal-pip-decision-access">PIP-решения</label><select class="input modal-field" id="modal-pip-decision-access"><option value="0"${!taskScopes.pip ? ' selected' : ''}>Запрещены</option><option value="1"${taskScopes.pip ? ' selected' : ''}>Разрешены</option></select></div>
  `;
}

function readRolePolicyFromForm() {
  return {
    customer_access: getFieldVal('modal-customer_access') || 'none', admin_access: getFieldVal('modal-admin_access') || 'none',
    reports_access: getFieldVal('modal-reports_access') || 'none', customer_portal_only: getFieldVal('modal-customer-portal-only') === '1',
    review_access: getFieldVal('modal-review-access') || 'none', task_edit_scope: getFieldVal('modal-task-edit-scope') || 'none',
    task_comment_scope: getFieldVal('modal-task-comment-scope') || 'none', task_delete_scope: getFieldVal('modal-task-delete-scope') || 'none',
    pip_decision_access: getFieldVal('modal-pip-decision-access') === '1',
  };
}

function updateRoleFormSummary() {
  const summary = document.getElementById('role-form-live-summary');
  if (!summary) return;
  const policy = readRolePolicyFromForm();
  const scopes = { none: 'запрещено', team: 'своя команда', all: 'все команды' };
  const sectionFields = ['backlog_dmb', 'backlog_team', 'reports', 'analytics', 'customer', 'settings', 'admin'];
  const visible = sectionFields.filter(key => getFieldVal(`modal-${key}_access`) !== 'none').length;
  const risks = validateRolePolicy(policy);
  summary.innerHTML = `<div class="role-live-head"><span>Сводка роли</span><strong>${risks.length ? `Ошибок: ${risks.length}` : 'Готово к сохранению'}</strong></div><dl><div><dt>Доступно разделов</dt><dd>${visible} из ${sectionFields.length}</dd></div><div><dt>Редактирование</dt><dd>${scopes[policy.task_edit_scope]}</dd></div><div><dt>Комментарии</dt><dd>${scopes[policy.task_comment_scope]}</dd></div><div><dt>Удаление</dt><dd>${scopes[policy.task_delete_scope]}</dd></div><div><dt>PIP-решения</dt><dd>${policy.pip_decision_access ? 'разрешены' : 'запрещены'}</dd></div></dl>${risks.length ? `<div class="role-live-risk"><i data-lucide="triangle-alert"></i><span>${escapeHtml(risks[0].message)}${risks.length > 1 ? ` И ещё ${risks.length - 1}.` : ''}</span></div>` : '<div class="role-live-ok"><i data-lucide="circle-check"></i> Конфликтов нет</div>'}`;
  if (window.lucide) lucide.createIcons({ attrs: { 'aria-hidden': 'true' } });
}

function enhanceRoleFormWorkspace() {
  if (adminModal.type !== 'role') return;
  const body = document.getElementById('modal-form-body');
  if (!body || body.querySelector('.role-form-workspace')) return;
  const groups = [...body.children];
  const sections = [
    ['basic', 'Основное', ['modal-name', 'modal-description']],
    ['sections', 'Разделы', ['modal-backlog_dmb_access', 'modal-backlog_team_access', 'modal-reports_access', 'modal-analytics_access', 'modal-customer_access', 'modal-settings_access', 'modal-admin_access']],
    ['tasks', 'Операции с задачами', ['modal-task-edit-scope', 'modal-task-comment-scope', 'modal-task-delete-scope', 'modal-pip-decision-access']],
    ['special', 'Специальные сценарии', ['modal-customer-portal-only', 'modal-review-access']],
  ];
  const workspace = document.createElement('div'); workspace.className = 'role-form-workspace';
  workspace.innerHTML = `<nav class="role-form-nav" aria-label="Разделы роли">${sections.map(([id, label], index) => `<button type="button" class="role-form-nav-btn${index === 0 ? ' is-active' : ''}" data-role-section="${id}">${label}</button>`).join('')}</nav><div class="role-form-columns"><div class="role-form-main"></div><aside class="role-form-aside" id="role-form-live-summary" aria-live="polite"></aside></div>`;
  const main = workspace.querySelector('.role-form-main');
  sections.forEach(([id, label, fieldIds]) => {
    const section = document.createElement('section'); section.className = 'role-form-section'; section.id = `role-section-${id}`; section.innerHTML = `<h4>${label}</h4>`;
    fieldIds.forEach(fieldId => { const group = groups.find(node => node.querySelector?.(`#${fieldId}`)); if (group) section.appendChild(group); });
    main.appendChild(section);
  });
  body.replaceChildren(workspace); updateRoleFormSummary();
}



function closeCompetencyInlineEditor() {
  const editor = document.getElementById('cc-inline-editor');
  if (!editor) return;
  editor.hidden = true;
  document.getElementById('cc-inline-error').textContent = '';
  const target = competencyEditorReturnFocus;
  competencyEditorReturnFocus = null;
  if (target?.isConnected) target.focus({ preventScroll: true });
}

function openCompetencyInlineEditor(mode, trigger) {
  const editor = document.getElementById('cc-inline-editor');
  const input = document.getElementById('cc-inline-value');
  if (!editor || !input) return;
  competencyEditorReturnFocus = trigger || document.activeElement;
  editor.dataset.mode = mode;
  editor.hidden = false;
  document.getElementById('cc-inline-label').textContent = mode === 'year' ? 'Новый год' : 'Новая компетенция';
  input.type = mode === 'year' ? 'number' : 'text';
  input.placeholder = mode === 'year' ? 'Например, 2028' : 'Название компетенции';
  input.min = mode === 'year' ? '2000' : '';
  input.max = mode === 'year' ? '2100' : '';
  input.value = '';
  document.getElementById('cc-inline-error').textContent = '';
  input.focus();
}

function showCompetencyInlineError(message) {
  const error = document.getElementById('cc-inline-error');
  const input = document.getElementById('cc-inline-value');
  if (error) error.textContent = message;
  input?.focus();
}

function addCompetencyCostYear(input) {
  const year = Number(input);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) { showCompetencyInlineError('Введите целый год от 2000 до 2100'); return false; }
  const table = document.querySelector('#comp-cost-table');
  if (!table) return false;
  if (table.querySelector(`th[data-year="${year}"]`)) { showCompetencyInlineError('Этот год уже есть в таблице'); return false; }
  table.querySelector('thead tr').insertAdjacentHTML('beforeend', `<th data-year="${year}" style="padding:8px;text-align:center;font-size:12px">${year}</th>`);
  table.querySelectorAll('tbody tr').forEach(tr => {
    const first = tr.querySelector('.comp-cost-input');
    const comp = first ? first.dataset.comp : '';
    tr.insertAdjacentHTML('beforeend', `<td style="padding:4px"><input class="input comp-cost-input" data-comp="${escapeHtml(comp)}" data-year="${year}" data-id="" value="" placeholder="0" style="width:90px"></td>`);
  });
  return true;
}

function addCompetencyCostCompetency(input) {
  const comp = input.trim();
  if (!comp) { showCompetencyInlineError('Введите название компетенции'); return false; }
  const table = document.querySelector('#comp-cost-table');
  if (!table) return false;
  if (Array.from(table.querySelectorAll('.comp-cost-input')).some(cell => cell.dataset.comp.toLocaleLowerCase() === comp.toLocaleLowerCase())) { showCompetencyInlineError('Такая компетенция уже есть в таблице'); return false; }
  const yearCells = Array.from(table.querySelectorAll('thead th[data-year]'));
  const tbody = table.querySelector('tbody');
  const tr = document.createElement('tr');
  tr.insertAdjacentHTML('beforeend', `<td style="padding:8px;font-weight:500;font-size:13px">${escapeHtml(comp)}</td>`);
  yearCells.forEach(th => {
    const year = th.dataset.year;
    tr.insertAdjacentHTML('beforeend', `<td style="padding:4px"><input class="input comp-cost-input" data-comp="${escapeHtml(comp)}" data-year="${year}" data-id="" value="" placeholder="0" style="width:90px"></td>`);
  });
  tbody.querySelector('tr td.text-muted')?.closest('tr')?.remove();
  tbody.appendChild(tr);
  return true;
}

function confirmCompetencyInlineEditor() {
  const editor = document.getElementById('cc-inline-editor');
  const value = document.getElementById('cc-inline-value')?.value || '';
  if (!editor) return;
  const added = editor.dataset.mode === 'year' ? addCompetencyCostYear(value) : addCompetencyCostCompetency(value);
  if (added) closeCompetencyInlineEditor();
}

async function saveCompetencyCosts(app) {
  const cells = Array.from(document.querySelectorAll('.comp-cost-input')).map(input => ({
    competency: input.dataset.comp,
    year: parseInt(input.dataset.year),
    id: input.dataset.id || '',
    rate: input.value.trim(),
  })).filter(c => c.competency && c.year);

  const invalidRate = cells.find(cell => cell.rate !== '' && (!Number.isFinite(Number(cell.rate)) || Number(cell.rate) < 0));
  if (invalidRate) {
    const input = Array.from(document.querySelectorAll('.comp-cost-input')).find(candidate => candidate.dataset.comp === invalidRate.competency && Number(candidate.dataset.year) === invalidRate.year);
    const summary = document.getElementById('admin-form-error-summary');
    if (summary) { summary.hidden = false; summary.textContent = 'Ставка должна быть неотрицательным числом.'; }
    input?.classList.add('admin-field-invalid'); input?.focus();
    return;
  }

  if (cells.length === 0) { toast('Нет данных для сохранения', 'error'); return; }

  const changes = cells.filter(c => {
    if (!c.id) return c.rate !== '';
    const original = adminData.competencyCosts.find(x => String(x.id) === String(c.id));
    return !original || String(original.rate) !== c.rate;
  });
  if (changes.length === 0) { toast('Нет изменений', 'info'); return; }

  const doSave = async () => {
    if (adminFormSaving) return;
    setAdminFormSaving(true);
    try {
      const result = await app.api.put('/admin/competency-costs/batch', {
        version: currentDictVersion,
        items: cells.filter(c => c.rate !== '').map(c => ({
          competency: c.competency,
          year: c.year,
          rate: parseFloat(c.rate),
        })),
      });
      adminModal.show = false;
      updateAdminUrl('replace', { admin_dict: '' }); adminDictHistoryPushed = false;
      document.getElementById('admin-modal-root').innerHTML = '';
      deactivateAdminModalFocus();
      await releaseDictLockIfHeld(app);
      toast(`Ставки сохранены: добавлено ${result.added}, изменено ${result.updated}, архивировано ${result.archived}`, 'success');
      await initAdmin(app);
    } catch (e) {
      const message = Number(e.status || 0) === 409 ? 'Таблица ставок изменена другим администратором. Закройте и откройте форму повторно.' : `Ошибка сохранения: ${e.message || 'не удалось связаться с сервером'}`;
      const summary = document.getElementById('admin-form-error-summary');
      if (summary) { summary.hidden = false; summary.textContent = `${message} Введённые данные сохранены в форме.`; summary.focus(); }
      toast(message, 'error');
      setAdminFormSaving(false);
    }
  };

  const deletions = cells.filter(c => c.id && c.rate === '').length;
  if (deletions > 0) {
    showConfirmModal(`Будут удалены ставки (${deletions} шт.), сохранённые effort_rub задач пересчитаются. Продолжить?`, doSave);
  } else {
    await doSave();
  }
}

window.openDictColorPalette = function(swatch) {
    const existing = document.querySelector('.dict-color-popup');
    if (existing) existing.remove();

    const currentColor = swatch.previousElementSibling.value || '#6366f1';
    const popup = document.createElement('div');
    popup.className = 'dict-color-popup';
    popup.style.cssText = 'position:absolute;z-index:1000;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,0.25);display:flex;flex-wrap:wrap;gap:4px;width:196px;';
    COLOR_PALETTE.forEach(c => {
        const dot = document.createElement('span');
        dot.className = 'color-swatch' + (c === currentColor ? ' active' : '');
        dot.style.cssText = `background:${c};width:22px;height:22px;border-radius:4px;cursor:pointer;border:2px solid ${c === currentColor ? 'var(--accent)' : 'transparent'};`;
        dot.onclick = (e) => {
            e.stopPropagation();
            swatch.style.background = c;
            swatch.previousElementSibling.value = c;
            markDictEdited(swatch.previousElementSibling);
            popup.remove();
        };
        popup.appendChild(dot);
    });
    swatch.parentElement.style.position = 'relative';
    swatch.parentElement.appendChild(popup);

    const closePopup = (e) => {
        if (!popup.contains(e.target) && e.target !== swatch) {
            popup.remove();
            document.removeEventListener('click', closePopup);
        }
    };
    setTimeout(() => document.addEventListener('click', closePopup), 0);
};

// ==================== EVENT HANDLERS ====================

async function handleAdminClick(e, app) {
  const target = e.target.closest('button, .modal-close-x, .admin-dict-card, [data-report], [data-admin-report-id], .color-swatch, .admin-sort-th');
  if (!target) return;

  if (target.id === 'role-compare-clear') {
    roleCompare = { left: '', right: '' };
    document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
    pullStickyBars(); bindAdminEvents(app);
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (target.classList.contains('role-form-nav-btn')) {
    document.querySelectorAll('.role-form-nav-btn').forEach(button => button.classList.toggle('is-active', button === target));
    document.getElementById(`role-section-${target.dataset.roleSection}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (target.classList.contains('admin-row-details-toggle')) {
    const row = target.closest('tr');
    const expanded = row.classList.toggle('admin-row-expanded');
    target.setAttribute('aria-expanded', String(expanded)); target.textContent = expanded ? 'Скрыть' : 'Подробнее';
    return;
  }

  if (target.id === 'audit-reset' || (target.classList.contains('admin-list-page') && target.dataset.listTab === 'audit')) {
    if (target.id === 'audit-reset') auditState = { page: 1, perPage: 50, search: '', action: '', entityType: '', userId: '', dateFrom: '', dateTo: '' };
    else auditState.page = Number(target.dataset.page) || 1;
    updateAdminUrl('push'); refreshAuditTab(app);
    return;
  }

  if (target.id === 'admin-user-filters-reset') {
    userSearch = '';
    userFilters = { role: '', team: '', status: '' };
    adminListState.users.page = 1;
    updateAdminUrl('push'); document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
    pullStickyBars(); bindAdminEvents(app);
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (target.matches('.admin-list-reset, .admin-list-page')) {
    const tab = target.dataset.listTab;
    const state = adminListState[tab];
    if (!state) return;
    if (target.classList.contains('admin-list-reset')) { state.search = ''; state.filter = ''; state.page = 1; }
    else state.page = Number(target.dataset.page) || 1;
    updateAdminUrl('push'); document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
    pullStickyBars();
    bindAdminEvents(app);
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (target.matches('[data-report-step], #report-step-prev, #report-step-next')) {
    const wizard = target.closest('.report-wizard');
    if (!wizard) return;
    const current = Number(wizard.dataset.step || 1);
    const requested = target.dataset.reportStep ? Number(target.dataset.reportStep) : target.id === 'report-step-prev' ? current - 1 : current + 1;
    setReportWizardStep(wizard, Math.max(1, Math.min(4, requested)));
    return;
  }

  if (target.id === 'report-fields-all' || target.id === 'report-fields-clear') {
    document.querySelectorAll('.report-field-cb').forEach(box => { box.checked = target.id === 'report-fields-all'; });
    syncReportSelectedFields();
    return;
  }

  if (target.matches('.report-field-up, .report-field-down')) {
    const row = target.closest('.report-selected-field');
    if (target.classList.contains('report-field-up') && row.previousElementSibling) row.parentElement.insertBefore(row, row.previousElementSibling);
    if (target.classList.contains('report-field-down') && row.nextElementSibling) row.parentElement.insertBefore(row.nextElementSibling, row);
    updateReportPreview();
    return;
  }

  if (target.id === 'admin-retry-btn') {
    adminLoadState[adminTab] = { status: 'loading' };
    const content = document.getElementById('admin-content');
    if (content) content.innerHTML = renderTabContent(adminTab, app);
    loadAdminTab(app, adminTab, true).then(() => {
      if (content) content.innerHTML = renderTabContent(adminTab, app);
      bindAdminEvents(app);
      if (window.lucide) lucide.createIcons();
    });
    return;
  }

  if (target.classList.contains('admin-sort-th')) {
    const field = target.dataset.sort;
    if (userSort.field === field) {
      userSort.dir = userSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      userSort.field = field;
      userSort.dir = 'asc';
    }
    document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
    pullStickyBars();
    if (window.lucide) lucide.createIcons();
    bindAdminEvents(app);
    return;
  }

  if (target.classList.contains('modal-close-x') || target.classList.contains('modal-cancel-btn')) {
    requestCloseAdminModal(app);
    return;
  }

  if (target.closest('.color-swatch')) {
    const swatch = target.closest('.color-swatch');
    document.querySelectorAll('.color-swatch').forEach(s => { s.style.borderColor = 'transparent'; });
    swatch.style.borderColor = 'var(--accent)';
    const modalColor = document.getElementById('modal-color');
    if (modalColor) modalColor.value = swatch.dataset.color;
    return;
  }

  if (target.classList.contains('modal-save-btn')) {
    saveModalData(app);
    return;
  }

  if (target.id === 'cc-add-year') {
    openCompetencyInlineEditor('year', target);
    return;
  }

  if (target.id === 'cc-add-competency') {
    openCompetencyInlineEditor('competency', target);
    return;
  }

  if (target.id === 'cc-inline-confirm') {
    confirmCompetencyInlineEditor();
    return;
  }

  if (target.id === 'cc-inline-cancel') {
    closeCompetencyInlineEditor();
    return;
  }

  if (target.id === 'project-add-btn') {
    adminModal = { show: true, mode: 'add', type: 'project', data: {} };
    refreshModal();
    return;
  }

  if (target.id === 'bc-add-btn') {
    adminModal = { show: true, mode: 'add', type: 'bc', data: {} };
    refreshModal();
    return;
  }

  if (target.classList.contains('notification-variable')) {
    const textarea = document.getElementById('notification-template-text');
    if (!textarea) return;
    const token = `{${target.dataset.variable}}`;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    textarea.value = `${textarea.value.slice(0, start)}${token}${textarea.value.slice(end)}`;
    textarea.focus(); textarea.setSelectionRange(start + token.length, start + token.length);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  if (target.classList.contains('admin-add-btn')) {
    adminModal = { show: true, mode: 'add', type: target.dataset.type, data: {} };
    refreshModal();
    return;
  }

  if (target.classList.contains('role-preview-btn')) {
    const role = (adminData.roles || []).find(item => item.id === parseInt(target.dataset.id));
    if (!role) return;
    adminModal = { show: true, mode: 'view', type: 'rolePreview', data: { ...role } };
    refreshModal();
    return;
  }

  if (target.classList.contains('admin-edit-btn')) {
    const type = target.dataset.type;
    const id = parseInt(target.dataset.id);
    const keyMap = { team: 'teams', user: 'users', role: 'roles', project: 'projects', bc: 'businessCustomers', report: 'reports', notificationTemplate: 'notificationTemplates' };
    const item = (adminData[keyMap[type]] || []).find(d => d.id === id);
    if (!item) return;
    adminModal = { show: true, mode: 'edit', type, data: { ...item } };
    refreshModal();
    return;
  }

  if (target.classList.contains('admin-delete-btn')) {
    confirmDelete(target.dataset.type, parseInt(target.dataset.id), app);
    return;
  }

  if (target.classList.contains('notification-template-toggle')) {
    const item = (adminData.notificationTemplates || []).find(template => template.id === parseInt(target.dataset.id));
    if (!item) return;
    target.disabled = true;
    try {
      await app.api.put(`/admin/notification-templates/${item.id}`, { is_active: !item.is_active });
      toast(item.is_active ? 'Шаблон отключён' : 'Шаблон включён', 'success');
      await loadAdminTab(app, 'notifications', true);
      document.getElementById('admin-content').innerHTML = renderTabContent('notifications', app);
      pullStickyBars(); bindAdminEvents(app); if (window.lucide) lucide.createIcons();
    } catch (error) {
      target.disabled = false;
      toast(error.message || 'Не удалось изменить статус шаблона', 'error');
    }
    return;
  }

  if (target.classList.contains('admin-dict-card')) {
    const dictKey = target.dataset.dict;
    const lock = dictLocks[DICTIONARY_CONFIG[dictKey]?.type];
    if (lock && lock.locked && !lock.is_mine) {
      toast(`Справочник редактируется: ${lock.lock_owner_name || 'Администратор'}`, 'error');
      return;
    }
    openDictModal(dictKey, app);
    return;
  }

  if (target.id === 'report-view-back') {
    adminReportView = null;
    const content = document.getElementById('admin-content');
    if (content) {
      content.innerHTML = renderTabContent(adminTab, app);
      pullStickyBars();
      if (window.lucide) lucide.createIcons();
      bindAdminEvents(app);
    }
    return;
  }

  if (target.id === 'report-execute-btn' || target.closest('#report-execute-btn')) {
    const btn = target.closest('#report-execute-btn') || target;
    const reportId = btn.dataset.reportId;
    if (reportId) executeAdminReport(parseInt(reportId), app, adminReportView, escapeHtml);
    return;
  }

  if (target.id === 'report-add-filter' || target.closest('#report-add-filter')) {
    const container = document.getElementById('report-filters-container');
    if (container) {
      const index = container.querySelectorAll('.report-filter-row').length;
      container.insertAdjacentHTML('beforeend', renderFilterRow({}, index));
      if (window.lucide) lucide.createIcons();
    }
    return;
  }

  if (target.classList.contains('report-filter-remove') || target.closest('.report-filter-remove')) {
    const row = target.closest('.report-filter-row');
    if (row) row.remove();
    return;
  }

  const reportCard = target.closest('[data-admin-report-id]');
  if (reportCard) {
    const id = parseInt(reportCard.dataset.adminReportId);
    const report = (adminData.reports || []).find(r => r.id === id);
    if (report) {
      adminReportView = report;
      const content = document.getElementById('admin-content');
      if (content) {
        content.innerHTML = renderTabContent(adminTab, app);
        pullStickyBars();
        if (window.lucide) lucide.createIcons();
        bindAdminEvents(app);
      }
    }
    return;
  }
}

function updateDictionaryEditorState() {
  const activeRows = Array.from(document.querySelectorAll('#dict-items-container .dict-editor-row'));
  const archivedRows = Array.from(document.querySelectorAll('#dict-archive-container .dict-editor-row'));
  const changed = [...activeRows, ...archivedRows].filter(row => row.classList.contains('is-dirty')).length;
  const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = String(value); };
  setText('dict-active-count', activeRows.length); setText('dict-archive-count', archivedRows.length); setText('dict-archive-summary-count', archivedRows.length); setText('dict-pending-count', changed);
  const archive = document.getElementById('dict-archive');
  if (archive) archive.hidden = archivedRows.length === 0;
  const empty = document.querySelector('#dict-items-container .dict-empty-state');
  if (empty && activeRows.length) empty.remove();
  const saveButton = document.querySelector('#admin-modal-overlay .modal-save-btn');
  if (saveButton && adminModal.type === 'dict') {
    saveButton.disabled = changed === 0 || activeRows.length === 0 || Boolean(document.querySelector('.dict-editor-row.has-error'));
    saveButton.textContent = changed ? `Сохранить изменения (${changed})` : 'Нет изменений';
  }
}

function validateDictionaryEditor() {
  const rows = Array.from(document.querySelectorAll('#dict-items-container .dict-editor-row'));
  const names = new Map(); const codes = new Map(); let errors = 0;
  rows.forEach(row => { row.classList.remove('has-error'); row.querySelector('.dict-row-error').textContent = ''; });
  rows.forEach(row => {
    const name = row.querySelector('.dict-value-input').value.trim();
    const code = row.querySelector('.dict-code-input').value.trim();
    const nameKey = name.toLocaleLowerCase(); const codeKey = code.toLocaleLowerCase();
    if (nameKey) names.set(nameKey, (names.get(nameKey) || 0) + 1); if (codeKey) codes.set(codeKey, (codes.get(codeKey) || 0) + 1);
  });
  rows.forEach(row => {
    const name = row.querySelector('.dict-value-input').value.trim(); const code = row.querySelector('.dict-code-input').value.trim();
    const nameKey = name.toLocaleLowerCase(); const codeKey = code.toLocaleLowerCase();
    let message = !name ? 'Введите название' : '';
    if (!message && names.get(nameKey) > 1) message = 'Название уже используется';
    if (!message && codeKey && codes.get(codeKey) > 1) message = 'Код уже используется';
    if (message) { row.classList.add('has-error'); row.querySelector('.dict-row-error').textContent = message; errors += 1; }
  });
  const empty = rows.length === 0;
  const summary = document.getElementById('dict-validation-summary');
  if (summary) { summary.hidden = errors === 0 && !empty; summary.textContent = empty ? 'В справочнике должно остаться хотя бы одно активное значение' : errors ? `Исправьте ошибки в строках: ${errors}` : ''; }
  updateDictionaryEditorState();
  return errors === 0 && !empty;
}

function createDictionaryEditorRow() {
  const row = document.createElement('div'); const defaultColor = autoDictColor('');
  row.className = 'dict-editor-row is-dirty is-new'; row.draggable = true; row.dataset.itemId = ''; row.dataset.active = 'true'; row.dataset.usage = '0';
  row.innerHTML = `<button type="button" class="dict-drag-handle" title="Перетащить для сортировки"><i data-lucide="grip-vertical"></i></button><input type="hidden" class="dict-color-input" value="${defaultColor}"><button type="button" class="dict-color-swatch" style="background:${defaultColor}" title="Выбрать цвет"></button><div class="dict-editor-field"><label>Название</label><input class="input dict-value-input" placeholder="Значение"><span class="dict-row-error"></span></div><div class="dict-editor-field dict-code-field"><label>Код</label><input class="input dict-code-input" placeholder="${escapeHtmlAttribute(dictCodePlaceholder((adminModal.data || {}).dictKey))}"></div><span class="dict-usage-badge" title="Количество связанных записей"><i data-lucide="link"></i>0</span><span class="dict-row-state">Новое</span><button type="button" class="dict-remove-btn dict-row-action" title="Удалить новую строку"><i data-lucide="x"></i></button>`;
  return row;
}

function moveDictionaryRowToArchive(row) {
  row.classList.add('is-archived', 'is-dirty'); row.dataset.active = 'false'; row.draggable = false;
  row.querySelectorAll('input').forEach(input => { if (input.type !== 'hidden') input.disabled = true; });
  row.querySelector('.dict-drag-handle').disabled = true; row.querySelector('.dict-row-state').textContent = 'Будет архивировано';
  const action = row.querySelector('.dict-remove-btn'); action.className = 'dict-restore-btn dict-row-action'; action.title = 'Восстановить'; action.innerHTML = '<i data-lucide="archive-restore"></i>';
  document.getElementById('dict-archive-container').appendChild(row); updateDictionaryEditorState(); validateDictionaryEditor();
}

function restoreDictionaryRow(row) {
  row.classList.remove('is-archived'); row.classList.add('is-dirty'); row.dataset.active = 'true'; row.draggable = true;
  row.querySelectorAll('input').forEach(input => { input.disabled = false; }); row.querySelector('.dict-drag-handle').disabled = false; row.querySelector('.dict-row-state').textContent = 'Восстановлено';
  const action = row.querySelector('.dict-restore-btn'); action.className = 'dict-remove-btn dict-row-action'; action.title = 'Архивировать'; action.innerHTML = '<i data-lucide="archive"></i>';
  document.getElementById('dict-items-container').appendChild(row); updateDictionaryEditorState(); validateDictionaryEditor();
}

function handleDictEvents(e, app) {
  const target = e.target.closest?.('button, input, .dict-color-swatch') || e.target;

  const dictSwatch = target.closest?.('.dict-color-swatch');
  if (dictSwatch) {
    window.openDictColorPalette(dictSwatch);
    return;
  }

  if (target.id === 'dict-add-value') {
    const container = document.getElementById('dict-items-container');
    if (!container) return;
    const row = createDictionaryEditorRow();
    container.appendChild(row);
    updateDictionaryEditorState(); validateDictionaryEditor(); row.querySelector('.dict-value-input').focus();
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (target.classList.contains('dict-remove-btn')) {
    const row = target.closest('.dict-editor-row');
    if (!row) return;
    if (row.classList.contains('is-new')) { row.remove(); updateDictionaryEditorState(); validateDictionaryEditor(); }
    else if (Number(row.dataset.usage || 0) > 0) showConfirmModal(`Значение используется в ${row.dataset.usage} связанных записях. Архивировать его?`, () => { moveDictionaryRowToArchive(row); if (window.lucide) lucide.createIcons(); });
    else moveDictionaryRowToArchive(row);
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (target.classList.contains('dict-restore-btn')) {
    const row = target.closest('.dict-editor-row'); if (row) restoreDictionaryRow(row);
    if (window.lucide) lucide.createIcons();
    return;
  }

  if (target.classList.contains('dict-color-input') || target.classList.contains('dict-value-input') || target.classList.contains('dict-code-input')) {
    return;
  }
}

async function handleAdminTabClick(e, app) {
  const btn = e.target.closest('.admin-tab[data-tab]');
  if (!btn) return;
  document.querySelectorAll('.admin-tab').forEach(button => { const active = button === btn; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
  adminTab = btn.dataset.tab;
  updateAdminUrl('push');
  adminReportView = null;
  const content = document.getElementById('admin-content');
  if (content) {
    if (adminLoadState[adminTab]?.status !== 'success') {
      adminLoadState[adminTab] = { status: 'loading' };
      content.innerHTML = renderTabContent(adminTab, app);
    }
    await loadAdminTab(app, adminTab);
    content.innerHTML = renderTabContent(adminTab, app);
    pullStickyBars();
    if (window.lucide) lucide.createIcons();
    bindAdminEvents(app);
    if (adminTab === 'home') {
      loadTimelineAdminEvents(app);
    }
  }
}

async function applyAdminHistoryState(app) {
  const desired = hydrateAdminUrlState();
  const allowedTabs = ['teams', 'projects', 'businessCustomers', 'users', 'roles', 'home', 'dictionaries', 'display', 'reports', ...(getAdminAccess(app) === 'full' ? ['audit'] : [])];
  const nextTab = allowedTabs.includes(desired.tab) ? desired.tab : 'teams';
  if (adminModal.show && adminModal.type === 'dict' && desired.dictKey !== adminModal.data?.dictKey) {
    if (isAdminFormDirty()) {
      updateAdminUrl('push', { admin_dict: adminModal.data?.dictKey || '', admin_dict_q: dictionaryViewState[adminModal.data?.dictKey]?.search || '' });
      showConfirmModal('Перейти назад? Несохранённые изменения справочника будут потеряны.', () => { adminFormInitialSnapshot = ''; window.history.back(); });
      return;
    }
    await releaseDictLockIfHeld(app); adminModal.show = false; adminDictHistoryPushed = false; document.getElementById('admin-modal-root').innerHTML = ''; deactivateAdminModalFocus();
  }
  adminTab = nextTab;
  document.querySelectorAll('.admin-tab').forEach(button => { const active = button.dataset.tab === adminTab; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
  const mobileSelect = document.getElementById('admin-tab-mobile-select'); if (mobileSelect) mobileSelect.value = adminTab;
  const content = document.getElementById('admin-content');
  if (!content) return;
  await loadAdminTab(app, adminTab);
  content.innerHTML = renderTabContent(adminTab, app); pullStickyBars(); bindAdminEvents(app); if (window.lucide) lucide.createIcons();
  if (desired.dictKey && adminTab === 'dictionaries' && DICTIONARY_CONFIG[desired.dictKey] && !adminModal.show) await openDictModal(desired.dictKey, app, { fromHistory: true });
}

// ==================== MODAL DATA SAVE ====================

function getFieldVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function getCheckVal(id) {
  const el = document.getElementById(id);
  return el ? el.checked : false;
}

function closeAdminModal(app) {
  const wasDictionary = adminModal.type === 'dict';
  releaseDictLockIfHeld(app);
  adminModal.show = false;
  document.getElementById('admin-modal-overlay')?.remove();
  adminFormInitialSnapshot = '';
  adminFormSaving = false;
  deactivateAdminModalFocus();
  if (wasDictionary) {
    if (adminDictHistoryPushed) window.history.back();
    else updateAdminUrl('replace', { admin_dict: '' });
    adminDictHistoryPushed = false;
  }
}

function requestCloseAdminModal(app) {
  if (adminFormSaving) return;
  if (isAdminFormDirty()) {
    showConfirmModal('Закрыть форму? Несохранённые изменения будут потеряны.', () => closeAdminModal(app));
    return;
  }
  closeAdminModal(app);
}

function saveModalData(app) {
  const { type, mode, data } = adminModal;
  clearAdminFormErrors();
  if (type !== 'dict' && type !== 'report' && showAdminFormErrors(validateAdminEntityForm(type, data))) return;
  if (type === 'team') {
    const payload = {
      name: getFieldVal('modal-name'),
      abbr: getFieldVal('modal-abbr') || null,
      team_type_id: parseInt(getFieldVal('modal-team-type')) || null,
      color: getFieldVal('modal-color') || '#6366f1',
      pl: getFieldVal('modal-pl'),
      po: getFieldVal('modal-po'),
      cl: getFieldVal('modal-cl'),
      it_pl: getFieldVal('modal-it-pl'),
      description: getFieldVal('modal-description'),
      domain: getFieldVal('modal-domain'),
    };
    saveEntity('team', { ...data, ...payload }, app);
  } else if (type === 'user') {
    const teamId = parseInt(getFieldVal('modal-team')) || null;
    const payload = {
      name: getFieldVal('modal-name'),
      email: getFieldVal('modal-email'),
      role_id: parseInt(getFieldVal('modal-role')) || null,
      team_id: teamId,
      business_customer_id: parseInt(getFieldVal('modal-business-customer')) || null,
      is_active: getFieldVal('modal-is-active') === '1',
    };
    if (mode === 'add') {
      payload.password = 'dmb2026';
    }
    saveEntity('user', { ...data, ...payload }, app);
  } else if (type === 'role') {
    const payload = {
      name: getFieldVal('modal-name'),
      description: getFieldVal('modal-description'),
      backlog_dmb_access: getFieldVal('modal-backlog_dmb_access') || 'none',
      backlog_team_access: getFieldVal('modal-backlog_team_access') || 'none',
      reports_access: getFieldVal('modal-reports_access') || 'none',
      analytics_access: getFieldVal('modal-analytics_access') || 'none',
      customer_access: getFieldVal('modal-customer_access') || 'none',
      settings_access: getFieldVal('modal-settings_access') || 'none',
      admin_access: getFieldVal('modal-admin_access') || 'none',
      customer_portal_only: getFieldVal('modal-customer-portal-only') === '1',
      review_access: getFieldVal('modal-review-access') || 'none',
      task_edit_scope: getFieldVal('modal-task-edit-scope') || 'none',
      task_comment_scope: getFieldVal('modal-task-comment-scope') || 'none',
      task_delete_scope: getFieldVal('modal-task-delete-scope') || 'none',
      pip_decision_access: getFieldVal('modal-pip-decision-access') === '1',
    };
    if (showAdminFormErrors(validateRolePolicy(payload))) return;
    saveEntity('role', { ...data, ...payload }, app);
  } else if (type === 'project') {
    const payload = getProjectPayload();
    saveEntity('project', { ...data, ...payload }, app);
  } else if (type === 'bc') {
    const payload = getBusinessCustomerPayload();
    saveEntity('bc', { ...data, ...payload }, app);
  } else if (type === 'report') {
    const errors = validateReportForm(adminModal.data);
    if (errors.length) {
      const error = errors[0];
      const wizard = document.querySelector('.report-wizard');
      if (wizard) setReportWizardStep(wizard, error.step);
      const box = document.getElementById('report-form-error');
      if (box) { box.hidden = false; box.textContent = error.message; }
      const summary = document.getElementById('admin-form-error-summary');
      if (summary) { summary.hidden = false; summary.innerHTML = `<strong>Исправьте ошибку</strong><p>${escapeHtml(error.message)}</p>`; summary.focus(); }
      toast(error.message, 'error');
      return;
    }
    const payload = getReportPayload(adminModal.data);
    if (!payload.name) { toast('Введите название отчёта', 'error'); return; }
    saveEntity('report', { ...data, ...payload }, app);
  } else if (type === 'notificationTemplate') {
    const payload = getNotificationTemplatePayload();
    if (showAdminFormErrors(validateNotificationTemplate(payload))) return;
    saveEntity('notificationTemplate', { ...data, ...payload }, app);
  } else if (type === 'dict') {
    saveDictData(app);
  }
}

async function saveDictData(app) {
  const { data } = adminModal;
  if (data.dictKey === 'competencyCosts') {
    await saveCompetencyCosts(app);
    return;
  }
  if (!validateDictionaryEditor()) {
    document.querySelector('.dict-editor-row.has-error input')?.focus();
    return;
  }
  const rows = document.querySelectorAll('#dict-items-container > div');
  const items = Array.from(rows).map(row => {
    const colorInput = row.querySelector('.dict-color-input');
    const codeInput = row.querySelector('.dict-code-input');
    const valueInput = row.querySelector('.dict-value-input');
    return {
      id: row.dataset.itemId ? parseInt(row.dataset.itemId) : null,
      name: valueInput ? valueInput.value : '',
      code: codeInput ? codeInput.value : '',
      color: colorInput ? colorInput.value : '',
    };
  });

  const { validItems, deleteIds: toDelete } = getDictionaryChanges(items, (data.items || []).filter(item => item.is_active !== false));

  const doSave = async () => {
    if (adminFormSaving) return;
    setAdminFormSaving(true);
    try {
      const result = await persistDictionaryItems(app, data.dictKey, validItems, currentDictVersion);
      adminModal.show = false;
      updateAdminUrl('replace', { admin_dict: '' }); adminDictHistoryPushed = false;
      document.getElementById('admin-modal-root').innerHTML = '';
      deactivateAdminModalFocus();
      await releaseDictLockIfHeld(app);
      toast(`Справочник сохранён: добавлено ${result.added}, изменено ${result.updated}, архивировано ${result.archived}`, 'success');
      await initAdmin(app);
    } catch (e) {
      const message = Number(e.status || 0) === 409 ? 'Справочник изменён другим администратором. Закройте форму и откройте её повторно.' : `Ошибка сохранения: ${e.message || 'не удалось связаться с сервером'}`;
      const summary = document.getElementById('admin-form-error-summary');
      if (summary) { summary.hidden = false; summary.textContent = `${message} Введённые данные сохранены в форме.`; summary.focus(); }
      toast(message, 'error');
      setAdminFormSaving(false);
    }
  };

  if (toDelete.length > 0) {
    showConfirmModal(`Будут удалены элементы справочника (${toDelete.length} шт.). Продолжить?`, doSave);
  } else {
    await doSave();
  }
}

async function saveEntity(type, data, app) {
  const endpointMap = {
    team: '/admin/teams',
    user: '/admin/users',
    role: '/admin/roles',
    project: '/admin/projects',
    bc: '/admin/business-customers',
    report: '/reports/',
    notificationTemplate: '/admin/notification-templates',
  };
  const endpoint = endpointMap[type];
  if (!endpoint) return;

  const saveButton = document.querySelector('#admin-modal-overlay .modal-save-btn');
  if (adminFormSaving || saveButton?.disabled) return;
  adminFormSaving = true;
  if (saveButton) { saveButton.dataset.originalText = saveButton.textContent; saveButton.disabled = true; saveButton.setAttribute('aria-busy', 'true'); saveButton.textContent = 'Сохранение…'; }

  try {
    if (data.id) {
      await app.api.put(`${endpoint.replace(/\/$/, '')}/${data.id}`, data);
    } else {
      await app.api.post(endpoint, data);
    }
    adminModal.show = false;
    adminFormInitialSnapshot = '';
    adminFormSaving = false;
    document.getElementById('admin-modal-root').innerHTML = '';
    deactivateAdminModalFocus();
    toast('Сохранено', 'success');
    await initAdmin(app);
  } catch (e) {
    const status = Number(e.status || e.statusCode || 0);
    const prefix = status === 409 ? 'Данные уже изменены другим пользователем. Обновите список и повторите.' : status === 0 || status >= 500 ? 'Не удалось связаться с сервером. Введённые данные сохранены в форме.' : (e.message || 'Не удалось сохранить данные');
    const fieldAliases = { name: type === 'notificationTemplate' ? 'notification-template-name' : type === 'bc' ? 'bc-name' : type === 'project' ? 'project-name' : type === 'report' ? 'report-name' : 'modal-name', text: 'notification-template-text', recipients: null, repeat_day: 'notification-template-repeat-day', event_type: 'notification-template-event', email: 'modal-email', code: 'project-code', project_name: 'project-name', customer_access: 'modal-customer_access', admin_access: 'modal-admin_access', review_access: 'modal-review-access', task_edit_scope: 'modal-task-edit-scope', task_comment_scope: 'modal-task-comment-scope', task_delete_scope: 'modal-task-delete-scope', pip_decision_access: 'modal-pip-decision-access' };
    const details = Array.isArray(e.detail) ? e.detail : Array.isArray(e.details) ? e.details : [];
    const serverErrors = details.map(detail => ({ field: fieldAliases[String(detail.loc?.at(-1) || detail.field || '')], message: detail.msg || detail.message || prefix })).filter(error => error.field);
    if (serverErrors.length) showAdminFormErrors(serverErrors);
    else {
      const summary = document.getElementById('admin-form-error-summary');
      if (summary) { summary.hidden = false; summary.textContent = prefix; summary.focus(); }
    }
    toast(prefix, 'error');
    adminFormSaving = false;
    if (saveButton?.isConnected) {
      saveButton.disabled = false;
      saveButton.removeAttribute('aria-busy');
      saveButton.textContent = saveButton.dataset.originalText || (data.id ? 'Сохранить' : 'Создать');
    }
  }
}

async function confirmDelete(type, id, app) {
  const typeLabel = { team: 'команда', user: 'пользователь', role: 'роль', project: 'проект', bc: 'бизнес-заказчик', report: 'отчёт', notificationTemplate: 'шаблон уведомления' };
  const keyMap = { team: 'teams', user: 'users', role: 'roles', project: 'projects', bc: 'businessCustomers', report: 'reports', notificationTemplate: 'notificationTemplates' };
  const target = (adminData[keyMap[type]] || []).find(item => item.id === id);
  let impact = null;
  if (!['report', 'notificationTemplate'].includes(type)) {
    try {
      impact = await app.api.get(`/admin/deletion-impact/${type}/${id}`);
    } catch (error) {
      toast('Не удалось проверить связанные данные. Операция отменена.', 'error');
      return;
    }
  }
  const displayName = impact?.name || target?.name || '';
  const message = type === 'user'
    ? `Деактивировать пользователя «${displayName}»${target?.email ? ` (${target.email})` : ''}?`
    : `Удалить ${typeLabel[type]} «${displayName}»?`;
  const dependencies = (impact?.dependencies || []).filter(item => item.count > 0);
  const dependencyRows = dependencies.length
    ? dependencies.map(item => `<li class="${item.blocking ? 'is-blocking' : ''}"><span>${escapeHtml(item.label)}</span><strong>${item.count}</strong></li>`).join('')
    : '<li><span>Связанные данные не найдены</span><strong>0</strong></li>';
  const blocked = impact && !impact.can_proceed;
  const details = impact ? `
    <div class="admin-impact-summary ${blocked ? 'is-blocked' : 'is-clear'}">
      <div class="admin-impact-status">${blocked ? escapeHtml(impact.blocked_reason || 'Операция недоступна') : (type === 'user' ? 'Связи сохранятся после деактивации' : 'Удаление доступно')}</div>
      <ul>${dependencyRows}</ul>
      ${(impact.recommendations || []).map(text => `<p>${escapeHtml(text)}</p>`).join('')}
    </div>` : '';
  showConfirmModal(message, async () => {
    const endpointMap = {
      team: '/admin/teams',
      user: '/admin/users',
      role: '/admin/roles',
      project: '/admin/projects',
      bc: '/admin/business-customers',
      report: '/reports/',
      notificationTemplate: '/admin/notification-templates',
    };
    const endpoint = endpointMap[type];
    if (!endpoint) return;

    try {
      await app.api.delete(`${endpoint.replace(/\/$/, '')}/${id}`);
      toast(type === 'user' ? 'Пользователь деактивирован' : 'Удалено', 'success');
      await initAdmin(app);
    } catch (e) {
      toast('Ошибка: ' + (e.message || 'Неизвестная ошибка'), 'error');
    }
  }, { details, canConfirm: !blocked, confirmText: type === 'user' ? 'Деактивировать' : 'Удалить' });
}

async function releaseDictLockIfHeld(app) {
  if (!currentDictLockType) return;
  try {
    await releaseDictionaryLock(app, currentDictLockType);
  } catch (e) { /* ignore */ }
  currentDictLockType = null;
  currentDictVersion = 0;
}

async function openDictModal(dictKey, app, { fromHistory = false } = {}) {
  const config = DICTIONARY_CONFIG[dictKey];
  if (!config) return;
  const dictType = config.type;

  try {
    const acquired = await acquireDictionaryLock(app, dictKey);
    currentDictLockType = acquired.type;
    currentDictVersion = acquired.version;
  } catch (e) {
    if (e.status === 423) {
      const lock = dictLocks[dictType];
      toast(`Справочник заблокирован: ${lock ? (lock.lock_owner_name || 'Администратор') : 'другой администратор'}`, 'error');
      return;
    }
    toast('Ошибка при открытии справочника', 'error');
    return;
  }

  let workspaceItems = null;
  if (dictKey !== 'competencyCosts') {
    try {
      const workspace = await app.api.get(`/admin/dictionaries/${dictType}/workspace`);
      workspaceItems = workspace.items || [];
    } catch (e) {
      await releaseDictLockIfHeld(app);
      toast('Не удалось загрузить рабочее представление справочника', 'error');
      return;
    }
  }

  adminModal = {
    show: true,
    mode: 'view',
    type: 'dict',
    data: {
      dictKey,
      dictLabel: config.label,
      dictType: dictKey,
      items: dictKey === 'competencyCosts'
        ? (adminData.competencyCosts || []).map(i => ({ id: i.id, competency: i.competency, year: i.year, rate: i.rate }))
        : workspaceItems.map(i => ({ id: i.id, name: i.name, code: i.code, color: i.color, sort_order: i.sort_order, is_active: i.is_active, usage_count: i.usage_count })),
      viewSearch: dictionaryViewState[dictKey]?.search || '',
      archiveOpen: dictionaryViewState[dictKey]?.archiveOpen || false,
    },
  };
  adminDictHistoryPushed = !fromHistory;
  if (!fromHistory) updateAdminUrl('push', { admin_dict: dictKey, admin_dict_q: dictionaryViewState[dictKey]?.search || '' });
  refreshModal();
}

function refreshModal() {
  const root = document.getElementById('admin-modal-root');
  if (root) {
    root.innerHTML = renderModal();
    if (window.lucide) lucide.createIcons();
    enhanceAdminAccessibility(root);
    activateAdminModalFocus();
    updateReportPreview();
    prepareAdminFormValidation(adminModal.type);
    enhanceRoleFormWorkspace();
    adminFormInitialSnapshot = adminFormSnapshot();
    adminFormSaving = false;
    const dictSearch = document.getElementById('dict-search');
    if (dictSearch?.value) dictSearch.dispatchEvent(new Event('input', { bubbles: true }));
    const archive = document.getElementById('dict-archive');
    archive?.addEventListener('toggle', () => {
      const dictKey = adminModal.data?.dictKey;
      if (dictKey) dictionaryViewState[dictKey] = { ...(dictionaryViewState[dictKey] || {}), archiveOpen: archive.open };
    });
    if (adminModal.type === 'dict' && adminModal.data?.dictKey !== 'competencyCosts') { updateDictionaryEditorState(); validateDictionaryEditor(); }
  }
}

function renderProjectForm(data) {
  const projectStatuses = adminData.projectStatuses || [];
  const users = adminData.users || [];
  const statusOpts = projectStatuses.map(s => `<option value="${s.id}"${data.status_id == s.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`).join('');
  const plOpts = users.map(u => `<option value="${u.id}"${data.responsible_pl == u.id ? ' selected' : ''}>${escapeHtml(u.name)}</option>`).join('');
  const isEdit = adminModal.mode === 'edit';
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group">
        <label class="form-label">ID</label>
        <input class="input modal-field" value="${data.id || '—'}" readonly style="color:var(--text-muted)">
      </div>
      <div class="form-group">
        <label class="form-label">Дата создания</label>
        <input class="input modal-field" value="${data.created_at ? data.created_at.slice(0, 10) : '—'}" readonly style="color:var(--text-muted)">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Код проекта <span class="required">*</span></label>
      <input class="input modal-field" id="project-code" value="${escapeHtml(data.code || '')}" placeholder="Код проекта" ${isEdit ? 'readonly' : ''}>
    </div>
    <div class="form-group">
      <label class="form-label">Название <span class="required">*</span></label>
      <input class="input modal-field" id="project-name" value="${escapeHtml(data.name || '')}" placeholder="Название проекта">
    </div>
    <div class="form-group">
      <label class="form-label">Описание</label>
      <textarea class="input modal-field" id="project-description" placeholder="Описание проекта" style="min-height:60px">${escapeHtml(data.description || '')}</textarea>
    </div>
    <div class="form-group">
      <label class="form-label">Статус</label>
      <select class="input modal-field" id="project-status"><option value="">—</option>${statusOpts}</select>
    </div>
    <div class="form-group">
      <label class="form-label">Ответственный PL</label>
      <select class="input modal-field" id="project-pl"><option value="">—</option>${plOpts}</select>
    </div>
  `;
}

function getProjectPayload() {
  return {
    code: getFieldVal('project-code'),
    name: getFieldVal('project-name'),
    description: getFieldVal('project-description') || null,
    status_id: parseInt(getFieldVal('project-status')) || null,
    responsible_pl: parseInt(getFieldVal('project-pl')) || null,
  };
}

// ==================== BIND EVENTS ====================

function setReportWizardStep(wizard, step) {
  if (!wizard) return;
  if (wizard.dataset.scriptManaged === 'true') step = 1;
  wizard.dataset.step = String(step);
  wizard.querySelectorAll('.report-step').forEach(button => button.classList.toggle('active', Number(button.dataset.reportStep) === step));
  wizard.querySelectorAll('.report-step-panel').forEach(panel => {
    const active = Number(panel.dataset.reportPanel) === step;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
  const prev = wizard.querySelector('#report-step-prev');
  const next = wizard.querySelector('#report-step-next');
  if (prev) prev.disabled = step === 1;
  if (next) { next.hidden = step === 4; next.textContent = step === 3 ? 'К сортировке' : 'Далее'; }
  updateReportPreview();
}

function syncReportSelectedFields() {
  const container = document.getElementById('report-selected-fields');
  if (!container) return;
  const definitions = new Map(getReportFields().map(field => [field.key, field]));
  const checked = new Set(Array.from(document.querySelectorAll('.report-field-cb:checked')).map(box => box.value));
  const current = Array.from(container.querySelectorAll('.report-selected-field')).map(row => row.dataset.field).filter(key => checked.has(key));
  document.querySelectorAll('.report-field-cb:checked').forEach(box => { if (!current.includes(box.value)) current.push(box.value); });
  container.innerHTML = '';
  current.forEach(key => {
    const row = document.createElement('div');
    row.className = 'report-selected-field'; row.dataset.field = key;
    const label = document.createElement('span'); label.textContent = definitions.get(key)?.label || `Неизвестное поле: ${key}`;
    const drag = document.createElement('span'); drag.className = 'report-selected-drag'; drag.textContent = '⋮⋮';
    const actions = document.createElement('span'); actions.className = 'report-selected-actions';
    actions.innerHTML = '<button type="button" class="report-field-up" aria-label="Переместить вверх">↑</button><button type="button" class="report-field-down" aria-label="Переместить вниз">↓</button>';
    row.append(drag, label, actions); container.appendChild(row);
  });
  if (!current.length) container.innerHTML = '<p class="text-muted report-no-fields">Поля не выбраны</p>';
  updateReportPreview();
}

function updateReportPreview() {
  const target = document.getElementById('report-preview-summary');
  if (!target) return;
  const name = document.getElementById('report-name')?.value.trim() || 'Без названия';
  const fieldCount = document.querySelectorAll('.report-selected-field').length;
  const filterCount = document.querySelectorAll('.report-filter-row').length;
  const group = document.getElementById('report-group-by')?.selectedOptions?.[0]?.textContent || 'Без группировки';
  target.textContent = `${name} · ${fieldCount} полей · ${filterCount} фильтров · ${group}`;
}

function bindAdminEvents(app) {
  const page = document.getElementById('page-content');
  if (!page) return;
  normalizeAdminTables();
  enhanceAdminAccessibility(page);

  page.removeEventListener('click', window._adminClick);
  page.removeEventListener('click', window._adminDictClick);
  window._adminClick = (e) => handleAdminClick(e, app);
  window._adminDictClick = (e) => handleDictEvents(e, app);
  page.addEventListener('click', window._adminClick);
  page.addEventListener('click', window._adminDictClick);

  page.removeEventListener('input', window._adminDelegatedInput);
  window._adminDelegatedInput = (event) => {
    if (event.target.closest('.role-form-workspace')) updateRoleFormSummary();
    clearAdminFieldError(event.target);
    if (event.target.id === 'dict-search') {
      const query = event.target.value.trim().toLocaleLowerCase();
      const dictKey = adminModal.data?.dictKey;
      if (dictKey) dictionaryViewState[dictKey] = { ...(dictionaryViewState[dictKey] || {}), search: event.target.value };
      if (dictKey) updateAdminUrl('replace', { admin_dict: dictKey, admin_dict_q: event.target.value });
      document.querySelectorAll('.dict-editor-row').forEach(row => {
        const text = `${row.querySelector('.dict-value-input')?.value || ''} ${row.querySelector('.dict-code-input')?.value || ''}`.toLocaleLowerCase();
        row.hidden = Boolean(query && !text.includes(query));
      });
    } else if (event.target.id === 'audit-search') {
      auditState.search = event.target.value; auditState.page = 1;
      updateAdminUrl('replace');
      clearTimeout(window._auditSearchTimer);
      window._auditSearchTimer = setTimeout(() => refreshAuditTab(app, true), 300);
    } else if (event.target.classList.contains('admin-list-search-input')) {
      const tab = event.target.dataset.listTab;
      adminListState[tab].search = event.target.value;
      adminListState[tab].page = 1;
      updateAdminUrl('replace');
      clearTimeout(window._adminListSearchTimer);
      window._adminListSearchTimer = setTimeout(() => {
        document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
        pullStickyBars(); bindAdminEvents(app);
        restoreAdminSearchFocus(`.admin-list-search-input[data-list-tab="${tab}"]`);
        if (window.lucide) lucide.createIcons();
      }, 180);
    } else if (event.target.classList.contains('dict-value-input')) { window.autoFillDictRow(event.target); window.markDictEdited(event.target); validateDictionaryEditor(); }
    else if (event.target.matches('.dict-code-input')) { window.markDictEdited(event.target); validateDictionaryEditor(); }
    else if (event.target.matches('.comp-cost-input')) window.markDictEdited(event.target);
    else if (event.target.id === 'modal-name' && adminModal.type === 'user') window.updateUserAvatarPreview(event.target.value);
    else if (event.target.id === 'report-field-search') {
      const query = event.target.value.trim().toLowerCase();
      document.querySelectorAll('.report-field-option').forEach(option => { option.hidden = !option.dataset.search.includes(query); });
    } else if (event.target.closest('.report-wizard')) updateReportPreview();
    else if (event.target.closest('.notification-template-form')) updateNotificationTemplatePreview();
  };
  page.addEventListener('input', window._adminDelegatedInput);

  page.removeEventListener('change', window._adminDelegatedChange);
  window._adminDelegatedChange = (event) => {
    if (event.target.closest('.role-form-workspace')) updateRoleFormSummary();
    if (event.target.classList.contains('role-compare-select')) {
      roleCompare[event.target.id === 'role-compare-left' ? 'left' : 'right'] = event.target.value;
      document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
      pullStickyBars(); bindAdminEvents(app);
      if (window.lucide) lucide.createIcons();
      return;
    }
    if (event.target.classList.contains('audit-filter')) {
      const stateKeys = { 'audit-action': 'action', 'audit-entity': 'entityType', 'audit-user': 'userId', 'audit-date-from': 'dateFrom', 'audit-date-to': 'dateTo' };
      auditState[stateKeys[event.target.id]] = event.target.value; auditState.page = 1;
      updateAdminUrl('push'); refreshAuditTab(app);
      return;
    }
    if (event.target.classList.contains('admin-list-filter')) {
      const tab = event.target.dataset.listTab;
      adminListState[tab].filter = event.target.value;
      adminListState[tab].page = 1;
      updateAdminUrl('push'); document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
      pullStickyBars(); bindAdminEvents(app);
      if (window.lucide) lucide.createIcons();
      return;
    }
    if (['admin-filter-role', 'admin-filter-team', 'admin-filter-status'].includes(event.target.id)) {
      window._adminFilterChange(event.target);
    }
    if (event.target.classList.contains('report-field-cb')) syncReportSelectedFields();
    if (event.target.classList.contains('report-filter-field')) updateReportFilterRow(event.target.closest('.report-filter-row'));
    if (event.target.closest('.report-wizard')) updateReportPreview();
    if (event.target.closest('.notification-template-form')) updateNotificationTemplatePreview();
  };
  page.addEventListener('change', window._adminDelegatedChange);

  page.removeEventListener('keydown', window._adminDelegatedKeydown);
  window._adminDelegatedKeydown = event => {
    if (event.target.classList.contains('admin-tab') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      const tabs = Array.from(document.querySelectorAll('.admin-tab:not([disabled])')); const current = tabs.indexOf(event.target); let index = current;
      if (event.key === 'Home') index = 0; else if (event.key === 'End') index = tabs.length - 1; else index = (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault(); tabs[index]?.focus(); tabs[index]?.click(); return;
    }
    if (event.target.classList.contains('dict-drag-handle') && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
      const row = event.target.closest('.dict-editor-row'); const sibling = event.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling;
      if (sibling?.classList.contains('dict-editor-row')) {
        event.preventDefault();
        if (event.key === 'ArrowUp') row.parentElement.insertBefore(row, sibling); else row.parentElement.insertBefore(sibling, row);
        row.classList.add('is-dirty'); updateDictionaryEditorState(); validateDictionaryEditor(); event.target.focus();
      }
      return;
    }
    if (event.target.id !== 'cc-inline-value') return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      confirmCompetencyInlineEditor();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeCompetencyInlineEditor();
    }
  };
  page.addEventListener('keydown', window._adminDelegatedKeydown);

  page.removeEventListener('dragstart', window._adminDictDragStart);
  page.removeEventListener('dragover', window._adminDictDragOver);
  page.removeEventListener('drop', window._adminDictDrop);
  page.removeEventListener('dragend', window._adminDictDragEnd);
  window._adminDictDragStart = event => {
    const row = event.target.closest?.('#dict-items-container .dict-editor-row');
    if (!row) return; window._draggedDictRow = row; row.classList.add('is-dragging'); event.dataTransfer.effectAllowed = 'move';
  };
  window._adminDictDragOver = event => { if (event.target.closest?.('#dict-items-container .dict-editor-row')) event.preventDefault(); };
  window._adminDictDrop = event => {
    const targetRow = event.target.closest?.('#dict-items-container .dict-editor-row'); const dragged = window._draggedDictRow;
    if (!targetRow || !dragged || targetRow === dragged) return;
    event.preventDefault(); const rect = targetRow.getBoundingClientRect(); targetRow.parentElement.insertBefore(dragged, event.clientY < rect.top + rect.height / 2 ? targetRow : targetRow.nextSibling);
    dragged.classList.remove('is-dragging'); dragged.classList.add('is-dirty'); window._draggedDictRow = null; updateDictionaryEditorState();
  };
  window._adminDictDragEnd = () => { window._draggedDictRow?.classList.remove('is-dragging'); window._draggedDictRow = null; };
  page.addEventListener('dragstart', window._adminDictDragStart); page.addEventListener('dragover', window._adminDictDragOver); page.addEventListener('drop', window._adminDictDrop); page.addEventListener('dragend', window._adminDictDragEnd);

  // Column filters
  window._adminFilterChange = (sel) => {
    if (sel.id === 'admin-filter-role') userFilters.role = sel.value;
    else if (sel.id === 'admin-filter-team') userFilters.team = sel.value;
    else if (sel.id === 'admin-filter-status') userFilters.status = sel.value;
    adminListState.users.page = 1;
    updateAdminUrl('push');
    document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
    pullStickyBars();
    if (window.lucide) lucide.createIcons();
    bindAdminEvents(app);
  };

  // Search input with debounce
  const searchEl = document.getElementById('admin-user-search');
  if (searchEl) {
    searchEl.removeEventListener('input', window._adminSearch);
    window._adminSearch = (e) => {
      userSearch = e.target.value;
      adminListState.users.page = 1;
      updateAdminUrl('replace');
      clearTimeout(window._searchTimer);
      window._searchTimer = setTimeout(() => {
        document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
        pullStickyBars();
        if (window.lucide) lucide.createIcons();
        bindAdminEvents(app);
        restoreAdminSearchFocus('#admin-user-search');
      }, 300);
    };
    searchEl.addEventListener('input', window._adminSearch);
  }

  // Clear search button
  const clearBtn = document.getElementById('admin-user-search-clear');
  if (clearBtn) {
    clearBtn.removeEventListener('click', window._adminClearSearch);
    window._adminClearSearch = () => {
      userSearch = '';
      adminListState.users.page = 1;
      updateAdminUrl('push');
      document.getElementById('admin-content').innerHTML = renderTabContent(adminTab, app);
      pullStickyBars();
      if (window.lucide) lucide.createIcons();
      bindAdminEvents(app);
    };
    clearBtn.addEventListener('click', window._adminClearSearch);
  }

  const tabBar = document.getElementById('admin-tab-bar');
  if (tabBar) {
    tabBar.removeEventListener('click', window._adminTabClick);
    window._adminTabClick = (e) => handleAdminTabClick(e, app);
    tabBar.addEventListener('click', window._adminTabClick);
  }

  const mobileTabSelect = document.getElementById('admin-tab-mobile-select');
  if (mobileTabSelect) {
    mobileTabSelect.removeEventListener('change', window._adminMobileTabChange);
    window._adminMobileTabChange = event => {
      const tabButton = document.querySelector(`.admin-tab[data-tab="${event.target.value}"]`);
      if (tabButton) handleAdminTabClick({ target: tabButton }, app);
    };
    mobileTabSelect.addEventListener('change', window._adminMobileTabChange);
  }

  if (adminTab === 'display') {
    bindDisplayEvents(app);
  }

  if (adminTab === 'home') {
    bindHomeTabEvents(app);
  }

  updateNotificationTemplatePreview();

  const sortByEl = document.getElementById('report-sort-by');
  if (sortByEl) {
    sortByEl.addEventListener('change', function() {
      const sortGroup = document.getElementById('report-sort-order-group');
      if (sortGroup) sortGroup.style.display = this.value ? '' : 'none';
    });
  }
}

// ==================== INIT ====================

function asItems(value) {
  return Array.isArray(value) ? value : (value?.items || []);
}

async function loadAdminTab(app, tab, force = false) {
  if (!force && adminLoadState[tab]?.status === 'success') return;
  adminLoadState[tab] = { status: 'loading' };
  const loaders = {
    teams: async () => { adminData.teams = asItems(await app.api.get('/admin/teams')); },
    projects: async () => {
      const [projects, statuses, users] = await Promise.all([
        app.api.get('/admin/projects'), app.api.get('/admin/project-statuses'), app.api.get('/admin/users'),
      ]);
      adminData.projects = asItems(projects); adminData.projectStatuses = asItems(statuses); adminData.users = asItems(users);
    },
    businessCustomers: async () => {
      const [customers, departments] = await Promise.all([app.api.get('/admin/business-customers'), app.api.get('/admin/departments')]);
      adminData.businessCustomers = asItems(customers); adminData.departments = asItems(departments);
    },
    users: async () => {
      const [users, roles, teams, customers] = await Promise.all([
        app.api.get('/admin/users'), app.api.get('/admin/roles'), app.api.get('/admin/teams'), app.api.get('/admin/business-customers'),
      ]);
      adminData.users = asItems(users); adminData.roles = asItems(roles); adminData.teams = asItems(teams); adminData.businessCustomers = asItems(customers);
    },
    roles: async () => { adminData.roles = asItems(await app.api.get('/admin/roles')); },
    home: async () => {},
    dictionaries: async () => {
      const values = await Promise.all([
        app.api.get('/admin/priorities'), app.api.get('/admin/statuses'), app.api.get('/admin/task-types'),
        app.api.get('/admin/channels'), app.api.get('/admin/deadlines'), app.api.get('/admin/departments'),
        app.api.get('/admin/team-types'), app.api.get('/admin/project-statuses'), app.api.get('/admin/competency-costs'),
        app.api.get('/admin/dict-locks'), app.api.get('/admin/tags'),
      ]);
      [adminData.priorities, adminData.statuses, adminData.taskTypes, adminData.channels,
        adminData.deadlines, adminData.departments, adminData.teamTypes, adminData.projectStatuses,
        adminData.competencyCosts] = values.slice(0, 9).map(asItems);
      dictLocks = values[9] || {}; adminData.tags = asItems(values[10]);
    },
    display: async () => {
      const [settings, labels] = await Promise.all([app.api.get('/admin/display-settings'), app.api.get('/admin/column-labels')]);
      displaySettingsData = {};
      asItems(settings).forEach(ds => { displaySettingsData[ds.page] = ds.settings; });
      columnLabelsData = labels || {};
    },
    reports: async () => { adminData.reports = asItems(await app.api.get('/reports/')); },
    notifications: async () => {
      const [templates, roles] = await Promise.all([app.api.get('/admin/notification-templates'), app.api.get('/admin/roles')]);
      adminData.notificationTemplates = asItems(templates); adminData.notificationRoles = asItems(roles);
    },
    audit: async () => {
      if (getAdminAccess(app) !== 'full') throw Object.assign(new Error('Forbidden'), { status: 403 });
      const params = new URLSearchParams({ page: auditState.page, per_page: auditState.perPage });
      if (auditState.search) params.set('search', auditState.search);
      if (auditState.action) params.set('action', auditState.action);
      if (auditState.entityType) params.set('entity_type', auditState.entityType);
      if (auditState.userId) params.set('user_id', auditState.userId);
      if (auditState.dateFrom) params.set('date_from', auditState.dateFrom);
      if (auditState.dateTo) params.set('date_to', auditState.dateTo);
      const [log, filters] = await Promise.all([app.api.get(`/admin/audit-log?${params}`), app.api.get('/admin/audit-log/filters')]);
      adminData.auditLog = log; adminData.auditFilters = filters;
    },
  };
  try {
    await (loaders[tab] || (async () => {}))();
    adminLoadState[tab] = { status: 'success', loadedAt: Date.now() };
  } catch (error) {
    adminLoadState[tab] = { status: 'error', statusCode: error?.status || 0 };
  }
}

export async function initAdmin(app) {
  currentAdminUser = app.store.get('currentUser');
  await loadAdminTab(app, adminTab, true);
  const content = document.getElementById('admin-content');
  if (!content) return;
  content.innerHTML = renderTabContent(adminTab, app);
  pullStickyBars();
  if (window.lucide) lucide.createIcons();
  bindAdminEvents(app);
  window.removeEventListener('popstate', window._adminPopState);
  window._adminPopState = () => applyAdminHistoryState(app);
  window.addEventListener('popstate', window._adminPopState);
  if (adminTab === 'home' && adminLoadState.home?.status === 'success') await loadTimelineAdminEvents(app);
  const desired = hydrateAdminUrlState();
  if (desired.dictKey && adminTab === 'dictionaries' && DICTIONARY_CONFIG[desired.dictKey] && !adminModal.show) await openDictModal(desired.dictKey, app, { fromHistory: true });
}
