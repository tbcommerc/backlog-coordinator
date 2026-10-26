console.log('[DMB] customerPortal.js loaded');

import {
  getRequestStage,
  hasStructuredDraft,
  renderCustomerAssistantDetails,
  renderCustomerClarifications,
  renderRequestHistory,
  renderRequestJourney,
  renderRequestParticipants,
  renderRequestStatusBadge,
  renderRequestSummary,
  renderRequirementSections,
} from './requestPresentation.js';
import { formatTaskPublicId } from '../taskPublicId.js';
import { button, filterChip, pageHeader } from '../ui/primitives.js';
import { setButtonBusy } from '../ui/controls.js';
import { renderViewState } from './viewState.js';

let requestsCache = [];
let requestLoadGeneration = 0;
let portalWarnings = [];
let portalPage = 1;
let portalMeta = { total: 0, pages: 0, counts: {} };
let portalSearchTimer = null;
let portalScrollAbort = null;
let portalScrollFrame = 0;

const CUSTOMER_QUEUE_STATE_KEY = 'dmb-customer-queue-state:v1';
const CUSTOMER_FILTERS = new Set(['', 'action', 'draft', 'review', 'work', 'complete']);
const CUSTOMER_SORTS = new Set(['newest', 'oldest']);

export function renderCustomerPortal() {
  return `
    <section class="review-queue-card customer-request-list request-list-panel animate-fade-in" aria-labelledby="customer-requests-title">
      <div class="customer-request-toolbar">
        ${pageHeader({ title: 'Мои запросы', id: 'customer-requests-title', description: 'Ваши личные запросы и черновики, а также общие задачи вашего бизнес-заказчика', className: 'request-list-title-row', actions: `<div class="toolbar-actions customer-request-toolbar-actions">${button({ label: 'Новый запрос', icon: 'file-plus-2', size: 'small', attrs: { id: 'customer-new-request-btn', hidden: true } })}${button({ label: 'Создать запрос', icon: 'bot', variant: 'primary', size: 'small', attrs: { id: 'customer-primary-action' } })}</div>` })}
        <div class="filter-panel customer-request-filter-panel">
          <div class="filter-toolbar-row customer-request-controls">
            <label class="relative filter-search-wrap customer-request-search"><span class="sr-only">Поиск</span><i data-lucide="search"></i><input class="input ui-control" id="customer-request-search" type="search" maxlength="200" placeholder="Название или номер запроса" aria-label="Поиск по названию или номеру"></label>
            <div class="customer-request-main-filters"><select id="customer-request-sort" class="input" aria-label="Сортировка запросов"><option value="newest">Сначала обновлённые</option><option value="oldest">Сначала старые</option></select></div>
            <div class="filter-toolbar-controls"><button class="btn btn-secondary btn-sm square-icon customer-request-refresh" id="refresh-requests-btn" aria-label="Обновить запросы" title="Обновить"><i data-lucide="refresh-cw"></i></button></div>
          </div>
        </div>
        <div class="customer-request-quick-filters" aria-label="Быстрые фильтры">
          ${statCard('', 'layout-list', 'Все')}${statCard('action', 'circle-alert', 'Нужно мне')}${statCard('draft', 'file-pen-line', 'Черновики')}${statCard('review', 'search-check', 'На ревью')}${statCard('work', 'workflow', 'В работе')}${statCard('complete', 'circle-check-big', 'Завершены')}
        </div>
      </div>
      <p class="sr-only" id="customer-results-status" role="status" aria-live="polite">Загружаем запросы…</p>
      <div class="review-table-body" id="customer-requests-content" role="region" aria-label="Список моих запросов" aria-busy="true">${renderViewState({ kind: 'loading', title: 'Загружаем запросы…' })}</div>
      <nav id="customer-pagination" class="toolbar-actions" aria-label="Страницы моих запросов" hidden></nav>
    </section>`;
}

function statCard(key, icon, label) {
  const id = key || 'all';
  return filterChip({ label, icon, countId: `customer-stat-${id}`, selected: !key, attrs: { 'data-stat-filter': key } });
}

export async function initCustomerPortal(app) {
  clearTimeout(portalSearchTimer);
  restorePortalControls();
  bindPortalControls(app);
  await loadRequests(app);
  if (window.lucide) window.lucide.createIcons();
}

function bindPortalControls(app) {
  document.getElementById('refresh-requests-btn')?.addEventListener('click', () => loadRequests(app));
  document.getElementById('customer-primary-action')?.addEventListener('click', event => {
    const sessionId = event.currentTarget.dataset.sessionId;
    sessionId ? openDraftSession(app, sessionId, event.currentTarget) : createNewRequest(app, event.currentTarget);
  });
  document.getElementById('customer-new-request-btn')?.addEventListener('click', event => createNewRequest(app, event.currentTarget));
  const reload = (delay = 0) => {
    clearTimeout(portalSearchTimer);
    ++requestLoadGeneration; // Invalidate a response immediately, including during debounce.
    portalPage = 1;
    resetPortalScroll();
    savePortalState({ scrollTop: 0 });
    document.querySelectorAll('[data-customer-page]').forEach(control => { control.disabled = true; });
    portalSearchTimer = setTimeout(() => loadRequests(app), delay);
  };
  document.getElementById('customer-request-search')?.addEventListener('input', () => reload(250));
  document.getElementById('customer-request-sort')?.addEventListener('change', () => reload());
  document.querySelectorAll('[data-stat-filter]').forEach(button => button.addEventListener('click', () => {
    setPortalFilter(button.dataset.statFilter || '');
    reload();
  }));
  document.getElementById('customer-pagination')?.addEventListener('click', event => {
    const control = event.target.closest('[data-customer-page]');
    if (!control || control.disabled) return;
    portalPage = Number(control.dataset.customerPage);
    resetPortalScroll();
    savePortalState({ scrollTop: 0 });
    loadRequests(app);
  });
  document.getElementById('customer-requests-content')?.addEventListener('click', event => {
    const draft = event.target.closest('[data-draft-session]');
    if (draft) openDraftSession(app, draft.dataset.draftSession, draft);
    if (event.target.closest('[data-create-request]')) createNewRequest(app, event.target.closest('[data-create-request]'));
    if (event.target.closest('.customer-request-card')) savePortalState({ scrollTop: currentPortalScroll() }, { syncUrl: false });
  });
  portalScrollAbort?.abort();
  portalScrollAbort = new AbortController();
  document.querySelector('.main-content')?.addEventListener('scroll', () => {
    if (window.location.hash.split('?')[0] !== '#/customer') return;
    if (portalScrollFrame) return;
    portalScrollFrame = window.requestAnimationFrame(() => {
      portalScrollFrame = 0;
      savePortalState({ scrollTop: currentPortalScroll() }, { syncUrl: false });
    });
  }, { passive: true, signal: portalScrollAbort.signal });
}

async function loadRequests(app) {
  const generation = ++requestLoadGeneration;
  const content = document.getElementById('customer-requests-content');
  const refresh = document.getElementById('refresh-requests-btn');
  if (content) content.setAttribute('aria-busy', 'true');
  if (refresh) { refresh.disabled = true; refresh.classList.add('is-loading'); }
  try {
    document.querySelectorAll('[data-customer-page]').forEach(control => { control.disabled = true; });
    const state = savePortalState({ scrollTop: readPortalState().scrollTop }, { syncUrl: false });
    const params = new URLSearchParams({ q: state.search.trim(), group: state.filter, sort: state.sort, page: String(portalPage), per_page: '25' });
    const result = await app.api.get(`/customer/queue?${params}`);
    if (generation !== requestLoadGeneration || !content?.isConnected) return;
    requestsCache = result.items;
    portalWarnings = result.warnings || [];
    portalPage = result.page;
    portalMeta = result;
    savePortalState({ scrollTop: state.scrollTop });
    updatePrimaryActions(result.preferred_draft ? [result.preferred_draft] : []);
    updateStats();
    renderRequestList(app);
    if (content) content.setAttribute('aria-busy', 'false');
    const saved = readPortalState();
    window.requestAnimationFrame(() => {
      const main = document.querySelector('.main-content');
      if (main?.isConnected) main.scrollTop = saved.scrollTop;
    });
  } catch (error) {
    if (generation !== requestLoadGeneration || !content?.isConnected) return;
    document.getElementById('customer-pagination').hidden = true;
    document.getElementById('customer-results-status').textContent = 'Не удалось загрузить запросы';
    if (content) {
      content.setAttribute('aria-busy', 'false');
      content.innerHTML = renderViewState({ kind: 'error', title: 'Не удалось загрузить запросы', message: error.message || 'Повторите попытку позже', actionLabel: 'Повторить', actionId: 'retry-requests' });
    }
    document.getElementById('retry-requests')?.addEventListener('click', () => loadRequests(app));
    if (window.lucide) window.lucide.createIcons();
  } finally {
    if (generation === requestLoadGeneration && refresh) { refresh.disabled = false; refresh.classList.remove('is-loading'); }
  }
}

async function openDraftSession(app, sessionId, control) {
  if (!sessionId || control?.disabled) return;
  setControlBusy(control, true, 'Открываем…');
  try {
    await app.api.post(`/agent/session/${encodeURIComponent(sessionId)}/activate`);
    window.location.hash = '#/customer/create';
  } catch (error) {
    setControlBusy(control, false);
    window.toast?.(`Не удалось открыть черновик: ${error.message}`, 'error');
  }
}

async function createNewRequest(app, control) {
  if (control?.disabled) return;
  setControlBusy(control, true, 'Создаём…');
  try {
    await app.api.post('/agent/new-dialog');
    window.location.hash = '#/customer/create';
  } catch (error) {
    setControlBusy(control, false);
    window.toast?.(`Не удалось создать запрос: ${error.message}`, 'error');
  }
}

function setControlBusy(control, busy, label = '') {
  setButtonBusy(control, busy, label);
  window.lucide?.createIcons();
}

function updatePrimaryActions(drafts) {
  const primary = document.getElementById('customer-primary-action');
  const create = document.getElementById('customer-new-request-btn');
  if (!primary || !create) return;
  const preferred = drafts.find(item => item.active) || drafts[0];
  primary.dataset.sessionId = preferred?.session_id || '';
  primary.innerHTML = preferred
    ? '<i data-lucide="message-square-text"></i><span>Продолжить черновик</span>'
    : '<i data-lucide="bot"></i><span>Создать запрос</span>';
  create.hidden = !preferred;
  window.lucide?.createIcons();
}

function getStage(item) {
  return getRequestStage(item);
}

function updateStats() {
  const counts = portalMeta.counts;
  Object.entries(counts).forEach(([key, value]) => { const el = document.getElementById(`customer-stat-${key}`); if (el) el.textContent = value; });
}

function renderRequestList(app) {
  const content = document.getElementById('customer-requests-content');
  if (!content) return;
  const filter = document.querySelector('[data-stat-filter].active')?.dataset.statFilter || '';
  const filtered = requestsCache;
  document.querySelectorAll('[data-stat-filter]').forEach(button => { const active = button.dataset.statFilter === filter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  const warning = portalWarnings.length ? `<div class="customer-partial-warning" role="status"><i data-lucide="circle-alert"></i><span>${portalWarnings.map(escapeHtml).join(' ')}</span><button type="button" class="btn btn-ghost btn-sm" id="retry-partial-requests">Повторить</button></div>` : '';
  if (!portalMeta.counts.all && !portalWarnings.length) {
    content.innerHTML = warning + renderViewState({ kind: 'empty', title: 'У вас пока нет запросов', message: 'ИИ-ассистент поможет сформулировать потребность и передать её на рассмотрение.', actionLabel: 'Создать первый запрос', actionVariant: 'primary', actionAttrs: { 'data-create-request': true }, hint: 'Далее запрос пройдёт ревью, проработку и реализацию — все этапы будут видны здесь.' });
  } else if (!filtered.length) {
    content.innerHTML = warning + renderViewState({ kind: 'empty', title: 'Запросы не найдены', message: 'Измените поиск или фильтр этапов.', actionLabel: 'Сбросить фильтры', actionId: 'clear-request-filters' });
    document.getElementById('clear-request-filters')?.addEventListener('click', () => {
      document.getElementById('customer-request-search').value = '';
      setPortalFilter('');
      resetPortalScroll();
      portalPage = 1;
      savePortalState({ search: '', filter: '', scrollTop: 0 });
      loadRequests(app);
    });
  } else {
    content.innerHTML = `${warning}<div class="customer-request-cards">${filtered.map(renderRequestCard).join('')}</div>`;
  }
  document.getElementById('customer-results-status').textContent = `Показано ${filtered.length} из ${portalMeta.total}, страница ${portalPage} из ${Math.max(1, portalMeta.pages)}`;
  const pagination = document.getElementById('customer-pagination');
  pagination.hidden = portalMeta.pages <= 1;
  pagination.innerHTML = `${button({ label: 'Предыдущая', variant: 'secondary', size: 'small', attrs: { 'data-customer-page': portalPage - 1, disabled: portalPage <= 1 } })}<span>Страница ${portalPage} из ${Math.max(1, portalMeta.pages)}</span>${button({ label: 'Следующая', variant: 'secondary', size: 'small', attrs: { 'data-customer-page': portalPage + 1, disabled: portalPage >= portalMeta.pages } })}`;
  document.getElementById('retry-partial-requests')?.addEventListener('click', () => document.getElementById('refresh-requests-btn')?.click());
  if (window.lucide) window.lucide.createIcons();
}

function renderRequestCard(item) {
  const stage = getStage(item), group = customerFilterGroup(item), actionable = ['action', 'draft'].includes(group);
  const tag = item.draft_session ? 'button' : 'a';
  const href = item.draft_session
    ? ` type="button" data-draft-session="${escapeHtml(item.session_id)}"`
    : ` href="${item.legacy_task ? `#/customer/task/${escapeHtml(item.task_id)}` : `#/customer/request/${escapeHtml(item.id)}`}"`;
  const actionLabel = item.draft_session ? 'Продолжить в ассистенте' : item.legacy_task ? 'Открыть карточку задачи' : item.status === 'returned' ? 'Уточнить запрос' : 'Открыть запрос';
  const contextLabel = item.draft_session ? 'Следующее действие' : item.status === 'returned' ? 'Требуется ваше действие' : item.status === 'rejected' ? 'Решение по запросу' : ['done', 'closed'].includes(stage.group) ? 'Результат' : 'Следующий шаг';
  const itemLabel = item.draft_session ? `Личный черновик${item.active ? ' · активный' : ''}` : item.legacy_task ? `Задача ${formatTaskPublicId({ id: item.task_id, public_id: item.task_public_id })} · общая задача бизнес-заказчика` : `Личный запрос #${escapeHtml(item.id)}`;
  const owner = customerCardOwner(item, stage), date = reliableDate(item);
  return `<${tag}${href} class="customer-request-card customer-role-card is-stage-${stage.group}${actionable ? ' needs-action' : ''}${item.draft_session ? ' is-draft' : ''}${item.legacy_task ? ' is-legacy' : ''}"><div class="customer-request-card-main"><div class="customer-request-card-heading"><div><span class="customer-request-card-id">${itemLabel}</span>${item.unread_event_count > 0 ? `<span class="badge badge-info">${item.status === 'returned' ? 'Новое замечание' : ['done', 'closed'].includes(stage.group) ? 'Есть результат' : 'Новые события'} · ${Number(item.unread_event_count)}</span>` : ''}<h3>${escapeHtml(item.title || 'Без названия')}</h3></div><span class="badge ${stage.badge}">${escapeHtml(stage.label)}</span></div><div class="customer-request-card-meta"><span title="Ответственный"><i data-lucide="user-check"></i>${escapeHtml(owner)}</span><span title="Последнее значимое обновление: ${escapeHtml(formatDate(item.updated_at || item.created_at))}"><i data-lucide="history"></i>${escapeHtml(customerEventLabel(item, stage))} · ${escapeHtml(formatRelativeDate(item.updated_at || item.created_at))}</span>${date ? `<span title="${escapeHtml(date.label)}"><i data-lucide="calendar-clock"></i>${escapeHtml(date.label)}: ${escapeHtml(date.value)}</span>` : ''}</div></div><div class="customer-request-card-next"><span>${contextLabel}</span><strong>${escapeHtml(nextStepText(item, stage))}</strong>${renderCardContext(item, stage)}<small>${actionLabel} <i data-lucide="arrow-right"></i></small></div></${tag}>`;
}

function renderCardContext(item, stage) {
  if (['returned', 'rejected'].includes(item.status) && item.reject_reason) {
    return `<div class="customer-request-card-context request-card-decision${item.status === 'rejected' ? ' is-danger' : ''}" title="${escapeHtml(item.reject_reason)}"><i data-lucide="${item.status === 'rejected' ? 'circle-x' : 'message-circle-warning'}"></i><span>${escapeHtml(item.reject_reason)}</span></div>`;
  }
  const progress = taskProgress(item);
  if (progress) return progress;
  const fallback = item.draft_session
    ? ['save', 'Черновик сохранён в ассистенте']
    : stage.group === 'review'
      ? ['clock-3', 'Ожидает решения продуктовой команды']
      : stage.group === 'done'
        ? ['circle-check', 'Результат по запросу зафиксирован']
        : stage.group === 'closed'
          ? ['circle-minus', 'Рассмотрение запроса завершено']
          : stage.group === 'action'
            ? ['circle-alert', 'Ожидается действие по запросу']
            : ['workflow', 'Запрос принят в проработку'];
  return `<div class="customer-request-card-context customer-request-card-note"><i data-lucide="${fallback[0]}"></i><span>${fallback[1]}</span></div>`;
}

function customerCardOwner(item, stage) {
  if (item.draft_session) return 'Вы';
  if (item.status === 'returned') return 'Вы';
  if (stage.group === 'review') return item.reviewer_name || item.team_name || 'Продуктовая команда';
  if (item.task_id || ['work', 'done', 'closed'].includes(stage.group)) return item.assignee_name || item.team_name || item.reviewer_name || 'Команда запроса';
  return item.team_name || 'Ответственный назначается';
}

function customerEventLabel(item, stage) {
  if (item.draft_session) return 'Черновик обновлён';
  if (item.status === 'returned') return 'Запрошено уточнение';
  if (item.status === 'rejected') return 'Принято решение';
  if (stage.group === 'done') return 'Работа завершена';
  if (item.task_id) return 'Обновлена реализация';
  if (item.status === 'in_review') return 'Начато ревью';
  if (item.status === 'submitted') return 'Отправлен на ревью';
  return 'Запрос обновлён';
}

function reliableDate(item) {
  const options = [
    ['Срок ревью', item.review_deadline || item.sla_deadline],
    ['Срок задачи', item.task_deadline],
    ['Желаемый результат', item.expected_at || item.expected_date],
  ];
  const [label, value] = options.find(([, candidate]) => candidate) || [];
  return value ? { label, value: formatDate(value, false) } : null;
}

function taskProgress(item) {
  if (!item.task_id || !Number.isFinite(Number(item.task_progress))) return '';
  const progress = Math.max(0, Math.min(100, Number(item.task_progress)));
  return `<div class="customer-request-card-context request-card-progress" aria-label="Прогресс связанной задачи: ${progress}%"><span><i data-lucide="workflow"></i>${escapeHtml(formatTaskPublicId({ id: item.task_id, public_id: item.task_public_id }))}</span><div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div><strong>${progress}%</strong></div>`;
}

function nextStepText(item, stage) {
  if (item.draft_session) return item.active ? 'Продолжите подготовку запроса' : 'Откройте сохранённый диалог';
  if (item.status === 'returned') return 'Ознакомьтесь с замечанием и уточните запрос';
  if (item.status === 'rejected') return 'Рассмотрение запроса завершено';
  if (stage.group === 'review') return item.reviewer_name ? `Запрос рассматривает ${item.reviewer_name}` : 'Команда рассматривает запрос';
  if (stage.group === 'done') return 'Работа по запросу завершена';
  if (stage.group === 'closed') return `Работа завершена со статусом «${stage.label}»`;
  if (item.task_id) return item.assignee_name ? `Запрос прорабатывает ${item.assignee_name}` : 'Запрос передан команде';
  return 'Запрос находится в обработке';
}

function customerFilterGroup(item) {
  if (item.draft_session) return 'draft';
  const group = getStage(item).group;
  return ['done', 'closed'].includes(group) ? 'complete' : group;
}

function setPortalFilter(filter) {
  const safeFilter = CUSTOMER_FILTERS.has(filter) ? filter : '';
  document.querySelectorAll('[data-stat-filter]').forEach(button => {
    const active = button.dataset.statFilter === safeFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function readPortalState() {
  let stored = {};
  try { stored = JSON.parse(sessionStorage.getItem(CUSTOMER_QUEUE_STATE_KEY) || '{}'); } catch (_) { /* storage can be disabled */ }
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const filter = params.has('status') ? params.get('status') : stored.filter;
  const sort = params.has('sort') ? params.get('sort') : stored.sort;
  return {
    search: params.has('q') ? params.get('q') : typeof stored.search === 'string' ? stored.search : '',
    filter: CUSTOMER_FILTERS.has(filter) ? filter : '',
    sort: CUSTOMER_SORTS.has(sort) ? sort : 'newest',
    page: Math.max(1, Math.floor(Number(params.has('page') ? params.get('page') : stored.page) || 1)),
    scrollTop: Number.isFinite(Number(stored.scrollTop)) ? Math.max(0, Number(stored.scrollTop)) : 0,
  };
}

function restorePortalControls() {
  const state = readPortalState();
  portalPage = state.page;
  const search = document.getElementById('customer-request-search');
  const sort = document.getElementById('customer-request-sort');
  if (search) search.value = state.search;
  if (sort) sort.value = state.sort;
  setPortalFilter(state.filter);
}

function savePortalState(patch = {}, { syncUrl = true } = {}) {
  const state = {
    search: document.getElementById('customer-request-search')?.value || '',
    filter: document.querySelector('[data-stat-filter].active')?.dataset.statFilter || '',
    sort: document.getElementById('customer-request-sort')?.value || 'newest',
    page: portalPage,
    scrollTop: currentPortalScroll(),
    ...patch,
  };
  try { sessionStorage.setItem(CUSTOMER_QUEUE_STATE_KEY, JSON.stringify(state)); } catch (_) { /* storage can be disabled */ }
  if (syncUrl) syncPortalUrl(state);
  return state;
}

function syncPortalUrl(state) {
  if (window.location.hash.split('?')[0] !== '#/customer') return;
  const params = new URLSearchParams();
  if (state.search) params.set('q', state.search);
  if (state.filter) params.set('status', state.filter);
  if (state.sort !== 'newest') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  history.replaceState(history.state, '', `#/customer${params.size ? `?${params}` : ''}`);
}

function currentPortalScroll() { return document.querySelector('.main-content')?.scrollTop || 0; }
function resetPortalScroll() { const main = document.querySelector('.main-content'); if (main) main.scrollTop = 0; }

export async function renderRequestPage(app, requestId) {
  try {
    const req = await app.api.get(`/agent/requests/${requestId}`), stage = getStage(req), draft = req.draft || {};
    const hasPassport = hasStructuredDraft(draft);
    const requirementContent = hasPassport
      ? `${renderRequirementSections(draft)}${req.status === 'returned' ? renderCustomerClarifications(draft) : ''}`
      : `<section class="card"><div class="card-header"><h2 class="card-title">Суть запроса</h2></div><div class="card-body"><div class="request-detail">${renderRequestDescription(req.description)}</div></div></section>`;
    const structuredContent = `${hasPassport ? renderCustomerOutline(draft) : ''}${requirementContent}${renderRequestHistory(req)}${hasPassport ? renderCustomerAssistantDetails(draft) : ''}`;
    return `<div class="page-header customer-request-detail-header review-detail-header animate-fade-in"><a href="#/customer" class="customer-back-link"><i data-lucide="arrow-left"></i>Мои запросы</a><div class="review-title-line"><h1>${escapeHtml(req.title || 'Без названия')}</h1>${renderRequestStatusBadge(req)}</div><p>Личный запрос #${req.id} · обновлён ${escapeHtml(formatDate(req.updated_at || req.created_at))}</p></div>
    ${renderRequestJourney(req)}
    ${renderRequestSummary(req)}
    ${req.reject_reason ? `<section class="customer-request-decision customer-specialist-message ${req.status === 'returned' ? 'is-returned' : 'is-rejected'}"><i data-lucide="${req.status === 'returned' ? 'message-circle-warning' : 'x-circle'}"></i><div><span class="customer-specialist-meta">${escapeHtml(req.reviewer_name || 'Специалист команды')} · ${escapeHtml(formatDate(req.updated_at))}</span><strong>${req.status === 'returned' ? 'Что нужно уточнить' : 'Решение по запросу'}</strong><p>${escapeHtml(req.reject_reason)}</p>${req.status === 'returned' ? `<button class="btn btn-primary btn-sm" id="resume-request" data-agent-version="${String(req.agent_session_id || '').startsWith('v2:') ? 'v2' : 'v1'}"><i data-lucide="bot"></i>Уточнить с ИИ-ассистентом</button>` : ''}</div></section>` : ''}
    <div class="customer-request-detail-layout"><main class="customer-request-detail-main">${structuredContent}</main><aside class="customer-request-detail-aside"><section class="card customer-next-step-card"><div class="card-header"><h2 class="card-title">Следующий шаг</h2></div><div class="card-body customer-request-stage"><p>${escapeHtml(customerStageDescription(req, stage))}</p>${req.status === 'returned' && !req.reject_reason ? `<button class="btn btn-primary" id="resume-request" data-agent-version="${String(req.agent_session_id || '').startsWith('v2:') ? 'v2' : 'v1'}"><i data-lucide="bot"></i>Уточнить с ИИ-ассистентом</button>` : ''}</div></section>${renderLinkedTask(req)}${renderRequestParticipants(req)}</aside></div>`;
  } catch (error) {
    return `<div class="customer-request-state is-error" role="alert"><i data-lucide="circle-alert"></i><strong>Запрос не найден</strong><span>${escapeHtml(error.message)}</span><a href="#/customer" class="btn btn-secondary">Вернуться к запросам</a></div>`;
  }
}

function renderCustomerOutline(draft = {}) {
  const definitions = [
    ['Проблема', 'problem_statement', 'request-section-problem'],
    ['AS-IS', 'current_process', 'request-section-current-process'],
    ['TO-BE', 'target_process', 'request-section-target-process'],
    ['Ценность', 'business_value', 'request-section-business-value'],
    ['Пользователи', 'user_roles', 'request-section-user-roles'],
    ['Критерии', 'acceptance_criteria', 'request-section-acceptance-criteria'],
    ['Сценарии', 'scenarios', 'request-section-scenarios'],
    ['Интеграции', 'data_integrations', 'request-section-data-integrations'],
    ['Риски', 'risks', 'request-section-risks'],
  ];
  const links = definitions.filter(([, key]) => hasDisplayValue(draft[key]));
  if (!links.length) return '';
  return `<nav class="review-section-nav customer-section-nav" aria-label="Разделы запроса"><span>Перейти к разделу</span>${links.map(([label, , target]) => `<button class="btn btn-secondary btn-sm ui-btn" type="button" data-customer-request-target="${target}">${label}</button>`).join('')}</nav>`;
}

function hasDisplayValue(value) {
  return Array.isArray(value) ? value.some(Boolean) : Boolean(String(value || '').trim());
}

function customerStageDescription(req, stage) {
  if (req.status === 'returned') return 'Ознакомьтесь с комментарием специалиста и дополните запрос в диалоге с ассистентом.';
  if (req.status === 'rejected') return 'Рассмотрение завершено. Решение специалиста показано над содержанием запроса.';
  return nextStepText(req, stage);
}

function renderLinkedTask(req) {
  if (!req.task_id) return '';
  const progress = Number.isFinite(Number(req.task_progress)) ? `${Math.max(0, Math.min(100, Number(req.task_progress)))}%` : '—';
  return `<section class="card customer-linked-task"><div class="card-header"><div><h2 class="card-title">Реализация</h2><p class="review-card-subtitle">Связанная задача команды</p></div></div><div class="card-body"><div><span>Задача</span><strong>${escapeHtml(formatTaskPublicId({ id: req.task_id, public_id: req.task_public_id }))}</strong></div><div><span>Статус</span><strong>${escapeHtml(req.task_status || 'В работе')}</strong></div><div><span>Прогресс</span><strong>${escapeHtml(progress)}</strong></div>${req.task_deadline ? `<div><span>Срок задачи</span><strong>${escapeHtml(req.task_deadline)}</strong></div>` : ''}<a class="btn btn-secondary btn-sm" href="#/customer/task/${escapeHtml(req.task_id)}">Открыть задачу</a></div></section>`;
}

export function initRequestPage(app, requestId) {
  const eventsRoot = document.createElement('section');
  eventsRoot.className = 'card customer-new-events';
  eventsRoot.setAttribute('aria-label', 'Новые события запроса');
  document.querySelector('.customer-request-detail-main')?.prepend(eventsRoot);
  async function loadEvents() {
    if (!eventsRoot.isConnected) return;
    eventsRoot.innerHTML = '<p role="status">Загружаем новые события…</p>';
    try {
      const data = await app.api.get(`/customer/requests/${requestId}/events`);
      if (!eventsRoot.isConnected) return;
      const items = data.items || [];
      eventsRoot.innerHTML = items.length ? `<div class="card-body"><h2>Новые события · ${Number(data.total)}</h2>${items.map(n => `<article><h3>${escapeHtml(n.title || 'Обновление запроса')}</h3><p>${escapeHtml(n.body || '')}</p></article>`).join('')}<button class="btn btn-secondary" data-read-events>Отметить прочитанным</button><p role="status" data-read-status></p></div>` : '<div class="card-body">Непрочитанных событий нет</div>';
      eventsRoot.querySelector('[data-read-events]')?.addEventListener('click', async event => {
        const control = event.currentTarget;
        control.disabled = true;
        try {
          await app.api.put('/notifications/read', { ids: items.map(n => n.id) });
          app.notificationStore?.invalidate().catch(() => {});
          await loadEvents();
        } catch (error) {
          control.disabled = false;
          eventsRoot.querySelector('[data-read-status]').textContent = `Не удалось сохранить прочтение: ${error.message}`;
        }
      });
    } catch (error) {
      if (!eventsRoot.isConnected) return;
      eventsRoot.innerHTML = `<div class="card-body"><p role="alert">Не удалось загрузить новые события: ${escapeHtml(error.message)}</p><button class="btn btn-secondary" data-retry-events>Повторить</button></div>`;
      eventsRoot.querySelector('[data-retry-events]').addEventListener('click', loadEvents);
    }
  }
  loadEvents();
  const fulfillmentRoot = document.createElement('section');
  fulfillmentRoot.className = 'card';
  document.querySelector('.customer-request-detail-aside')?.append(fulfillmentRoot);
  import('./workResolution.js?v=2').then(m => m.mountFulfillment(fulfillmentRoot, app, requestId));

  resetCustomerDetailScroll();
  document.querySelectorAll('[data-customer-request-target]').forEach(control => control.addEventListener('click', () => focusCustomerRequestSection(control.dataset.customerRequestTarget)));
  document.getElementById('resume-request')?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true; button.innerHTML = '<span class="spinner"></span>Открываем диалог…';
    try {
      if (button.dataset.agentVersion === 'v2') {
        const { agentV2Api } = await import('../agent-v2/api.js?v=1');
        const result = await agentV2Api(app).post(`/requests/${requestId}/resume`, {});
        window.location.hash = result.url || `#/agent-v2?session=${encodeURIComponent(result.session_id || '')}`;
      } else {
        await app.api.post(`/agent/requests/${requestId}/resume`, {});
        window.location.hash = '#/customer/create';
      }
    }
    catch (error) { button.disabled = false; button.textContent = 'Уточнить с ИИ-ассистентом'; window.toast?.(`Не удалось открыть диалог: ${error.message}`, 'error'); }
  });
}

function focusCustomerRequestSection(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const details = target.closest('details');
  if (details) details.open = true;
  document.querySelectorAll('.request-passport-section.is-signal-target').forEach(section => section.classList.remove('is-signal-target'));
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.requestAnimationFrame(() => {
    target.classList.add('is-signal-target');
    target.focus({ preventScroll: true });
    window.setTimeout(() => target.classList.remove('is-signal-target'), 3000);
  });
}

export async function renderCustomerTaskPage(app, taskId) {
  try {
    const task = await app.api.get(`/customer/tasks/${taskId}`);
    const progress = Number.isFinite(Number(task.progress)) ? Math.max(0, Math.min(100, Number(task.progress))) : null;
    const status = task.status_name || task.status || 'В работе';
    const stage = getRequestStage({ status: 'in_progress', task_status: status, task_id: task.id, task_progress: progress });
    const deadline = task.deadline_name || task.deadline || '';
    return `<div class="page-header customer-request-detail-header review-detail-header animate-fade-in"><a href="#/customer" class="customer-back-link"><i data-lucide="arrow-left"></i>Мои запросы</a><div class="review-title-line"><h1>${escapeHtml(task.title || 'Задача по запросу')}</h1><span class="badge ${stage.badge}">${escapeHtml(stage.label)}</span></div><p>${escapeHtml(formatTaskPublicId(task))} · обновлена ${escapeHtml(formatDate(task.updated_at || task.created_at))}</p></div>
      <p class="review-card-subtitle">Просмотр задачи вашего бизнес-заказчика или задачи, связанной с вашим личным запросом. Изменение задачи здесь недоступно.</p>
      <section class="request-summary customer-task-summary" aria-label="Сводка по задаче">
        ${taskSummaryItem('Команда', task.team_name || 'Команда не указана', 'users')}
        ${taskSummaryItem('Прогресс', progress === null ? 'Не указан' : `${progress}%`, 'bar-chart-3')}
        ${deadline ? taskSummaryItem('Срок задачи', deadline, 'calendar-clock') : ''}
      </section>
      <div class="customer-task-detail-layout"><main class="customer-request-detail-main"><section class="card"><div class="card-header"><div><h2 class="card-title">Содержание задачи</h2><p class="review-card-subtitle">Доступное заказчику описание реализации</p></div></div><div class="card-body"><div class="request-detail">${renderRequestDescription(task.description)}</div></div></section></main><aside class="customer-request-detail-aside"><section class="card customer-next-step-card"><div class="card-header"><h2 class="card-title">Текущее состояние</h2></div><div class="card-body customer-request-stage"><p>${escapeHtml(customerTaskStateText(stage, progress))}</p></div></section></aside></div>`;
  } catch (error) {
    return `<div class="customer-request-state is-error" role="alert"><i data-lucide="circle-alert"></i><strong>Задача не найдена</strong><span>${escapeHtml(error.message)}</span><a href="#/customer" class="btn btn-secondary">Вернуться к запросам</a></div>`;
  }
}

export function initCustomerTaskPage() {
  resetCustomerDetailScroll();
  window.lucide?.createIcons();
}

function resetCustomerDetailScroll() {
  const main = document.querySelector('.main-content');
  if (main) main.scrollTop = 0;
}

function customerTaskStateText(stage, progress) {
  if (stage.group === 'done') return 'Работа по задаче завершена.';
  if (stage.group === 'closed') return `Работа по задаче завершена со статусом «${stage.label}».`;
  if (stage.group === 'action') return `Текущий статус задачи — «${stage.label}».`;
  return `Команда выполняет задачу${progress === null ? '.' : `, готовность — ${progress}%.`}`;
}

function taskSummaryItem(label, value, icon) {
  return `<div><span class="request-summary-icon"><i data-lucide="${icon}"></i></span><span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></span></div>`;
}

function renderRequestDescription(description) { if (!description) return '<span class="text-muted">Описание пока не заполнено</span>'; return String(description).split('\n').filter(Boolean).map(line => { const match = line.trim().match(/^\*\*(.+?):\*\*(.*)$/); if (match) return `<div class="request-detail-row"><span class="request-detail-key">${escapeHtml(match[1].trim())}</span><span class="request-detail-val">${escapeHtml(match[2].trim())}</span></div>`; if (line.trim().startsWith('- ')) return `<div class="request-detail-list"><span>•</span><span>${escapeHtml(line.trim().slice(2))}</span></div>`; return `<div class="request-detail-text">${escapeHtml(line.trim())}</div>`; }).join(''); }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value == null ? '' : String(value); return div.innerHTML; }
function formatDate(iso, includeTime = true) { if (!iso) return '—'; const date = new Date(iso); return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ru-RU', includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }); }
function formatRelativeDate(iso) { if (!iso) return 'недавно'; const diff = Date.now() - new Date(iso).getTime(), minutes = Math.max(0, Math.round(diff / 60000)); if (minutes < 1) return 'только что'; if (minutes < 60) return `${minutes} мин. назад`; const hours = Math.round(minutes / 60); if (hours < 24) return `${hours} ч. назад`; const days = Math.round(hours / 24); return days < 14 ? `${days} дн. назад` : formatDate(iso); }
