import assert from 'node:assert/strict';

let user = null;
globalThis.window = {
  app: { store: { get: key => key === 'currentUser' ? user : null } },
};

const { canEditTaskForScope } = await import('../js/components/filterToolbar.js');

user = {
  role: 'Администратор',
  team_id: 1,
  permissions: { backlog_dmb: 'read_write', backlog_team: 'write_all' },
};
assert.equal(canEditTaskForScope('backlog', { team_id: 2 }), true);

user = { role_name: 'Администратор', team_id: 1 };
assert.equal(canEditTaskForScope('backlog', { team_id: 2 }), true);

user = {
  role: 'Администратор',
  team_id: 1,
  permissions: { backlog_dmb: 'read', backlog_team: 'read_all' },
};
assert.equal(canEditTaskForScope('backlog', { team_id: 1 }), false);

user = {
  role: 'BA/Участник команды',
  team_id: 7,
  permissions: { backlog_dmb: 'read', backlog_team: 'write_own' },
};
assert.equal(canEditTaskForScope('team', { team_id: 7 }), true);
assert.equal(canEditTaskForScope('team', { team_id: 8 }), false);

user = {
  role: 'Лидер трайба',
  team_id: 7,
  permissions: { backlog_dmb: 'read_write', backlog_team: 'write_all' },
};
assert.equal(canEditTaskForScope('backlog', { team_id: 7 }), false);
