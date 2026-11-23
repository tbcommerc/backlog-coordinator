import assert from 'node:assert/strict';
import test from 'node:test';
import { API } from '../js/api.js';

async function environment(run) {
  const names = ['fetch', 'window', 'localStorage', 'BroadcastChannel', 'navigator'];
  const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { removeItem() { assert.fail('session must survive'); } } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { reload() { assert.fail('unexpected logout'); } } } });
  try { await run(); }
  finally { for (const [name, descriptor] of saved) if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
}

const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});

for (const path of ['/auth/me', '/auth/sessions', '/admin/users', '/admin/roles']) {
  test(`expired access refreshes safe read ${path}`, () => environment(async () => {
    const api = new API(); api.setAccessToken('expired');
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({url, authorization: options.headers.Authorization, credentials: options.credentials});
      if (url.endsWith('/auth/refresh')) return json({access_token: 'fresh'});
      return options.headers.Authorization === 'Bearer fresh' ? json({ok: true}) : json({}, 401);
    };
    assert.deepEqual(await api.get(path, {passive: true}), {ok: true});
    assert.deepEqual(calls.map(call => call.url), ['/api/v1' + path, '/api/v1/auth/refresh', '/api/v1' + path]);
    assert.equal(calls[2].authorization, 'Bearer fresh');
    assert.equal(calls[1].credentials, 'same-origin');
  }));
}

test('parallel dictionary reads send bearer, share refresh and never clear the session', () => environment(async () => {
  const api = new API(); api.setAccessToken('expired'); window.app = {api};
  let refreshes = 0;
  const authorizedPaths = new Set();
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/auth/refresh')) { refreshes++; return json({access_token: 'fresh'}); }
    assert.ok(options.headers.Authorization, `${url} must send a bearer token`);
    if (options.headers.Authorization !== 'Bearer fresh') return json({}, 401);
    authorizedPaths.add(url);
    return json(url.endsWith('/tasks/reference') ? {did_client_groups: [{id: 42, name: 'Reference'}]} : [{id: 42, name: 'Reference'}]);
  };
  const {loadDirectories, clearToolbarDirectories} = await import('../js/components/filterToolbar.js');
  clearToolbarDirectories();
  await loadDirectories();
  assert.equal(refreshes, 1);
  for (const path of ['/admin/statuses', '/admin/priorities', '/admin/teams', '/admin/users', '/tasks/reference']) {
    assert.ok(authorizedPaths.has('/api/v1' + path), path);
  }
  assert.equal(api.accessToken, 'fresh');
  clearToolbarDirectories();
}));

test('a late 401 reuses an already refreshed token', () => environment(async () => {
  const api = new API(); api.setAccessToken('expired');
  let release;
  globalThis.fetch = async (url, options) => {
    if (options.headers.Authorization === 'Bearer expired') return new Promise(resolve => { release = () => resolve(json({}, 401)); });
    return json({ok: true});
  };
  const pending = api.get('/teams/', {passive: true});
  api.refreshToken = () => assert.fail('a second refresh must not rotate the cookie');
  api.setAccessToken('already-fresh');
  release();
  assert.deepEqual(await pending, {ok: true});
}));

test('task creation uses explicit operation rights for a custom administrator role', () => environment(async () => {
  const {hasWritePermission} = await import('../js/components/filterToolbar.js');
  let user = {role_name: 'Администратор стенда', permissions: {task_edit: 'all'}};
  window.app = {store: {get: () => user}};
  assert.equal(hasWritePermission('backlog'), true);
  user = {role_name: 'Администратор', permissions: {task_edit: 'none'}};
  assert.equal(hasWritePermission('backlog'), false);
  user = {team_id: 12, permissions: {task_edit: 'team'}};
  assert.equal(hasWritePermission('team'), true);
  user.team_id = null;
  assert.equal(hasWritePermission('team'), false);
}));
