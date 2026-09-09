/**
 * DMB Backlog - Main Application
 * Entry point, initializes router and store
 */
console.log('[DMB] app.js v20260907 notif-v3 loaded');

import { Router } from './router.js?v=152';
import { Store } from './store.js';
import { API } from './api.js?v=2';
import { Auth } from './auth.js';
import { renderSidebar, initSidebar } from './components/sidebar.js?v=54';
import { safeExternalUrl } from './urlUtils.js';
import { confirmAction, formatErrorMessage, showFieldError, showToast } from './uiFeedback.js';
import { initModalAccessibility } from './modalAccessibility.js?v=1';
import { initLocalSpellcheck } from './localSpellcheck.js?v=2';
import { formatTaskPublicId } from './taskPublicId.js';
import { pauseEventStream, resumeEventStream, startEventStream } from './eventStream.js';
import { createNotificationStore } from './notificationStore.js?v=2';
import {
  NOTIFICATION_CATEGORY_LABELS,
  notificationAccessibleLabel,
  openNotificationTarget,
  recordNotificationUxEvent,
} from './notificationUtils.js?v=3';

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#f97316', '#f59e0b', '#10b981', '#06b6d4', '#0ea5e9',
];

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_LENGTH = 2;
const SEARCH_MAX_RESULTS = 10;
const SEARCH_PAGE_SIZE = 1000;

window.getUserInitials = function(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name[0].toUpperCase();
};

window.getAvatarColor = function(name) {
  if (!name) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

const NOTIF_CAT_ICONS = {
  assignment: 'user-plus', mention: 'at-sign', comment: 'message-circle',
  reporting: 'clipboard-check',
};

const NOTIF_CAT_COLORS = {
  assignment: '#10b981', mention: '#a855f7', comment: '#3b82f6',
  reporting: '#f59e0b',
};

let lastKnownUnreadCount = null;

function unreadLabel(count) {
  const mod100 = count % 100, mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 19) return 'непрочитанных';
  if (mod10 === 1) return 'непрочитанное';
  if (mod10 >= 2 && mod10 <= 4) return 'непрочитанных';
  return 'непрочитанных';
}

function renderNotificationShell(snapshot, error = null) {
  const count = snapshot?.summary?.unread;
  const badge = document.getElementById('notif-badge');
  const sideBadge = document.getElementById('notification-count');
  const bellButton = document.getElementById('notif-bell-btn');
  if (Number.isFinite(count)) {
    const val = count > 99 ? '99+' : count;
    if (badge) {
      if (count > 0) { badge.textContent = val; badge.classList.remove('hidden'); }
      else { badge.classList.add('hidden'); }
    }
    if (sideBadge) sideBadge.textContent = val;
    if (bellButton) {
      bellButton.dataset.state = error ? 'stale' : 'ready';
      bellButton.setAttribute('aria-label', count ? `Уведомления: ${count} ${unreadLabel(count)}` : 'Уведомления: нет непрочитанных');
    }
    lastKnownUnreadCount = count;
    return;
  }
  if (badge && lastKnownUnreadCount === null) { badge.textContent = '!'; badge.classList.remove('hidden'); }
  if (bellButton) {
    bellButton.dataset.state = 'stale';
    bellButton.setAttribute('aria-label', 'Уведомления: не удалось обновить данные');
  }
}

export async function checkNotifications(app = window.app) {
  try {
    const snapshot = await app.notificationStore.refresh({ source: 'bell' });
    renderNotificationShell(snapshot);
    return snapshot;
  } catch (error) {
    renderNotificationShell(app?.notificationStore?.snapshot, error);
    throw error;
  }
}

let notificationPollTimer = null;
let lastLiveNotificationId = 0;
const liveRouteRefreshTimers = new Map();

const LIVE_REFRESH_ROUTES = {
  task: new Set(['/dashboard', '/backlog', '/team-backlog', '/kanban', '/reports', '/reports/detail', '/reporting-statuses', '/reporting-meetings', '/analytics/tribe', '/analytics/po-pl', '/analytics/it']),
  requirement: new Set(['/customer', '/review']),
  report: new Set(['/reports', '/reports/detail', '/reporting-statuses', '/reporting-meetings', '/admin']),
};

function scheduleLiveRouteRefresh(app, kind, detail = {}) {
  if (kind === 'task' && detail.type === 'task.activity.changed') return;
  const path = (window.location.hash.slice(1).split('?')[0] || '/dashboard');
  const dynamicMatch = kind === 'requirement' && (/^\/customer\/request\/\d+$/.test(path) || /^\/review\/\d+$/.test(path));
  if (!dynamicMatch && !LIVE_REFRESH_ROUTES[kind]?.has(path)) return;
  if (kind === 'report' && path === '/admin' && document.getElementById('admin-modal-overlay')) {
    window.toast?.('Отчёты изменились в другой сессии. Закройте форму и обновите список перед сохранением.', 'warning');
    return;
  }
  if (kind === 'requirement' && document.querySelector('.review-modal')) {
    window.toast?.('Запрос изменился в другой сессии. Закройте диалог и проверьте актуальное состояние.', 'warning');
    return;
  }
  window.clearTimeout(liveRouteRefreshTimers.get(kind));
  liveRouteRefreshTimers.set(kind, window.setTimeout(async () => {
    liveRouteRefreshTimers.delete(kind);
    if (document.hidden) return;
    try {
      await app.router.refreshCurrentRoute();
    } catch (error) {
      console.warn(`Live ${kind} refresh failed`, error);
    }
  }, 500));
}

async function pollLiveNotifications(app, { announce = true } = {}) {
  if (document.hidden) return;
  try {
    const data = await app.api.get('/notifications?unread_only=true&per_page=10');
    const items = data.items || [];
    const newestId = items.reduce((max, item) => Math.max(max, item.id), 0);
    if (!lastLiveNotificationId) {
      lastLiveNotificationId = newestId;
    } else if (announce) {
      items
        .filter(item => item.id > lastLiveNotificationId && ['critical', 'high'].includes(item.importance))
        .sort((a, b) => a.id - b.id)
        .slice(-3)
        .forEach(item => showToast(item.title, item.importance === 'critical' ? 'error' : 'warning', {
          actionLabel: 'Открыть',
          duration: item.importance === 'critical' ? 12000 : 8000,
          onAction: () => {
            recordNotificationUxEvent(app, 'notification_primary_action_clicked', {
              surface: 'toast', category: item.category || null,
            });
            openNotificationTarget(app, item, { surface: 'toast' });
          },
        }));
      lastLiveNotificationId = Math.max(lastLiveNotificationId, newestId);
    }
    await checkNotifications(app);
    if (!document.getElementById('notif-dropdown')?.classList.contains('hidden')) {
      await loadNotifDropdown(app);
    }
  } catch {
    try { await checkNotifications(app); } catch (_) { /* stale shell state is preserved */ }
    if (!document.getElementById('notif-dropdown')?.classList.contains('hidden')) await loadNotifDropdown(app);
  }
}

function startNotificationPolling(app) {
  if (notificationPollTimer) window.clearInterval(notificationPollTimer);
  pollLiveNotifications(app, { announce: false });
  notificationPollTimer = window.setInterval(() => pollLiveNotifications(app), 60000);
}

async function loadNotifDropdown(app) {
  const body = document.getElementById('notif-dropdown-body');
  if (!body) return;
  body.innerHTML = '<div class="notif-dropdown-state" role="status">Загружаем уведомления…</div>';
  try {
    const snapshot = await app.notificationStore.refresh({ source: 'bell' });
    const items = snapshot?.recent_items || [];
    if (items.length === 0) {
      body.innerHTML = '<div class="notif-dropdown-state" role="status">Нет уведомлений</div>';
      return;
    }
    body.innerHTML = items.map(n => {
      const icon = NOTIF_CAT_ICONS[n.category] || 'bell';
      const color = NOTIF_CAT_COLORS[n.category] || '#64748b';
      const time = formatShortTime(n.created_at);
      const category = NOTIFICATION_CATEGORY_LABELS[n.category] || 'Уведомление';
      return `
        <button type="button" class="notif-dropdown-item${!n.is_read && !n.is_resolved ? ' is-unread' : ''}" data-notif-id="${n.id}" data-task-id="${n.task_id || ''}" data-category="${escapeHtml(n.category || '')}" data-resolved="${n.is_resolved ? 'true' : 'false'}" data-action-url="${encodeURIComponent(n.target?.url || n.action_url || '')}" aria-label="${escapeHtml(notificationAccessibleLabel(n))}">
          <span class="notif-dropdown-icon" style="background:${color}18;color:${color};">
            <i data-lucide="${icon}" style="width:14px;height:14px;"></i>
          </span>
          <span class="notif-dropdown-copy">
            <span class="notif-dropdown-title">${escapeHtml(n.title)}</span>
            <span class="notif-dropdown-meta">${escapeHtml(category)} · ${escapeHtml(time)}</span>
          </span>
        </button>`;
    }).join('');
    body.innerHTML += `<a href="#/notifications" style="display:block;padding:10px;text-align:center;font-size:13px;font-weight:600;color:var(--accent);text-decoration:none;">Все уведомления →</a>`;
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  } catch (error) {
    body.innerHTML = `<div class="notif-dropdown-state notif-dropdown-error" role="alert"><span>${escapeHtml(formatErrorMessage(error) || 'Не удалось загрузить уведомления')}</span><button type="button" class="btn btn-secondary btn-sm" data-retry-notifications>Повторить</button></div>`;
  }
}

function formatShortTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Только что';
  if (mins < 60) return `${mins} мин.`;
  if (hours < 24) return `${hours} ч.`;
  if (days < 7) return `${days} д.`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

let searchTasksCache = null;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function highlightText(text, query) {
  if (!text || !query) return escapeHtml(String(text || ''));
  const escaped = escapeHtml(String(text));
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${q})`, 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}

function parseLinkList(links) {
  if (!links) return [];
  if (Array.isArray(links)) return links.filter(Boolean);
  if (typeof links === 'string') {
    const s = links.trim();
    if (s.charAt(0) === '[') {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) return arr.filter(Boolean);
      } catch (e) { /* fall through */ }
    }
    return s.split(',').map(x => x.trim()).filter(Boolean);
  }
  return [];
}

function renderLinkJiraList(links) {
  const arr = parseLinkList(links);
  if (!arr.length) return '—';
  return arr.map(url => {
    const safeUrl = safeExternalUrl(url);
    return safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">Jira</a>` : 'Некорректная ссылка';
  }).join(', ');
}

function renderLinkJiraTags(links) {
  const arr = parseLinkList(links);
  if (!arr.length) return '';
  return arr.map(url => {
    const safeUrl = safeExternalUrl(url);
    return safeUrl ? `<a class="b-tag" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:#1e40af;background:rgba(139,92,246,0.08);border-color:rgba(139,92,246,0.2)">🔗 Jira</a>` : '';
  }).join('');
}

function renderInvolvedTeams(teams) {
  if (!teams || !teams.length) return '—';
  return escapeHtml(Array.isArray(teams) ? teams.join(', ') : teams);
}

function fieldLabel(field) {
  const labels = window.app?.fieldLabels || {};
  const fallback = {
    title: 'Задача',
    owner: 'Владелец',
    project: 'Проект',
    team_name: 'Команда',
    status: 'Статус',
    business_customer: 'Заказчик',
    description: 'Описание',
  };
  return escapeHtml(labels[field] || fallback[field] || field);
}

function scoreTask(task, query) {
  const q = query.toLowerCase();
  let score = 0;
  const matchedFields = [];

  if (task.title) {
    const t = task.title.toLowerCase();
    if (t === q) { score += 100; matchedFields.push('title'); }
    else if (t.startsWith(q)) { score += 80; matchedFields.push('title'); }
    else if (t.includes(q)) { score += 60; matchedFields.push('title'); }
  }

  const sid = String(task.id);
  const publicId = formatTaskPublicId(task).toLowerCase();
  if (sid === q) { score += 95; if (!matchedFields.includes('title')) matchedFields.push('id'); }
  else if (sid.includes(q)) { score += 40; if (!matchedFields.includes('title')) matchedFields.push('id'); }
  if (publicId === q) { score += 100; if (!matchedFields.includes('title')) matchedFields.push('id'); }
  else if (publicId.includes(q)) { score += 45; if (!matchedFields.includes('title')) matchedFields.push('id'); }

  ['owner', 'project', 'team_name', 'status', 'business_customer', 'description'].forEach(f => {
    if (!task[f]) return;
    const v = String(task[f]).toLowerCase();
    if (v === q) { score += 50; matchedFields.push(f); }
    else if (v.startsWith(q)) { score += 30; matchedFields.push(f); }
    else if (v.includes(q)) { score += 15; matchedFields.push(f); }
  });

  return { score, matchedFields };
}

async function handleSearch(query, app) {
  const container = document.getElementById('search-results');
  if (!query || query.length < SEARCH_MIN_LENGTH) {
    container?.classList.add('hidden');
    return;
  }
  try {
    if (!searchTasksCache) {
      const res = await app.api.get(`/tasks/?per_page=${SEARCH_PAGE_SIZE}`);
      searchTasksCache = res.items || res.tasks || [];
    }
    const tasks = searchTasksCache;

    const scored = tasks
      .map(t => ({ task: t, ...scoreTask(t, query) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, SEARCH_MAX_RESULTS);

    container.innerHTML = scored.map(({ task, score, matchedFields }) => {
      const titleHtml = highlightText(task.title, query);
      const nonTitleMatches = matchedFields.filter(f => f !== 'title' && f !== 'id');
      const extraHtml = nonTitleMatches.length > 0
        ? ' · ' + nonTitleMatches.map(f => {
            const val = highlightText(String(task[f] || ''), query);
            return `<span class="search-match-field">${fieldLabel(f)}: ${val}</span>`;
          }).join(' · ')
        : '';

      return `
        <div class="search-result-item" data-id="${task.id}" tabindex="-1">
          <div class="search-result-main">
            <span class="search-result-id">${formatTaskPublicId(task)}</span>
            <span class="search-result-title">${titleHtml}</span>
          </div>
          <div class="search-result-meta">
            <span class="search-result-status">${escapeHtml(task.status || '')}</span>
            <span class="search-result-extra">${extraHtml}</span>
          </div>
        </div>`;
    }).join('');

    if (scored.length === 0) {
      container.innerHTML = `<div class="search-result-empty">Ничего не найдено</div>`;
    }

    container.classList.remove('hidden');

    let selectedIdx = -1;
    const items = container.querySelectorAll('.search-result-item');

    container.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const event = new CustomEvent('open-task', { detail: { taskId: parseInt(el.dataset.id) } });
        document.dispatchEvent(event);
        container.classList.add('hidden');
        document.getElementById('global-search').value = '';
        searchTasksCache = null;
      });
    });
  } catch (e) {
    console.error(e);
  }
}

async function handleLogout() {
  const { confirmDiscardChanges, clearQuickEditState } = await import('./components/quickEdit.js?v=84');
  const { clearAgentChatTransientStorage } = await import('./components/agentChat.js?v=86');
  const ok = await confirmDiscardChanges('Выйти', 'Есть несохранённые изменения. Выйти и потерять их?');
  if (!ok) return;
  clearQuickEditState();
  clearAgentChatTransientStorage();
  const app = window.app;
  if (app) {
    await app.auth.logout();
    app.renderLoginPage();
  } else {
    localStorage.removeItem('dmb_tokens');
    localStorage.removeItem('dmb_user');
    window.location.reload();
  }
}

export function renderAppShell(content) {
  const user = window.app?.store?.get('currentUser');
  const initials = window.getUserInitials(user?.name);
  const avatarColor = window.getAvatarColor(user?.name);
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const userName = user?.name || 'User';
  const nameParts = userName.split(' ');
  const shortName = nameParts.length > 1 ? nameParts[0].charAt(0) + '.' + nameParts[1] : userName;
  return `
    ${renderSidebar()}
    <div class="sidebar-backdrop"></div>
    <div class="main-wrapper">
      <header class="navbar">
        <div class="navbar-heading">
          <button class="btn-hamburger" id="sidebar-toggle-mobile" type="button" title="Меню" aria-label="Открыть меню" aria-controls="app-sidebar" aria-expanded="false">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          </button>
          <nav id="breadcrumb-nav" class="navbar-breadcrumb" aria-label="Хлебные крошки">
            <span id="breadcrumb-current" class="breadcrumb-current">Главная</span>
          </nav>
        </div>
        <div class="search-wrap navbar-search">
          <i data-lucide="search" class="navbar-search-icon"></i>
          <input type="text" id="global-search" placeholder="Поиск…" class="search-input navbar-search-input">
          <div id="search-results" class="search-dropdown hidden"></div>
        </div>
        <div class="navbar-right">
          <button id="mobile-search-toggle" class="navbar-icon-button mobile-search-toggle" type="button" title="Поиск" aria-label="Открыть поиск" aria-expanded="false">
            <i data-lucide="search"></i>
          </button>
          <div style="position:relative;" id="notif-bell-wrap">
            <button id="notif-bell-btn" type="button" aria-label="Уведомления" aria-expanded="false" aria-controls="notif-dropdown" style="position: relative; padding: 8px; border-radius: 8px; border: none; background: transparent; cursor: pointer;">
              <i data-lucide="bell" aria-hidden="true" style="width: 20px; height: 20px; display: block; color: var(--text-primary);"></i>
              <span id="notif-badge" class="notif-badge hidden">0</span>
            </button>
            <div id="notif-dropdown" class="dropdown-menu hidden" role="region" aria-labelledby="notif-dropdown-title" style="position:absolute;top:100%;right:0;width:380px;max-height:420px;overflow-y:auto;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.12);z-index:1000;">
              <div id="notif-dropdown-title" style="padding:12px;border-bottom:1px solid var(--border-color);font-weight:600;font-size:14px;">Уведомления</div>
              <div id="notif-dropdown-body" style="min-height:60px;">
                <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px;">Загрузка...</div>
              </div>
            </div>
          </div>
          <div class="navbar-separator" aria-hidden="true"></div>
          <button id="theme-toggle" style="padding: 8px; border-radius: 8px; border: none; background: transparent; cursor: pointer; color: var(--text-muted);" title="Переключить тему">
            <i data-lucide="${isDark ? 'sun' : 'moon'}" style="width: 20px; height: 20px; display: block; color: var(--text-primary);"></i>
          </button>
          <div class="navbar-separator" aria-hidden="true"></div>
          <div class="user-menu-wrap">
            <button id="user-avatar-btn" class="user-menu-trigger" aria-haspopup="menu" aria-expanded="false">
              <div style="width: 28px; height: 28px; border-radius: 50%; background: ${avatarColor}; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: 700; flex-shrink: 0;">${initials}</div>
              <span class="user-menu-name">${shortName}</span>
              <i data-lucide="chevron-down" class="user-menu-chevron"></i>
            </button>
            <div id="user-dropdown" class="dropdown-menu user-menu-dropdown hidden" role="menu">
              <div class="user-menu-summary">
                <span class="user-menu-full-name">${userName}</span>
              </div>
              <button onclick="app.router.navigate('/settings')" class="dropdown-item"><i data-lucide="settings" style="width: 16px; height: 16px;"></i> Настройки</button>
              <button id="logout-btn" class="dropdown-item danger" role="menuitem"><i data-lucide="log-out" style="width: 16px; height: 16px;"></i> Выйти</button>
            </div>
          </div>
        </div>
      </header>
      <main class="main-content" id="page-content">
        ${content || ''}
      </main>
    </div>
  `;
}

export async function initApp(app) {
  app.notificationStore = createNotificationStore(app);
  app.notificationStore.subscribe(({ snapshot, error }) => renderNotificationShell(snapshot, error));
  app.refreshNotifications = () => checkNotifications(app);
  checkNotifications(app).catch(() => {});
  startNotificationPolling(app);
  startEventStream(app);
  document.addEventListener('dmb:notification-changed', () => {
    app.notificationStore.invalidate().catch(() => {});
    pollLiveNotifications(app);
  });
  document.addEventListener('dmb:task-changed', event => {
    searchTasksCache = null;
    scheduleLiveRouteRefresh(app, 'task', event.detail || {});
  });
  document.addEventListener('dmb:requirement-changed', event => scheduleLiveRouteRefresh(app, 'requirement', event.detail || {}));
  document.addEventListener('dmb:report-changed', event => scheduleLiveRouteRefresh(app, 'report', event.detail || {}));
  initSidebar();

  // Bell dropdown
  const bellBtn = document.getElementById('notif-bell-btn');
  const bellDropdown = document.getElementById('notif-dropdown');
  const bellWrap = document.getElementById('notif-bell-wrap');
  if (bellBtn && bellDropdown) {
    const closeBellDropdown = ({ restoreFocus = false } = {}) => {
      bellDropdown.classList.add('hidden');
      bellBtn.setAttribute('aria-expanded', 'false');
      if (restoreFocus) bellBtn.focus();
    };
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = bellDropdown.classList.toggle('hidden') === false;
      bellBtn.setAttribute('aria-expanded', String(isOpen));
      if (isOpen) loadNotifDropdown(app);
    });
    bellBtn.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !bellDropdown.classList.contains('hidden')) {
        event.preventDefault();
        closeBellDropdown({ restoreFocus: true });
      }
    });
    document.addEventListener('click', (e) => {
      if (bellWrap && !bellWrap.contains(e.target)) {
        closeBellDropdown();
      }
    });
    bellDropdown.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeBellDropdown({ restoreFocus: true }); }
    });
    bellDropdown.addEventListener('click', async (e) => {
      if (e.target.closest('a[href="#/notifications"]')) {
        closeBellDropdown();
        return;
      }
      if (e.target.closest('[data-retry-notifications]')) {
        await loadNotifDropdown(app);
        return;
      }
      const item = e.target.closest('.notif-dropdown-item');
      if (item) {
        const notificationId = parseInt(item.dataset.notifId, 10);
        if (notificationId) {
          try { await app.api.put('/notifications/read', { ids: [notificationId] }); }
          catch (error) { window.toast?.(window.formatErrorMessage?.(error)||'Не удалось обновить отметку о прочтении','warning'); }
        }
        const notification = {
          task_id: Number(item.dataset.taskId) || null,
          action_url: decodeURIComponent(item.dataset.actionUrl || ''),
          category: item.dataset.category || '',
          is_resolved: item.dataset.resolved === 'true',
        };
        recordNotificationUxEvent(app, 'notification_primary_action_clicked', {
          surface: 'bell', category: notification.category || null,
        });
        openNotificationTarget(app, notification, { surface: 'bell' });
        closeBellDropdown();
        app.notificationStore.invalidate().catch(() => {});
      }
    });
  }

  const searchInput = document.getElementById('global-search');
  let searchTimer;
  let searchSelectedIdx = -1;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchSelectedIdx = -1;
      searchTimer = setTimeout(() => handleSearch(searchInput.value, app), SEARCH_DEBOUNCE_MS);
    });

    searchInput.addEventListener('keydown', (e) => {
      const container = document.getElementById('search-results');
      const items = container?.querySelectorAll('.search-result-item');
      if (!items || items.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        searchSelectedIdx = Math.min(searchSelectedIdx + 1, items.length - 1);
        items.forEach((el, i) => el.classList.toggle('search-selected', i === searchSelectedIdx));
        items[searchSelectedIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        searchSelectedIdx = Math.max(searchSelectedIdx - 1, -1);
        items.forEach((el, i) => el.classList.toggle('search-selected', i === searchSelectedIdx));
        if (searchSelectedIdx >= 0) items[searchSelectedIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && searchSelectedIdx >= 0) {
        e.preventDefault();
        items[searchSelectedIdx]?.click();
      } else if (e.key === 'Escape') {
        container?.classList.add('hidden');
        searchInput.blur();
      }
    });
  }

  const mobileSearchToggle = document.getElementById('mobile-search-toggle');
  const navbarSearch = document.querySelector('.navbar-search');
  mobileSearchToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = navbarSearch?.classList.toggle('mobile-open') === true;
    mobileSearchToggle.setAttribute('aria-expanded', String(isOpen));
    mobileSearchToggle.setAttribute('aria-label', isOpen ? 'Закрыть поиск' : 'Открыть поиск');
    if (isOpen) requestAnimationFrame(() => searchInput?.focus());
  });

  document.addEventListener('click', (e) => {
    const container = document.getElementById('search-results');
    const wrap = document.querySelector('.search-wrap');
    if (container && wrap && !wrap.contains(e.target)) {
      container.classList.add('hidden');
      if (!e.target.closest('#mobile-search-toggle')) {
        wrap.classList.remove('mobile-open');
        mobileSearchToggle?.setAttribute('aria-expanded', 'false');
        mobileSearchToggle?.setAttribute('aria-label', 'Открыть поиск');
      }
    }
  });

  const avatarBtn = document.getElementById('user-avatar-btn');
  const dropdown = document.getElementById('user-dropdown');
  if (avatarBtn && dropdown) {
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.toggle('hidden') === false;
      avatarBtn.setAttribute('aria-expanded', String(isOpen));
    });
  }

  document.addEventListener('click', (e) => {
    const dd = document.getElementById('user-dropdown');
    if (dd && !dd.contains(e.target) && !e.target.closest('#user-avatar-btn')) {
      dd.classList.add('hidden');
      avatarBtn?.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('open-task', async (e) => {
    const taskId = e.detail?.taskId;
    if (!taskId) return;
    try {
      const task = await app.api.get(`/tasks/${taskId}`);
        const { openTaskModal } = await import('./components/modal.js?v=92');
      openTaskModal(task);
    } catch (err) {
      console.error('Failed to open task', err);
      showToast('Не удалось открыть задачу: она удалена или недоступна', 'error');
    }
  });

  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('dmb_theme', next);
      const icon = themeToggle.querySelector('[data-lucide]');
      if (icon) icon.setAttribute('data-lucide', isDark ? 'moon' : 'sun');
      if (window.lucide) window.lucide.createIcons();
    });
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseEventStream();
    } else {
      resumeEventStream();
      pollLiveNotifications(app);
    }
  });

  /* Mobile sidebar toggle */
  const hamburger = document.getElementById('sidebar-toggle-mobile');
  const backdrop = document.querySelector('.sidebar-backdrop');
  const sidebar = document.querySelector('.sidebar');
  const mobileLayout = window.matchMedia('(max-width: 768px)');
  if (sidebar) sidebar.id = 'app-sidebar';

  function toggleMobileSidebar(open, { restoreFocus = false } = {}) {
    if (!sidebar) return;
    const opened = open === undefined ? !sidebar.classList.contains('open') : Boolean(open);
    sidebar.classList.toggle('open', opened);
    const hidden = mobileLayout.matches && !opened;
    sidebar.inert = hidden;
    sidebar.toggleAttribute('inert', hidden);
    sidebar.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    hamburger?.setAttribute('aria-expanded', opened ? 'true' : 'false');
    hamburger?.setAttribute('aria-label', opened ? 'Закрыть меню' : 'Открыть меню');
    if (opened) window.requestAnimationFrame(() => sidebar.querySelector('a, button:not([disabled])')?.focus());
    if (!opened && restoreFocus) hamburger?.focus();
  }

  hamburger?.addEventListener('click', () => toggleMobileSidebar());
  backdrop?.addEventListener('click', () => toggleMobileSidebar(false, { restoreFocus: true }));

  /* An opened mobile drawer must never leak into compact/desktop layouts. */
  const resetSidebarAfterBreakpoint = (event) => {
    if (!event.matches) {
      sidebar?.classList.remove('open');
      sidebar?.removeAttribute('inert');
      sidebar?.setAttribute('aria-hidden', 'false');
      hamburger?.setAttribute('aria-expanded', 'false');
      return;
    }
    toggleMobileSidebar(false);
  };
  mobileLayout.addEventListener?.('change', resetSidebarAfterBreakpoint);
  resetSidebarAfterBreakpoint(mobileLayout);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobileLayout.matches && sidebar?.classList.contains('open')) {
      event.preventDefault();
      toggleMobileSidebar(false, { restoreFocus: true });
    }
  });

  /* Close sidebar on route change on mobile */
  const origNavigate = app.router.navigate;
  if (origNavigate) {
    app.router.navigate = function(hash) {
      toggleMobileSidebar(false);
      return origNavigate.call(this, hash);
    };
  }
}

class App {
  constructor() {
    this.store = new Store();
    this.api = new API();
    this.auth = new Auth(this.api, this.store);
    this.router = new Router(this);

    this.init();
  }

  async init() {
    this.applyTheme();

    const isAuthenticated = this.auth.isAuthenticated() || await this.auth.restoreSession();

    if (isAuthenticated) {
      await this.loadUser();
      await this.loadFieldLabels();
      await this.loadReferenceData();
      this.renderAppLayout();
      this.router.onBeforeNavigate = async (toPath, fromHash) => {
        const { confirmAndCloseTaskFormsForNavigation } = await import('./components/modal.js?v=92');
        const taskCardOk = await confirmAndCloseTaskFormsForNavigation();
        if (!taskCardOk) return false;
        const { confirmDiscardChanges, clearQuickEditState } = await import('./components/quickEdit.js?v=84');
        const ok = await confirmDiscardChanges('Продолжить', 'Есть несохранённые изменения в режиме массового редактирования. Перейти и потерять их?');
        if (ok) clearQuickEditState();
        if (!ok) return false;
        const { confirmReportingStatusNavigation } = await import('./components/reportingStatuses.js?v=11');
        return confirmReportingStatusNavigation();
      };
      this.router.init();
    } else {
      this.renderLoginPage();
    }
  }

  applyTheme() {
    const accent = localStorage.getItem('dmb_accent') || 'indigo';
    const compact = localStorage.getItem('dmb_compact') === 'true';
    const theme = localStorage.getItem('dmb_theme') || 'light';
    const systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
    const resolvedTheme = theme === 'system'
      ? (systemThemeMedia.matches ? 'dark' : 'light')
      : theme;

    if (this.systemThemeMedia && this.systemThemeHandler) {
      this.systemThemeMedia.removeEventListener('change', this.systemThemeHandler);
    }
    this.systemThemeMedia = systemThemeMedia;
    this.systemThemeHandler = null;
    if (theme === 'system') {
      this.systemThemeHandler = event => {
        document.documentElement.setAttribute('data-theme', event.matches ? 'dark' : 'light');
      };
      systemThemeMedia.addEventListener('change', this.systemThemeHandler);
    }

    document.documentElement.setAttribute('data-accent', accent);
    document.documentElement.setAttribute('data-compact', compact);
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }

  async loadUser() {
    try {
      const user = await this.api.get('/auth/me');
      const restoredUser = this.auth.getCurrentUser();
      if (!user.permissions && restoredUser?.permissions) {
        user.permissions = restoredUser.permissions;
      }
      localStorage.setItem('dmb_user', JSON.stringify(user));
      this.store.set('currentUser', user);
    } catch (e) {
      await this.auth.logout();
      this.renderLoginPage();
    }
  }

  async loadFieldLabels() {
    try {
      const labels = await this.api.get('/admin/field-labels');
      this.fieldLabels = labels || {};
    } catch (e) {
      this.fieldLabels = {};
    }
  }

  async loadReferenceData() {
    try {
      const ref = await this.api.get('/tasks/reference');
      console.log('[DEBUG] loadReferenceData response:', ref);
      this.statuses = ref.statuses || [];
      this.priorities = ref.priorities || [];
      this.deadlines = ref.deadlines || [];
      this.teams = ref.teams || [];
      this.projects = ref.projects || [];
      this.taskTypes = ref.task_types || [];
      this.channels = ref.channels || [];
      this.departments = ref.departments || [];
      this.businessCustomers = ref.business_customers || [];
      this.didClientGroups = ref.did_client_groups || [];
      this.tags = ref.tags || [];
      this.users = ref.users || [];
      console.log('[DEBUG] window.app.statuses:', this.statuses);
    } catch (e) {
      console.error('[DMB] Failed to load reference data:', e);
    }
  }

  renderAppLayout() {
    const app = document.getElementById('app');
    app.innerHTML = renderAppShell('');

    if (window.lucide) {
      window.lucide.createIcons();
    }

    initApp(this);
  }

  renderLoginPage() {
    const app = document.getElementById('app');
    app.innerHTML = `
      <div id="login-screen" style="position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 16px; overflow-y: auto; background: radial-gradient(circle at 20% 20%, rgba(99,102,241,0.25), transparent 40%), radial-gradient(circle at 80% 80%, rgba(16,185,129,0.18), transparent 40%), linear-gradient(135deg, #0f172a 0%, #1e293b 100%);">
        <div style="width: 100%; max-width: 448px;">
          <div style="background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 30px 60px -10px rgba(15,23,42,0.4), 0 0 0 1px rgba(255,255,255,0.06);">
            <div style="padding: 32px;">
              <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 24px;">
                <div style="width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: white; background: linear-gradient(135deg,#6366f1 0%,#818cf8 100%); flex-shrink: 0;">
                  <i data-lucide="layers" style="width: 20px; height: 20px;"></i>
                </div>
                <div>
                  <div style="font-weight: 700; color: #0f172a; font-size: 18px;">Backlog Coordinator</div>
                </div>
              </div>
              <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0;">Добро пожаловать</h2>
              <p style="font-size: 14px; color: #64748b; margin-top: 4px; margin-bottom: 0;">Введите учётные данные для продолжения</p>

              <form id="login-form" style="margin-top: 24px;">
                <div style="margin-bottom: 16px;">
                  <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">Email</label>
                  <div style="position: relative;">
                    <i data-lucide="mail" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: #94a3b8; pointer-events: none;"></i>
                    <input id="login-email" type="email" autocomplete="username" placeholder="name@example.com" style="width: 100%; padding: 12px 16px 12px 36px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; background: white; color: #0f172a; box-sizing: border-box;">
                  </div>
                </div>
                <div style="margin-bottom: 16px;">
                  <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">Пароль</label>
                  <div style="position: relative;">
                    <i data-lucide="lock" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: #94a3b8; pointer-events: none;"></i>
                    <input id="login-password" type="password" style="width: 100%; padding: 12px 40px 12px 36px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; background: white; color: #0f172a; box-sizing: border-box;">
                    <button id="login-pw-toggle" type="button" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); padding: 6px; border: none; background: transparent; cursor: pointer; border-radius: 4px; color: #94a3b8;">
                      <i id="login-eye" data-lucide="eye" style="width: 16px; height: 16px; display: block;"></i>
                    </button>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; color: #64748b;">
                    <i data-lucide="lightbulb" style="width: 14px; height: 14px; color: #f59e0b; flex-shrink: 0;"></i>
                    <span>Подсказка: пароль <code style="background: #f1f5f9; color: #334155; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 12px;">dmb2026</code></span>
                  </div>
                </div>
                <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 4px; margin-bottom: 16px;">
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: #475569; cursor: pointer;">
                    <input type="checkbox" checked style="accent-color: #6366f1; width: 16px; height: 16px;">
                    <span>Запомнить меня</span>
                  </label>
                  <a style="font-size: 14px; font-weight: 600; color: #6366f1; cursor: pointer;">Забыли пароль?</a>
                </div>
                <div id="login-error" style="display: none; align-items: center; gap: 8px; font-size: 12px; padding: 8px 12px; border-radius: 8px; background: #fff1f2; border: 1px solid #fecaca; color: #be123c; margin-bottom: 16px;">
                  <i data-lucide="alert-circle" style="width: 16px; height: 16px; flex-shrink: 0;"></i>
                  <span>Неверный пароль. Попробуйте ещё раз.</span>
                </div>
                <button id="login-btn" type="submit" style="width: 100%; padding: 12px; background: #6366f1; color: white; font-weight: 600; border: none; border-radius: 8px; font-size: 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 1px 3px rgba(99,102,241,0.3); transition: filter 0.2s;">
                  <i data-lucide="log-in" style="width: 16px; height: 16px;"></i>
                  <span id="login-btn-text">Войти в систему</span>
                </button>
              </form>
            </div>
            <div style="padding: 16px 32px; border-top: 1px solid #e2e8f0; text-align: center; background: #f8fafc;">
              <p style="font-size: 12px; color: #64748b; margin: 0;">© 2026 Backlog Coordinator · <a style="color: #6366f1; font-weight: 600; cursor: pointer;">Поддержка</a></p>
            </div>
          </div>
        </div>
      </div>
    `;

    if (window.lucide) window.lucide.createIcons();
    this.bindLoginForm();
  }

  bindLoginForm() {
    const pwToggle = document.getElementById('login-pw-toggle');
    if (pwToggle) {
      pwToggle.addEventListener('click', () => {
        const pw = document.getElementById('login-password');
        const eye = document.getElementById('login-eye');
        if (pw.type === 'password') {
          pw.type = 'text';
          eye.setAttribute('data-lucide', 'eye-off');
        } else {
          pw.type = 'password';
          eye.setAttribute('data-lucide', 'eye');
        }
        if (window.lucide) window.lucide.createIcons();
      });
    }
    const form = document.getElementById('login-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;

      try {
        const response = await this.auth.login(email, password);
        this.store.set('currentUser', response.user);
        this.renderAppLayout();
        this.router.init();
        this.router.navigate('/dashboard');
      } catch (error) {
        const el = document.getElementById('login-error');
        if (el) el.style.display = 'flex';
      }
    });
  }
}

window.toast = showToast;
window.confirmAction = confirmAction;
window.showFieldError = showFieldError;
window.formatErrorMessage = formatErrorMessage;

document.addEventListener('DOMContentLoaded', () => {
  initModalAccessibility();
  initLocalSpellcheck();
  window.app = new App();
});
