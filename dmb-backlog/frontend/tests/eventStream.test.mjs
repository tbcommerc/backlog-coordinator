import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseEventBlock } from '../js/eventStream.js';


test('SSE parser keeps cursor, type and JSON payload', () => {
  const event = parseEventBlock([
    'id: 123-4',
    'event: task.updated',
    'data: {"type":"task.updated","aggregate":{"id":7,"version":3}}',
  ].join('\n'));
  assert.equal(event.id, '123-4');
  assert.equal(event.event, 'task.updated');
  assert.equal(event.data.aggregate.id, 7);
  assert.equal(event.data.aggregate.version, 3);
});


test('SSE parser ignores keepalive and invalid JSON', () => {
  assert.equal(parseEventBlock(': keepalive'), null);
  assert.equal(parseEventBlock('event: task.updated\ndata: nope'), null);
});
