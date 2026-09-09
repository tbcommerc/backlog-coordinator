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

let requestsCache = [];
let requestLoadGeneration = 0;
let portalWarnings = [];
let portalScrollAbort = null;
let portalScrollFrame = 0;

const CUSTOMER_QUEUE_STATE_KEY = 'dmb-customer-queue-state:v1';
const CUSTOMER_FILTERS = new Set(['', 'action', 'draft', 'review', 'work', 'complete']);
const CUSTOMER_SORTS = new Set(['newest', 'oldest']);

export function renderCustomerPortal() {
  return `
    <section class="review-queue-card customer-request-list request-list-panel animate-fade-in" aria-labelledby="customer-requests-title">
      <div class="customer-request-toolbar">
        <div class="toolbar-title-row request-list-title-row">
          <div class="toolbar-title-wrap"><h1 class="toolbar-title" id="customer-requests-title">Мои запросы</h1><p class="toolbar-subtitle">Черновики, рассмотрение и результат — в одной истории</p></div>
          <div class="toolbar-actions customer-request-toolbar-actions">
            <button type="button" class="btn btn-secondary btn-sm" id="customer-new-request-btn" hidden><i data-lucide="file-plus-2"></i><span>Новый запрос</span></button>
            <button type="button" class="btn btn-primary btn-sm" id="customer-primary-action"><i data-lucide="bot"></i><span>Создать запрос</span></button>
          </div>
        </div>
        <div class="filter-panel customer-request-filter-panel">
          <div class="filter-toolbar-row customer-request-controls">
            <label class="relative filter-search-wrap customer-request-search"><span class="sr-only">Поиск</span><i data-lucide="search"></i><input id="customer-request-search" type="search" placeholder="Название или номер запроса" aria-label="Поиск по названию или номеру"></label>
            <div class="customer-request-main-filters"><select id="customer-request-sort" class="input" aria-label="Сортировка запросов"><option value="newest">Сначала обновлённые</option><option value="oldest">Сначала старые</option></select></div>
            <div class="filter-toolbar-controls"><button class="btn btn-secondary btn-sm square-icon customer-request-refresh" id="refresh-requests-btn" aria-label="Обновить запросы" title="Обновить"><i data-lucide="refresh-cw"></i></button></div>
          </div>
        </div>
        <div class="customer-request-quick-filters" aria-label="Быстрые фильтры">
          ${statCard('', 'layout-list', 'Все')}${statCard('action', 'circle-alert', 'Нужно мне')}${statCard('draft', 'file-pen-line', 'Черновики')}${statCard('review', 'search-check', 'На ревью')}${statCard('work', 'workflow', 'В работе')}${statCard('complete', 'circle-check-big', 'Завершены')}
        </div>
      </div>
      <p class="sr-only" id="customer-results-status" role="status" aria-live="polite">Загружаем запросы…</p>
      <div class="review-table-body" id="customer-requests-content" role="region" aria-label="Список моих запросов" aria-busy="true"><div class="customer-request-loading" role="status"><span class="spinner"></span><span>Загружаем запросы…</span></div></div>
    </section>`;
}

function statCard(key, icon, label) {
  const id = key || 'all';
  return `<button type="button" class="quick-filter-btn" data-stat-filter="${key}" aria-pressed="${key ? 'false' : 'true'}"><span class="quick-filter-icon"><i data-lucide="${icon}"></i></span><span class="quick-filter-info"><span class="quick-filter-label">${label}</span><strong class="quick-filter-count" id="customer-stat-${id}">—</strong></span></button>`;
}

export async function initCustomerPortal(app) {
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
  document.getElementById('customer-request-search')?.addEventListener('input', () => { resetPortalScroll(); renderRequestList(); savePortalState({ scrollTop: 0 }); });
  document.getElementById('customer-request-sort')?.addEventListener('change', () => { resetPortalScroll(); renderRequestList(); savePortalState({ scrollTop: 0 }); });
  document.querySelectorAll('[data-stat-filter]').forEach(button => button.addEventListener('click', () => {
    setPortalFilter(button.dataset.statFilter || '');
    resetPortalScroll();
    renderRequestList();
    savePortalState({ scrollTop: 0 });
  }));
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
    const [requestsResult, tasksResult, sessionsResult] = await Promise.allSettled([
      app.api.get('/agent/requests'),
      app.api.get('/customer/tasks?per_page=200'),
      app.api.get('/agent/sessions'),
    ]);
    if (generation !== requestLoadGeneration) return;
    if (requestsResult.status === 'rejected') throw requestsResult.reason;
    const requests = Array.isArray(requestsResult.value) ? requestsResult.value : [];
    const tasks = tasksResult.status === 'fulfilled' ? (tasksResult.value.items || []) : [];
    const sessions = sessionsResult.status === 'fulfilled' ? (sessionsResult.value.sessions || []) : [];
    const linkedTaskIds = new Set(requests.map(item => item.task_id).filter(Boolean));
    const legacy = tasks.filter(task => !linkedTaskIds.has(task.id)).map(task => ({ id: `task-${task.id}`, task_id: task.id, task_public_id: formatTaskPublicId(task), title: task.title, description: task.description, status: 'in_progress', task_status: task.status || task.status_name, task_progress: task.progress, task_deadline: task.deadline || task.deadline_name, team_name: task.team_name, assignee_name: task.owner_name, updated_at: task.updated_at, created_at: task.created_at, legacy_task: true }));
    const drafts = sessions.filter(isVisibleDraftSession).map(session => ({
      id: `draft-${session.session_id}`,
      session_id: session.session_id,
      title: String(session.title || '').trim() || 'Новый запрос',
      status: 'draft',
      active: Boolean(session.active),
      updated_at: session.last_message_at || session.updated_at,
      created_at: session.updated_at || session.last_message_at,
      draft_session: true,
    }));
    portalWarnings = [];
    if (sessionsResult.status === 'rejected') portalWarnings.push('Черновики ассистента временно недоступны.');
    if (tasksResult.status === 'rejected') portalWarnings.push('Сведения о связанных задачах временно недоступны.');
    if (tasksResult.status === 'fulfilled' && Number(tasksResult.value.pages) > 1) portalWarnings.push('Показаны первые 200 legacy-задач. Уточните поиск после загрузки полного архива.');
    requestsCache = [...drafts, ...requests, ...legacy].sort(compareUpdatedDesc);
    updatePrimaryActions(drafts);
    updateStats();
    renderRequestList();
    if (content) content.setAttribute('aria-busy', 'false');
    const saved = readPortalState();
    window.requestAnimationFrame(() => {
      const main = document.querySelector('.main-content');
      if (main?.isConnected) main.scrollTop = saved.scrollTop;
    });
  } catch (error) {
    if (generation !== requestLoadGeneration) return;
    if (content) {
      content.setAttribute('aria-busy', 'false');
      content.innerHTML = `<div class="customer-request-state is-error" role="alert"><i data-lucide="cloud-off"></i><strong>Не удалось загрузить запросы</strong><span>${escapeHtml(error.message || 'Повторите попытку позже')}</span><button class="btn btn-secondary btn-sm" id="retry-requests">Повторить</button></div>`;
    }
    document.getElementById('retry-requests')?.addEventListener('click', () => loadRequests(app));
    if (window.lucide) window.lucide.createIcons();
  } finally {
    if (generation === requestLoadGeneration && refresh) { refresh.disabled = false; refresh.classList.remove('is-loading'); }
  }
}

function isVisibleDraftSession(session = {}) {
  return !session.archived && !session.request_id && Boolean(session.has_draft || session.phase === 'draft_ready');
}

function compareUpdatedDesc(left, right) {
  return (Date.parse(right.updated_at || right.created_at || '') || 0) - (Date.parse(left.updated_at || left.created_at || '') || 0);
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
  if (!control) return;
  if (!control.dataset.originalHtml) control.dataset.originalHtml = control.innerHTML;
  control.disabled = busy;
  control.setAttribute('aria-busy', String(busy));
  control.innerHTML = busy ? `<span class="spinner"></span><span>${escapeHtml(label)}</span>` : control.dataset.originalHtml;
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
  const counts = { all: requestsCache.length, action: 0, draft: 0, review: 0, work: 0, complete: 0 };
  requestsCache.forEach(item => { const group = customerFilterGroup(item); if (counts[group] !== undefined) counts[group] += 1; });
  Object.entries(counts).forEach(([key, value]) => { const el = document.getElementById(`customer-stat-${key}`); if (el) el.textContent = value; });
}

function renderRequestList() {
  const content = document.getElementById('customer-requests-content');
  if (!content) return;
  const query = document.getElementById('customer-request-search')?.value.trim().toLocaleLowerCase('ru') || '';
  const filter = document.querySelector('[data-stat-filter].active')?.dataset.statFilter || '';
  const sort = document.getElementById('customer-request-sort')?.value || 'newest';
  const filtered = requestsCache
    .filter(item => (!filter || customerFilterGroup(item) === filter) && (!query || requestSearchText(item).includes(query)))
    .sort((left, right) => (sort === 'oldest' ? -1 : 1) * compareUpdatedDesc(left, right));
  document.querySelectorAll('[data-stat-filter]').forEach(button => { const active = button.dataset.statFilter === filter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  const warning = portalWarnings.length ? `<div class="customer-partial-warning" role="status"><i data-lucide="circle-alert"></i><span>${portalWarnings.map(escapeHtml).join(' ')}</span><button type="button" class="btn btn-ghost btn-sm" id="retry-partial-requests">Повторить</button></div>` : '';
  if (!requestsCache.length) {
    content.innerHTML = `${warning}<div class="customer-request-state"><div class="customer-request-state-icon"><i data-lucide="messages-square"></i></div><strong>У вас пока нет запросов</strong><span>ИИ-ассистент поможет сформулировать потребность и передать её на рассмотрение.</span><button type="button" class="btn btn-primary" data-create-request><i data-lucide="bot"></i>Создать первый запрос</button><small>Далее запрос пройдёт ревью, проработку и реализацию — все этапы будут видны здесь.</small></div>`;
  } else if (!filtered.length) {
    content.innerHTML = `${warning}<div class="customer-request-state"><i data-lucide="search-x"></i><strong>Запросы не найдены</strong><span>Измените поиск или фильтр этапов.</span><button class="btn btn-secondary btn-sm" id="clear-request-filters">Сбросить фильтры</button></div>`;
    document.getElementById('clear-request-filters')?.addEventListener('click', () => {
      document.getElementById('customer-request-search').value = '';
      setPortalFilter('');
      resetPortalScroll();
      renderRequestList();
      savePortalState({ search: '', filter: '', scrollTop: 0 });
    });
  } else {
    content.innerHTML = `${warning}<div class="customer-request-cards">${filtered.map(renderRequestCard).join('')}</div>`;
  }
  document.getElementById('customer-results-status').textContent = `Показано ${filtered.length} из ${requestsCache.length}`;
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
  const itemLabel = item.draft_session ? `Черновик${item.active ? ' · активный' : ''}` : item.legacy_task ? `Задача ${formatTaskPublicId({ id: item.task_id, public_id: item.task_public_id })} · из бэклога` : `Запрос #${escapeHtml(item.id)}`;
  const owner = customerCardOwner(item, stage), date = reliableDate(item);
  return `<${tag}${href} class="customer-request-card customer-role-card is-stage-${stage.group}${actionable ? ' needs-action' : ''}${item.draft_session ? ' is-draft' : ''}${item.legacy_task ? ' is-legacy' : ''}"><div class="customer-request-card-main"><div class="customer-request-card-heading"><div><span class="customer-request-card-id">${itemLabel}</span><h3>${escapeHtml(item.title || 'Без названия')}</h3></div><span class="badge ${stage.badge}">${escapeHtml(stage.label)}</span></div><div class="customer-request-card-meta"><span title="Ответственный"><i data-lucide="user-check"></i>${escapeHtml(owner)}</span><span title="Последнее значимое обновление: ${escapeHtml(formatDate(item.updated_at || item.created_at))}"><i data-lucide="history"></i>${escapeHtml(customerEventLabel(item, stage))} · ${escapeHtml(formatRelativeDate(item.updated_at || item.created_at))}</span>${date ? `<span title="${escapeHtml(date.label)}"><i data-lucide="calendar-clock"></i>${escapeHtml(date.label)}: ${escapeHtml(date.value)}</span>` : ''}</div></div><div class="customer-request-card-next"><span>${contextLabel}</span><strong>${escapeHtml(nextStepText(item, stage))}</strong>${renderCardContext(item, stage)}<small>${actionLabel} <i data-lucide="arrow-right"></i></small></div></${tag}>`;
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

function requestSearchText(item) {
  return [item.id, item.task_public_id, item.title, item.description, item.team_name, item.assignee_name, item.reviewer_name, item.reject_reason]
    .filter(Boolean).join(' ').toLocaleLowerCase('ru');
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
    scrollTop: Number.isFinite(Number(stored.scrollTop)) ? Math.max(0, Number(stored.scrollTop)) : 0,
  };
}

function restorePortalControls() {
  const state = readPortalState();
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
    return `<div class="page-header customer-request-detail-header review-detail-header animate-fade-in"><a href="#/customer" class="customer-back-link"><i data-lucide="arrow-left"></i>Мои запросы</a><div class="review-title-line"><h1>${escapeHtml(req.title || 'Без названия')}</h1>${renderRequestStatusBadge(req)}</div><p>#${req.id} · обновлён ${escapeHtml(formatDate(req.updated_at || req.created_at))}</p></div>
    ${renderRequestJourney(req)}
    ${renderRequestSummary(req)}
    ${req.reject_reason ? `<section class="customer-request-decision customer-specialist-message ${req.status === 'returned' ? 'is-returned' : 'is-rejected'}"><i data-lucide="${req.status === 'returned' ? 'message-circle-warning' : 'x-circle'}"></i><div><span class="customer-specialist-meta">${escapeHtml(req.reviewer_name || 'Специалист команды')} · ${escapeHtml(formatDate(req.updated_at))}</span><strong>${req.status === 'returned' ? 'Что нужно уточнить' : 'Решение по запросу'}</strong><p>${escapeHtml(req.reject_reason)}</p>${req.status === 'returned' ? '<button class="btn btn-primary btn-sm" id="resume-request"><i data-lucide="bot"></i>Уточнить с ИИ-ассистентом</button>' : ''}</div></section>` : ''}
    <div class="customer-request-detail-layout"><main class="customer-request-detail-main">${structuredContent}</main><aside class="customer-request-detail-aside"><section class="card customer-next-step-card"><div class="card-header"><h2 class="card-title">Следующий шаг</h2></div><div class="card-body customer-request-stage"><p>${escapeHtml(customerStageDescription(req, stage))}</p>${req.status === 'returned' && !req.reject_reason ? '<button class="btn btn-primary" id="resume-request"><i data-lucide="bot"></i>Уточнить с ИИ-ассистентом</button>' : ''}</div></section>${renderLinkedTask(req)}${renderRequestParticipants(req)}</aside></div>`;
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
  return `<nav class="review-section-nav customer-section-nav" aria-label="Разделы запроса"><span>Перейти к разделу</span>${links.map(([label, , target]) => `<button type="button" data-customer-request-target="${target}">${label}</button>`).join('')}</nav>`;
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
  resetCustomerDetailScroll();
  document.querySelectorAll('[data-customer-request-target]').forEach(control => control.addEventListener('click', () => focusCustomerRequestSection(control.dataset.customerRequestTarget)));
  document.getElementById('resume-request')?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true; button.innerHTML = '<span class="spinner"></span>Открываем диалог…';
    try { await app.api.post(`/agent/requests/${requestId}/resume`, {}); window.location.hash = '#/customer/create'; }
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
