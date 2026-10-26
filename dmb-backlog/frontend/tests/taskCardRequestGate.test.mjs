import assert from 'node:assert/strict';
import test from 'node:test';

import { createTaskCardRequestGate, TaskCardRequestGate } from '../js/taskCardRequestGate.js';

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

test('start returns an opaque token and a usable AbortSignal', () => {
  const gate = createTaskCardRequestGate();
  const request = gate.start('reload', 42);

  assert.equal(Object.getPrototypeOf(request.token), null);
  assert.equal(Object.isFrozen(request.token), true);
  assert.equal(request.signal instanceof AbortSignal, true);
  assert.equal(request.signal.aborted, false);
  assert.equal(gate.isCurrent(request.token, 42), true);
  assert.equal(gate.isCurrent(request.token, '42'), true);
});

test('latest request wins within its kind and aborts the previous one', () => {
  const gate = createTaskCardRequestGate();
  const first = gate.start('ai-priority', 42);
  const latest = gate.start('ai-priority', 43);

  assert.equal(first.signal.aborted, true);
  assert.equal(gate.isCurrent(first.token, 42), false);
  assert.equal(latest.signal.aborted, false);
  assert.equal(gate.isCurrent(latest.token, 43), true);
  assert.equal(gate.isCurrent(latest.token, 42), false);
});

test('different request kinds remain independent', () => {
  const gate = createTaskCardRequestGate();
  const reload = gate.start('reload', 42);
  const ai = gate.start('ai-financial-effect', 42);

  assert.equal(reload.signal.aborted, false);
  assert.equal(ai.signal.aborted, false);
  assert.equal(gate.isCurrent(reload.token, 42), true);
  assert.equal(gate.isCurrent(ai.token, 42), true);
});

test('finishing a current token retires it without aborting the completed signal', () => {
  const gate = createTaskCardRequestGate();
  const request = gate.start('reload', 42);

  assert.equal(gate.finish(request.token), true);
  assert.equal(request.signal.aborted, false);
  assert.equal(gate.isCurrent(request.token, 42), false);
  assert.equal(gate.finish(request.token), false);
});

test('finishing a stale token cannot retire the latest request', () => {
  const gate = createTaskCardRequestGate();
  const stale = gate.start('reload', 42);
  const current = gate.start('reload', 42);

  assert.equal(gate.finish(stale.token), false);
  assert.equal(gate.isCurrent(current.token, 42), true);
  assert.equal(gate.finish(current.token), true);
});

test('a late resolve is ignored after a newer request starts', async () => {
  const gate = createTaskCardRequestGate();
  const late = deferred();
  const stale = gate.start('ai-priority', 42);
  const accepted = late.promise.then(value => (
    gate.isCurrent(stale.token, 42) ? value : 'ignored'
  ));

  const current = gate.start('ai-priority', 42);
  late.resolve('stale AI result');

  assert.equal(await accepted, 'ignored');
  assert.equal(stale.signal.aborted, true);
  assert.equal(gate.isCurrent(current.token, 42), true);
});

test('cancelAll invalidates every kind when the card closes', () => {
  const gate = createTaskCardRequestGate();
  const reload = gate.start('reload', 42);
  const ai = gate.start('ai-priority', 42);

  assert.equal(gate.cancelAll(), 2);
  assert.equal(reload.signal.aborted, true);
  assert.equal(ai.signal.aborted, true);
  assert.equal(gate.isCurrent(reload.token, 42), false);
  assert.equal(gate.isCurrent(ai.token, 42), false);
  assert.equal(gate.cancelAll(), 0);
});

test('close and reopen cannot make an old token current again', () => {
  const gate = createTaskCardRequestGate();
  const beforeClose = gate.start('reload', 42);
  gate.cancelAll();
  const afterReopen = gate.start('reload', 42);

  assert.notEqual(afterReopen.token, beforeClose.token);
  assert.equal(gate.isCurrent(beforeClose.token, 42), false);
  assert.equal(gate.isCurrent(afterReopen.token, 42), true);
  assert.equal(afterReopen.signal.aborted, false);
});

test('late resolve after close stays ignored even after reopening the same task', async () => {
  const gate = createTaskCardRequestGate();
  const late = deferred();
  const oldRequest = gate.start('ai-financial-effect', 42);
  const accepted = late.promise.then(value => (
    gate.isCurrent(oldRequest.token, 42) ? value : 'ignored'
  ));

  gate.cancelAll();
  const reopened = gate.start('ai-financial-effect', 42);
  late.resolve('result from the closed card');

  assert.equal(await accepted, 'ignored');
  assert.equal(gate.isCurrent(reopened.token, 42), true);
});

test('tokens are gate-local and invalid inputs fail closed', () => {
  const firstGate = new TaskCardRequestGate();
  const secondGate = createTaskCardRequestGate();
  const request = firstGate.start('reload', 42);

  assert.equal(secondGate.isCurrent(request.token, 42), false);
  assert.equal(firstGate.isCurrent({}, 42), false);
  assert.equal(firstGate.isCurrent(request.token, null), false);
  assert.throws(() => firstGate.start('', 42), /kind/i);
  assert.throws(() => firstGate.start('reload', 0), /Task ID/);
  assert.throws(() => firstGate.start('reload', '1e2'), /Task ID/);
});
