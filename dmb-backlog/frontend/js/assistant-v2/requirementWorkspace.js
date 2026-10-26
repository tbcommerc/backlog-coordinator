import { assistantV2Api, idempotencyKey } from './api.js';
import { clearUnsavedGuard, installUnsavedGuard } from './accessibility.js';
import { fieldLabel, findingMessage, statusLabel } from './presentation.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const listText = value => Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n') : (value || '');
const asList = value => String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);

function journey(activeStep) {
  const steps = ['Поручение', 'Уточнение', 'Требование', 'Проверка', 'Задача'];
  return `<ol class="assistant-v2-journey" aria-label="Этапы работы">${steps.map((label, index) => `<li class="${index + 1 < activeStep ? 'is-complete' : index + 1 === activeStep ? 'is-current' : ''}"><span>${index + 1}</span>${label}</li>`).join('')}</ol>`;
}

function renderRequirementSummary(content) {
  const sections = ['purpose', 'target_outcome', 'scope_in', 'scope_out', 'actors', 'primary_scenarios', 'business_rules', 'assumptions', 'acceptance_criteria', 'traceability'];
  return `<div class="assistant-v2-summary">${sections.map(key => {
    const values = Array.isArray(content[key]) ? content[key] : [content[key]];
    const items = values.filter(value => String(value || '').trim());
    return `<section><h3>${esc(fieldLabel(`/${key}`))}</h3>${items.length > 1 ? `<ul>${items.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : `<p>${esc(items[0] || 'Не заполнено')}</p>`}</section>`;
  }).join('')}</div>`;
}

export function renderNewRequirement() {
  return `<main class="assistant-v2-page"><header class="assistant-v2-header"><div><span class="assistant-v2-eyebrow">Помощник подготовки требований</span><h1>Начните с поручения</h1></div></header>${journey(1)}<section class="assistant-v2-panel"><h2>Как перейти к бизнес-требованию</h2><p>Сначала зафиксируйте поручение и подтвердите его ключевые факты. Когда всё будет готово, на экране поручения появится кнопка перехода к требованию.</p><a class="btn btn-primary" href="#/assistant-v2">Перейти к поручениям</a></section></main>`;
}

export function initNewRequirement() {}

function field(name, label, value, rows = 3) {
  return `<label>${esc(label)}<textarea name="${esc(name)}" rows="${rows}">${esc(listText(value))}</textarea></label>`;
}

export async function renderRequirementWorkspace(app, artifactId) {
  try {
    const artifact = await assistantV2Api(app).get(`/artifacts/${artifactId}`);
    const content = artifact.current_revision?.content || {};
    const findings = artifact.readiness?.findings || [];
    const linkedIds = new Set((artifact.current_revision?.claim_traceability || []).map(link => link.claim_id));
    const claimChoices = (artifact.available_claims || []).map(claim => `<label class="assistant-v2-check"><input type="checkbox" name="claim_link" value="${esc(claim.id)}" ${linkedIds.has(claim.id) ? 'checked' : ''}><span><strong>${esc(fieldLabel(claim.path))}</strong> — ${esc(claim.statement)}</span></label>`).join('') || '<p class="assistant-v2-note">В поручении ещё нет подтверждённых фактов.</p>';
    const traceabilityInspector = (artifact.current_revision?.claim_traceability || []).map(link => `<li><strong>${esc(fieldLabel(link.usage_path))}</strong> — ${esc(link.claim?.statement)} <small>· подтверждений: ${link.claim?.evidence?.length || 0}</small></li>`).join('') || '<li>Связи с исходными фактами появятся после сохранения новой версии.</li>';
    return `<main class="assistant-v2-page"><header class="assistant-v2-header"><div><span class="assistant-v2-eyebrow">Бизнес-требование · ${esc(statusLabel(artifact.status))}</span><h1>${esc(content.title || 'Бизнес-требование')}</h1></div><a class="btn btn-secondary" href="#/assistant-v2">Все поручения</a></header>${journey(3)}<div class="assistant-v2-workspace" data-artifact-id="${esc(artifact.id)}" data-version="${artifact.version}" data-revision-id="${esc(artifact.current_revision_id)}"><section class="assistant-v2-panel"><h2>Содержание требования</h2><form id="assistant-v2-requirement-form" class="assistant-v2-form"><label>Название<input name="title" value="${esc(content.title)}" required></label>${field('purpose', 'Проблема или цель', content.purpose)}${field('target_outcome', 'Целевой результат', content.target_outcome)}${field('scope_in', 'Что входит в объём — по одному пункту в строке', content.scope_in)}${field('scope_out', 'Что не входит в объём', content.scope_out)}${field('actors', 'Участники', content.actors)}${field('primary_scenarios', 'Основные сценарии', content.primary_scenarios, 5)}${field('business_rules', 'Бизнес-правила', content.business_rules, 5)}${field('assumptions', 'Допущения', content.assumptions)}${field('acceptance_criteria', 'Критерии приёмки', content.acceptance_criteria, 5)}${field('traceability', 'Связь с исходными данными', content.traceability)}<fieldset><legend>Какие факты из поручения подтверждают эту версию</legend>${claimChoices}</fieldset><button class="btn btn-primary" type="submit">Сохранить новую версию</button></form></section><aside class="assistant-v2-column"><section class="assistant-v2-panel"><h2>Проверка готовности</h2><div class="assistant-v2-readiness ${artifact.readiness.ready ? 'is-ready' : 'is-blocked'}">${artifact.readiness.ready ? 'Требование готово к проверке' : `Осталось замечаний: ${findings.length}`}</div><ul>${findings.map(item => `<li><strong>${esc(fieldLabel(item.path))}:</strong> ${esc(findingMessage(item))}</li>`).join('')}</ul><button class="btn btn-secondary" id="assistant-v2-validate">Проверить заполнение</button><button class="btn btn-primary" id="assistant-v2-review" ${artifact.readiness.ready ? '' : 'disabled'}>Передать на проверку</button></section><section class="assistant-v2-panel"><h2>Связь с исходными данными</h2><ul>${traceabilityInspector}</ul></section><section class="assistant-v2-panel"><h2>История версий</h2><ol>${artifact.revisions.map(item => `<li>Версия ${item.revision_no}</li>`).join('')}</ol></section></aside></div></main>`;
  } catch (error) { return `<main class="assistant-v2-page"><div class="assistant-v2-error" role="alert">${esc(error.message)}</div></main>`; }
}

export function initRequirementWorkspace(app, artifactId) {
  const root = document.querySelector('.assistant-v2-workspace'); if (!root) return;
  const form = document.getElementById('assistant-v2-requirement-form'); let dirty = false;
  installUnsavedGuard(app, () => dirty); form.addEventListener('input', () => { dirty = true; });
  const api = assistantV2Api(app); const reload = () => { dirty = false; clearUnsavedGuard(app); app.router.refreshCurrentRoute(); };
  form.addEventListener('submit', async event => {
    event.preventDefault(); const button = form.querySelector('button'); button.disabled = true; const data = Object.fromEntries(new FormData(form));
    const content = { title: data.title, purpose: data.purpose, target_outcome: data.target_outcome, scope_in: asList(data.scope_in), scope_out: asList(data.scope_out), actors: asList(data.actors), primary_scenarios: asList(data.primary_scenarios), business_rules: asList(data.business_rules), assumptions: asList(data.assumptions), acceptance_criteria: asList(data.acceptance_criteria), traceability: asList(data.traceability), unresolved_items: [] };
    const claimLinks = [...form.querySelectorAll('input[name="claim_link"]:checked')].map(input => ({ claim_id: input.value, usage_path: '/', usage_type: 'supports' }));
    try { await api.post(`/artifacts/${artifactId}/revisions`, { expected_version: Number(root.dataset.version), base_revision_id: root.dataset.revisionId, content, claim_links: claimLinks }, { idempotencyKey: idempotencyKey('revision') }); reload(); }
    catch (error) { window.toast?.(error.message, 'error'); button.disabled = false; }
  });
  document.getElementById('assistant-v2-validate')?.addEventListener('click', async event => {
    event.target.disabled = true; try { const result = await api.post(`/artifacts/${artifactId}/validate`, { revision_id: root.dataset.revisionId }); window.toast?.(result.ready ? 'Проверка пройдена' : `Найдено замечаний: ${result.findings.length}`, result.ready ? 'success' : 'warning'); }
    catch (error) { window.toast?.(error.message, 'error'); } finally { event.target.disabled = false; }
  });
  document.getElementById('assistant-v2-review')?.addEventListener('click', async event => {
    event.target.disabled = true; try { const result = await api.post(`/artifacts/${artifactId}/review-candidates`, { expected_version: Number(root.dataset.version), revision_id: root.dataset.revisionId, rationale: 'Передано на содержательное ревью' }, { idempotencyKey: idempotencyKey('review') }); app.router.navigate(`/assistant-v2/reviews/${result.review_gate_id}`); }
    catch (error) { window.toast?.(error.message, 'error'); event.target.disabled = false; }
  });
}

export async function renderReviewGate(app, gateId) {
  try {
    const gate = await assistantV2Api(app).get(`/review-gates/${gateId}`); const revision = gate.artifact.current_revision;
    return `<main class="assistant-v2-page"><header class="assistant-v2-header"><div><span class="assistant-v2-eyebrow">Проверка бизнес-требования · ${esc(statusLabel(gate.status))}</span><h1>${esc(revision.content.title)}</h1></div><a class="btn btn-secondary" href="#/assistant-v2">Все поручения</a></header>${journey(4)}<section class="assistant-v2-panel" data-gate-id="${esc(gate.id)}" data-version="${gate.version}"><h2>Что проверяем</h2>${renderRequirementSummary(revision.content)}<label>Комментарий к решению<textarea id="assistant-v2-review-rationale" rows="3" placeholder="Укажите, почему требование можно утвердить или что нужно доработать" required></textarea></label><div class="assistant-v2-row"><button class="btn btn-secondary review-decision" data-decision="return">Вернуть на доработку</button><button class="btn btn-primary review-decision" data-decision="approve">Утвердить требование</button></div></section></main>`;
  } catch (error) { return `<main class="assistant-v2-page"><div class="assistant-v2-error">${esc(error.message)}</div></main>`; }
}

export function initReviewGate(app, gateId) {
  clearUnsavedGuard(app); const panel = document.querySelector('[data-gate-id]'); if (!panel) return;
  panel.addEventListener('click', async event => { const button = event.target.closest('.review-decision'); if (!button) return; const rationale = document.getElementById('assistant-v2-review-rationale').value.trim(); if (!rationale) return window.toast?.('Укажите обоснование', 'warning'); button.disabled = true; try { const result = await assistantV2Api(app).post(`/review-gates/${gateId}/decisions`, { expected_version: Number(panel.dataset.version), decision: button.dataset.decision, rationale }, { idempotencyKey: idempotencyKey('review-decision') }); app.router.navigate(`/assistant-v2/requirements/${result.artifact.id}`); } catch (error) { window.toast?.(error.message, 'error'); button.disabled = false; } });
}
