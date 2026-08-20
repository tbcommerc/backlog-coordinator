/**
 * DMB Backlog - Notifications Component (Server-driven)
 */
import { escapeHtml } from '../htmlUtils.js';
import { bindViewStateAction, renderViewState } from './viewState.js';

let currentPage = 1;
let loading = false;
let hasMore = true;
let activeCategory = null;
let observer = null;

const CATEGORY_META = {
    risk: { icon: 'alert-triangle', color: 'rose', label: 'Риск' },
    deadline: { icon: 'clock', color: 'amber', label: 'Дедлайн' },
    status_change: { icon: 'refresh-cw', color: 'indigo', label: 'Статус' },
    assignment: { icon: 'user-plus', color: 'green', label: 'Назначение' },
    mention: { icon: 'at-sign', color: 'purple', label: 'Упоминание' },
    comment: { icon: 'message-circle', color: 'blue', label: 'Комментарий' },
    express: { icon: 'zap', color: 'amber', label: 'Экспресс' },
    editing: { icon: 'pencil', color: 'orange', label: 'Редактирование' },
    stale: { icon: 'timer', color: 'slate', label: 'Давность' },
    attrs: { icon: 'file-text', color: 'slate', label: 'Атрибуты' },
    system: { icon: 'info', color: 'slate', label: 'Система' },
};

const IMPORTANCE_COLORS = {
    critical: 'var(--danger)',
    high: 'var(--warning)',
    medium: 'var(--info)',
    low: 'var(--text-muted)',
};

function formatNotifTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'Только что';
    if (mins < 60) return `${mins} мин. назад`;
    if (hours < 24) return `${hours} ч. назад`;
    if (days < 7) return `${days} д. назад`;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function getActionLabel(notification) {
    const url = notification.action_url || '';
    if (notification.task_id) return notification.category === 'comment' || notification.category === 'mention'
        ? 'К обсуждению' : 'Открыть задачу';
    if (url.includes('/settings')) return 'Настроить уведомления';
    if (url.includes('/review/')) return 'Перейти к ревью';
    if (url.includes('/customer/request/')) return 'Открыть запрос';
    if (url.includes('filter=')) return 'Показать задачи';
    if (url.includes('/express-estimate')) return 'Открыть оценку';
    return 'Перейти';
}

function renderNotifItem(n) {
    const meta = CATEGORY_META[n.category] || CATEGORY_META.system;
    const isUnread = !n.is_read;
    const groupBadge = n.group_count > 1
        ? `<span class="badge" style="background:${IMPORTANCE_COLORS[n.importance] || '#64748b'}22;color:${IMPORTANCE_COLORS[n.importance] || '#64748b'};font-size:10px;margin-left:6px;">×${n.group_count}</span>`
        : '';

    const importanceLabel = { critical: 'Срочно', high: 'Требует действия', medium: 'Важно', low: 'Информация' }[n.importance] || 'Информация';
    return `
    <article class="notification-card ${isUnread ? 'is-unread' : ''} ${n.is_resolved ? 'is-resolved' : ''} importance-${n.importance}" data-notif-id="${n.id}" data-task-id="${n.task_id || ''}">
        <div class="notification-card-icon" style="background:${IMPORTANCE_COLORS[n.importance] || '#64748b'}15;color:${IMPORTANCE_COLORS[n.importance] || '#64748b'};">
            <i data-lucide="${meta.icon}" class="w-4 h-4"></i>
        </div>
        <div class="notification-card-content">
            <div class="notification-card-meta">
                <span class="notification-topic">${meta.label}</span>
                <span class="notification-priority">${importanceLabel}</span>
                ${n.is_resolved ? '<span class="notification-resolved-label">Выполнено</span>' : ''}
                <time>${formatNotifTime(n.created_at)}</time>
            </div>
            <div class="notification-card-title-row">
                <h3>${escapeHtml(n.title)}</h3>
                ${groupBadge}
            </div>
            ${n.body ? `<p>${escapeHtml(n.body)}</p>` : ''}
        </div>
        <div class="notification-card-actions">
            ${(n.task_id || n.action_url)
                ? `<button data-open-notification data-task-id="${n.task_id || ''}" data-action-url="${encodeURIComponent(n.action_url || '')}" class="btn btn-primary btn-sm">
                    ${getActionLabel(n)} <i data-lucide="arrow-right" class="w-3 h-3"></i>
                </button>`
                : ''}
            ${!n.is_resolved
                ? `<button data-resolve="${n.id}" class="notification-icon-btn notification-resolve-btn" title="Отметить выполненным" aria-label="Отметить выполненным">
                    <i data-lucide="check" class="w-3 h-3"></i>
                </button>`
                : ''}
            <button data-dismiss="${n.id}" class="notification-icon-btn" title="Скрыть">
                <i data-lucide="x" class="w-3 h-3"></i>
            </button>
        </div>
    </article>`;
}

async function loadSummary(app) {
    try {
        const summary = await app.api.get('/notifications/summary');
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
        set('notif-stat-action', summary.requires_action || 0);
        set('notif-stat-unread', summary.unread || 0);
        set('notif-stat-today', summary.today || 0);
        document.querySelectorAll('[data-category-count]').forEach(el => {
            const count = summary.by_category?.[el.dataset.categoryCount] || 0;
            el.textContent = count;
            el.classList.toggle('hidden', count === 0);
        });
    } catch {}
}

async function loadNotifications(app, append = false) {
    if (loading) return;
    loading = true;

    try {
        const params = new URLSearchParams({ page: currentPage, per_page: 20 });
        if (activeCategory) params.set('category', activeCategory);

        const data = await app.api.get(`/notifications?${params}`);
        const container = document.getElementById('notifications-list');
        if (!container) return;

        if (!append) container.innerHTML = '';

        if (data.items.length === 0 && !append) {
            container.innerHTML = renderViewState({ kind: 'empty', title: 'Нет уведомлений', message: 'Пока ничего нового.' });
            hasMore = false;
        } else {
            container.insertAdjacentHTML('beforeend', data.items.map(renderNotifItem).join(''));
            hasMore = data.items.length === 20;
            currentPage++;
        }

        updateBadge(app);
        loadSummary(app);
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    } catch (e) {
        console.error('Notifications load error:', e);
        const container = document.getElementById('notifications-list');
        if (container && !append) {
            container.innerHTML = renderViewState({
                kind: 'error',
                message: window.formatErrorMessage?.(e) || 'Повторите попытку позже.',
                actionLabel: 'Повторить',
            });
            bindViewStateAction(container, () => loadNotifications(app));
            window.lucide?.createIcons();
        }
    } finally {
        loading = false;
    }
}

async function updateBadge(app) {
    try {
        const { count } = await app.api.get('/notifications/unread-count');
        const badge = document.getElementById('notif-badge');
        const sideBadge = document.getElementById('notification-count');
        const val = count > 99 ? '99+' : count;
        if (badge) {
            if (count > 0) { badge.textContent = val; badge.classList.remove('hidden'); }
            else { badge.classList.add('hidden'); }
        }
        if (sideBadge) sideBadge.textContent = val;
    } catch {}
}

function setupInfiniteScroll(app) {
    const sentinel = document.getElementById('scroll-sentinel');
    if (!sentinel) return;
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
            loadNotifications(app, true);
        }
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
}

export function renderNotifications(app) {
    return `
    <section class="notification-center animate-fade-in">
      <header class="notification-hero page-header">
        <div>
          <h1>Мои уведомления</h1>
          <p>Важные события и обновления по вашей зоне ответственности</p>
        </div>
        <button class="btn btn-secondary btn-sm" id="mark-all-read">
          <i data-lucide="check-check" style="width:14px;height:14px;"></i> Прочитать всё
        </button>
      </header>
      <div class="notification-stats">
        <div class="notification-stat is-action"><span id="notif-stat-action">—</span><div><strong>Требуют действия</strong><small>срочные и важные</small></div></div>
        <div class="notification-stat"><span id="notif-stat-unread">—</span><div><strong>Не прочитано</strong><small>в центре уведомлений</small></div></div>
        <div class="notification-stat"><span id="notif-stat-today">—</span><div><strong>Сегодня</strong><small>новых событий</small></div></div>
      </div>
      <div class="notification-workspace">
        <nav class="notification-nav" id="notification-tabs" aria-label="Темы уведомлений">
          ${[
            ['', 'inbox', 'Все уведомления'], ['risk', 'alert-triangle', 'Риски'],
            ['deadline', 'clock', 'Сроки'], ['assignment', 'user-plus', 'Назначения'],
            ['mention', 'at-sign', 'Упоминания'], ['comment', 'message-circle', 'Обсуждения'],
            ['status_change', 'refresh-cw', 'Изменения статуса'], ['stale', 'timer', 'Требуют обновления'],
            ['attrs', 'file-text', 'Неполные данные'], ['system', 'info', 'Система'],
          ].map(([key, icon, label], index) => `<button class="notification-nav-item ${index === 0 ? 'active' : ''}" data-cat="${key}"><i data-lucide="${icon}"></i><span>${label}</span>${key ? `<b data-category-count="${key}" class="hidden">0</b>` : ''}</button>`).join('')}
        </nav>
        <main class="notification-feed">
          <div class="notification-feed-header"><div><h2>Последние события</h2><p>Сначала показываем то, что требует вашего внимания</p></div></div>
          <div id="notifications-list">
            ${renderViewState({ kind: 'loading', title: 'Загружаем уведомления…' })}
          </div>
          <div id="scroll-sentinel" style="height:1px;"></div>
        </main>
      </div>
    </section>
    `;
}

export async function initNotifications(app) {
    currentPage = 1;
    hasMore = true;
    loading = false;
    activeCategory = null;

    await loadNotifications(app);
    setupInfiniteScroll(app);

    const tabs = document.querySelectorAll('#notification-tabs [data-cat]');
    tabs.forEach(tab => {
        tab.addEventListener('click', async () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeCategory = tab.dataset.cat || null;
            currentPage = 1;
            hasMore = true;
            await loadNotifications(app);
            setupInfiniteScroll(app);
        });
    });

    const markBtn = document.getElementById('mark-all-read');
    if (markBtn) {
        markBtn.addEventListener('click', async () => {
            try {
                await app.api.put('/notifications/read-all');
                await loadNotifications(app);
            } catch (e) {
                console.error('Mark all read error:', e);
            }
        });
    }

    const list = document.getElementById('notifications-list');
    if (list) {
        list.addEventListener('click', async (e) => {
            const resolveBtn = e.target.closest('[data-resolve]');
            if (resolveBtn) {
                const nid = parseInt(resolveBtn.dataset.resolve, 10);
                try {
                    await app.api.put(`/notifications/${nid}/resolve`);
                    const item = resolveBtn.closest('.notification-card');
                    if (item) {
                        item.classList.remove('is-unread');
                        item.classList.add('is-resolved');
                        const meta = item.querySelector('.notification-card-meta');
                        meta?.insertAdjacentHTML('beforeend', '<span class="notification-resolved-label">Выполнено</span>');
                    }
                    resolveBtn.remove();
                    updateBadge(app);
                    loadSummary(app);
                } catch (err) {
                    console.error('Resolve notification error:', err);
                }
                return;
            }

            const dismissBtn = e.target.closest('[data-dismiss]');
            if (dismissBtn) {
                const nid = parseInt(dismissBtn.dataset.dismiss, 10);
                try {
                    await app.api.delete(`/notifications/${nid}`);
                    const item = dismissBtn.closest('.notification-card');
                    if (item) item.remove();
                    updateBadge(app);
                    loadSummary(app);
                } catch (err) {
                    console.error('Dismiss error:', err);
                }
                return;
            }

            const openBtn = e.target.closest('[data-open-notification]');
            if (openBtn) {
                const item = openBtn.closest('.notification-card');
                const notificationId = parseInt(item?.dataset.notifId, 10);
                if (notificationId && item?.classList.contains('is-unread')) {
                    try { await app.api.put('/notifications/read', { ids: [notificationId] }); } catch {}
                    item.classList.remove('is-unread');
                    updateBadge(app);
                }
                const taskId = parseInt(openBtn.dataset.taskId, 10);
                if (taskId) {
                    document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId } }));
                } else {
                    const target = decodeURIComponent(openBtn.dataset.actionUrl || '').replace(/^#/, '');
                    app.router.navigate(target || '/notifications');
                }
            }
        });
    }
}
