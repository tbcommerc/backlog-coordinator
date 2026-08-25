/**
 * DMB Backlog - Dashboard Component
 * Personalized by role: Team mode (PO/PL/IT PL) vs Tribe mode (ЛТ)
 */

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTH_NAMES_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const EVENT_TYPE_ICONS = { milestone: 'flag', planned_event: 'calendar-check', cyclic: 'refresh-cw', event: 'circle' };

function greetingByTime() {
    const h = new Date().getHours();
    if (h >= 6 && h < 12) return 'Доброе утро';
    if (h >= 12 && h < 18) return 'Добрый день';
    if (h >= 18 && h < 24) return 'Добрый вечер';
    return 'Доброй ночи';
}

function roleLabel(user) {
    return user?.role_name || '';
}

window._tlState = { view: 'quarter', year: new Date().getFullYear(), quarter: Math.floor(new Date().getMonth() / 3) + 1, month: new Date().getMonth() + 1, events: [] };

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
    return ['Лидер трайба', 'Администратор'].includes(user?.role_name);
}

function isMyTask(task, user) {
    return task.owner_id === user?.id;
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

// ==================== TIMELINE ====================

function getTimelineState() { return window._tlState; }

function setTimelineState(partial) {
    window._tlState = { ...window._tlState, ...partial };
}

function normalizeDate(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function getQuarterStart(q, year) {
    return new Date(year, (q - 1) * 3, 1);
}

function getQuarterEnd(q, year) {
    return new Date(year, q * 3, 0);
}

function dayOffset(start, end) {
    return Math.round((end - start) / 86400000);
}

function daysInQuarter(q, year) {
    return dayOffset(getQuarterStart(q, year), getQuarterEnd(q, year)) + 1;
}

function daysIntoQuarter(d) {
    const q = getQuarter(d);
    const start = getQuarterStart(q, d.getFullYear());
    return dayOffset(start, d);
}

function dayPct(d, q, year) {
    const total = daysInQuarter(q, year);
    const offset = daysIntoQuarter(d);
    return Math.min(100, Math.max(0, (offset / total) * 100));
}

function getMonthStart(m, year) {
    return new Date(year, m - 1, 1);
}

function getMonthEnd(m, year) {
    return new Date(year, m, 0);
}

function daysInMonth(m, year) {
    return getMonthEnd(m, year).getDate();
}

function monthDayPct(d, m, year) {
    const total = daysInMonth(m, year);
    const dayNum = d.getDate();
    return Math.min(100, Math.max(0, ((dayNum - 1) / total) * 100));
}

function getMonthLabel(m, year) {
    return MONTH_NAMES[m - 1] + ' ' + year;
}

function renderTimeline() {
    const st = getTimelineState();
    const now = new Date();
    const realToday = normalizeDate(now);
    let today = realToday;

    if (st.view === 'month') {
        const mStart = getMonthStart(st.month, st.year);
        const mEnd = getMonthEnd(st.month, st.year);
        if (today > mEnd) today = normalizeDate(mEnd);
        else if (today < mStart) today = normalizeDate(mStart);
        return renderMonthTimeline(st, today, realToday);
    }
    const qStart = getQuarterStart(st.quarter, st.year);
    const qEnd = getQuarterEnd(st.quarter, st.year);
    if (today > qEnd) today = normalizeDate(qEnd);
    else if (today < qStart) today = normalizeDate(qStart);
    return renderQuarterTimeline(st, today, realToday);
}

function renderQuarterTimeline(st, today, realToday) {
    const qLabel = getQuarterLabel(st.quarter, st.year);
    const qStart = getQuarterStart(st.quarter, st.year);
    const qEnd = getQuarterEnd(st.quarter, st.year);
    const totalDays = daysInQuarter(st.quarter, st.year);
    const elapsed = realToday < qStart ? 0 : Math.min(totalDays, Math.max(0, daysIntoQuarter(today) + (today >= qStart && today <= qEnd ? 1 : 0)));
    const pct = Math.min(100, Math.round((elapsed / totalDays) * 100));
    const inQuarter = realToday >= qStart && realToday <= qEnd;

    const curYear = new Date().getFullYear();
    const minYear = curYear;
    const maxYear = curYear + 1;
    const prevDisabled = st.year === minYear && st.quarter === 1;
    const nextDisabled = st.year === maxYear && st.quarter === 4;

    const monthIndex = (st.quarter - 1) * 3;
    const qMonths = MONTH_NAMES_SHORT.slice(monthIndex, monthIndex + 3);
    const filteredEvents = st.events.filter(e => e.quarter === st.quarter && e.year === st.year);

    function monthLines() {
        return [1, 2].map(i => {
            const pos = (i / qMonths.length) * 100;
            return `<div class="dash-month-line" style="left:${pos}%;height:8px;bottom:auto;top:0;"></div>`;
        }).join('');
    }

    function monthLabels() {
        return qMonths.map((m, i) => {
            const pos = ((i + 0.5) / qMonths.length) * 100;
            return `<div class="dash-month-label" style="left:${pos}%;">${m}</div>`;
        }).join('');
    }

    function dotStyle(color, isPip) {
        const pipRule = isPip ? 'width:10px;height:10px;border-radius:3px;transform:rotate(45deg);' : '';
        const shadow = isPip ? '' : `box-shadow:0 0 0 2px ${color}44, 0 1px 3px rgba(0,0,0,0.15);`;
        return `background:${color};${pipRule}${shadow}`;
    }

    function markersContent() {
        let html = '';
        if (inQuarter) {
            html += `
            <div class="dash-quarter-marker" style="left:${pct}%;z-index:5;">
                <div class="dash-marker-dot" style="background:var(--danger);box-shadow:0 0 0 3px rgba(244,63,94,0.45);width:14px;height:14px;"></div>
                <div class="dash-marker-label" style="color:var(--danger);background:color-mix(in srgb,var(--danger) 10%,transparent);font-weight:700;">Сегодня</div>
            </div>`;
        }
        filteredEvents.forEach(ev => {
            const evDate = new Date(ev.date + 'T00:00:00');
            const pos = dayPct(evDate, st.quarter, st.year);
            const isPip = ev.event_type === 'pip';
            html += `
            <div class="dash-quarter-marker ${isPip ? 'dash-quarter-marker-pip' : ''}" style="left:${pos}%;" title="${escapeHtml(ev.title)}">
                <div class="dash-marker-dot ${isPip ? 'dash-marker-dot-pip' : ''}" style="${dotStyle(ev.color, isPip)}"></div>
                <div class="dash-marker-label ${isPip ? 'dash-marker-label-pip' : ''}" style="color:${ev.color};background:color-mix(in srgb,${ev.color} 10%,transparent);">${escapeHtml(ev.title)}</div>
            </div>`;
        });
        return html;
    }

    function navBtnStyle(disabled) {
        const base = 'flex-shrink:0;width:36px;height:36px;border-radius:50%;border:1px solid var(--border-color);background:var(--bg-primary);display:flex;align-items:center;justify-content:center;';
        if (disabled) return base + 'opacity:0.4;cursor:not-allowed;color:var(--text-muted);';
        return base + 'box-shadow:0 2px 8px rgba(0,0,0,0.12);cursor:pointer;color:var(--text-secondary);';
    }

    return `
    <div class="dash-top-row">
        <div class="dash-quarter-bar">
            <div class="dash-quarter-bar-header">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div class="dash-quarter-bar-info" data-tl-action="today" title="Перейти к текущему периоду" style="cursor:pointer;">
                        <i data-lucide="calendar" style="width:16px;height:16px;"></i>
                        <span>${qLabel}</span>
                        <span class="dash-quarter-bar-sep">·</span>
                        <span class="dash-quarter-bar-days">${elapsed} / ${totalDays} дн.</span>
                        <span class="dash-quarter-bar-sep">·</span>
                        <span class="dash-quarter-bar-pct">${pct}%</span>
                    </div>
                    <div style="display:flex;gap:2px;background:var(--bg-tertiary);border-radius:var(--radius-md,8px);padding:2px;">
                        <button type="button" data-tl-action="view-quarter" style="font-size:12px;padding:4px 10px;border-radius:calc(var(--radius-md,8px) - 2px);border:1px solid ${st.view === 'quarter' ? 'var(--border-color)' : 'transparent'};background:${st.view === 'quarter' ? 'var(--bg-primary)' : 'transparent'};color:${st.view === 'quarter' ? 'var(--text-primary)' : 'var(--text-secondary)'};cursor:pointer;font-family:inherit;${st.view === 'quarter' ? 'box-shadow:0 1px 3px rgba(0,0,0,0.1);' : ''}">Квартал</button>
                        <button type="button" data-tl-action="view-month" style="font-size:12px;padding:4px 10px;border-radius:calc(var(--radius-md,8px) - 2px);border:1px solid ${st.view === 'month' ? 'var(--border-color)' : 'transparent'};background:${st.view === 'month' ? 'var(--bg-primary)' : 'transparent'};color:${st.view === 'month' ? 'var(--text-primary)' : 'var(--text-secondary)'};cursor:pointer;font-family:inherit;${st.view === 'month' ? 'box-shadow:0 1px 3px rgba(0,0,0,0.1);' : ''}">Месяц</button>
                    </div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <button type="button" data-tl-action="prev-quarter" title="Предыдущий квартал" style="${navBtnStyle(prevDisabled)}" ${prevDisabled ? 'disabled' : ''}><i data-lucide="chevron-left" style="width:20px;height:20px;"></i></button>
                <div class="dash-quarter-bar-track-wrap" style="flex:1;min-width:0;">
                    <div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;">
                        ${markersContent()}
                    </div>
                    <div class="dash-quarter-bar-track">
                        <div class="dash-quarter-bar-fill" style="width:${pct}%"></div>
                    </div>
                    <div class="dash-quarter-bar-months">
                        <div class="dash-month-lines">
                            ${monthLines()}
                        </div>
                        <div class="dash-month-labels">
                            ${monthLabels()}
                        </div>
                    </div>
                </div>
                <button type="button" data-tl-action="next-quarter" title="Следующий квартал" style="${navBtnStyle(nextDisabled)}" ${nextDisabled ? 'disabled' : ''}><i data-lucide="chevron-right" style="width:20px;height:20px;"></i></button>
            </div>
        </div>
    </div>`;
}

function renderMonthTimeline(st, today, realToday) {
    const m = st.month;
    const y = st.year;
    const mStart = getMonthStart(m, y);
    const mEnd = getMonthEnd(m, y);
    const totalDays = daysInMonth(m, y);
    const elapsed = realToday < mStart ? 0 : Math.min(totalDays, Math.max(0, today.getDate()));
    const pct = Math.min(100, Math.round((elapsed / totalDays) * 100));
    const inMonth = realToday >= mStart && realToday <= mEnd;

    const curYear = new Date().getFullYear();
    const minYear = curYear;
    const maxYear = curYear + 1;
    const prevDisabled = st.year === minYear && st.month === 1;
    const nextDisabled = st.year === maxYear && st.month === 12;

    const mLabel = getMonthLabel(m, y);
    const filteredEvents = st.events.filter(e => {
        const evDate = new Date(e.date + 'T00:00:00');
        return evDate.getMonth() + 1 === m && evDate.getFullYear() === y;
    });

    function dotStyle(color, isPip) {
        const pipRule = isPip ? 'width:10px;height:10px;border-radius:3px;transform:rotate(45deg);' : '';
        const shadow = isPip ? '' : `box-shadow:0 0 0 2px ${color}44, 0 1px 3px rgba(0,0,0,0.15);`;
        return `background:${color};${pipRule}${shadow}`;
    }

    function markersContent() {
        let html = '';
        if (inMonth) {
            html += `
            <div class="dash-quarter-marker" style="left:${pct}%;z-index:5;">
                <div class="dash-marker-dot" style="background:var(--danger);box-shadow:0 0 0 3px rgba(244,63,94,0.45);width:14px;height:14px;"></div>
                <div class="dash-marker-label" style="color:var(--danger);background:color-mix(in srgb,var(--danger) 10%,transparent);font-weight:700;">Сегодня</div>
            </div>`;
        }
        filteredEvents.forEach(ev => {
            const evDate = new Date(ev.date + 'T00:00:00');
            const pos = monthDayPct(evDate, m, y);
            const isPip = ev.event_type === 'pip';
            html += `
            <div class="dash-quarter-marker ${isPip ? 'dash-quarter-marker-pip' : ''}" style="left:${pos}%;" title="${escapeHtml(ev.title)}">
                <div class="dash-marker-dot ${isPip ? 'dash-marker-dot-pip' : ''}" style="${dotStyle(ev.color, isPip)}"></div>
                <div class="dash-marker-label ${isPip ? 'dash-marker-label-pip' : ''}" style="color:${ev.color};background:color-mix(in srgb,${ev.color} 10%,transparent);">${escapeHtml(ev.title)}</div>
            </div>`;
        });
        return html;
    }

    function navBtnStyle(disabled) {
        const base = 'flex-shrink:0;width:36px;height:36px;border-radius:50%;border:1px solid var(--border-color);background:var(--bg-primary);display:flex;align-items:center;justify-content:center;';
        if (disabled) return base + 'opacity:0.4;cursor:not-allowed;color:var(--text-muted);';
        return base + 'box-shadow:0 2px 8px rgba(0,0,0,0.12);cursor:pointer;color:var(--text-secondary);';
    }

    return `
    <div class="dash-top-row">
        <div class="dash-quarter-bar">
            <div class="dash-quarter-bar-header">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div class="dash-quarter-bar-info" data-tl-action="today" title="Перейти к текущему периоду" style="cursor:pointer;">
                        <i data-lucide="calendar" style="width:16px;height:16px;"></i>
                        <span>${mLabel}</span>
                        <span class="dash-quarter-bar-sep">·</span>
                        <span class="dash-quarter-bar-days">${elapsed} / ${totalDays} дн.</span>
                        <span class="dash-quarter-bar-sep">·</span>
                        <span class="dash-quarter-bar-pct">${pct}%</span>
                    </div>
                    <div style="display:flex;gap:2px;background:var(--bg-tertiary);border-radius:var(--radius-md,8px);padding:2px;">
                        <button type="button" data-tl-action="view-quarter" style="font-size:12px;padding:4px 10px;border-radius:calc(var(--radius-md,8px) - 2px);border:1px solid ${st.view === 'quarter' ? 'var(--border-color)' : 'transparent'};background:${st.view === 'quarter' ? 'var(--bg-primary)' : 'transparent'};color:${st.view === 'quarter' ? 'var(--text-primary)' : 'var(--text-secondary)'};cursor:pointer;font-family:inherit;${st.view === 'quarter' ? 'box-shadow:0 1px 3px rgba(0,0,0,0.1);' : ''}">Квартал</button>
                        <button type="button" data-tl-action="view-month" style="font-size:12px;padding:4px 10px;border-radius:calc(var(--radius-md,8px) - 2px);border:1px solid ${st.view === 'month' ? 'var(--border-color)' : 'transparent'};background:${st.view === 'month' ? 'var(--bg-primary)' : 'transparent'};color:${st.view === 'month' ? 'var(--text-primary)' : 'var(--text-secondary)'};cursor:pointer;font-family:inherit;${st.view === 'month' ? 'box-shadow:0 1px 3px rgba(0,0,0,0.1);' : ''}">Месяц</button>
                    </div>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
                <button type="button" data-tl-action="prev-month" title="Предыдущий месяц" style="${navBtnStyle(prevDisabled)}" ${prevDisabled ? 'disabled' : ''}><i data-lucide="chevron-left" style="width:20px;height:20px;"></i></button>
                <div class="dash-quarter-bar-track-wrap" style="flex:1;min-width:0;">
                    <div style="position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;">
                        ${markersContent()}
                    </div>
                    <div class="dash-quarter-bar-track">
                        <div class="dash-quarter-bar-fill" style="width:${pct}%"></div>
                    </div>
                </div>
                <button type="button" data-tl-action="next-month" title="Следующий месяц" style="${navBtnStyle(nextDisabled)}" ${nextDisabled ? 'disabled' : ''}><i data-lucide="chevron-right" style="width:20px;height:20px;"></i></button>
            </div>
        </div>
    </div>`;
}

function bindTimelineEvents(app) {
    const container = document.getElementById('timeline-container');
    if (!container) return;

    container.removeEventListener('click', window._tlClick);
    window._tlClick = (e) => {
        const btn = e.target.closest('[data-tl-action]');
        if (!btn) return;
        if (btn.disabled) return;
        e.preventDefault();
        const action = btn.dataset.tlAction;
        const st = getTimelineState();

        if (action === 'prev-quarter') {
            if (st.quarter === 1) { st.year--; st.quarter = 4; }
            else { st.quarter--; }
            setTimelineState({ quarter: st.quarter, year: st.year });
        } else if (action === 'next-quarter') {
            if (st.quarter === 4) { st.year++; st.quarter = 1; }
            else { st.quarter++; }
            setTimelineState({ quarter: st.quarter, year: st.year });
        } else if (action === 'prev-month') {
            if (st.month === 1) { st.year--; st.month = 12; }
            else { st.month--; }
            setTimelineState({ month: st.month, year: st.year });
        } else if (action === 'next-month') {
            if (st.month === 12) { st.year++; st.month = 1; }
            else { st.month++; }
            setTimelineState({ month: st.month, year: st.year });
        } else if (action === 'today') {
            const now = new Date();
            setTimelineState({ quarter: getQuarter(now), month: now.getMonth() + 1, year: now.getFullYear() });
        } else if (action === 'view-quarter') {
            setTimelineState({ view: 'quarter' });
        } else if (action === 'view-month') {
            setTimelineState({ view: 'month' });
        }

        loadTimelineData(window.app || app);
    };
    container.addEventListener('click', window._tlClick);
}

async function loadTimelineData(app) {
    const st = getTimelineState();
    const api = (app || window.app).api;
    try {
        let url = `/timeline?year=${st.year}`;
        if (st.view === 'quarter') url += '&quarter=' + st.quarter;
        if (st.view === 'month') url += '&month=' + st.month;
        const resp = await api.get(url);
        st.events = resp.items || [];
    } catch (e) {
        console.error('Timeline load error:', e.status ? `${e.message} (HTTP ${e.status})` : e.message);
    } finally {
        refreshTimeline(app || window.app);
    }
}

function refreshTimeline(app) {
    const container = document.getElementById('timeline-container');
    if (container) {
        container.innerHTML = renderTimeline();
        try { if (window.lucide) window.lucide.createIcons({ attrs: { 'data-lucide': '' }, nameAttr: 'data-lucide' }); } catch (_) {}
        bindTimelineEvents(app);
    }
}

// ==================== NOTIFICATIONS WIDGET ====================

function renderNotificationsWidget() {
    return `
    <div class="widget notif-risk-col">
        <div class="widget-header">
            <div class="stat-icon" style="width:44px;height:44px;border-radius:var(--radius-md);display:flex;align-items:center;justify-content:center;flex-shrink:0;background:var(--accent-light);color:var(--accent);">
                <i data-lucide="bell" style="width:20px;height:20px;"></i>
            </div>
            <h3>Важные уведомления <span class="dash-notif-count" id="dash-notif-count"></span></h3>
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
        <h1>${greetingByTime()}, ${escapeHtml(user?.name?.split(' ')[0] || 'Гость')}</h1>
        <p>${roleLabel(user)}</p>
    </div>

    <div id="timeline-container">${renderTimeline()}</div>

    ${renderNotificationsWidget()}`;
}

async function initTeamDashboard(app) {
    await loadTimelineData(app);
    await renderNotifications();
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
                <div class="dash-attention-meta">${renderStatus(getStatus(t))}${getDeadline(t) ? ' · ' + escapeHtml(getDeadline(t)) : ''}</div>
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
                return `<div class="dash-stacked-seg" style="width:${pct}%;background:${color};" title="${escapeHtml(status)}: ${count}"></div>`;
            }).join('')}
        </div>
        <div class="dash-stacked-legend">
            ${sorted.map(([status, count]) => {
                const color = STATUS_COLORS[status] || '#64748b';
                return `<div class="dash-legend-item"><span class="dash-legend-dot" style="background:${color};"></span>${escapeHtml(status)} <span class="dash-legend-count">${count}</span></div>`;
            }).join('')}
        </div>`;
}

// ==================== TRIBE MODE ====================

function renderTribeDashboard(app) {
    const user = app.store.get('currentUser');

    return `
    <div class="page-header animate-fade-in">
        <h1>${greetingByTime()}, ${escapeHtml(user?.name?.split(' ')[0] || 'Гость')}</h1>
        <p>${escapeHtml(roleLabel(user))}</p>
    </div>

    <div id="timeline-container">${renderTimeline()}</div>

    ${renderNotificationsWidget()}`;
}

async function initTribeDashboard(app) {
    await loadTimelineData(app);
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
                            <div class="dash-cv-meta">${escapeHtml(t.team_name || '')}</div>
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
                            <div class="dash-cv-meta">${escapeHtml(t.team_name || '')}</div>
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
            <div class="dash-team-name">${escapeHtml(t.name)}</div>
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
    const notifCount = document.getElementById('dash-notif-count');
    if (!notifBody) return;
    try {
        const notifData = await window.app?.api?.get('/notifications');
        const allItems = notifData?.items || [];
        if (notifCount) notifCount.textContent = allItems.length;
        const items = allItems.slice(0, 5);
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
                    <div class="risk-meta">${renderStatus(getStatus(t))}${getDeadline(t) ? ' · ' + escapeHtml(getDeadline(t)) : ''}</div>
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

        const { openTaskModal, setOnTaskSaved } = await import('./modal.js?v=90');
        setOnTaskSaved(() => initDashboard(app));

    } catch (e) {
        console.error('Dashboard load error:', e);
    }
}
