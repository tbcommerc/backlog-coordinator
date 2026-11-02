import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../js/components/expressEstimate.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '');
const { renderExpressEstimate, initExpressEstimate } = await import(`data:text/javascript;base64,${Buffer.from(
  `const renderViewState = ({title,message}) => title + message;\n${source}`
).toString('base64')}`);
test('no-team profile gets guidance without requests or unavailable actions', async () => {
  let requests = 0;
  const app = { store: { get: () => ({team_id:null}) }, api: { get: () => { requests++; } } };
  assert.match(renderExpressEstimate(app), /Команда не назначена/);
  assert.doesNotMatch(renderExpressEstimate(app), /express-export-btn|express-complete-btn/);
  await initExpressEstimate(app);
  assert.equal(requests, 0);
});
