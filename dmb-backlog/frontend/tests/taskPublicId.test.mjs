import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTaskPublicId } from '../js/taskPublicId.js';

test('formats numeric task IDs with two three-digit groups', () => {
  assert.equal(formatTaskPublicId(1), 'TASK-000-001');
  assert.equal(formatTaskPublicId(123456), 'TASK-123-456');
});

test('prefers a valid ID stored by the API', () => {
  assert.equal(formatTaskPublicId({ id: 1, public_id: 'TASK-543-876' }), 'TASK-543-876');
});
