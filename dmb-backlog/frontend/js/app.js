/**
 * DMB Backlog - Main Application
 * Entry point, initializes router and store
 */
console.log('[DMB] app.js v20260626.12 loaded');

import { Router } from './router.js';
import { Store } from './store.js';
import { API } from './api.js';
import { Auth } from './auth.js';
import { renderSidebar, initSidebar } from './components/sidebar.js';

const AVATAR_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#f97316', '#f59e0b', '#10b981', '#06b6d4', '#0ea5e9',
];

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_LENGTH = 2;
const SEARCH_MAX_RESULTS = 10;
const STALE_TASK_DAYS = 5;
const NOTIFICATION_PAGE_SIZE = 1000;
const SYSTEM_NOTIFICATION_COUNT = 4;
const MS_PER_DAY = 86400000;

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

let notifCount = 0;

function isRiskStatus(s) {
    return s === 'ХОЛД' || s === 'ЭСКАЛАЦИЯ НА ЛТ';
}

function isActiveStatus(s) {
    return ['СБОР ТРЕБОВАНИЙ', 'ПРОВЕРКА ТРЕБОВАНИЙ', 'УТОЧНЕНИЕ ТРЕБОВАНИЙ', 'ЭКСПРЕСС-ОЦЕНКА', 'ПРИНЯТИЕ РЕШЕНИЯ', 'ПРИНЯТА В РАБОТУ'].includes(s);
}

function getQuarter(date) {
    return Math.floor(date.getMonth() / 3) + 1;
}

export async function checkNotifications() {
  try {
    if (typeof window.__getNotifUnreadCount === 'function') {
      const unread = window.__getNotifUnreadCount();
      notifCount = unread;
      const badge = document.getElementById('notif-badge');
      const sideBadge = document.getElementById('notification-count');
      const val = unread > 99 ? '99+' : unread;
      if (badge) {
        if (unread > 0) { badge.textContent = val; badge.classList.remove('hidden'); }
        else { badge.classList.add('hidden'); }
      }
      if (sideBadge) sideBadge.textContent = val;
      return;
    }

    const store = window.app?.store;
    const user = store?.get('currentUser');
    let teamId = user?.team_id;
    if (!teamId && user?.team) {
      const cached = store?.get('_teams');
      if (cached && Array.isArray(cached)) {
        const ut = cached.find(t => t.name === user.team);
        if (ut) teamId = ut.id;
      }
      if (!teamId) {
        try {
          const resp = await window.app.api.get('/teams');
          const teams = resp.items || [];
          store?.set('_teams', teams);
          const ut = teams.find(t => t.name === user.team);
          if (ut) teamId = ut.id;
        } catch {}
      }
    }
    const now = new Date();
    const currentQuarter = getQuarter(now);
    const currentYear = now.getFullYear();
    const data = await window.app.api.get(`/tasks?per_page=${NOTIFICATION_PAGE_SIZE}`);
    const items = data.items || data.tasks || [];
    const counted = new Set();
    items.forEach(task => {
      if (!task || !task.id) return;
      const isMyTeam = teamId && task.team_id === teamId;
      if (!isMyTeam) return;
      let matched = false;
      if (isRiskStatus(task.status)) matched = true;
      else if (isActiveStatus(task.status) && task.effort_days == null && task.effort_rub == null) matched = true;
      else if (isActiveStatus(task.status) && (!task.description || task.description.length < STALE_TASK_DAYS * 4)) matched = true;
      else if (task.status === 'ПРИНЯТА В РАБОТУ' && task.updated_at) {
        const updated = new Date(task.updated_at);
        const daysDiff = Math.floor((now - updated) / MS_PER_DAY);
        if (daysDiff > STALE_TASK_DAYS) matched = true;
      }
      if (!matched && task.deadline) {
        const deadline = new Date(task.deadline);
        if (getQuarter(deadline) === currentQuarter && deadline.getFullYear() === currentYear && isActiveStatus(task.status)) matched = true;
      }
      if (matched) counted.add(task.id);
    });
    let count = counted.size + SYSTEM_NOTIFICATION_COUNT;
    notifCount = count;
    const badge = document.getElementById('notif-badge');
    const sideBadge = document.getElementById('notification-count');
    const val = count > 99 ? '99+' : count;
    if (badge) {
      if (count > 0) { badge.textContent = val; badge.classList.remove('hidden'); }
      else { badge.classList.add('hidden'); }
    }
    if (sideBadge) {
      sideBadge.textContent = val;
    }
  } catch {
    const badge = document.getElementById('notif-badge');
    if (badge) badge.classList.add('hidden');
  }
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

function fieldLabel(field) {
  const labels = {
    title: 'Задача',
    owner: 'Владелец',
    project: 'Проект',
    team_name: 'Команда',
    status: 'Статус',
    business_customer: 'Заказчик',
    description: 'Описание',
  };
  return labels[field] || field;
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
  if (sid === q) { score += 95; if (!matchedFields.includes('title')) matchedFields.push('id'); }
  else if (sid.includes(q)) { score += 40; if (!matchedFields.includes('title')) matchedFields.push('id'); }

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
      const res = await app.api.get(`/tasks?per_page=${NOTIFICATION_PAGE_SIZE}`);
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
            <span class="search-result-id">#${task.id}</span>
            <span class="search-result-title">${titleHtml}</span>
          </div>
          <div class="search-result-meta">
            <span class="search-result-status">${task.status || ''}</span>
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

function handleLogout() {
  localStorage.removeItem('dmb_tokens');
  localStorage.removeItem('dmb_user');
  const app = window.app;
  if (app) {
    app.renderLoginPage();
  } else {
    window.location.reload();
  }
}

export function renderAppShell(content) {
  const user = window.app?.store?.get('currentUser');
  const initials = window.getUserInitials(user?.name);
  const avatarColor = window.getAvatarColor(user?.name);
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  return `
    ${renderSidebar()}
    <div class="sidebar-backdrop"></div>
    <div class="main-wrapper">
      <header class="navbar">
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="btn-hamburger" id="sidebar-toggle-mobile" title="Меню">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          </button>
          <nav id="breadcrumb-nav" style="display: flex; align-items: center; gap: 8px; font-size: 14px;">
            <a href="#/dashboard" style="color: var(--text-muted); text-decoration: none;">DMB Backlog</a>
            <span style="color: var(--text-muted);">/</span>
            <span id="breadcrumb-current" style="color: var(--text-primary); font-weight: 500;">Главная</span>
          </nav>
        </div>
        <div class="search-wrap" style="position: relative; flex: 1; max-width: 400px; margin: 0 16px;">
          <i data-lucide="search" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: var(--text-muted); pointer-events: none;"></i>
          <input type="text" id="global-search" placeholder="Поиск задач..." class="search-input" style="padding-left: 36px;">
          <div id="search-results" class="search-dropdown hidden"></div>
        </div>
        <div class="navbar-right" style="display: flex; align-items: center; gap: 4px;">
          <button onclick="app.router.navigate('/notifications')" style="position: relative; padding: 8px; border-radius: 8px; border: none; background: transparent; cursor: pointer;">
            <i data-lucide="bell" style="width: 20px; height: 20px; display: block; color: var(--text-primary);"></i>
            <span id="notif-badge" class="notif-badge hidden">0</span>
          </button>
          <div style="width:1px;height:24px;background:var(--border-color);margin:0 4px;"></div>
          <button id="theme-toggle" style="padding: 8px; border-radius: 8px; border: none; background: transparent; cursor: pointer; color: var(--text-muted);" title="Переключить тему">
            <i data-lucide="${isDark ? 'sun' : 'moon'}" style="width: 20px; height: 20px; display: block; color: var(--text-primary);"></i>
          </button>
          <button id="logout-btn" style="padding: 8px; border-radius: 8px; border: none; background: transparent; cursor: pointer; color: var(--text-muted);" title="Выйти">
            <i data-lucide="log-out" style="width: 20px; height: 20px; display: block; color: var(--text-primary);"></i>
          </button>
          <div style="width:1px;height:24px;background:var(--border-color);margin:0 4px;"></div>
          <div style="position: relative;">
            <button id="user-avatar-btn" style="display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 4px; border-radius: 8px; border: none; background: transparent; cursor: pointer;">
              <div style="width: 28px; height: 28px; border-radius: 50%; background: ${avatarColor}; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: 700; flex-shrink: 0;">${initials}</div>
              <span style="font-size: 14px; font-weight: 500; color: var(--text-primary);">${user?.name || 'User'}</span>
            </button>
            <div id="user-dropdown" class="dropdown-menu hidden">
              <button onclick="app.router.navigate('/settings')" class="dropdown-item"><i data-lucide="settings" style="width: 16px; height: 16px;"></i> Настройки</button>
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
  app.refreshNotifications = checkNotifications;
  checkNotifications();
  initSidebar();

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

  document.addEventListener('click', (e) => {
    const container = document.getElementById('search-results');
    const wrap = document.querySelector('.search-wrap');
    if (container && wrap && !wrap.contains(e.target)) {
      container.classList.add('hidden');
    }
  });

  const avatarBtn = document.getElementById('user-avatar-btn');
  const dropdown = document.getElementById('user-dropdown');
  if (avatarBtn && dropdown) {
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
    });
  }

  document.addEventListener('click', (e) => {
    const dd = document.getElementById('user-dropdown');
    if (dd && !dd.contains(e.target) && !e.target.closest('#user-avatar-btn')) {
      dd.classList.add('hidden');
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
    if (!document.hidden) checkNotifications();
  });

  /* Mobile sidebar toggle */
  const hamburger = document.getElementById('sidebar-toggle-mobile');
  const backdrop = document.querySelector('.sidebar-backdrop');
  const sidebar = document.querySelector('.sidebar');

  function toggleMobileSidebar(open) {
    if (!sidebar) return;
    if (open === undefined) {
      sidebar.classList.toggle('open');
    } else if (open) {
      sidebar.classList.add('open');
    } else {
      sidebar.classList.remove('open');
    }
  }

  hamburger?.addEventListener('click', () => toggleMobileSidebar());
  backdrop?.addEventListener('click', () => toggleMobileSidebar(false));

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

    const isAuthenticated = this.auth.isAuthenticated();

    if (isAuthenticated) {
      await this.loadUser();
      this.renderAppLayout();
      this.router.init();
    } else {
      this.renderLoginPage();
    }
  }

  applyTheme() {
    const accent = localStorage.getItem('dmb_accent') || 'indigo';
    const compact = localStorage.getItem('dmb_compact') === 'true';
    const theme = localStorage.getItem('dmb_theme') || 'light';

    document.documentElement.setAttribute('data-accent', accent);
    document.documentElement.setAttribute('data-compact', compact);
    document.documentElement.setAttribute('data-theme', theme);
  }

  async loadUser() {
    try {
      const user = await this.api.get('/auth/me');
      this.store.set('currentUser', user);
    } catch (e) {
      this.auth.logout();
      this.renderLoginPage();
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
                  <div style="font-weight: 700; color: #0f172a; font-size: 18px;">DMB Backlog</div>
                </div>
              </div>
              <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0;">Добро пожаловать</h2>
              <p style="font-size: 14px; color: #64748b; margin-top: 4px; margin-bottom: 0;">Введите учётные данные для продолжения</p>

              <form id="login-form" style="margin-top: 24px;">
                <div style="margin-bottom: 16px;">
                  <label style="display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px;">Email</label>
                  <div style="position: relative;">
                    <i data-lucide="mail" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); width: 16px; height: 16px; color: #94a3b8; pointer-events: none;"></i>
                    <input id="login-email" type="email" value="t.babyak@dmb.ru" style="width: 100%; padding: 12px 16px 12px 36px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; background: white; color: #0f172a; box-sizing: border-box;">
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
              <p style="font-size: 12px; color: #64748b; margin: 0;">© 2026 DMB Backlog · <a style="color: #6366f1; font-weight: 600; cursor: pointer;">Поддержка</a></p>
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
        this.store.set('tokens', {
          access: response.access_token,
          refresh: response.refresh_token
        });

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

window.toast = function (msg, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  toast.className = 'toast toast-' + type;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || '✓'}</span><span class="toast-message">${escapeHtml(msg)}</span>`;
  container.appendChild(toast);
  const timeout = type === 'error' ? 5000 : 3000;
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, timeout);
};

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
