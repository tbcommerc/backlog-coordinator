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

export function renderCustomerPortal() {
  return `
    <section class="review-queue-card customer-request-list request-list-panel animate-fade-in" aria-labelledby="customer-requests-title">
      <div class="customer-request-toolbar">
        <div class="toolbar-title-row request-list-title-row">
          <div class="toolbar-title-wrap"><h1 class="toolbar-title" id="customer-requests-title">Мои запросы</h1><p class="toolbar-subtitle">Следите за запросом от создания до результата</p></div>
          <div class="toolbar-actions"><a href="#/customer/create" class="btn btn-primary btn-sm"><i data-lucide="bot"></i>Создать запрос</a></div>
        </div>
        <div class="filter-panel customer-request-filter-panel">
          <div class="filter-toolbar-row customer-request-controls">
            <label class="relative filter-search-wrap customer-request-search"><span class="sr-only">Поиск</span><i data-lucide="search"></i><input id="customer-request-search" type="search" placeholder="Название или номер запроса" aria-label="Поиск по названию или номеру"></label>
            <div class="customer-request-main-filters"><select id="customer-request-sort" class="input" aria-label="Сортировка запросов"><option value="newest">Сначала обновлённые</option><option value="oldest">Сначала старые</option></select></div>
            <div class="filter-toolbar-controls"><button class="btn btn-secondary btn-sm square-icon customer-request-refresh" id="refresh-requests-btn" aria-label="Обновить запросы" title="Обновить"><i data-lucide="refresh-cw"></i></button></div>
          </div>
        </div>
        <div class="customer-request-quick-filters" aria-label="Быстрые фильтры">
          ${statCard('', 'layout-list', 'Все')}${statCard('action', 'circle-alert', 'Нужно действие')}${statCard('review', 'search-check', 'На рассмотрении')}${statCard('work', 'workflow', 'В работе')}${statCard('done', 'circle-check-big', 'Выполнено')}${statCard('closed', 'archive', 'Закрытые')}
        </div>
      </div>
      <div class="review-table-body" id="customer-requests-content"><div class="customer-request-loading"><span class="spinner"></span><span>Загружаем запросы…</span></div></div>
    </section>`;
}

function statCard(key, icon, label) {
  const id = key || 'all';
  return `<button type="button" class="quick-filter-btn" data-stat-filter="${key}" aria-pressed="${key ? 'false' : 'true'}"><span class="quick-filter-icon"><i data-lucide="${icon}"></i></span><span class="quick-filter-info"><span class="quick-filter-label">${label}</span><strong class="quick-filter-count" id="customer-stat-${id}">—</strong></span></button>`;
}

export async function initCustomerPortal(app) {
  bindPortalControls(app);
  await loadRequests(app);
  if (window.lucide) window.lucide.createIcons();
}

function bindPortalControls(app) {
  document.getElementById('refresh-requests-btn')?.addEventListener('click', () => loadRequests(app));
  document.getElementById('customer-request-search')?.addEventListener('input', renderRequestList);
  document.getElementById('customer-request-sort')?.addEventListener('change', renderRequestList);
  document.querySelectorAll('[data-stat-filter]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-stat-filter]').forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    renderRequestList();
  }));
  document.querySelector('[data-stat-filter=""]')?.classList.add('active');
}

async function loadRequests(app) {
  const content = document.getElementById('customer-requests-content');
  try {
    const [requestsResult, tasksResult] = await Promise.allSettled([app.api.get('/agent/requests'), app.api.get('/customer/tasks?per_page=200')]);
    if (requestsResult.status === 'rejected') throw requestsResult.reason;
    const requests = Array.isArray(requestsResult.value) ? requestsResult.value : [];
    const tasks = tasksResult.status === 'fulfilled' ? (tasksResult.value.items || []) : [];
    const linkedTaskIds = new Set(requests.map(item => item.task_id).filter(Boolean));
    const legacy = tasks.filter(task => !linkedTaskIds.has(task.id)).map(task => ({ id: `task-${task.id}`, task_id: task.id, task_public_id: formatTaskPublicId(task), title: task.title, status: 'in_progress', task_status: task.status || task.status_name, task_progress: task.progress, task_deadline: task.deadline || task.deadline_name, team_name: task.team_name, updated_at: task.updated_at, created_at: task.created_at, legacy_task: true }));
    requestsCache = [...requests, ...legacy].sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
    updateStats();
    renderRequestList();
  } catch (error) {
    if (content) content.innerHTML = `<div class="customer-request-state is-error"><i data-lucide="cloud-off"></i><strong>Не удалось загрузить запросы</strong><span>${escapeHtml(error.message || 'Повторите попытку позже')}</span><button class="btn btn-secondary btn-sm" id="retry-requests">Повторить</button></div>`;
    document.getElementById('retry-requests')?.addEventListener('click', () => loadRequests(app));
    if (window.lucide) window.lucide.createIcons();
  }
}

function getStage(item) {
  return getRequestStage(item);
}

function updateStats() {
  const counts = { all: requestsCache.length, action: 0, review: 0, work: 0, done: 0, closed: 0 };
  requestsCache.forEach(item => { const group = getStage(item).group; if (counts[group] !== undefined) counts[group] += 1; });
  Object.entries(counts).forEach(([key, value]) => { const el = document.getElementById(`customer-stat-${key}`); if (el) el.textContent = value; });
}

function renderRequestList() {
  const content = document.getElementById('customer-requests-content');
  if (!content) return;
  const query = document.getElementById('customer-request-search')?.value.trim().toLocaleLowerCase('ru') || '';
  const filter = document.querySelector('[data-stat-filter].active')?.dataset.statFilter || '';
  const sort = document.getElementById('customer-request-sort')?.value || 'newest';
  const filtered = requestsCache.filter(item => (!filter || getStage(item).group === filter) && (!query || `${item.id} ${item.title}`.toLocaleLowerCase('ru').includes(query))).sort((a, b) => (sort === 'oldest' ? 1 : -1) * (new Date(a.updated_at || a.created_at || 0) - new Date(b.updated_at || b.created_at || 0)));
  document.querySelectorAll('[data-stat-filter]').forEach(button => { const active = button.dataset.statFilter === filter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  if (!requestsCache.length) {
    content.innerHTML = `<div class="customer-request-state"><div class="customer-request-state-icon"><i data-lucide="messages-square"></i></div><strong>У вас пока нет запросов</strong><span>ИИ-ассистент поможет сформулировать потребность и передать её на рассмотрение.</span><a href="#/customer/create" class="btn btn-primary"><i data-lucide="bot"></i>Создать первый запрос</a><small>Далее запрос пройдёт ревью, проработку и реализацию — все этапы будут видны здесь.</small></div>`;
  } else if (!filtered.length) {
    content.innerHTML = `<div class="customer-request-state"><i data-lucide="search-x"></i><strong>Запросы не найдены</strong><span>Измените поиск или фильтр этапов.</span><button class="btn btn-secondary btn-sm" id="clear-request-filters">Сбросить фильтры</button></div>`;
    document.getElementById('clear-request-filters')?.addEventListener('click', () => { document.getElementById('customer-request-search').value = ''; document.querySelectorAll('[data-stat-filter]').forEach(button => button.classList.toggle('active', button.dataset.statFilter === '')); renderRequestList(); });
  } else {
    content.innerHTML = `<div class="customer-request-cards" aria-label="Список моих запросов">${filtered.map(renderRequestCard).join('')}</div>`;
  }
  if (window.lucide) window.lucide.createIcons();
}

function renderRequestCard(item) {
  const stage = getStage(item), actionable = stage.group === 'action';
  const tag = item.legacy_task ? 'article' : 'a';
  const href = item.legacy_task ? '' : ` href="#/customer/request/${escapeHtml(item.id)}"`;
  const actionLabel = actionable ? (item.status === 'returned' ? 'Уточнить запрос' : 'Посмотреть решение') : 'Открыть запрос';
  const contextLabel = actionable ? 'Требуется ваше действие' : item.status === 'rejected' ? 'Решение по запросу' : stage.group === 'done' ? 'Результат' : stage.group === 'closed' ? 'Статус запроса' : 'Следующий шаг';
  const itemLabel = item.legacy_task ? `Задача ${formatTaskPublicId({ id: item.task_id, public_id: item.task_public_id })} · из бэклога` : `Запрос #${escapeHtml(item.id)}`;
  const owner = customerCardOwner(item, stage), deadline = reliableDeadline(item), progress = taskProgress(item);
  const decision = ['returned', 'rejected'].includes(item.status) && item.reject_reason ? `<div class="request-card-decision ${item.status === 'rejected' ? 'is-danger' : ''}"><i data-lucide="${item.status === 'rejected' ? 'circle-x' : 'message-circle-warning'}"></i><span>${escapeHtml(item.reject_reason)}</span></div>` : '';
  return `<${tag}${href} class="customer-request-card customer-role-card${actionable ? ' needs-action' : ''}"><div class="customer-request-card-main"><div class="customer-request-card-heading"><div><span class="customer-request-card-id">${itemLabel}</span><h3>${escapeHtml(item.title || 'Без названия')}</h3></div><span class="badge ${stage.badge}">${stage.label}</span></div><div class="customer-request-card-meta"><span title="Сейчас отвечает"><i data-lucide="user-round-check"></i>${escapeHtml(owner)}</span><span title="Последнее значимое обновление: ${escapeHtml(formatDate(item.updated_at || item.created_at))}"><i data-lucide="history"></i>${escapeHtml(customerEventLabel(item, stage))} · ${escapeHtml(formatRelativeDate(item.updated_at || item.created_at))}</span>${deadline ? `<span title="Подтверждённый ожидаемый срок"><i data-lucide="calendar-clock"></i>${escapeHtml(deadline)}</span>` : ''}</div>${progress}</div><div class="customer-request-card-next"><span>${contextLabel}</span><strong>${escapeHtml(nextStepText(item, stage))}</strong>${decision}${item.legacy_task ? '<small>Подробности доступны в бэклоге</small>' : `<small>${actionLabel} <i data-lucide="arrow-right"></i></small>`}</div></${tag}>`;
}

function customerCardOwner(item, stage) {
  if (item.status === 'returned') return 'Вы';
  if (stage.group === 'review') return item.reviewer_name || item.team_name || 'Продуктовая команда';
  if (item.task_id || stage.group === 'work') return item.assignee_name || item.team_name || 'Команда проработки';
  if (stage.group === 'done' || stage.group === 'closed') return 'Этап завершён';
  return item.team_name || 'Ответственный назначается';
}

function customerEventLabel(item, stage) {
  if (item.status === 'returned') return 'Запрошено уточнение';
  if (item.status === 'rejected') return 'Принято решение';
  if (stage.group === 'done') return 'Работа завершена';
  if (item.task_id) return 'Обновлена реализация';
  if (item.status === 'in_review') return 'Начато ревью';
  if (item.status === 'submitted') return 'Отправлен на ревью';
  return 'Запрос обновлён';
}

function reliableDeadline(item) {
  const value = item.sla_deadline || item.expected_at || item.expected_date || item.task_deadline;
  return value ? formatDate(value, false) : '';
}

function taskProgress(item) {
  if (!item.task_id || !Number.isFinite(Number(item.task_progress))) return '';
  const progress = Math.max(0, Math.min(100, Number(item.task_progress)));
  return `<div class="request-card-progress" aria-label="Прогресс связанной задачи: ${progress}%"><span><i data-lucide="workflow"></i>Задача ${escapeHtml(formatTaskPublicId({ id: item.task_id, public_id: item.task_public_id }))}</span><div role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div><strong>${progress}%</strong></div>`;
}

function nextStepText(item, stage) {
  if (item.status === 'returned') return item.reject_reason || 'Откройте запрос и уточните формулировки';
  if (item.status === 'rejected') return item.reject_reason || 'Откройте запрос, чтобы узнать причину';
  if (stage.group === 'review') return item.reviewer_name ? `Запрос рассматривает ${item.reviewer_name}` : 'Команда рассматривает запрос';
  if (item.task_id) return item.assignee_name ? `Запрос прорабатывает ${item.assignee_name}` : 'Запрос передан команде';
  if (stage.group === 'done') return 'Работа по запросу завершена';
  return 'Запрос находится в обработке';
}

export async function renderRequestPage(app, requestId) {
  try {
    const req = await app.api.get(`/agent/requests/${requestId}`), stage = getStage(req), draft = req.draft || {};
    const hasPassport = hasStructuredDraft(draft);
    const requirementContent = hasPassport
      ? `${renderRequirementSections(draft)}${req.status === 'returned' ? renderCustomerClarifications(draft) : ''}`
      : `<section class="card"><div class="card-header"><h2 class="card-title">Суть запроса</h2></div><div class="card-body"><div class="request-detail">${renderRequestDescription(req.description)}</div></div></section>`;
    const structuredContent = `${requirementContent}${renderRequestHistory(req)}${hasPassport ? renderCustomerAssistantDetails(draft) : ''}`;
    return `<div class="page-header customer-request-detail-header review-detail-header animate-fade-in"><a href="#/customer" class="customer-back-link"><i data-lucide="arrow-left"></i>Мои запросы</a><div class="review-title-line"><h1>${escapeHtml(req.title || 'Без названия')}</h1>${renderRequestStatusBadge(req)}</div><p>#${req.id} · обновлён ${escapeHtml(formatDate(req.updated_at || req.created_at))}</p></div>
    ${renderRequestJourney(req)}
    ${renderRequestSummary(req)}
    ${req.reject_reason ? `<section class="customer-request-decision customer-specialist-message ${req.status === 'returned' ? 'is-returned' : 'is-rejected'}"><i data-lucide="${req.status === 'returned' ? 'message-circle-warning' : 'x-circle'}"></i><div><span class="customer-specialist-meta">${escapeHtml(req.reviewer_name || 'Специалист команды')} · ${escapeHtml(formatDate(req.updated_at))}</span><strong>${req.status === 'returned' ? 'Что нужно уточнить' : 'Решение по запросу'}</strong><p>${escapeHtml(req.reject_reason)}</p></div></section>` : ''}
    <div class="customer-request-detail-layout"><main class="customer-request-detail-main">${structuredContent}</main><aside class="customer-request-detail-aside"><section class="card customer-next-step-card"><div class="card-header"><h2 class="card-title">Следующий шаг</h2></div><div class="card-body customer-request-stage"><p>${escapeHtml(customerStageDescription(req, stage))}</p>${req.status === 'returned' ? '<button class="btn btn-primary" id="resume-request"><i data-lucide="bot"></i>Уточнить с ИИ-ассистентом</button>' : ''}</div></section>${renderLinkedTask(req)}${renderRequestParticipants(req)}</aside></div>`;
  } catch (error) {
    return `<div class="customer-request-state is-error"><i data-lucide="circle-alert"></i><strong>Запрос не найден</strong><span>${escapeHtml(error.message)}</span><a href="#/customer" class="btn btn-secondary">Вернуться к запросам</a></div>`;
  }
}

function customerStageDescription(req, stage) {
  if (req.status === 'returned') return 'Ознакомьтесь с комментарием специалиста и дополните запрос в диалоге с ассистентом.';
  if (req.status === 'rejected') return 'Рассмотрение завершено. Решение специалиста показано над содержанием запроса.';
  return nextStepText(req, stage);
}

function renderLinkedTask(req) {
  if (!req.task_id) return '';
  const progress = Number.isFinite(Number(req.task_progress)) ? `${Math.max(0, Math.min(100, Number(req.task_progress)))}%` : '—';
  return `<section class="card customer-linked-task"><div class="card-header"><div><h2 class="card-title">Реализация</h2><p class="review-card-subtitle">Связанная задача команды</p></div></div><div class="card-body"><div><span>Задача</span><strong>${formatTaskPublicId({ id: req.task_id, public_id: req.task_public_id })}</strong></div><div><span>Статус</span><strong>${escapeHtml(req.task_status || 'В работе')}</strong></div><div><span>Прогресс</span><strong>${escapeHtml(progress)}</strong></div>${req.task_deadline ? `<div><span>Срок</span><strong>${escapeHtml(req.task_deadline)}</strong></div>` : ''}</div></section>`;
}

export function initRequestPage(app, requestId) {
  document.getElementById('resume-request')?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true; button.innerHTML = '<span class="spinner"></span>Открываем диалог…';
    try { await app.api.post(`/agent/requests/${requestId}/resume`, {}); window.location.hash = '#/customer/create'; }
    catch (error) { button.disabled = false; button.textContent = 'Уточнить с ИИ-ассистентом'; window.toast?.(`Не удалось открыть диалог: ${error.message}`, 'error'); }
  });
}

function renderRequestDescription(description) { if (!description) return '<span class="text-muted">Описание пока не заполнено</span>'; return String(description).split('\n').filter(Boolean).map(line => { const match = line.trim().match(/^\*\*(.+?):\*\*(.*)$/); if (match) return `<div class="request-detail-row"><span class="request-detail-key">${escapeHtml(match[1].trim())}</span><span class="request-detail-val">${escapeHtml(match[2].trim())}</span></div>`; if (line.trim().startsWith('- ')) return `<div class="request-detail-list"><span>•</span><span>${escapeHtml(line.trim().slice(2))}</span></div>`; return `<div class="request-detail-text">${escapeHtml(line.trim())}</div>`; }).join(''); }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value == null ? '' : String(value); return div.innerHTML; }
function formatDate(iso) { if (!iso) return '—'; const date = new Date(iso); return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }); }
function formatRelativeDate(iso) { if (!iso) return 'недавно'; const diff = Date.now() - new Date(iso).getTime(), minutes = Math.max(0, Math.round(diff / 60000)); if (minutes < 1) return 'только что'; if (minutes < 60) return `${minutes} мин. назад`; const hours = Math.round(minutes / 60); if (hours < 24) return `${hours} ч. назад`; const days = Math.round(hours / 24); return days < 14 ? `${days} дн. назад` : formatDate(iso); }
