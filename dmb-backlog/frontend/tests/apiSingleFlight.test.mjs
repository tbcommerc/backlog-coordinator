import assert from 'node:assert/strict';
import test from 'node:test';

import { API, parseServerSentEvent } from '../js/api.js';


test('parallel refresh requests share one in-flight HTTP call', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let releaseResponse;
  const responseGate = new Promise(resolve => { releaseResponse = resolve; });

  globalThis.fetch = async () => {
    fetchCalls += 1;
    await responseGate;
    return {
      ok: true,
      async json() {
        return { access_token: 'rotated-token' };
      },
    };
  };

  try {
    const api = new API();
    const first = api.refreshToken();
    const second = api.refreshToken();
    const third = api.refreshToken();
    assert.equal(fetchCalls, 1);

    releaseResponse();
    const results = await Promise.all([first, second, third]);
    assert.equal(fetchCalls, 1);
    assert.deepEqual(results.map(item => item.access_token), [
      'rotated-token',
      'rotated-token',
      'rotated-token',
    ]);
    assert.equal(api.accessToken, 'rotated-token');

    await api.refreshToken();
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('structured conflict exposes a readable message and code', async () => {
  const api = new API();
  const response = {
    ok: false,
    status: 409,
    async text() {
      return JSON.stringify({
        detail: {
          code: 'task_version_conflict',
          message: 'Задача уже изменена другим пользователем',
          current_version: 8,
        },
      });
    },
  };

  await assert.rejects(
    () => api.handleResponse(response),
    error => {
      assert.equal(error.message, 'Задача уже изменена другим пользователем');
      assert.equal(error.code, 'task_version_conflict');
      assert.equal(error.data.current_version, 8);
      return true;
    },
  );
});


test('SSE parser keeps event names and JSON payloads', () => {
  assert.deepEqual(
    parseServerSentEvent('event: delta\ndata: {"text":"Ответ"}'),
    { event: 'delta', data: { text: 'Ответ' } },
  );
  assert.equal(parseServerSentEvent('event: delta\ndata: not-json'), null);
});


test('authenticated stream handles fragmented events and returns final result', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  const chunks = [
    'event: ready\ndata: {"stream":true}\n\nevent: del',
    'ta\ndata: {"text":"Первый "}\n\nevent: delta\ndata: {"text":"ответ"}\n\n',
    'event: result\ndata: {"message":"Первый ответ","session_id":"s1"}\n\n',
  ];
  const seen = [];
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream' },
    body: new ReadableStream({
      start(controller) {
        chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }),
  });

  try {
    const api = new API();
    const result = await api.stream('/agent/chat-stream', { message: 'Тест' }, {
      onEvent: message => seen.push(message),
    });
    assert.equal(seen.filter(item => item.event === 'delta').length, 2);
    assert.deepEqual(result, { message: 'Первый ответ', session_id: 's1' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
