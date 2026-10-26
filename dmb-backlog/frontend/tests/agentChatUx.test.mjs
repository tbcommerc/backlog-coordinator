import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = read('js/components/agentChat.js');
const css = read('css/pages.css');
const baseCss = read('css/base.css');
const componentsCss = read('css/components.css');
const indexMarkup = read('index.html');
const feedback = read('js/uiFeedback.js');
const modalAccessibility = read('js/modalAccessibility.js');
const historyModeMarkup = source.slice(
  source.indexOf('<div class="chat-sessions-tabs"'),
  source.indexOf('<div class="chat-sessions-tools"'),
);

const importableSource = source
  .replace(/import \{ confirmAction \} from '\.\.\/uiFeedback\.js(?:\?v=\d+)?';/, 'const confirmAction = async () => false;')
  .replace(/import \{ enhanceDialogOverlay \} from '\.\.\/modalAccessibility\.js(?:\?v=\d+)?';/, 'const enhanceDialogOverlay = () => {};')
  .replace("'../ui/actionMenu.js'", JSON.stringify(new URL('../js/ui/actionMenu.js', import.meta.url).href));
const moduleUrl = `data:text/javascript;base64,${Buffer.from(importableSource).toString('base64')}`;
const { classifyRequirementValue, clearAgentChatTransientStorage, composerDraftStorageKey, formatContent, formatProcessingElapsed, getChatActivity, getDraftIssueSummary, getSessionLifecycle, isNearChatBottom, renderSessionEmptyState } = await import(moduleUrl);

assert.equal(classifyRequirementValue('Готовый ответ', {}, true).resolved, true);
assert.deepEqual(
  classifyRequirementValue('Не знаю, нужно уточнить', {}, true),
  { key: 'needs-clarification', label: 'Нужно уточнить', filled: false, resolved: false },
);
assert.equal(classifyRequirementValue('Не применимо', {}, false).resolved, true);
assert.equal(classifyRequirementValue('Не применимо', {}, true).resolved, false);
assert.equal(classifyRequirementValue('Значение', {}, false, true).key, 'blocking');
assert.equal(isNearChatBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 300 }), false);
assert.equal(isNearChatBottom({ scrollHeight: 1000, scrollTop: 620, clientHeight: 300 }), true);
assert.match(renderSessionEmptyState({ filtered: true }), /Сбросить фильтры/);
assert.match(renderSessionEmptyState({ mode: 'archive' }), /К активным/);
assert.match(renderSessionEmptyState(), /Создать требование/);
assert.deepEqual(getDraftIssueSummary({
  open_question_details: [{ blocking: true }, { blocking: false }],
  conflicts: [{}], quality_issues: [{}, {}], assumptions: ['a'],
}), { blocking: 1, openQuestions: 1, conflicts: 1, quality: 2, assumptions: 1, attention: 4 });
assert.equal(
  composerDraftStorageKey({ store: { get: () => ({ id: 42 }) } }, 'session-7'),
  'dmb-agent-composer-draft:v1:user:42:session:session-7',
);
assert.equal(typeof clearAgentChatTransientStorage, 'function');
assert.equal(formatProcessingElapsed(3), 'Ожидаем ответ · 3 с');
assert.equal(formatProcessingElapsed(12), 'Ответ ещё формируется · 12 с');
assert.equal(formatProcessingElapsed(35), 'Это занимает дольше обычного · 35 с');
assert.deepEqual(
  getChatActivity('user', 'Изменён раздел: problem_statement'),
  { kind: 'change', icon: 'pencil', label: 'Обновлено поле «Потребность»' },
);
assert.equal(getChatActivity('user', 'Нужно изменить problem_statement'), null);
assert.equal(getSessionLifecycle({ phase: 'welcome', has_draft: true, needs_user_response: true }), 'draft');
assert.equal(getSessionLifecycle({ phase: 'confirm', needs_user_response: true, last_message_role: 'assistant' }), 'needs-response');
assert.equal(getSessionLifecycle({ phase: 'agentic_dialogue', needs_user_response: false, last_message_role: 'user' }), 'in-progress');
assert.equal(getSessionLifecycle({ phase: 'done', finished: true }), 'complete');
assert.equal(getSessionLifecycle({ phase: 'draft_ready', request_id: 12 }), 'sent');
assert.match(formatContent('**Важно**\n\n- пункт\n- [ссылка](https://example.test)'), /<strong>Важно<\/strong>[\s\S]*?<ul>[\s\S]*?<a href="https:\/\/example\.test"/);
assert.doesNotMatch(formatContent('[опасно](javascript:alert(1))'), /href=/);
assert.match(formatContent('| Поле | Значение |\n| --- | --- |\n| A | B |'), /<table\b[^>]*>[\s\S]*?<th>Поле<\/th>[\s\S]*?<td>B<\/td>/);

assert.match(source, /slots: \['need_statement', 'to_be', 'role', 'process'\]/, 'the UI minimum must match the agent contract');
assert.match(source, /id="chat-generate-draft-btn"/, 'early draft must be a visible action');
assert.match(source, /maxlength="4000"/, 'chat input must have a bounded payload');
assert.match(source, /id="chat-scroll-latest"/, 'long chats must expose an explicit jump to new messages');
assert.match(source, /data-starter-prompt=/, 'first run must offer editable examples without auto-submit');
assert.match(source, /updateSessionHistoryCounts\(modeSessions\)/, 'history filters must expose result counts');
assert.doesNotMatch(source, /История требований\$\{modeSessions\.length/, 'the history total must not duplicate tab counts or wrap the title');
assert.doesNotMatch(historyModeMarkup, /data-lucide=/, 'compact history tabs must not squeeze decorative icons into dots');
assert.match(source, /const sessionTitle = String\(s\.title \|\| ''\)\.trim\(\) \|\| 'Без названия'/, 'untitled history rows must remain understandable');
assert.match(source, /ИИ-ассистент требований/, 'the assistant identity must match the Russian interface language');
assert.match(source, /id="chat-context-disclosure"/, 'assistant mode and sources must be inspectable');
assert.match(source, /Как ассистент ведёт диалог/, 'assistant mode must be explained in plain language');
assert.match(source, /id="agent-chat-messages" role="log" aria-live="off"/, 'restored history must not be announced as a new reply');
assert.match(source, /id="chat-live-announcer" aria-live="polite" aria-atomic="true"/, 'new assistant updates need a dedicated live region');
assert.match(source, /renderChatRestoringState\(\)/, 'session restoration must use a stable loading state instead of flashing the welcome screen');
assert.match(source, /function renderHistory\(history\)[\s\S]*?addMessage\('user', lastUserMessage, \{ announce: false \}\)[\s\S]*?addMessage\('bot', content, \{ error: unavailable, announce: false, context: entry.context \}\)/, 'historical messages must remain silent and retain their own source context');
assert.match(source, /id="chat-interview-progress" role="status"/, 'the interview must expose required-field progress');
assert.match(source, /field_provenance/, 'requirement fields must expose provenance');
assert.match(source, /data-answer-copy/, 'answers must offer a copy action');
assert.match(source, /data-answer-feedback/, 'answers must accept lightweight feedback');
assert.match(source, /syncSentComposerState/, 'submitted sessions must restore a read-only composer');
assert.match(source, /data-request-card=/, 'the created request link must remain idempotent on resume');
assert.match(source, /tabindex="-1" data-session-menu/, 'history overflow actions must not double the primary tab path');
assert.match(source, /id="chat-sessions-tab-active"[\s\S]*?tabindex="0"/, 'history tabs must use roving tabindex');
assert.match(source, /chat-message-event--/, 'machine-like field updates must use compact activity rows');
assert.match(source, /filter === 'action'\) return lifecycle === 'needs-response'/, 'the action filter must use the lifecycle contract rather than a loose phase fallback');
assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="chat-submit-title"/, 'submit confirmation must be an accessible modal dialog');
assert.match(source, /Выбор сохранён — попробуйте ещё раз/, 'submit errors must preserve the selected route and confirmation');
assert.match(source, /Текст остался в форме/, 'draft edit errors must preserve the entered wording');
assert.match(source, /onRequestClose: async \(\) =>/, 'closing a changed draft edit must require confirmation');
assert.match(source, /enhanceDialogOverlay\(modal, returnFocus\)/, 'assistant dialogs must reuse the application focus manager');
assert.doesNotMatch(source, /document\.addEventListener\('keydown', onKeydown\)/, 'assistant dialogs must not install a competing focus trap');
assert.match(modalAccessibility, /node\.matches\(OVERLAY_SELECTOR\)/, 'the shared focus manager must enhance dynamically added dialogs');
assert.match(source, /saveComposerDraft\(app, input\.value\)/, 'composer text must be persisted while the user types');
assert.match(source, /restoreComposerDraft\(app, sessionId, \{ migrateUnassigned: true \}\)/, 'composer draft must survive page reload while the active session resolves');
assert.match(source, /restoreComposerDraft\(app, sessionId\)/, 'each session must restore its own unsent text');
assert.match(source, /sessionStorage\.setItem\(key, JSON\.stringify/, 'message text must use tab-scoped transient storage');
assert.match(source, /TRANSIENT_MESSAGE_TTL_MS/, 'transient message text must expire');
assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem|removeItem)\([^\n]*(?:PENDING_MESSAGE_KEY_PREFIX|composerDraftStorageKey)/, 'message text must not be persisted in localStorage');
assert.match(source, /Нет подключения\. Можно продолжать писать/, 'offline mode must explain that local typing remains safe');
assert.match(source, /skipConfirm: true/, 'archiving the active session must not show two consecutive confirmations');
assert.match(source, /app\.api\.post\('\/agent\/chat', payload, \{ signal: controller\.signal \}\)/, 'chat waiting must be cancellable at the network layer');
assert.match(source, /app\.api\.stream\('\/agent\/chat-stream', payload/, 'assistant replies must use the end-to-end streaming endpoint');
assert.match(source, /event === 'delta'/, 'streaming deltas must update the visible assistant reply');
assert.match(source, /event === 'replace'/, 'a rejected or incomplete streamed rewrite must be replaceable by the safe final text');
assert.match(source, /Остановить ожидание/, 'long processing must provide an honest stop-waiting action');
assert.match(source, /ответ восстановится при следующем открытии диалога/, 'stopping the client wait must explain possible server-side continuation');
assert.match(source, /renderDraftChangeSummary\(lastDraftChange\)/, 'final review must expose the latest draft change');
assert.match(source, />Было<\/[a-z]+>[\s\S]*?>Стало<\/[a-z]+>/, 'draft comparison must distinguish previous and current wording');
assert.match(source, /new ResizeObserver\(sync\)/, 'new-message control must follow the dynamic composer height');
assert.match(source, /errorMessage\?\.querySelector\('\.chat-message-body'\)/, 'retry action must stay next to the error it explains');
assert.match(source, /panel\.toggleAttribute\('inert', !open\)/, 'closed history drawer must leave the focus order');
assert.match(source, /if \(open\) focusWrapper\?\.classList\.remove\('history-collapsed'\)/, 'opening history must clear the obsolete collapsed state');
assert.doesNotMatch(source, /matchMedia\?\.\('\(min-width: 1200px\)'\)\.matches\) setHistoryPanelCollapsed\(true\)/, 'switching a session must not restore the obsolete collapsed rail');
assert.match(css, /history-collapsed\.history-drawer-open \.chat-history-panel \.chat-sessions-popover\s*\{\s*display:\s*flex/, 'an open history drawer must reveal its content even when legacy collapsed state is present');
assert.match(css, /\.chat-container-card\s*\{[^}]*box-shadow:\s*none/, 'the assistant card must explicitly suppress the dark band above its header');
assert.match(css, /\.chat-skip-to-composer\s*\{[^}]*box-shadow:\s*none;[^}]*visibility:\s*hidden/, 'the off-canvas skip link must not leak its shadow above the assistant card');
assert.match(css, /\.chat-skip-to-composer:focus\s*\{[^}]*box-shadow:\s*var\(--shadow-lg\);[^}]*visibility:\s*visible/, 'the skip link must restore its elevation when keyboard focus reveals it');
assert.match(source, /aria-controls="chat-dialog-pane"/, 'mobile tabs must identify the controlled dialog panel');
assert.match(source, /role="tabpanel" aria-labelledby="chat-requirement-tab"/, 'the requirement workspace must be exposed as a tab panel');
assert.match(source, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/, 'mobile tabs must support keyboard navigation');
assert.match(source, /data-chat-view="requirement"\]\'\)\?\.click\(\)[\s\S]*?editRequirementField\(target\)/, 'a blocker must reveal its requirement panel before focusing the field');
assert.match(source, /closeHistoryPopover\(\);\s*closeHistoryDrawer\(\);[\s\S]*?loadSessions\(app\);/, 'choosing a session must close compact history navigation');
assert.match(source, /event\.key !== 'Escape'/, 'inline requirement editing must support Escape cancellation');
assert.doesNotMatch(source, /data-lucide="(?:ellipsis|circle-alert|circle-check)"/, 'assistant must only use icons available in the bundled Lucide build');
assert.match(css, /\.chat-sidebar\.has-requirement-map\s*\{\s*display:\s*none;/, 'requirement pane must stay hidden on the Dialog mobile tab');
assert.match(css, /\.chat-sessions-tabs\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/, 'history modes must use two equal columns');
assert.match(css, /\.chat-sessions-filters\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/, 'history status filters must have a stable two-column rhythm');
assert.match(css, /\.requirement-workspace\.is-final-review \+ \.chat-progress-card\s*\{\s*display:\s*none;/, 'final review must not duplicate requirement readiness');
assert.doesNotMatch(css, /\.requirement-workspace\.is-final-review > \.chat-draft-panel\s*\{[^}]*order:\s*-1/, 'final review must present the document before its blockers');
assert.match(css, /\.requirement-map-card\.is-final-review \.requirement-map-value/, 'final review must show complete field values');
assert.match(css, /\.chat-scroll-latest\s*\{[\s\S]*?position:\s*absolute/, 'new-message control must float above the composer');
assert.match(css, /@media \(max-width:1024px\) and \(max-height:520px\)/, 'short landscape screens need a dedicated compact layout');
assert.match(css, /@media \(hover:hover\) and \(pointer:fine\)[\s\S]*?\.chat-message-bot:focus-within \.chat-answer-actions/, 'desktop answer actions must stay quiet until they are relevant');
assert.match(css, /\.chat-message-streaming \.chat-message-content::after/, 'a live streamed reply must have a restrained visual cursor');
assert.match(css, /\.requirement-map-field-state\s*\{\s*font-size:var\(--type-meta-size\);/, 'requirement field states must stay readable at the compact density');
assert.match(componentsCss, /@media \(max-width: 820px\)[\s\S]*?\.mobile-search-toggle/, 'tablet navigation must collapse search before it crowds the header');
assert.doesNotMatch(indexMarkup, /class="skip-link"[^>]*style=/, 'the global skip link position must not be overridden inline');
assert.match(baseCss, /\.skip-link\s*\{[\s\S]*?transform:\s*translateY\(-120%\)/, 'the skip link must have an off-screen resting state');
assert.match(baseCss, /\.skip-link:focus[\s\S]*?transform:\s*translateY\(0\)/, 'the skip link must become visible on focus');
assert.match(feedback, /const focusOrigin = document\.activeElement/, 'confirmation dialog must restore the invoking control');

console.log('agentChatUx.test.mjs: OK');
