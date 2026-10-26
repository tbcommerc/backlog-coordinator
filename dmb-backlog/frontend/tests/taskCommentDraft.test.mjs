import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTaskCommentDraftSession,
  parseCommentTarget,
  TaskCommentDraftSession,
} from '../js/taskCommentDraft.js';

test('begin creates an empty current draft and validates task IDs', () => {
  const session = createTaskCommentDraftSession();
  assert.equal(session.current(), null);
  assert.deepEqual(session.begin('42'), {
    taskId: 42,
    text: '',
    mentionedUserIds: [],
    reply: null,
  });
  assert.equal(session.hasChanges(42), false);
  assert.throws(() => session.begin(0), /Task ID/);
  assert.throws(() => session.begin('1e2'), /Task ID/);
});

test('text survives another tab of the same task until explicitly cleared', () => {
  const session = createTaskCommentDraftSession();
  session.begin(42);
  session.setText('Черновик комментария');

  assert.equal(session.current().text, 'Черновик комментария');
  assert.equal(session.begin(42).text, 'Черновик комментария', 're-entering the same card tab must restore the draft');
  assert.equal(session.hasChanges(42), true);
});

test('draft state never leaks between tasks and restores per-task state', () => {
  const session = createTaskCommentDraftSession();
  session.begin(41);
  session.setText('Задача 41');
  session.setMentionedUserIds([7]);

  assert.deepEqual(session.begin(42), {
    taskId: 42,
    text: '',
    mentionedUserIds: [],
    reply: null,
  });
  session.setText('Задача 42');

  assert.equal(session.snapshot(41).text, 'Задача 41');
  assert.deepEqual(session.snapshot(41).mentionedUserIds, [7]);
  assert.equal(session.begin(41).text, 'Задача 41');
  assert.equal(session.snapshot(42).text, 'Задача 42');
});

test('mentioned users are unique positive safe integers in insertion order', () => {
  const session = createTaskCommentDraftSession();
  session.begin(42);
  const state = session.setMentionedUserIds([7, '7', 0, -2, 8.5, '9', '09', '1e2', null, 11]);

  assert.deepEqual(state.mentionedUserIds, [7, 9, 11]);
  assert.equal(session.hasChanges(42), true);
  session.setMentionedUserIds([]);
  assert.equal(session.hasChanges(42), false);
});

test('reply state accepts the card comment shape and can be cleared independently', () => {
  const session = new TaskCommentDraftSession();
  session.begin(42);
  session.setText('Ответ');
  const withReply = session.setReply({ id: '15', user_name: ' Анна ' });

  assert.deepEqual(withReply.reply, { id: 15, name: 'Анна' });
  assert.equal(session.hasChanges(42), true);
  assert.deepEqual(session.clearReply().reply, null);
  assert.equal(session.current().text, 'Ответ');
  assert.throws(() => session.setReply({ id: 0, name: 'Анна' }), /Reply comment ID/);
});

test('reply can also be set using the existing commentId and userName arguments', () => {
  const session = createTaskCommentDraftSession();
  session.begin(42);
  assert.deepEqual(session.setReply(15, 'Анна').reply, { id: 15, name: 'Анна' });
});

test('snapshots cannot mutate stored session state', () => {
  const session = createTaskCommentDraftSession();
  session.begin(42);
  session.setMentionedUserIds([7]);
  session.setReply(15, 'Анна');
  const state = session.current();

  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.mentionedUserIds), true);
  assert.equal(Object.isFrozen(state.reply), true);
  assert.throws(() => state.mentionedUserIds.push(8), TypeError);
  assert.deepEqual(session.current().mentionedUserIds, [7]);
});

test('hasChanges becomes false after values return to the empty baseline', () => {
  const session = createTaskCommentDraftSession();
  session.begin(42);
  session.setText('Текст');
  session.setMentionedUserIds([7]);
  session.setReply(15, 'Анна');
  assert.equal(session.hasChanges(42), true);

  session.setText('');
  session.setMentionedUserIds([]);
  session.clearReply();
  assert.equal(session.hasChanges(42), false);
});

test('clear removes only one task while clearAll resets the whole session', () => {
  const session = createTaskCommentDraftSession();
  session.begin(41);
  session.setText('Первый');
  session.begin(42);
  session.setText('Второй');

  assert.equal(session.clear(41), true);
  assert.equal(session.snapshot(41), null);
  assert.equal(session.snapshot(42).text, 'Второй');
  assert.equal(session.current().taskId, 42);
  assert.equal(session.clearAll(), 1);
  assert.equal(session.current(), null);
  assert.equal(session.snapshot(42), null);
  assert.equal(session.clearAll(), 0);
});

test('clearing the current task ends the active draft without touching others', () => {
  const session = createTaskCommentDraftSession();
  session.begin(41);
  session.setText('Первый');
  session.begin(42);
  session.setText('Второй');

  assert.equal(session.clear(42), true);
  assert.equal(session.current(), null);
  assert.equal(session.snapshot(41).text, 'Первый');
  assert.throws(() => session.setText('Нет active task'), /begin\(taskId\)/);
});

test('parseCommentTarget reads strict positive integers from hash or query', () => {
  assert.equal(parseCommentTarget('#/backlog?task=42&tab=com&comment=77'), 77);
  assert.equal(parseCommentTarget('/team-backlog?comment=81&task=42'), 81);
  assert.equal(parseCommentTarget('?comment=91'), 91);
  assert.equal(parseCommentTarget('comment=101&tab=com'), 101);
  assert.equal(parseCommentTarget(new URLSearchParams('comment=111')), 111);
});

test('parseCommentTarget rejects missing, malformed and unsafe targets', () => {
  for (const value of [
    '#/backlog?task=42',
    '#/backlog?comment=0',
    '#/backlog?comment=-1',
    '#/backlog?comment=1e2',
    '#/backlog?comment=01',
    '#/backlog?comment=1.5',
    '#/backlog?comment=9007199254740992',
    '#/backlog/comment=77',
    '',
    null,
  ]) assert.equal(parseCommentTarget(value), null, String(value));
});
