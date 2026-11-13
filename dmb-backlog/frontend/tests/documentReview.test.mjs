import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewStage, formatDocumentDate, isReviewStale, isCurrentDraftApproved, renderDocumentReview, renderDocumentProposals, renderDocumentSources, renderRequirementSnapshot, compareDocumentSnapshots, renderDocumentComparison } from '../js/agent-v2/documentReview.js';
import { allowedReviewActions, renderRequirementReviewDetail, requirementReviewStatus } from '../js/components/requirementReviews.js';
import { AgentV2Api } from '../js/agent-v2/api.js';

test('review becomes stale when either document or sources change', () => {
  const state = { draft: { fingerprint: 'current' }, document_review: { id: 'review-1', base_fingerprint: 'current', stale: false } };
  assert.equal(isReviewStale(state), false);
  assert.equal(isReviewStale({ ...state, document_review: { ...state.document_review, stale: true } }), true);
  assert.equal(isReviewStale({ ...state, draft: { fingerprint: 'next' } }), true);
});

test('review rendering preserves input, addresses evidence, escapes text and disables stale actions', () => {
  const state = { draft: { fingerprint: 'hash' }, document_sources: [{ id: 'source-1', version: 2, title: 'Интервью', sections: [{ id: 'source-1@2#section-1', title: 'Ожидания' }] }], document_review: { id: 'review-1', base_fingerprint: 'hash', revision: 1, status: 'degraded' }, document_findings: [{ id: 'f1', base_fingerprint: 'hash', field: 'business_goal', severity: 'critical', status: 'open', message: '<script>bad()</script>', quote: 'быстро', risk: 'Невозможно проверить', method: 'llm', sources: ['source-1@2#section-1'], related: [{ field: 'acceptance_criteria', quote: 'Три дня' }] }] };
  const before = structuredClone(state);
  const html = renderDocumentReview(state);
  assert.deepEqual(state, before);
  assert.match(html, /LLM-проверка не завершена/);
  assert.match(html, /&lt;script&gt;bad/);
  assert.match(html, /<blockquote>быстро<\/blockquote>/);
  assert.match(html, /name="reason"/);
  assert.match(html, /Интервью \(версия 2\) · Ожидания/);
  assert.match(html, /<blockquote>Три дня<\/blockquote>/);
  assert.match(html, /value="rejected"/);
  const stale = renderDocumentReview({ ...state, draft: { fingerprint: 'next' } });
  assert.match(stale, /предыдущая редакция/);
  assert.doesNotMatch(stale, /class="agent-v2-finding-form"/);
});

test('empty server review object is shown as not yet checked', () => {
  const state = { draft: { fingerprint: 'hash' }, document_review: {} };
  assert.equal(isReviewStale(state), false);
  assert.match(renderDocumentReview(state), /проверка ещё не выполнена/);
  assert.doesNotMatch(renderDocumentReview(state), /Проверка завершена|Проверена предыдущая/);
});

test('approval belongs only to the matching artifact and exact frozen revision', () => {
  const state = { artifact_id: 'doc-1', draft: { fingerprint: 'approved-hash' } };
  const review = { status: 'approved', artifact_id: 'doc-1', artifact_fingerprint: 'approved-hash' };
  assert.equal(isCurrentDraftApproved(state, review), true);
  assert.equal(isCurrentDraftApproved({ ...state, draft: { fingerprint: 'new-working-hash' } }, review), false);
  assert.equal(isCurrentDraftApproved({ ...state, artifact_id: 'another-document' }, review), false);
  assert.equal(isCurrentDraftApproved(state, { ...review, status: 'submitted' }), false);
});

test('revision comparison shows actual content changes, human feedback and removals without metadata noise', () => {
  const before = { revision: 1, fingerprint: 'old', business_goal: 'Старый результат', scope_out: ['Вне объёма'], custom: { a: 1, b: 2 } };
  const after = { revision: 2, fingerprint: 'new', business_goal: 'Новый результат', custom: { b: 2, a: 1 } };
  assert.deepEqual(compareDocumentSnapshots(before, after).map(item => item.field), ['business_goal', 'scope_out']);
  const html = renderDocumentComparison({ artifact_revision: 1, artifact_snapshot: before, comment: 'Уточните границы' }, after);
  assert.match(html, /отправленной редакции 1 \(2\)/);
  assert.match(html, /Старый результат/);
  assert.match(html, /Новый результат/);
  assert.match(html, /Уточните границы/);
  assert.match(html, /Не указано/);
});

test('proposals expose individually selectable operations and prohibit obsolete application', () => {
  const proposal = { id: 'p1', base_fingerprint: 'hash', status: 'proposed', operations: [{ id: 'op1', field: 'business_goal', before: 'Было', after: 'Стало', status: 'proposed', reason: 'Основание' }] };
  const state = { draft: { fingerprint: 'hash' }, document_proposals: [proposal] };
  assert.match(renderDocumentProposals(state), /name="operation_id" value="op1" checked/);
  assert.match(renderDocumentProposals(state), /Применить выбранные правки/);
  assert.doesNotMatch(renderDocumentProposals({ ...state, draft: { fingerprint: 'other' } }), /type="submit"/);
  const initial = renderDocumentProposals({ draft: null, document_proposals: [{ ...proposal, base_fingerprint: '' }] });
  assert.match(initial, /Применить выбранные правки/);
});

test('every raw snapshot field is readable, including unknown preserved V2 fields', () => {
  const html = renderRequirementSnapshot({ schema_version: 'v2', fingerprint: 'private-hash', prompt_set_version: 'prompt-version', business_requirements: [{ id: 'BR-001', text: 'Бизнес-результат', source_refs: ['original-source'], status: 'confirmed' }], exception_scenarios: ['Исключение'], custom_preserved_context: { original: '<b>Исходный материал</b>' } });
  assert.match(html, /BR-001: Бизнес-результат/);
  assert.match(html, /Исключение/);
  assert.match(html, /custom_preserved_context/);
  assert.match(html, /original-source/);
  assert.match(html, /confirmed/);
  assert.match(html, /&lt;b&gt;Исходный материал/);
  const metadataStart = html.indexOf('<details class="requirement-review-metadata">');
  assert.ok(metadataStart > html.indexOf('custom_preserved_context'));
  assert.ok(html.indexOf('private-hash') > metadataStart);
  assert.ok(html.indexOf('prompt-version') > metadataStart);
  assert.match(html, /<summary class="ui-disclosure-text">Сведения о редакции<\/summary>/);
});

test('multiple sources retain separate labels, versions and content', () => {
  const html = renderDocumentSources({ document_sources: [{ id: 's1', title: 'Интервью', version: 2, content: 'Один' }, { id: 's2', title: 'Регламент', version: 1, content: 'Другой' }] }, { locked: true });
  assert.match(html, /Материалы \(2\)/);
  assert.match(html, /Интервью · версия 2/);
  assert.match(html, /Другой/);
  assert.doesNotMatch(html, /<form/);
});

test('human review follows server action permissions and renders frozen snapshot without editable findings', () => {
  const review = { id: 42, creator_name: 'Автор', status: 'submitted', reviewer_id: 11, artifact_revision: 3, artifact_snapshot: { title: 'БТ', fingerprint: 'frozen', business_goal: 'Зафиксированная цель' }, available_actions: ['approve', 'return', 'withdraw'], permissions: { can_approve: false, can_return: true, can_open_workspace: false }, context_changed: true };
  assert.deepEqual(allowedReviewActions(review), ['return']);
  assert.equal(requirementReviewStatus(review), 'На ревью');
  const html = renderRequirementReviewDetail(review);
  assert.match(html, /Зафиксированная цель/);
  assert.match(html, /value="return"/);
  assert.doesNotMatch(html, /value="approve"|requirement-review-resume|agent-v2-finding-form/);
  assert.match(html, /Согласование недоступно/);
});

test('document actions carry expected version and one idempotency key in header and body', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => { captured = { url, options }; return { ok: true, status: 200, json: async () => ({ session_id: 's1' }) }; };
  try {
    const api = new AgentV2Api({ api: { getHeaders: () => ({ Authorization: 'Bearer fixture' }) } });
    await api.documentAction({ session_id: 's1', draft: { fingerprint: 'hash' } }, 'review');
    assert.equal(captured.url, '/api/v2/agent/document-action');
    const body = JSON.parse(captured.options.body);
    assert.equal(body.expected_draft_hash, 'hash');
    assert.equal(body.action, 'review');
    assert.equal(body.idempotency_key, captured.options.headers['Idempotency-Key']);
    assert.equal(captured.options.headers['Content-Type'], 'application/json');
    assert.equal('user_id' in body, false);
  } finally { globalThis.fetch = originalFetch; }
});


test('review journey distinguishes partial, blocking, stale and completed checks', () => {
  const state = { draft: { fingerprint: 'h1' }, document_review: { id: 'r1', base_fingerprint: 'h1', status: 'completed' }, document_findings: [] };
  assert.deepEqual(reviewStage(state), { label: 'Проверено', done: true });
  state.document_findings = [{ severity: 'critical', status: 'deferred' }];
  assert.deepEqual(reviewStage(state), { label: 'Есть блокеры', done: false });
  state.document_review.status = 'degraded';
  assert.deepEqual(reviewStage(state), { label: 'Проверено частично · есть блокеры', done: false });
  state.draft.fingerprint = 'h2';
  assert.deepEqual(reviewStage(state), { label: 'Проверка устарела', done: false });
});

test('review labels and dates are localized; invalid timestamps stay readable', () => {
  const html = renderDocumentReview({ draft: { fingerprint: 'h1' }, document_review: { id: 'r1', base_fingerprint: 'h1', status: 'completed', created_at: '2026-10-09T14:43:11.247149+00:00' }, document_findings: [{ field: 'primary_role', message: 'Уточнить роль', base_fingerprint: 'h1' }] });
  assert.match(html, /Основная роль/);
  assert.doesNotMatch(html, /primary_role|T14:43/);
  assert.equal(formatDocumentDate('bad-date'), 'Дата не указана');
});
