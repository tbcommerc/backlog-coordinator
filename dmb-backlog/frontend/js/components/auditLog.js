import { escapeHtml } from '../htmlUtils.js';
import { formatErrorMessage, showToast } from '../uiFeedback.js';
import { renderViewState } from './viewState.js';

const EMPTY_FILTERS = { user_id: '', action: '', entity_type: '', date_from: '', date_to: '' };
const ACTION_LABELS = { create: 'Создание', update: 'Изменение', delete: 'Удаление' };
const ENTITY_LABELS = {
  tasks: 'Задача', teams: 'Команда', users: 'Пользователь', roles: 'Роль', projects: 'Проект',
  statuses: 'Статус', priorities: 'Приоритет', channels: 'Канал', deadlines: 'Срок',
  departments: 'Подразделение', 'task-types': 'Тип задачи', 'team-types': 'Тип команды',
  'project-statuses': 'Статус проекта', 'business-customers': 'Бизнес-заказчик',
  'notification-templates': 'Шаблон уведомления', 'column-labels': 'Название колонки',
  'display-settings': 'Настройки отображения',
};

let auditState = { page: 1, perPage: 50, search: '', filters: { ...EMPTY_FILTERS } };
let auditData = { items: [], total: 0, pages: 0 };
let auditFilters = { actions: [], entity_types: [], users: [] };
let auditView = { status: 'loading', error: null, filtersUnavailable: false };
let auditMobileFiltersOpen = false;

function formatDateTime(iso) {
  if (!iso) return { date: '—', time: '' };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { date: '—', time: '' };
  return {
    date: date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

function parseDetails(details) {
  if (!details) return {};
  try { return typeof details === 'string' ? JSON.parse(details) : details; } catch (_) { return { raw: String(details) }; }
}

function detailSummary(details) {
  const value = parseDetails(details);
  if (value.path) return { primary: `${value.method || ''} ${value.path}`.trim(), secondary: value.status_code ? `HTTP ${value.status_code}` : '' };
  const changed = Object.keys(value.changes || value.fields || value.changed_fields || {});
  if (changed.length) return { primary: changed.join(', '), secondary: `${changed.length} ${changed.length === 1 ? 'поле' : 'полей'}` };
  if (value.raw) return { primary: value.raw, secondary: '' };
  const keys = Object.keys(value).filter(key => !['request_id', 'trace_id'].includes(key));
  return { primary: keys.length ? keys.join(', ') : 'Без дополнительных данных', secondary: '' };
}

function resultMeta(details) {
  const status = Number(parseDetails(details).status_code);
  if (status >= 400) return { label: 'Ошибка', tone: 'danger', icon: 'circle-x' };
  if (status > 0) return { label: 'Успешно', tone: 'success', icon: 'circle-check' };
  return { label: 'Зафиксировано', tone: 'neutral', icon: 'check' };
}

function actionBadge(action) {
  const key = String(action || '').toLowerCase();
  return `<span class="audit-action-badge audit-action-${escapeHtml(key)}">${escapeHtml(ACTION_LABELS[key] || action || '—')}</span>`;
}

function entityBadge(type, id) {
  return `<span class="audit-entity-badge">${escapeHtml(ENTITY_LABELS[type] || type || '—')}</span>${id ? `<span class="audit-entity-id">#${escapeHtml(id)}</span>` : ''}`;
}

function buildParams() {
  const params = new URLSearchParams({ page: auditState.page, per_page: auditState.perPage });
  if (auditState.search) params.set('search', auditState.search);
  Object.entries(auditState.filters).forEach(([key, value]) => { if (value) params.set(key, value); });
  return params;
}

async function loadAuditData(app) {
  auditView.status = 'loading';
  auditView.error = null;
  refreshAuditView();
  try {
    auditData = await app.api.get(`/admin/audit-log?${buildParams()}`);
    auditView.status = 'ready';
  } catch (error) {
    auditView.status = 'error';
    auditView.error = error;
  }
}

async function loadAuditFilters(app) {
  try {
    auditFilters = await app.api.get('/admin/audit-log/filters');
    auditView.filtersUnavailable = false;
  } catch (_) {
    auditFilters = { actions: [], entity_types: [], users: [] };
    auditView.filtersUnavailable = true;
  }
}

function renderTableState(kind, title, message = '', actionLabel = '') {
  return `<tr><td colspan="8" class="audit-table-state"><div class="audit-table-state-content">${renderViewState({ kind, title, message, actionLabel })}</div></td></tr>`;
}

function renderAuditRows() {
  if (auditView.status === 'loading') return renderTableState('loading', 'Загрузка журнала…');
  if (auditView.status === 'error') return renderTableState('error', 'Не удалось загрузить журнал', formatErrorMessage(auditView.error), 'Повторить');
  const items = auditData.items || [];
  if (!items.length) {
    const filtered = activeFilterEntries().length > 0;
    return renderTableState('empty', filtered ? 'По заданным условиям ничего не найдено' : 'В журнале пока нет событий', filtered ? 'Измените параметры или сбросьте фильтры.' : 'Новые системные изменения появятся здесь автоматически.', filtered ? 'Сбросить фильтры' : '');
  }
  return items.map(item => {
    const datetime = formatDateTime(item.created_at);
    const details = detailSummary(item.details);
    const result = resultMeta(item.details);
    const requestId = item.trace_id || item.request_id || '';
    return `<tr>
      <td class="audit-date-cell"><time datetime="${escapeHtml(item.created_at || '')}"><strong>${datetime.date}</strong><span>${datetime.time}</span></time></td>
      <td><span class="audit-user">${escapeHtml(item.user_name || 'Система')}</span>${item.user_name ? '' : '<span class="audit-cell-caption">Автоматическое событие</span>'}</td>
      <td><span class="audit-result audit-result-${result.tone}"><i data-lucide="${result.icon}" aria-hidden="true"></i>${result.label}</span></td>
      <td>${actionBadge(item.action)}</td>
      <td><div class="audit-entity-cell">${entityBadge(item.entity_type, item.entity_id)}</div></td>
      <td><div class="audit-details" title="${escapeHtml(details.primary)}"><span>${escapeHtml(details.primary)}</span>${details.secondary ? `<small>${escapeHtml(details.secondary)}</small>` : ''}</div></td>
      <td><div class="audit-request-cell"><code title="${escapeHtml(requestId)}">${escapeHtml(requestId || '—')}</code>${requestId ? `<button type="button" class="audit-copy-btn" data-copy-request="${escapeHtml(requestId)}" aria-label="Скопировать Request ID" title="Скопировать Request ID"><i data-lucide="copy" aria-hidden="true"></i></button>` : ''}</div></td>
      <td><code class="audit-ip">${escapeHtml(item.ip_address || '—')}</code></td>
    </tr>`;
  }).join('');
}

function activeFilterEntries() {
  const user = auditFilters.users.find(item => String(item.id) === String(auditState.filters.user_id));
  return [
    auditState.search && ['search', `Поиск: ${auditState.search}`],
    auditState.filters.user_id && ['user_id', `Пользователь: ${user?.name || auditState.filters.user_id}`],
    auditState.filters.action && ['action', `Действие: ${ACTION_LABELS[auditState.filters.action] || auditState.filters.action}`],
    auditState.filters.entity_type && ['entity_type', `Сущность: ${ENTITY_LABELS[auditState.filters.entity_type] || auditState.filters.entity_type}`],
    auditState.filters.date_from && ['date_from', `С ${auditState.filters.date_from.split('-').reverse().join('.')}`],
    auditState.filters.date_to && ['date_to', `По ${auditState.filters.date_to.split('-').reverse().join('.')}`],
  ].filter(Boolean);
}

function renderActiveFilters() {
  const entries = activeFilterEntries();
  if (!entries.length) return '<span class="audit-filter-summary">Фильтры не выбраны</span>';
  return `<span class="audit-filter-summary">Активные фильтры:</span>${entries.map(([key, label]) => `<button type="button" class="audit-filter-chip" data-remove-filter="${key}">${escapeHtml(label)}<i data-lucide="x" aria-hidden="true"></i></button>`).join('')}<button type="button" class="btn btn-ghost btn-sm audit-clear-all" data-reset-audit>Сбросить все</button>`;
}

function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${String(value) === String(selected) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function renderFilterBar() {
  const filters = auditState.filters;
  return `<section class="audit-filter-panel${auditMobileFiltersOpen ? ' is-open' : ''}" aria-labelledby="audit-filter-title">
    <div class="audit-filter-heading"><div><h2 id="audit-filter-title">Фильтры журнала</h2><p>Уточните период, автора или тип изменения.</p></div><div class="audit-filter-heading-actions"><button type="button" class="btn btn-secondary btn-sm audit-filter-toggle" data-toggle-audit-filters aria-expanded="${auditMobileFiltersOpen}" aria-controls="audit-filter-form"><i data-lucide="sliders-horizontal" aria-hidden="true"></i><span>${auditMobileFiltersOpen ? 'Скрыть' : 'Настроить'}</span></button><button type="button" class="btn btn-ghost btn-sm" data-reset-audit ${activeFilterEntries().length ? '' : 'disabled'}><i data-lucide="rotate-ccw" aria-hidden="true"></i>Сбросить</button></div></div>
    <form id="audit-filter-form" class="audit-filter-grid">
      <label class="audit-search-field"><span>Поиск</span><div class="audit-input-with-icon"><i data-lucide="search" aria-hidden="true"></i><input id="audit-filter-search" class="input" type="search" maxlength="100" value="${escapeHtml(auditState.search)}" placeholder="Действие, сущность, Request ID или IP"></div></label>
      <label><span>Пользователь</span><select id="audit-filter-user" class="input"><option value="">Все пользователи</option>${auditFilters.users.map(user => option(user.id, user.name, filters.user_id)).join('')}</select></label>
      <label><span>Действие</span><select id="audit-filter-action" class="input"><option value="">Все действия</option>${auditFilters.actions.map(action => option(action, ACTION_LABELS[action] || action, filters.action)).join('')}</select></label>
      <label><span>Сущность</span><select id="audit-filter-entity" class="input"><option value="">Все сущности</option>${auditFilters.entity_types.map(entity => option(entity, ENTITY_LABELS[entity] || entity, filters.entity_type)).join('')}</select></label>
      <fieldset class="audit-period-field"><legend>Период</legend><div><label><span class="sr-only">Дата с</span><input type="date" id="audit-filter-date-from" class="input" value="${escapeHtml(filters.date_from)}" aria-label="Дата с"></label><span aria-hidden="true">—</span><label><span class="sr-only">Дата по</span><input type="date" id="audit-filter-date-to" class="input" value="${escapeHtml(filters.date_to)}" aria-label="Дата по"></label></div><span class="audit-filter-error" id="audit-date-error" role="alert"></span></fieldset>
      <button type="submit" class="btn btn-primary audit-apply-btn"><i data-lucide="list-filter" aria-hidden="true"></i>Применить</button>
    </form>
    ${auditView.filtersUnavailable ? '<p class="audit-filter-notice"><i data-lucide="info" aria-hidden="true"></i>Списки фильтров временно недоступны. Поиск и период продолжают работать.</p>' : ''}
    <div class="audit-active-filters" id="audit-active-filters">${renderActiveFilters()}</div>
  </section>`;
}

function renderPagination() {
  const total = Number(auditData.total) || 0;
  const pages = Math.max(1, Number(auditData.pages) || 1);
  const page = Math.min(auditState.page, pages);
  const start = total ? (page - 1) * auditState.perPage + 1 : 0;
  const end = Math.min(page * auditState.perPage, total);
  return `<div class="audit-table-footer"><div class="audit-page-size"><label for="audit-per-page">Строк на странице</label><select id="audit-per-page" class="input">${[25, 50, 100, 200].map(size => option(size, size, auditState.perPage)).join('')}</select></div><span class="audit-range" aria-live="polite">${start}–${end} из ${total}</span><nav class="audit-pagination" aria-label="Страницы журнала"><button type="button" class="btn btn-ghost btn-sm audit-page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}><i data-lucide="chevron-left" aria-hidden="true"></i>Назад</button><span>Страница <strong>${page}</strong> из ${pages}</span><button type="button" class="btn btn-ghost btn-sm audit-page-btn" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Далее<i data-lucide="chevron-right" aria-hidden="true"></i></button></nav></div>`;
}

export function renderAuditLog() {
  return `<section class="audit-page animate-fade-in" id="audit-page"><header class="page-header audit-page-header"><div><div class="audit-title-line"><h1>Аудит действий</h1><span class="audit-total-badge" id="audit-total-badge">${auditView.status === 'ready' ? `${Number(auditData.total) || 0} событий` : 'Загрузка'}</span></div><p>История изменений и системных операций для контроля и разбора инцидентов.</p></div><button type="button" class="btn btn-secondary audit-refresh-btn" data-refresh-audit><i data-lucide="refresh-cw" aria-hidden="true"></i>Обновить</button></header><div id="audit-filter-bar">${renderFilterBar()}</div><section class="audit-table-card" aria-labelledby="audit-table-title" aria-busy="${auditView.status === 'loading'}"><div class="audit-table-heading"><div><h2 id="audit-table-title">События</h2><p>Сначала показаны последние изменения.</p></div><span class="audit-table-hint"><i data-lucide="shield-check" aria-hidden="true"></i>Журнал доступен только администраторам</span></div><div class="audit-page-table-wrap table-container" tabindex="0" role="region" aria-label="Таблица событий аудита"><table class="audit-page-table"><caption class="sr-only">События аудита системы</caption><thead><tr><th scope="col">Дата и время</th><th scope="col">Пользователь</th><th scope="col">Результат</th><th scope="col">Действие</th><th scope="col">Сущность</th><th scope="col">Изменённые поля</th><th scope="col">Request ID</th><th scope="col">IP-адрес</th></tr></thead><tbody id="audit-table-body">${renderAuditRows()}</tbody></table></div><div id="audit-pagination">${renderPagination()}</div></section></section>`;
}

function collectFilters(root) {
  auditState.search = root.querySelector('#audit-filter-search')?.value.trim() || '';
  auditState.filters = { user_id: root.querySelector('#audit-filter-user')?.value || '', action: root.querySelector('#audit-filter-action')?.value || '', entity_type: root.querySelector('#audit-filter-entity')?.value || '', date_from: root.querySelector('#audit-filter-date-from')?.value || '', date_to: root.querySelector('#audit-filter-date-to')?.value || '' };
}

function validatePeriod(root) {
  const from = root.querySelector('#audit-filter-date-from')?.value || '';
  const to = root.querySelector('#audit-filter-date-to')?.value || '';
  const error = root.querySelector('#audit-date-error');
  if (from && to && from > to) { if (error) error.textContent = 'Дата начала не может быть позже даты окончания.'; root.querySelector('#audit-filter-date-from')?.focus(); return false; }
  if (error) error.textContent = '';
  return true;
}

function resetAuditFilters() { auditState = { ...auditState, page: 1, search: '', filters: { ...EMPTY_FILTERS } }; }
function removeFilter(key) { if (key === 'search') auditState.search = ''; else if (key in auditState.filters) auditState.filters[key] = ''; auditState.page = 1; }
async function reloadAudit(app) { await loadAuditData(app); refreshAuditView(); }

export async function initAuditLog(app) {
  const root = document.getElementById('audit-page');
  if (!root) return;
  root.addEventListener('submit', event => { if (event.target.id !== 'audit-filter-form') return; event.preventDefault(); if (!validatePeriod(root)) return; collectFilters(root); auditState.page = 1; reloadAudit(app); });
  root.addEventListener('change', event => { if (event.target.id !== 'audit-per-page') return; auditState.perPage = Number(event.target.value) || 50; auditState.page = 1; reloadAudit(app); });
  root.addEventListener('click', async event => {
    const filterToggle = event.target.closest('[data-toggle-audit-filters]');
    if (filterToggle) {
      auditMobileFiltersOpen = !auditMobileFiltersOpen;
      root.querySelector('.audit-filter-panel')?.classList.toggle('is-open', auditMobileFiltersOpen);
      filterToggle.setAttribute('aria-expanded', String(auditMobileFiltersOpen));
      filterToggle.querySelector('span').textContent = auditMobileFiltersOpen ? 'Скрыть' : 'Настроить';
      return;
    }
    const pageButton = event.target.closest('.audit-page-btn');
    if (pageButton?.dataset.page) { auditState.page = Number(pageButton.dataset.page) || 1; await reloadAudit(app); root.querySelector('.audit-page-table-wrap')?.focus({ preventScroll: true }); return; }
    if (event.target.closest('[data-refresh-audit]')) { await reloadAudit(app); return; }
    const removeButton = event.target.closest('[data-remove-filter]');
    if (removeButton) { removeFilter(removeButton.dataset.removeFilter); await reloadAudit(app); return; }
    if (event.target.closest('[data-reset-audit]') || event.target.closest('[data-view-state-action]') && auditView.status !== 'error') { resetAuditFilters(); await reloadAudit(app); return; }
    if (event.target.closest('[data-view-state-action]') && auditView.status === 'error') { await reloadAudit(app); return; }
    const copyButton = event.target.closest('[data-copy-request]');
    if (copyButton) { try { await navigator.clipboard.writeText(copyButton.dataset.copyRequest); showToast('Request ID скопирован', 'success'); } catch (_) { showToast('Не удалось скопировать Request ID', 'error'); } }
  });
  await Promise.all([loadAuditData(app), loadAuditFilters(app)]);
  refreshAuditView();
}

function refreshAuditView() {
  const root = document.getElementById('audit-page');
  if (!root) return;
  const filterBar = root.querySelector('#audit-filter-bar');
  const body = root.querySelector('#audit-table-body');
  const pagination = root.querySelector('#audit-pagination');
  const total = root.querySelector('#audit-total-badge');
  if (filterBar) filterBar.innerHTML = renderFilterBar();
  if (body) body.innerHTML = renderAuditRows();
  if (pagination) pagination.innerHTML = renderPagination();
  if (total) total.textContent = auditView.status === 'ready' ? `${Number(auditData.total) || 0} событий` : auditView.status === 'loading' ? 'Загрузка' : 'Недоступно';
  root.querySelector('.audit-table-card')?.setAttribute('aria-busy', String(auditView.status === 'loading'));
  if (window.lucide) window.lucide.createIcons();
}
