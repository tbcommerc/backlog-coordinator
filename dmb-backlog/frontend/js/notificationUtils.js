const GENERIC_BACKLOG_TARGETS = new Set(['/backlog', '/backlog/']);
const ALLOWED_TARGET_PATHS = new Set(['/backlog', '/notifications', '/reporting-statuses']);

export const NOTIFICATION_CATEGORY_LABELS = {
  assignment: 'Назначение',
  reporting: 'Отчётная встреча',
  mention: 'Упоминание',
  comment: 'Комментарий',
  request: 'Запрос',
};

export const NOTIFICATION_CATEGORY_META = {
  assignment: { icon: 'user-plus', label: 'Назначение', color: 'var(--success)' },
  reporting: { icon: 'clipboard-check', label: 'Отчётная встреча', color: 'var(--warning)' },
  mention: { icon: 'at-sign', label: 'Упоминание', color: '#a855f7' },
  comment: { icon: 'message-circle', label: 'Комментарий', color: 'var(--info)' },
  request: { icon: 'clipboard-check', label: 'Запрос', color: 'var(--success)' },
};

export const NOTIFICATION_IMPORTANCE_META = {
  critical: { label: 'Критический', color: 'var(--danger)' },
  high: { label: 'Высокий', color: 'var(--warning)' },
  medium: { label: 'Обычный', color: 'var(--info)' },
  low: { label: 'Информационный', color: 'var(--text-muted)' },
};

export function notificationCategoryMeta(category) {
  return NOTIFICATION_CATEGORY_META[category] || {
    icon: 'bell',
    label: 'Уведомление',
    color: 'var(--text-muted)',
  };
}

export function notificationImportanceMeta(importance) {
  return NOTIFICATION_IMPORTANCE_META[importance] || NOTIFICATION_IMPORTANCE_META.low;
}

export function formatNotificationTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Math.max(0, Date.now() - date.getTime());
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Только что';
  if (mins < 60) return `${mins} мин. назад`;
  if (hours < 24) return `${hours} ч. назад`;
  if (days < 7) return `${days} д. назад`;
  const options = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString('ru-RU', options);
}

export function normalizeNotificationTarget(value) {
  const target = String(value || '').trim().replace(/^#/, '');
  if (!target.startsWith('/')) return '';
  try {
    const parsed = new URL(target, 'https://dmb.local');
    const isRequestPath = /^\/customer\/request\/[1-9]\d*$/.test(parsed.pathname);
    if (parsed.origin !== 'https://dmb.local' || (!ALLOWED_TARGET_PATHS.has(parsed.pathname) && !isRequestPath)) return '';
    const keys = [...new Set(parsed.searchParams.keys())];
    if (isRequestPath) return keys.length ? '' : parsed.pathname;
    if (parsed.pathname === '/notifications') return keys.length ? '' : '/notifications';
    if (parsed.pathname === '/backlog') {
      if (keys.some(key => !['task', 'tab', 'comment'].includes(key))) return '';
      const task = Number(parsed.searchParams.get('task'));
      const tab = parsed.searchParams.get('tab');
      const comment = Number(parsed.searchParams.get('comment'));
      if (!Number.isInteger(task) || task <= 0 || (tab && !['com', 'rep'].includes(tab))) return '';
      if (parsed.searchParams.has('comment') && (tab !== 'com' || !Number.isInteger(comment) || comment <= 0)) return '';
      const safe = new URLSearchParams({ task: String(task) });
      if (tab) safe.set('tab', tab);
      if (Number.isInteger(comment) && comment > 0) safe.set('comment', String(comment));
      return `/backlog?${safe}`;
    }
    if (parsed.pathname === '/reporting-statuses') {
      if (keys.some(key => !['source', 'meeting_id'].includes(key))) return '';
      const rawMeetingId = parsed.searchParams.get('meeting_id');
      const meetingId = Number(rawMeetingId);
      const source = parsed.searchParams.get('source');
      if ((rawMeetingId !== null && (!Number.isInteger(meetingId) || meetingId <= 0)) || (source && source !== 'notification')) return '';
      return `/reporting-statuses?source=notification${rawMeetingId === null ? '' : `&meeting_id=${meetingId}`}`;
    }
    return '';
  } catch {
    return '';
  }
}

export function resolveNotificationTarget(notification = {}) {
  const explicitTarget = normalizeNotificationTarget(notification.target?.url || notification.action_url);
  // Reporting is a batch workflow. Legacy notifications may still carry a task_id
  // or a task_reporting target, but they must never reopen tasks one by one.
  if (notification.category === 'reporting') {
    return explicitTarget.startsWith('/reporting-statuses')
      ? explicitTarget
      : '/reporting-statuses?source=notification';
  }
  if (explicitTarget && !GENERIC_BACKLOG_TARGETS.has(explicitTarget)) return explicitTarget;

  const taskId = Number(notification.task_id);
  if (Number.isInteger(taskId) && taskId > 0) {
    if (['comment', 'mention'].includes(notification.category)) return `/backlog?task=${taskId}&tab=com`;
    return `/backlog?task=${taskId}`;
  }

  return '/notifications';
}

export function notificationState(notification = {}) {
  if (notification.is_resolved) return 'resolved';
  return notification.is_read ? 'read' : 'unread';
}

export function recordNotificationUxEvent(app, event, { surface = 'center', category = null, state = null, duration_ms = null } = {}) {
  if (!app?.api?.post) return;
  const payload = { event, surface, category, state };
  if (Number.isFinite(duration_ms)) payload.duration_ms = Math.max(0, Math.round(duration_ms));
  Promise.resolve(app.api.post('/notifications/ux-events', payload)).catch(() => {});
}

export function openNotificationTarget(app, notification, { surface = 'center' } = {}) {
  const target = resolveNotificationTarget(notification);
  const dimensions = {
    surface,
    category: notification.category || null,
    state: notificationState(notification),
  };
  recordNotificationUxEvent(app, 'notification_opened', dimensions);
  try {
    app.router.navigate(target);
    recordNotificationUxEvent(app, 'notification_target_opened', dimensions);
  } catch (error) {
    recordNotificationUxEvent(app, 'notification_target_failed', dimensions);
    throw error;
  }
  return target;
}

export function notificationActionLabel(notification = {}) {
  if (notification.is_resolved) return 'Открыть контекст';
  if (notification.category === 'reporting') return 'Обновить статусы';
  if (notification.category === 'request') return 'Открыть запрос';
  if (['comment', 'mention'].includes(notification.category)) return 'К обсуждению';
  if (notification.task_id) return 'Открыть задачу';
  return 'Открыть';
}

export function canDismissNotification(notification = {}) {
  return !(notification.category === 'reporting' && !notification.is_resolved);
}

export function notificationAccessibleLabel(notification = {}) {
  const category = NOTIFICATION_CATEGORY_LABELS[notification.category] || 'Уведомление';
  const state = notification.is_resolved ? 'закрыто' : notification.is_read ? 'прочитано' : 'непрочитано';
  return `${category}, ${state}: ${String(notification.title || '')}`.trim();
}
