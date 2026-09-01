import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/components/reviewPage.js', import.meta.url), 'utf8');
const presentation = readFileSync(new URL('../js/components/requestPresentation.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../css/pages.css', import.meta.url), 'utf8');

// Queue controls have explicit semantics and summary cards act as filters.
assert.match(source, /data-review-filter="submitted"/);
assert.match(source, /data-review-filter="in_review"/);
assert.match(source, /data-review-filter="signals"/);
assert.match(source, /class="filter-panel customer-request-filter-panel"/);
assert.match(source, /class="customer-request-quick-filters review-request-quick-filters"/);
assert.match(source, /class="review-queue-card request-list-panel animate-fade-in"/);
assert.doesNotMatch(source, /class="card review-queue-card request-list-panel/);
assert.doesNotMatch(source, /class="card-header customer-request-toolbar review-request-toolbar"/);
assert.match(source, /<h1 class="toolbar-title" id="review-list-title">Ревью запросов<\/h1>/);
assert.doesNotMatch(source, /return `<div class="page-header animate-fade-in"><h1>Ревью запросов/);
assert.doesNotMatch(source, /<section class="review-summary"/);
assert.match(source, /id="review-sort"/);
assert.match(source, /<select id="review-status-filter" class="input"/);
assert.match(source, /<select id="review-sort" class="input"/);
assert.match(source, /class="review-table-body review-list-scroll" id="review-list-content" tabindex="0"/);
assert.match(source, /class="customer-request-cards review-request-cards"/);
assert.match(source, /class="customer-request-card review-request-card \$\{priority\}"/);
assert.match(source, /href="#\/review\/\$\{esc\(request\.id\)\}"/);
assert.match(source, /value="oldest">Старые сначала/);
assert.match(source, /value="signals">Больше сигналов/);
assert.match(source, /value="quality">Низкое качество/);
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
assert.match(source, /renderRequirementSections\(d\)/);
assert.match(source, /renderRequestJourney\(req\)/);
assert.match(source, /renderRequestSummary\(req\)/);
assert.match(source, /renderRequestHistory\(req\)/);
assert.match(source, /renderRequestParticipants\(req\)/);
assert.match(source, /Оценка подготовки запроса/);
assert.match(css, /\.request-journey\{grid-template-columns:repeat\(4/);
assert.match(presentation, /status === 'rejected'/);
assert.doesNotMatch(source, /const LABELS =/);

// Review dialogs participate in the global modal accessibility mechanism.
assert.match(source, /role="dialog" aria-modal="true" aria-labelledby=/);
assert.match(source, /class="modal-close" data-close aria-label="Закрыть диалог"/);
assert.match(source, /class="btn btn-secondary btn-sm modal-cancel-btn"/);

// Summary filters and card focus have visible states.
assert.match(source, /button\.classList\.toggle\('active',active\)/);
assert.match(css, /\.customer-request-card\[href\]:focus-visible\{outline:2px solid var\(--accent\)/);
assert.match(css, /\.review-list-scroll\{height:clamp\(280px,52vh,620px\);min-height:0;overflow-x:hidden;overflow-y:auto!important;overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-width:thin/);
assert.match(css, /\.review-list-scroll:focus-visible\{outline:2px solid var\(--accent\)/);
assert.match(css, /\.review-list-scroll::-webkit-scrollbar\{width:10px\}/);
assert.match(css, /\.review-queue-card\.is-empty \.review-list-scroll\{height:auto;overflow:visible!important/);
assert.match(css, /\.review-request-quick-filters\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(css, /\.customer-request-toolbar>\.request-list-title-row\{display:flex!important\}/);
assert.match(css, /\.customer-request-main-filters\{display:flex;align-items:center;gap:8px;flex:1 1 0;min-width:0\}/);
assert.match(source, /Показано \$\{rows\.length\} из \$\{reviewRows\.length\}/);
assert.match(source, /class="review-request-card-indicators"/);
assert.match(source, /request\.reviewer_name\|\|'Не взят в работу'/);
assert.match(source, /class="review-signal-taxonomy"/);
assert.match(source, /Регуляторные требования/);
assert.match(source, /function requestAge\(iso\)/);
assert.match(source, /function isOverdue\(request\)/);
assert.match(source, /Принять решение/);
assert.match(source, /Открыть запрос <i data-lucide="arrow-right"/);
assert.match(css, /\.review-request-card\.is-new\{border-left:4px solid var\(--info\)/);
assert.match(css, /\.review-request-card\.has-many-signals:not\(\.is-new\)\{border-left:4px solid var\(--warning\)/);
assert.match(css, /\.review-request-card\.is-overdue\{/);
assert.match(css, /\.review-signal-taxonomy\{/);
assert.match(css, /\.review-queue-card\.is-empty \.review-request-toolbar\{display:grid!important\}/);
assert.match(css, /\.review-queue-card\.is-empty \.review-request-toolbar \.customer-request-filter-panel,\.review-queue-card\.is-empty \.review-request-quick-filters\{display:none!important\}/);

// Signals navigate to the same shared passport sections used by both roles.
assert.match(source, /data-request-target=/);
assert.match(source, /focusRequestSection/);
assert.match(source, /humanizeSignal\(x\)/);
assert.match(presentation, /request-section-acceptance-criteria/);
assert.match(css, /\.review-signal-link\{/);
assert.match(css, /\.request-passport-section\.is-signal-target/);

console.log('reviewPage tests passed');
