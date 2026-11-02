import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/components/agentChat.js', import.meta.url), 'utf8')
  .replace(/import \{ confirmAction \} from '\.\.\/uiFeedback\.js(?:\?v=\d+)?';/, 'const confirmAction = async () => false;')
  .replace(/import \{ enhanceDialogOverlay \} from '\.\.\/modalAccessibility\.js(?:\?v=\d+)?';/, 'const enhanceDialogOverlay = () => {};')
  .replace("'../ui/detailComponents.js'", JSON.stringify(new URL('../js/ui/detailComponents.js', import.meta.url).href))
  .replace("'../ui/controls.js'", JSON.stringify(new URL('../js/ui/controls.js', import.meta.url).href))
  .replace("'../ui/actionMenu.js'", JSON.stringify(new URL('../js/ui/actionMenu.js', import.meta.url).href));
// Keep the real operations; replace rendering only for the persistence tests.
const testHooks = `
export function setWorkflowState(state) {
  currentDraft = state.draft || null; sentRequestId = state.requestId || null;
  isTyping = Boolean(state.typing); sessionId = 'test-session'; lastDraftChange = null;
}
export function isolateEditRendering(events) {
  showTyping = () => {}; hideTyping = () => {};
  addMessage = (role, text) => events.push({ role, text });
  renderAgentResponse = response => events.push({ response });
}
export { saveDraftSection, syncSentComposerState };
`;
const workflow = await import(`data:text/javascript;base64,${Buffer.from(source + testHooks).toString('base64')}`);

assert.deepEqual(workflow.getDraftBlockingIssues({
  open_question_details: [{ text: 'Уточните ценность', blocking: true }],
  review_findings: [{ severity: 'warning', field: 'business_value', message: 'Можно уточнить позже' }],
}), [], 'a legacy optional flag must not override server review');
assert.deepEqual(workflow.getDraftBlockingIssues({ review_findings: [
  { severity: 'error', field: 'primary_role', message: 'Уточните пользователя' },
  { severity: 'error', field: 'business_rules', message: 'Устраните противоречие' },
] }), [
  { text: 'Уточните пользователя', slot: 'role', blocking: true },
  { text: 'Устраните противоречие', slot: 'business_rules', blocking: true },
]);
assert.equal(workflow.getSessionLifecycle({ request_status: 'returned', has_draft: true, phase: 'sent_for_review' }), 'needs-response');
assert.equal(workflow.getSessionStatus({ request_status: 'in_progress', phase: 'sent_for_review' }).label, 'В проработке');
assert.equal(workflow.getSessionStatus({ request_status: 'rejected', phase: 'sent_for_review' }).label, 'Отклонён');
assert.equal(workflow.formatAgentError({ status: 409, message: 'Черновик не отправлен: уточните пользователя.' }), 'Черновик не отправлен: уточните пользователя.');
assert.equal(workflow.classifyRequirementValue('Не знаю.', {}, true, true).filled, false);
assert.equal(workflow.classifyRequirementValue('Не применимо', {}, true, true).filled, false);

const input = { value: 'Следующий ответ', toggleAttribute() {} };
const sendButton = {};
globalThis.document = {
  getElementById: id => ({ 'agent-chat-input': input, 'agent-chat-send-btn': sendButton }[id] || null),
  querySelector: () => null,
};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
workflow.setWorkflowState({ typing: true });
workflow.syncSentComposerState();
assert.equal(input.readOnly, false, 'users can prepare another answer while waiting');
assert.equal(sendButton.disabled, true, 'typing must not allow a parallel submission');
workflow.setWorkflowState({ typing: false });
workflow.syncSentComposerState();
assert.equal(input.value, 'Следующий ответ');
assert.equal(sendButton.disabled, false);
workflow.setWorkflowState({ requestId: 12 });
workflow.syncSentComposerState();
assert.equal(input.readOnly, true);
assert.equal(sendButton.disabled, true);

const events = [];
workflow.isolateEditRendering(events);
globalThis.CSS = { escape: value => value };
globalThis.window = { app: { api: { post: async () => ({ action: 'error', message: 'Некорректный раздел' }) } } };
workflow.setWorkflowState({ draft: { priority: 'Средний' } });
const rejected = await workflow.saveDraftSection('priority', 'Высокий', 'Приоритет', { inlineError: true });
assert.deepEqual(rejected, { ok: false, error: 'Некорректный раздел' });
assert.deepEqual(events, [], 'a rejected edit must not add a successful change or replace the editor');

window.app.api.post = async () => ({ action: 'draft_ready', draft: { priority: 'Высокий' } });
const accepted = await workflow.saveDraftSection('priority', 'Высокий', 'Приоритет');
assert.deepEqual(accepted, { ok: true });
assert.equal(events[0].role, 'user');
assert.equal(events[1].response.draft.priority, 'Высокий');
console.log('agentChatWorkflow.test.mjs: OK');
