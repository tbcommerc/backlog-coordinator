import { DOCUMENT_LABELS, escapeHtml as esc, isReviewStale, valueText, renderRequirementSnapshot } from './documentReview.js?v=6';

export const REQUIRED_SECTIONS = ['problem_statement', 'business_goal', 'scope_in', 'acceptance_criteria'];
export function meaningful(value) {
  if (Array.isArray(value)) return value.some(item => meaningful(item?.text ?? item));
  return typeof value === 'string' && !['', '—', '-', 'unknown', 'неизвестно', 'не указано', 'tbd'].includes(value.trim().toLocaleLowerCase('ru'));
}
export function currentFindings(state) {
  const review = state.document_review;
  return (state.document_findings || []).filter(item => (!item.review_id || item.review_id === review?.id)
    && item.base_fingerprint === review?.base_fingerprint);
}
export function submissionReadiness(state) {
  const missing = REQUIRED_SECTIONS.filter(field => !meaningful(state.draft?.[field]));
  const review = state.document_review;
  const needsReview = !['completed', 'degraded'].includes(review?.status) || isReviewStale(state);
  const blockers = currentFindings(state).filter(item => !item.stale && item.severity === 'critical'
    && (!['resolved', 'rejected'].includes(item.status) || !item.reason?.trim()));
  return { missing, needsReview, blockers, ready: Boolean(state.draft) && !missing.length && !needsReview && !blockers.length };
}

export function renderNextStep(state, view, humanReview) {
  const readiness = submissionReadiness(state);
  const open = currentFindings(state).filter(item => ['open', 'deferred'].includes(item.status || 'open'));
  const sameReview = Boolean(humanReview?.artifact_id && humanReview.artifact_id === (state.artifact_id || state.draft?.artifact_id) && humanReview.artifact_fingerprint === state.draft?.fingerprint);
  let title = 'Вот как я понял задачу';
  let text = 'Прочитайте черновик и поправьте формулировки. ИИ мог ошибиться; неизвестное можно уточнить позже.';
  let action = 'review', label = 'Проверить черновик';
  if (!state.draft) {
    title = 'Материалы сохранены'; text = 'Подготовьте черновик по материалам или заполните разделы вручную.';
    action = 'create_draft'; label = 'Подготовить черновик';
  } else if (view === 'review') {
    title = 'Что нужно уточнить';
    text = readiness.needsReview ? 'Текст или материалы изменились. Проверьте исправления, чтобы получить актуальные замечания.'
      : readiness.blockers.length ? `Существенных замечаний: ${readiness.blockers.length}. Они требуют решения перед согласованием.`
        : readiness.missing.length ? 'Заполните обязательные разделы перед согласованием.'
          : open.length ? `Осталось вопросов: ${open.length}. Их можно уточнить сейчас или передать вместе с документом.`
            : 'В выполненных проверках открытых замечаний нет. Можно подготовить документ к согласованию.';
    label = 'Проверить исправления';
    if (readiness.ready) { action = 'preview'; label = 'Подготовить к согласованию'; }
  } else if (view === 'approval') {
    title = 'Проверьте, что отправится на согласование';
    text = 'Согласующий получит эту редакцию, материалы и результаты проверки. Отправка произойдёт только после нажатия кнопки.';
    action = readiness.ready ? 'submit' : 'review'; label = readiness.ready ? 'Отправить на согласование' : 'Проверить исправления';
  }
  if (sameReview && ['submitted', 'in_review', 'approved'].includes(humanReview.status)) {
    title = humanReview.status === 'approved' ? 'Эта редакция согласована' : 'Документ отправлен на согласование';
    text = humanReview.status === 'approved' ? 'Решение относится к отправленной редакции. Новые правки потребуют повторного согласования.' : 'Теперь ожидается решение согласующего. Следить за ним можно в карточке согласования.';
    action = 'open-review'; label = 'Открыть согласование';
  } else if (humanReview?.status === 'returned' && view === 'document') {
    title = 'Исправьте документ по замечаниям'; text = humanReview.comment || 'Откройте замечания согласующего и внесите правки в документ.';
    label = 'Проверить исправления';
  }
  return `<section class="agent-v2-next-step" aria-label="Следующий шаг"><div><h2>${esc(title)}</h2><p>${esc(text)}</p>${readiness.missing.length ? `<p>Нужно уточнить: ${readiness.missing.map(field => esc(DOCUMENT_LABELS[field])).join(', ')}.</p>` : ''}</div><button type="button" class="btn ui-btn ${['create_draft', 'review'].includes(action) ? 'btn-ai-primary' : 'btn-primary'}" data-journey-action="${action}">${['create_draft', 'review'].includes(action) ? '<i data-lucide="sparkles" aria-hidden="true"></i>' : ''}${label}</button></section>`;
}

export function renderApprovalPreview(state) {
  const readiness = submissionReadiness(state);
  const open = currentFindings(state).filter(item => ['open', 'deferred'].includes(item.status || 'open'));
  const fields = Object.keys(DOCUMENT_LABELS).filter(field => !['revision', 'title'].includes(field) && meaningful(state.draft?.[field]));
  return `<section class="agent-v2-approval" aria-label="Перед отправкой"><h2>${esc(state.draft?.title || 'Бизнес-требование')}</h2><p><strong>Редакция ${esc(state.draft?.revision || '—')}</strong> · Получатель: очередь согласования бизнес-требований</p><p>Проверка: ${readiness.needsReview ? 'нужно проверить текущую редакцию' : state.document_review?.status === 'degraded' ? 'выполнена частично — ИИ недоступен' : 'выполнена для этой редакции'}.</p>${!readiness.ready ? '<p class="agent-v2-review-warning">Отправка пока недоступна. Вернитесь к уточнениям.</p>' : ''}<h3>Оставшиеся вопросы (${open.length})</h3>${open.length ? `<ul>${open.map(item => `<li>${esc(item.message)}${item.reason ? ` — ${esc(item.reason)}` : ''}</li>`).join('')}</ul>` : '<p>Открытых замечаний проверки нет.</p>'}${state.document_review?.status === 'degraded' ? '<label class="agent-v2-degraded-ack"><input type="checkbox" id="agent-v2-ack-degraded">Передать с пометкой: ИИ-проверка недоступна</label>' : ''}<h3>Документ, который получит согласующий</h3>${fields.map(field => `<article class="agent-v2-section"><h4>${esc(DOCUMENT_LABELS[field])}</h4><div class="agent-v2-section-value">${esc(valueText(state.draft[field]))}</div></article>`).join('')}<details><summary class="ui-disclosure-text">Все данные отправляемой редакции</summary>${renderRequirementSnapshot(state.draft || {})}</details></section>`;
}
