import { assistantV2Api, idempotencyKey } from './api.js';
import { clearUnsavedGuard } from './accessibility.js';
import { fieldLabel, operationLabel, riskLabel, statusLabel, targetLabel } from './presentation.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function journey() {
  const steps = ['Поручение', 'Уточнение', 'Требование', 'Проверка', 'Задача'];
  return `<ol class="assistant-v2-journey" aria-label="Этапы работы">${steps.map((label, index) => `<li class="${index < 4 ? 'is-complete' : 'is-current'}"><span>${index + 1}</span>${label}</li>`).join('')}</ol>`;
}

function renderValue(value) {
  if (Array.isArray(value)) return `<ul>${value.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
  if (value && typeof value === 'object') return `<dl>${Object.entries(value).map(([key, item]) => `<dt>${esc(fieldLabel(`/${key}`))}</dt><dd>${esc(item)}</dd>`).join('')}</dl>`;
  return `<p>${esc(value ?? 'Пустое значение')}</p>`;
}

export async function renderDiffReview(app, diffId) {
  try {
    const diff = await assistantV2Api(app).get(`/diffs/${diffId}`);
    return `<main class="assistant-v2-page"><header class="assistant-v2-header"><div><span class="assistant-v2-eyebrow">Перенос изменений · ${esc(statusLabel(diff.status))}</span><h1>Изменения для ${esc(targetLabel(diff.target.type))} №${esc(diff.target.id)}</h1></div><a class="btn btn-secondary" href="#/assistant-v2">Все поручения</a></header>${journey()}<section class="assistant-v2-panel" data-diff-id="${esc(diff.id)}" data-version="${diff.version}" data-target-id="${esc(diff.target.id)}"><h2>Проверьте каждое изменение</h2><p class="assistant-v2-section-hint">Изменения подготовлены на основе версии ${diff.target.base_version}. Ни одно из них не попадёт в задачу без вашего решения.</p><div class="assistant-v2-diff-list">${diff.operations.map(operation => `<article class="assistant-v2-diff-operation" data-operation-id="${esc(operation.id)}"><div><strong>${esc(operationLabel(operation.op))}: ${esc(fieldLabel(operation.path))}</strong><span class="assistant-v2-status">${esc(statusLabel(operation.decision_status))}</span></div><div class="assistant-v2-proposed-value">${renderValue(operation.proposed_value)}</div><p>${esc(operation.rationale)}</p><small>Риск: ${esc(riskLabel(operation.risk))} · подтверждённых фактов: ${operation.claim_refs.length} · источников: ${operation.evidence_refs.length}</small>${operation.decision_status === 'pending' ? `<label>Комментарий к решению<input class="diff-rationale" value="Сверено с утверждённым требованием и источниками"></label><div class="assistant-v2-row"><button class="btn btn-primary diff-decision" data-decision="accept">Принять</button><button class="btn btn-secondary diff-decision" data-decision="reject">Отклонить</button></div>` : ''}</article>`).join('')}</div><button class="btn btn-primary" id="assistant-v2-apply-intent" ${diff.status === 'accepted' && diff.source_baseline_approved ? '' : 'disabled'}>Открыть форму задачи с принятыми изменениями</button>${!diff.source_baseline_approved ? '<p class="assistant-v2-note">Сначала утвердите бизнес-требование. После этого можно будет перенести изменения в задачу.</p>' : ''}${diff.status === 'stale' ? '<p class="assistant-v2-error">Задача уже изменилась. Обновите предложения перед переносом.</p>' : ''}</section></main>`;
  } catch (error) { return `<main class="assistant-v2-page"><div class="assistant-v2-error" role="alert">${esc(error.message)}</div></main>`; }
}

export function initDiffReview(app, diffId) {
  clearUnsavedGuard(app); const panel = document.querySelector('[data-diff-id]'); if (!panel) return; const api = assistantV2Api(app);
  panel.addEventListener('click', async event => {
    const decision = event.target.closest('.diff-decision');
    if (decision) {
      const operation = decision.closest('[data-operation-id]'); decision.disabled = true;
      try { await api.post(`/diffs/${diffId}/operations/${operation.dataset.operationId}/decision`, { expected_version: Number(panel.dataset.version), decision: decision.dataset.decision, rationale: operation.querySelector('.diff-rationale').value }, { idempotencyKey: idempotencyKey('diff-decision') }); app.router.refreshCurrentRoute(); }
      catch (error) { window.toast?.(error.message, 'error'); decision.disabled = false; }
    }
    if (event.target.id === 'assistant-v2-apply-intent') {
      event.target.disabled = true;
      try { const result = await api.post(`/diffs/${diffId}/apply-intents`, { expected_version: Number(panel.dataset.version) }, { idempotencyKey: idempotencyKey('apply-intent') }); sessionStorage.setItem(`assistant-v2-task-prefill:${panel.dataset.targetId}`, JSON.stringify(result.prefill)); window.location.hash = result.form_url.slice(1); }
      catch (error) { window.toast?.(error.message, 'error'); event.target.disabled = false; }
    }
  });
}
