/**
 * DMB Backlog - Notifications Component (Server-driven)
 */

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

function renderNotifItem(n) {
    const meta = CATEGORY_META[n.category] || CATEGORY_META.system;
    const isUnread = !n.is_read;
    const groupBadge = n.group_count > 1
        ? `<span class="badge" style="background:${IMPORTANCE_COLORS[n.importance] || '#64748b'}22;color:${IMPORTANCE_COLORS[n.importance] || '#64748b'};font-size:10px;margin-left:6px;">×${n.group_count}</span>`
        : '';

    return `
    <div class="flex items-start gap-3 p-3 rounded-lg border border-main notification-item ${isUnread ? 'notification-unread' : ''}" data-notif-id="${n.id}" data-task-id="${n.task_id || ''}">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style="background:${IMPORTANCE_COLORS[n.importance] || '#64748b'}15;color:${IMPORTANCE_COLORS[n.importance] || '#64748b'};">
            <i data-lucide="${meta.icon}" class="w-4 h-4"></i>
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-0.5">
                <span class="font-semibold text-sm text-main">${n.title}</span>
                ${groupBadge}
            </div>
            ${n.body ? `<div class="text-xs text-muted">${n.body}</div>` : ''}
            <div class="text-xs text-muted mt-1">
                <span class="badge badge-sm" style="background:${IMPORTANCE_COLORS[n.importance] || '#64748b'}15;color:${IMPORTANCE_COLORS[n.importance] || '#64748b'};">${meta.label}</span>
                <span style="margin-left:8px;">${formatNotifTime(n.created_at)}</span>
            </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
            ${n.task_id
                ? `<button data-open-task="${n.task_id}" class="btn-secondary px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1 shrink-0" title="Открыть задачу">
                    <i data-lucide="external-link" class="w-3 h-3"></i>
                </button>`
                : ''}
            ${isUnread
                ? `<button data-mark-read="${n.id}" class="btn-ghost px-2 py-1.5 text-xs rounded-lg flex items-center gap-1 shrink-0" title="Отметить прочитанным">
                    <i data-lucide="check" class="w-3 h-3"></i>
                </button>`
                : ''}
            <button data-dismiss="${n.id}" class="btn-ghost px-2 py-1.5 text-xs rounded-lg flex items-center gap-1 shrink-0" title="Скрыть">
                <i data-lucide="x" class="w-3 h-3"></i>
            </button>
        </div>
    </div>`;
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
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i data-lucide="bell-off"></i></div>
                    <h3 class="empty-state-title">Нет уведомлений</h3>
                    <p class="empty-state-description">Пока ничего нового</p>
                </div>`;
            hasMore = false;
        } else {
            container.insertAdjacentHTML('beforeend', data.items.map(renderNotifItem).join(''));
            hasMore = data.items.length === 20;
            currentPage++;
        }

        updateBadge(app);
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    } catch (e) {
        console.error('Notifications load error:', e);
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
    <div class="page-header animate-fade-in">
        <h1>Мои уведомления</h1>
        <p>Уведомления по вашим задачам</p>
    </div>
    <div class="flex gap-3" style="margin-bottom: var(--space-6);">
        <button class="btn btn-secondary btn-sm" id="mark-all-read">
            <i data-lucide="check-check" style="width:14px;height:14px;"></i>
            Отметить все прочитанными
        </button>
    </div>
    <div class="tabs" id="notification-tabs">
        <div class="tab active" data-cat="">Все</div>
        <div class="tab" data-cat="risk">Риск</div>
        <div class="tab" data-cat="deadline">Дедлайны</div>
        <div class="tab" data-cat="status_change">Статус</div>
        <div class="tab" data-cat="assignment">Назначение</div>
        <div class="tab" data-cat="mention">Упоминания</div>
        <div class="tab" data-cat="comment">Комментарии</div>
        <div class="tab" data-cat="express">Экспресс</div>
        <div class="tab" data-cat="system">Система</div>
    </div>
    <div class="card" id="notifications-list" style="display:flex;flex-direction:column;gap:8px;padding:8px;">
        <div class="empty-state">
            <div class="empty-state-icon"><i data-lucide="loader"></i></div>
            <p class="text-muted">Загрузка...</p>
        </div>
    </div>
    <div id="scroll-sentinel" style="height:1px;"></div>
    `;
}

export async function initNotifications(app) {
    currentPage = 1;
    hasMore = true;
    loading = false;
    activeCategory = null;

    await loadNotifications(app);
    setupInfiniteScroll(app);

    const tabs = document.querySelectorAll('#notification-tabs .tab');
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
            const readBtn = e.target.closest('[data-mark-read]');
            if (readBtn) {
                const nid = parseInt(readBtn.dataset.markRead, 10);
                try {
                    await app.api.put('/notifications/read', { ids: [nid] });
                    const item = readBtn.closest('.notification-item');
                    if (item) item.classList.remove('notification-unread');
                    readBtn.remove();
                    updateBadge(app);
                } catch (err) {
                    console.error('Mark read error:', err);
                }
                return;
            }

            const dismissBtn = e.target.closest('[data-dismiss]');
            if (dismissBtn) {
                const nid = parseInt(dismissBtn.dataset.dismiss, 10);
                try {
                    await app.api.delete(`/notifications/${nid}`);
                    const item = dismissBtn.closest('.notification-item');
                    if (item) item.remove();
                    updateBadge(app);
                } catch (err) {
                    console.error('Dismiss error:', err);
                }
                return;
            }

            const taskBtn = e.target.closest('[data-open-task]');
            if (taskBtn) {
                const taskId = parseInt(taskBtn.dataset.openTask, 10);
                document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId } }));
            }
        });
    }
}
