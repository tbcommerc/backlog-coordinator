import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const htmlSource = readFileSync(new URL('../js/htmlUtils.js', import.meta.url), 'utf8');
const htmlUrl = `data:text/javascript;base64,${Buffer.from(htmlSource).toString('base64')}`;
const stateSource = readFileSync(new URL('../js/components/viewState.js', import.meta.url), 'utf8')
  .replace("'../htmlUtils.js'", JSON.stringify(htmlUrl));
const stateUrl = `data:text/javascript;base64,${Buffer.from(stateSource).toString('base64')}`;
const { fitTableViewState, renderViewState } = await import(stateUrl);

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

const state = { style: {} };
const scrollContainer = {
  clientWidth: 960,
  querySelector: selector => selector === '.table-view-state-cell .view-state' ? state : null,
};
fitTableViewState({
  querySelector: selector => selector === '.table-container' ? scrollContainer : null,
});
assert.equal(state.style.width, '960px');
