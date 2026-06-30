/**
 * DMB Backlog - Notifications Component
 */

let notifications = [];
let unreadNotifs = new Set();
let myTab = 'all';
let myTasksAllDone = false;

const TAB_TYPES = {
  all: null,
  overdue: ['overdue', 'deadline'],
  effort: ['effort'],
  update: ['update'],
  attrs: ['attrs'],
};

function updateBadge() {
    const unread = notifications.length - unreadNotifs.size;
    const val = unread > 99 ? '99+' : unread;
    const badge = document.getElementById('notif-badge');
    const sideBadge = document.getElementById('notification-count');
    if (badge) {
        if (unread > 0) { badge.textContent = val; badge.classList.remove('hidden'); }
        else { badge.classList.add('hidden'); }
    }
    if (sideBadge) sideBadge.textContent = val;
    if (window.app && window.app.refreshNotifications) {
        window.app.refreshNotifications();
    }
}



function isRiskStatus(s) {
    return s === 'ХОЛД' || s === 'ЭСКАЛАЦИЯ НА ЛТ';
}

function isActiveStatus(s) {
    return ['СБОР ТРЕБОВАНИЙ', 'ПРОВЕРКА ТРЕБОВАНИЙ', 'УТОЧНЕНИЕ ТРЕБОВАНИЙ', 'ЭКСПРЕСС-ОЦЕНКА', 'ПРИНЯТИЕ РЕШЕНИЯ', 'ПРИНЯТА В РАБОТУ'].includes(s);
}

function formatTime(dateStr) {
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

function getQuarter(date) {
    return Math.floor(date.getMonth() / 3) + 1;
}

function makeNotif(task, type, priority, icon, color, title) {
    let desc = task.description || '';
    if (desc.length > 80) desc = desc.substring(0, 80) + '...';
    if (type === 'overdue') desc = desc || 'Требуется срочное внимание';
    if (type === 'effort') desc = desc || 'Не указаны трудозатраты';
    if (type === 'attrs') desc = desc || 'Заполните описание задачи';
    if (type === 'update') desc = desc || 'Обновите статус задачи';
    if (type === 'deadline') desc = desc || 'Дедлайн истекает в этом квартале';

    return {
        id: `notif-${type}-${task.id}-${Date.now()}`,
        taskId: task.id,
        type,
        priority,
        deadline: task.deadline || null,
        icon,
        color,
        title,
        desc,
        time: formatTime(task.updated_at || task.created_at)
    };
}

function makeSystemNotif(id, type, priority, icon, color, title, desc) {
    return {
        id: `sys-${id}`,
        taskId: null,
        type,
        priority,
        icon,
        color,
        title,
        desc,
        time: ''
    };
}

export function buildSystemNotifications() {
    return [
        makeSystemNotif('did-ops', 'update', 'Важно', 'file-text', 'amber',
            'Заполнить статусы для Оперативки ДИД',
            'Необходимо обновить статусы задач для еженедельной оперативки ДИД'),
        makeSystemNotif('dir-ops', 'update', 'Важно', 'file-text', 'amber',
            'Заполнить статус для Директорской оперативки',
            'Подготовьте статусы ключевых проектов к директорской оперативке'),
        makeSystemNotif('weekly-report', 'attrs', 'Инфо', 'calendar', 'indigo',
            'Подготовить недельный отчёт',
            'Сформируйте отчёт по задачам команды за текущую неделю'),
        makeSystemNotif('review-deadlines', 'deadline', 'Срочно', 'clock', 'rose',
            'Проверить дедлайны на конец квартала',
            'Приближается конец квартала — проверьте сроки выполнения задач'),
    ];
}

let _cachedTeamId = null;
function getCachedTeamId(app) {
    if (_cachedTeamId) return _cachedTeamId;
    const user = app.store?.get('currentUser');
    if (user?.team_id) { _cachedTeamId = user.team_id; return _cachedTeamId; }
    if (user?.team) {
        const teams = app.store?.get('_teams');
        if (teams && Array.isArray(teams)) {
            const ut = teams.find(t => t.name === user.team);
            if (ut) { _cachedTeamId = ut.id; return _cachedTeamId; }
        }
    }
    return null;
}

export function buildNotifications(tasks, app) {
    const teamId = getCachedTeamId(app);
    const now = new Date();
    const currentQuarter = getQuarter(now);
    const currentYear = now.getFullYear();
    const result = [];
    const items = tasks.items || tasks || [];

    items.forEach(task => {
        if (!task || !task.id) return;
        const isMyTeam = teamId && task.team_id === teamId;
        if (!isMyTeam) return;

        if (isRiskStatus(task.status)) {
            result.push(makeNotif(task, 'overdue', 'Срочно', 'alert-triangle', 'rose', `Риск: ${task.title || 'Без названия'}`));
        }

        if (isActiveStatus(task.status) && task.effort_days == null && task.effort_rub == null) {
            result.push(makeNotif(task, 'effort', 'Важно', 'clock', 'amber', `Без оценки: ${task.title || 'Без названия'}`));
        }

        if (isActiveStatus(task.status) && (!task.description || task.description.length < 20)) {
            result.push(makeNotif(task, 'attrs', 'Важно', 'file-text', 'slate', `Нет описания: ${task.title || 'Без названия'}`));
        }

        if (task.status === 'ПРИНЯТА В РАБОТУ' && task.updated_at) {
            const updated = new Date(task.updated_at);
            const daysDiff = Math.floor((now - updated) / 86400000);
            if (daysDiff > 5) {
                result.push(makeNotif(task, 'update', 'Инфо', 'refresh-cw', 'indigo', `Обновить статус: ${task.title || 'Без названия'}`));
            }
        }

        if (task.deadline) {
            const deadline = new Date(task.deadline);
            if (getQuarter(deadline) === currentQuarter && deadline.getFullYear() === currentYear && isActiveStatus(task.status)) {
                result.push(makeNotif(task, 'deadline', 'Срочно', 'calendar', 'rose', `Дедлайн в текущем квартале: ${task.title || 'Без названия'}`));
            }
        }
    });

    return result;
}

function getCounts() {
    const counts = { overdue: 0, effort: 0, update: 0, attrs: 0 };
    notifications.forEach(n => {
        if (n.type === 'overdue' || n.type === 'deadline') counts.overdue++;
        else if (n.type === 'effort') counts.effort++;
        else if (n.type === 'update') counts.update++;
        else if (n.type === 'attrs') counts.attrs++;
    });
    return counts;
}

export function renderNotifications(app) {
    const counts = getCounts();

    return `
    <div class="page-header animate-fade-in">
        <h1>Мои уведомления</h1>
        <p>Автоматические уведомления по вашим задачам</p>
    </div>
    <div class="flex gap-3" style="margin-bottom: var(--space-6);">
        <button class="btn btn-secondary btn-sm" id="mark-all-read">
            <i data-lucide="check-check" style="width:14px;height:14px;"></i>
            Отметить все
        </button>
    </div>
    <div class="kpi-row" style="margin-bottom:24px;">
        <div class="kpi-card grad-rose" data-tab="overdue">
            <div class="kpi-value" id="kpi-overdue">${counts.overdue}</div>
            <div class="kpi-label">Просрочено</div>
        </div>
        <div class="kpi-card grad-amber" data-tab="effort">
            <div class="kpi-value" id="kpi-effort">${counts.effort}</div>
            <div class="kpi-label">Без оценки</div>
        </div>
        <div class="kpi-card grad-indigo" data-tab="update">
            <div class="kpi-value" id="kpi-update">${counts.update}</div>
            <div class="kpi-label">Обновить</div>
        </div>
        <div class="kpi-card grad-slate" data-tab="attrs">
            <div class="kpi-value" id="kpi-attrs">${counts.attrs}</div>
            <div class="kpi-label">Атрибуты</div>
        </div>
    </div>
    <div class="tabs" id="notification-tabs">
        <div class="tab ${myTab === 'all' ? 'active' : ''}" data-type="all">Все <span class="badge badge-info" id="count-all">${notifications.length}</span></div>
        <div class="tab ${myTab === 'overdue' ? 'active' : ''}" data-type="overdue">Просрочено <span class="badge badge-danger" id="count-overdue">${counts.overdue}</span></div>
        <div class="tab ${myTab === 'update' ? 'active' : ''}" data-type="update">Обновить статус <span class="badge badge-info" id="count-update">${counts.update}</span></div>
        <div class="tab ${myTab === 'effort' ? 'active' : ''}" data-type="effort">Трудозатраты <span class="badge badge-warning" id="count-effort">${counts.effort}</span></div>
        <div class="tab ${myTab === 'attrs' ? 'active' : ''}" data-type="attrs">Атрибуты <span class="badge badge-warning" id="count-attrs">${counts.attrs}</span></div>
    </div>
    <div class="card" id="notifications-list">
        <div class="empty-state">
            <div class="empty-state-icon"><i data-lucide="bell-off"></i></div>
            <h3 class="empty-state-title">Все уведомления просмотрены!</h3>
            <p class="empty-state-description">Нет активных уведомлений</p>
        </div>
    </div>
    `;
}

function renderNotificationList() {
    const container = document.getElementById('notifications-list');
    if (!container) return;

    const types = TAB_TYPES[myTab];
    const filtered = notifications.filter(n => {
        if (!types) return true;
        return types.includes(n.type);
    });

    const counts = getCounts();

    const kpiOverdue = document.getElementById('kpi-overdue');
    if (kpiOverdue) kpiOverdue.textContent = counts.overdue;
    const kpiEffort = document.getElementById('kpi-effort');
    if (kpiEffort) kpiEffort.textContent = counts.effort;
    const kpiUpdate = document.getElementById('kpi-update');
    if (kpiUpdate) kpiUpdate.textContent = counts.update;
    const kpiAttrs = document.getElementById('kpi-attrs');
    if (kpiAttrs) kpiAttrs.textContent = counts.attrs;

    document.querySelectorAll('.kpi-row .kpi-card').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === myTab);
    });

    const countAll = document.getElementById('count-all');
    if (countAll) countAll.textContent = notifications.length;
    const countOverdue = document.getElementById('count-overdue');
    if (countOverdue) countOverdue.textContent = counts.overdue;
    const countUpd = document.getElementById('count-update');
    if (countUpd) countUpd.textContent = counts.update;
    const countEff = document.getElementById('count-effort');
    if (countEff) countEff.textContent = counts.effort;
    const countAttr = document.getElementById('count-attrs');
    if (countAttr) countAttr.textContent = counts.attrs;

    if (filtered.length === 0) {
        container.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon"><i data-lucide="bell-off"></i></div>
            <h3 class="empty-state-title">Все уведомления просмотрены!</h3>
            <p class="empty-state-description">Нет активных уведомлений</p>
        </div>
        `;
        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }
        return;
    }

    // Sort: unread first, read (dismissed) last
    const sorted = [...filtered].sort((a, b) => {
        const aRead = unreadNotifs.has(a.id) ? 1 : 0;
        const bRead = unreadNotifs.has(b.id) ? 1 : 0;
        return aRead - bRead;
    });

    updateBadge();
    container.innerHTML = sorted.map(n => {
        const isRead = unreadNotifs.has(n.id);
        const deadlineStr = n.deadline ? `<span style="font-size:10px;color:var(--text-muted);margin-left:8px;">Дедлайн: ${n.deadline}</span>` : '';
        return `
    <div class="flex items-start gap-3 p-3 rounded-lg border border-main notification-item ${isRead ? 'notification-read' : ''}">
        <div class="w-9 h-9 rounded-lg bg-${n.color}-500/10 text-${n.color}-500 flex items-center justify-center shrink-0">
            <i data-lucide="${n.icon}" class="w-4 h-4"></i>
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-0.5">
                <span class="font-semibold text-sm text-main">${n.title}</span>
                <span class="badge">${n.priority}</span>
            </div>
            <div class="text-xs text-muted">${n.desc}</div>
            <div class="text-xs text-muted mt-1">${n.time}${deadlineStr}</div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
            ${n.taskId
                ? `<button data-task-id="${n.taskId}" class="btn-secondary px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1 shrink-0" title="Открыть задачу">
            <i data-lucide="external-link" class="w-3 h-3"></i></button>`
                : ''}
            ${isRead
                ? `<button data-revert="${n.id}" class="btn-ghost px-2 py-1.5 text-xs rounded-lg flex items-center gap-1 shrink-0" title="Вернуть в непрочитанные">
                <i data-lucide="rotate-ccw" class="w-3 h-3"></i>
            </button>`
                : `<button data-dismiss="${n.id}" class="btn-ghost px-2 py-1.5 text-xs rounded-lg flex items-center gap-1 shrink-0 notification-dismiss-btn" title="Отметить прочитанным">
                <i data-lucide="check" class="w-3 h-3"></i>
            </button>`}
        </div>
    </div>`;
    }).join('');

    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
}

function setMyTab(tab) {
    myTab = tab;
    const tabs = document.querySelectorAll('#notification-tabs .tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.type === tab));
    renderNotificationList();
}

function markAllDone() {
    myTasksAllDone = true;
    notifications.forEach(n => unreadNotifs.add(n.id));
    renderNotificationList();
    if (window.app && window.app.refreshNotifications) {
        setTimeout(() => window.app.refreshNotifications(), 100);
    }
}

function openTaskFromNotif(taskId, app) {
    if (app && app.emit) {
        app.emit('open-task', { taskId });
    } else {
        const event = new CustomEvent('open-task', { detail: { taskId } });
        document.dispatchEvent(event);
    }
}

export async function initNotifications(app) {
    try {
        const [tasks, teams] = await Promise.all([
            app.api.get('/tasks?per_page=1000'),
            app.api.get('/teams')
        ]);
        app.store?.set('_teams', teams.items || []);
        _cachedTeamId = null;
        const auto = buildNotifications(tasks, app);
        const system = buildSystemNotifications();
        notifications = [...system, ...auto];

        window.__getNotifUnreadCount = () => notifications.length - unreadNotifs.size;

        const container = document.getElementById('notifications-list');
        if (container) {
            container.innerHTML = '';
        }

        renderNotificationList();

        const tabs = document.querySelectorAll('#notification-tabs .tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                setMyTab(tab.dataset.type);
            });
        });

        document.querySelectorAll('.kpi-row .kpi-card').forEach(card => {
            card.addEventListener('click', () => {
                setMyTab(card.dataset.tab);
            });
        });

        const markBtn = document.getElementById('mark-all-read');
        if (markBtn) {
            markBtn.addEventListener('click', markAllDone);
        }

        const notifList = document.getElementById('notifications-list');
        if (notifList) {
            notifList.addEventListener('click', (e) => {
                const dismissBtn = e.target.closest('[data-dismiss]');
                if (dismissBtn) {
                    const nid = dismissBtn.dataset.dismiss;
                    unreadNotifs.add(nid);
                    renderNotificationList();
                    if (window.app && window.app.refreshNotifications) {
                        setTimeout(() => window.app.refreshNotifications(), 100);
                    }
                    return;
                }
                const revertBtn = e.target.closest('[data-revert]');
                if (revertBtn) {
                    const nid = revertBtn.dataset.revert;
                    unreadNotifs.delete(nid);
                    renderNotificationList();
                    if (window.app && window.app.refreshNotifications) {
                        setTimeout(() => window.app.refreshNotifications(), 100);
                    }
                    return;
                }
                const taskBtn = e.target.closest('[data-task-id]');
                if (taskBtn) {
                    const taskId = parseInt(taskBtn.dataset.taskId, 10);
                    openTaskFromNotif(taskId, app);
                }
            });
        }
    } catch (e) {
        console.error('Notifications load error:', e);
    }
}
