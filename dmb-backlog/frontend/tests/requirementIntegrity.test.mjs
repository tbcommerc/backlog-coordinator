import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderRequirementSections, renderRequestHistory, signalCount, getSignalTarget } from '../js/components/requestPresentation.js';

const draft = {
  process: 'PROCESS_MARKER', department: 'DEPARTMENT_MARKER', priority: 'PRIORITY_MARKER',
  primary_role: 'PRIMARY_ROLE_MARKER', affected_users: ['AFFECTED_MARKER'],
  problem_statement: 'NEED_MARKER', target_process: 'TARGET_MARKER',
  risks: ['RISK_MARKER'], dependencies: ['DEPENDENCY_MARKER'],
  field_status: { problem_statement: 'filled', dependencies: 'not_applicable' },
  field_provenance: { problem_statement: { source: 'user_message', confirmed: false, evidence: '<Evidence>', message_id: 'm1', claims: [{ value: 'Added fact', evidence: 'CLAIM_QUOTE', message_id: 'm2' }] } },
  sources: [{ title: 'SOURCE_MARKER', uri: 'https://example.test/requirements', version: 'v2', section: 'Scope', text: 'SOURCE_QUOTE' }],
};
const html = renderRequirementSections(draft);
for (const text of ['PROCESS_MARKER', 'DEPARTMENT_MARKER', 'PRIORITY_MARKER', 'PRIMARY_ROLE_MARKER', 'AFFECTED_MARKER', 'RISK_MARKER', 'DEPENDENCY_MARKER', 'SOURCE_MARKER', 'SOURCE_QUOTE', 'CLAIM_QUOTE', 'Сообщение: m2', '&lt;Evidence&gt;', 'Отдельное подтверждение не зафиксировано']) assert.ok(html.includes(text), text);
assert.match(html, /href="https:\/\/example.test\/requirements"/);
assert.match(html, /версия v2/);
assert.doesNotMatch(html, /Подтверждённая заказчиком формулировка/);
const unsafe = renderRequirementSections({ sources: [{ title: '<Unsafe>', uri: 'javascript:alert(1)' }] });
assert.doesNotMatch(unsafe, /href="javascript:/);
assert.match(unsafe, /&lt;Unsafe&gt;/);

assert.equal(signalCount({ quality_issues: [{ message: 'Quality warning' }], review_findings: [{ message: 'Review warning', severity: 'warning' }], gaps: [{ question: 'Open gap', status: 'open' }] }), 3);
assert.equal(signalCount({ open_questions: ['Same issue'], quality_issues: [{ message: 'Same issue' }], gaps: [{ question: 'Resolved gap', status: 'resolved' }] }), 1);
assert.equal(signalCount({ risks: ['Не применимо'], field_status: { risks: 'not_applicable' } }), 0);
assert.equal(getSignalTarget({ slot: 'role', message: 'Which role?' }), 'request-section-primary-role');

const history = renderRequestHistory({
  status_history: [{ status: 'returned', title: 'Уточнение', comment: 'OLD_REVIEW_COMMENT', actor_name: 'Reviewer', created_at: '2026-09-08T10:00:00Z' }],
  revision_history: [
    { revision: 1, draft: { problem_statement: 'OLD_REQUIREMENT' }, created_at: '2026-09-08T09:00:00Z' },
    { revision: 2, draft: { problem_statement: 'NEW_REQUIREMENT' }, created_at: '2026-09-08T11:00:00Z' },
  ],
});
for (const text of ['OLD_REVIEW_COMMENT', 'OLD_REQUIREMENT', 'NEW_REQUIREMENT', 'Редакция 1', 'Редакция 2', 'Изменено:', 'Потребность']) assert.ok(history.includes(text), text);
const legacyHistory = renderRequestHistory({ updated_at: '2026-09-08T10:00:00Z', status_history: [{ title: 'Сохранён прежний комментарий', comment: 'LEGACY_COMMENT', legacy_event: true, created_at: null, observed_at: '2026-09-08T12:00:00Z' }] });
assert.match(legacyHistory, /LEGACY_COMMENT/);
assert.match(legacyHistory, /<time>—<\/time>/);

const chat = readFileSync(new URL('../js/components/agentChat.js', import.meta.url), 'utf8');
assert.match(chat, /const reviewedRevision = currentDraftRevision/);
assert.match(chat, /expected_draft_hash: reviewedRevision/);
const review = readFileSync(new URL('../js/components/reviewPage.js', import.meta.url), 'utf8');
assert.doesNotMatch(review, /\['submitted', 'returned'\]\.includes\(request\.status\)\) return \['claim'\]/);
assert.match(review, /Ожидаем уточнения заказчика/);

console.log('requirementIntegrity tests passed');
