const TASK_SCOPES = new Set(['none', 'team', 'all']);
const SCOPE_RANK = Object.freeze({ none: 0, team: 1, all: 2 });

const TEAM_EDITOR_ROLES = new Set([
  'po/pl/cl',
  'ba/участник команды',
  'it pl',
]);
const GLOBAL_EDITOR_ROLES = new Set([
  'проектный офис (админ)',
  'администратор',
]);
const COMMENTER_ROLES = new Set([
  ...TEAM_EDITOR_ROLES,
  ...GLOBAL_EDITOR_ROLES,
  'лидер трайба',
]);

const ACTION_META = Object.freeze({
  edit: {
    permission: 'task_edit',
    allowedLabel: 'Редактирование доступно',
    deniedLabel: 'Редактирование недоступно',
    deniedReason: 'У вашей роли нет права редактировать эту задачу.',
  },
  comment: {
    permission: 'task_comment',
    allowedLabel: 'Комментирование доступно',
    deniedLabel: 'Комментирование недоступно',
    deniedReason: 'У вашей роли нет права комментировать эту задачу.',
  },
});

function permissionsOf(currentUser) {
  const permissions = currentUser?.permissions;
  return permissions && typeof permissions === 'object' && !Array.isArray(permissions)
    ? permissions
    : {};
}

function normalizedRole(currentUser) {
  const role = currentUser?.role_name
    || (typeof currentUser?.role === 'string' ? currentUser.role : currentUser?.role?.name)
    || '';
  return String(role).trim().toLocaleLowerCase('ru-RU');
}

function normalizedTeamId(value) {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function belongsToTaskTeam(currentUser, task) {
  const userTeamId = normalizedTeamId(currentUser?.team_id);
  const taskTeamId = normalizedTeamId(task?.team_id);
  return userTeamId !== null && taskTeamId !== null && userTeamId === taskTeamId;
}

function explicitScope(permissions, key) {
  if (!Object.hasOwn(permissions, key) || permissions[key] == null) return null;
  const value = permissions[key];
  return TASK_SCOPES.has(value)
    ? { scope: value, source: 'explicit', valid: true }
    : { scope: 'none', source: 'explicit', valid: false };
}

function legacyRoleScope(currentUser, action) {
  const role = normalizedRole(currentUser);
  if (action === 'edit') {
    if (GLOBAL_EDITOR_ROLES.has(role)) return 'all';
    if (TEAM_EDITOR_ROLES.has(role)) return 'team';
    return 'none';
  }
  return COMMENTER_ROLES.has(role) ? 'all' : 'none';
}

function hasLegacyAccess(permissions) {
  return ['backlog_dmb', 'backlog_team']
    .some(key => Object.hasOwn(permissions, key) && permissions[key] != null);
}

function legacyAccessScope(permissions, action) {
  if (!hasLegacyAccess(permissions)) return null;
  const dmb = permissions.backlog_dmb;
  const team = permissions.backlog_team;

  if (action === 'edit') {
    if (dmb === 'read_write' || team === 'write_all') return 'all';
    if (team === 'write_own') return 'team';
    return 'none';
  }

  if (dmb === 'read' || dmb === 'read_write' || team === 'read_all' || team === 'write_all') return 'all';
  if (team === 'read_own' || team === 'write_own') return 'team';
  return 'none';
}

function narrowScope(roleScope, accessScope) {
  if (accessScope === null) return roleScope;
  const rank = Math.min(SCOPE_RANK[roleScope] || 0, SCOPE_RANK[accessScope] || 0);
  return rank === SCOPE_RANK.all ? 'all' : rank === SCOPE_RANK.team ? 'team' : 'none';
}

function resolvedScope(currentUser, action) {
  const permissions = permissionsOf(currentUser);
  const explicit = explicitScope(permissions, ACTION_META[action].permission);
  if (explicit) return explicit;
  return {
    scope: narrowScope(legacyRoleScope(currentUser, action), legacyAccessScope(permissions, action)),
    source: 'legacy',
    valid: true,
  };
}

function permissionState(currentUser, task, action) {
  const meta = ACTION_META[action];
  const resolved = resolvedScope(currentUser, action);
  const allowed = resolved.scope === 'all'
    || (resolved.scope === 'team' && belongsToTaskTeam(currentUser, task));

  let reason;
  if (!resolved.valid) {
    reason = 'Право для карточки имеет неизвестное значение; действие запрещено.';
  } else if (resolved.scope === 'team' && !allowed) {
    reason = 'Действие доступно только для задач вашей команды.';
  } else if (allowed && resolved.scope === 'all') {
    reason = 'Действие доступно для задач всех команд.';
  } else if (allowed) {
    reason = 'Действие доступно для задач вашей команды.';
  } else {
    reason = meta.deniedReason;
  }

  return {
    allowed,
    scope: resolved.scope,
    source: resolved.source,
    valid: resolved.valid,
    label: allowed ? meta.allowedLabel : meta.deniedLabel,
    reason,
  };
}

export function getTaskEditPermission(currentUser, task) {
  return permissionState(currentUser, task, 'edit');
}

export function getTaskCommentPermission(currentUser, task) {
  return permissionState(currentUser, task, 'comment');
}

export function canEditTask(currentUser, task) {
  return getTaskEditPermission(currentUser, task).allowed;
}

export function canCommentTask(currentUser, task) {
  return getTaskCommentPermission(currentUser, task).allowed;
}
