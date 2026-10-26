import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routerUrl = new URL('../js/router.js', import.meta.url);
const routerSource = readFileSync(routerUrl, 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/\bexport\s+(?=(?:const|function|class)\b)/g, '');
const executableRouter = `${routerSource}\nexport { Router, createTaskOpenHandler, normalizeTaskDetailTab, parsePositiveTaskId };`;
const {
  Router,
  createTaskOpenHandler,
  normalizeTaskDetailTab,
  parsePositiveTaskId,
} = await import(`data:text/javascript;base64,${Buffer.from(executableRouter).toString('base64')}`);

function makeRouter() {
  return Object.assign(Object.create(Router.prototype), {
    defaultRoute: '/dashboard',
    lastHash: null,
    lastDeepLinkedTask: null,
    taskOpenTimer: null,
  });
}

test('requirement review subject tab is preserved independently of task modal tabs', async () => {
  await withBrowser('#/review?tab=requirements&requirement_review=45', async ({ calls, events }) => {
    const router = makeRouter();
    router.openDeepLinkedTask('/review', 'tab=requirements&requirement_review=45');
    assert.equal(router.clearTaskRoute(), false);
    assert.equal(window.location.hash, '#/review?tab=requirements&requirement_review=45');
    assert.equal(calls.replace.length, 0);
    assert.equal(events.length, 0);
  });
});

async function withBrowser(hash, callback) {
  const previous = {
    window: globalThis.window,
    history: globalThis.history,
    document: globalThis.document,
    CustomEvent: globalThis.CustomEvent,
  };
  const events = [];
  const calls = { push: [], replace: [], back: 0 };
  globalThis.window = { location: { hash } };
  globalThis.history = {
    state: null,
    pushState(state, _title, url) {
      this.state = state;
      globalThis.window.location.hash = url;
      calls.push.push({ state, url });
    },
    replaceState(state, _title, url) {
      this.state = state;
      globalThis.window.location.hash = url;
      calls.replace.push({ state, url });
    },
    back() { calls.back += 1; },
  };
  globalThis.document = {
    dispatchEvent(event) { events.push(event); return true; },
    getElementById() { return null; },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  };

  try {
    return await callback({ calls, events });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('task route keeps an existing explicit tab when modal code omits the tab', async () => {
  await withBrowser('#/backlog?task=42&tab=rep&comment=77', ({ calls }) => {
    const router = makeRouter();
    router.pushTaskRoute(42);
    assert.equal(window.location.hash, '#/backlog?task=42&tab=rep&comment=77');
    assert.equal(calls.push.length, 0);
    assert.equal(calls.replace.length, 0);

    router.pushTaskRoute(42, 'com');
    assert.equal(window.location.hash, '#/backlog?task=42&tab=com&comment=77');
    assert.equal(calls.replace.length, 1);

    router.clearTaskRoute({ replace: true });
    assert.equal(window.location.hash, '#/backlog');
    assert.equal(calls.replace.length, 2);
  });
});

test('new task route writes the requested tab and retains unrelated query state', async () => {
  await withBrowser('#/backlog?owner=me', ({ calls }) => {
    const router = makeRouter();
    router.pushTaskRoute(42, 'rep');
    assert.equal(window.location.hash, '#/backlog?owner=me&task=42&tab=rep');
    assert.equal(calls.push.length, 1);
    assert.equal(calls.push[0].state.dmbTaskModal, true);
  });
});

test('task notification opens over notifications and close returns to the notification route', async () => {
  await withBrowser('#/notifications?view=unread', ({ calls }) => {
    const router = makeRouter();
    router.pushTaskRoute(42, 'com', 7);

    assert.equal(window.location.hash, '#/notifications?view=unread&task=42&tab=com&comment=7');
    assert.equal(calls.push.length, 1);
    assert.equal(calls.push[0].state.dmbTaskModal, true);

    assert.equal(router.clearTaskRoute(), true);
    assert.equal(calls.back, 1);
  });
});

test('malformed task links and orphan tabs are removed locally', async () => {
  await withBrowser('#/backlog?task=abc&tab=rep&owner=me', ({ calls, events }) => {
    const router = makeRouter();
    router.openDeepLinkedTask('/backlog', 'task=abc&tab=rep&owner=me');
    assert.equal(window.location.hash, '#/backlog?owner=me');

    window.location.hash = '#/backlog?tab=com&owner=me';
    router.openDeepLinkedTask('/backlog', 'tab=com&owner=me');
    assert.equal(window.location.hash, '#/backlog?owner=me');
    assert.equal(calls.replace.length, 2);
    assert.equal(events.length, 0);
  });
});

test('invalid tab falls back to main and rapid deep-link changes dispatch only the latest tab', async () => {
  await withBrowser('#/backlog?task=42&tab=unknown', async ({ events }) => {
    const router = makeRouter();
    router.openDeepLinkedTask('/backlog', 'task=42&tab=unknown');
    assert.equal(window.location.hash, '#/backlog?task=42');

    window.location.hash = '#/backlog?task=42&tab=rep';
    router.openDeepLinkedTask('/backlog', 'task=42&tab=rep');
    await new Promise(resolve => setTimeout(resolve, 130));

    assert.deepEqual(events.map(event => ({ type: event.type, detail: event.detail })), [
      { type: 'open-task', detail: { taskId: 42, tab: 'rep' } },
    ]);
  });
});

test('legacy files tab is canonicalized to sys before opening the task', async () => {
  await withBrowser('#/backlog?task=42&tab=files&comment=77', async ({ events }) => {
    const router = makeRouter();
    router.openDeepLinkedTask('/backlog', 'task=42&tab=files&comment=77');
    assert.equal(window.location.hash, '#/backlog?task=42&tab=sys');
    await new Promise(resolve => setTimeout(resolve, 130));

    assert.deepEqual(events.map(event => ({ type: event.type, detail: event.detail })), [
      { type: 'open-task', detail: { taskId: 42, tab: 'sys' } },
    ]);
  });
});

test('comment target opens comments implicitly and is cleared after leaving the tab', async () => {
  await withBrowser('#/backlog?task=42&comment=77', async ({ events }) => {
    const router = makeRouter();
    assert.equal(router.currentTaskRoute().tab, 'com');
    assert.equal(router.currentTaskRoute().commentId, 77);

    router.openDeepLinkedTask('/backlog', 'task=42&comment=77');
    await new Promise(resolve => setTimeout(resolve, 130));
    assert.deepEqual(events.map(event => event.detail), [{ taskId: 42, tab: 'com' }]);

    router.updateTaskTabRoute('main');
    assert.equal(window.location.hash, '#/backlog?task=42');
  });
});

test('a tab deep-link arriving after debounce still reaches the coalescing open handler', async () => {
  await withBrowser('#/backlog?task=42', async ({ events }) => {
    const router = makeRouter();
    router.openDeepLinkedTask('/backlog', 'task=42');
    await new Promise(resolve => setTimeout(resolve, 130));

    window.location.hash = '#/backlog?task=42&tab=rep';
    router.openDeepLinkedTask('/backlog', 'task=42&tab=rep');

    assert.deepEqual(events.map(event => ({ type: event.type, detail: event.detail })), [
      { type: 'open-task', detail: { taskId: 42, tab: 'main' } },
      { type: 'open-task', detail: { taskId: 42, tab: 'rep' } },
    ]);
  });
});

test('open-task coalesces repeated requests and preserves the latest requested tab', async () => {
  const response = deferred();
  const apiCalls = [];
  const routeCalls = [];
  const opened = [];
  const app = {
    api: { get(path) { apiCalls.push(path); return response.promise; } },
    router: {
      currentTaskRoute: () => ({ taskId: null }),
      pushTaskRoute: (taskId, tab) => routeCalls.push({ taskId, tab }),
    },
  };
  const handler = createTaskOpenHandler(app, {
    getTaskOverlay: () => null,
    loadTaskModal: async () => ({ openTaskModal: task => { opened.push(task.id); return task; } }),
  });

  const first = handler({ detail: { taskId: 42, tab: 'main' } });
  const second = handler({ detail: { taskId: 42, tab: 'rep' } });
  response.resolve({ id: 42, title: 'Task' });
  await Promise.all([first, second]);

  assert.deepEqual(apiCalls, ['/tasks/42']);
  assert.deepEqual(routeCalls, [{ taskId: 42, tab: 'rep' }]);
  assert.deepEqual(opened, [42]);
});

test('a newer task request supersedes a slower one and cannot create a second overlay', async () => {
  const responses = new Map([[41, deferred()], [42, deferred()]]);
  const opened = [];
  const app = {
    api: { get: path => responses.get(Number(path.split('/').at(-1))).promise },
    router: {
      currentTaskRoute: () => ({ taskId: null }),
      pushTaskRoute() {},
    },
  };
  const handler = createTaskOpenHandler(app, {
    getTaskOverlay: () => null,
    loadTaskModal: async () => ({ openTaskModal: task => { opened.push(task.id); return task; } }),
  });

  const older = handler({ detail: { taskId: 41, tab: 'main' } });
  const newer = handler({ detail: { taskId: 42, tab: 'rep' } });
  responses.get(41).resolve({ id: 41 });
  responses.get(42).resolve({ id: 42 });
  await Promise.all([older, newer]);
  assert.deepEqual(opened, [42]);
});

test('an already open task switches tabs without another request or overlay', async () => {
  const overlay = { id: 'task-detail-overlay' };
  const routeCalls = [];
  const tabEvents = [];
  const app = {
    api: { get() { throw new Error('must not fetch'); } },
    router: {
      currentTaskRoute: () => ({ taskId: 42 }),
      pushTaskRoute: (taskId, tab) => routeCalls.push({ taskId, tab }),
    },
  };
  const handler = createTaskOpenHandler(app, {
    getTaskOverlay: () => overlay,
    dispatchTaskTabChange: (taskId, tab) => tabEvents.push({ taskId, tab }),
  });

  assert.equal(await handler({ detail: { taskId: 42, tab: 'rep' } }), overlay);
  assert.deepEqual(routeCalls, [{ taskId: 42, tab: 'rep' }]);
  assert.deepEqual(tabEvents, [{ taskId: 42, tab: 'rep' }]);
});

test('confirmed unavailable task clears only its own route while transient errors retain it', async () => {
  const cleared = [];
  const errors = [];
  const app = {
    api: { get: async () => { throw Object.assign(new Error('not found'), { status: 404 }); } },
    router: {
      currentTaskRoute: () => ({ taskId: null }),
      clearTaskRoute: options => cleared.push(options),
    },
  };
  const handler = createTaskOpenHandler(app, {
    getTaskOverlay: () => null,
    onError: error => errors.push(error.status),
  });
  await handler({ detail: { taskId: 42, tab: 'rep' } });
  assert.deepEqual(cleared, [{ replace: true, expectedTaskId: 42 }]);
  assert.deepEqual(errors, [404]);

  app.api.get = async () => { throw Object.assign(new Error('server error'), { status: 500 }); };
  await handler({ detail: { taskId: 42, tab: 'rep' } });
  assert.equal(cleared.length, 1);
  assert.deepEqual(errors, [404, 500]);
});

test('task identifiers and tabs use a strict local allowlist', () => {
  assert.equal(parsePositiveTaskId('42'), 42);
  assert.equal(parsePositiveTaskId('1e2'), null);
  assert.equal(parsePositiveTaskId('0'), null);
  assert.equal(normalizeTaskDetailTab('rep'), 'rep');
  assert.equal(normalizeTaskDetailTab('files'), 'sys');
  assert.equal(normalizeTaskDetailTab('unknown'), 'main');
});
