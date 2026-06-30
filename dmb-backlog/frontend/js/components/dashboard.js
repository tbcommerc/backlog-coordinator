import { buildNotifications, buildSystemNotifications } from './notifications.js';

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

function renderStatus(status) {
    const statusClass = status ? status.replace(/\s+/g, '_') : 'backlog';
    const colors = {
        'НОВАЯ_ЗАДАЧА': 'badge-status-backlog',
        'НАЗНАЧЕНА_КОМАНДА': 'badge-status-backlog',
        'СБОР_ТРЕБОВАНИЙ': 'badge-status-backlog',
        'ПРОВЕРКА_ТРЕБОВАНИЙ': 'badge-status-backlog',
        'УТОЧНЕНИЕ_ТРЕБОВАНИЙ': 'badge-status-backlog',
        'ЭКСПРЕСС-ОЦЕНКА': 'badge-status-backlog',
        'ПРИНЯТИЕ_РЕШЕНИЯ': 'badge-status-review',
        'ПРИНЯТА_В_РАБОТУ': 'badge-status-in_progress',
        'ЭСКАЛАЦИЯ_НА_ЛТ': 'badge-status-on_hold',
        'ХОЛД': 'badge-status-on_hold',
        'ОТКЛОНЕНА': 'badge-danger',
        'НЕ_АКТУАЛЬНА': 'badge-low',
        'ВЫПОЛНЕНА': 'badge-status-done'
    };
    return `<span class="badge ${colors[statusClass] || 'badge-status-backlog'}">${status || 'СБОР ТРЕБОВАНИЙ'}</span>`;
}

function getQuarter(date) {
    return Math.floor(date.getMonth() / 3) + 1;
}

function getQuarterLabel(q, year) {
    const labels = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
    return `${labels[q] || q} кв. ${year}`;
}

const notifColors = { rose: '#f43f5e', amber: '#f59e0b', indigo: '#6366f1', slate: '#64748b' };

// ==================== RENDER ====================

export function renderDashboard(app) {
    const now = new Date();
    const q = getQuarter(now);
    const year = now.getFullYear();
    const qStart = new Date(year, (q - 1) * 3, 1);
    const qEnd = new Date(year, q * 3, 0);
    const totalDays = Math.round((qEnd - qStart) / 86400000) + 1;
    const elapsed = Math.round((now - qStart) / 86400000);
    const pct = Math.min(100, Math.round((elapsed / totalDays) * 100));
    const qLabel = getQuarterLabel(q, year);

    const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    const qMonthIndex = (q - 1) * 3;
    const qMonths = monthNames.slice(qMonthIndex, qMonthIndex + 3);

    const expressDate = new Date(qEnd);
    expressDate.setDate(expressDate.getDate() - 40);
    const expressDaysFromStart = Math.round((expressDate - qStart) / 86400000);
    const expressPos = Math.min(100, Math.max(0, Math.round((expressDaysFromStart / totalDays) * 100)));

    const pipDate = new Date(qEnd);
    pipDate.setDate(pipDate.getDate() - 7);
    const pipDaysFromStart = Math.round((pipDate - qStart) / 86400000);
    const pipPos = Math.min(100, Math.max(0, Math.round((pipDaysFromStart / totalDays) * 100)));

    return `
    <div class="page-header animate-fade-in">
        <h1>Добрый день, ${app.store.get('currentUser')?.name?.split(' ')[0] || 'Гость'}</h1>
        <p>Обзор текущего состояния бэклога</p>
    </div>

    <div class="dash-top-row">
        <div class="dash-quarter-bar">
            <div class="dash-quarter-bar-header">
                <div class="dash-quarter-bar-info">
                    <i data-lucide="calendar" style="width:14px;height:14px;"></i>
                    <span>${qLabel}</span>
                    <span class="dash-quarter-bar-sep">·</span>
                    <span class="dash-quarter-bar-days">${elapsed} / ${totalDays} дн.</span>
                    <span class="dash-quarter-bar-sep">·</span>
                    <span class="dash-quarter-bar-pct">${pct}%</span>
                </div>
            </div>
            <div class="dash-quarter-bar-track-wrap">
                <div class="dash-quarter-bar-markers-top">
                    <div class="dash-quarter-marker" style="left: ${expressPos}%;">
                        <span class="dash-marker-dot"></span>
                        <span class="dash-marker-label">Начало экспресс-оценки</span>
                    </div>
                    <div class="dash-quarter-marker dash-quarter-marker-pip" style="left: ${pipPos}%;">
                        <span class="dash-marker-dot dash-marker-dot-pip"></span>
                        <span class="dash-marker-label dash-marker-label-pip">PIP</span>
                    </div>
                </div>
                <div class="dash-quarter-bar-track">
                    <div class="dash-quarter-bar-fill" style="width:${pct}%"></div>
                </div>
                <div class="dash-quarter-bar-months">
                    <div class="dash-month-lines">
                        ${qMonths.slice(0, -1).map((_, i) => {
                            const pos = ((i + 1) / qMonths.length) * 100;
                            return `<span class="dash-month-line" style="left: ${pos}%;"></span>`;
                        }).join('')}
                    </div>
                    <div class="dash-month-labels">
                        ${qMonths.map((m, i) => {
                            const pos = ((i + 0.5) / qMonths.length) * 100;
                            return `<span class="dash-month-label" style="left: ${pos}%;">${m}</span>`;
                        }).join('')}
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div class="dashboard-stats">
        <div class="stat-card animate-slide-up" style="animation-delay: 0.1s">
            <div class="stat-icon" style="background: var(--info-light); color: var(--info);">
                <i data-lucide="inbox"></i>
            </div>
            <div class="stat-body">
                <div class="stat-value" id="stat-total"><div class="skeleton skeleton-block w-30" style="height:28px;width:40px;"></div></div>
                <div class="stat-label">Всего задач</div>
            </div>
        </div>
        <div class="stat-card animate-slide-up" style="animation-delay: 0.2s">
            <div class="stat-icon" style="background: var(--success-light); color: var(--success);">
                <i data-lucide="play-circle"></i>
            </div>
            <div class="stat-body">
                <div class="stat-value" id="stat-active"><div class="skeleton skeleton-block w-30" style="height:28px;width:40px;"></div></div>
                <div class="stat-label">В работе</div>
            </div>
        </div>
        <div class="stat-card animate-slide-up" style="animation-delay: 0.3s">
            <div class="stat-icon" style="background: var(--danger-light); color: var(--danger);">
                <i data-lucide="alert-triangle"></i>
            </div>
            <div class="stat-body">
                <div class="stat-value" id="stat-risk"><div class="skeleton skeleton-block w-30" style="height:28px;width:40px;"></div></div>
                <div class="stat-label">Под риском</div>
            </div>
        </div>
        <div class="stat-card animate-slide-up" style="animation-delay: 0.4s">
            <div class="stat-icon" style="background: var(--warning-light); color: var(--warning);">
                <i data-lucide="star"></i>
            </div>
            <div class="stat-body">
                <div class="stat-value" id="stat-key"><div class="skeleton skeleton-block w-30" style="height:28px;width:40px;"></div></div>
                <div class="stat-label">Ключевые проекты</div>
            </div>
        </div>
    </div>

    <div class="notif-risk-row">
            <div class="widget notif-risk-col">
                <div class="widget-header">
                    <div class="stat-icon" style="width:44px;height:44px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--accent-light);color:var(--accent);">
                        <i data-lucide="bell" style="width:20px;height:20px;"></i>
                    </div>
                    <h3>Уведомления</h3>
                    <a href="#/notifications" class="btn btn-ghost btn-sm" style="margin-left:auto;">Все →</a>
                </div>
                <div class="widget-body" id="dash-notif-body" style="padding: var(--space-2);">
                    <p class="text-muted text-center" style="padding: var(--space-6);">Загрузка...</p>
                </div>
            </div>
            <div class="widget notif-risk-col">
                <div class="widget-header">
                    <div class="stat-icon" style="width:44px;height:44px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--danger-light);color:var(--danger);">
                        <i data-lucide="alert-triangle" style="width:20px;height:20px;"></i>
                    </div>
                    <h3>Топ рисков</h3>
                </div>
                <div class="widget-body" id="top-risks" style="padding: var(--space-2);">
                    <p class="text-muted text-center" style="padding: var(--space-6);">Загрузка...</p>
                </div>
            </div>
        </div>
    `;
}

// ==================== INIT ====================

export async function initDashboard(app) {
    try {
        const tasks = await app.api.get('/tasks?per_page=1000');

        // Stats
        const total = tasks.total || tasks.items.length;
        const active = tasks.items.filter(t => isActiveStatus(t.status)).length;
        const risk = tasks.items.filter(t => t.status === 'ХОЛД' || t.status === 'ЭСКАЛАЦИЯ НА ЛТ' || (t.status === 'ПРИНЯТА В РАБОТУ' && (t.progress || 0) < 50)).length;
        const key = tasks.items.filter(t => (t.key_project === true || t.key_project === 'true' || t.key_project === 1 || t.key_project === '1') && t.status !== 'ВЫПОЛНЕНА').length;

        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-active').textContent = active;
        document.getElementById('stat-risk').textContent = risk;
        document.getElementById('stat-key').textContent = key;

        // Teams
        const teamsResp = await app.api.get('/teams');
        const teams = teamsResp.items || [];
        app.store?.set('_teams', teams);

        // Top risks
        const user = app.store.get('currentUser');
        const teamId = user?.team_id;
        const allRisks = (tasks.items || [])
            .filter(t => t && t.id && (t.status === 'ХОЛД' || t.status === 'ЭСКАЛАЦИЯ НА ЛТ' || t.status === 'ОТКЛОНЕНА') && teamId && t.team_id === teamId);
        const risksLimit = 3;
        const risksVisible = allRisks.slice(0, risksLimit);
        const risksExtra = allRisks.length - risksLimit;
        const risksEl = document.getElementById('top-risks');
        if (risksEl) {
            if (!allRisks.length) {
                risksEl.innerHTML = '<p class="text-muted text-center" style="padding: var(--space-4);">Рисков нет</p>';
            } else {
                risksEl.innerHTML = `
                    ${risksVisible.map(t => `
                        <div class="risk-item" data-task-id="${t.id}">
                            <div class="risk-icon"><i data-lucide="alert-triangle" style="width:18px;height:18px;"></i></div>
                            <div class="risk-body">
                                <div class="risk-title">${t.title || 'Без названия'}</div>
                                <div class="risk-meta">${renderStatus(t.status)}${t.deadline ? ' · ' + t.deadline : ''}</div>
                            </div>
                        </div>
                    `).join('')}
                    ${risksExtra > 0 ? `<a href="#/notifications" class="dash-notif-more">Ещё ${risksExtra}</a>` : ''}
                `;
            }
        }

        // Notifications (widget body)
        const allNotifs = [
            ...buildSystemNotifications(),
            ...buildNotifications(tasks, app),
        ];
        const notifsLimit = 3;
        const notifsVisible = allNotifs.slice(0, notifsLimit);
        const notifsExtra = allNotifs.length - notifsLimit;
        const notifBody = document.getElementById('dash-notif-body');
        if (notifBody) {
            if (allNotifs.length === 0) {
                notifBody.innerHTML = '<p class="text-muted text-center" style="padding: var(--space-4);">Нет уведомлений</p>';
            } else {
                notifBody.innerHTML = `
                    ${notifsVisible.map(n => `
                        <div class="dash-notif-item" data-task-id="${n.taskId || ''}" ${n.taskId ? 'style="cursor:pointer;"' : ''}>
                            <div class="dash-notif-icon" style="background:${notifColors[n.color] || '#64748b'}22;color:${notifColors[n.color] || '#64748b'};">
                                <i data-lucide="${n.icon}" style="width:16px;height:16px;"></i>
                            </div>
                            <div class="dash-notif-body">
                                <div class="dash-notif-title">${n.title}</div>
                                <div class="dash-notif-desc">${n.desc}</div>
                            </div>
                            <div class="dash-notif-time">${n.time}</div>
                            ${n.taskId ? '<i data-lucide="external-link" style="width:14px;height:14px;flex-shrink:0;color:var(--text-muted);"></i>' : ''}
                        </div>
                    `).join('')}
                    ${notifsExtra > 0 ? `<a href="#/notifications" class="dash-notif-more">Ещё ${notifsExtra}</a>` : ''}
                `;
                notifBody.addEventListener('click', (e) => {
                    const item = e.target.closest('.dash-notif-item[data-task-id]');
                    if (item && item.dataset.taskId) {
                        document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: parseInt(item.dataset.taskId) } }));
                    }
                });
            }
        }

        // Risk click handlers
        document.getElementById('top-risks')?.addEventListener('click', (e) => {
            const item = e.target.closest('.risk-item[data-task-id]');
            if (item && item.dataset.taskId) {
                document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: parseInt(item.dataset.taskId) } }));
            }
        });

        // Add task modal
        const { openTaskModal, setOnTaskSaved } = await import('./modal.js');
        setOnTaskSaved(() => initDashboard(app));

    } catch (e) {
        console.error('Dashboard load error:', e);
    }
}
