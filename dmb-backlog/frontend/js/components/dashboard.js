/**
 * DMB Backlog - Dashboard Component
 * Personalized by role: Team mode (PO/PL/IT PL) vs Tribe mode (ЛТ)
 */

function getStatus(t) {
    return t.status_name || t.status || '';
}

function getDeadline(t) {
    return t.deadline_name || t.deadline || '';
}

function isActiveStatus(s) {
    return ['СБОР ТРЕБОВАНИЙ', 'ПРОВЕРКА ТРЕБОВАНИЙ', 'УТОЧНЕНИЕ ТРЕБОВАНИЙ', 'ЭКСПРЕСС-ОЦЕНКА', 'ПРИНЯТИЕ РЕШЕНИЯ', 'ПРИНЯТА В РАБОТУ'].includes(s);
}

function isAttentionStatus(s) {
    return ['СБОР ТРЕБОВАНИЙ', 'ЭКСПРЕСС-ОЦЕНКА', 'ХОЛД', 'ЭСКАЛАЦИЯ НА ЛТ', 'УТОЧНЕНИЕ ТРЕБОВАНИЙ', 'ПРОВЕРКА ТРЕБОВАНИЙ'].includes(s);
}

function isRiskStatus(s) {
    return s === 'ХОЛД' || s === 'ЭСКАЛАЦИЯ НА ЛТ' || s === 'ОТКЛОНЕНА';
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

const NOTIF_CAT_ICONS = {
    risk: 'alert-triangle', deadline: 'clock', status_change: 'refresh-cw',
    assignment: 'user-plus', mention: 'at-sign', comment: 'message-circle',
    express: 'zap', stale: 'timer', attrs: 'file-text', system: 'info',
};

const NOTIF_CAT_COLORS = {
    risk: '#f43f5e', deadline: '#f59e0b', status_change: '#6366f1',
    assignment: '#10b981', mention: '#a855f7', comment: '#3b82f6',
    express: '#f59e0b', stale: '#64748b', attrs: '#64748b', system: '#64748b',
};

const STATUS_COLORS = {
    'НОВАЯ ЗАДАЧА': '#64748b', 'НАЗНАЧЕНА КОМАНДА': '#64748b',
    'СБОР ТРЕБОВАНИЙ': '#6366f1', 'ПРОВЕРКА ТРЕБОВАНИЙ': '#818cf8',
    'УТОЧНЕНИЕ ТРЕБОВАНИЙ': '#a5b4fc', 'ЭКСПРЕСС-ОЦЕНКА': '#8b5cf6',
    'ПРИНЯТИЕ РЕШЕНИЯ': '#f59e0b', 'ПРИНЯТА В РАБОТУ': '#10b981',
    'ЭСКАЛАЦИЯ НА ЛТ': '#f43f5e', 'ХОЛД': '#f97316',
    'ОТКЛОНЕНА': '#ef4444', 'НЕ АКТУАЛЬНА': '#94a3b8',
    'ВЫПОЛНЕНА': '#22c55e',
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

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function animateCounter(el, target, duration = 600) {
    if (!el || target === 0) { if (el) el.textContent = '0'; return; }
    const start = performance.now();
    const from = 0;
    function tick(now) {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(from + (target - from) * eased);
        if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
}

function formatMoney(val) {
    if (val == null) return '—';
    if (val >= 1e9) return (val / 1e9).toFixed(1) + ' млрд';
    if (val >= 1e6) return (val / 1e6).toFixed(1) + ' млн';
    if (val >= 1e3) return (val / 1e3).toFixed(0) + ' тыс';
    return val.toFixed(0);
}

function isTribeRole(user) {
    return ['ЛТ', 'Администратор'].includes(user?.role_name);
}

function isMyTask(task, user) {
    return task.owner_id === user?.id || task.responsible_po_id === user?.id;
}

function statCard(id, icon, gradient, label, animDelay) {
    return `
        <div class="dash-stat-card ${gradient} animate-slide-up" style="animation-delay:${animDelay}s">
            <div class="dash-stat-icon"><i data-lucide="${icon}"></i></div>
            <div class="dash-stat-body">
                <div class="dash-stat-value" id="${id}">0</div>
                <div class="dash-stat-label">${label}</div>
            </div>
        </div>`;
}

// ==================== QUARTER BAR (shared) ====================

function renderQuarterBar() {
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
    const expressPos = Math.min(100, Math.max(0, Math.round((Math.round((expressDate - qStart) / 86400000) / totalDays) * 100)));

    const pipDate = new Date(qEnd);
    pipDate.setDate(pipDate.getDate() - 7);
    const pipPos = Math.min(100, Math.max(0, Math.round((Math.round((pipDate - qStart) / 86400000) / totalDays) * 100)));

    return `
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
                    <div class="dash-quarter-marker" style="left:${expressPos}%;">
                        <span class="dash-marker-dot"></span>
                        <span class="dash-marker-label">Начало экспресс-оценки</span>
                    </div>
                    <div class="dash-quarter-marker dash-quarter-marker-pip" style="left:${pipPos}%;">
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
                            return `<span class="dash-month-line" style="left:${pos}%;"></span>`;
                        }).join('')}
                    </div>
                    <div class="dash-month-labels">
                        ${qMonths.map((m, i) => {
                            const pos = ((i + 0.5) / qMonths.length) * 100;
                            return `<span class="dash-month-label" style="left:${pos}%;">${m}</span>`;
                        }).join('')}
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

// ==================== NOTIFICATIONS WIDGET ====================

function renderNotificationsWidget() {
    return `
    <div class="widget notif-risk-col">
        <div class="widget-header">
            <div class="stat-icon" style="width:44px;height:44px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--accent-light);color:var(--accent);">
                <i data-lucide="bell" style="width:20px;height:20px;"></i>
            </div>
            <h3>Уведомления</h3>
            <a href="#/notifications" class="btn btn-ghost btn-sm">Все →</a>
        </div>
        <div class="widget-body" id="dash-notif-body" style="padding:var(--space-2);">
            <p class="text-muted text-center" style="padding:var(--space-6);">Загрузка...</p>
        </div>
    </div>`;
}

function renderRisksWidget() {
    return `
    <div class="widget notif-risk-col">
        <div class="widget-header">
            <div class="stat-icon" style="width:44px;height:44px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--danger-light);color:var(--danger);">
                <i data-lucide="alert-triangle" style="width:20px;height:20px;"></i>
            </div>
            <h3>Топ рисков</h3>
        </div>
        <div class="widget-body" id="top-risks" style="padding:var(--space-2);">
            <p class="text-muted text-center" style="padding:var(--space-6);">Загрузка...</p>
        </div>
    </div>`;
}

// ==================== TEAM MODE ====================

function renderTeamDashboard(app) {
    const user = app.store.get('currentUser');
    const teamName = user?.team_name || '';

    return `
    <div class="page-header animate-fade-in">
        <h1>Добрый день, ${user?.name?.split(' ')[0] || 'Гость'}</h1>
        <p>${teamName ? 'Команда: ' + teamName : 'Обзор ваших задач'}</p>
    </div>

    ${renderQuarterBar()}

    <div class="dashboard-stats">
        ${statCard('stat-total', 'inbox', 'dash-gradient-blue', 'Всего задач', 0.1)}
        ${statCard('stat-active', 'play-circle', 'dash-gradient-green', 'В работе', 0.15)}
        ${statCard('stat-risk', 'alert-triangle', 'dash-gradient-red', 'Под риском', 0.2)}
        ${statCard('stat-no-est', 'help-circle', 'dash-gradient-amber', 'Без оценки', 0.25)}
    </div>

    <div class="dash-two-col">
        <div class="dash-col-main">
            <div class="widget">
                <div class="widget-header">
                    <div class="stat-icon" style="width:44px;height:44px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--warning-light);color:var(--warning);">
                        <i data-lucide="zap" style="width:20px;height:20px;"></i>
                    </div>
                    <h3>Требуют внимания</h3>
                    <span class="dash-attention-count" id="dash-attention-count"></span>
                </div>
                <div class="widget-body" id="dash-attention-body" style="padding:var(--space-2);">
                    <p class="text-muted text-center" style="padding:var(--space-6);">Загрузка...</p>
                </div>
            </div>

            <div class="widget" style="margin-top:var(--space-5);">
                <div class="widget-header">
                    <div class="stat-icon" style="width:44px;height:44px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--info-light);color:var(--info);">
                        <i data-lucide="bar-chart-2" style="width:20px;height:20px;"></i>
                    </div>
                    <h3>Статусы команды</h3>
                </div>
                <div class="widget-body" id="dash-status-bar-body">
                    <p class="text-muted text-center" style="padding:var(--space-4);">Загрузка...</p>
                </div>
            </div>
        </div>

        <div class="dash-col-side">
            ${renderNotificationsWidget()}
            ${renderRisksWidget()}
        </div>
    </div>`;
}

async function initTeamDashboard(app) {
    const user = app.store.get('currentUser');
    const teamId = user?.team_id;

    const tasksResp = await app.api.get(`/tasks?per_page=1000${teamId ? '&team_id=' + teamId : ''}`);
    const tasks = tasksResp.items || [];

    const total = tasks.length;
    const active = tasks.filter(t => isActiveStatus(getStatus(t))).length;
    const risk = tasks.filter(t => isRiskStatus(getStatus(t)) || (getStatus(t) === 'ПРИНЯТА В РАБОТУ' && (t.progress || 0) < 50)).length;
    const noEst = tasks.filter(t => !['ВЫПОЛНЕНА', 'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА'].includes(getStatus(t)) && t.effort_days == null && t.effort_rub == null).length;

    animateCounter(document.getElementById('stat-total'), total);
    animateCounter(document.getElementById('stat-active'), active);
    animateCounter(document.getElementById('stat-risk'), risk);
    animateCounter(document.getElementById('stat-no-est'), noEst);

    renderAttentionList(tasks, user);
    renderStatusBar(tasks);
    await renderNotifications();
    renderRisks(tasks, teamId);
}

function renderAttentionList(tasks, user) {
    const el = document.getElementById('dash-attention-body');
    const countEl = document.getElementById('dash-attention-count');
    if (!el) return;

    const attention = tasks
        .filter(t => !['ВЫПОЛНЕНА', 'ОТКЛОНЕНА', 'НЕ АКТУАЛЬНА'].includes(getStatus(t)))
        .filter(t => isMyTask(t, user) || isAttentionStatus(getStatus(t)))
        .sort((a, b) => {
            const urgency = { 'ЭСКАЛАЦИЯ НА ЛТ': 0, 'ХОЛД': 1, 'ЭКСПРЕСС-ОЦЕНКА': 2, 'СБОР ТРЕБОВАНИЙ': 3, 'УТОЧНЕНИЕ ТРЕБОВАНИЙ': 3, 'ПРОВЕРКА ТРЕБОВАНИЙ': 3 };
            return (urgency[getStatus(a)] ?? 9) - (urgency[getStatus(b)] ?? 9);
        })
        .slice(0, 5);

    if (countEl && attention.length > 0) {
        countEl.textContent = attention.length;
    }

    if (attention.length === 0) {
        el.innerHTML = '<div class="dash-empty-state"><i data-lucide="check-circle-2" style="width:32px;height:32px;color:var(--success);margin-bottom:var(--space-2);"></i><p>Всё под контролем!</p></div>';
        if (window.lucide) window.lucide.createIcons({ attrs: { 'data-lucide': '' }, nameAttr: 'data-lucide' });
        return;
    }

    el.innerHTML = attention.map(t => {
        const borderColor = isRiskStatus(getStatus(t)) ? 'var(--danger)' : 'var(--warning)';
        const icon = isRiskStatus(getStatus(t)) ? 'alert-triangle' : 'clock';
        return `
        <div class="dash-attention-item" data-task-id="${t.id}" style="border-left:3px solid ${borderColor};">
            <div class="dash-attention-icon" style="background:${borderColor}15;color:${borderColor};">
                <i data-lucide="${icon}" style="width:16px;height:16px;"></i>
            </div>
            <div class="dash-attention-body">
                <div class="dash-attention-title">#${t.id} ${escapeHtml(t.title)}</div>
                <div class="dash-attention-meta">${renderStatus(getStatus(t))}${getDeadline(t) ? ' · ' + getDeadline(t) : ''}</div>
            </div>
        </div>`;
    }).join('');

    el.addEventListener('click', (e) => {
        const item = e.target.closest('.dash-attention-item[data-task-id]');
        if (item?.dataset.taskId) {
            document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: parseInt(item.dataset.taskId) } }));
        }
    });

    if (window.lucide) window.lucide.createIcons({ attrs: { 'data-lucide': '' }, nameAttr: 'data-lucide' });
}

function renderStatusBar(tasks) {
    const el = document.getElementById('dash-status-bar-body');
    if (!el) return;

    const statusCounts = {};
    tasks.forEach(t => {
        const s = getStatus(t) || 'НОВАЯ ЗАДАЧА';
        statusCounts[s] = (statusCounts[s] || 0) + 1;
    });

    const total = tasks.length || 1;
    const sorted = Object.entries(statusCounts).sort((a, b) => b[1] - a[1]);

    el.innerHTML = `
        <div class="dash-stacked-bar">
            ${sorted.map(([status, count]) => {
                const pct = Math.round((count / total) * 100);
                const color = STATUS_COLORS[status] || '#64748b';
                return `<div class="dash-stacked-seg" style="width:${pct}%;background:${color};" title="${status}: ${count}"></div>`;
            }).join('')}
        </div>
        <div class="dash-stacked-legend">
            ${sorted.map(([status, count]) => {
                const color = STATUS_COLORS[status] || '#64748b';
                return `<div class="dash-legend-item"><span class="dash-legend-dot" style="background:${color};"></span>${status} <span class="dash-legend-count">${count}</span></div>`;
            }).join('')}
        </div>`;
}

// ==================== TRIBE MODE ====================

function renderTribeDashboard(app) {
    const user = app.store.get('currentUser');

    return `
    <div class="page-header animate-fade-in">
        <h1>Добрый день, ${user?.name?.split(' ')[0] || 'Гость'}</h1>
        <p>Лидер трайба · Обзор всех команд</p>
    </div>

    ${renderQuarterBar()}

    <div class="dashboard-stats dash-stats-6">
        ${statCard('stat-total', 'inbox', 'dash-gradient-blue', 'Всего задач', 0.1)}
        ${statCard('stat-active', 'play-circle', 'dash-gradient-green', 'В работе', 0.15)}
        ${statCard('stat-risk', 'alert-triangle', 'dash-gradient-red', 'Под риском', 0.2)}
        ${statCard('stat-key', 'star', 'dash-gradient-violet', 'Ключевые', 0.25)}
        ${statCard('stat-money', 'banknote', 'dash-gradient-amber', 'Фин. эффект', 0.3)}
        ${statCard('stat-progress', 'trending-up', 'dash-gradient-teal', 'Ср. прогресс', 0.35)}
    </div>

    <div class="dash-two-col">
        <div class="dash-col-main">
            <div class="dash-grid-2">
                <div class="widget">
                    <div class="widget-header">
                        <div class="stat-icon" style="width:44px;height:44px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--accent-light);color:var(--accent);">
                            <i data-lucide="pie-chart" style="width:20px;height:20px;"></i>
                        </div>
                        <h3>Здоровье портфеля</h3>
                    </div>
                    <div class="widget-body">
                        <div class="dash-donut-wrap">
                            <canvas id="dash-donut-chart" height="220"></canvas>
                        </div>
                    </div>
                </div>

                <div class="widget">
                    <div class="widget-header">
                        <div class="stat-icon" style="width:44px;height:44px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--success-light);color:var(--success);">
                            <i data-lucide="trending-up" style="width:20px;height:20px;"></i>
                        </div>
                        <h3>Топ по C/V</h3>
                    </div>
                    <div class="widget-body" id="dash-cv-top" style="padding:var(--space-2);">
                        <p class="text-muted text-center" style="padding:var(--space-4);">Загрузка...</p>
                    </div>
                </div>
            </div>

            <div class="widget" style="margin-top:var(--space-5);">
                <div class="widget-header">
                    <div class="stat-icon" style="width:44px;height:44px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--info-light);color:var(--info);">
                        <i data-lucide="users" style="width:20px;height:20px;"></i>
                    </div>
                    <h3>Прогресс по командам</h3>
                </div>
                <div class="widget-body" id="dash-team-progress">
                    <p class="text-muted text-center" style="padding:var(--space-4);">Загрузка...</p>
                </div>
            </div>

            <div class="dash-grid-2" style="margin-top:var(--space-5);">
                <div class="widget">
                    <div class="widget-header">
                        <div class="stat-icon" style="width:44px;height:44px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--danger-light);color:var(--danger);">
                            <i data-lucide="alert-triangle" style="width:20px;height:20px;"></i>
                        </div>
                        <h3>Топ рисков</h3>
                    </div>
                    <div class="widget-body" id="top-risks" style="padding:var(--space-2);">
                        <p class="text-muted text-center" style="padding:var(--space-4);">Загрузка...</p>
                    </div>
                </div>

                <div class="widget">
                    <div class="widget-header">
                        <div class="stat-icon" style="width:44px;height:44px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--warning-light);color:var(--warning);">
                            <i data-lucide="zap" style="width:20px;height:20px;"></i>
                        </div>
                        <h3>Требуют внимания</h3>
                        <span class="dash-attention-count" id="dash-attention-count"></span>
                    </div>
                    <div class="widget-body" id="dash-attention-body" style="padding:var(--space-2);">
                        <p class="text-muted text-center" style="padding:var(--space-4);">Загрузка...</p>
                    </div>
                </div>
            </div>
        </div>

        <div class="dash-col-side">
            ${renderNotificationsWidget()}
        </div>
    </div>`;
}

async function initTribeDashboard(app) {
    const [tasksResp, stats, teamsResp] = await Promise.all([
        app.api.get('/tasks?per_page=1000'),
        app.api.get('/tasks/stats'),
        app.api.get('/teams'),
    ]);

    const tasks = tasksResp.items || [];
    const teams = teamsResp.items || [];
    app.store?.set('_teams', teams);

    animateCounter(document.getElementById('stat-total'), stats.total);
    animateCounter(document.getElementById('stat-active'), stats.active);
    animateCounter(document.getElementById('stat-risk'), stats.risk);
    animateCounter(document.getElementById('stat-key'), stats.key_projects);
    animateCounter(document.getElementById('stat-progress'), Math.round(stats.avg_progress));

    const moneyEl = document.getElementById('stat-money');
    if (moneyEl) {
        const target = Math.round(stats.total_financial_effect);
        const start = performance.now();
        function tick(now) {
            const progress = Math.min((now - start) / 800, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            moneyEl.textContent = formatMoney(target * eased);
            if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    renderDonutChart(stats.by_status);
    renderCvTop(tasks);
    renderTeamProgress(stats.by_team);
    renderAttentionList(tasks, app.store.get('currentUser'));
    renderRisks(tasks, null);
    await renderNotifications();
}

function renderDonutChart(byStatus) {
    const canvas = document.getElementById('dash-donut-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = Object.keys(byStatus);
    const data = Object.values(byStatus);
    const colors = labels.map(s => STATUS_COLORS[s] || '#64748b');

    new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: 'var(--bg-secondary)',
                hoverOffset: 6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: 'var(--text-secondary)',
                        font: { size: 11, family: 'Inter' },
                        padding: 10,
                        usePointStyle: true,
                        pointStyleWidth: 10,
                        generateLabels(chart) {
                            const ds = chart.data.datasets[0];
                            return chart.data.labels.map((label, i) => ({
                                text: `${label} (${ds.data[i]})`,
                                fillStyle: ds.backgroundColor[i],
                                strokeStyle: ds.backgroundColor[i],
                                pointStyle: 'circle',
                                index: i,
                            }));
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label(ctx) {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = Math.round((ctx.parsed / total) * 100);
                            return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
                        }
                    }
                }
            }
        },
        plugins: [{
            id: 'centerText',
            beforeDraw(chart) {
                const { ctx, width, height } = chart;
                const total = chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
                ctx.save();
                ctx.font = 'bold 28px Inter';
                ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#1e293b';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(total, width / 2, height / 2 - 8);
                ctx.font = '12px Inter';
                ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#94a3b8';
                ctx.fillText('задач', width / 2, height / 2 + 14);
                ctx.restore();
            }
        }]
    });
}

function renderCvTop(tasks) {
    const el = document.getElementById('dash-cv-top');
    if (!el) return;

    const withCv = tasks
        .filter(t => t.financial_effect != null && t.effort_rub != null && t.effort_rub > 0)
        .map(t => ({ ...t, cv: Math.round((t.financial_effect / t.effort_rub) * 100) / 100 }))
        .sort((a, b) => b.cv - a.cv);

    const high = withCv.filter(t => t.cv >= 1).slice(0, 3);
    const low = withCv.filter(t => t.cv < 1).slice(-3).reverse();

    if (high.length === 0 && low.length === 0) {
        el.innerHTML = '<p class="text-muted text-center" style="padding:var(--space-4);">Нет данных для расчёта C/V</p>';
        return;
    }

    el.innerHTML = `
        ${high.length > 0 ? `
            <div class="dash-cv-section">
                <div class="dash-cv-section-title"><i data-lucide="trending-up" style="width:14px;height:14px;color:var(--success);"></i> Высокий C/V</div>
                ${high.map(t => `
                    <div class="dash-cv-item" data-task-id="${t.id}" style="cursor:pointer;">
                        <div class="dash-cv-body">
                            <div class="dash-cv-title">#${t.id} ${escapeHtml(t.title).substring(0, 35)}${t.title?.length > 35 ? '…' : ''}</div>
                            <div class="dash-cv-meta">${t.team_name || ''}</div>
                        </div>
                        <div class="dash-cv-value dash-cv-high">${t.cv.toFixed(1)}x</div>
                    </div>
                `).join('')}
            </div>
        ` : ''}
        ${low.length > 0 ? `
            <div class="dash-cv-section">
                <div class="dash-cv-section-title"><i data-lucide="trending-down" style="width:14px;height:14px;color:var(--danger);"></i> Низкий C/V</div>
                ${low.map(t => `
                    <div class="dash-cv-item" data-task-id="${t.id}" style="cursor:pointer;">
                        <div class="dash-cv-body">
                            <div class="dash-cv-title">#${t.id} ${escapeHtml(t.title).substring(0, 35)}${t.title?.length > 35 ? '…' : ''}</div>
                            <div class="dash-cv-meta">${t.team_name || ''}</div>
                        </div>
                        <div class="dash-cv-value dash-cv-low">${t.cv.toFixed(2)}x</div>
                    </div>
                `).join('')}
            </div>
        ` : ''}
    `;

    el.addEventListener('click', (e) => {
        const item = e.target.closest('.dash-cv-item[data-task-id]');
        if (item?.dataset.taskId) {
            document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: parseInt(item.dataset.taskId) } }));
        }
    });

    if (window.lucide) window.lucide.createIcons({ attrs: { 'data-lucide': '' }, nameAttr: 'data-lucide' });
}

function renderTeamProgress(byTeam) {
    const el = document.getElementById('dash-team-progress');
    if (!el) return;

    const teams = Object.entries(byTeam)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.active - a.active);

    if (teams.length === 0) {
        el.innerHTML = '<p class="text-muted text-center" style="padding:var(--space-4);">Нет данных</p>';
        return;
    }

    el.innerHTML = teams.map(t => {
        const pct = Math.round(t.avg_progress || 0);
        const barColor = pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--danger)';
        return `
        <div class="dash-team-row">
            <div class="dash-team-name">${t.name}</div>
            <div class="dash-team-bar-wrap">
                <div class="dash-team-bar">
                    <div class="dash-team-bar-fill" style="width:${pct}%;background:${barColor};"></div>
                </div>
            </div>
            <div class="dash-team-val">${pct}%</div>
            <div class="dash-team-count">${t.active} / ${t.total}</div>
        </div>`;
    }).join('');
}

// ==================== SHARED WIDGETS ====================

async function renderNotifications() {
    const notifBody = document.getElementById('dash-notif-body');
    if (!notifBody) return;
    try {
        const notifData = await window.app?.api?.get('/notifications?per_page=5');
        const items = notifData?.items || [];
        if (items.length === 0) {
            notifBody.innerHTML = '<p class="text-muted text-center" style="padding:var(--space-4);">Нет уведомлений</p>';
            return;
        }
        notifBody.innerHTML = items.map(n => {
            const icon = NOTIF_CAT_ICONS[n.category] || 'bell';
            const color = NOTIF_CAT_COLORS[n.category] || '#64748b';
            const time = formatNotifTime(n.created_at);
            return `
            <div class="dash-notif-item" data-task-id="${n.task_id || ''}" ${n.task_id ? 'style="cursor:pointer;"' : ''}>
                <div class="dash-notif-icon" style="background:${color}22;color:${color};">
                    <i data-lucide="${icon}" style="width:16px;height:16px;"></i>
                </div>
                <div class="dash-notif-body">
                    <div class="dash-notif-title">${escapeHtml(n.title)}</div>
                </div>
                <div class="dash-notif-time">${time}</div>
                ${n.task_id ? '<i data-lucide="external-link" style="width:14px;height:14px;flex-shrink:0;color:var(--text-muted);"></i>' : ''}
            </div>`;
        }).join('');
        notifBody.addEventListener('click', (e) => {
            const item = e.target.closest('.dash-notif-item[data-task-id]');
            if (item?.dataset.taskId) {
                document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: parseInt(item.dataset.taskId) } }));
            }
        });
        if (window.lucide) window.lucide.createIcons({ attrs: { 'data-lucide': '' }, nameAttr: 'data-lucide' });
    } catch {
        notifBody.innerHTML = '<p class="text-muted text-center" style="padding:var(--space-4);">Ошибка загрузки</p>';
    }
}

function renderRisks(tasks, teamId) {
    const el = document.getElementById('top-risks');
    if (!el) return;

    const risks = tasks.filter(t => t && t.id && isRiskStatus(getStatus(t)))
        .filter(t => !teamId || t.team_id === teamId);
    const limit = 3;
    const visible = risks.slice(0, limit);
    const extra = risks.length - limit;

    if (!risks.length) {
        el.innerHTML = '<div class="dash-empty-state"><i data-lucide="shield-check" style="width:32px;height:32px;color:var(--success);margin-bottom:var(--space-2);"></i><p>Рисков нет</p></div>';
        if (window.lucide) window.lucide.createIcons({ attrs: { 'data-lucide': '' }, nameAttr: 'data-lucide' });
        return;
    }

    el.innerHTML = `
        ${visible.map(t => `
            <div class="risk-item" data-task-id="${t.id}">
                <div class="risk-icon"><i data-lucide="alert-triangle" style="width:18px;height:18px;"></i></div>
                <div class="risk-body">
                    <div class="risk-title">${escapeHtml(t.title || 'Без названия')}</div>
                    <div class="risk-meta">${renderStatus(getStatus(t))}${getDeadline(t) ? ' · ' + getDeadline(t) : ''}</div>
                </div>
            </div>
        `).join('')}
        ${extra > 0 ? `<a href="#/notifications" class="dash-notif-more">Ещё ${extra}</a>` : ''}
    `;

    el.addEventListener('click', (e) => {
        const item = e.target.closest('.risk-item[data-task-id]');
        if (item?.dataset.taskId) {
            document.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: parseInt(item.dataset.taskId) } }));
        }
    });

    if (window.lucide) window.lucide.createIcons({ attrs: { 'data-lucide': '' }, nameAttr: 'data-lucide' });
}

// ==================== MAIN ====================

export function renderDashboard(app) {
    const user = app.store.get('currentUser');
    if (isTribeRole(user)) {
        return renderTribeDashboard(app);
    }
    return renderTeamDashboard(app);
}

export async function initDashboard(app) {
    try {
        const user = app.store.get('currentUser');

        if (isTribeRole(user)) {
            await initTribeDashboard(app);
        } else {
            await initTeamDashboard(app);
        }

        const { openTaskModal, setOnTaskSaved } = await import('./modal.js');
        setOnTaskSaved(() => initDashboard(app));

    } catch (e) {
        console.error('Dashboard load error:', e);
    }
}
