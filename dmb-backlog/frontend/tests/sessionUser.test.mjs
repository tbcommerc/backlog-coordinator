import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSessionUser } from '../js/auth.js';
test('login and restored profile expose the same display role without altering permissions', () => {
  const permissions = { admin: 'none' };
  const login = { id: 25, role: 'BA/Участник команды', permissions };
  const normalized = normalizeSessionUser(login);
  assert.equal(normalized.role_name, 'BA/Участник команды');
  assert.equal(normalized.permissions, permissions);
  assert.equal(login.role_name, undefined);
  assert.equal(normalizeSessionUser({role_name:'IT PL',role:'legacy'}).role_name, 'IT PL');
  assert.equal(normalizeSessionUser(null), null);
});
