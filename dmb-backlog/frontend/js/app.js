import { showSetup } from './components/accountSecurity.js';
import { avatar, counter } from './ui/dataDisplay.js';
import { createPopover } from './ui/popover.js';
import { bindActionMenu } from './ui/actionMenu.js';
import { installFilterSelects } from './ui/filterSelect.js';
import { installSegmentedControls } from './ui/segmented.js';
import { installStickyTableHeaders } from './ui/stickyTableHeader.js';
import { installRegistryColumns } from './ui/tableColumns.js';
/**
 * DMB Backlog - Main Application
 * Entry point, initializes router and store
 */
console.log('[DMB] app.js v20260910 pip-flow-v5.1 loaded');

import { Router, createTaskOpenHandler } from './router.js?v=234';
import { applyThemePreference } from './theme.js';
import { renderLogin, initLogin } from './components/login.js?v=3';
import { Store } from './store.js';
import { API } from './api.js?v=4';
import { Auth } from './auth.js';
import { renderSidebar, initSidebar } from './components/sidebar.js?v=71';
import { safeExternalUrl } from './urlUtils.js';
import { confirmAction, formatErrorMessage, showFieldError, showToast } from './uiFeedback.js';
import { initModalAccessibility } from './modalAccessibility.js';
import { initLocalSpellcheck } from './localSpellcheck.js?v=2';
import { formatTaskPublicId } from './taskPublicId.js';
import { pauseEventStream, resumeEventStream, startEventStream } from './eventStream.js?v=3';
import { createNotificationStore } from './notificationStore.js?v=5';
import {
  notificationCategoryMeta,
  notificationAccessibleLabel,
  notificationDeadlineMeta,
  notificationReadLocked,
  openNotificationTarget,
  recordNotificationUxEvent,
} from './notificationUtils.js?v=12';


const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_LENGTH = 2;
const SEARCH_MAX_RESULTS = 10;
const SEARCH_PAGE_SIZE = 1000;

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
    if (badge) badge.outerHTML = counter({value:count,cap:99,tone:'unread',label:'Непрочитанных уведомлений',id:'notif-badge',className:'notif-badge',hidden:count===0});
    if (sideBadge) sideBadge.outerHTML = counter({value:count,cap:99,tone:'unread',label:'Непрочитанных уведомлений',id:'notification-count',className:'item-badge'});
    if (bellButton) {
      bellButton.dataset.state = error ? 'stale' : 'ready';
      bellButton.setAttribute('aria-label', count ? `Уведомления: ${count} ${unreadLabel(count)}` : 'Уведомления: нет непрочитанных');
    }
    lastKnownUnreadCount = count;
    return;
  }
  if (badge && lastKnownUnreadCount === null) badge.outerHTML = counter({value:null,tone:'unread',label:'Непрочитанных уведомлений',id:'notif-badge',className:'notif-badge'});
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
let lastLiveNotificationId = null;
const liveRouteRefreshTimers = new Map();

const LIVE_REFRESH_ROUTES = {
  // Data-entry screens update their own state after a successful save. A live
  // invalidation must not destroy an in-progress form and fetch it again.
  task: new Set(['/dashboard', '/backlog', '/team-backlog', '/kanban', '/reports', '/reports/detail', '/reporting-meetings', '/analytics/tribe', '/analytics/po-pl', '/analytics/it']),
  requirement: new Set(['/customer', '/review']),
  report: new Set(['/reports', '/reports/detail', '/reporting-meetings', '/admin']),
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
    if((window.location.hash.slice(1).split('?')[0]||'/dashboard')!==path)return;
    if (document.hidden&&!['/backlog','/team-backlog'].includes(path)) return;
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
    if (lastLiveNotificationId === null) {
      lastLiveNotificationId = newestId;
    } else if (announce) {
      items
        .filter(item => item.id > lastLiveNotificationId && (item.category === 'meeting_capture' || ['critical', 'high'].includes(item.importance)))
        .sort((a, b) => a.id - b.id)
        .slice(-3)
        .forEach(item => showToast(item.title, item.category === 'meeting_capture' ? 'success' : item.importance === 'critical' ? 'error' : 'warning', {
          actionLabel: item.category === 'meeting_capture' ? 'Проверить разбор' : 'Открыть',
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
    if (!document.getElementById('notif-dropdown')?.hidden) {
      await loadNotifDropdown(app);
    }
  } catch {
    try { await checkNotifications(app); } catch (_) { /* stale shell state is preserved */ }
    if (!document.getElementById('notif-dropdown')?.hidden) await loadNotifDropdown(app);
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
  if (body.contains(document.activeElement)) body.closest('.ui-popover')?.focus({ preventScroll: true });
  body.innerHTML = '<div class="notif-dropdown-state content-loading-state" role="status">Загружаем уведомления…</div>';
  try {
    const snapshot = await app.notificationStore.refresh({ source: 'bell' });
    const items = snapshot?.recent_items || [];
    if (items.length === 0) {
      body.innerHTML = '<div class="notif-dropdown-state" role="status">Нет уведомлений</div>';
      return;
    }
    body.innerHTML = items.map(n => {
      const { icon, color, label: category } = notificationCategoryMeta(n.category);
      const time = formatShortTime(n.created_at);
      const deadline = notificationDeadlineMeta(n);
      const deadlineRow = deadline
        ? `<span class="notif-dropdown-deadline notification-deadline-badge is-${deadline.tone}"><i data-lucide="calendar-clock" aria-hidden="true"></i><span>${escapeHtml(deadline.compactLabel)}</span></span>`
        : '';
      return `
        <button type="button" class="ui-surface-action notif-dropdown-item${!n.is_read && !n.is_resolved ? ' is-unread' : ''}" data-notif-id="${n.id}" data-task-id="${n.task_id || ''}" data-category="${escapeHtml(n.category || '')}" data-resolved="${n.is_resolved ? 'true' : 'false'}" data-read-locked="${notificationReadLocked(n) ? 'true' : 'false'}" data-action-url="${encodeURIComponent(n.target?.url || n.action_url || '')}" aria-label="${escapeHtml(notificationAccessibleLabel(n))}">
          <span class="notif-dropdown-icon" style="--notification-color:${color}">
            <i data-lucide="${icon}" style="width:14px;height:14px;"></i>
          </span>
          <span class="notif-dropdown-copy">
            <span class="notif-dropdown-title">${escapeHtml(n.title)}</span>
            <span class="notif-dropdown-meta">${escapeHtml(category)} · ${escapeHtml(time)}</span>
            ${deadlineRow}
          </span>
        </button>`;
    }).join('');
    body.innerHTML += `<a href="#/notifications" class="ui-nav-action notif-dropdown-all">Все уведомления</a>`;
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
let searchPopover = null;
let searchGeneration = 0;

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
    return safeUrl ? `<a class="ui-entity-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">Jira</a>` : 'Некорректная ссылка';
  }).join(', ');
}

function renderLinkJiraTags(links) {
  const arr = parseLinkList(links);
  if (!arr.length) return '';
  return arr.map(url => {
    const safeUrl = safeExternalUrl(url);
    return safeUrl ? `<a class="ui-entity-link b-tag" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">🔗 Jira</a>` : '';
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
  const generation = ++searchGeneration;
  const container = document.getElementById('search-results');
  if (!query || query.length < SEARCH_MIN_LENGTH) {
    searchPopover?.close({ restoreFocus: false });
    return;
  }
  container.innerHTML = '<div class="ui-popover-empty" role="status">Ищем задачи…</div>';
  searchPopover?.open();
  try {
    const res = await app.api.get(`/workspace-search?q=${encodeURIComponent(query)}&per_page=${SEARCH_MAX_RESULTS}`);
    if (generation !== searchGeneration || document.activeElement !== document.getElementById('global-search')) return;
    const items = res.items || [];
    container.innerHTML = items.map(item => `
      <button type="button" class="ui-surface-action search-result-item" id="search-result-${item.kind}-${item.id}" role="option" aria-selected="false" data-id="${item.id}" data-kind="${item.kind}" tabindex="-1">
        <div class="search-result-main"><span class="search-result-id">${escapeHtml(item.public_id || String(item.id))}</span><span class="search-result-title">${highlightText(item.title, query)}</span></div>
        <div class="search-result-meta">${({work:'Рабочая задача',task:'Задача бэклога',project:'Проект',request:'Запрос заказчика'})[item.kind] || ''}</div>
      </button>`).join('') || '<div class="search-result-empty">Ничего не найдено</div>';
    if (res.total > items.length) container.insertAdjacentHTML('beforeend', '<div class="ui-popover-empty">Уточните запрос: показаны первые ' + items.length + ' из ' + res.total + '</div>');

    searchPopover?.open();
    searchPopover?.position();

    container.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.kind === 'work') location.hash = '#/work-tasks/' + el.dataset.id;
        else if (el.dataset.kind === 'project') location.hash = '#/work-projects?project=' + el.dataset.id;
        else if (el.dataset.kind === 'request') location.hash = '#/review/' + el.dataset.id;
        else document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: parseInt(el.dataset.id) } }));
        searchPopover?.close({ restoreFocus: false });
        document.getElementById('global-search').value = '';
        searchTasksCache = null;
      });
    });
  } catch (e) {
    if (generation !== searchGeneration || !container.isConnected) return;
    container.innerHTML = `<div class="ui-popover-empty" role="alert">${escapeHtml(formatErrorMessage(e))}</div>`;
    searchPopover?.open();
    console.error(e);
  }
}

async function handleLogout() {
  const { confirmDiscardChanges, clearQuickEditState } = await import('./components/quickEdit.js?v=95');
  const { clearAgentChatTransientStorage } = await import('./components/agentChat.js?v=96');
  const ok = await confirmDiscardChanges('Выйти', 'Есть несохранённые изменения. Выйти и потерять их?');
  if (!ok) return;
  clearQuickEditState();
  clearAgentChatTransientStorage();
  const app = window.app;
  if (app) {
    try { await app.auth.logout(); app.renderLoginPage(); }
    catch { window.toast?.('Серверное завершение сессии не подтверждено. Повторите выход.', 'error'); }
  } else {
    localStorage.removeItem('dmb_tokens');
    localStorage.removeItem('dmb_user');
    window.location.reload();
  }
}

export function renderAppShell(content) {
  const user = window.app?.store?.get('currentUser');
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
          <button class="square-icon btn btn-secondary btn-sm ui-btn btn-hamburger" id="sidebar-toggle-mobile" type="button" title="Меню" aria-label="Открыть меню" aria-controls="app-sidebar" aria-expanded="false">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          </button>
          <nav id="breadcrumb-nav" class="navbar-breadcrumb" aria-label="Хлебные крошки">
            <span id="breadcrumb-current" class="breadcrumb-current">Главная</span>
          </nav>
        </div>
        <div class="search-wrap navbar-search">
          <i data-lucide="search" class="navbar-search-icon"></i>
          <input type="text" id="global-search" role="combobox" aria-label="Поиск задач" aria-autocomplete="list" aria-controls="search-results" aria-expanded="false" placeholder="Поиск по системе" class="input ui-control search-input navbar-search-input">
          <div id="search-results" class="ui-search-popover" hidden></div>
        </div>
        <div class="navbar-right">
          <button id="backlog-context-help" class="btn btn-ghost btn-sm square-icon ui-btn navbar-icon-button" type="button" title="Спросить о текущей странице" aria-label="Спросить помощника о текущей странице" hidden>
            <i data-lucide="messages-square" aria-hidden="true"></i>
          </button>
          <button id="mobile-search-toggle" class="btn btn-ghost btn-sm square-icon ui-btn navbar-icon-button mobile-search-toggle" type="button" title="Поиск" aria-label="Открыть поиск" aria-expanded="false">
            <i data-lucide="search"></i>
          </button>
          <div style="position:relative;" id="notif-bell-wrap">
            <button class="btn btn-ghost btn-sm square-icon ui-btn" id="notif-bell-btn" type="button" aria-label="Уведомления" aria-expanded="false" aria-controls="notif-dropdown" style="position: relative">
              <i data-lucide="bell" aria-hidden="true" style=" display: block; color: var(--text-primary);"></i>
              ${counter({loading:true,cap:99,tone:'unread',label:'Непрочитанных уведомлений',id:'notif-badge',className:'notif-badge'})}
            </button>
            <div id="notif-dropdown" class="ui-notification-popover" aria-labelledby="notif-dropdown-title" hidden>
              <div id="notif-dropdown-title" class="ui-popover-header ui-popover-title">Уведомления</div>
              <div id="notif-dropdown-body">
                <div class="content-loading-state ui-popover-empty">Загрузка…</div>
              </div>
            </div>
          </div>
          <div class="navbar-separator" aria-hidden="true"></div>
          <button class="btn btn-ghost btn-sm square-icon ui-btn" id="theme-toggle" title="Переключить тему">
            <i data-lucide="${isDark ? 'sun' : 'moon'}" style=" display: block; color: var(--text-primary);"></i>
          </button>
          <div class="navbar-separator" aria-hidden="true"></div>
          <div class="user-menu-wrap">
            <button id="user-avatar-btn" class="ui-surface-action user-menu-trigger" aria-haspopup="menu" aria-expanded="false">
              ${avatar({name:user?.name,size:28})}
              <span class="user-menu-name">${shortName}</span>
              <i data-lucide="chevron-down" class="user-menu-chevron"></i>
            </button>
            <div id="user-dropdown" class="user-menu-dropdown" role="menu" hidden>
              <div class="user-menu-summary">
                <span class="user-menu-full-name">${userName}</span>
              </div>
              <button onclick="app.router.navigate('/account/security')" class="ui-surface-action dropdown-item" role="menuitem">Безопасность</button>
              <button id="logout-btn" class="ui-surface-action dropdown-item danger" role="menuitem"><i data-lucide="log-out" style="width: 16px; height: 16px;"></i> Выйти</button>
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
  // Deep links may arrive while optional shell modules are still loading.
  if (app.openTaskHandler) document.removeEventListener('open-task', app.openTaskHandler);
  app.openTaskHandler = createTaskOpenHandler(app, {
    onError: (err) => {
      console.error('Failed to open task', err);
      showToast('Не удалось открыть задачу: она удалена или недоступна', 'error');
    },
  });
  document.addEventListener('open-task', app.openTaskHandler);


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
  const { initContextHelp } = await import('./backlog-assistant/context-help.js');
  initContextHelp(document.getElementById('backlog-context-help'), app);

  // Bell dropdown
  const bellBtn = document.getElementById('notif-bell-btn');
  const bellDropdown = document.getElementById('notif-dropdown');
  if (bellBtn && bellDropdown) {
    const bellPopover = createPopover({ trigger: bellBtn, panel: bellDropdown, label: 'Уведомления', align: 'end' });
    const closeBellDropdown = (options = { restoreFocus: false }) => bellPopover.close(options);
    const openBell = () => { bellPopover.open(); loadNotifDropdown(app); };
    bellBtn.addEventListener('click', () => bellPopover.isOpen ? bellPopover.close() : openBell());
    bellBtn.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); openBell(); }
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
        if (notificationId && item.dataset.readLocked !== 'true') {
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
    searchPopover?.close({ restoreFocus: false });
    searchPopover = createPopover({ trigger: searchInput, panel: document.getElementById('search-results'), role: 'listbox', label: 'Найденные задачи', focus: false,
      onClose: () => { searchGeneration++; searchSelectedIdx = -1; searchInput.removeAttribute('aria-activedescendant'); } });
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchSelectedIdx = -1;
      searchGeneration++;
      searchInput.removeAttribute('aria-activedescendant');
      searchPopover.close({ restoreFocus: false });
      searchTimer = setTimeout(() => handleSearch(searchInput.value, app), SEARCH_DEBOUNCE_MS);
    });

    searchInput.addEventListener('keydown', (e) => {
      const container = document.getElementById('search-results');
      const items = container?.querySelectorAll('.search-result-item');
      if (!searchPopover.isOpen || !items || items.length === 0) return;
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
        searchPopover.close();
      }
      items.forEach((item, index) => item.setAttribute('aria-selected', String(index === searchSelectedIdx)));
      if (searchSelectedIdx >= 0) searchInput.setAttribute('aria-activedescendant', items[searchSelectedIdx].id);
      else searchInput.removeAttribute('aria-activedescendant');
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
    if (container && wrap && !wrap.contains(e.target) && !container.contains(e.target)) {
      searchPopover?.close({ restoreFocus: false });
      if (!e.target.closest('#mobile-search-toggle')) {
        wrap.classList.remove('mobile-open');
        mobileSearchToggle?.setAttribute('aria-expanded', 'false');
        mobileSearchToggle?.setAttribute('aria-label', 'Открыть поиск');
      }
    }
  });

  const avatarBtn = document.getElementById('user-avatar-btn');
  const dropdown = document.getElementById('user-dropdown');
  if (avatarBtn && dropdown) bindActionMenu({ trigger: avatarBtn, panel: dropdown, label: 'Меню пользователя', align: 'end' });

  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const next = isDark ? 'light' : 'dark';
      localStorage.setItem('dmb_theme', next);
      applyThemePreference(next);
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
  // Native hash links do not call router.navigate; dismiss the mobile drawer too.
  sidebar?.addEventListener('click', event => {
    if (mobileLayout.matches && event.target.closest('a[href^="#/"]')) {
      toggleMobileSidebar(false);
    }
  });

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
    this.features = {
      agent_v2: { enabled: false, pilot_allowed: false, operator_role: '' },
    };
    this.router = new Router(this);

    this.init();
  }

  async init() {
    this.disposeFilterSelects ||= installFilterSelects();
    this.disposeSegmentedControls ||= installSegmentedControls();
    this.disposeRegistryColumns ||= installRegistryColumns();
    this.disposeStickyTableHeaders ||= installStickyTableHeaders();
    this.applyTheme();
    if (location.hash.startsWith('#/activate')) { showSetup(this); return; }

    let isAuthenticated;
    try { isAuthenticated = this.auth.isAuthenticated() || await this.auth.restoreSession(); }
    catch { this.renderLoginPage(); window.toast?.('Сервис входа недоступен. Повторите позже.', 'error'); return; }

    if (isAuthenticated) {
      await this.loadUser();
      await this.loadFeatures();
      await this.loadFieldLabels();
      await this.loadReferenceData();
      this.renderAppLayout();
      this.router.onBeforeNavigate = async (toPath, fromHash) => {
        if (this.assistantV2NavigationGuard && !(await this.assistantV2NavigationGuard(toPath, fromHash))) return false;
        const { confirmAndCloseTaskFormsForNavigation } = await import('./components/modal.js?v=125');
        const taskCardOk = await confirmAndCloseTaskFormsForNavigation();
        if (!taskCardOk) return false;
        const { confirmDiscardChanges, clearQuickEditState } = await import('./components/quickEdit.js?v=95');
        const ok = await confirmDiscardChanges('Продолжить', 'Есть несохранённые изменения в режиме массового редактирования. Перейти и потерять их?');
        if (ok) clearQuickEditState();
        if (!ok) return false;
        const { confirmReportingStatusNavigation } = await import('./components/reportingStatuses.js?v=22');
        if (!(await confirmReportingStatusNavigation())) return false;
        const { confirmQuarterlyGoalsNavigation } = await import('./components/quarterlyGoalsUpdate.js?v=12');
        return confirmQuarterlyGoalsNavigation();
      };
      this.router.init();
    } else {
      this.renderLoginPage();
    }
  }

  applyTheme() {
    const theme = localStorage.getItem('dmb_theme') || 'light';
    applyThemePreference(theme);
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

  async loadFeatures() {
    try {
      this.features = await this.api.get('/features');
    } catch (error) {
      console.warn('Feature bootstrap unavailable', error);
      this.features = {
        agent_v2: { enabled: false, pilot_allowed: false, operator_role: '' },
      };
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
    document.dispatchEvent(new CustomEvent('dmb:session-ended'));
    const app = document.getElementById('app');
    app.innerHTML = renderLogin();

    if (window.lucide) window.lucide.createIcons();
    this.bindLoginForm();
    document.getElementById('login-activate')?.addEventListener('click', () => { location.hash='/activate'; showSetup(this); });
    this.api.get('/auth/password-policy').then(policy => {
      const support=document.getElementById('login-support');
      if(support) support.textContent='Забыли пароль? '+policy.support_contact;
    }).catch(() => {});
  }

  bindLoginForm() {
    initLogin(async (email, password) => {
      const response = await this.auth.login(email, password);
      this.store.set('currentUser', response.user);
      await this.loadFeatures();
      this.renderAppLayout();
      this.router.init();
      // router.init resolves the preserved deep link after authentication.

    });
  }

}

window.addEventListener('account-session-expiring', () => showToast('Сессия скоро завершится. Сохраните рабочий черновик перед повторным входом.', 'warning'));
window.toast = showToast;
window.confirmAction = confirmAction;
window.showFieldError = showFieldError;
window.formatErrorMessage = formatErrorMessage;

document.addEventListener('DOMContentLoaded', () => {
  initModalAccessibility();
  initLocalSpellcheck();
  window.app = new App();
});
