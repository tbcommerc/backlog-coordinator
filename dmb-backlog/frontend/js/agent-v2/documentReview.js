export const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

export const DOCUMENT_LABELS = {
  priority: 'Приоритет', business_value: 'Бизнес-ценность', intent: 'Тип обращения', user_roles: 'Участники', affected_users: 'Затронутые пользователи', department: 'Подразделение', product: 'Продукт', module: 'Модуль', regulatory_flags: 'Регуляторные условия', assumption_details: 'Допущения',
  primary_role: 'Основная роль', need_statement: 'Проблема', as_is: 'Текущий процесс', to_be: 'Целевой процесс',
  title: 'Название', problem_statement: 'Проблема', business_goal: 'Бизнес-цель',
  business_requirements: 'Бизнес-требования', current_process: 'Текущий процесс', target_process: 'Целевой процесс',
  scope_in: 'В объёме', scope_out: 'За границами', actors: 'Участники', role: 'Основная роль',
  process: 'Процесс', scenarios: 'Основной сценарий', alternative_scenarios: 'Альтернативные сценарии',
  exception_scenarios: 'Исключения', business_rules: 'Бизнес-правила', constraints: 'Ограничения', dependencies: 'Зависимости',
  risks: 'Риски', assumptions: 'Допущения', open_questions: 'Открытые вопросы', open_question_details: 'Открытые вопросы',
  acceptance_criteria: 'Критерии приёмки', success_metrics: 'Метрики успеха',
  functional_requirements: 'Функциональные требования', non_functional_requirements: 'Нефункциональные требования',
  data_integrations: 'Данные и интеграции', sources: 'Источники', source_refs: 'Основания', provenance: 'Происхождение формулировок',
  review_findings: 'Замечания проверки', quality_issues: 'Замечания качества', gaps: 'Пробелы', conflicts: 'Противоречия',
  text: 'Формулировка', content: 'Содержание', message: 'Замечание', reason: 'Основание', quote: 'Фрагмент',
  status: 'Состояние', id: 'Номер', revision: 'Редакция', artifact_id: 'Документ', fingerprint: 'Отпечаток редакции',
  source_type: 'Тип источника', source_ref: 'Ссылка на источник', version: 'Версия', author_kind: 'Автор изменения',
  schema: 'Формат документа', schema_version: 'Версия формата', prompt_set_version: 'Версия набора инструкций',
  prompt_version: 'Версия инструкций', created_at: 'Создано', updated_at: 'Обновлено',
  linked_object_snapshot: 'Снимок связанного объекта', linked_snapshot_fingerprint: 'Отпечаток связанного контекста',
};

export function formatDocumentDate(value) {
  if (!value) return 'Дата не указана';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Дата не указана' : new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function reviewStage(state) {
  if (!state.document_review?.id) return { label: 'Проверка', done: false };
  if (isReviewStale(state)) return { label: 'Проверка устарела', done: false };
  const blockers = (state.document_findings || []).some(item => item.severity === 'critical' && ['open', 'deferred'].includes(item.status || 'open'));
  if (state.document_review.status === 'degraded') return { label: `Проверено частично${blockers ? ' · есть блокеры' : ''}`, done: false };
  if (blockers) return { label: 'Есть блокеры', done: false };
  return { label: 'Проверено', done: state.document_review.status === 'completed' };
}

export function valueText(value) {
  if (Array.isArray(value)) return value.map(valueText).join('\n');
  if (value && typeof value === 'object') {
    if (value.text) {
      const details = Object.entries(value).filter(([key]) => !['id', 'text'].includes(key)).map(([key, item]) => `${DOCUMENT_LABELS[key] || key}: ${valueText(item)}`);
      return [`${value.id ? `${value.id}: ` : ''}${value.text}`, ...details].join('\n');
    }
    return Object.entries(value).map(([key, item]) => `${DOCUMENT_LABELS[key] || key}: ${valueText(item)}`).join('\n');
  }
  return String(value ?? '');
}

export function isReviewStale(state) {
  return Boolean(state.document_review?.id && (state.document_review.stale || state.document_review.base_fingerprint !== state.draft?.fingerprint));
}

export function isCurrentDraftApproved(state, review) {
  return Boolean(review?.status === 'approved' && review.artifact_id
    && review.artifact_id === (state.artifact_id || state.draft?.artifact_id)
    && review.artifact_fingerprint && review.artifact_fingerprint === state.draft?.fingerprint);
}

export function renderDocumentSources(state, { locked = false } = {}) {
  const sources = state.document_sources || [];
  return `<section class="agent-v2-text-sources" aria-label="Материалы документа"><h3>Материалы (${sources.length})</h3>${sources.map(source => `<details class="agent-v2-source"><summary>${escapeHtml(source.title || 'Текстовый источник')} · версия ${escapeHtml(source.version)}</summary><p>${escapeHtml(source.content)}</p></details>`).join('')}${locked ? '' : '<details><summary>Добавить текстовый источник</summary><form id="agent-v2-add-source"><label>Название источника<input class="input ui-control" name="title" maxlength="200" required placeholder="Например, интервью с владельцем процесса"></label><label>Текст источника<textarea class="input ui-control" name="content" rows="5" maxlength="30000" required></textarea></label><button type="submit" class="btn btn-secondary">Добавить материал</button></form></details>'}</section>`;
}

export function renderBusinessRequirements(state) {
  const items = state.draft?.business_requirements || [];
  if (!items.length) return '';
  return `<article class="agent-v2-section" id="agent-v2-section-business_requirements"><header><h3>Бизнес-требования</h3></header><ol class="agent-v2-br-list">${items.map(item => `<li><strong>${escapeHtml(item.id)}</strong><p>${escapeHtml(item.text)}</p>${item.source_refs?.length ? renderSourceEvidence(state, item.source_refs) : '<small>Основание требует подтверждения</small>'}</li>`).join('')}</ol></article>`;
}

function resolveSource(state, ref) {
  const id = typeof ref === 'string' ? ref : ref?.source_id || ref?.id;
  const address = typeof id === 'string' ? id.match(/^(.*)@(\d+)(?:#.*)?$/) : null;
  const source = (state.document_sources || []).find(item => address ? item.id === address[1] && Number(item.version) === Number(address[2]) : item.id === id);
  if (!source) return { label: valueText(ref), content: '' };
  const lineAddress = id.match(/#L([1-9]\d*)$/);
  if (lineAddress) {
    const line = Number(lineAddress[1]);
    const content = (source.content || '').split(/\r?\n/)[line - 1];
    return { label: `${source.title} (версия ${source.version}) · строка ${line}${content === undefined ? ' · не найдена' : ''}`, content: content || '' };
  }
  const section = (source.sections || []).find(item => item.id === id);
  return { label: `${source.title} (версия ${source.version})${section?.title ? ` · ${section.title}` : ''}`, content: section?.content || source.content || '' };
}

function sourceLabel(state, ref) { return resolveSource(state, ref).label; }

function renderSourceEvidence(state, refs) {
  return (refs || []).map(ref => {
    const evidence = resolveSource(state, ref);
    return evidence.content ? `<details class="agent-v2-source-evidence"><summary>Основание: ${escapeHtml(evidence.label)}</summary><blockquote>${escapeHtml(evidence.content)}</blockquote></details>` : `<p><strong>Основание:</strong> ${escapeHtml(evidence.label)}</p>`;
  }).join('');
}

export function renderDocumentReview(state, { locked = false, showAction = true, guided = false } = {}) {
  const review = state.document_review?.id ? state.document_review : null;
  const stale = isReviewStale(state);
  const findings = [...(state.document_findings || [])];
  if (guided) findings.sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a.severity] ?? 3) - ({ critical: 0, warning: 1, info: 2 }[b.severity] ?? 3));
  const status = !review ? 'Содержательная проверка ещё не выполнена' : stale ? 'Проверена предыдущая редакция' : review.status === 'degraded' ? 'Выполнены только доступные проверки' : 'Проверка завершена';
  return `<section class="agent-v2-card agent-v2-document-review"><div class="agent-v2-card-title"><div><span class="agent-v2-eyebrow">ИИ-проверка</span><h3>${status}</h3></div></div><p>Проверка не изменяет текст и не означает согласование БТ.</p>${review ? `<p class="agent-v2-muted">Редакция ${escapeHtml(review.revision)} · ${escapeHtml(formatDocumentDate(review.created_at))}</p>` : ''}${review?.status === 'degraded' ? '<p class="agent-v2-review-warning" role="status">Содержательная LLM-проверка не завершена. Результаты правил доступны; повторите проверку позже.</p>' : ''}${stale ? '<p class="agent-v2-review-warning" role="status">Документ изменился. Замечания сохранены для истории; проверьте текущую редакцию.</p>' : ''}${!locked && showAction ? `<button type="button" class="ui-btn btn btn-ai" data-document-action="review" ${!state.draft ? 'disabled' : ''}><i data-lucide="sparkles" aria-hidden="true"></i>Проверить БТ</button>` : ''}${guided && findings.length ? `<div class="agent-v2-review-orientation"><strong>Замечаний: ${findings.length}</strong><p>Выберите замечание, затем измените раздел или запросите вариант текста. Основания можно раскрыть внутри карточки.</p></div>` : ''}<div class="agent-v2-document-findings">${findings.map((finding, index) => renderFinding(state, finding, locked, guided, index)).join('')}${review && !findings.length ? '<p>В выполненных проверках замечаний нет.</p>' : ''}</div></section>`;
}

function renderFinding(state, finding, locked, guided = false, index = 0) {
  const stale = finding.stale || finding.base_fingerprint !== state.draft?.fingerprint;
  const status = ({ open: 'Открыто', resolved: 'Рассмотрено и исправлено', rejected: 'Отклонено аналитиком', deferred: 'Отложено' })[finding.status] || 'Открыто';
  const severity = ({ critical: 'Критично', warning: 'Важно', info: 'Рекомендация' })[finding.severity] || 'Замечание';
  const evidence = renderSourceEvidence(state, finding.sources);
  const related = (finding.related || []).map(item => `<p><strong>Связанный фрагмент: ${escapeHtml(DOCUMENT_LABELS[item.field] || item.field)}</strong></p><blockquote>${escapeHtml(item.quote)}</blockquote>`).join('');
  const heading = DOCUMENT_LABELS[finding.field] || 'Документ';
  const wrapper = guided ? 'details' : 'article';
  const summary = guided ? `<summary class="agent-v2-finding-summary"><span class="agent-v2-finding-number">${index + 1}</span><span><strong>${escapeHtml(heading)}</strong><span class="agent-v2-finding-preview">${escapeHtml(finding.message)}</span></span><span class="agent-v2-finding-state">${severity} · ${escapeHtml(status)}${stale ? ' · предыдущая редакция' : ''}</span></summary>` : '';
  return `<${wrapper} class="agent-v2-finding ${guided ? 'is-guided' : ''}" data-finding="${escapeHtml(finding.id)}" ${guided ? `name="agent-v2-findings" ${index === 0 ? 'open' : ''}` : ''}>${summary}<div class="agent-v2-finding-body">${guided ? '' : `<div class="agent-v2-finding-meta"><strong>${severity}</strong><span>${escapeHtml(status)}${stale ? ' · предыдущая редакция' : ''}</span></div>`}${guided ? '' : `<h4>${escapeHtml(heading)}</h4><p>${escapeHtml(finding.message)}</p>`}${guided ? '<details class="agent-v2-finding-evidence"><summary>Почему появилось замечание · текст и основания</summary>' : ''}${finding.quote ? `<blockquote>${escapeHtml(finding.quote)}</blockquote>` : ''}${related}${finding.risk ? `<p><strong>Последствие:</strong> ${escapeHtml(finding.risk)}</p>` : ''}${evidence}${finding.suggestion ? `<p><strong>Предлагаемое действие:</strong> ${escapeHtml(finding.suggestion)}</p>` : ''}<small>${finding.method === 'llm' ? 'ИИ-анализ' : 'Проверка правил'}</small>${guided ? '</details>' : ''}${finding.reason ? `<p><strong>Решение аналитика:</strong> ${escapeHtml(finding.reason)}</p>` : ''}${!locked && !stale && guided && ['open', 'deferred'].includes(finding.status || 'open') ? `<div class="agent-v2-action-row"><button type="button" class="btn btn-primary" data-finding-field="${escapeHtml(finding.field)}">Изменить раздел</button>${finding.can_propose === false ? '' : `<button type="button" class="ui-btn btn btn-ai" data-propose-finding="${escapeHtml(finding.id)}"><i data-lucide="sparkles" aria-hidden="true"></i>Предложить текст с ИИ</button>`}<button type="button" class="btn btn-secondary" data-defer-finding="${escapeHtml(finding.id)}">Отложить вопрос</button></div><p class="agent-v2-action-help">«Изменить раздел» откроет редактор. ИИ предложит текст для вашего принятия. Отложенный вопрос останется открытым.</p>${finding.severity === 'critical' ? '<p class="agent-v2-review-warning">Этот вопрос блокирует согласование. «Отложить вопрос» сохранит вопрос, но не снимет блокировку.</p>' : ''}` : ''}${!locked && !stale && ['open', 'deferred'].includes(finding.status || 'open') ? `${guided ? '<details><summary>Уже решено или не согласны с замечанием?</summary>' : ''}<form class="agent-v2-finding-form" data-finding-id="${escapeHtml(finding.id)}"><label>Обоснование решения<textarea class="input ui-control" name="reason" rows="2" maxlength="2000" required></textarea></label><div class="agent-v2-action-row"><button type="submit" class="btn btn-secondary" name="decision" value="resolved">Исправлено</button><button type="submit" class="btn btn-ghost" name="decision" value="rejected">Отклонить</button><button type="submit" class="btn btn-ghost" name="decision" value="deferred">Отложить</button>${finding.can_propose === false || guided ? '' : `<button type="button" class="ui-btn btn btn-ai" data-propose-finding="${escapeHtml(finding.id)}"><i data-lucide="sparkles" aria-hidden="true"></i>Предложить правку</button>`}</div></form>${guided ? '</details>' : ''}` : ''}</div></${wrapper}>`;
}

export function renderDocumentProposals(state, { locked = false, guided = false } = {}) {
  const proposals = (state.document_proposals || []).filter(item => !guided || ['proposed', 'partially_applied'].includes(item.status));
  if (!proposals.length) return '';
  return `<section class="agent-v2-card agent-v2-proposals"><span class="agent-v2-eyebrow">Правки документа</span><h3>Предложения для вашей проверки</h3>${[...proposals].reverse().map(proposal => {
    const stale = proposal.status === 'stale' || proposal.base_fingerprint !== (state.draft?.fingerprint || '');
    const operations = proposal.operations || [];
    const actionable = !locked && !stale && operations.some(op => op.status === 'proposed');
    return `<form class="agent-v2-proposal" data-proposal-id="${escapeHtml(proposal.id)}">${stale && proposal.status !== 'applied' ? '<p class="agent-v2-review-warning">Документ изменился. Создайте новое предложение для текущей редакции.</p>' : ''}${operations.map(op => `<article class="agent-v2-patch"><label class="agent-v2-operation-choice"><input type="checkbox" name="operation_id" value="${escapeHtml(op.id)}" ${actionable && op.status === 'proposed' ? 'checked' : 'disabled'}><strong>${escapeHtml(DOCUMENT_LABELS[op.field] || op.field)}</strong><span>${op.status === 'applied' ? 'Применено' : 'Предложение'}</span></label><div class="agent-v2-patch-values"><div><strong>Было</strong><p>${escapeHtml(valueText(op.before)) || '—'}</p></div><div><strong>Предлагается</strong><p>${escapeHtml(valueText(op.after)) || '—'}</p></div></div><p>${escapeHtml(op.reason)}</p>${op.source_refs?.length ? `<small>Основания: ${escapeHtml(op.source_refs.map(ref => sourceLabel(state, ref)).join(', '))}</small>` : ''}</article>`).join('')}${actionable ? `<button type="submit" class="btn btn-secondary">${guided ? 'Принять выбранные правки' : 'Применить выбранные правки'}</button>${guided ? `<button type="button" class="btn btn-ghost" data-dismiss-proposal="${escapeHtml(proposal.id)}">Оставить мой текст</button>` : ''}` : ''}</form>`;
  }).join('')}</section>`;
}

export function renderDraftControls(state, { locked = false } = {}) {
  if (locked) return '';
  return `<section class="agent-v2-card"><h3>Написать и уточнить БТ</h3><form id="agent-v2-document-instruction"><label>Задача для помощника<textarea class="input ui-control" name="instruction" rows="3" maxlength="4000" placeholder="Опишите ожидаемое изменение или задайте вопрос по конкретному разделу"></textarea></label><div class="agent-v2-action-row"><button class="ui-btn btn btn-ai" type="submit" name="action" value="draft"><i data-lucide="sparkles" aria-hidden="true"></i>Сформировать черновик</button>${state.draft ? '<button class="ui-btn btn btn-ai" type="submit" name="action" value="propose_change"><i data-lucide="sparkles" aria-hidden="true"></i>Предложить правку</button>' : ''}</div></form><p class="agent-v2-muted">Предложенный текст попадёт в документ после вашего принятия.</p></section>`;
}

const REVISION_METADATA = new Set(['schema', 'schema_version', 'id', 'artifact_id', 'artifact_type', 'product_mode', 'revision', 'fingerprint', 'prompt_set_version', 'prompt_version', 'prompt_metadata', 'model', 'model_version', 'provider', 'created_at', 'updated_at', 'generated_at', 'linked_object', 'linked_object_snapshot', 'linked_snapshot', 'linked_snapshot_fingerprint', 'source_fingerprint']);

export function renderRequirementSnapshot(snapshot = {}) {
  const entries = Object.entries(snapshot);
  const renderEntries = items => items.map(([field, value]) => `<section class="agent-v2-section"><h3>${escapeHtml(DOCUMENT_LABELS[field] || field)}</h3><div class="agent-v2-section-value">${escapeHtml(valueText(value)) || 'Не указано'}</div></section>`).join('');
  const business = entries.filter(([field]) => !REVISION_METADATA.has(field));
  const metadata = entries.filter(([field]) => REVISION_METADATA.has(field));
  return `<div class="requirement-review-snapshot">${renderEntries(business)}${metadata.length ? `<details class="requirement-review-metadata"><summary>Сведения о редакции</summary>${renderEntries(metadata)}</details>` : ''}</div>`;
}

const COMPARISON_METADATA = REVISION_METADATA;
function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, comparable(value[key])]));
  return value ?? null;
}

export function compareDocumentSnapshots(previous = {}, current = {}) {
  return [...new Set([...Object.keys(previous || {}), ...Object.keys(current || {})])]
    .filter(field => !COMPARISON_METADATA.has(field) && JSON.stringify(comparable(previous?.[field])) !== JSON.stringify(comparable(current?.[field])))
    .map(field => ({ field, before: previous?.[field], after: current?.[field] }));
}

export function renderDocumentComparison(previousReview, currentDraft) {
  if (!previousReview?.artifact_snapshot || !currentDraft) return '';
  const differences = compareDocumentSnapshots(previousReview.artifact_snapshot, currentDraft);
  return `<details class="agent-v2-card agent-v2-version-comparison"><summary>Изменения относительно отправленной редакции ${escapeHtml(previousReview.artifact_revision)} (${differences.length})</summary>${previousReview.comment ? `<p><strong>Замечания человека:</strong> ${escapeHtml(previousReview.comment)}</p>` : ''}${differences.length ? differences.map(item => `<article class="agent-v2-patch"><h4>${escapeHtml(DOCUMENT_LABELS[item.field] || item.field)}</h4><div class="agent-v2-patch-values"><div><strong>Отправлено</strong><p>${escapeHtml(valueText(item.before)) || 'Не указано'}</p></div><div><strong>Текущая редакция</strong><p>${escapeHtml(valueText(item.after)) || 'Не указано'}</p></div></div></article>`).join('') : '<p>Содержание документа не изменилось.</p>'}</details>`;
}
