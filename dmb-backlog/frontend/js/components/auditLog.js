import { auditActionLabel, auditEntityLabel } from '../adminLabels.js';
import { pagination } from '../ui/forms.js';
import { escapeHtml } from '../htmlUtils.js';
import { formatErrorMessage, showToast } from '../uiFeedback.js';
import { renderViewState } from './viewState.js';
import { button, control, field, fieldFrame, icon, pageHeader } from '../ui/primitives.js';
import { setButtonBusy } from '../ui/controls.js';

const EMPTY_FILTERS = { user_id: '', action: '', entity_type: '', date_from: '', date_to: '' };


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
  if (status >= 400) return { label: 'Ошибка', tone: 'danger', icon: 'x-circle' };
  if (status > 0) return { label: 'Успешно', tone: 'success', icon: 'check-circle' };
  return { label: 'Зафиксировано', tone: 'neutral', icon: 'check' };
}

function actionBadge(action) {
  const key = String(action || '').toLowerCase();
  return `<span class="audit-action-badge audit-action-${escapeHtml(key)}" title="${escapeHtml(action || '')}">${escapeHtml(auditActionLabel(action))}</span>`;
}

function entityBadge(type, id) {
  return `<span class="audit-entity-badge" title="${escapeHtml(type || '')}">${escapeHtml(auditEntityLabel(type))}</span>${id ? `<span class="audit-entity-id">#${escapeHtml(id)}</span>` : ''}`;
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
      <td><div class="audit-request-cell"><code title="${escapeHtml(requestId)}">${escapeHtml(requestId || '—')}</code>${requestId ? button({ label: 'Скопировать Request ID', icon: 'copy', iconOnly: true, variant: 'ghost', size: 'small', attrs: { 'data-copy-request': requestId } }) : ''}</div></td>
      <td><code class="audit-ip">${escapeHtml(item.ip_address || '—')}</code></td>
    </tr>`;
  }).join('');
}

function activeFilterEntries() {
  const user = auditFilters.users.find(item => String(item.id) === String(auditState.filters.user_id));
  return [
    auditState.search && ['search', `Поиск: ${auditState.search}`],
    auditState.filters.user_id && ['user_id', `Пользователь: ${user?.name || auditState.filters.user_id}`],
    auditState.filters.action && ['action', `Действие: ${auditActionLabel(auditState.filters.action)}`],
    auditState.filters.entity_type && ['entity_type', `Сущность: ${auditEntityLabel(auditState.filters.entity_type)}`],
    auditState.filters.date_from && ['date_from', `С ${auditState.filters.date_from.split('-').reverse().join('.')}`],
    auditState.filters.date_to && ['date_to', `По ${auditState.filters.date_to.split('-').reverse().join('.')}`],
  ].filter(Boolean);
}

function renderActiveFilters() {
  const entries = activeFilterEntries();
  if (!entries.length) return '<span class="audit-filter-summary">Фильтры не выбраны</span>';
  return `<span class="audit-filter-summary">Активные фильтры:</span>${entries.map(([key, label]) => button({ label, icon: 'x', size: 'small', className: 'audit-filter-chip', attrs: { 'data-remove-filter': key, 'aria-label': `Убрать фильтр: ${label}` } })).join('')}${button({ label: 'Сбросить все', variant: 'ghost', size: 'small', className: 'audit-clear-all', attrs: { 'data-reset-audit': true } })}`;
}

function renderFilterBar() {
  const filters = auditState.filters;
  return `<section class="audit-filter-panel${auditMobileFiltersOpen ? ' is-open' : ''}" aria-labelledby="audit-filter-title">
    <div class="audit-filter-heading"><div><h2 id="audit-filter-title">Фильтры журнала</h2><p>Уточните период, автора или тип изменения.</p></div><div class="audit-filter-heading-actions">${button({ label: auditMobileFiltersOpen ? 'Скрыть' : 'Настроить', icon: 'sliders-horizontal', size: 'small', className: 'audit-filter-toggle', attrs: { 'data-toggle-audit-filters': true, 'aria-expanded': auditMobileFiltersOpen, 'aria-controls': 'audit-filter-form' } })}${button({ label: 'Сбросить фильтры', icon: 'rotate-ccw', iconOnly: true, variant: 'ghost', size: 'small', attrs: { 'data-reset-audit': true, disabled: !activeFilterEntries().length } })}</div></div>
    <form id="audit-filter-form" class="audit-filter-grid">
      ${fieldFrame({ id: 'audit-filter-search', label: 'Поиск', className: 'audit-search-field', controlMarkup: `<div class="audit-input-with-icon">${icon('search')}${control({ id: 'audit-filter-search', type: 'search', value: auditState.search, attrs: { maxlength: 100, placeholder: 'Действие, сущность, Request ID или IP' } })}</div>` })}
      ${field({ id: 'audit-filter-user', label: 'Пользователь', kind: 'select', value: filters.user_id, options: [{ value: '', label: 'Все пользователи' }, ...auditFilters.users.map(user => ({ value: user.id, label: user.name }))] })}
      ${field({ id: 'audit-filter-action', label: 'Действие', kind: 'select', value: filters.action, options: [{ value: '', label: 'Все действия' }, ...auditFilters.actions.map(action => ({ value: action, label: auditActionLabel(action) }))] })}
      ${field({ id: 'audit-filter-entity', label: 'Сущность', kind: 'select', value: filters.entity_type, options: [{ value: '', label: 'Все сущности' }, ...auditFilters.entity_types.map(entity => ({ value: entity, label: auditEntityLabel(entity) }))] })}
      <fieldset class="audit-period-field"><legend>Период</legend><div>${control({ type: 'date', id: 'audit-filter-date-from', value: filters.date_from, attrs: { 'aria-label': 'Дата с', 'aria-describedby': 'audit-date-error' } })}<span aria-hidden="true">—</span>${control({ type: 'date', id: 'audit-filter-date-to', value: filters.date_to, attrs: { 'aria-label': 'Дата по', 'aria-describedby': 'audit-date-error' } })}</div><span class="audit-filter-error" id="audit-date-error" role="alert"></span></fieldset>
      ${button({ label: 'Применить', icon: 'filter', variant: 'primary', className: 'audit-apply-btn', attrs: { type: 'submit' } })}
    </form>
    ${auditView.filtersUnavailable && auditView.error?.status !== 403 ? '<p class="audit-filter-notice"><i data-lucide="info" aria-hidden="true"></i>Списки фильтров временно недоступны. Поиск и период продолжают работать.</p>' : ''}
    <div class="audit-active-filters" id="audit-active-filters">${renderActiveFilters()}</div>
  </section>`;
}

function renderPagination() {
  const total = Number(auditData.total) || 0;
  const pages = Math.max(1, Number(auditData.pages) || 1);
  const page = Math.min(auditState.page, pages);
  const start = total ? (page - 1) * auditState.perPage + 1 : 0;
  const end = Math.min(page * auditState.perPage, total);
  return `<div class="audit-table-footer"><div class="audit-page-size"><label for="audit-per-page">Строк на странице</label>${control({ id: 'audit-per-page', kind: 'select', size: 'small', value: auditState.perPage, options: [25, 50, 100, 200].map(size => ({ value: size, label: size })) })}</div><span class="audit-range" aria-live="polite">${start}–${end} из ${total}</span>${pagination({ page, pages, disabled: auditView.status === 'loading', label: 'Страницы журнала', className: 'audit-pagination', buttonClassName: 'audit-page-btn' })}</div>`;
}

export function renderAuditLog() {
  return `<section class="audit-page animate-fade-in" id="audit-page"><header class="page-header">${pageHeader({ title: 'Аудит действий', description: 'История изменений и системных операций для контроля и разбора инцидентов.', className: 'audit-page-header', actions: `<span class="audit-total-badge" id="audit-total-badge">${auditView.status === 'ready' ? `${Number(auditData.total) || 0} событий` : 'Загрузка'}</span>${button({ label: 'Обновить', icon: 'refresh-cw', size: 'small', className: 'audit-refresh-btn', attrs: { 'data-refresh-audit': true } })}` })}</header><div id="audit-filter-bar">${renderFilterBar()}</div><section class="audit-table-card" aria-labelledby="audit-table-title" aria-busy="${auditView.status === 'loading'}"><div class="audit-table-heading"><div><h2 id="audit-table-title">События</h2><p>Сначала показаны последние изменения.</p></div><span class="audit-table-hint"><i data-lucide="shield-check" aria-hidden="true"></i>Журнал доступен только администраторам</span></div><div class="audit-page-table-wrap table-container" tabindex="0" role="region" aria-label="Таблица событий аудита"><table class="ui-table ui-table-data audit-page-table"><caption class="sr-only">События аудита системы</caption><thead><tr><th scope="col">Дата и время</th><th scope="col">Пользователь</th><th scope="col">Результат</th><th scope="col">Действие</th><th scope="col">Сущность</th><th scope="col">Изменённые поля</th><th scope="col">Request ID</th><th scope="col">IP-адрес</th></tr></thead><tbody id="audit-table-body">${renderAuditRows()}</tbody></table></div><div id="audit-pagination">${renderPagination()}</div></section></section>`;
}

function collectFilters(root) {
  auditState.search = root.querySelector('#audit-filter-search')?.value.trim() || '';
  auditState.filters = { user_id: root.querySelector('#audit-filter-user')?.value || '', action: root.querySelector('#audit-filter-action')?.value || '', entity_type: root.querySelector('#audit-filter-entity')?.value || '', date_from: root.querySelector('#audit-filter-date-from')?.value || '', date_to: root.querySelector('#audit-filter-date-to')?.value || '' };
}

function validatePeriod(root) {
  const from = root.querySelector('#audit-filter-date-from')?.value || '';
  const to = root.querySelector('#audit-filter-date-to')?.value || '';
  const error = root.querySelector('#audit-date-error');
  const invalid = Boolean(from && to && from > to);
  root.querySelectorAll('#audit-filter-date-from, #audit-filter-date-to').forEach(input => input.setAttribute('aria-invalid', String(invalid)));
  if (invalid) { if (error) error.textContent = 'Дата начала не может быть позже даты окончания.'; root.querySelector('#audit-filter-date-from')?.focus(); return false; }
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
    if (pageButton?.dataset.page && !pageButton.disabled) { auditState.page = Number(pageButton.dataset.page) || 1; await reloadAudit(app); root.querySelector('.audit-page-table-wrap')?.focus({ preventScroll: true }); return; }
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
  setButtonBusy(root.querySelector('[data-refresh-audit]'), auditView.status === 'loading', 'Обновляем…');
  setButtonBusy(root.querySelector('.audit-apply-btn'), auditView.status === 'loading', 'Загружаем…');
  if (window.lucide) window.lucide.createIcons();
}
