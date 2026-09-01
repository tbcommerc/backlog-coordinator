import { escapeHtml } from '../htmlUtils.js';

export const REQUEST_STATUS = Object.freeze({
  draft: { label: 'Черновик', badge: 'badge-low', group: 'action' },
  submitted: { label: 'Ожидает ревью', badge: 'badge-info', group: 'review' },
  in_review: { label: 'На ревью', badge: 'badge-medium', group: 'review' },
  returned: { label: 'Требуется уточнение', badge: 'badge-warning', group: 'action' },
  in_progress: { label: 'В проработке', badge: 'badge-warning', group: 'work' },
  approved: { label: 'Запланирован', badge: 'badge-success', group: 'work' },
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
  product: 'request-section-product',
  module: 'request-section-product',
  acceptance_criteria: 'request-section-acceptance-criteria',
  scenarios: 'request-section-scenarios',
  business_rules: 'request-section-business-rules',
  data_integrations: 'request-section-data-integrations',
  dependencies: 'request-section-dependencies',
  risks: 'request-section-risks',
  regulatory_flags: 'request-section-regulatory',
});

export function toList(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : value ? [String(value)] : [];
}

export function getRequestStage(item = {}) {
  if (item.task_status && TASK_STAGE[item.task_status]) return TASK_STAGE[item.task_status];
  if (item.task_id && item.status === 'in_progress' && Number(item.task_progress) >= 100) return TASK_STAGE['ВЫПОЛНЕНА'];
  return REQUEST_STATUS[item.status] || { label: 'В обработке', badge: 'badge-medium', group: 'work' };
}

export function renderRequestStatusBadge(item = {}) {
  const stage = getRequestStage(item);
  return `<span class="badge ${stage.badge}">${escapeHtml(stage.label)}</span>`;
}

export function renderRequestJourney(item = {}) {
  const status = item.status || 'draft';
  const taskDone = item.task_status === 'ВЫПОЛНЕНА' || (item.task_id && Number(item.task_progress) >= 100);
  const current = status === 'draft' ? 0 : ['submitted', 'in_review', 'returned'].includes(status) ? 1 : status === 'in_progress' && !taskDone ? 2 : 3;
  const completeThrough = status === 'rejected' ? 1 : current - 1;
  const labels = ['Создан', status === 'returned' ? 'Уточнение' : 'Ревью', 'Проработка', status === 'rejected' ? 'Отклонён' : taskDone ? 'Завершён' : 'Результат'];
  return `<nav class="review-journey request-journey${status === 'rejected' ? ' is-rejected' : ''}" aria-label="Путь запроса">${labels.map((label, index) => {
    const classes = [index <= completeThrough ? 'is-complete' : '', index === current ? 'is-current' : '', index > completeThrough && index < current ? 'is-skipped' : '', index === current && status === 'rejected' ? 'is-terminal' : ''].filter(Boolean).join(' ');
    return `<div class="${classes}"${index === current ? ' aria-current="step"' : ''}><span>${index <= completeThrough ? '<i data-lucide="check"></i>' : index + 1}</span><strong>${label}</strong></div>`;
  }).join('')}</nav>`;
}

export function renderRequestSummary(item = {}) {
  const stage = getRequestStage(item);
  const owner = requestOwner(item, stage);
  const updatedAt = item.updated_at || item.created_at;
  const deadline = item.sla_deadline || item.expected_at || item.expected_date || item.task_deadline || item.draft?.expected_date;
  return `<section class="request-summary" aria-label="Сводка по запросу">
    ${summaryItem('Статус', stage.label, 'activity')}
    ${summaryItem('Сейчас отвечает', owner, 'user-round-check')}
    ${summaryItem('Последнее событие', `${requestEventLabel(item, stage)}${updatedAt ? ` · ${formatDate(updatedAt)}` : ''}`, 'history')}
    ${summaryItem('Ожидаемый срок', deadline ? formatDate(deadline, false) : 'Срок уточняется', 'calendar-clock')}
  </section>`;
}

export function renderRequestHistory(item = {}) {
  const events = normalizeHistory(item);
  return `<section class="card request-history-card"><div class="card-header"><div><h2 class="card-title">Ключевые события</h2><p class="review-card-subtitle">Решения и изменения по запросу</p></div></div><div class="card-body request-history">${events.map(event => `<article><span class="request-history-marker"><i data-lucide="${escapeHtml(event.icon)}"></i></span><div><div class="request-history-heading"><strong>${escapeHtml(event.title)}</strong><time>${escapeHtml(formatDate(event.at))}</time></div><p>${escapeHtml(event.description)}</p><small>${escapeHtml(event.actor)}</small></div></article>`).join('')}</div></section>`;
}

export function renderRequestParticipants(item = {}) {
  return `<section class="card request-participants-card"><div class="card-header"><h2 class="card-title">Участники и сроки</h2></div><div class="card-body request-participants">
    ${participant('Заказчик', item.author_name || '—')}
    ${participant('Команда', item.team_name || 'Назначается')}
    ${participant('Ревьюер', item.reviewer_name || 'Не назначен')}
    ${participant('Аналитик', item.assignee_name || 'Не назначен')}
    ${participant('Создан', formatDate(item.created_at))}
    ${participant('Обновлён', formatDate(item.updated_at))}
  </div></section>`;
}

export function hasStructuredDraft(draft = {}) {
  return ['problem_statement', 'current_process', 'target_process', 'business_value', 'user_roles', 'product', 'module', 'acceptance_criteria'].some(key => toList(draft?.[key]).length);
}

export function signalGroups(draft = {}) {
  return [
    ['Открытые вопросы', toList(draft.open_questions)],
    ['Противоречия', (Array.isArray(draft.conflicts) ? draft.conflicts : draft.conflicts ? [draft.conflicts] : []).filter(Boolean).map(value => String(typeof value === 'object' ? value.message || JSON.stringify(value) : value))],
    ['Риски', toList(draft.risks)],
    ['Допущения', toList(draft.assumptions)],
  ].filter(([, values]) => values.length);
}

export function signalCount(draft = {}) {
  return signalGroups(draft).reduce((total, [, values]) => total + values.length, 0);
}

export function humanizeSignal(value) {
  const text = String(value || '').trim();
  const match = text.match(/^Требуется уточнение:\s*([a-z_]+)$/i);
  if (!match) return text;
  return `Нужно уточнить ${SIGNAL_FIELD_LABELS[match[1]] || 'один из разделов запроса'}`;
}

export function getSignalTarget(value, groupLabel = '') {
  const text = String(value || '').trim();
  const explicit = text.match(/^Требуется уточнение:\s*([a-z_]+)$/i)?.[1];
  if (explicit && REQUEST_SECTION_IDS[explicit]) return REQUEST_SECTION_IDS[explicit];
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
  return `<section class="card request-passport-card"><div class="card-header"><div><h2 class="card-title">Паспорт запроса</h2><p class="review-card-subtitle">Подтверждённая заказчиком формулировка потребности</p></div></div><div class="card-body review-requirement-grid request-requirement-grid">${field('Проблема / потребность', draft.problem_statement, 'alert-circle', REQUEST_SECTION_IDS.problem_statement)}${field('Текущий процесс (As-Is)', draft.current_process, 'history', REQUEST_SECTION_IDS.current_process)}${field('Целевой процесс (To-Be)', draft.target_process, 'flag', REQUEST_SECTION_IDS.target_process)}${field('Бизнес-ценность', draft.business_value, 'trending-up', REQUEST_SECTION_IDS.business_value)}${field('Пользователи', draft.user_roles, 'users', REQUEST_SECTION_IDS.user_roles)}${field('Продукт и модуль', [draft.product, draft.module].filter(Boolean), 'boxes', REQUEST_SECTION_IDS.product)}</div></section>
  ${listSection('Критерии приёмки', draft.acceptance_criteria, REQUEST_SECTION_IDS.acceptance_criteria)}${extraDetails(draft)}`;
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

function field(label, value, icon, id) {
  const list = toList(value);
  return `<article id="${id}" class="request-passport-section" tabindex="-1"><div class="review-field-label"><i data-lucide="${icon}"></i>${escapeHtml(label)}</div>${list.length ? (list.length === 1 ? `<p>${escapeHtml(list[0])}</p>` : `<ul>${list.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`) : '<p class="text-muted">Не уточнено</p>'}</article>`;
}

function listSection(title, values, id) {
  const list = toList(values);
  return `<section id="${id}" class="card request-passport-card request-passport-section" tabindex="-1"><div class="card-header"><h2 class="card-title">${escapeHtml(title)}</h2></div><div class="card-body"><div class="review-check-list">${list.length ? list.map(item => `<div><i data-lucide="circle"></i><span>${escapeHtml(item)}</span></div>`).join('') : '<p class="text-muted">Не сформулированы</p>'}</div></div></section>`;
}

function extraDetails(draft) {
  const requestedFields = new Set(signalGroups(draft).flatMap(([, values]) => values.map(value => String(value).match(/^Требуется уточнение:\s*([a-z_]+)$/i)?.[1]).filter(Boolean)));
  const groups = [
    ['Сценарии', 'scenarios', draft.scenarios],
    ['Бизнес-правила', 'business_rules', draft.business_rules],
    ['Данные и интеграции', 'data_integrations', draft.data_integrations],
    ['Зависимости', 'dependencies', draft.dependencies],
    ['Риски', 'risks', draft.risks],
    ['Регуляторные аспекты', 'regulatory_flags', draft.regulatory_flags],
  ].filter(([, key, value]) => toList(value).length || requestedFields.has(key));
  const sources = Array.isArray(draft.sources) ? draft.sources : [];
  if (!groups.length && !sources.length) return '';
  const count = groups.length + (sources.length ? 1 : 0);
  return `<details class="card review-more request-passport-more"><summary>Дополнительные материалы <span>${count} ${count === 1 ? 'раздел' : count < 5 ? 'раздела' : 'разделов'}</span><i data-lucide="chevron-down"></i></summary><div class="card-body review-more-grid">${groups.map(([label, key, value]) => `<div id="${REQUEST_SECTION_IDS[key]}" class="request-passport-section" tabindex="-1"><h3>${escapeHtml(label)}</h3>${toList(value).length ? `<ul>${toList(value).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="text-muted">Не уточнено</p>'}</div>`).join('')}${sources.length ? `<div><h3>Источники базы знаний</h3><ul>${sources.map(source => `<li>${escapeHtml(source.title || source.source || 'Источник')}</li>`).join('')}</ul></div>` : ''}</div></details>`;
}

function requestOwner(item, stage) {
  if (item.status === 'returned') return item.author_name || 'Заказчик';
  if (item.status === 'rejected' || stage.group === 'done' || stage.group === 'closed') return 'Этап завершён';
  if (stage.group === 'review') return item.reviewer_name || item.team_name || 'Команда ревью';
  if (item.task_id || stage.group === 'work') return item.assignee_name || item.team_name || 'Команда проработки';
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
    at: event.created_at || event.at || event.date || item.updated_at || item.created_at,
    icon: event.icon || 'history',
  })).filter(event => event.at);
  if (normalized.length) return normalized.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const events = [];
  if (item.updated_at && item.updated_at !== item.created_at) events.push({ title: requestEventLabel(item, getRequestStage(item)), description: item.reject_reason || historyDescription(item), actor: historyActor(item), at: item.updated_at, icon: item.status === 'returned' ? 'message-circle-warning' : item.status === 'rejected' ? 'x-circle' : 'refresh-cw' });
  events.push({ title: 'Запрос создан', description: 'Потребность сформулирована и сохранена в системе', actor: item.author_name || 'Заказчик', at: item.created_at || item.updated_at, icon: 'circle-plus' });
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

function numericScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
}

function assistantFact(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}
