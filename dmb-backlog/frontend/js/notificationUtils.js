const GENERIC_BACKLOG_TARGETS = new Set(['/backlog', '/backlog/']);
const ALLOWED_TARGET_PATHS = new Set(['/backlog', '/notifications', '/reporting-statuses', '/quarterly-goals-update', '/meeting-capture']);

export const NOTIFICATION_CATEGORY_LABELS = {
  meeting_capture: 'Разбор встречи',
  work: 'Рабочая задача',
  assignment: 'Назначение',
  reporting: 'Отчётная встреча',
  mention: 'Упоминание',
  comment: 'Комментарий',
  request: 'Запрос',
};

export const NOTIFICATION_CATEGORY_META = {
  meeting_capture: { icon: 'clipboard-check', label: 'Разбор встречи', color: 'var(--success)' },
  work: { icon: 'list-checks', label: 'Рабочая задача', color: 'var(--info)' },
  assignment: { icon: 'user-plus', label: 'Назначение', color: 'var(--success)' },
  reporting: { icon: 'clipboard-check', label: 'Отчётная встреча', color: 'var(--warning)' },
  mention: { icon: 'at-sign', label: 'Упоминание', color: 'var(--accent)' },
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

function pluralDays(value) {
  const amount = Math.abs(Number(value) || 0);
  const mod100 = amount % 100;
  const mod10 = amount % 10;
  if (mod100 >= 11 && mod100 <= 19) return 'дней';
  if (mod10 === 1) return 'день';
  if (mod10 >= 2 && mod10 <= 4) return 'дня';
  return 'дней';
}

export function notificationDeadlineMeta(notification = {}, now = new Date()) {
  const raw = String(notification.deadline || '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const deadline = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    Number.isNaN(deadline.getTime())
    || deadline.getFullYear() !== Number(match[1])
    || deadline.getMonth() !== Number(match[2]) - 1
    || deadline.getDate() !== Number(match[3])
  ) return null;
  const suppliedDays = Number(notification.days_remaining);
  const hasSuppliedDays = notification.days_remaining !== null
    && notification.days_remaining !== undefined
    && notification.days_remaining !== ''
    && Number.isInteger(suppliedDays);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);
  const days = hasSuppliedDays
    ? suppliedDays
    : Math.round((deadline.getTime() - today.getTime()) / 86400000);
  const dateLabel = deadline.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'short', year: deadline.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
  const daysLabel = days < 0
    ? `Просрочено на ${Math.abs(days)} ${pluralDays(days)}`
    : days === 0
      ? 'Срок сегодня'
      : `${days === 1 ? 'Остался' : 'Осталось'} ${days} ${pluralDays(days)}`;
  return {
    deadline: raw,
    dateLabel,
    days,
    daysLabel,
    compactLabel: `Срок ${dateLabel} · ${daysLabel}`,
    tone: days <= 0 ? 'danger' : days <= 2 ? 'warning' : 'accent',
  };
}

export function normalizeNotificationTarget(value) {
  const target = String(value || '').trim().replace(/^#/, '');
  if (!target.startsWith('/')) return '';
  try {
    const parsed = new URL(target, 'https://dmb.local');
    if (parsed.origin === 'https://dmb.local' && /^\/work-tasks\/[1-9]\d*$/.test(parsed.pathname) && !parsed.search && !parsed.hash) return parsed.pathname;
    const isRequestPath = /^\/customer\/request\/[1-9]\d*$/.test(parsed.pathname);
    if (parsed.origin !== 'https://dmb.local' || (!ALLOWED_TARGET_PATHS.has(parsed.pathname) && !isRequestPath)) return '';
    const keys = [...new Set(parsed.searchParams.keys())];
    if (parsed.pathname === '/meeting-capture') {
      const captures = parsed.searchParams.getAll('capture');
      return !parsed.hash && keys.length === 1 && captures.length === 1 && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(captures[0])
        ? `/meeting-capture?capture=${captures[0].toLowerCase()}` : '';
    }
    if (isRequestPath) return keys.length ? '' : parsed.pathname;
    if (parsed.pathname === '/notifications') return keys.length ? '' : '/notifications';
    if (parsed.pathname === '/backlog') {
      if (keys.some(key => !['task', 'tab', 'comment'].includes(key))) return '';
      const task = Number(parsed.searchParams.get('task'));
      const tab = parsed.searchParams.get('tab');
      const comment = Number(parsed.searchParams.get('comment'));
      if (!Number.isInteger(task) || task <= 0 || (tab && !['com', 'rep', 'log'].includes(tab))) return '';
      if (parsed.searchParams.has('comment') && (tab !== 'com' || !Number.isInteger(comment) || comment <= 0)) return '';
      const safe = new URLSearchParams({ task: String(task) });
      if (tab) safe.set('tab', tab);
      if (Number.isInteger(comment) && comment > 0) safe.set('comment', String(comment));
      return `/backlog?${safe}`;
    }
    if (parsed.pathname === '/quarterly-goals-update') {
      if (keys.some(key => key !== 'source') || (parsed.searchParams.has('source') && parsed.searchParams.get('source') !== 'notification')) return '';
      return '/quarterly-goals-update?source=notification';
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
    return (explicitTarget.startsWith('/reporting-statuses') || explicitTarget.startsWith('/quarterly-goals-update'))
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

export function notificationTaskOpenDetail(target) {
  try {
    const parsed = new URL(String(target || ''), 'https://dmb.local');
    if (parsed.origin !== 'https://dmb.local' || parsed.pathname !== '/backlog') return null;
    const taskId = Number(parsed.searchParams.get('task'));
    if (!Number.isSafeInteger(taskId) || taskId <= 0) return null;
    const rawTab = parsed.searchParams.get('tab');
    const tab = ['com', 'rep', 'log'].includes(rawTab) ? rawTab : 'main';
    const rawCommentId = Number(parsed.searchParams.get('comment'));
    const commentId = tab === 'com' && Number.isSafeInteger(rawCommentId) && rawCommentId > 0
      ? rawCommentId
      : null;
    return { taskId, tab, commentId };
  } catch {
    return null;
  }
}

export function notificationState(notification = {}) {
    if (notification.is_resolved) return 'resolved';
    return notification.is_read ? 'read' : 'unread';
}

export function notificationReadLocked(notification = {}) {
  return notification.category === 'reporting' && !notification.is_resolved;
}

export function recordNotificationUxEvent(app, event, { surface = 'center', category = null, state = null, duration_ms = null } = {}) {
  if (!app?.api?.post) return;
  const payload = { event, surface, category, state };
  if (Number.isFinite(duration_ms)) payload.duration_ms = Math.max(0, Math.round(duration_ms));
  Promise.resolve(app.api.post('/notifications/ux-events', payload)).catch(() => {});
}

export function openNotificationTarget(app, notification, { surface = 'center' } = {}) {
  const target = resolveNotificationTarget(notification);
  const taskDetail = notificationTaskOpenDetail(target);
  const dimensions = {
    surface,
    category: notification.category || null,
    state: notificationState(notification),
  };
  recordNotificationUxEvent(app, 'notification_opened', dimensions);
  try {
    if (taskDetail) {
      document.dispatchEvent(new CustomEvent('open-task', { detail: taskDetail }));
    } else {
      if (typeof window !== 'undefined' && window.location.hash.startsWith('#/notifications')) {
        sessionStorage.setItem('notifications:return-route', window.location.hash);
        sessionStorage.setItem('notifications:return-scroll', String(document.querySelector('.main-content')?.scrollTop || window.scrollY));
      }
      app.router.navigate(target);
    }
    recordNotificationUxEvent(app, 'notification_target_opened', dimensions);
  } catch (error) {
    recordNotificationUxEvent(app, 'notification_target_failed', dimensions);
    throw error;
  }
  return target;
}

export function notificationActionLabel(notification = {}) {
  if (notification.category === 'meeting_capture') return 'Проверить разбор';
  if (notification.is_resolved) return 'Открыть контекст';
  if (resolveNotificationTarget(notification).startsWith('/quarterly-goals-update')) return 'Обновить прогресс и статусы';
  if (notification.category === 'reporting') return 'Обновить статусы';
  const workLabels = {'work.acceptance.required':'Принять результат','work.assignment.required':'Принять назначение','work.execution.required':'Начать работу','work.rework.required':'Доработать','work.reassignment.required':'Уточнить поручение'};
  if (workLabels[notification.type]) return workLabels[notification.type];
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
  const deadline = notificationDeadlineMeta(notification);
  const deadlineLabel = deadline ? `, срок ${deadline.dateLabel}, ${deadline.daysLabel}` : '';
  return `${category}, ${state}${deadlineLabel}: ${String(notification.title || '')}`.trim();
}

export function notificationReturnHref() {
  const route = typeof sessionStorage === 'undefined' ? '' : sessionStorage.getItem('notifications:return-route') || '';
  return /^#\/notifications(?:\?[^#]*)?$/.test(route) ? route : '#/notifications';
}
