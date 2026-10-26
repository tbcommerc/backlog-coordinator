import assert from 'node:assert/strict';
import test from 'node:test';
import { sectionPresentation, renderGenerationReport } from '../js/agent-v2/generation.js';
import { renderBusinessRequirements } from '../js/agent-v2/documentReview.js';

test('parsing and transfer have independent counters; legacy reports do not certify parsing', () => {
  const state = { document_generation: { status: 'partial', facts_covered: 18, facts_total: 18, source_parsing: { status: 'partial', accounted_lines: 25, nonempty_lines: 25, unresolved: [{ line: 3 }] } } };
  const html = renderGenerationReport(state);
  assert.match(html, /Разбор источника/);
  assert.match(html, /неразобранных: 1/);
  assert.match(html, /18 из 18 выделенных/);
  delete state.document_generation.source_parsing;
  assert.match(renderGenerationReport(state), /отдельная проверка не выполнялась/);
});

test('requirement evidence opens exact immutable source line, including escaped content', () => {
  const state = { document_sources: [{ id: 'src', version: 1, title: 'Источник', content: 'Цель\nСократить затраты\nБизнес-требование\nУведомить <исполнителя>' }], draft: { business_requirements: [{ id: 'BR-1', text: 'Уведомить', source_refs: ['src@1#L4'] }] } };
  const html = renderBusinessRequirements(state);
  assert.match(html, /строка 4/);
  assert.match(html, /<blockquote>Уведомить &lt;исполнителя&gt;<\/blockquote>/);
  assert.doesNotMatch(html, /Сократить затраты/);
});

test('empty source, failed processing and unconfirmed text have distinct labels', () => {
  const state = { document_generation: { status: 'partial', section_states: { business_goal: { status: 'missing_data', reason: 'Нет цели' }, scope_in: { status: 'unprocessed' } } } };
  assert.equal(sectionPresentation(state, 'business_goal', '').label, 'Нет данных в источнике');
  assert.equal(sectionPresentation(state, 'scope_in', '').label, 'Не удалось обработать');
  assert.equal(sectionPresentation(state, 'problem_statement', 'Текст').label, 'Требуется подтверждение');
  state.document_generation.stale = true;
  assert.equal(sectionPresentation(state, 'business_goal', '').label, 'Не заполнено');
});

test('transfer report escapes quotes and prefers a fresh review', () => {
  const state = { draft: { fingerprint: 'h2' }, document_generation: { status: 'partial', stale: true }, document_review: { base_fingerprint: 'h2', transfer_check: { status: 'partial', issues: [{ message: '<script>', quote: '<img>', field: 'scope_out' }] } } };
  const html = renderGenerationReport(state, { scope_out: 'За рамками' });
  assert.match(html, /За рамками/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<img>/);
  state.document_review.stale = true;
  assert.match(renderGenerationReport(state), /Проверка переноса устарела/);
});
