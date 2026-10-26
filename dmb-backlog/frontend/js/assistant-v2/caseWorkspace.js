import { assistantV2Api, idempotencyKey } from './api.js';
import { announce, clearUnsavedGuard, installUnsavedGuard } from './accessibility.js';
import { channelLabel, claimTypeLabel, fieldLabel, findingMessage, severityLabel, sourceOriginLabel, statusLabel } from './presentation.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const lines = value => Array.isArray(value) ? value.join('\n') : (value || '');

function shell(title, body, actions = '') {
  return `<main class="assistant-v2-page"><div id="assistant-v2-live" class="sr-only" aria-live="polite"></div><header class="assistant-v2-header"><div><span class="assistant-v2-eyebrow">Помощник подготовки требований</span><h1>${esc(title)}</h1><p class="assistant-v2-lead">Ассистент предлагает формулировки, а вы подтверждаете каждое важное решение.</p></div>${actions}</header>${body}</main>`;
}

function state(message) { return `<div class="assistant-v2-state" role="status">${esc(message)}</div>`; }
function errorMessage(error) { return error?.message || 'Не удалось выполнить операцию'; }

function journey(activeStep = 1) {
  const steps = ['Поручение', 'Уточнение', 'Требование', 'Проверка', 'Задача'];
  return `<ol class="assistant-v2-journey" aria-label="Этапы работы">${steps.map((label, index) => `<li class="${index + 1 < activeStep ? 'is-complete' : index + 1 === activeStep ? 'is-current' : ''}"><span>${index + 1}</span>${label}</li>`).join('')}</ol>`;
}

function caseStep(status) {
  if (status === 'clarifying') return 2;
  if (status === 'ready_for_analysis' || status === 'handed_off') return 3;
  return 1;
}

export function renderCaseList() {
  return shell('ИИ-ассистент 2.0', `${journey(1)}<div class="assistant-v2-actions"><a class="btn btn-primary" href="#/assistant-v2/cases/new">Новое поручение</a></div><section class="assistant-v2-panel"><h2>Поручения в работе</h2><p class="assistant-v2-section-hint">Откройте поручение, чтобы уточнить факты и подготовить бизнес-требование.</p><div id="assistant-v2-case-list">${state('Загружаем поручения…')}</div></section>`);
}

export async function initCaseList(app) {
  clearUnsavedGuard(app);
  const container = document.getElementById('assistant-v2-case-list');
  try {
    const data = await assistantV2Api(app).get('/cases?limit=50');
    container.innerHTML = data.items.length ? data.items.map(item => `<a class="assistant-v2-case-card" href="#/assistant-v2/cases/${encodeURIComponent(item.id)}"><div class="assistant-v2-card-heading"><span class="assistant-v2-status">${esc(statusLabel(item.status))}</span><small>${esc(item.case_number)}</small></div><strong>${esc(item.title)}</strong><span>${item.readiness?.ready ? 'Все обязательные уточнения готовы' : `Осталось уточнить: ${(item.readiness?.failed_rules || []).length}`}</span></a>`).join('') : state('Поручений пока нет. Создайте первое, чтобы начать работу.');
  } catch (error) { container.innerHTML = `<div class="assistant-v2-error" role="alert">${esc(errorMessage(error))}</div>`; }
}

export function renderNewCase() {
  return shell('Новое поручение', `${journey(1)}<form id="assistant-v2-new-case" class="assistant-v2-form"><label>Краткое название<input name="title" maxlength="255" placeholder="Например: упростить согласование заявок" required></label><label>Откуда получено поручение<select name="channel"><option value="meeting">Встреча</option><option value="email">Письмо</option><option value="chat">Чат</option><option value="other">Другой канал</option></select></label><label>Как записан исходный текст<select name="origin_type"><option value="operator_retelling">Пересказ оператора</option><option value="verbatim">Дословный текст</option></select></label><label>Текст поручения<textarea name="content" rows="10" placeholder="Вставьте текст или кратко перескажите суть" required></textarea></label><p class="assistant-v2-note"><strong>Сейчас разрешены только синтетические тестовые данные.</strong> Не вводите реальные клиентские или персональные данные.</p><div class="assistant-v2-form-actions"><button class="btn btn-primary" type="submit">Продолжить к уточнению</button><a class="btn btn-secondary" href="#/assistant-v2">Отмена</a></div><div id="assistant-v2-form-error" class="assistant-v2-error" role="alert" hidden></div></form>`);
}

export function initNewCase(app) {
  const form = document.getElementById('assistant-v2-new-case');
  let dirty = false;
  installUnsavedGuard(app, () => dirty);
  form.addEventListener('input', () => { dirty = true; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const error = document.getElementById('assistant-v2-form-error');
    button.disabled = true; error.hidden = true;
    const values = new FormData(form);
    try {
      const api = assistantV2Api(app);
      const created = await api.post('/cases', { title: values.get('title'), data_classification: 'synthetic', passport: {}, source_party: {} }, { idempotencyKey: idempotencyKey('case') });
      await api.post(`/cases/${created.id}/sources`, {
        expected_version: created.version,
        kind: 'text', origin_type: values.get('origin_type'), channel: values.get('channel'),
        content: values.get('content'), mime_type: 'text/plain', captured_at: new Date().toISOString(),
      }, { idempotencyKey: idempotencyKey('source') });
      dirty = false; clearUnsavedGuard(app); app.router.navigate(`/assistant-v2/cases/${created.id}`);
    } catch (failure) {
      error.hidden = false; error.textContent = errorMessage(failure); announce(error.textContent, 'assertive');
    } finally { button.disabled = false; }
  });
}

function claimCard(claim, version) {
  const evidence = claim.evidence?.length ? `Подтверждений в источнике: ${claim.evidence.length}` : 'Без привязанного подтверждения';
  return `<article class="assistant-v2-claim" data-claim-id="${esc(claim.id)}"><div><span class="assistant-v2-origin">${esc(claimTypeLabel(claim.claim_type))}</span><span class="assistant-v2-status">${esc(statusLabel(claim.status))}</span></div><strong>${esc(fieldLabel(claim.path))}</strong><p>${esc(claim.statement)}</p><small>${esc(evidence)}</small>${claim.status === 'proposed' ? `<label>Почему вы принимаете это решение<input class="claim-rationale" value="Сверено с исходным текстом"></label>${claim.path ? `<label>Итоговая формулировка<input class="claim-passport-value" value="${esc(claim.statement)}"></label>` : ''}<div class="assistant-v2-row"><button class="btn btn-primary claim-decision" data-decision="accept" data-version="${version}">Подтвердить</button><button class="btn btn-secondary claim-decision" data-decision="reject" data-version="${version}">Отклонить</button></div>` : ''}</article>`;
}

function gapCard(gap) {
  const owner = gap.owner_snapshot ? ` · ответственный назначен` : '';
  return `<article class="assistant-v2-claim" data-gap-id="${esc(gap.id)}" data-gap-version="${gap.version}"><div><span class="assistant-v2-origin">${esc(fieldLabel(gap.path))}</span><span class="assistant-v2-status">${esc(statusLabel(gap.status))}</span></div><p>${esc(severityLabel(gap.severity))}${owner}</p>${gap.next_step ? `<small>Следующий шаг: ${esc(gap.next_step)}</small>` : ''}${gap.status !== 'resolved' ? `<button class="btn btn-secondary gap-decision" data-decision="resolve">Отметить как решённое</button>` : ''}</article>`;
}

function conflictCard(conflict, claimByRef) {
  const left = claimByRef.get(conflict.left_ref) || 'Первая формулировка';
  const right = claimByRef.get(conflict.right_ref) || 'Вторая формулировка';
  return `<article class="assistant-v2-claim" data-conflict-id="${esc(conflict.id)}" data-conflict-version="${conflict.version}"><div><span class="assistant-v2-origin">${esc(severityLabel(conflict.severity))}</span><span class="assistant-v2-status">${esc(statusLabel(conflict.status))}</span></div><p><strong>${esc(left)}</strong><br>противоречит<br><strong>${esc(right)}</strong></p>${conflict.status === 'open' ? `<div class="assistant-v2-row"><button class="btn btn-secondary conflict-decision" data-decision="resolve">Зафиксировать решение</button><button class="btn btn-secondary conflict-decision" data-decision="escalate">Передать ответственному</button></div>` : ''}</article>`;
}

export async function renderCaseWorkspace(app, caseId) {
  try {
    const api = assistantV2Api(app);
    const item = await api.get(`/cases/${caseId}`);
    let duplicateCandidates = [];
    try {
      const page = await api.get('/cases?limit=50');
      duplicateCandidates = (page.items || []).filter(candidate => candidate.id !== item.id);
    } catch { duplicateCandidates = []; }
    const failed = item.readiness?.findings || [];
    const fidelityMissing = failed.some(finding => finding.rule_id === 'S1_FIDELITY_CONFIRMATION');
    const transitions = {
      draft: ['captured', 'deferred'],
      captured: ['clarifying', 'duplicate', 'deferred', 'rejected'],
      clarifying: ['ready_for_analysis', 'duplicate', 'deferred', 'rejected'],
      ready_for_analysis: ['duplicate', 'deferred', 'rejected'],
      handed_off: ['archived'], duplicate: ['archived'], deferred: ['archived'], rejected: ['archived'],
    }[item.status] || [];
    const availableTransitions = transitions.filter(value => value !== 'duplicate' || duplicateCandidates.length);
    const transitionOptions = availableTransitions.map(value => `<option value="${value}">${esc(statusLabel(value))}</option>`).join('');
    const duplicateOptions = duplicateCandidates.map(candidate => `<option value="${esc(candidate.id)}">${esc(candidate.case_number)} · ${esc(candidate.title)}</option>`).join('');
    const sources = item.sources.map(source => `<article class="assistant-v2-source"><div><span class="assistant-v2-origin">${esc(sourceOriginLabel(source.origin_type))}</span><small>${esc(channelLabel(source.channel))}</small></div><p>${esc(source.content)}</p></article>`).join('');
    const evidenceOptions = item.sources.flatMap(source => (source.fragments || []).map(fragment => `<option value="${esc(fragment.id)}">${esc(channelLabel(source.channel))} · ${esc(fragment.excerpt || 'фрагмент источника')}</option>`)).join('');
    const claims = item.claims.map(claim => claimCard(claim, item.version)).join('') || state('Подтверждённых фактов пока нет. Добавьте первую формулировку из исходного текста.');
    const gaps = item.gaps.map(gapCard).join('') || state('Незакрытых вопросов нет.');
    const claimByRef = new Map(item.claims.map(claim => [`claim:${claim.id}`, claim.statement]));
    const conflicts = item.conflicts.map(conflict => conflictCard(conflict, claimByRef)).join('') || state('Противоречий нет.');
    const leftClaimOptions = item.claims.map(claim => `<option value="claim:${esc(claim.id)}">${esc(claim.statement)}</option>`).join('');
    const rightClaimOptions = item.claims.map((claim, index) => `<option value="claim:${esc(claim.id)}" ${index === 1 ? 'selected' : ''}>${esc(claim.statement)}</option>`).join('');
    const openItems = `<section class="assistant-v2-panel"><h2>Что нужно уточнить</h2><h3>Незакрытые вопросы</h3>${gaps}<form id="assistant-v2-gap-form" class="assistant-v2-form"><label>О чём нужно уточнить<select name="path"><option value="/passport/requested_action">Требуемое действие</option><option value="/passport/expected_outcome">Ожидаемый результат</option><option value="/passport/business_problem">Бизнес-проблема и ценность</option><option value="/passport/scope_in">Что входит в объём</option><option value="/passport/scope_out">Что не входит в объём</option><option value="/passport/unknowns">Другой вопрос</option></select></label><label>Важность<select name="severity"><option value="blocking">Блокирует передачу</option><option value="warning">Важно, но не блокирует</option><option value="info">К сведению</option></select></label><label>Следующий шаг<input name="next_step" placeholder="Например: уточнить у заказчика"></label><button class="btn btn-secondary" type="submit">Добавить вопрос</button></form><h3>Противоречия</h3>${conflicts}<form id="assistant-v2-conflict-form" class="assistant-v2-form"><label>Первая формулировка<select name="left_ref" required>${leftClaimOptions}</select></label><label>Вторая формулировка<select name="right_ref" required>${rightClaimOptions}</select></label><label>Важность<select name="severity"><option value="critical">Критично</option><option value="major">Существенно</option><option value="minor">Незначительно</option></select></label><button class="btn btn-secondary" type="submit" ${item.claims.length > 1 ? '' : 'disabled'}>Зафиксировать противоречие</button></form></section>`;
    return shell(item.title, `${journey(caseStep(item.status))}<div class="assistant-v2-workspace" data-case-id="${esc(item.id)}" data-version="${item.version}" data-digest="${esc(item.current_revision_digest)}"><aside class="assistant-v2-column"><section class="assistant-v2-panel"><h2>Исходная информация</h2>${sources}</section><section class="assistant-v2-panel"><h2>Готовность к следующему шагу</h2><div class="assistant-v2-readiness ${item.readiness.ready ? 'is-ready' : 'is-blocked'}">${item.readiness.ready ? 'Все обязательные уточнения готовы' : `Осталось вопросов: ${failed.length}`}</div><ul>${failed.map(finding => `<li><strong>${esc(fieldLabel(finding.path))}:</strong> ${esc(findingMessage(finding))}</li>`).join('')}</ul><button class="btn btn-secondary" id="assistant-v2-fidelity" ${fidelityMissing ? '' : 'disabled'}>Подтвердить соответствие исходному тексту</button></section></aside><div class="assistant-v2-column"><section class="assistant-v2-panel"><h2>Паспорт поручения</h2><p class="assistant-v2-section-hint">Выберите раздел, сформулируйте факт и укажите, какой фрагмент исходного текста его подтверждает.</p><form id="assistant-v2-claim-form" class="assistant-v2-form"><label>Раздел<select name="path"><option value="/requested_action">Требуемое действие</option><option value="/expected_outcome">Ожидаемый результат</option><option value="/business_problem">Бизнес-проблема и ценность</option><option value="/scope_in">Что входит в объём</option><option value="/scope_out">Что не входит в объём</option></select></label><label>Формулировка<textarea name="statement" rows="3" required></textarea></label><label>Подтверждающий фрагмент<select name="evidence_fragment_id" required>${evidenceOptions}</select></label><button class="btn btn-secondary" type="submit" ${evidenceOptions ? '' : 'disabled'}>Добавить факт</button></form><div id="assistant-v2-claims">${claims}</div></section>${openItems}<section class="assistant-v2-panel"><h2>Уточнить с ассистентом</h2><div id="assistant-v2-agent-result" class="assistant-v2-note">Ассистент сохранит ваше уточнение и предложит следующий шаг. Ничего не изменится без вашего подтверждения.</div><form id="assistant-v2-message-form"><label>Вопрос или уточнение<textarea name="body" rows="4" required></textarea></label><button class="btn btn-primary" type="submit">Сохранить и получить предложение</button></form></section><section class="assistant-v2-panel"><h2>Этап работы</h2><p>Сейчас: <strong>${esc(statusLabel(item.status))}</strong></p>${transitionOptions ? `<form id="assistant-v2-transition-form" class="assistant-v2-transition-form"><label>Следующий этап<select name="target_status">${transitionOptions}</select></label><label>Комментарий к решению<input name="rationale" value="Решение оператора" required></label><label class="assistant-v2-duplicate-target" hidden>Исходное поручение<select name="duplicate_target_case_id">${duplicateOptions}</select></label><button class="btn btn-secondary" type="submit">Перейти к следующему этапу</button></form>` : ''}${item.status === 'ready_for_analysis' && item.readiness.ready ? `<form id="assistant-v2-handoff-form" class="assistant-v2-form assistant-v2-next-step"><label>Название бизнес-требования<input name="title" value="${esc(item.title)}" required></label><button class="btn btn-primary" type="submit">Начать подготовку требования</button></form>` : ''}</section></div></div>`, `<a class="btn btn-secondary" href="#/assistant-v2">Все поручения</a>`);
  } catch (error) { return shell('Кейс недоступен', `<div class="assistant-v2-error" role="alert">${esc(errorMessage(error))}</div>`); }
}

export function initCaseWorkspace(app, caseId) {
  clearUnsavedGuard(app);
  const root = document.querySelector('.assistant-v2-workspace');
  if (!root) return;
  const api = assistantV2Api(app);
  const reload = () => app.router.refreshCurrentRoute();
  const transitionForm = document.getElementById('assistant-v2-transition-form');
  const transitionSelect = transitionForm?.querySelector('[name="target_status"]');
  const duplicateTarget = transitionForm?.querySelector('.assistant-v2-duplicate-target');
  const syncDuplicateTarget = () => { if (duplicateTarget) duplicateTarget.hidden = transitionSelect?.value !== 'duplicate'; };
  transitionSelect?.addEventListener('change', syncDuplicateTarget);
  syncDuplicateTarget();
  root.addEventListener('click', async event => {
    const decision = event.target.closest('.claim-decision');
    if (decision) {
      const card = decision.closest('[data-claim-id]');
      decision.disabled = true;
      try {
        await api.post(`/cases/${caseId}/claims/${card.dataset.claimId}/decision`, {
          expected_version: Number(root.dataset.version), decision: decision.dataset.decision,
          rationale: card.querySelector('.claim-rationale').value,
          passport_value: decision.dataset.decision === 'accept' ? card.querySelector('.claim-passport-value')?.value : null,
        }, { idempotencyKey: idempotencyKey('claim-decision') });
        reload();
      } catch (error) { window.toast?.(errorMessage(error), 'error'); decision.disabled = false; }
    }
    const gapDecision = event.target.closest('.gap-decision');
    if (gapDecision) {
      const card = gapDecision.closest('[data-gap-id]'); gapDecision.disabled = true;
      try {
        await api.post(`/cases/${caseId}/gaps/${card.dataset.gapId}/decisions`, {
          expected_version: Number(card.dataset.gapVersion), expected_case_version: Number(root.dataset.version),
          decision: gapDecision.dataset.decision, rationale: 'Пробел закрыт решением оператора',
        }, { idempotencyKey: idempotencyKey('gap-decision') });
        reload();
      } catch (error) { window.toast?.(errorMessage(error), 'error'); gapDecision.disabled = false; }
    }
    const conflictDecision = event.target.closest('.conflict-decision');
    if (conflictDecision) {
      const card = conflictDecision.closest('[data-conflict-id]'); conflictDecision.disabled = true;
      try {
        await api.post(`/cases/${caseId}/conflicts/${card.dataset.conflictId}/decisions`, {
          expected_version: Number(card.dataset.conflictVersion), expected_case_version: Number(root.dataset.version),
          decision: conflictDecision.dataset.decision, rationale: 'Явное решение оператора по конфликту',
          owner_snapshot: conflictDecision.dataset.decision === 'escalate' ? { role: 'decision_owner' } : null,
        }, { idempotencyKey: idempotencyKey('conflict-decision') });
        reload();
      } catch (error) { window.toast?.(errorMessage(error), 'error'); conflictDecision.disabled = false; }
    }
    if (event.target.id === 'assistant-v2-fidelity') {
      event.target.disabled = true;
      try {
        await api.post(`/cases/${caseId}/decisions`, {
          expected_version: Number(root.dataset.version), decision_type: 'fidelity_confirmation',
          rationale: 'Паспорт соответствует доступному первоисточнику', revision_digest: root.dataset.digest, target_refs: {},
        }, { idempotencyKey: idempotencyKey('fidelity') });
        reload();
      } catch (error) { window.toast?.(errorMessage(error), 'error'); event.target.disabled = false; }
    }
  });
  document.getElementById('assistant-v2-claim-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    const values = new FormData(event.currentTarget);
    try {
      await api.post(`/cases/${caseId}/claims`, {
        expected_version: Number(root.dataset.version), statement: values.get('statement'), path: values.get('path'),
        claim_type: 'source_statement', evidence_fragment_ids: [values.get('evidence_fragment_id')], status: 'proposed',
      }, { idempotencyKey: idempotencyKey('claim') });
      reload();
    } catch (error) { window.toast?.(errorMessage(error), 'error'); button.disabled = false; }
  });
  document.getElementById('assistant-v2-gap-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    const values = new FormData(event.currentTarget); const nextStep = String(values.get('next_step') || '').trim();
    try {
      await api.post(`/cases/${caseId}/gaps`, {
        expected_version: Number(root.dataset.version), rule_id: 'MANUAL_GAP', path: values.get('path'),
        severity: values.get('severity'), owner_snapshot: nextStep ? { role: 'operator' } : null,
        next_step: nextStep || null, due_at: null,
      }, { idempotencyKey: idempotencyKey('gap') });
      reload();
    } catch (error) { window.toast?.(errorMessage(error), 'error'); button.disabled = false; }
  });
  document.getElementById('assistant-v2-conflict-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    const values = new FormData(event.currentTarget);
    try {
      await api.post(`/cases/${caseId}/conflicts`, {
        expected_version: Number(root.dataset.version), left_ref: values.get('left_ref'),
        right_ref: values.get('right_ref'), severity: values.get('severity'),
      }, { idempotencyKey: idempotencyKey('conflict') });
      reload();
    } catch (error) { window.toast?.(errorMessage(error), 'error'); button.disabled = false; }
  });
  document.getElementById('assistant-v2-message-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    try {
      const result = await api.post(`/cases/${caseId}/messages`, {
        message_id: idempotencyKey('msg'), body: new FormData(event.currentTarget).get('body'),
        expected_case_version: Number(root.dataset.version), mode: 'capture_assignment', client_context: { locale: 'ru-RU' },
      }, { idempotencyKey: idempotencyKey('message') });
      document.getElementById('assistant-v2-agent-result').textContent = result.assistant_message;
      setTimeout(reload, 400);
    } catch (error) { window.toast?.(errorMessage(error), 'error'); button.disabled = false; }
  });
  document.getElementById('assistant-v2-transition-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    const values = new FormData(event.currentTarget);
    try {
      await api.post(`/cases/${caseId}/transitions`, {
        expected_version: Number(root.dataset.version), target_status: values.get('target_status'),
        rationale: values.get('rationale'),
        disposition: values.get('target_status') === 'duplicate' ? { target_case_id: values.get('duplicate_target_case_id') } : {},
      }, { idempotencyKey: idempotencyKey('transition') });
      reload();
    } catch (error) { window.toast?.(errorMessage(error), 'error'); button.disabled = false; }
  });
  document.getElementById('assistant-v2-handoff-form')?.addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
    const values = new FormData(event.currentTarget);
    try {
      const result = await api.post(`/cases/${caseId}/handoffs`, {
        expected_version: Number(root.dataset.version), rationale: 'Кейс готов к проработке бизнес-требования',
        requirements: [{ title: values.get('title'), content: {} }],
      }, { idempotencyKey: idempotencyKey('handoff') });
      app.router.navigate(`/assistant-v2/requirements/${result.artifact_ids[0]}`);
    } catch (error) { window.toast?.(errorMessage(error), 'error'); button.disabled = false; }
  });
}
