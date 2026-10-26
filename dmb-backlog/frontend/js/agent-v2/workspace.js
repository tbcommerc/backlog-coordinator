import { sectionPresentation, renderGenerationReport } from './generation.js?v=2';
import { agentV2Api, requestKey } from './api.js?v=1';
import { renderBusinessRequirements, renderDocumentSources, renderDocumentReview, renderDocumentProposals, renderDraftControls, renderDocumentComparison, isReviewStale, isCurrentDraftApproved } from './documentReview.js?v=8';
import { requirementReviewsApi, loadLatestRequirementReview } from '../components/requirementReviews.js?v=4';
import { DOCUMENT_LABELS, formatDocumentDate, reviewStage } from './documentReview.js?v=8';
import { currentFindings, renderNextStep, renderApprovalPreview, submissionReadiness } from './journey.js?v=4';

const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const MODE_LABELS = {
  assignment_capture: 'Фиксация поручения',
  requirement_copilot: 'Рабочее место аналитика',
};

const ARTIFACT_LABELS = {
  assignment_passport: 'Паспорт поручения',
  business_requirement_v2: 'Бизнес-требование',
};

const FIELD_LABELS = {
  ...DOCUMENT_LABELS,
  assignment_statement: 'Формулировка поручения', expected_result: 'Ожидаемый результат',
  originator: 'Инициатор', deadline_or_urgency: 'Срок или срочность',
  owner_next_step: 'Следующий шаг', stakeholders: 'Заинтересованные стороны',
  initial_risks: 'Первичные риски',
};

const REQUIREMENT_SECTIONS = [
  ['problem_statement', 'need_statement'], ['business_goal', 'business_goal'],
  ['current_process', 'as_is'], ['target_process', 'to_be'],
  ['scope_in', 'scope_in'], ['scope_out', 'scope_out'],
  ['actors', 'actors'], ['primary_role', 'role'], ['process', 'process'],
  ['scenarios', 'scenarios'], ['alternative_scenarios', 'alternative_scenarios'],
  ['exception_scenarios', 'exception_scenarios'], ['business_rules', 'business_rules'],
  ['data_integrations', 'data_integrations'], ['functional_requirements', 'functional_requirements'],
  ['non_functional_requirements', 'non_functional_requirements'],
  ['acceptance_criteria', 'acceptance_criteria'], ['success_metrics', 'success_metrics'],
  ['constraints', 'constraints'], ['dependencies', 'dependencies'], ['risks', 'risks'], ['open_questions', 'open_questions'],
];

const CORE_REQUIREMENT_FIELDS = new Set([
  'problem_statement', 'business_goal', 'current_process', 'target_process',
  'scope_in', 'acceptance_criteria',
]);

const ASSIGNMENT_SECTIONS = [
  ['assignment_statement', 'assignment_statement'], ['business_goal', 'business_goal'],
  ['expected_result', 'expected_result'], ['scope_in', 'scope_in'], ['scope_out', 'scope_out'],
  ['originator', 'originator'], ['deadline_or_urgency', 'deadline_or_urgency'],
  ['owner_next_step', 'owner_next_step'], ['stakeholders', 'stakeholders'],
  ['constraints', 'constraints'], ['risks', 'initial_risks'],
];

const CODE_LABELS = {
  source_type_missing: 'Не указан тип источника', source_channel_missing: 'Не указан канал',
  final_summary_not_confirmed: 'Требуется итоговая проверка аналитиком',
  critical_gap_or_conflict_open: 'Есть критичный открытый вопрос или противоречие',
  acceptance_criteria_not_checkable: 'Критерии приёмки пока нельзя однозначно проверить',
  fingerprint_missing: 'Редакция не зафиксирована', fingerprint_invalid: 'Редакция изменилась',
};

let current = null;
let appRef = null;
let operationPending = false;
let activeHumanReview = null;
let humanReviewWarning = '';
// Keep drafts in memory across paints and SPA navigation, scoped to user/session.
const sectionDrafts = new Map();
let workspaceView = 'document';
let operationLabel = '';
let unloadGuardInstalled = false;
let saveTimer = null;
let saveFlight = null;
let saveError = null;
let saveConflict = false;
let conflictReviewed = false;
function draftKey() { return `${appRef?.store?.get('currentUser')?.id || ''}:${current?.session_id || ''}`; }
function localDrafts() {
  const key = draftKey();
  if (!sectionDrafts.has(key)) sectionDrafts.set(key, new Map());
  return sectionDrafts.get(key);
}
function rememberForm(form) {
  const input = form.querySelector('textarea');
  const previous = localDrafts().get(form.dataset.field);
  localDrafts().set(form.dataset.field, { value: input.value, dirty: input.value !== input.defaultValue,
    baseHash: previous?.dirty ? previous.baseHash : current?.draft?.fingerprint || '' });
  updateSaveStatus();
  if (current?.product_mode === 'requirement_copilot' && !saveConflict) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { flushEdits().catch(() => {}); }, 800);
  }
}
function updateSaveStatus() {
  const status = document.getElementById('agent-v2-save-status');
  if (status) {
    status.replaceChildren(document.createTextNode(saveError ? conflictReviewed ? 'Актуальная редакция загружена. Сравните текст документа с вашей формой и выберите, сохранять ли ваши правки. ' : `Не удалось сохранить: ${errorText(saveError)} ` : saveFlight ? 'Сохраняем…' : hasUnsavedSections() ? 'Есть правки · автосохранение…' : 'Все правки сохранены'));
    if (saveError) {
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn btn-secondary';
      retry.textContent = saveConflict ? conflictReviewed ? 'Сохранить мои правки' : 'Загрузить актуальную редакцию' : 'Повторить сохранение';
      retry.addEventListener('click', async () => {
        if (saveConflict && !conflictReviewed) {
          await run(retry, async () => {
            const state = await agentV2Api(appRef).get(`/session/${encodeURIComponent(current.session_id)}`);
            conflictReviewed = true;
            return state;
          }, 'Загружаем актуальную редакцию…', { flush: false });
          // Retain local edits for comparison; retry only on an explicit save.
        } else {
          if (conflictReviewed) for (const draft of localDrafts().values()) draft.baseHash = current?.draft?.fingerprint || '';
          saveConflict = false; conflictReviewed = false; try { await flushEdits(); } catch (_) {}
        }
      }); status.append(retry);
    }
  }
}

async function flushEdits() {
  clearTimeout(saveTimer);
  while (saveFlight) await saveFlight;
  if (current?.product_mode !== 'requirement_copilot' || !hasUnsavedSections()) return;
  detectLocalConflict();
  if (saveConflict) throw saveError;
  const base = current, drafts = localDrafts();
  const sections = Object.fromEntries([...drafts].filter(([, item]) => item.dirty).map(([field, item]) => [field, item.value]));
  saveError = null;
  saveFlight = (async () => {
    const result = await agentV2Api(appRef).documentAction(base, 'save_sections', { sections });
    if (result.action && result.action !== 'draft_ready') throw new Error(result.message || 'Не удалось сохранить правки');
    for (const [field, value] of Object.entries(sections)) {
      const draft = drafts.get(field);
      if (draft?.value === value) draft.dirty = false;
    }
    for (const draft of drafts.values()) draft.baseHash = result.draft?.fingerprint || '';
    if (current?.session_id === base.session_id) {
      current = result;
      // Do not repaint the editor: preserve selection and text typed during the request.
      for (const [field, value] of Object.entries(sections)) {
        const form = document.querySelector(`.agent-v2-section-form[data-field="${CSS.escape(field)}"]`);
        const input = form?.querySelector('textarea');
        if (input) input.defaultValue = value;
        const section = document.getElementById(`agent-v2-section-${field}`);
        if (section) {
          const presentation = sectionPresentation(current, field, value);
          section.querySelector('.agent-v2-section-value').textContent = value || presentation.empty;
          section.querySelector('header span').textContent = presentation.label;
        }
      }
      const revision = document.querySelector('.agent-v2-revision');
      if (revision) revision.textContent = `Редакция ${result.draft.revision}`;
      const title = document.querySelector('.agent-v2-document-head h2');
      if (title) title.textContent = result.draft.title;
      refreshGuidance();
      const transfer = document.querySelector('.agent-v2-transfer');
      if (transfer) transfer.outerHTML = renderGenerationReport(current, FIELD_LABELS);
      if ('title' in sections) await loadSessions(agentV2Api(appRef));
    }
  })();
  updateSaveStatus();
  try { await saveFlight; } catch (cause) { saveError = cause; saveConflict = cause?.status === 409; conflictReviewed = false; throw cause; }
  finally { saveFlight = null; updateSaveStatus(); }
  // The user may have continued typing while the previous batch was in flight.
  if (current?.session_id === base.session_id && hasUnsavedSections()) return flushEdits();
}
function detectLocalConflict() {
  if (current?.product_mode !== 'requirement_copilot') return;
  if (!conflictReviewed && [...localDrafts().values()].some(item => item.dirty && item.baseHash !== undefined && item.baseHash !== (current?.draft?.fingerprint || ''))) {
    saveConflict = true;
    saveError = { status: 409, message: 'Документ изменился, пока вы редактировали локальный текст.' };
  }
}
function restoreForms() {
  detectLocalConflict();
  for (const [field, draft] of localDrafts()) {
    const form = document.querySelector(`.agent-v2-section-form[data-field="${CSS.escape(field)}"]`);
    if (!form) continue;
    form.hidden = false;
    const input = form.querySelector('textarea');
    if (!draft.dirty) draft.value = input.defaultValue;
    input.value = draft.value;
    form.closest('details')?.setAttribute('open', '');
  }
  updateSaveStatus();
}
function selectWorkspaceView(view) {
  workspaceView = view;
  const workspace = document.getElementById('agent-v2-workspace');
  if (!workspace) return;
  workspace.dataset.view = view;
  workspace.querySelectorAll('[data-workspace-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.workspaceView === view)));
  refreshGuidance();
}
function refreshGuidance() {
  if (current?.product_mode !== 'requirement_copilot') return;
  const holder = document.getElementById('agent-v2-guidance');
  if (!holder) return;
  holder.innerHTML = renderNextStep(current, workspaceView, activeHumanReview);
  holder.querySelector('[data-journey-action]')?.addEventListener('click', event => {
    const action = event.currentTarget.dataset.journeyAction;
    if (action === 'preview') return run(event.currentTarget, async () => { workspaceView = 'approval'; return current; });
    if (action === 'submit') return submitRequirement(event.currentTarget);
    if (action === 'open-review') { window.location.hash = `#/review?tab=requirements&requirement_review=${encodeURIComponent(activeHumanReview.id)}`; return; }
    return runDocumentAction(event.currentTarget, action);
  });
  if (operationPending) setWorkspaceBusy(true);
}
function renderWorkspaceViews(state) {
  const count = currentFindings(state).filter(item => ['open', 'deferred'].includes(item.status || 'open')).length;
  return `<div class="agent-v2-view-switch" role="group" aria-label="Рабочая область"><button class="btn btn-secondary" data-workspace-view="document">Черновик</button><button class="btn btn-secondary" data-workspace-view="review">Уточнения${count ? ` (${count})` : ''}</button><button class="btn btn-secondary" data-workspace-view="approval" ${!state.draft ? 'disabled' : ''}>Согласование</button><button class="btn btn-ghost" data-workspace-view="sources">Материалы и история</button></div>`;
}
function setOperationLabel(label) {
  operationLabel = label;
  const status = document.getElementById('agent-v2-operation-status');
  if (status) { status.hidden = false; status.textContent = label; }
}

function codeLabel(code) {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  const suffixes = {
    '_provenance_invalid': ' — нужен подтверждённый источник',
    '_not_declared': ' — укажите значение или явно отметьте отсутствие',
    '_missing': ' — раздел не заполнен', '_open': ' — можно уточнить позже',
  };
  const suffix = Object.keys(suffixes).find(item => code.endsWith(item));
  const key = suffix ? code.slice(0, -suffix.length) : code;
  return `${FIELD_LABELS[key] || key.replaceAll('_', ' ')}${suffix ? suffixes[suffix] : ''}`;
}

function errorText(error) {
  if (error?.status === 409) return 'Документ, источник или решение изменились. Обновите данные и проверьте актуальную редакцию перед повторным действием.';
  if (error?.status === 403) return error.message && !error.message.startsWith('HTTP ') ? error.message : 'Нет доступа к документу, источнику или действию.';
  if (error?.status === 503) return error.message && !error.message.startsWith('HTTP ') ? error.message : 'Сервис или ИИ-проверка временно недоступны. Сохранённый документ доступен для ручной работы.';
  return error?.message || 'Не удалось выполнить действие.';
}

function querySession() {
  return new URLSearchParams(window.location.hash.split('?')[1] || '').get('session') || '';
}

function displayValue(value) {
  if (Array.isArray(value)) return value.join('\n');
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value ?? '');
}

function sectionValue(state, artifactField, slotField) {
  const artifact = state?.draft || state?.assignment_passport || {};
  const value = artifact[artifactField];
  if (state.product_mode === 'requirement_copilot' && Object.hasOwn(artifact, artifactField)) return displayValue(value);
  if (value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length)) return displayValue(value);
  return displayValue(state?.slots?.[slotField]);
}

function renderMessages(history = []) {
  if (!history.length) return '<div class="agent-v2-empty">Помощник готов помочь с формулировками и пробелами.</div>';
  return history.map(item => `<article class="agent-v2-message ${item.role === 'user' ? 'is-user' : 'is-agent'}"><span>${item.role === 'user' ? 'Вы' : 'Помощник'}</span><p>${esc(item.content).replaceAll('\n', '<br>')}</p></article>`).join('');
}

function collectFindings(state) {
  const artifact = state?.draft || state?.assignment_passport || {};
  const result = [];
  for (const item of artifact.review_findings || []) result.push({ severity: item.severity || 'warning', text: item.message || item.code });
  for (const item of artifact.quality_issues || []) result.push({ severity: item.severity || 'warning', text: item.message || codeLabel(item.code || '') });
  for (const code of state?.readiness?.blocking_codes || []) result.push({ severity: 'error', text: codeLabel(code) });
  for (const code of state?.readiness?.warning_codes || []) result.push({ severity: 'warning', text: codeLabel(code) });
  for (const item of state?.gaps || []) if ((item.status || 'open') === 'open') result.push({ severity: item.criticality === 'high' ? 'error' : 'warning', text: item.question || item.slot || 'Открытый вопрос' });
  for (const item of state?.conflicts || []) if ((item.status || 'open') === 'open') result.push({ severity: 'error', text: item.message || item.question || 'Противоречие' });
  return result.filter((item, index, all) => item.text && all.findIndex(other => other.text === item.text) === index);
}

function renderQuality(state) {
  const findings = collectFindings(state);
  const errors = findings.filter(item => item.severity === 'error').length;
  const warnings = findings.length - errors;
  const renderFindings = items => `<ol class="agent-v2-findings">${items.map(item => `<li class="is-${esc(item.severity)}"><i data-lucide="${item.severity === 'error' ? 'circle-alert' : 'triangle-alert'}"></i><span>${esc(item.text)}</span></li>`).join('')}</ol>`;
  const primary = findings.slice(0, 5);
  const remaining = findings.slice(5);
  return `<section class="agent-v2-card agent-v2-quality"><div class="agent-v2-card-title"><div><span class="agent-v2-eyebrow">Контроль качества</span><h3>Структура и исходные данные</h3></div><span>${errors} / ${warnings}</span></div><div class="agent-v2-quality-legend"><span class="is-error">${errors} пробелов</span><span class="is-warning">${warnings} рекомендаций</span></div>${findings.length ? `${renderFindings(primary)}${remaining.length ? `<details class="agent-v2-more-findings"><summary>Ещё ${remaining.length} замечаний</summary>${renderFindings(remaining)}</details>` : ''}` : '<p>Проверки не нашли открытых замечаний.</p>'}</section>`;
}

function renderOutline(state) {
  const sections = state.product_mode === 'assignment_capture' ? ASSIGNMENT_SECTIONS : REQUIREMENT_SECTIONS;
  const renderLinks = items => items.map(([field, slot]) => { const filled = Boolean(sectionValue(state, field, slot)); return `<a href="#agent-v2-section-${esc(field)}" class="${filled ? 'is-filled' : ''}"><i data-lucide="${filled ? 'circle-check' : 'circle'}"></i><span>${esc(FIELD_LABELS[field] || field)}</span></a>`; }).join('');
  if (state.product_mode === 'assignment_capture') return `<nav class="agent-v2-outline" aria-label="Разделы документа"><span class="agent-v2-eyebrow">Структура</span>${renderLinks(sections)}</nav>`;
  const core = sections.filter(([field, slot]) => CORE_REQUIREMENT_FIELDS.has(field) || Boolean(sectionValue(state, field, slot)));
  const optional = sections.filter(([field, slot]) => !CORE_REQUIREMENT_FIELDS.has(field) && !sectionValue(state, field, slot));
  return `<nav class="agent-v2-outline" aria-label="Разделы документа"><span class="agent-v2-eyebrow">Структура</span>${renderLinks(core)}<details class="agent-v2-outline-more"><summary>Ещё ${optional.length} разделов</summary>${renderLinks(optional)}</details></nav>`;
}

function renderLegacySources(state) {
  const linked = state.linked_object;
  return `<section class="agent-v2-side-block"><span class="agent-v2-eyebrow">Источники</span>${state.source_context?.source_summary ? `<p>${esc(state.source_context.source_summary)}</p>` : '<p class="agent-v2-muted">Источник будет показан здесь.</p>'}${linked ? `<div class="agent-v2-linked"><strong>${esc(linked.title || `${linked.object_type} #${linked.object_id}`)}</strong><span>${esc(linked.object_type)} #${esc(linked.object_id)} · версия ${esc(linked.object_version)}</span></div>` : ''}${state.phase === 'sent_for_review' ? '' : '<form id="agent-v2-search-form" class="agent-v2-search"><select class="input ui-control" name="object_type"><option value="task">Задача</option><option value="request">Запрос</option></select><input class="input ui-control" name="query" placeholder="ID или название" maxlength="120" required><button class="btn btn-secondary" type="submit">Найти</button></form><div id="agent-v2-search-results"></div>'}</section>`;
}

function renderSources(state) {
  return renderLegacySources(state) + (state.product_mode === 'requirement_copilot' ? renderDocumentSources(state, { locked: state.phase === 'sent_for_review' }) : '');
}

function importResults(state) {
  return (state.document_sources || []).map(source => ({ source, result: source.import_result ||
    (state.sources || []).find(item => item.title === source.title && item.unmapped_sections)?.unmapped_sections && {
      unmapped_sections: (state.sources || []).find(item => item.title === source.title && item.unmapped_sections).unmapped_sections,
    } })).filter(item => item.result);
}

function renderImportResults(state) {
  return importResults(state).map(({ source, result }) => `<details class="agent-v2-import-result" ${result.unmapped_sections?.length ? 'open' : ''}><summary>Результат импорта: ${result.recognized_fields ? `распознано ${result.recognized_fields.length}, ` : ''}не распознано ${result.unmapped_sections?.length || 0}</summary>${(result.unmapped_sections || []).map(title => `<form class="agent-v2-map-section" data-source="${esc(source.id)}" data-heading="${esc(title)}"><p>Не распознан раздел «${esc(title)}». Исходный текст сохранён в материалах.</p>${state.phase === 'sent_for_review' ? '' : `<label>Назначить раздел<select class="input ui-control" name="field">${REQUIREMENT_SECTIONS.map(([field]) => `<option value="${esc(field)}">${esc(FIELD_LABELS[field])}</option>`).join('')}</select></label><button class="btn btn-secondary" type="submit">Перенести в редактор</button>`}</form>`).join('')}</details>`).join('');
}

function bindImportMapping() {
  document.querySelectorAll('.agent-v2-map-section').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault();
    const source = (current.document_sources || []).find(item => item.id === form.dataset.source);
    const fragments = (source?.sections || []).filter(item => item.title === form.dataset.heading);
    if (!fragments.length) return;
    const field = new FormData(form).get('field');
    const editor = document.querySelector(`.agent-v2-section-form[data-field="${CSS.escape(field)}"]`);
    if (!editor) return;
    const text = fragments.map(item => item.content.replace(/^\s*#{1,6}[^\n]*\n?/, '').trim()).join('\n');
    const input = editor.querySelector('textarea');
    input.value = [input.value, text].filter(Boolean).join('\n');
    editor.hidden = false;
    editor.closest('details')?.setAttribute('open', '');
    rememberForm(editor);
    selectWorkspaceView('document');
    input.focus();
  }));
}

function renderRevisions(state) {
  const revisions = [...(state.artifact_revision_history || [])].reverse();
  return `<section class="agent-v2-side-block"><span class="agent-v2-eyebrow">Версии</span>${revisions.length ? `<ol class="agent-v2-revisions">${revisions.map(item => `<li><strong>Редакция ${esc(item.revision)}</strong><span>${item.author_kind === 'operator' ? 'Изменил аналитик' : esc(({ agent: 'Помощник', agent_proposal: 'Помощник', llm: 'Помощник', system: 'Система' })[item.author_kind] || 'Автор')} · ${esc(formatDocumentDate(item.created_at))}</span>${(item.applied_operations || []).length ? `<small>Изменений: ${item.applied_operations.length}</small>` : ''}</li>`).join('')}</ol>` : '<p class="agent-v2-muted">Первая версия появится после импорта или правки.</p>'}</section>`;
}

function renderDocument(state) {
  const sections = state.product_mode === 'assignment_capture' ? ASSIGNMENT_SECTIONS : REQUIREMENT_SECTIONS;
  const locked = state.phase === 'sent_for_review';
  const artifact = state.draft || state.assignment_passport;
  const revisionLabel = artifact?.revision ? `Редакция ${artifact.revision}` : 'Черновик';
  const renderSections = items => items.map(([field, slot]) => { const value = sectionValue(state, field, slot); const presentation = sectionPresentation(state, field, value); return `<article class="agent-v2-section ${value ? 'is-filled' : 'is-empty'}" id="agent-v2-section-${esc(field)}" tabindex="-1"><header><div><span>${esc(presentation.label)}</span><h3 id="agent-v2-label-${esc(field)}">${esc(FIELD_LABELS[field] || field)}</h3></div>${locked ? '' : `<button type="button" class="btn btn-ghost agent-v2-edit-toggle" data-edit-target="${esc(field)}" aria-label="Изменить: ${esc(FIELD_LABELS[field] || field)}"><i data-lucide="pencil"></i> Изменить</button>`}</header><div class="agent-v2-section-value">${value ? esc(value).replaceAll('\n', '<br>') : esc(presentation.empty)}</div>${locked ? '' : `<form class="agent-v2-section-form" data-field="${esc(field)}" hidden><textarea class="input ui-control" name="value" aria-labelledby="agent-v2-label-${esc(field)}" rows="5" maxlength="30000" placeholder="Введите формулировку или отметьте, что пока неизвестно">${esc(value)}</textarea><div><button class="btn btn-secondary" type="submit">${state.product_mode === 'requirement_copilot' ? 'Готово' : 'Сохранить редакцию'}</button><button class="btn btn-ghost agent-v2-edit-cancel" type="button">${state.product_mode === 'requirement_copilot' ? 'Закрыть' : 'Отмена'}</button></div></form>`}</article>`; }).join('');
  const core = state.product_mode === 'assignment_capture' ? sections : sections.filter(([field, slot]) => CORE_REQUIREMENT_FIELDS.has(field) || Boolean(sectionValue(state, field, slot)));
  const optional = state.product_mode === 'assignment_capture' ? [] : sections.filter(([field, slot]) => !CORE_REQUIREMENT_FIELDS.has(field) && !sectionValue(state, field, slot));
  const optionalFilled = optional.filter(([field, slot]) => Boolean(sectionValue(state, field, slot))).length;
  return `<section class="agent-v2-document" aria-label="Редактор требования"><div class="agent-v2-document-head"><div><span class="agent-v2-eyebrow">Рабочий документ</span><h2>${esc(artifact?.title || (state.product_mode === 'assignment_capture' ? 'Новое поручение' : 'Новое бизнес-требование'))}</h2>${locked ? '' : '<button type="button" class="btn btn-ghost agent-v2-edit-toggle" data-edit-target="title" aria-label="Изменить: Название">Изменить название</button>'}</div><span class="agent-v2-revision">${esc(revisionLabel)}</span></div>${locked ? '' : `<form class="agent-v2-section-form" data-field="title" hidden><label>Название<textarea class="input ui-control" name="value" rows="2" maxlength="500" required>${esc(artifact?.title || '')}</textarea></label><div><button class="btn btn-secondary" type="submit">${state.product_mode === 'requirement_copilot' ? 'Готово' : 'Сохранить редакцию'}</button><button class="btn btn-ghost agent-v2-edit-cancel" type="button">${state.product_mode === 'requirement_copilot' ? 'Закрыть' : 'Отмена'}</button></div></form>`}${renderImportResults(state)}${renderGenerationReport(state, FIELD_LABELS)}${renderBusinessRequirements(state)}${renderSections(core)}${optional.length ? `<details class="agent-v2-optional"><summary><span>Добавить раздел</span><small>${optionalFilled} из ${optional.length} заполнено</small></summary>${renderSections(optional)}</details>` : ''}</section>`;
}

function renderPatch(state) {
  const patch = state.proposed_patch;
  if (!patch) return '';
  const labels = { '/title': 'Название', '/description': 'Описание' };
  return `<section class="agent-v2-card"><div class="agent-v2-card-title"><div><span class="agent-v2-eyebrow">Изменения DMB</span><h3>Предварительный просмотр</h3></div><span>${esc(patch.status)}</span></div>${patch.status === 'stale' ? '<div class="agent-v2-error">Связанный объект изменился. Постройте предложение заново.</div>' : ''}${(patch.operations || []).map((op, index) => `<article class="agent-v2-patch"><h4>${esc(labels[op.path] || op.path)}</h4><div class="agent-v2-patch-values"><div><strong>Сейчас</strong><p>${esc(displayValue(op.before)) || '—'}</p></div><div><strong>Предлагается</strong><p>${esc(displayValue(op.after)) || '—'}</p></div></div><p>${esc(op.reason)}</p><div><button class="btn btn-secondary" data-patch-index="${index}" data-decision="accepted" ${op.status !== 'proposed' || patch.status === 'stale' ? 'disabled' : ''}>Принять</button><button class="btn btn-ghost" data-patch-index="${index}" data-decision="rejected" ${op.status !== 'proposed' || patch.status === 'stale' ? 'disabled' : ''}>Отклонить</button></div></article>`).join('')}</section>`;
}

function renderLegacyCopilot(state) {
  const artifact = state.draft || state.assignment_passport;
  const quickActions = state.product_mode === 'requirement_copilot' ? '<div class="agent-v2-quick-actions"><button class="btn btn-secondary btn-sm ui-btn" type="button" data-copilot-prompt="Проверь критерии приёмки: найди неизмеримые и неоднозначные формулировки.">Проверить критерии</button><button class="btn btn-secondary btn-sm ui-btn" type="button" data-copilot-prompt="Найди противоречия между разделами требования и объясни, что уточнить.">Найти противоречия</button><button class="btn btn-secondary btn-sm ui-btn" type="button" data-copilot-prompt="Предложи один самый полезный следующий шаг аналитика для подготовки требования к review.">Следующий шаг</button></div>' : '';
  return `<aside class="agent-v2-copilot"><div class="agent-v2-copilot-head"><div><span class="agent-v2-eyebrow">Контекстный помощник</span><h2>Анализ и уточнения</h2></div><span class="agent-v2-role">${esc(state.operator_role)}</span></div>${renderQuality(state)}<section class="agent-v2-card agent-v2-conversation">${state.phase === 'sent_for_review' ? '' : quickActions}<div id="agent-v2-messages">${renderMessages(state.history)}</div>${state.phase === 'sent_for_review' ? '' : '<form id="agent-v2-chat-form"><label for="agent-v2-message">Свой вопрос помощник</label><textarea class="input ui-control" id="agent-v2-message" rows="3" maxlength="4000" required placeholder="Например: перепиши бизнес-цель через измеримый результат"></textarea><button class="btn btn-primary" type="submit">Отправить</button></form>'}</section>${renderPatch(state)}<section class="agent-v2-card agent-v2-review"><span class="agent-v2-eyebrow">Следующее действие</span>${state.product_mode === 'assignment_capture' && artifact ? '<h3>Поручение зафиксировано</h3><p>Передайте подтверждённые сведения в рабочее требование.</p><button class="btn btn-primary" id="agent-v2-handoff">Перейти к требованию</button>' : state.readiness?.ready && artifact ? '<h3>Готово к review</h3><p>Перед отправкой сохранится точная редакция документа.</p><button class="btn btn-primary" id="agent-v2-send-review">Отправить на review</button>' : '<h3>Сначала закройте блокеры</h3><p>Исправляйте замечания сверху вниз. Помощник подскажет формулировку.</p>'}${state.product_mode === 'requirement_copilot' && artifact && state.linked_object ? '<button class="btn btn-secondary" id="agent-v2-propose-patch">Сравнить со связанным объектом</button>' : ''}</section></aside>`;
}

function renderCopilot(state) {
  if (state.product_mode !== 'requirement_copilot') return renderLegacyCopilot(state);
  const locked = state.phase === 'sent_for_review';
  const reviewed = { ...state, document_findings: currentFindings(state) };
  return `<aside class="agent-v2-copilot">${renderDocumentReview(reviewed, { locked, showAction: false, guided: true })}${renderDocumentProposals(state, { locked, guided: true })}${locked ? '<p>Отправленная редакция доступна только для чтения.</p>' : '<details class="agent-v2-helper"><summary>Попросить помощника о другой правке</summary>' + renderDraftControls(state) + '</details>'}<details class="agent-v2-quality-details"><summary>Дополнительная проверка структуры</summary>${renderQuality(state)}</details></aside>`;
}

function renderJourney(state) {
  const artifact = state.draft || state.assignment_passport;
  const hasMaterial = Boolean(Object.keys(state.slots || {}).length || state.source_context?.source_summary || state.document_sources?.length);
  const check = reviewStage({ ...state, document_findings: currentFindings(state) });
  const steps = [
    ['Исходные данные', hasMaterial], ['Черновик', Boolean(artifact)],
    ['Уточнения', check.done], ['Согласование', isCurrentDraftApproved(state, activeHumanReview)],
  ];
  const firstPending = steps.findIndex(([, done]) => !done);
  return `<div class="agent-v2-workspace-topbar"><ol class="agent-v2-journey" aria-label="Этапы работы">${steps.map(([label, done], index) => `<li class="${done ? 'is-done' : index === firstPending ? 'is-active' : ''}"><span>${done ? '✓' : index + 1}</span>${label}</li>`).join('')}</ol><button type="button" class="btn btn-ghost" id="agent-v2-new-work"><i data-lucide="plus"></i> Новый документ</button></div>`;
}

function paint(state) {
  if (state?.session_id !== current?.session_id) { workspaceView = state?.document_review?.id && activeHumanReview?.status !== 'returned' ? 'review' : 'document'; saveError = null; saveConflict = false; conflictReviewed = false; }
  current = state;
  const workspace = document.getElementById('agent-v2-workspace');
  if (!workspace) return;
  if (!state) { workspace.innerHTML = '<div class="agent-v2-empty agent-v2-empty-workspace"><i data-lucide="file-plus-2"></i><h2>Начните новую работу</h2><p>Выберите задачу выше или откройте недавний документ.</p></div>'; return; }
  document.getElementById('agent-v2-launch')?.setAttribute('hidden', '');
  document.querySelector('.agent-v2-page')?.classList.add('has-document');
  workspace.classList.toggle('agent-v2-guided', state.product_mode === 'requirement_copilot');
  workspace.innerHTML = `${humanReviewWarning ? `<p class="agent-v2-review-warning" role="status">${esc(humanReviewWarning)}</p>` : ''}${renderJourney(state)}<p id="agent-v2-save-status" role="status"></p><div id="agent-v2-guidance"></div>${renderWorkspaceViews(state)}${state.phase === 'sent_for_review' ? '<div class="agent-v2-lock">Эта редакция отправлена на review и доступна только для чтения.</div>' : ''}<div class="agent-v2-workbench"><aside class="agent-v2-navigator"><div><span class="agent-v2-eyebrow">${esc(MODE_LABELS[state.product_mode] || state.product_mode)}</span><strong>${esc(ARTIFACT_LABELS[state.artifact_type] || 'Рабочий документ')}</strong></div>${renderSources(state)}${renderDocumentComparison(activeHumanReview, state.draft)}${renderRevisions(state)}<details><summary>История работы с помощником</summary>${renderMessages(state.history)}</details>${state.draft ? '<button class="btn btn-secondary" data-document-action="next_revision">Начать следующую редакцию</button>' : ''}</aside>${renderDocument(state)}${renderCopilot(state)}${state.product_mode === 'requirement_copilot' ? renderApprovalPreview(state) : ''}</div>`;
  const outline = document.createElement('details');
  outline.className = 'agent-v2-compact-outline';
  outline.innerHTML = `<summary>Разделы документа</summary>${renderOutline(state)}`;
  workspace.querySelector('.agent-v2-document-head')?.after(outline);
  bindWorkspace();
  restoreForms();
  selectWorkspaceView(workspaceView);
  document.querySelectorAll('[data-session]').forEach(item => item.setAttribute('aria-current', String(item.dataset.session === state.session_id)));
  if (operationPending) setWorkspaceBusy(true);
  window.lucide?.createIcons();
}

function setWorkspaceBusy(busy) {
  const page = document.querySelector('.agent-v2-page');
  document.getElementById('agent-v2-workspace')?.setAttribute('aria-busy', String(busy));
  document.getElementById('agent-v2-launch')?.setAttribute('aria-busy', String(busy));
  page?.querySelectorAll('button,input,textarea,select').forEach(control => {
    if (busy && !control.disabled) { control.dataset.agentV2BusyDisabled = 'true'; control.disabled = true; }
    else if (!busy && control.dataset.agentV2BusyDisabled) { control.disabled = false; delete control.dataset.agentV2BusyDisabled; }
  });
}

async function run(button, action, label = button ? 'Сохраняем изменения…' : 'Открываем документ…', { flush = true } = {}) {
  if (operationPending) return;
  operationPending = true;
  setOperationLabel(label);
  let failed = false;
  const slowTimer = setTimeout(() => { if (operationPending) setOperationLabel(`${label} Это занимает больше времени, чем обычно. Дождитесь результата; повторный запрос не нужен.`); }, 20000);
  const error = document.getElementById('agent-v2-error');
  if (error) error.hidden = true;
  setWorkspaceBusy(true);
  try { if (flush) await flushEdits(); const result = await action(); if (['error', 'validation_error', 'sent_locked'].includes(result?.action)) throw new Error(result.message); if (result?.session_id && result.product_mode) paint(result); } catch (cause) { failed = true; if (error) { error.replaceChildren(); const message = document.createElement('span'); message.textContent = errorText(cause); error.append(message); if (cause?.status === 409 && current?.session_id) { const reload = document.createElement('button'); reload.type = 'button'; reload.className = 'btn btn-secondary'; reload.textContent = 'Обновить документ'; reload.addEventListener('click', () => run(reload, () => agentV2Api(appRef).get(`/session/${encodeURIComponent(current.session_id)}`), 'Открываем документ…', { flush: false })); error.append(reload); } error.hidden = false; error.scrollIntoView({ block: 'nearest' }); } } finally { clearTimeout(slowTimer); operationPending = false; setWorkspaceBusy(false); setOperationLabel(failed ? 'Операция не завершена. Правки сохранены в форме; можно повторить действие.' : 'Готово'); if (!failed) document.getElementById('agent-v2-operation-status')?.setAttribute('hidden', ''); }
}

function hasUnsavedSections() {
  return [...localDrafts().values()].some(item => item.dirty);
}

function runDocumentAction(button, action, data = {}) {
  return run(button, async () => {
    const result = await agentV2Api(appRef).documentAction(current, action, data);
    if (action === 'review' || action === 'propose_change' || action === 'draft') workspaceView = 'review';
    if (action === 'create_draft' || action === 'next_revision') workspaceView = 'document';
    return result;
  }, ({ review: 'Проверяем документ…', create_draft: 'Подготавливаем черновик…', draft: 'Готовим предложения…', propose_change: 'Готовим предложения…' })[action] || 'Сохраняем изменения…');
}

function submitRequirement(button) {
  const acknowledgeDegraded = Boolean(document.getElementById('agent-v2-ack-degraded')?.checked);
  if (current.document_review?.status === 'degraded' && !acknowledgeDegraded) {
    document.getElementById('agent-v2-ack-degraded')?.focus();
    setOperationLabel('Подтвердите передачу с частичной проверкой или повторите проверку.'); return;
  }
  return run(button, async () => {
    if (!submissionReadiness(current).ready) { workspaceView = 'review'; return current; }
    const result = await agentV2Api(appRef).post('/requirement-reviews', { session_id: current.session_id, expected_draft_hash: current.draft.fingerprint, idempotency_key: requestKey('requirement-review'), acknowledge_degraded_review: acknowledgeDegraded });
    activeHumanReview = result.review;
    if (result.url) window.location.hash = result.url;
    return null;
  }, 'Отправляем на согласование…');
}

function bindDocumentActions(api) {
  document.querySelectorAll('[data-document-action]').forEach(button => button.addEventListener('click', () => runDocumentAction(button, button.dataset.documentAction)));
  document.getElementById('agent-v2-document-instruction')?.addEventListener('submit', event => {
    event.preventDefault();
    const instruction = new FormData(event.currentTarget).get('instruction')?.trim() || '';
    const action = event.submitter?.value || 'draft';
    if (action === 'propose_change' && !instruction) { event.currentTarget.querySelector('textarea').focus(); return; }
    runDocumentAction(event.submitter, action, { instruction });
  });
  document.getElementById('agent-v2-add-source')?.addEventListener('submit', event => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget));
    runDocumentAction(event.submitter, 'add_source', { source: { title: data.title.trim(), content: data.content.trim(), source_type: 'text' } });
  });
  document.querySelectorAll('.agent-v2-finding-form').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault();
    runDocumentAction(event.submitter, 'resolve_finding', { finding_id: form.dataset.findingId, decision: event.submitter?.value || 'resolved', reason: new FormData(form).get('reason')?.trim() || '' });
  }));
  document.querySelectorAll('[data-propose-finding]').forEach(button => button.addEventListener('click', () => {
    const finding = current.document_findings.find(item => item.id === button.dataset.proposeFinding);
    runDocumentAction(button, 'propose_change', { finding_id: finding.id, field: finding.field, instruction: `Предложи правку по замечанию: ${finding.message}` });
  }));
  document.querySelectorAll('.agent-v2-proposal').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault(); const operationIds = new FormData(form).getAll('operation_id');
    if (!operationIds.length) return;
    runDocumentAction(event.submitter, 'apply_proposal', { proposal_id: form.dataset.proposalId, operation_ids: operationIds });
  }));

}

function bindWorkspace() {
  const api = agentV2Api(appRef);
  bindDocumentActions(api);
  document.querySelectorAll('[data-workspace-view]').forEach(button => button.addEventListener('click', async () => {
    await run(button, async () => { workspaceView = button.dataset.workspaceView; return current; });
    const active = document.querySelector(`[data-workspace-view="${workspaceView}"]`);
    active?.focus({ preventScroll: true });
    active?.scrollIntoView({ block: 'nearest' });
  }));
  bindImportMapping();
  document.querySelectorAll('[data-finding-field]').forEach(button => button.addEventListener('click', () => {
    selectWorkspaceView('document');
    const field = button.dataset.findingField;
    const form = document.querySelector(`.agent-v2-section-form[data-field="${CSS.escape(field)}"]`);
    if (form) {
      form.closest('details')?.setAttribute('open', ''); form.hidden = false;
      document.querySelector('.agent-v2-return-to-review')?.remove();
      const returnBar = document.createElement('div');
      returnBar.className = 'agent-v2-return-to-review';
      returnBar.innerHTML = '<span>Вы редактируете раздел по замечанию. Правки сохраняются автоматически.</span><button type="button" class="btn btn-secondary">Вернуться к замечаниям</button>';
      const findingId = button.closest('[data-finding]')?.dataset.finding;
      returnBar.querySelector('button').addEventListener('click', async event => {
        await run(event.currentTarget, async () => { workspaceView = 'review'; return current; });
        const finding = document.querySelector(`[data-finding="${CSS.escape(findingId || '')}"]`);
        if (finding) { finding.open = true; finding.querySelector('summary')?.focus(); finding.scrollIntoView({ block: 'center' }); }
      });
      form.before(returnBar);
      form.querySelector('textarea').focus();
      form.scrollIntoView({ block: 'center' });
    }
    else {
      selectWorkspaceView('sources');
      const sourceForm = document.getElementById('agent-v2-add-source');
      if (sourceForm) { sourceForm.closest('details')?.setAttribute('open', ''); sourceForm.querySelector('textarea').focus(); }
      setOperationLabel('Добавьте известные сведения в материалы, затем попросите помощника учесть их в документе.');
    }
  }));
  document.querySelectorAll('[data-defer-finding]').forEach(button => button.addEventListener('click', () => runDocumentAction(button, 'resolve_finding', { finding_id: button.dataset.deferFinding, decision: 'deferred', reason: 'Пока неизвестно. Требуется уточнение у владельца информации.' })));
  document.querySelectorAll('[data-dismiss-proposal]').forEach(button => button.addEventListener('click', () => runDocumentAction(button, 'dismiss_proposal', { proposal_id: button.dataset.dismissProposal })));

  document.querySelectorAll('.agent-v2-outline a').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    const target = document.getElementById(link.getAttribute('href').slice(1));
    if (target) { target.closest('details')?.setAttribute('open', ''); selectWorkspaceView('document'); target.focus({ preventScroll: true }); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }));
  document.querySelectorAll('.agent-v2-edit-toggle').forEach(button => button.addEventListener('click', () => { const form = document.querySelector(`.agent-v2-section-form[data-field="${CSS.escape(button.dataset.editTarget)}"]`); if (form) { form.hidden = false; rememberForm(form); form.querySelector('textarea')?.focus(); } }));
  document.querySelectorAll('.agent-v2-edit-cancel').forEach(button => button.addEventListener('click', () => { const form = button.closest('form'); if (current.product_mode === 'requirement_copilot') { run(button, async () => { localDrafts().delete(form.dataset.field); return current; }); } else { form.reset(); form.hidden = true; localDrafts().delete(form.dataset.field); updateSaveStatus(); } }));
  document.querySelectorAll('.agent-v2-section-form').forEach(form => {
    form.addEventListener('input', () => rememberForm(form));
    form.addEventListener('submit', event => {
      event.preventDefault(); if (current.product_mode === 'requirement_copilot') { rememberForm(form); run(event.submitter, async () => { localDrafts().delete(form.dataset.field); return current; }); return; } const value = new FormData(form).get('value')?.trim(); if (!value) return;
      const drafts = localDrafts(); const field = form.dataset.field;
      run(event.submitter, async () => {
        const result = await api.post('/edit-draft-section', { session_id: current.session_id, field, value });
        if (result.action === 'draft_ready') { drafts.delete(field); if (field === 'title') await loadSessions(api); }
        return result;
      });
    });
  });
  document.getElementById('agent-v2-chat-form')?.addEventListener('submit', event => { event.preventDefault(); const message = event.currentTarget.querySelector('textarea').value.trim(); if (!message) return; run(event.currentTarget.querySelector('button'), () => api.post('/chat', { session_id: current.session_id, message_id: globalThis.crypto?.randomUUID?.() || `m-${Date.now()}`, message })); });
  document.querySelectorAll('[data-copilot-prompt]').forEach(button => button.addEventListener('click', event => run(event.currentTarget, () => api.post('/chat', { session_id: current.session_id, message_id: globalThis.crypto?.randomUUID?.() || `m-${Date.now()}`, message: event.currentTarget.dataset.copilotPrompt }))));
  document.getElementById('agent-v2-new-work')?.addEventListener('click', () => { const launch = document.getElementById('agent-v2-launch'); launch?.querySelectorAll('form').forEach(form => form.reset()); document.querySelector('.agent-v2-page')?.classList.remove('has-document'); document.getElementById('agent-v2-cancel-new')?.removeAttribute('hidden'); launch?.removeAttribute('hidden'); launch?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  document.getElementById('agent-v2-search-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const button = event.currentTarget.querySelector('button'); const results = document.getElementById('agent-v2-search-results'); button.disabled = true;
    try { const found = await api.get(`/objects/search?object_type=${encodeURIComponent(data.get('object_type'))}&q=${encodeURIComponent(data.get('query'))}`); results.innerHTML = (found.items || []).length ? found.items.map(item => `<button type="button" class="ui-surface-action agent-v2-search-result" data-object-type="${esc(item.object_type)}" data-object-id="${esc(item.object_id)}"><strong>${esc(item.title)}</strong><span>${esc(item.object_type)} #${esc(item.object_id)}</span></button>`).join('') : '<div class="agent-v2-empty">Доступные объекты не найдены.</div>'; results.querySelectorAll('[data-object-id]').forEach(item => item.addEventListener('click', click => run(click.currentTarget, () => api.post(`/session/${encodeURIComponent(current.session_id)}/link-object`, { object_type: click.currentTarget.dataset.objectType, object_id: click.currentTarget.dataset.objectId })))); } catch (cause) { results.innerHTML = `<div class="agent-v2-error">${esc(errorText(cause))}</div>`; } finally { button.disabled = false; }
  });
  document.getElementById('agent-v2-handoff')?.addEventListener('click', event => run(event.currentTarget, () => api.post(`/session/${encodeURIComponent(current.session_id)}/handoff`)));
  document.getElementById('agent-v2-propose-patch')?.addEventListener('click', event => run(event.currentTarget, () => api.post(`/session/${encodeURIComponent(current.session_id)}/proposed-patch`)));
  document.getElementById('agent-v2-send-review')?.addEventListener('click', event => run(event.currentTarget, async () => { const result = await api.post('/send-for-review', { session_id: current.session_id, expected_draft_hash: current.draft?.fingerprint || '' }); if (result.request_url) window.location.hash = result.request_url; return result; }));
  document.querySelectorAll('[data-patch-index]').forEach(button => button.addEventListener('click', event => run(event.currentTarget, () => api.post(`/session/${encodeURIComponent(current.session_id)}/proposed-patch/decision`, { operation_index: Number(event.currentTarget.dataset.patchIndex), decision: event.currentTarget.dataset.decision }))));
}

async function loadHumanReviewContext(state, reviewId = null) {
  activeHumanReview = null;
  humanReviewWarning = '';
  if (state.product_mode !== 'requirement_copilot') return state;
  try {
    activeHumanReview = reviewId
      ? await requirementReviewsApi(appRef).get(`/${encodeURIComponent(reviewId)}`)
      : await loadLatestRequirementReview(appRef, state.artifact_id || state.draft?.artifact_id);
  } catch (_) {
    humanReviewWarning = 'Не удалось загрузить историю согласования. Рабочий документ открыт, сравнение с отправленной редакцией временно недоступно.';
  }
  return state;
}

async function loadWorkspaceState(api, sessionId) {
  return loadHumanReviewContext(await api.get(`/session/${encodeURIComponent(sessionId)}`));
}

async function loadSessions(api) {
  const container = document.getElementById('agent-v2-sessions');
  try { const { sessions = [] } = await api.get('/sessions'); container.innerHTML = sessions.length ? sessions.map(item => { const defaultTitle = item.product_mode === 'assignment_capture' ? 'Новое поручение' : 'Новое требование'; const title = !item.title || item.title === 'Новый диалог' ? defaultTitle : item.title; return `<button class="ui-surface-action agent-v2-session" data-session="${esc(item.session_id)}" aria-current="${item.session_id === current?.session_id}"><strong title="${esc(title)}">${esc(title)}</strong><time>${esc(formatDocumentDate(item.updated_at || item.created_at))}</time><span>${esc(MODE_LABELS[item.product_mode] || item.product_mode)} · ${item.has_draft ? 'есть редакция' : 'черновик'}</span></button>`; }).join('') : '<div class="agent-v2-empty">Документов пока нет</div>'; container.querySelectorAll('[data-session]').forEach(button => button.addEventListener('click', () => { run(button, async () => { const state = await loadWorkspaceState(api, button.dataset.session); history.replaceState(history.state, '', `#/agent-v2?session=${encodeURIComponent(state.session_id)}`); document.querySelector('.agent-v2-recents')?.removeAttribute('open'); return state; }, 'Открываем документ…'); })); } catch (error) { container.innerHTML = `<div class="agent-v2-error">${esc(errorText(error))}</div>`; }
}

function hasAgentV2Access(app) { const feature = app?.features?.agent_v2; return Boolean(feature?.enabled && feature?.pilot_allowed && feature?.operator_role); }
function unavailableReason(app) { const feature = app?.features?.agent_v2; if (!feature?.enabled) return 'Сервис V2 сейчас не запущен. V1 и остальная система продолжают работать.'; if (!feature?.operator_role) return 'Для работы с V2 нужен профиль BA или PO.'; return 'Ваш BA/PO-профиль пока не включён в пилот.'; }
function renderAgentV2Header() { return '<header class="agent-v2-header"><div><span class="agent-v2-kicker">Помощник для бизнес-аналитика</span><h1>Рабочее место требований</h1><p>Опишите задачу, уточните черновик и отправьте его на согласование.</p></div></header>'; }

export function renderAgentV2(app) {
  const header = renderAgentV2Header();
  if (!hasAgentV2Access(app)) return `<main class="agent-v2-page">${header}<section class="agent-v2-availability" role="status"><div class="agent-v2-availability-icon"><i data-lucide="lock"></i></div><div><span class="agent-v2-kicker">Страница V2 подключена</span><h2>Рабочий контур пока недоступен</h2><p>${esc(unavailableReason(app))}</p></div></section></main>`;
  return `<main class="agent-v2-page">${header}<div id="agent-v2-error" class="agent-v2-error" role="alert" hidden></div><div id="agent-v2-operation-status" class="agent-v2-operation-status" role="status" aria-live="polite" hidden></div><section class="agent-v2-launch" id="agent-v2-launch"><div class="agent-v2-launch-head"><span class="agent-v2-eyebrow">Новая работа</span><h2>Что нужно подготовить?</h2><p>Начните с того, что у вас уже есть. Дальше пройдём четыре шага вместе.</p></div><div class="agent-v2-paths" role="group" aria-label="Сценарий начала"><button type="button" class="ui-surface-action agent-v2-path-card is-active" data-agent-v2-path="blank" aria-pressed="true"><i data-lucide="file-plus-2"></i><strong>Описать задачу</strong><span>Идея, поручение, письмо или заметки встречи</span></button><button type="button" class="ui-surface-action agent-v2-path-card" data-agent-v2-path="review" aria-pressed="false"><i data-lucide="scan-search"></i><strong>Проверить готовый документ</strong><span>Вставить черновик, найти пробелы и противоречия</span></button></div><div class="agent-v2-path-panel" data-agent-v2-panel="review" hidden><form id="agent-v2-review-start"><label>Текст бизнес-требования<textarea class="input ui-control" name="document" rows="8" maxlength="30000" required placeholder="# Название требования\n\n## Проблема\n...\n\n## Бизнес-цель\n..."></textarea></label><details><summary>Уточнить источник</summary><div class="agent-v2-start-options"><label>Источник<select class="input ui-control" name="source_type"><option value="document" selected>Документ</option><option value="operator">Аналитик</option><option value="business_customer">Бизнес-заказчик</option><option value="management">Руководство</option><option value="meeting">Встреча</option></select></label><label>Канал<select class="input ui-control" name="channel"><option value="document" selected>Документ</option><option value="email">Email</option><option value="messenger">Мессенджер</option><option value="meeting">Встреча</option></select></label></div></details><button class="btn btn-primary" type="submit">Проверить документ</button></form></div><div class="agent-v2-path-panel" data-agent-v2-panel="blank"><form id="agent-v2-blank-start"><h3>Расскажите о задаче своими словами</h3><label>Исходная потребность или задача<textarea class="input ui-control" name="material" rows="6" maxlength="30000" required placeholder="Что происходит сейчас? Что нужно изменить? Какой результат ожидаете? Можно просто вставить письмо или заметки встречи."></textarea></label><p>Достаточно того, что уже знаете. Пробелы уточним после подготовки черновика.</p><button class="btn btn-primary" type="submit">Подготовить черновик</button></form></div><button type="button" id="agent-v2-cancel-new" class="btn btn-ghost" hidden>Вернуться к документу</button></section><div class="agent-v2-shell"><aside><details class="agent-v2-recents"><summary>Недавние документы</summary><label>Поиск документов<input class="input ui-control" id="agent-v2-session-search" type="search"></label><div class="agent-v2-list-head"><span class="agent-v2-eyebrow">Недавние</span><h2>Документы</h2></div><div id="agent-v2-sessions"><div class="agent-v2-empty">Загрузка…</div></div></details></aside><section id="agent-v2-workspace"><div class="agent-v2-empty agent-v2-empty-workspace"><i data-lucide="file-plus-2"></i><h2>Начните новую работу</h2><p>Выберите задачу выше или откройте недавний документ.</p></div></section></div></main>`;
}

export async function initAgentV2(app) {
  if (!hasAgentV2Access(app)) return;
  try { await flushEdits(); } catch (_) { /* Unsaved text stays in its session's draft map. */ }
  appRef = app;
  if (!unloadGuardInstalled) {
    window.addEventListener('beforeunload', event => {
      const prefix = `${appRef?.store?.get('currentUser')?.id || ''}:`;
      if ([...sectionDrafts].some(([key, drafts]) => key.startsWith(prefix) && [...drafts.values()].some(item => item.dirty))) {
        event.preventDefault(); event.returnValue = '';
      }
    });
    unloadGuardInstalled = true;
  }
  document.getElementById('agent-v2-session-search')?.addEventListener('input', event => {
    const query = event.target.value.toLocaleLowerCase('ru');
    document.querySelectorAll('[data-session]').forEach(item => { item.hidden = !item.textContent.toLocaleLowerCase('ru').includes(query); });
  });
  current = null;
  activeHumanReview = null;
  const api = agentV2Api(app);
  const openState = async (state, reviewId = null) => {
    history.replaceState(history.state, '', `#/agent-v2?session=${encodeURIComponent(state.session_id)}`);
    await loadSessions(api);
    return loadHumanReviewContext(state, reviewId);
  };
  document.getElementById('agent-v2-cancel-new')?.addEventListener('click', () => { if (current) paint(current); });
  document.querySelectorAll('[data-agent-v2-path]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-agent-v2-path]').forEach(item => { item.classList.toggle('is-active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
    document.querySelectorAll('[data-agent-v2-panel]').forEach(panel => { panel.hidden = panel.dataset.agentV2Panel !== button.dataset.agentV2Path; });
  }));
  document.getElementById('agent-v2-review-start')?.addEventListener('submit', event => {
    event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form));
    run(event.submitter, async () => {
      activeHumanReview = null;
      let state = await api.post('/new-session', { product_mode: 'requirement_copilot', source_context: { source_type: data.source_type, channel: data.channel, source_summary: '' } });
      state = await api.post('/import-requirement-document', { session_id: state.session_id, content: data.document.trim() });
      state = await openState(state);
      paint(state);
      setOperationLabel('Проверяем документ…');
      const result = await api.documentAction(state, 'review'); workspaceView = 'review'; return result;
    }, 'Разбираем документ…');
  });
  document.getElementById('agent-v2-blank-start')?.addEventListener('submit', event => {
    event.preventDefault(); const material = new FormData(event.currentTarget).get('material')?.trim();
    run(event.submitter, async () => {
      activeHumanReview = null;
      let state = await api.post('/new-session', { product_mode: 'requirement_copilot', source_context: { source_type: 'operator', channel: 'document', source_summary: '' } });
      state = await openState(state);
      paint(state);
      if (!material) return state;
      state = await api.documentAction(state, 'add_source', { source: { title: 'Исходные материалы аналитика', content: material, source_type: 'text' } });
      paint(state);
      setOperationLabel('Подготавливаем черновик…');
      workspaceView = 'document';
      return api.documentAction(state, 'create_draft', { instruction: 'Подготовь полный рабочий документ по исходным материалам: проблему, цель, процессы, границы, правила, критерии и вопросы. Сохрани все исходные условия и авторские вопросы. Не добавляй вопросы по явно исключённым функциям.' });
    });
  });
  await loadSessions(api);
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  if (params.get('review')) {
    await run(null, async () => {
      const result = await api.post(`/requirement-reviews/${encodeURIComponent(params.get('review'))}/resume`);
      return openState(result.state, result.review_id);
    });
  } else if (['task', 'request'].includes(params.get('object_type')) && params.get('object_id')) {
    await run(null, async () => {
      const result = await api.post(`/objects/${encodeURIComponent(params.get('object_type'))}/${encodeURIComponent(params.get('object_id'))}/workspace`, { force_new: false });
      return openState(result.state);
    });
  } else if (params.get('session')) {
    await run(null, () => loadWorkspaceState(api, params.get('session')));
  }
}
