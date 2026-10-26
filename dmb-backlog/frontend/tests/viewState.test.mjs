import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fitTableViewState, renderViewState } from '../js/components/viewState.js';

const error = renderViewState({
  kind: 'error',
  message: '<script>alert(1)</script>',
  actionLabel: 'Повторить',
});
assert.match(error, /role="alert"/);
assert.match(error, /data-view-state-action/);
assert.ok(!error.includes('<script>'));
assert.match(error, /&lt;script&gt;/);

const loading = renderViewState({ kind: 'loading' });
assert.match(loading, /aria-busy="true"/);
assert.match(loading, /content-loading-state/, 'content loading must use the shared typography contract');
assert.doesNotMatch(error, /content-loading-state/, 'error typography must remain independent from loading');

const feedbackCss = readFileSync(new URL('../css/feedback.css', import.meta.url), 'utf8');
assert.match(feedbackCss, /\.content-loading-state\s*\{[^}]*font-size:\s*var\(--text-sm\)/s);
assert.match(feedbackCss, /\.content-loading-state\s*\{[^}]*font-weight:\s*var\(--font-normal,\s*400\)/s);
assert.match(feedbackCss, /\.content-loading-state\s+:is\([^)]*strong[^)]*\)\s*\{[^}]*font:\s*inherit/s,
  'nested headings and strong labels must not reintroduce bold loading text');

const state = { style: {} };
const scrollContainer = {
  clientWidth: 960,
  querySelector: selector => selector === '.table-view-state-cell .view-state' ? state : null,
};
fitTableViewState({
  querySelector: selector => selector === '.table-container' ? scrollContainer : null,
});
assert.equal(state.style.width, '960px');
