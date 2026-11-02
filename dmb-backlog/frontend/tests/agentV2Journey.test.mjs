import assert from 'node:assert/strict';
import test from 'node:test';
import { currentFindings, submissionReadiness, renderNextStep, renderApprovalPreview } from '../js/agent-v2/journey.js';

const ready = () => ({ artifact_id: 'a1', draft: { artifact_id: 'a1', title: '<Заявка>', fingerprint: 'h1', revision: 1, problem_statement: 'Проблема', business_goal: 'Цель', scope_in: ['Граница'], acceptance_criteria: ['Критерий'] }, document_review: { id: 'r1', base_fingerprint: 'h1', status: 'completed' }, document_findings: [] });

test('readiness blocks unknown required fields, stale review and unresolved critical findings', () => {
  const state = ready();
  assert.equal(submissionReadiness(state).ready, true);
  state.draft.scope_in = ['Неизвестно'];
  assert.deepEqual(submissionReadiness(state).missing, ['scope_in']);
  state.draft.scope_in = ['Граница'];
  state.document_review.stale = true;
  assert.equal(submissionReadiness(state).ready, false);
  state.document_review.stale = false;
  state.document_findings = [{ id: 'f1', review_id: 'r1', base_fingerprint: 'h1', severity: 'critical', status: 'deferred', reason: 'Пока неизвестно' }];
  assert.equal(submissionReadiness(state).ready, false);
  state.document_findings[0].status = 'resolved';
  assert.equal(submissionReadiness(state).ready, true);
  state.document_findings[0].reason = '';
  assert.equal(submissionReadiness(state).ready, false);
});

test('past checks do not block the latest review of the same document revision', () => {
  const state = ready();
  state.document_findings = [{ review_id: 'r0', base_fingerprint: 'h1', severity: 'critical', status: 'open' }];
  assert.deepEqual(currentFindings(state), []);
  assert.equal(submissionReadiness(state).ready, true);
});

test('each stage has one main action and preview does not imply approval', () => {
  const state = ready();
  for (const [view, action] of [['document', 'review'], ['review', 'preview'], ['approval', 'submit']]) {
    const html = renderNextStep(state, view);
    assert.equal((html.match(/<button\b[^>]*data-journey-action=/g) || []).length, 1);
    assert.match(html, action === 'review' ? /btn-ai-primary/ : /btn-primary/);
    if (action !== 'review') assert.doesNotMatch(html, /btn-ai/);
    assert.match(html, new RegExp(`data-journey-action="${action}"`));
  }
  const preview = renderApprovalPreview(state);
  assert.match(preview, /&lt;Заявка&gt;/);
  assert.match(preview, /очередь согласования бизнес-требований/);
  assert.match(preview, /Критерий/);
  assert.doesNotMatch(preview, /data-journey-action="submit"/);
  assert.match(renderNextStep(state, 'document', { artifact_id: 'a1', artifact_fingerprint: 'h1', status: 'submitted' }), /Документ отправлен на согласование/);
  assert.doesNotMatch(renderNextStep(state, 'document', { artifact_id: 'a1', artifact_fingerprint: 'older', status: 'approved' }), /Эта редакция согласована/);
});
