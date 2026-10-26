import { escapeHtml } from '../htmlUtils.js';

export const REQUEST_STATUS = Object.freeze({
  completed: { label: 'Выполнен', badge: 'badge-status-done', group: 'done' },
  not_relevant: { label: 'Не актуален', badge: 'badge-low', group: 'closed' },
  task_rejected: { label: 'Задача отклонена', badge: 'badge-danger', group: 'closed' },
  task_deleted: { label: 'Задача удалена', badge: 'badge-warning', group: 'closed' },
  draft: { label: 'Черновик', badge: 'badge-low', group: 'action' },
  submitted: { label: 'Ожидает ревью', badge: 'badge-info', group: 'review' },
  in_review: { label: 'На ревью', badge: 'badge-medium', group: 'review' },
  returned: { label: 'Требуется уточнение', badge: 'badge-warning', group: 'action' },
  in_progress: { label: 'В проработке', badge: 'badge-warning', group: 'work' },
  approved: { label: 'Завершён', badge: 'badge-success', group: 'done' },
  rejected: { label: 'Отклонён', badge: 'badge-danger', group: 'closed' },
});

const TASK_STAGE = Object.freeze({
  'ВЫПОЛНЕНА': { label: 'Выполнен', badge: 'badge-status-done', group: 'done' },
  'ОТКЛОНЕНА': { label: 'Отклонён', badge: 'badge-danger', group: 'closed' },
  'НЕ АКТУАЛЬНА': { label: 'Не актуален', badge: 'badge-low', group: 'closed' },
  'ПРИНЯТА В РАБОТУ': { label: 'В реализации', badge: 'badge-status-in_progress', group: 'work' },
  'ХОЛД': { label: 'Приостановлен', badge: 'badge-status-on_hold', group: 'action' },
});

const INTENTS = Object.freeze({
  feature: 'Новая возможность',
  change: 'Изменение',
  problem: 'Проблема',
  incident: 'Инцидент',
  clarification: 'Уточнение',
});

const SIGNAL_FIELD_LABELS = Object.freeze({
  dependencies: 'зависимости от других систем или команд',
  risks: 'возможные риски',
  regulatory_flags: 'регуляторные ограничения',
  current_process: 'текущий процесс',
  target_process: 'целевой процесс',
  acceptance_criteria: 'критерии приёмки',
  data_integrations: 'данные и интеграции',
  business_rules: 'бизнес-правила',
  user_roles: 'пользователи решения',
});

const REQUEST_SECTION_IDS = Object.freeze({
  problem_statement: 'request-section-problem',
  current_process: 'request-section-current-process',
  target_process: 'request-section-target-process',
  business_value: 'request-section-business-value',
  user_roles: 'request-section-user-roles',
  primary_role: 'request-section-primary-role',
  affected_users: 'request-section-user-roles',
  process: 'request-section-process',
  department: 'request-section-department',
  priority: 'request-section-priority',
  product: 'request-section-product',
  module: 'request-section-product',
  acceptance_criteria: 'request-section-acceptance-criteria',
  scenarios: 'request-section-scenarios',
  business_rules: 'request-section-business-rules',
  data_integrations: 'request-section-data-integrations',
  dependencies: 'request-section-dependencies',
  risks: 'request-section-risks',
  regulatory_flags: 'request-section-regulatory',
  sources: 'request-section-sources',
});

const REQUIREMENT_FIELD_LABELS = Object.freeze({
  title: 'Название', problem_statement: 'Потребность', current_process: 'Текущий процесс',
  target_process: 'Целевой процесс', business_value: 'Бизнес-ценность', process: 'Бизнес-процесс',
  primary_role: 'Основная роль', affected_users: 'Затронутые пользователи', user_roles: 'Пользователи',
  department: 'Подразделение', product: 'Продукт', module: 'Модуль', priority: 'Приоритет',
  scenarios: 'Сценарии', business_rules: 'Бизнес-правила', data_integrations: 'Данные и интеграции',
  acceptance_criteria: 'Критерии приёмки', risks: 'Риски', dependencies: 'Зависимости',
  regulatory_flags: 'Регуляторные аспекты', assumptions: 'Допущения', assumption_details: 'Реестр допущений',
  conflicts: 'Противоречия', conflict_history: 'История противоречий', gaps: 'Пробелы',
  open_questions: 'Открытые вопросы', open_question_details: 'Уточнения по разделам',
  quality_issues: 'Замечания к качеству', review_findings: 'Независимая проверка', sources: 'Источники',
  field_provenance: 'Происхождение формулировок', field_confidence: 'Уверенность по разделам',
  field_status: 'Состояния разделов', completeness_score: 'Полнота', quality_score: 'Качество',
  quality_level: 'Уровень качества', quality_profile: 'Профиль проверки', confidence: 'Уверенность',
  intent: 'Тип обращения', review_blocked: 'Блокировка отправки', status: 'Статус черновика',
  id: 'Номер черновика', created_by: 'Автор', duplicates: 'Похожие требования',
});

export function toList(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : value ? [String(value)] : [];
}

export function getRequestStage(item = {}) {
  if (['completed', 'not_relevant', 'task_rejected', 'task_deleted', 'rejected'].includes(item.status)) return REQUEST_STATUS[item.status];
  if (item.task_status && TASK_STAGE[item.task_status]) return TASK_STAGE[item.task_status];
  return REQUEST_STATUS[item.status] || { label: 'В обработке', badge: 'badge-medium', group: 'work' };
}

export function renderRequestStatusBadge(item = {}) {
  const stage = getRequestStage(item);
  return `<span class="badge ${stage.badge}">${escapeHtml(stage.label)}</span>`;
}

export function renderRequestJourney(item = {}) {
  const status = item.status || 'draft';
  const taskDone = getRequestStage(item).group === 'done';
  const current = status === 'draft' ? 0 : ['submitted', 'in_review', 'returned'].includes(status) ? 1 : status === 'in_progress' && !taskDone ? 2 : 3;
  const completeThrough = status === 'rejected' ? 1 : current - 1;
  const labels = ['Создан', status === 'returned' ? 'Уточнение' : 'Ревью', 'Проработка', status === 'rejected' ? 'Отклонён' : ['completed', 'not_relevant', 'task_rejected', 'task_deleted'].includes(status) ? getRequestStage(item).label : taskDone ? 'Завершён' : 'Результат'];
  return `<nav class="review-journey request-journey${status === 'rejected' ? ' is-rejected' : ''}" aria-label="Путь запроса"><span class="request-journey-mobile">Этап ${current + 1} из 4 · ${escapeHtml(labels[current])}</span>${labels.map((label, index) => {
    const classes = [index <= completeThrough ? 'is-complete' : '', index === current ? 'is-current' : '', index > completeThrough && index < current ? 'is-skipped' : '', index === current && status === 'rejected' ? 'is-terminal' : ''].filter(Boolean).join(' ');
    return `<div class="${classes}"${index === current ? ' aria-current="step"' : ''}><span>${index <= completeThrough ? '<i data-lucide="check"></i>' : index + 1}</span><strong>${label}</strong></div>`;
  }).join('')}</nav>`;
}

export function renderRequestSummary(item = {}) {
  const stage = getRequestStage(item);
  const owner = requestOwner(item, stage);
  const updatedAt = item.updated_at || item.created_at;
  const reviewDeadline = item.review_deadline || item.sla_deadline;
  const expectedResult = item.expected_at || item.expected_date || item.task_deadline || item.draft?.expected_date;
  const dateSummary = reviewDeadline
    ? summaryItem('Срок ревью', formatDate(reviewDeadline, false), 'calendar')
    : expectedResult
      ? summaryItem(item.task_deadline ? 'Срок задачи' : 'Желаемый результат', formatDate(expectedResult, false), 'calendar')
      : item.stage_started_at
        ? summaryItem('Текущий этап с', formatDate(item.stage_started_at, false), 'calendar-clock')
        : '';
  return `<section class="request-summary" aria-label="Сводка по запросу">
    ${summaryItem('Ответственный', owner, 'user-check')}
    ${summaryItem('Последнее событие', `${requestEventLabel(item, stage)}${updatedAt ? ` · ${formatDate(updatedAt)}` : ''}`, 'history')}
    ${dateSummary}
  </section>`;
}

export function renderRequestHistory(item = {}) {
  const events = normalizeHistory(item);
  return `<section class="card request-history-card"><div class="card-header"><div><h2 class="card-title">Ключевые события</h2><p class="review-card-subtitle">Решения и изменения по запросу</p></div></div><div class="card-body request-history">${events.map(event => `<article><span class="request-history-marker"><i data-lucide="${escapeHtml(event.icon)}"></i></span><div><div class="request-history-heading"><strong>${escapeHtml(event.title)}</strong><time>${escapeHtml(formatDate(event.at))}</time></div><p>${escapeHtml(event.description)}</p><small>${escapeHtml(event.actor)}</small></div></article>`).join('')}</div></section>${renderRequestRevisionHistory(item)}`;
}

export function renderLatestRevisionDiff(item = {}, { compact = false } = {}) {
  const revisions = Array.isArray(item.revision_history) ? item.revision_history : [];
  if (revisions.length < 2) return '';
  const previous = revisions.at(-2)?.draft || {};
  const current = revisions.at(-1)?.draft || {};
  const keys = [...new Set([...Object.keys(previous), ...Object.keys(current)])]
    .filter(key => JSON.stringify(previous[key] ?? null) !== JSON.stringify(current[key] ?? null));
  if (!keys.length) return '';
  const rows = keys.map(key => `<article><h3>${escapeHtml(REQUIREMENT_FIELD_LABELS[key] || key)}</h3><div><span>Было</span><p>${escapeHtml(readableValue(previous[key]) || 'Не заполнено')}</p></div><div><span>Стало</span><p>${escapeHtml(readableValue(current[key]) || 'Не заполнено')}</p></div></article>`).join('');
  if (compact) return `<div class="request-revision-diff is-compact"><strong>Изменено в редакции ${escapeHtml(revisions.at(-1)?.revision || revisions.length)}</strong>${rows}</div>`;
  return `<section class="card request-revision-diff"><div class="card-header"><div><h2 class="card-title">Что изменилось</h2><p class="review-card-subtitle">Сравнение с предыдущей отправленной редакцией</p></div></div><div class="card-body">${rows}</div></section>`;
}

export function renderRequestRevisionHistory(item = {}) {
  const revisions = Array.isArray(item.revision_history) ? item.revision_history : [];
  if (!revisions.length) return '';
  return `<section class="card request-history-card"><div class="card-header"><h2 class="card-title">Отправленные редакции</h2></div><div class="card-body">${revisions.map((revision, index) => {
    const draft = revision.draft || {};
    const previous = index ? revisions[index - 1].draft || {} : null;
    const changed = previous ? [...new Set([...Object.keys(previous), ...Object.keys(draft)])].filter(key => JSON.stringify(previous[key]) !== JSON.stringify(draft[key])) : [];
    return `<details class="review-more"><summary>Редакция ${escapeHtml(revision.revision || index + 1)} · ${escapeHtml(formatDate(revision.created_at))}</summary><div class="card-body">${revision.legacy_snapshot ? '<p>Сохранённый снимок прежнего запроса. Более ранние редакции недоступны.</p>' : ''}<p>${escapeHtml(revision.author_name || '')}</p>${changed.length ? `<p><strong>Изменено:</strong> ${changed.map(key => escapeHtml(REQUIREMENT_FIELD_LABELS[key] || key)).join(', ')}</p>` : previous ? '<p>Формулировки отправлены повторно без изменений.</p>' : ''}<dl>${Object.entries(draft).filter(([, value]) => value !== null && value !== '' && JSON.stringify(value) !== '[]' && JSON.stringify(value) !== '{}').map(([key, value]) => `<dt><strong>${escapeHtml(REQUIREMENT_FIELD_LABELS[key] || key)}</strong></dt><dd style="white-space:pre-wrap">${escapeHtml(readableValue(value))}</dd>`).join('')}</dl></div></details>`;
  }).reverse().join('')}</div></section>`;
}

export function renderRequestParticipants(item = {}) {
  return `<details class="card review-more request-participants-card"><summary>Участники и даты <span>Справочная информация</span><i data-lucide="chevron-down"></i></summary><div class="card-body request-participants">
    ${participant('Заказчик', item.author_name || '—')}
    ${participant('Команда', item.team_name || 'Назначается')}
    ${participant('Ревьюер', item.reviewer_name || 'Не назначен')}
    ${participant('Аналитик', item.assignee_name || 'Не назначен')}
    ${participant('Создан', formatDate(item.created_at))}
    ${participant('Обновлён', formatDate(item.updated_at))}
  </div></details>`;
}

export function hasStructuredDraft(draft = {}) {
  return ['problem_statement', 'current_process', 'target_process', 'business_value', 'user_roles', 'product', 'module', 'acceptance_criteria'].some(key => toList(draft?.[key]).length);
}

export function renderLegacyRequestDescription(description, { supplemental = false } = {}) {
  const text = String(description || '').trim();
  if (!text) return '';
  if (supplemental) {
    return `<details class="card review-more request-legacy-description"><summary>Исходное описание <span>Полный сохранённый текст</span><i data-lucide="chevron-down"></i></summary><div class="card-body"><p>${escapeHtml(text)}</p></div></details>`;
  }
  return `<section class="card request-legacy-description"><div class="card-header"><div><h2 class="card-title">Исходное описание</h2><p class="review-card-subtitle">Структурированный паспорт для этой записи отсутствует</p></div></div><div class="card-body"><p>${escapeHtml(text)}</p></div></section>`;
}

export function signalGroups(draft = {}) {
  const values = value => Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
  const seen = new Set();
  return [
    ['Открытые вопросы', values(draft.open_questions)],
    ['Противоречия', values(draft.conflicts)],
    ['Риски', draft.field_status?.risks === 'not_applicable' ? [] : values(draft.risks)],
    ['Допущения', values(draft.assumptions)],
    ['Замечания к качеству', values(draft.quality_issues)],
    ['Независимая проверка', values(draft.review_findings)],
    ['Пробелы', values(draft.gaps).filter(item => !['resolved', 'closed', 'not_applicable'].includes(item.status))],
  ].map(([label, items]) => [label, items.filter(item => {
    if (item && typeof item === 'object' && ['resolved', 'closed', 'not_applicable'].includes(String(item.status || '').toLowerCase())) return false;
    const key = signalText(item).trim().toLocaleLowerCase('ru');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  })]).filter(([, items]) => items.length);
}

export function signalCount(draft = {}) {
  return signalGroups(draft).reduce((total, [, values]) => total + values.length, 0);
}

export function humanizeSignal(value) {
  const text = signalText(value);
  const match = text.match(/^Требуется уточнение:\s*([a-z_]+)$/i);
  if (!match) return text;
  return `Нужно уточнить ${SIGNAL_FIELD_LABELS[match[1]] || 'один из разделов запроса'}`;
}

export function getSignalTarget(value, groupLabel = '') {
  const normalizedSection = signalFieldKey(value);
  if (normalizedSection && REQUEST_SECTION_IDS[normalizedSection]) return REQUEST_SECTION_IDS[normalizedSection];
  const text = signalText(value);
  const explicit = text.match(/^Требуется уточнение:\s*([a-z_]+)$/i)?.[1];
  if (explicit && REQUEST_SECTION_IDS[explicit]) return REQUEST_SECTION_IDS[explicit];
  const groupTarget = {
    'Риски': 'risks',
    'Допущения': 'target_process',
    'Противоречия': 'problem_statement',
  }[groupLabel];
  if (groupTarget) return REQUEST_SECTION_IDS[groupTarget];
  const normalized = `${groupLabel} ${text}`.toLocaleLowerCase('ru');
  const rules = [
    [/критери|при.мк/, 'acceptance_criteria'],
    [/интеграц|данн/, 'data_integrations'],
    [/зависим/, 'dependencies'],
    [/регулятор|закон|норматив/, 'regulatory_flags'],
    [/бизнес.?правил/, 'business_rules'],
    [/пользовател|роль/, 'user_roles'],
    [/текущ|as-is/, 'current_process'],
    [/целев|to-be|допущен/, 'target_process'],
    [/сценар/, 'scenarios'],
    [/риск/, 'risks'],
    [/ценност|эффект/, 'business_value'],
    [/продукт|модул/, 'product'],
  ];
  return REQUEST_SECTION_IDS[rules.find(([pattern]) => pattern.test(normalized))?.[1]] || REQUEST_SECTION_IDS.problem_statement;
}

export function renderRequirementSections(draft = {}) {
  const fields = [
    ['problem_statement', 'Проблема / потребность', 'alert-circle'], ['process', 'Бизнес-процесс', 'workflow'],
    ['current_process', 'Текущий процесс (As-Is)', 'history'], ['target_process', 'Целевой процесс (To-Be)', 'flag'],
    ['business_value', 'Бизнес-ценность', 'trending-up'], ['primary_role', 'Основная роль', 'user'],
    ['affected_users', 'Затронутые пользователи', 'users'], ['department', 'Подразделение', 'building'],
    ['priority', 'Приоритет', 'flag'], ['product', 'Продукт и модуль', 'boxes'],
  ];
  return `<section class="card request-passport-card"><div class="card-header"><div><h2 class="card-title">Паспорт запроса</h2><p class="review-card-subtitle">Отправленная заказчиком редакция; источники и допущения доступны у разделов</p></div></div><div class="card-body review-requirement-grid request-requirement-grid">${fields.map(([key, label, icon]) => field(label, key === 'affected_users' ? draft.affected_users?.length ? draft.affected_users : draft.user_roles : key === 'product' ? [draft.product, draft.module].filter(Boolean) : draft[key], icon, REQUEST_SECTION_IDS[key], draft, key)).join('')}</div></section>
  ${listSection('Критерии приёмки', draft.acceptance_criteria, REQUEST_SECTION_IDS.acceptance_criteria, draft, 'acceptance_criteria')}${extraDetails(draft)}`;
}

export function renderCustomerClarifications(draft = {}) {
  const groups = signalGroups(draft).map(([label, values]) => [label, values.map(humanizeSignal)]);
  if (!groups.length) return '';
  return `<section class="card customer-clarifications"><div class="card-header"><div><h2 class="card-title">Что ещё стоит уточнить</h2><p class="review-card-subtitle">Вопросы, которые помогут команде точнее понять запрос</p></div><span class="review-attention-count">${groups.reduce((total, [, values]) => total + values.length, 0)}</span></div><div class="card-body">${groups.map(([label, values]) => `<div class="review-issue-group"><h3>${escapeHtml(label)}</h3><ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul></div>`).join('')}</div></section>`;
}

export function renderCustomerAssistantDetails(draft = {}) {
  const completeness = numericScore(draft.completeness_score);
  const quality = numericScore(draft.quality_score);
  const confidence = ({ high: 'Высокая', medium: 'Средняя', low: 'Низкая' })[draft.confidence] || 'Не определена';
  const intent = INTENTS[draft.intent] || draft.intent || 'Не определён';
  if (completeness === null && quality === null && confidence === 'Не определена' && intent === 'Не определён') return '';
  return `<details class="card review-more customer-assistant-details"><summary>Как сформирован запрос <span>Справочная информация</span><i data-lucide="chevron-down"></i></summary><div class="card-body customer-assistant-summary">${assistantFact('Полнота данных', completeness === null ? 'Не рассчитана' : `${completeness}%`)}${assistantFact('Качество формулировок', quality === null ? 'Не рассчитано' : `${quality}%`)}${assistantFact('Уверенность ассистента', confidence)}${assistantFact('Тип обращения', intent)}</div></details>`;
}

function field(label, value, icon, id, draft = {}, key = '') {
  const list = toList(value);
  return `<article id="${id}" class="request-passport-section request-field-${escapeHtml(key)}" tabindex="-1"><div class="review-field-label"><i data-lucide="${icon}"></i>${escapeHtml(label)}</div>${list.length ? (list.length === 1 ? `<p>${escapeHtml(list[0])}</p>` : `<ul>${list.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`) : '<p class="text-muted">Не уточнено</p>'}${renderFieldEvidence(draft, key)}</article>`;
}

function listSection(title, values, id, draft = {}, key = '') {
  const list = toList(values);
  return `<section id="${id}" class="card request-passport-card request-passport-section" tabindex="-1"><div class="card-header"><h2 class="card-title">${escapeHtml(title)}</h2></div><div class="card-body"><div class="review-check-list">${list.length ? list.map(item => `<div><i data-lucide="circle"></i><span>${escapeHtml(item)}</span></div>`).join('') : '<p class="text-muted">Не сформулированы</p>'}</div>${renderFieldEvidence(draft, key)}</div></section>`;
}

function renderFieldEvidence(draft, key) {
  const evidence = draft.field_provenance?.[key];
  const status = draft.field_status?.[key] || evidence?.status;
  const confidence = draft.field_confidence?.[key];
  if (!evidence && !status && confidence === undefined) return '';
  const statusLabel = ({ not_applicable: 'Не применимо', unknown: 'Требует уточнения', skipped: 'Пропущено', empty: 'Не заполнено', filled: 'Заполнено' })[status] || '';
  const source = ({ user: 'Заказчик', user_message: 'Сообщение заказчика', model: 'Вывод ассистента', llm_extraction: 'Извлечено ассистентом', knowledge_base: 'База знаний', assumption: 'Допущение' })[evidence?.source] || evidence?.source || 'Не указан';
  const certainty = evidence?.assumption ? 'Допущение, требуется проверка' : evidence?.confirmed === true ? 'Подтверждено заказчиком' : evidence ? 'Отдельное подтверждение не зафиксировано' : '';
  const claims = Array.isArray(evidence?.claims) ? evidence.claims : [];
  return `<details class="request-field-evidence"><summary>Источник и проверка${statusLabel ? ` · ${escapeHtml(statusLabel)}` : ''}</summary><p>Источник: ${escapeHtml(source)}. ${escapeHtml(certainty)}${Number.isFinite(Number(confidence)) ? ` · Уверенность: ${Math.round(Number(confidence) * 100)}%` : ''}</p>${evidence?.evidence ? `<blockquote>${escapeHtml(readableValue(evidence.evidence))}</blockquote>` : ''}${evidence?.message_id ? `<small>Сообщение: ${escapeHtml(evidence.message_id)}</small>` : ''}${claims.length ? `<ul>${claims.map(claim => `<li>${escapeHtml(claim.value || '')}${claim.assumption ? ' · Допущение' : ''}${claim.evidence ? `<blockquote>${escapeHtml(readableValue(claim.evidence))}</blockquote>` : ''}${claim.message_id ? `<small>Сообщение: ${escapeHtml(claim.message_id)}</small>` : ''}</li>`).join('')}</ul>` : ''}</details>`;
}

function readableValue(value) {
  if (Array.isArray(value)) return value.map(readableValue).join('\n');
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value ?? '');
}

function renderSource(source) {
  const title = source.title || source.source || 'Источник';
  let url = '';
  try { const candidate = new URL(source.uri || ''); if (['https:', 'http:'].includes(candidate.protocol)) url = candidate.href; } catch (_) { /* local KB reference */ }
  return `<li>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>` : escapeHtml(title)}${source.version ? ` · версия ${escapeHtml(source.version)}` : ''}${source.section ? ` · ${escapeHtml(source.section)}` : ''}${source.text ? `<blockquote>${escapeHtml(source.text)}</blockquote>` : ''}</li>`;
}

function extraDetails(draft) {
  const requestedFields = new Set(signalGroups(draft).flatMap(([, values]) => values.map(signalFieldKey).filter(Boolean)));
  const groups = [
    ['Сценарии', 'scenarios', draft.scenarios],
    ['Бизнес-правила', 'business_rules', draft.business_rules],
    ['Данные и интеграции', 'data_integrations', draft.data_integrations],
    ['Зависимости', 'dependencies', draft.dependencies],
    ['Риски', 'risks', draft.risks],
    ['Регуляторные аспекты', 'regulatory_flags', draft.regulatory_flags],
  ].filter(([, key, value]) => displayList(value).length || requestedFields.has(key));
  const sources = Array.isArray(draft.sources) ? draft.sources : [];
  if (!groups.length && !sources.length) return '';
  const count = groups.length + (sources.length ? 1 : 0);
  return `<section class="card request-passport-more"><div class="card-header"><div><h2 class="card-title">Дополнительные материалы</h2><p class="review-card-subtitle">${count} ${count === 1 ? 'раздел' : count < 5 ? 'раздела' : 'разделов'} · существенные ограничения и основания решения</p></div></div><div class="card-body review-more-grid">${groups.map(([label, key, value]) => { const items = displayList(value); return `<div id="${REQUEST_SECTION_IDS[key]}" class="request-passport-section" tabindex="-1"><h3>${escapeHtml(label)}</h3>${items.length ? `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="text-muted">Не уточнено</p>'}${renderFieldEvidence(draft, key)}</div>`; }).join('')}${sources.length ? `<div class="request-source-list"><h3>Источники базы знаний</h3><ul>${sources.map(renderSource).join('')}</ul></div>` : ''}</div></section>`;
}

function requestOwner(item, stage) {
  if (item.status === 'returned') return item.author_name || 'Заказчик';
  if (stage.group === 'review') return item.reviewer_name || item.team_name || 'Команда ревью';
  if (item.task_id || ['work', 'done', 'closed'].includes(stage.group)) return item.assignee_name || item.team_name || item.reviewer_name || 'Команда запроса';
  return item.author_name || 'Заказчик';
}

function requestEventLabel(item, stage) {
  if (item.status === 'returned') return 'Запрошено уточнение';
  if (item.status === 'rejected') return 'Принято решение';
  if (stage.group === 'done') return 'Работа завершена';
  if (item.task_id) return 'Обновлена реализация';
  if (item.status === 'in_review') return 'Начато ревью';
  if (item.status === 'submitted') return 'Отправлен на ревью';
  return 'Запрос обновлён';
}

function normalizeHistory(item) {
  const supplied = [item.status_history, item.history, item.draft?.history].find(Array.isArray) || [];
  const normalized = supplied.map(event => ({
    title: event.title || event.action || event.status_label || 'Запрос обновлён',
    description: event.description || event.comment || event.message || 'Изменены данные запроса',
    actor: event.actor_name || event.author_name || event.actor || event.role || 'Команда',
    at: event.legacy_event ? null : event.created_at || event.at || event.date || item.updated_at || item.created_at,
    legacy: Boolean(event.legacy_event),
    icon: event.icon || 'history',
  })).filter(event => event.at || event.legacy);
  if (normalized.length) return normalized.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const events = [];
  if (item.status && item.status !== 'draft' && (item.updated_at || item.created_at)) events.push({ title: requestEventLabel(item, getRequestStage(item)), description: item.reject_reason || historyDescription(item), actor: historyActor(item), at: item.updated_at || item.created_at, icon: item.status === 'returned' ? 'message-circle-warning' : item.status === 'rejected' ? 'x-circle' : 'refresh-cw' });
  events.push({ title: 'Запрос создан', description: 'Потребность сформулирована и сохранена в системе', actor: item.author_name || 'Заказчик', at: item.created_at || item.updated_at, icon: 'plus-circle' });
  return events.filter(event => event.at);
}

function historyDescription(item) {
  if (item.status === 'in_review') return 'Запрос принят в работу на этапе ревью';
  if (item.task_id) return `Запрос связан с задачей #${item.task_id}`;
  return 'Актуализированы сведения по запросу';
}

function historyActor(item) {
  if (item.status === 'returned' || item.status === 'rejected' || item.status === 'in_review') return item.reviewer_name || 'Команда ревью';
  return item.assignee_name || item.team_name || 'Команда';
}

function signalText(value) {
  if (value && typeof value === 'object') {
    return String(value.text || value.message || value.question || value.value || '').trim();
  }
  return String(value || '').trim();
}

function signalFieldKey(value) {
  const explicitSection = typeof value === 'object' && value
    ? value.section_key || value.field || value.target_section || value.slot
    : signalText(value).match(/^Требуется уточнение:\s*([a-z_]+)$/i)?.[1] || '';
  return ({ need_statement: 'problem_statement', as_is: 'current_process', to_be: 'target_process', value: 'business_value', role: 'primary_role', users: 'affected_users' })[explicitSection] || explicitSection;
}

function displayList(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map(signalText).filter(Boolean);
}

function summaryItem(label, value, icon) {
  return `<div><span class="request-summary-icon"><i data-lucide="${icon}"></i></span><span><small>${escapeHtml(label)}</small><strong>${escapeHtml(value || '—')}</strong></span></div>`;
}

function participant(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`;
}

function formatDate(value, includeTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ru-RU', includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

export function numericScore(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
}

function assistantFact(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}
