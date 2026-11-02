import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBacklogTaskPages } from '../js/backlogTaskLoader.js';

test('leaving either backlog aborts an unfinished request', async () => {
  for (const route of ['/backlog', '/team-backlog']) {
    globalThis.window = new EventTarget();
    window.location = { hash: `#${route}` };
    let signal;
    const pending = loadBacklogTaskPages({ api: { get: (_url, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    } } }, '', route);
    window.location.hash = '#/dashboard';
    window.dispatchEvent(new Event('hashchange'));
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(signal.aborted, true);
  }
});

test('loads every page in order with at most two concurrent requests', async () => {
  globalThis.window = new EventTarget();
  window.location = { hash: '#/backlog' };
  let active = 0, peak = 0;
  const result = await loadBacklogTaskPages({ api: { get: async url => {
    const page = Number(new URL(url, 'http://local').searchParams.get('page'));
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, page % 2 ? 2 : 5));
    active--;
    return { pages: 6, total: 6, items: [page] };
  } } }, '', '/backlog');
  assert.deepEqual(result.items, [1, 2, 3, 4, 5, 6]);
  assert.equal(peak, 2);
});
