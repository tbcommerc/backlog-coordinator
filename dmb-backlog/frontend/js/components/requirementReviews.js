import { AgentV2Api, requestKey } from '../agent-v2/api.js?v=1';
import { escapeHtml as esc, valueText, renderRequirementSnapshot, renderDocumentReview, renderDocumentSources, renderDocumentComparison } from '../agent-v2/documentReview.js?v=6';

const ACTION_LABELS = { claim: 'Взять на ревью', approve: 'Согласовать редакцию', return: 'Вернуть на доработку', withdraw: 'Отозвать редакцию' };
const STATUS_LABELS = { submitted: 'Ожидает ревью', approved: 'Согласовано', returned: 'Возвращено на доработку', withdrawn: 'Отозвано' };

export function requirementReviewsApi(app) {
  if (!app._requirementReviewsApi) {
    app._requirementReviewsApi = new AgentV2Api(app);
    app._requirementReviewsApi.base = '/api/requirement-reviews';
  }
  return app._requirementReviewsApi;
}

export async function loadLatestRequirementReview(app, artifactId, beforeId = null) {
  if (!artifactId) return null;
  const api = requirementReviewsApi(app);
  let offset = 0;
  let latest = null;
  // The queue is ordered by the last human action, not by submission time.
  // Walk only this document's history so a late decision on an older package
  // cannot become the comparison baseline for a newer revision.
  while (true) {
    const result = await api.get(`?artifact_id=${encodeURIComponent(artifactId)}&limit=100&offset=${offset}`);
    const items = result.items || [];
    for (const item of items) if ((!beforeId || Number(item.id) < Number(beforeId)) && (!latest || Number(item.id) > Number(latest.id))) latest = item;
    offset += items.length;
    if (!items.length || offset >= Number(result.total || 0)) return latest;
  }
}

export function requirementReviewStatus(review) {
  if (review.status === 'submitted' && review.reviewer_id) return 'На ревью';
  return STATUS_LABELS[review.status] || review.status;
}

export function allowedReviewActions(review) {
  // The server authorizes each decision again. Never infer approval from a role or read access.
  return (review.available_actions || []).filter(action => ACTION_LABELS[action] && review.permissions?.[`can_${action}`] === true);
}

export function renderRequirementReviews() {
  return `<section class="requirement-reviews" id="requirement-reviews"><div class="request-list-title-row"><div><h1>Ревью редакций БТ</h1><p>Человеческое решение по зафиксированному документу</p></div><button type="button" class="btn btn-secondary" id="refresh-requirement-reviews">Обновить</button></div><div id="requirement-reviews-error" class="agent-v2-error" role="alert" hidden></div><div id="requirement-reviews-content" aria-live="polite"><p>Загружаем редакции…</p></div></section>`;
}

export function renderRequirementReviewDetail(review, previousReview = null) {
  const actions = allowedReviewActions(review);
  const report = review.review_report || {};
  const snapshot = review.artifact_snapshot || {};
  const reviewState = { draft: snapshot, document_review: report.review, document_findings: report.findings || [], document_sources: report.sources || [] };
  const decisions = report.decisions || [];
  const workspaceUrl = `#/agent-v2?review=${encodeURIComponent(review.id)}`;
  const comparison = renderDocumentComparison(previousReview, snapshot);
  return `<article class="requirement-review-detail" data-review-id="${esc(review.id)}"><a class="btn btn-ghost" href="#/review?tab=requirements">Все редакции БТ</a><header class="requirement-review-header"><div><span class="agent-v2-eyebrow">Редакция БТ · ${esc(requirementReviewStatus(review))}</span><h2>${esc(review.title || snapshot.title || 'Бизнес-требования')}</h2><p>Редакция ${esc(review.artifact_revision)} · отправил ${esc(review.creator_name || review.creator_id)}${review.reviewer_name ? ` · ревьюер ${esc(review.reviewer_name)}` : ''}</p>${review.target_id ? `<p>Связанный ${review.target_type === 'task' ? 'объект: задача' : 'объект: запрос'} ${esc(review.target_id)}</p>` : ''}${review.source_request_author_id ? `<p>Автор исходного запроса: ${esc(review.source_metadata?.author_name || review.source_request_author_id)}</p>` : ''}</div></header><p class="requirement-review-explainer">Решение относится только к показанной редакции БТ. Оно не создаёт задачу и не меняет статус исполнения.</p>${review.context_changed ? '<p class="agent-v2-review-warning" role="alert">Связанный запрос или задача изменились после отправки. Согласование недоступно: верните документ на доработку или отзовите пакет.</p>' : ''}${report.degraded_acknowledged ? '<p class="agent-v2-review-warning">Автор передал документ с пометкой: содержательная AI-проверка недоступна.</p>' : ''}${review.comment ? `<section class="agent-v2-card"><h3>Комментарий к решению</h3><p>${esc(review.comment)}</p></section>` : ''}${comparison}<div class="requirement-review-layout"><div><h3>Зафиксированный документ</h3>${renderRequirementSnapshot(snapshot)}</div><aside>${report.review ? renderDocumentReview(reviewState, { locked: true }) : '<section class="agent-v2-card"><h3>AI-проверка</h3><p>Протокол не приложен к этой редакции.</p></section>'}${renderDocumentSources(reviewState, { locked: true })}${decisions.length ? `<details><summary class="ui-disclosure-text">Решения автора по замечаниям</summary><p class="requirement-review-prewrap">${esc(valueText(decisions))}</p></details>` : ''}${actions.length ? `<form id="requirement-review-decision"><h3>Решение по редакции ${esc(review.artifact_revision)}</h3><label>Комментарий<textarea class="input ui-control" name="comment" rows="4" maxlength="4000" placeholder="Для возврата укажите, что требуется доработать"></textarea></label><div class="agent-v2-action-row">${actions.map(action => `<button type="submit" class="btn ${action === 'approve' ? 'btn-primary' : 'btn-secondary'}" name="action" value="${action}">${ACTION_LABELS[action]}</button>`).join('')}</div></form>` : '<p>Действия по этой редакции сейчас недоступны.</p>'}${review.permissions?.can_open_workspace ? `<a class="btn btn-secondary requirement-review-resume" href="${esc(workspaceUrl)}">${review.status === 'returned' ? 'Доработать БТ с замечаниями' : 'Открыть рабочий документ'}</a>` : ''}<details><summary class="ui-disclosure-text">История человеческих решений</summary>${(review.events || []).map(event => `<p>${esc(event.created_at || '')} · ${esc(ACTION_LABELS[event.action] || event.action || event.event_type || '')}<br>${esc(event.actor_name || event.comment || '')}</p>`).join('') || '<p>Решений пока нет.</p>'}</details></aside></div></article>`;
}

function renderReviewCards(items) {
  if (!items.length) return '<div class="customer-request-state"><h2>Редакций на ревью пока нет</h2><p>Они появятся после передачи БТ из рабочего места аналитика.</p></div>';
  return `<div class="requirement-review-cards">${items.map(review => `<a class="agent-v2-card requirement-review-card" href="#/review?tab=requirements&requirement_review=${encodeURIComponent(review.id)}"><span class="agent-v2-eyebrow">Редакция БТ · ${esc(requirementReviewStatus(review))}</span><h2>${esc(review.title || 'Бизнес-требования')}</h2><p>Редакция ${esc(review.artifact_revision)} · ${esc(review.creator_name || 'Автор документа')}</p>${review.reviewer_name ? `<p>Ревьюер: ${esc(review.reviewer_name)}</p>` : ''}<small>${esc(review.updated_at || review.created_at || '')}</small></a>`).join('')}</div>`;
}

export async function initRequirementReviews(app) {
  const root = document.getElementById('requirement-reviews');
  if (!root) return;
  const content = root.querySelector('#requirement-reviews-content');
  const error = root.querySelector('#requirement-reviews-error');
  const api = requirementReviewsApi(app);
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const reviewId = params.get('requirement_review');
  let currentReview = null;
  let previousReview = null;
  let rows = [];
  let pending = false;
  const showError = cause => { error.textContent = cause?.status === 409 ? 'Редакция или решение изменились. Обновите данные перед повторным действием.' : cause?.message || 'Не удалось загрузить редакции БТ.'; error.hidden = false; };
  const load = async ({ append = false } = {}) => {
    if (pending) return;
    pending = true;
    error.hidden = true;
    try {
      if (reviewId) {
        currentReview = await api.get(`/${encodeURIComponent(reviewId)}`);
        previousReview = await loadLatestRequirementReview(app, currentReview.artifact_id, currentReview.id);
        if (!root.isConnected) return;
        content.innerHTML = renderRequirementReviewDetail(currentReview, previousReview);
        bindDecision();
      } else {
        const result = await api.get(`?limit=50&offset=${append ? rows.length : 0}`);
        rows = append ? [...rows, ...(result.items || [])] : (result.items || []);
        if (!root.isConnected) return;
        content.innerHTML = `${renderReviewCards(rows)}<p>Показано ${rows.length} из ${Number(result.total || 0)}</p>${rows.length < result.total ? '<button type="button" class="btn btn-secondary" id="more-requirement-reviews">Загрузить ещё</button>' : ''}`;
        content.querySelector('#more-requirement-reviews')?.addEventListener('click', () => load({ append: true }));
      }
    } catch (cause) { showError(cause); } finally { pending = false; }
  };
  const bindDecision = () => {
    content.querySelector('#requirement-review-decision')?.addEventListener('submit', async event => {
      event.preventDefault();
      if (pending) return;
      const form = event.currentTarget;
      const action = event.submitter?.value;
      if (!allowedReviewActions(currentReview).includes(action)) return;
      const comment = new FormData(form).get('comment')?.trim() || '';
      const input = form.querySelector('textarea');
      input.setCustomValidity(action === 'return' && !comment ? 'Укажите замечания для доработки.' : '');
      if (!input.reportValidity()) return;
      pending = true;
      form.querySelectorAll('button').forEach(button => { button.disabled = true; });
      error.hidden = true;
      try {
        currentReview = await api.post(`/${encodeURIComponent(currentReview.id)}/actions`, { action, version: currentReview.version, comment, idempotency_key: requestKey('requirement-decision') });
        if (!root.isConnected) return;
        content.innerHTML = renderRequirementReviewDetail(currentReview, previousReview);
        bindDecision();
      } catch (cause) { showError(cause); } finally { pending = false; form.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
    });
    content.querySelector('#requirement-review-decision textarea')?.addEventListener('input', event => event.currentTarget.setCustomValidity(''));
  };
  root.querySelector('#refresh-requirement-reviews')?.addEventListener('click', () => load());
  await load();
}
