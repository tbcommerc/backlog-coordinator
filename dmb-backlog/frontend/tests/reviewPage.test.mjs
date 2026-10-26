import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../js/components/reviewPage.js', import.meta.url), 'utf8');
const presentation = readFileSync(new URL('../js/components/requestPresentation.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/pages.css', import.meta.url), 'utf8');
const modalCss = readFileSync(new URL('../css/modal-system.css', import.meta.url), 'utf8');

// Queue controls have explicit semantics and summary cards act as filters.
assert.match(source, /quickFilter\('status', 'submitted'/);
assert.match(source, /quickFilter\('mode', 'my_review'/);
assert.match(source, /quickFilter\('mode', 'action'/);
assert.match(source, /quickFilter\('aged', 'true'/);
assert.match(source, /quickFilter\('signals', 'true'/);
assert.match(source, /class="filter-panel customer-request-filter-panel"/);
assert.match(source, /class="customer-request-quick-filters review-request-quick-filters"/);
assert.match(source, /class="review-queue-card request-list-panel animate-fade-in"/);
assert.doesNotMatch(source, /class="card review-queue-card request-list-panel/);
assert.doesNotMatch(source, /class="card-header customer-request-toolbar review-request-toolbar"/);
assert.match(source, /<h1 class="toolbar-title" id="review-list-title">Ревью запросов<\/h1>/);
assert.doesNotMatch(source, /return `<div class="page-header animate-fade-in"><h1>Ревью запросов/);
assert.doesNotMatch(source, /<section class="review-summary"/);
assert.match(source, /id="review-sort"/);
assert.match(source, /id="review-mode-filter"/);
assert.match(source, /id="review-signals-only"/);
assert.match(source, /placeholder="Номер, название, автор или команда"/);
assert.match(source, /`#\$\{request\.id\}`/);
assert.match(source, /<select id="review-status-filter" class="input"/);
assert.match(source, /<select id="review-sort" class="input"/);
assert.match(source, /class="review-table-body review-list-scroll" id="review-list-content" tabindex="0"/);
assert.match(source, /class="customer-request-cards review-request-cards"/);
assert.match(source, /class="customer-request-card review-request-card \$\{priority\}"/);
assert.match(source, /class="review-request-card-link" href="#\/review\/\$\{esc\(request\.id\)\}"/);
assert.match(source, /value="stage_oldest">Дольше на текущем этапе/);
assert.doesNotMatch(source, /По срочности/);
assert.match(source, /value="signals">Больше замечаний/);
assert.match(source, /value="quality">Низкое качество/);
assert.match(source, /value="newest">Недавно обновлённые/);
assert.doesNotMatch(source, /value="active">Требуют внимания/);

// The same signal definition is used by summary, filtering, sorting and rows.
assert.match(source, /signalCount,/);
for (const field of ['open_questions', 'conflicts', 'risks', 'assumptions']) {
  assert.match(presentation, new RegExp(`draft\\.${field}`));
}
assert.doesNotMatch(source, /function attentionCount\(/);

// AI scores are explained and exposed as an accessible meter.
assert.match(source, /role="meter"/);
assert.match(source, /75–100%/);
assert.match(source, /не заменяют решение специалиста/);
assert.match(source, /renderRequirementSections\(draft\)/);
assert.match(source, /renderLegacyRequestDescription\(linkedRevision\?\.description \|\| request\.description/);
assert.match(source, /hasStructuredDraft\(draft\)/);
assert.match(source, /renderRequestJourney\(request\)/);
assert.match(source, /renderRequestSummary\(request\)/);
assert.match(source, /renderRequestHistory\(request\)/);
assert.match(source, /renderRequestParticipants\(request\)/);
assert.match(source, /Оценка подготовки запроса/);
assert.match(css, /\.request-journey\{grid-template-columns:repeat\(4/);
assert.match(presentation, /status === 'rejected'/);
assert.doesNotMatch(source, /const LABELS =/);

// Review dialogs participate in the global modal accessibility mechanism.
assert.match(source, /role="dialog" aria-modal="true" aria-labelledby=/);
assert.match(source, /class="btn btn-ghost btn-lg square-icon ui-btn modal-close" data-close aria-label="Закрыть диалог"/);
assert.match(source, /class="btn btn-secondary btn-sm modal-cancel-btn"/);

// Summary filters and card focus have visible states.
assert.match(source, /button\.classList\.toggle\('active',\s*active\)/);
assert.match(css, /\.review-request-card-link:focus-visible \{ outline:2px solid var\(--accent\)/);
assert.match(css, /\.review-list-scroll\{height:clamp\(280px,52vh,620px\);min-height:0;overflow-x:hidden;overflow-y:auto!important;overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-width:thin/);
assert.match(css, /@media\(min-width:701px\)\{\.main-content:has\(>#review-queue-card:not\(\.is-empty\)\)\{min-height:0;overflow:hidden\}/);
assert.match(css, /\.main-content>#review-queue-card:not\(\.is-empty\)\{display:flex;flex:1 1 auto;flex-direction:column;min-height:0\}/);
assert.match(css, /#review-queue-card:not\(\.is-empty\) \.review-list-scroll\{flex:1 1 auto;height:auto;min-height:0\}/);
assert.match(css, /\.review-list-scroll:focus-visible\{outline:2px solid var\(--accent\)/);
assert.match(css, /\.review-list-scroll::-webkit-scrollbar\{width:10px\}/);
assert.match(css, /\.review-queue-card\.is-empty \.review-list-scroll\{height:auto;overflow:visible!important/);
assert.match(css, /\.review-request-quick-filters\s*\{\s*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
assert.match(css, /\.customer-request-toolbar>\.request-list-title-row\{display:flex!important\}/);
assert.match(css, /\.customer-request-main-filters\{display:flex;align-items:center;gap:8px;flex:1 1 0;min-width:0\}/);
assert.match(source, /Показано \$\{rows\.length\} · загружено \$\{reviewRows\.length\}/);
assert.match(source, /review\?limit=\$\{REVIEW_PAGE_SIZE\}&offset=\$\{offset\}/);
assert.match(source, /id="load-more-review"/);
assert.match(source, /request\.reviewer_name \|\| 'Не взят в работу'/);
assert.match(source, /class="review-card-reason"/);
assert.match(source, /Регуляторные требования/);
assert.match(source, /function stageAgeText\(request\)/);
assert.match(source, /function isOverdue\(request\)/);
assert.match(source, /Принять решение/);
assert.match(source, /class="review-card-open"/);
assert.match(css, /\.review-request-card\.is-new\{border-left:4px solid var\(--info\)/);
assert.match(css, /\.review-request-card\.has-many-signals:not\(\.is-new\)\{border-left:4px solid var\(--warning\)/);
assert.match(css, /\.review-request-card\.is-aged \{/);
assert.match(css, /\.review-signal-taxonomy\{/);
assert.match(css, /\.review-queue-card\.is-empty \.review-request-toolbar\{display:grid!important\}/);
assert.match(css, /\.review-queue-card\.is-empty \.review-request-toolbar \.customer-request-filter-panel,\.review-queue-card\.is-empty \.review-request-quick-filters\{display:none!important\}/);

// Signals navigate to the same shared passport sections used by both roles.
assert.match(source, /data-request-target=/);
assert.match(source, /focusRequestSection/);
assert.match(source, /humanizeSignal\(value\)/);
assert.match(presentation, /request-section-acceptance-criteria/);
assert.match(css, /\.review-signal-link\{/);
assert.match(css, /\.request-passport-section\.is-signal-target/);

// Queue context, retry states and successful actions do not require a full reload.
assert.match(source, /REVIEW_QUEUE_STATE_KEY/);
assert.match(source, /scrollTop/);
assert.match(source, /retry-review-list/);
assert.match(source, /retry-review-detail/);
assert.match(source, /refreshCurrentRoute\(\)/);
assert.doesNotMatch(source, /window\.location\.reload/);

// Review fields expose names, descriptions and pre-submit validation.
assert.match(source, /data-review-required/);
// Assignment now delegates to work resolution after re-reading the version.
// Execute the real handler with an isolated loader; never open a browser or API.
const assignSource = source.match(/async function assignModal\(app, id, renderedVersion\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(assignSource, 'Review must expose the assignment handler');
assert.match(assignSource, /import\('\.\/workResolution\.js(?:\?v=\d+)?'\)/);
const calls = [], messages = [], dialogs = [];
const freshRequest = { id: 42, version: 7 };
let response = freshRequest;
let refreshed = 0;
const app = { api: { get: async path => { calls.push(['get', path]); if (response instanceof Error) throw response; return response; } }, router: { refreshCurrentRoute: async () => { refreshed++; } } };
const assignModal = runInNewContext(`(${assignSource.replace(/import\('\.\/workResolution\.js(?:\?v=\d+)?'\)/, 'loadResolution()')})`, {
  loadResolution: async () => { calls.push(['load']); return { openWorkResolution: async (actualApp, request) => { assert.equal(actualApp, app); assert.equal(request, freshRequest); calls.push(['open']); } }; },
  window: { toast: (...args) => messages.push(args) },
  reviewAssignPending: false,
  document: { querySelector: () => null, getElementById: () => null },
  setBusy: () => {},
  modal: config => dialogs.push(config),
});
await assignModal(app, 42, 7);
assert.deepEqual(calls, [['get', '/agent/requests/42'], ['load'], ['open']]);
assert.deepEqual(messages, []);
calls.length = 0;
await assignModal(app, 42, 6);
assert.deepEqual(calls, [['get', '/agent/requests/42']], 'A stale version must never open resolution');
assert.equal(dialogs.at(-1).title, 'Запрос изменился');
assert.match(dialogs.at(-1).body, /проверьте изменения перед решением/);
assert.equal(dialogs.at(-1).confirm, 'Обновить данные');
await dialogs.at(-1).action();
assert.equal(refreshed, 1);
calls.length = 0;
response = new Error('Unavailable');
await assignModal(app, 42, 7);
assert.deepEqual(calls, [['get', '/agent/requests/42']], 'A failed refresh must never open resolution');
assert.deepEqual(messages.pop(), ['Unavailable', 'error']);
assert.match(source, /Комментарий не сохранён/);
assert.match(source, /REVIEW_DRAFT_KEY_PREFIX/);
assert.match(source, /if \(isSubmitting\) return/);
assert.match(source, /app\.api\.get\('\/agent\/requests\/review\?limit=250'\)/);
assert.match(source, /data-review-required autofocus/);
assert.match(source, /Не рассчитана/);
assert.match(source, /numericScore\(draft\.quality_score\)/);
assert.match(source, /renderLatestRevisionDiff\(request/);
const resolution = readFileSync(new URL('../js/components/workResolution.js', import.meta.url), 'utf8');
assert.match(resolution, /f\('scope','Какую потребность покрывает работа',\{kind:'textarea',required:true\}\)/);
assert.match(resolution, /version:request\.version,decision:value\('decision'\),scope_text:value\('scope'\),coverage:value\('coverage'\)/);
assert.match(resolution, /label:'Подтвердить размещение'/);
assert.match(source, /id="btn-release"/);
assert.match(source, /id="btn-reroute"/);
assert.match(source, /reviewLoadState === 'stale'/);
assert.match(source, /syncQueueUrl/);
assert.match(source, /Рабочая заметка ревьюера/);
assert.match(source, /Рассчитано · дата не сохранена/);
assert.doesNotMatch(source, /draft\.quality_score \?\? draft\.completeness_score/);
assert.match(css, /\.review-modal-discard \{ display:grid; grid-template-columns:minmax\(0,1fr\)/);
assert.match(css, /\.review-modal-discard>\* \{ grid-column:1; width:100%; min-width:0; \}/);
assert.doesNotMatch(modalCss, /:is\(\.meeting-dialog-warning, \.review-modal-consequence, \.review-modal-discard\)/);
assert.match(modalCss, /\.review-modal-discard \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\)/);
assert.match(css, /@media\(max-width:1000px\)[\s\S]*?\.review-detail-aside \{ grid-row:auto; \}/);

// Only mobile review queues drop the inner scroll context.
assert.match(css, /@media\(max-width:700px\)[\s\S]*?\.review-list-scroll\s*\{\s*height:auto;[\s\S]*?overflow:visible!important/);

console.log('reviewPage tests passed');
