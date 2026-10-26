import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canCommentTask,
  canEditTask,
  getTaskCommentPermission,
  getTaskEditPermission,
} from '../js/taskCardPermissions.js';

const task = (teamId = 10) => ({ id: 42, team_id: teamId });
const user = (permissions, overrides = {}) => ({
  id: 7,
  team_id: 10,
  role: 'PO/PL/CL',
  permissions,
  ...overrides,
});

test('explicit all scope allows the action across teams', () => {
  const currentUser = user({ task_edit: 'all', task_comment: 'all' });
  assert.equal(canEditTask(currentUser, task(99)), true);
  assert.equal(canCommentTask(currentUser, task(99)), true);
  assert.equal(getTaskEditPermission(currentUser, task(99)).source, 'explicit');
});

test('explicit team scope requires matching non-empty team identifiers', () => {
  const currentUser = user({ task_edit: 'team', task_comment: 'team' });
  assert.equal(canEditTask(currentUser, task('10')), true, 'numeric API IDs and string IDs describe the same team');
  assert.equal(canCommentTask(currentUser, task(10)), true);
  assert.equal(canEditTask(currentUser, task(11)), false);
  assert.equal(canCommentTask(currentUser, task(11)), false);
  assert.equal(canEditTask({ ...currentUser, team_id: null }, task(10)), false);
  assert.equal(canCommentTask(currentUser, task(null)), false);
  assert.match(getTaskEditPermission(currentUser, task(11)).reason, /только для задач вашей команды/);
});

test('explicit none cannot be widened by legacy role or backlog access', () => {
  const currentUser = user({
    task_edit: 'none',
    task_comment: 'none',
    backlog_dmb: 'read_write',
    backlog_team: 'write_all',
  }, { role: 'Администратор' });
  assert.equal(canEditTask(currentUser, task()), false);
  assert.equal(canCommentTask(currentUser, task()), false);
});

test('unknown explicit scopes fail closed instead of using legacy grants', () => {
  const currentUser = user({
    task_edit: 'read_write',
    task_comment: true,
    backlog_dmb: 'read_write',
    backlog_team: 'write_all',
  }, { role: 'Администратор' });
  const edit = getTaskEditPermission(currentUser, task());
  const comment = getTaskCommentPermission(currentUser, task());
  assert.equal(edit.allowed, false);
  assert.equal(comment.allowed, false);
  assert.equal(edit.valid, false);
  assert.equal(comment.valid, false);
  assert.match(edit.reason, /неизвестное значение/);
});

test('legacy global editor is limited by known backlog access', () => {
  const admin = user({ backlog_dmb: 'read_write', backlog_team: 'write_all' }, { role_name: 'Проектный офис (Админ)' });
  assert.equal(canEditTask(admin, task(99)), true);
  assert.equal(canCommentTask(admin, task(99)), true);
  assert.deepEqual(
    { scope: getTaskEditPermission(admin, task(99)).scope, source: getTaskEditPermission(admin, task(99)).source },
    { scope: 'all', source: 'legacy' },
  );

  const readOnlyAdmin = user({ backlog_dmb: 'read', backlog_team: 'read_all' }, { role: 'Администратор' });
  assert.equal(canEditTask(readOnlyAdmin, task()), false);
  assert.equal(canCommentTask(readOnlyAdmin, task(99)), true);
});

test('legacy team editors cannot be widened beyond their own team', () => {
  const teamEditor = user({ backlog_dmb: 'read_write', backlog_team: 'write_all' }, { role: 'IT PL' });
  assert.equal(canEditTask(teamEditor, task(10)), true);
  assert.equal(canEditTask(teamEditor, task(99)), false);
  assert.equal(getTaskEditPermission(teamEditor, task(10)).scope, 'team');

  const ownWriter = user({ backlog_dmb: 'read', backlog_team: 'write_own' });
  assert.equal(canEditTask(ownWriter, task(10)), true);
  assert.equal(canEditTask(ownWriter, task(99)), false);
});

test('legacy read access permits comments only for a recognized commenter role', () => {
  const analyst = user({ backlog_dmb: 'read', backlog_team: 'read_own' }, { role: 'BA/Участник команды' });
  assert.equal(canEditTask(analyst, task(10)), false);
  assert.equal(canCommentTask(analyst, task(99)), true);

  const leader = user({ backlog_dmb: 'read_write', backlog_team: 'write_all' }, { role: 'Лидер трайба' });
  assert.equal(canEditTask(leader, task(10)), false);
  assert.equal(canCommentTask(leader, task(99)), true);
});

test('known legacy roles remain a fallback when old responses omit access fields too', () => {
  const teamEditor = user({}, { role: 'PO/PL/CL' });
  assert.equal(canEditTask(teamEditor, task(10)), true);
  assert.equal(canEditTask(teamEditor, task(99)), false);
  assert.equal(canCommentTask(teamEditor, task(99)), true);

  const nullScopes = user({ task_edit: null, task_comment: null }, { role: 'PO/PL/CL' });
  assert.equal(canEditTask(nullScopes, task(10)), true);
  assert.equal(canCommentTask(nullScopes, task(99)), true);
});

test('unknown roles, access levels and missing users are denied by default', () => {
  const customRole = user({ backlog_dmb: 'read_write', backlog_team: 'write_all' }, { role: 'Custom editor' });
  assert.equal(canEditTask(customRole, task(10)), false);
  assert.equal(canCommentTask(customRole, task(10)), false);

  const unknownLevels = user({ backlog_dmb: 'full', backlog_team: 'write_everything' }, { role: 'Администратор' });
  assert.equal(canEditTask(unknownLevels, task(10)), false);
  assert.equal(canCommentTask(unknownLevels, task(10)), false);
  assert.equal(canEditTask(null, task(10)), false);
  assert.equal(canCommentTask(undefined, task(10)), false);
});

test('permission descriptors expose stable labels and useful reasons', () => {
  const allowed = getTaskCommentPermission(user({ task_comment: 'all' }), task(99));
  const denied = getTaskEditPermission(user({ task_edit: 'none' }), task());
  assert.equal(allowed.label, 'Комментирование доступно');
  assert.match(allowed.reason, /всех команд/);
  assert.equal(denied.label, 'Редактирование недоступно');
  assert.match(denied.reason, /нет права/);
});
