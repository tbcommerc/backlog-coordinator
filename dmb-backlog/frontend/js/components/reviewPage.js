console.log('[DMB] reviewPage.js loaded');

import { renderRequirementReviews, initRequirementReviews } from './requirementReviews.js?v=4';

import {
  getSignalTarget,
  getRequestStage,
  hasStructuredDraft,
  humanizeSignal,
  numericScore,
  renderLatestRevisionDiff,
  renderLegacyRequestDescription,
  renderRequestHistory,
  renderRequestJourney,
  renderRequestParticipants,
  renderRequestStatusBadge,
  renderRequestSummary,
  renderRequirementSections,
  signalCount,
  signalGroups,
} from './requestPresentation.js';

const INTENTS = {
  feature: 'Новая возможность', change: 'Изменение', problem: 'Проблема',
  incident: 'Инцидент', clarification: 'Уточнение',
};
const REVIEW_QUEUE_STATE_KEY = 'dmb.review.queue.v2';
const REVIEW_FEEDBACK_KEY = 'dmb.review.feedback.v1';
const REVIEW_DRAFT_KEY_PREFIX = 'dmb.review.action-draft.v1';
const DEFAULT_QUEUE_STATE = Object.freeze({ search: '', mode: 'action', status: 'any', signals: false, aged: false, sort: 'stage_oldest', scrollTop: 0 });
const MODES = new Set(['action', 'active', 'history', 'my_review', 'my_work', 'all']);
const STATUSES = new Set(['any', 'submitted', 'in_review', 'returned', 'in_progress', 'approved', 'rejected', 'completed', 'not_relevant', 'task_rejected', 'task_deleted']);
const SORTS = new Set(['stage_oldest', 'newest', 'signals', 'quality']);
const REVIEW_PAGE_SIZE = 250;

let reviewRows = [];
let reviewCurrentUser = null;
let reviewApp = null;
let reviewAssignPending = false;
let reviewLoadState = 'idle';
let reviewLoadError = '';
let reviewSearchTimer = null;
let reviewHasMore = false;

export function renderReviewPage() {
  const requirements = new URLSearchParams(globalThis.window?.location?.hash?.split('?')[1] || '').get('tab') === 'requirements';
  const subjects = `<nav class="review-subject-tabs" aria-label="Предмет ревью"><a class="btn ${requirements ? 'btn-secondary' : 'btn-primary'}" href="#/review" ${requirements ? '' : 'aria-current="page"'}>Запросы пользователей</a><a class="btn ${requirements ? 'btn-primary' : 'btn-secondary'}" href="#/review?tab=requirements" ${requirements ? 'aria-current="page"' : ''}>Редакции БТ</a></nav>`;
  if (requirements) return subjects + renderRequirementReviews();
  return `${subjects}<div class="review-queue-card request-list-panel animate-fade-in" id="review-queue-card">
    <div class="customer-request-toolbar review-request-toolbar">
      <div class="toolbar-title-row request-list-title-row">
        <div class="toolbar-title-wrap"><h1 class="toolbar-title" id="review-list-title">Ревью запросов</h1><p class="toolbar-subtitle">Найдите запросы, требующие решения, и безопасно передайте их в проработку</p></div>
        <div class="request-list-title-meta"><span class="text-secondary" id="review-count" role="status" aria-live="polite">Загрузка…</span></div>
      </div>
      <div class="filter-panel customer-request-filter-panel"><div class="filter-toolbar-row customer-request-controls">
        <label class="relative filter-search-wrap customer-request-search"><span class="sr-only">Поиск</span><i data-lucide="search"></i><input class="input ui-control" id="review-search" type="search" placeholder="Номер, название, автор или команда" aria-label="Поиск по номеру, названию, автору, команде или ответственному"></label>
        <div class="customer-request-main-filters review-filter-grid">
          <label><span>Режим работы</span><select id="review-mode-filter" class="input"><option value="action">Требуют моего действия</option><option value="active">Все активные</option><option value="history">История решений</option><option value="my_review">Моё ревью</option><option value="my_work">Моя проработка</option><option value="all">Все доступные</option></select></label>
          <label><span>Стадия</span><select id="review-status-filter" class="input"><option value="any">Любая стадия</option><option value="submitted">Ожидает ревью</option><option value="in_review">На ревью</option><option value="returned">Ожидает уточнения</option><option value="in_progress">В проработке</option><option value="completed">Выполнен</option><option value="not_relevant">Не актуален</option><option value="task_rejected">Задача отклонена</option><option value="task_deleted">Задача удалена</option><option value="approved">Проработка завершена</option><option value="rejected">Отклонён</option></select></label>
          <label><span>Порядок</span><select id="review-sort" class="input"><option value="stage_oldest">Дольше на текущем этапе</option><option value="signals">Больше замечаний</option><option value="quality">Низкое качество</option><option value="newest">Недавно обновлённые</option></select></label>
          <label class="review-signals-toggle"><input id="review-signals-only" type="checkbox">Только с замечаниями</label>
        </div>
      </div></div>
      <div class="customer-request-quick-filters review-request-quick-filters" id="review-summary" aria-label="Быстрые фильтры">
        ${quickFilter('status', 'submitted', 'inbox', 'Новые', 'review-new-count')}
        ${quickFilter('mode', 'my_review', 'user-check', 'Моё ревью', 'review-mine-count')}
        ${quickFilter('mode', 'action', 'user-x', 'Требуют действия', 'review-action-count')}
        ${quickFilter('aged', 'true', 'clock-3', 'Долго на этапе', 'review-aged-count')}
        ${quickFilter('signals', 'true', 'alert-circle', 'С замечаниями', 'review-risk-count')}
      </div>
    </div>
    <div class="review-table-body review-list-scroll" id="review-list-content" tabindex="0" aria-label="Список запросов на ревью. Область прокручивается">${renderListLoading()}</div>
  </div>`;
}

export async function initReviewPage(app) {
  if (document.getElementById('requirement-reviews')) return initRequirementReviews(app);
  reviewApp = app;
  reviewCurrentUser = app.store.get('currentUser') || null;
  restoreQueueControls();
  document.getElementById('review-search')?.addEventListener('input', () => { window.clearTimeout(reviewSearchTimer); reviewSearchTimer = window.setTimeout(() => handleQueueControlsChange(true), 180); });
  document.getElementById('review-mode-filter')?.addEventListener('change', () => handleQueueControlsChange(true));
  document.getElementById('review-status-filter')?.addEventListener('change', () => handleQueueControlsChange(true));
  document.getElementById('review-sort')?.addEventListener('change', () => handleQueueControlsChange(true));
  document.getElementById('review-signals-only')?.addEventListener('change', () => handleQueueControlsChange(true));
  document.querySelectorAll('[data-review-filter]').forEach(button => button.addEventListener('click', () => {
    applyQuickFilter(button.dataset.reviewKind, button.dataset.reviewFilter);
    handleQueueControlsChange(true);
    document.getElementById('review-queue-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  const content = document.getElementById('review-list-content');
  content?.addEventListener('scroll', () => saveQueueState({ scrollTop: content.scrollTop }));
  content?.addEventListener('click', event => {
    if (event.target.closest('.review-request-card')) saveQueueState({ scrollTop: content.scrollTop });
  });
  await loadReviewQueue(app);
}

async function loadReviewQueue(app, { append = false } = {}) {
  const content = document.getElementById('review-list-content');
  if (!content) return;
  const offset = append ? reviewRows.length : 0;
  reviewLoadState = append ? 'loading_more' : 'loading';
  if (!append) {
    content.innerHTML = renderListLoading();
    setText('review-count', 'Загрузка…');
  } else {
    renderReviewList();
  }
  try {
    const data = await app.api.get(`/agent/requests/review?limit=${REVIEW_PAGE_SIZE}&offset=${offset}`);
    const batch = Array.isArray(data) ? data : [];
    reviewRows = append
      ? [...new Map([...reviewRows, ...batch].map(request => [String(request.id), request])).values()]
      : batch;
    reviewHasMore = batch.length === REVIEW_PAGE_SIZE;
    reviewLoadState = 'ready';
    reviewLoadError = '';
    updateSummary();
    renderReviewList();
  } catch (error) {
    reviewLoadState = reviewRows.length ? 'stale' : 'error';
    reviewLoadError = errorMessage(error, 'Повторите попытку позже');
    renderReviewList();
    document.getElementById('retry-review-list')?.addEventListener('click', () => loadReviewQueue(app));
    window.lucide?.createIcons();
  }
}

function renderListLoading() { return '<div class="customer-request-loading content-loading-state" role="status"><span class="spinner"></span><span>Загружаем запросы…</span></div>'; }
function quickFilter(kind, value, icon, label, countId) { return `<button type="button" class="quick-filter-btn" data-review-kind="${kind}" data-review-filter="${value}" aria-pressed="false"><span class="quick-filter-icon"><i data-lucide="${icon}"></i></span><span class="quick-filter-info"><span class="quick-filter-label">${label}</span><strong class="quick-filter-count" id="${countId}">—</strong></span></button>`; }

function updateSummary() {
  document.getElementById('review-summary')?.toggleAttribute('hidden', reviewRows.length === 0);
  setText('review-new-count', reviewRows.filter(request => request.status === 'submitted').length);
  setText('review-mine-count', reviewRows.filter(request => Number(request.reviewer_id) === Number(reviewCurrentUser?.id)).length);
  setText('review-action-count', reviewRows.filter(request => availableActions(request).length).length);
  setText('review-aged-count', reviewRows.filter(isLongWaiting).length);
  setText('review-risk-count', reviewRows.filter(request => signalCount(request.draft) > 0).length);
}

function handleQueueControlsChange(resetScroll) {
  saveQueueState({ scrollTop: resetScroll ? 0 : currentQueueScroll() });
  renderReviewList();
}

function renderReviewList() {
  const content = document.getElementById('review-list-content');
  if (!content) return;
  if (reviewLoadState === 'error') {
    content.innerHTML = `<div class="customer-request-state is-error" role="alert"><i data-lucide="cloud-off"></i><strong>Не удалось загрузить запросы</strong><span>${esc(reviewLoadError)}</span><button type="button" class="btn btn-secondary btn-sm" id="retry-review-list"><i data-lucide="refresh-cw"></i>Повторить</button></div>`;
    document.getElementById('retry-review-list')?.addEventListener('click', () => reviewApp && loadReviewQueue(reviewApp));
    window.lucide?.createIcons();
    return;
  }
  const state = queueStateFromControls();
  const rows = filteredReviewRows(state);
  document.querySelectorAll('[data-review-filter]').forEach(button => {
    const active = quickFilterActive(button.dataset.reviewKind, button.dataset.reviewFilter, state);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const trulyEmpty = reviewRows.length === 0;
  document.getElementById('review-queue-card')?.classList.toggle('is-empty', trulyEmpty);
  setText('review-count', `Показано ${rows.length} · загружено ${reviewRows.length}${reviewHasMore ? ' · есть ещё' : ''}`);
  if (!rows.length) {
    content.innerHTML = trulyEmpty
      ? '<div class="customer-request-state"><div class="customer-request-state-icon review-empty-icon"><i data-lucide="check"></i></div><strong>Очередь пуста</strong><span>Новые требования появятся здесь после отправки из диалога с ИИ-ассистентом.</span></div>'
      : '<div class="customer-request-state"><i data-lucide="search-x"></i><strong>Ничего не найдено</strong><span>Измените запрос или вернитесь к очереди, требующей действий.</span><button type="button" class="btn btn-secondary btn-sm" id="clear-review-filters">Сбросить фильтры</button></div>';
    document.getElementById('clear-review-filters')?.addEventListener('click', () => { setQueueControls(DEFAULT_QUEUE_STATE); saveQueueState(DEFAULT_QUEUE_STATE); renderReviewList(); });
    window.lucide?.createIcons();
    return;
  }
  const stale = reviewLoadState === 'stale' ? `<div class="review-stale-warning" role="alert"><i data-lucide="cloud-off"></i><span><strong>Показаны ранее загруженные данные.</strong> ${esc(reviewLoadError)}</span><button type="button" class="btn btn-secondary btn-sm" id="retry-review-list">Повторить</button></div>` : '';
  const more = reviewHasMore || reviewLoadState === 'loading_more'
    ? `<div class="review-load-more"><button type="button" class="btn btn-secondary" id="load-more-review" ${reviewLoadState === 'loading_more' ? 'disabled aria-busy="true"' : ''}>${reviewLoadState === 'loading_more' ? '<span class="spinner"></span>Загружаем…' : 'Загрузить ещё'}</button></div>`
    : '';
  content.innerHTML = `${stale}<div class="customer-request-cards review-request-cards" aria-label="Список запросов на ревью">${rows.map(renderReviewCard).join('')}</div>${more}`;
  document.getElementById('retry-review-list')?.addEventListener('click', () => reviewApp && loadReviewQueue(reviewApp));
  document.getElementById('load-more-review')?.addEventListener('click', () => reviewApp && loadReviewQueue(reviewApp, { append: true }));
  window.lucide?.createIcons();
  const saved = readQueueState();
  window.requestAnimationFrame(() => { if (content.isConnected) content.scrollTop = saved.scrollTop; });
}

function filteredReviewRows(state = readQueueState(), sourceRows = reviewRows) {
  const query = state.search.trim().toLocaleLowerCase('ru');
  const matchesFilter = request => {
    const modeMatch = state.mode === 'all'
      || (state.mode === 'action' && availableActions(request).length > 0)
      || (state.mode === 'active' && !['done', 'closed'].includes(getRequestStage(request).group))
      || (state.mode === 'history' && ['done', 'closed'].includes(getRequestStage(request).group))
      || (state.mode === 'my_review' && Number(request.reviewer_id) === Number(reviewCurrentUser?.id))
      || (state.mode === 'my_work' && Number(request.assignee_id) === Number(reviewCurrentUser?.id));
    return modeMatch && (state.status === 'any' || request.status === state.status) && (!state.signals || signalCount(request.draft) > 0) && (!state.aged || isLongWaiting(request));
  };
  const rows = sourceRows.filter(request => {
    const searchable = [request.id, `#${request.id}`, `запрос #${request.id}`, request.title, request.author_name, request.team_name, request.reviewer_name, request.assignee_name];
    return (!query || searchable.some(value => String(value || '').toLocaleLowerCase('ru').includes(query))) && matchesFilter(request);
  });
  rows.sort((a, b) => compareReviewRows(a, b, state.sort));
  return rows;
}

function compareReviewRows(a, b, sort) {
  if (sort === 'signals') return signalCount(b.draft) - signalCount(a.draft) || stageTime(a) - stageTime(b);
  if (sort === 'quality') return nullableScoreForSort(qualityScore(a)) - nullableScoreForSort(qualityScore(b)) || stageTime(a) - stageTime(b);
  if (sort === 'newest') return time(b.updated_at || b.created_at) - time(a.updated_at || a.created_at);
  return stageTime(a) - stageTime(b);
}

function renderReviewCard(request) {
  const draft = request.draft || {};
  const groups = signalGroups(draft);
  const issues = signalCount(draft);
  const aged = isLongWaiting(request);
  const unassigned = isUnassigned(request);
  const regulated = toCardList(draft.regulatory_flags).length > 0;
  const priority = [request.status === 'submitted' ? 'is-new' : '', issues >= 3 || regulated ? 'has-many-signals' : '', unassigned ? 'is-unassigned' : '', aged ? 'is-aged' : ''].filter(Boolean).join(' ');
  const owner = request.status === 'in_progress' ? request.assignee_name || request.team_name || 'Не назначен' : request.reviewer_name || 'Не взят в работу';
  const product = [draft.product, draft.module].filter(Boolean).map(value => esc(value)).join(' · ');
  const timing = stageAgeText(request);
  const tags = `${draft.priority ? `<span class="request-priority-chip"><i data-lucide="flag"></i>${esc(draft.priority)}</span>` : ''}${product ? `<span class="review-card-secondary"><i data-lucide="boxes"></i>${product}</span>` : ''}${regulated ? '<span class="is-regulated"><i data-lucide="shield-alert"></i>Регуляторные требования</span>' : ''}`;
  const reason = issues ? `${issues} ${plural(issues, 'замечание', 'замечания', 'замечаний')}: ${groups.slice(0, 2).map(([label]) => label.toLocaleLowerCase('ru')).join(', ')}` : cardAction(request);
  return `<article class="customer-request-card review-request-card ${priority}"><div class="customer-request-card-main"><div class="customer-request-card-heading"><div><span class="customer-request-card-id">Запрос #${esc(request.id)}</span><h3><a class="review-request-card-link" href="#/review/${esc(request.id)}" aria-label="Запрос #${esc(request.id)}: ${esc(request.title || 'Без названия')} — открыть">${esc(request.title || 'Без названия')}</a></h3></div>${renderRequestStatusBadge(request)}</div>${tags ? `<div class="review-card-tags">${tags}</div>` : ''}<p class="review-card-reason">${esc(reason)}</p><div class="customer-request-card-meta"><span><i data-lucide="user"></i>${esc(request.author_name || 'Автор не указан')} · ${esc(request.team_name || 'Без команды')}</span><span class="${unassigned ? 'is-attention' : ''}"><i data-lucide="user-check"></i>${esc(owner)}</span><span class="${aged ? 'is-attention' : ''}" title="Текущий этап начат ${date(request.stage_started_at || request.updated_at || request.created_at)}"><i data-lucide="clock-3"></i>${esc(timing)}</span></div></div><div class="customer-request-card-next review-request-card-next"><span>Следующее действие</span><strong class="review-card-action">${esc(cardAction(request))}</strong><a class="review-card-open" href="#/review/${esc(request.id)}">Открыть <i data-lucide="arrow-right"></i></a></div></article>`;
}

export async function renderReviewDetailPage(app, requestId) {
  let request;
  try { request = await app.api.get(`/agent/requests/${requestId}`); }
  catch (error) { return `<div class="customer-request-state is-error review-detail-error" role="alert"><i data-lucide="cloud-off"></i><h1>Не удалось загрузить запрос</h1><span>${esc(errorMessage(error, 'Повторите попытку позже'))}</span><div class="review-state-actions"><button type="button" class="btn btn-primary btn-sm" id="retry-review-detail"><i data-lucide="refresh-cw"></i>Повторить</button><a href="#/review" class="btn btn-secondary btn-sm">К очереди</a></div></div>`; }
  const linkedRevisionNumber = Number(new URLSearchParams(window.location.hash.split('?')[1] || '').get('revision'));
  const linkedRevision = Number.isInteger(linkedRevisionNumber) && linkedRevisionNumber > 0 ? (request.revision_history || []).find(item => Number(item.revision) === linkedRevisionNumber) : null;
  const draft = linkedRevision?.draft || request.draft || {};
  const actions = linkedRevision ? [] : availableActions(request);
  const quality = numericScore(draft.quality_score);
  const completeness = numericScore(draft.completeness_score);
  const hasPassport = hasStructuredDraft(draft);
  const requirementContent = `${renderLegacyRequestDescription(linkedRevision?.description || request.description, { supplemental: hasPassport })}${hasPassport ? renderRequirementSections(draft) : ''}`;
  const feedback = takeActionFeedback(request.id);
  const revisionLabel = linkedRevision?.revision || latestRevision(request);
  const v2 = app.features?.agent_v2;
  const workspaceEntry = !linkedRevision && v2?.enabled && v2?.pilot_allowed && v2?.operator_role ? `<a class="btn btn-secondary" href="#/agent-v2?object_type=request&object_id=${encodeURIComponent(request.id)}">Проработать БТ в Агенте V2</a>` : '';
  const snapshotNotice = linkedRevision ? `<section class="review-snapshot-notice" role="status"><i data-lucide="archive"></i><div><strong>Снимок принятой редакции ${esc(revisionLabel)}</strong><span>Содержимое зафиксировано и открыто только для чтения. <a href="#/review/${esc(request.id)}">Перейти к актуальной карточке</a></span></div></section>` : '';
  return `${feedback ? renderActionFeedback(feedback) : ''}<div class="page-header review-detail-header"><a href="#/review" class="review-back"><i data-lucide="arrow-left"></i>Очередь ревью</a><div class="review-title-line"><h1>${esc(linkedRevision?.title || request.title)}</h1>${renderRequestStatusBadge(request)}</div><p>#${request.id} · редакция ${esc(revisionLabel)} · ${esc(request.author_name || 'Автор не указан')} · ${esc(request.team_name || 'Без команды')} · ${date(linkedRevision?.created_at || request.created_at)}</p></div>${snapshotNotice}${workspaceEntry}${renderRequestJourney(request)}${renderRequestSummary(request)}${request.reject_reason ? `<section class="review-return-note${request.status === 'rejected' ? ' is-rejected' : ''}"><i data-lucide="${request.status === 'rejected' ? 'x-circle' : 'message-circle-warning'}"></i><div><strong>${request.status === 'rejected' ? 'Причина отклонения' : 'Комментарий к уточнению'}</strong><span>${esc(request.reject_reason)}</span></div></section>` : ''}<div class="review-detail-layout"><main class="review-detail-main">${renderReviewOutline(draft)}${linkedRevision ? '' : renderLatestRevisionDiff(request)}${renderAttentionPanel(draft)}${requirementContent}${renderRequestHistory(request)}<details class="card review-more review-ai-assessment"><summary>Оценка подготовки запроса <span>Справочные сигналы ИИ</span><i data-lucide="chevron-down"></i></summary><div class="card-body"><div class="review-metrics">${metric('Полнота', completeness, 'Насколько заполнены обязательные разделы требования', draft.completeness_assessed_at || draft.assessed_at)}${metric('Качество', quality, 'Насколько формулировки конкретны, непротиворечивы и проверяемы', draft.quality_assessed_at || draft.assessed_at)}<div><span>Уверенность ИИ</span><strong>${confidence(draft.confidence)}</strong><small>Надёжность автоматической интерпретации</small></div><div><span>Тип обращения</span><strong>${esc(INTENTS[draft.intent] || draft.intent || 'Не определён')}</strong><small>Определён ассистентом по содержанию</small></div></div><p class="review-score-help"><i data-lucide="info"></i><span><strong>75–100%</strong> — высокая оценка, <strong>50–74%</strong> — требуется проверка, <strong>до 49%</strong> — существенные пробелы. Проценты помогают при ревью, но не заменяют решение специалиста.</span></p></div></details></main><aside class="review-detail-aside">${linkedRevision ? '' : `<section class="card review-decision-card"><div class="card-header"><h2 class="card-title">Следующий шаг</h2></div><div class="card-body">${nextStep(request, actions)}</div></section>`}${renderRequestParticipants(request)}</aside></div>`;
}

export async function initReviewDetailPage(app, requestId) {
  const fulfillmentRoot = document.createElement('section'); fulfillmentRoot.className='card';
  document.querySelector('.review-detail-aside')?.append(fulfillmentRoot);
  import('./workResolution.js?v=2').then(m=>m.mountFulfillment(fulfillmentRoot,app,requestId,true));

  document.getElementById('retry-review-detail')?.addEventListener('click', () => app.router.refreshCurrentRoute());
  document.getElementById('dismiss-review-feedback')?.addEventListener('click', event => event.currentTarget.closest('.review-action-feedback')?.remove());
  document.getElementById('btn-claim')?.addEventListener('click', event => runDirectStatusAction(app, event.currentTarget, requestId, { status: 'in_review', version: buttonVersion(event) }, 'Запрос взят на ревью'));
  document.getElementById('btn-approve')?.addEventListener('click', event => assignModal(app, requestId, buttonVersion(event)));
  document.getElementById('btn-return')?.addEventListener('click', event => reasonModal(app, requestId, 'returned', buttonVersion(event)));
  document.getElementById('btn-reject')?.addEventListener('click', event => reasonModal(app, requestId, 'rejected', buttonVersion(event)));
  document.getElementById('btn-release')?.addEventListener('click', event => releaseModal(app, requestId, buttonVersion(event)));
  document.getElementById('btn-reroute')?.addEventListener('click', event => rerouteModal(app, requestId, buttonVersion(event)));
  const note = document.getElementById('review-working-note');
  if (note) { try { note.value = sessionStorage.getItem(workingNoteKey(requestId, note.dataset.requestVersion)) || ''; } catch (_) { /* ignored */ } note.addEventListener('input', () => { try { note.value ? sessionStorage.setItem(workingNoteKey(requestId, note.dataset.requestVersion), note.value) : sessionStorage.removeItem(workingNoteKey(requestId, note.dataset.requestVersion)); } catch (_) { /* ignored */ } }); }
  document.querySelectorAll('[data-request-target]').forEach(control => control.addEventListener('click', () => focusRequestSection(control.dataset.requestTarget)));
  window.lucide?.createIcons();
}

function renderReviewOutline(draft = {}) {
  const links = [['Проблема', 'problem_statement'], ['AS-IS', 'current_process'], ['TO-BE', 'target_process'], ['Ценность', 'business_value'], ['Пользователи', 'user_roles'], ['Критерии', 'acceptance_criteria'], ['Сценарии', 'scenarios'], ['Правила', 'business_rules'], ['Интеграции', 'data_integrations'], ['Зависимости', 'dependencies'], ['Риски', 'risks'], ['Регуляторика', 'regulatory_flags']]
    .filter(([, key]) => toCardList(draft[key]).length || signalGroups(draft).some(([, values]) => values.some(value => getSignalTarget(value) === getSignalTarget({ section_key: key })))).map(([label, key]) => [label, getSignalTarget({ section_key: key })]);
  return `<nav class="review-section-nav" aria-label="Разделы паспорта"><span>Перейти к разделу</span>${links.map(([label, target]) => `<button class="btn btn-secondary btn-sm ui-btn" type="button" data-request-target="${target}">${label}</button>`).join('')}</nav>`;
}

function nextStep(request, actions) {
  if (request.status === 'returned') return '<div class="review-next-copy"><i data-lucide="message-circle-warning"></i><div><strong>Ожидаем уточнения заказчика</strong><span>Повторное ревью станет доступно после отправки новой редакции. Комментарий возврата сохранён в истории.</span></div></div>';
  if (request.status === 'approved') return '<div class="review-next-copy is-done"><i data-lucide="circle-check"></i><div><strong>Проработка завершена</strong><span>Решение зафиксировано в истории запроса.</span></div></div>';
  if (request.status === 'rejected') return '<div class="review-next-copy is-done"><i data-lucide="circle-x"></i><div><strong>Запрос отклонён</strong><span>Причина и решение зафиксированы в истории запроса.</span></div></div>';
  const effectiveStage = getRequestStage(request);
  if (effectiveStage.group === 'done') return `<div class="review-next-copy is-done"><i data-lucide="circle-check"></i><div><strong>${esc(effectiveStage.label)}</strong><span>Связанная задача завершена; результат доступен в карточке задачи.</span></div></div>${request.task_id ? `<a class="btn btn-secondary" href="#/backlog?task=${esc(request.task_id)}">Открыть задачу</a>` : ''}`;
  if (effectiveStage.group === 'closed') return `<div class="review-next-copy is-done"><i data-lucide="circle-x"></i><div><strong>${esc(effectiveStage.label)}</strong><span>Связанная задача закрыта; решение доступно в карточке задачи.</span></div></div>${request.task_id ? `<a class="btn btn-secondary" href="#/backlog?task=${esc(request.task_id)}">Открыть задачу</a>` : ''}`;
  const signals = signalCount(request.draft);
  const signalNote = signals ? `В запросе ${signals} ${plural(signals, 'сигнал', 'сигнала', 'сигналов')} для проверки.` : 'Ассистент не выявил открытых сигналов.';
  if (actions.includes('claim')) return `<div class="review-next-copy"><i data-lucide="search"></i><div><strong>Начните ревью</strong><span>Запрос закрепится за вами. ${signalNote}</span></div></div><button class="btn btn-primary" id="btn-claim" data-request-version="${esc(request.version ?? 0)}">Взять на ревью</button>`;
  if (actions.includes('approve')) return `<div class="review-next-copy"><i data-lucide="git-pull-request"></i><div><strong>Примите решение по редакции ${esc(latestRevision(request))}</strong><span>Передача создаст задачу, назначит бизнес-аналитика и отправит ему уведомление.</span></div></div><label class="review-working-note"><span>Рабочая заметка ревьюера</span><textarea id="review-working-note" class="input" rows="3" maxlength="2000" data-request-version="${esc(request.version ?? 0)}" placeholder="Наблюдения и вопросы — сохраняются в этом браузере"></textarea></label><button class="btn btn-success" id="btn-approve" data-request-version="${esc(request.version ?? 0)}">Передать в проработку</button><button class="btn btn-secondary" id="btn-return" data-request-version="${esc(request.version ?? 0)}">Вернуть на уточнение</button><button class="btn btn-ghost btn-sm review-reject-link" id="btn-reject" data-request-version="${esc(request.version ?? 0)}">Отклонить запрос</button><div class="review-owner-actions">${actions.includes('release') ? `<button class="btn btn-ghost btn-sm" id="btn-release" data-request-version="${esc(request.version ?? 0)}">Освободить ревью</button>` : ''}${actions.includes('reroute') ? `<button class="btn btn-ghost btn-sm" id="btn-reroute" data-request-version="${esc(request.version ?? 0)}">Перенаправить</button>` : ''}</div>`;
  if (request.status === 'in_review' && request.reviewer_name) return `<div class="review-next-copy"><i data-lucide="lock-keyhole"></i><div><strong>Ревью ведёт ${esc(request.reviewer_name)}</strong><span>Решения доступны только закреплённому рецензенту. Обновите данные, если заявка была передана вам.</span></div></div><button type="button" class="btn btn-secondary" id="retry-review-detail"><i data-lucide="refresh-cw"></i>Обновить данные</button>`;
  if (request.status === 'in_progress') return `<div class="review-next-copy is-done"><i data-lucide="workflow"></i><div><strong>Передан в проработку</strong><span>Ответственный: ${esc(request.assignee_name || 'не назначен')}.${request.task_public_id ? ` Задача ${esc(request.task_public_id)} создана.` : ''}</span></div></div>${request.task_id ? `<a class="btn btn-secondary" href="#/backlog?task=${esc(request.task_id)}">Открыть задачу</a>` : ''}`;
  return `<div class="review-next-copy"><i data-lucide="clock"></i><div><strong>Ожидает следующего этапа</strong><span>${esc(getRequestStage(request).label)}</span></div></div>`;
}

function renderAttentionPanel(draft) {
  const groups = signalGroups(draft);
  if (!groups.length) return '<section class="review-ready-panel"><i data-lucide="check-circle"></i><div><strong>Ассистент не выявил открытых сигналов</strong><span>Ревьюеру всё равно нужно проверить формулировки и критерии приёмки.</span></div></section>';
  return `<section class="card review-attention-panel"><div class="card-header"><div><h2 class="card-title">Требует внимания</h2><p class="review-card-subtitle">Каждое замечание показывает важность и открывает связанный раздел паспорта</p></div><span class="review-attention-count">${groups.reduce((total, [, values]) => total + values.length, 0)}</span></div><div class="card-body">${groups.map(([label, values]) => `<div class="review-issue-group"><h3>${esc(label)}</h3><ul>${values.map(value => `<li><button type="button" class="ui-surface-action review-signal-link" data-request-target="${esc(getSignalTarget(value, label))}"><span>${esc(humanizeSignal(value))}${signalMeta(value)}</span><i data-lucide="arrow-down-right"></i></button></li>`).join('')}</ul></div>`).join('')}</div></section>`;
}

function signalMeta(value) { if (!value || typeof value !== 'object') return ''; const severity = ({ blocker: 'Блокирует', critical: 'Критично', error: 'Критично', warning: 'Важно', info: 'Справочно' })[String(value.severity || value.criticality || '').toLowerCase()] || ''; const status = ({ accepted: 'Риск принят', acknowledged: 'Рассмотрено', open: 'Открыто' })[String(value.status || '').toLowerCase()] || ''; return severity || status ? `<small>${esc([severity, status].filter(Boolean).join(' · '))}</small>` : ''; }

function focusRequestSection(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const details = target.closest('details');
  if (details) details.open = true;
  document.querySelectorAll('.request-passport-section.is-signal-target').forEach(section => section.classList.remove('is-signal-target'));
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.requestAnimationFrame(() => { target.classList.add('is-signal-target'); target.focus({ preventScroll: true }); window.setTimeout(() => target.classList.remove('is-signal-target'), 5000); });
}

async function runDirectStatusAction(app, button, id, payload, message) {
  setBusy(button, true);
  try { await updateStatus(app, id, payload, message); }
  catch (error) { renderActionError(app, error); }
  finally { if (button?.isConnected) setBusy(button, false); }
}

async function updateStatus(app, id, payload, message) {
  const result = await app.api.put(`/agent/requests/${id}/status`, payload);
  let freshRows = reviewRows;
  try {
    const data = await app.api.get('/agent/requests/review?limit=250');
    if (Array.isArray(data)) {
      reviewRows = data;
      freshRows = data;
    }
  } catch (_) { /* successful decision remains valid even if queue refresh failed */ }
  const nextId = findNextReviewId(id, freshRows);
  saveActionFeedback({ requestId: Number(id), message, status: result?.status, taskId: result?.task_id, taskPublicId: result?.task_public_id, nextId });
  window.toast?.(message, 'success');
  await app.router.refreshCurrentRoute();
  return result;
}

async function assignModal(app, id, renderedVersion) {
  if (reviewAssignPending || document.querySelector('.review-modal')) return;
  reviewAssignPending = true;
  const trigger = document.getElementById('btn-approve');
  setBusy(trigger, true);
  try {
    const request = await app.api.get('/agent/requests/' + id);
    if (Number(request.version) !== Number(renderedVersion)) {
      modal({ title: 'Запрос изменился', body: '<p>Обновите карточку и проверьте изменения перед решением.</p>', confirm: 'Обновить данные', klass: 'btn-primary', action: async () => { await app.router.refreshCurrentRoute(); return true; } });
      return;
    }
    const module = await import('./workResolution.js?v=2');
    await module.openWorkResolution(app, request, trigger);
  } catch (error) { window.toast?.(error.message, 'error'); }
  finally { reviewAssignPending = false; if (trigger?.isConnected) setBusy(trigger, false); }
}

function reasonModal(app, id, status, version) {
  const returned = status === 'returned';
  const fieldId = `review-reason-${status}`;
  const hintId = `${fieldId}-hint`;
  const consequence = returned ? 'Запрос вернётся заказчику для новой редакции и снова появится в очереди после ответа.' : 'Решение окончательно закроет этот запрос. Для продолжения потребуется новый связанный запрос.';
  const actionDraftKey = `${REVIEW_DRAFT_KEY_PREFIX}:${id}:${status}:${version}`;
  seedActionDraft(actionDraftKey, readWorkingNote(id, version));
  modal({ title: returned ? 'Вернуть на уточнение' : 'Отклонить запрос', body: `<p class="review-modal-consequence"><i data-lucide="${returned ? 'message-circle-warning' : 'circle-x'}"></i><span>${consequence}</span></p><label class="form-label" for="${fieldId}">${returned ? 'Что нужно уточнить' : 'Причина отклонения'} <span aria-hidden="true">*</span></label><textarea id="${fieldId}" class="input" rows="5" required aria-required="true" aria-describedby="${hintId}" data-review-required autofocus placeholder="${returned ? 'Укажите раздел, вопрос и ожидаемый ответ' : 'Укажите основание и, если возможно, альтернативный путь'}"></textarea><small id="${hintId}" class="review-field-hint">Комментарий сохранится в истории и будет отправлен заказчику.</small>`, confirm: returned ? 'Вернуть заказчику' : 'Отклонить запрос', klass: returned ? 'btn-primary' : 'btn-danger', draftKey: actionDraftKey, isDirty: dialog => Boolean(dialog.querySelector(`#${fieldId}`)?.value.trim()), action: async dialog => { const field = dialog.querySelector(`#${fieldId}`); const reason = field.value.trim(); if (!reason) return showFieldError(field, 'Добавьте комментарий'); await updateStatus(app, id, { status, reject_reason: reason, version }, returned ? 'Запрос возвращён на уточнение' : 'Запрос отклонён'); clearWorkingNote(id, version); return true; }, onRefresh: () => app.router.refreshCurrentRoute() });
}

function releaseModal(app, id, version) {
  modal({ title: 'Освободить ревью', body: `<p class="review-modal-consequence"><i data-lucide="unlock"></i><span>Запрос вернётся в общую очередь без потери редакции и истории.</span></p><label class="form-label" for="review-release-reason">Причина <span aria-hidden="true">*</span></label><textarea id="review-release-reason" class="input" rows="4" data-review-required autofocus placeholder="Почему ревью нужно передать другому специалисту"></textarea>`, confirm: 'Освободить', klass: 'btn-primary', draftKey: `${REVIEW_DRAFT_KEY_PREFIX}:${id}:release:${version}`, isDirty: dialog => Boolean(dialog.querySelector('#review-release-reason')?.value.trim()), action: async dialog => { const reason = dialog.querySelector('#review-release-reason').value.trim(); await updateStatus(app, id, { status: 'submitted', version, action_reason: reason }, 'Ревью освобождено'); return true; }, onRefresh: () => app.router.refreshCurrentRoute() });
}

async function rerouteModal(app, id, version) {
  if (reviewAssignPending || document.querySelector('.review-modal')) return;
  reviewAssignPending = true;
  try {
    const teams = await app.api.get('/agent/teams');
    modal({ title: 'Перенаправить запрос', body: `<p class="review-modal-consequence"><i data-lucide="route"></i><span>Запрос освободится и появится в очереди выбранной команды. Состав команды не изменяется.</span></p><label class="form-label" for="review-team-select">Новая команда</label><select id="review-team-select" class="input" data-review-required autofocus><option value="">— Выберите —</option>${teams.map(team => `<option value="${team.id}">${esc(team.name)}</option>`).join('')}</select><label class="form-label" for="review-reroute-reason">Причина</label><textarea id="review-reroute-reason" class="input" rows="4" maxlength="2000" data-review-required placeholder="Почему запрос относится к другой команде"></textarea>`, confirm: 'Перенаправить', klass: 'btn-primary', draftKey: `${REVIEW_DRAFT_KEY_PREFIX}:${id}:reroute:${version}`, isDirty: dialog => Boolean(dialog.querySelector('#review-team-select')?.value || dialog.querySelector('#review-reroute-reason')?.value.trim()), action: async dialog => { await updateStatus(app, id, { status: 'submitted', version, team_id: Number(dialog.querySelector('#review-team-select').value), action_reason: dialog.querySelector('#review-reroute-reason').value.trim() }, 'Запрос перенаправлен'); return true; }, onRefresh: () => app.router.refreshCurrentRoute() });
  } catch (error) { window.toast?.(errorMessage(error, 'Не удалось загрузить команды'), 'error'); }
  finally { reviewAssignPending = false; }
}

function modal({ title, body, confirm, klass, action, isDirty = () => false, onRefresh, draftKey = '' }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const titleId = `review-modal-title-${Date.now()}`;
  overlay.innerHTML = `<div class="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1"><div class="modal-header"><h3 id="${titleId}">${esc(title)}</h3><button type="button" class="btn btn-ghost btn-lg square-icon ui-btn modal-close" data-close aria-label="Закрыть диалог">&times;</button></div><div class="modal-body">${body}<div class="review-modal-error" role="alert" tabindex="-1" hidden></div></div><div class="modal-footer"><button type="button" class="btn btn-secondary btn-sm modal-cancel-btn" data-close>Отмена</button><button type="button" class="btn ${klass} btn-sm" id="modal-confirm">${esc(confirm)}</button></div></div>`;
  document.body.appendChild(overlay);
  const dialog = overlay.querySelector('.review-modal');
  const confirmButton = overlay.querySelector('#modal-confirm');
  const errorArea = overlay.querySelector('.review-modal-error');
  const draftFields = draftKey ? [...overlay.querySelectorAll('[data-review-required]')] : [];
  if (draftFields.length) {
    try {
      const saved = sessionStorage.getItem(draftKey) || '';
      if (saved.startsWith('{')) {
        const values = JSON.parse(saved);
        draftFields.forEach(field => { if (field.id in values) field.type === 'checkbox' ? field.checked = Boolean(values[field.id]) : field.value = values[field.id]; });
      } else if (saved) draftFields[0].value = saved;
    } catch (_) { /* storage can be disabled */ }
  }
  let discardPrompt = null;
  let isSubmitting = false;
  const clearDraft = () => { if (draftKey) try { sessionStorage.removeItem(draftKey); } catch (_) { /* storage can be disabled */ } };
  const close = () => overlay.remove();
  const requestClose = (force = false) => {
    if (!force && isDirty(dialog)) {
      if (discardPrompt) return discardPrompt.querySelector('[data-keep-editing]')?.focus();
      discardPrompt = document.createElement('div');
      discardPrompt.className = 'review-modal-discard';
      discardPrompt.setAttribute('role', 'alert');
      discardPrompt.innerHTML = '<strong>Комментарий не сохранён</strong><span>Продолжить редактирование или закрыть окно без сохранения?</span><div><button type="button" class="btn btn-secondary btn-sm" data-keep-editing>Продолжить</button><button type="button" class="btn btn-danger btn-sm" data-discard>Закрыть без сохранения</button></div>';
      overlay.querySelector('.modal-body')?.appendChild(discardPrompt);
      discardPrompt.querySelector('[data-keep-editing]')?.addEventListener('click', () => { discardPrompt.remove(); discardPrompt = null; dialog.querySelector('[data-review-required]')?.focus(); });
      discardPrompt.querySelector('[data-discard]')?.addEventListener('click', () => { clearDraft(); close(); });
      discardPrompt.querySelector('[data-keep-editing]')?.focus();
      return;
    }
    close();
  };
  overlay.querySelectorAll('[data-close]').forEach(control => control.addEventListener('click', () => requestClose()));
  overlay.addEventListener('mousedown', event => { if (event.target === overlay) requestClose(); });
  const requiredFields = [...overlay.querySelectorAll('[data-review-required]')];
  const invalid = field => field.type === 'checkbox' ? !field.checked : !String(field.value || '').trim();
  const syncValidity = () => { confirmButton.disabled = isSubmitting || requiredFields.some(invalid); };
  const saveDraft = () => { if (!draftKey) return; try { const values = Object.fromEntries(draftFields.map(field => [field.id, field.type === 'checkbox' ? field.checked : field.value])); const hasValue = draftFields.some(field => field.type === 'checkbox' ? field.checked : String(field.value || '').trim()); hasValue ? sessionStorage.setItem(draftKey, draftFields.length === 1 ? String(draftFields[0].value || '') : JSON.stringify(values)) : sessionStorage.removeItem(draftKey); } catch (_) { /* storage can be disabled */ } };
  requiredFields.forEach(field => field.addEventListener('input', () => { field.removeAttribute('aria-invalid'); errorArea.hidden = true; saveDraft(); syncValidity(); }));
  requiredFields.forEach(field => field.addEventListener('change', () => { saveDraft(); syncValidity(); }));
  syncValidity();
  confirmButton.addEventListener('click', async () => {
    if (isSubmitting) return;
    isSubmitting = true;
    setBusy(confirmButton, true);
    syncValidity();
    errorArea.hidden = true;
    try { if (await action(dialog)) { clearDraft(); requestClose(true); } }
    catch (error) { errorArea.hidden = false; errorArea.innerHTML = `<span>${esc(errorMessage(error, 'Не удалось выполнить действие'))}</span>${onRefresh ? '<button type="button" class="btn btn-secondary btn-sm" data-refresh-request>Обновить данные</button>' : ''}`; errorArea.querySelector('[data-refresh-request]')?.addEventListener('click', async () => { requestClose(true); await onRefresh(); }); errorArea.focus(); }
    finally { isSubmitting = false; if (confirmButton.isConnected) { setBusy(confirmButton, false); syncValidity(); } }
  });
  window.lucide?.createIcons();
}

function renderActionFeedback(feedback) { return `<section class="review-action-feedback" role="status"><i data-lucide="circle-check"></i><div><strong>${esc(feedback.message)}</strong><span>${feedback.taskPublicId ? `Создана задача ${esc(feedback.taskPublicId)}. ` : ''}Данные запроса обновлены.</span><div class="review-action-feedback-links"><a class="btn btn-secondary btn-sm" href="#/review">К очереди</a>${feedback.taskId ? `<a class="btn btn-secondary btn-sm" href="#/backlog?task=${esc(feedback.taskId)}">Открыть задачу</a>` : ''}${feedback.nextId ? `<a class="btn btn-primary btn-sm" href="#/review/${esc(feedback.nextId)}">Следующий запрос</a>` : ''}</div></div><button class="btn btn-secondary btn-sm ui-btn" type="button" id="dismiss-review-feedback" aria-label="Скрыть сообщение">&times;</button></section>`; }

function renderActionError(app, error) {
  const container = document.querySelector('.review-decision-card .card-body');
  if (!container) return window.toast?.(errorMessage(error, 'Не удалось обновить запрос'), 'error');
  container.querySelector('.review-inline-error')?.remove();
  const banner = document.createElement('div');
  banner.className = 'review-inline-error';
  banner.setAttribute('role', 'alert');
  banner.innerHTML = `<span>${esc(errorMessage(error, 'Не удалось обновить запрос'))}</span><button type="button" class="btn btn-secondary btn-sm">Обновить данные</button>`;
  banner.querySelector('button')?.addEventListener('click', () => app.router.refreshCurrentRoute());
  container.prepend(banner);
  banner.querySelector('button')?.focus();
}

function saveActionFeedback(feedback) { try { sessionStorage.setItem(REVIEW_FEEDBACK_KEY, JSON.stringify(feedback)); } catch (_) { /* storage can be disabled */ } }
function takeActionFeedback(requestId) { try { const value = JSON.parse(sessionStorage.getItem(REVIEW_FEEDBACK_KEY) || 'null'); if (!value || Number(value.requestId) !== Number(requestId)) return null; sessionStorage.removeItem(REVIEW_FEEDBACK_KEY); return value; } catch (_) { return null; } }
function findNextReviewId(currentId, sourceRows = reviewRows) { const rows = filteredReviewRows(readQueueState(), sourceRows); const index = rows.findIndex(request => Number(request.id) === Number(currentId)); return rows.slice(index >= 0 ? index + 1 : 0).find(request => Number(request.id) !== Number(currentId))?.id || rows.slice(0, Math.max(index, 0)).find(request => Number(request.id) !== Number(currentId))?.id || null; }

function readQueueState() {
  try {
    const stored = JSON.parse(sessionStorage.getItem(REVIEW_QUEUE_STATE_KEY) || '{}');
    const params = new URLSearchParams((window.location.hash.split('?')[1] || ''));
    const mode = params.get('mode') || stored.mode;
    const status = params.get('status') || stored.status;
    const sort = params.get('sort') || stored.sort;
    return { search: params.has('q') ? params.get('q') : typeof stored.search === 'string' ? stored.search : '', mode: MODES.has(mode) ? mode : DEFAULT_QUEUE_STATE.mode, status: STATUSES.has(status) ? status : DEFAULT_QUEUE_STATE.status, signals: params.has('signals') ? params.get('signals') === '1' : Boolean(stored.signals), aged: params.has('aged') ? params.get('aged') === '1' : Boolean(stored.aged), sort: SORTS.has(sort) ? sort : DEFAULT_QUEUE_STATE.sort, scrollTop: Number.isFinite(Number(stored.scrollTop)) ? Math.max(0, Number(stored.scrollTop)) : 0 };
  }
  catch (_) { return { ...DEFAULT_QUEUE_STATE }; }
}
function saveQueueState(patch = {}) { const state = { ...queueStateFromControls(), ...patch }; try { sessionStorage.setItem(REVIEW_QUEUE_STATE_KEY, JSON.stringify(state)); } catch (_) { /* storage can be disabled */ } syncQueueUrl(state); return state; }
function queueStateFromControls() { const fallback = readQueueState(); return { search: document.getElementById('review-search')?.value ?? fallback.search, mode: document.getElementById('review-mode-filter')?.value || fallback.mode, status: document.getElementById('review-status-filter')?.value || fallback.status, signals: document.getElementById('review-signals-only')?.checked ?? fallback.signals, aged: fallback.aged, sort: document.getElementById('review-sort')?.value || fallback.sort, scrollTop: currentQueueScroll() }; }
function restoreQueueControls() { setQueueControls(readQueueState()); }
function setQueueControls(state) { const search = document.getElementById('review-search'); const mode = document.getElementById('review-mode-filter'); const status = document.getElementById('review-status-filter'); const signals = document.getElementById('review-signals-only'); const sort = document.getElementById('review-sort'); if (search) search.value = state.search || ''; if (mode) mode.value = state.mode || 'action'; if (status) status.value = state.status || 'any'; if (signals) signals.checked = Boolean(state.signals); if (sort) sort.value = state.sort || 'stage_oldest'; }
function syncQueueUrl(state) { if (!window.location.hash.startsWith('#/review') || /^#\/review\/\d+/.test(window.location.hash)) return; const params = new URLSearchParams(); if (state.search) params.set('q', state.search); if (state.mode !== DEFAULT_QUEUE_STATE.mode) params.set('mode', state.mode); if (state.status !== 'any') params.set('status', state.status); if (state.signals) params.set('signals', '1'); if (state.aged) params.set('aged', '1'); if (state.sort !== DEFAULT_QUEUE_STATE.sort) params.set('sort', state.sort); history.replaceState(history.state, '', `#/review${params.size ? `?${params}` : ''}`); }
function applyQuickFilter(kind, value) { const state = queueStateFromControls(); if (kind === 'mode') state.mode = value; if (kind === 'status') state.status = value; if (kind === 'signals') state.signals = !state.signals; if (kind === 'aged') state.aged = !state.aged; setQueueControls(state); try { sessionStorage.setItem(REVIEW_QUEUE_STATE_KEY, JSON.stringify(state)); } catch (_) { /* ignored */ } }
function quickFilterActive(kind, value, state) { if (kind === 'mode') return state.mode === value; if (kind === 'status') return state.status === value; if (kind === 'signals') return state.signals; if (kind === 'aged') return state.aged; return false; }
function currentQueueScroll() { return document.getElementById('review-list-content')?.scrollTop || 0; }

function availableActions(request) {
  if (Array.isArray(request.available_actions)) return request.available_actions;
  const canReview = (reviewCurrentUser?.permissions?.review || 'none') !== 'none';
  if (!canReview) return [];
  if (request.status === 'submitted') return ['claim'];
  if (request.status === 'in_review' && Number(request.reviewer_id) === Number(reviewCurrentUser?.id)) return ['approve', 'return', 'reject', 'release', ...((reviewCurrentUser?.permissions?.review || 'none') === 'all' ? ['reroute'] : [])];
  return [];
}
function cardAction(request) { const actions = availableActions(request); const stage = getRequestStage(request); if (actions.includes('claim')) return request.status === 'returned' ? 'Проверить уточнения' : 'Взять на ревью'; if (actions.includes('approve')) return 'Принять решение'; if (request.status === 'in_review') return `Ревью ведёт ${request.reviewer_name || 'коллега'}`; if (stage.group === 'done') return 'Посмотреть результат'; if (stage.group === 'closed') return 'Посмотреть решение'; if (request.status === 'in_progress') return stage.label === 'Приостановлен' ? 'Уточнить статус проработки' : 'Контролировать проработку'; return 'Открыть запрос'; }
function isMine(request) { const userId = Number(reviewCurrentUser?.id); return Boolean(userId && (Number(request.reviewer_id) === userId || Number(request.assignee_id) === userId)); }
function isUnassigned(request) { return ['submitted', 'in_review'].includes(request.status) && !request.reviewer_id; }
export function isOverdue(request) { return request.review_deadline ? Boolean(request.is_overdue) : false; }
function stageTime(request) { return time(request.stage_started_at || request.updated_at || request.created_at); }
function stageAgeDays(request) { const started = stageTime(request); return started ? Math.max(0, Math.floor((Date.now() - started) / 86400000)) : null; }
function isLongWaiting(request) { const days = stageAgeDays(request); return days !== null && days >= 3 && !['done', 'closed'].includes(getRequestStage(request).group); }
function stageAgeText(request) { const days = stageAgeDays(request); if (days === null) return 'Возраст этапа неизвестен'; if (days === 0) return 'На этапе сегодня'; return `${days} ${plural(days, 'день', 'дня', 'дней')} на этапе`; }

function showFieldError(field, message) { field.setAttribute('aria-invalid', 'true'); if (window.showFieldError) window.showFieldError(field, message); field.focus(); return false; }
function setBusy(button, busy) { if (!button) return; button.disabled = busy; button.toggleAttribute('aria-busy', busy); }
function errorMessage(error, fallback) { return window.formatErrorMessage?.(error) || error?.message || fallback; }
function toCardList(value) { return Array.isArray(value) ? value.filter(Boolean) : value ? [value] : []; }
function buttonVersion(event) { return Number(event.currentTarget?.dataset?.requestVersion ?? 0); }
function metric(label, score, hint, assessedAt = '') { if (score === null) return `<div title="${esc(hint)}"><span>${label}</span><strong>Не рассчитана</strong><small>Статус: расчёт отсутствует</small></div>`; return `<div title="${esc(hint)}"><span>${label}</span><strong class="${tone(score)}">${score}%</strong><div class="review-score-track" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score}"><span class="${tone(score)}" style="width:${score}%"></span></div><small>${assessedAt ? `Рассчитано ${date(assessedAt)}` : 'Рассчитано · дата не сохранена'}</small></div>`; }
function scoreView(score) { if (score === null) return '<div class="review-list-score is-unscored"><strong>Не рассчитано</strong><span>Качество</span></div>'; return `<div class="review-list-score"><strong class="${tone(score)}">${score}%</strong><span>${score >= 75 ? 'Высокая' : score >= 50 ? 'Средняя' : 'Низкая'}</span></div>`; }
function tone(number) { return number >= 75 ? 'is-good' : number >= 50 ? 'is-medium' : 'is-low'; }
function confidence(value) { return ({ high: 'Высокая', medium: 'Средняя', low: 'Низкая' })[value] || 'Не определена'; }
function qualityScore(request = {}) { const draft = request.draft || request; return numericScore(draft.quality_score); }
function nullableScoreForSort(score) { return score === null ? Number.POSITIVE_INFINITY : score; }
function latestRevision(request = {}) { const revisions = Array.isArray(request.revision_history) ? request.revision_history : []; return revisions.at(-1)?.revision || (request.draft && Object.keys(request.draft).length ? 1 : 'не определена'); }
function workingNoteKey(id, version) { return `${REVIEW_DRAFT_KEY_PREFIX}:${id}:working:${version}`; }
function readWorkingNote(id, version) { try { return sessionStorage.getItem(workingNoteKey(id, version)) || ''; } catch (_) { return ''; } }
function clearWorkingNote(id, version) { try { sessionStorage.removeItem(workingNoteKey(id, version)); } catch (_) { /* ignored */ } }
function seedActionDraft(key, value) { if (!value) return; try { if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, value); } catch (_) { /* ignored */ } }
function time(iso) { const value = Date.parse(iso || ''); return Number.isFinite(value) ? value : 0; }
function plural(number, one, few, many) { const mod100 = number % 100; if (mod100 >= 11 && mod100 <= 14) return many; const mod10 = number % 10; return mod10 === 1 ? one : mod10 >= 2 && mod10 <= 4 ? few : many; }
function setText(id, value) { const element = document.getElementById(id); if (element) element.textContent = String(value); }
function date(iso) { if (!iso) return '—'; const value = new Date(iso); return Number.isNaN(value.getTime()) ? esc(iso) : `${value.toLocaleDateString('ru-RU')} ${value.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`; }
function esc(value) { const element = document.createElement('div'); element.textContent = value == null ? '' : String(value); return element.innerHTML; }
