import assert from 'node:assert/strict';

import { NotificationStore } from '../js/notificationStore.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

const requests = [];
const metrics = [];
const app = {
  api: {
    get(path) {
      assert.equal(path, '/notifications/snapshot');
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
    post(path, body) {
      metrics.push({ path, body });
      return Promise.resolve();
    },
  },
};
const store = new NotificationStore(app);
const revisions = [];
store.subscribe(({ snapshot }) => { if (snapshot) revisions.push(snapshot.revision); });

const first = store.refresh({ source: 'bell' });
const coalesced = store.refresh({ source: 'dashboard' });
assert.equal(requests.length, 1, 'simultaneous surface refreshes must share one request');
requests[0].resolve({ revision: 5, summary: { unread: 2 }, recent_items: [], action_items: [] });
await Promise.all([first, coalesced]);
assert.equal(store.snapshot.revision, 5);

const stale = store.refresh({ source: 'center' });
requests[1].resolve({ revision: 4, summary: { unread: 99 }, recent_items: [], action_items: [] });
await stale;
assert.equal(store.snapshot.revision, 5, 'an older response must not overwrite a newer snapshot');
assert.equal(store.snapshot.summary.unread, 2);

const live = store.refresh({ source: 'bell' });
const queued = store.invalidate();
assert.equal(requests.length, 3, 'invalidation during a request must not create an immediate duplicate');
requests[2].resolve({ revision: 6, summary: { unread: 1 }, recent_items: [], action_items: [] });
await Promise.all([live, queued]);
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(requests.length, 4, 'invalidation must trigger one follow-up reconciliation');
requests[3].resolve({ revision: 7, summary: { unread: 0 }, recent_items: [], action_items: [] });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(store.snapshot.revision, 7);
assert.deepEqual(revisions, [5, 5, 6, 7]);
assert.equal(metrics.length, 0);

console.log('notificationStore.test.mjs: OK');
