/**
 * DMB Backlog - Dashboard Component
 * Personalized by role: Team mode (PO/PL/IT PL) vs Tribe mode (ЛТ)
 */

import {
    formatNotificationTime,
    notificationAccessibleLabel,
    notificationActionLabel,
    notificationCategoryMeta,
    notificationImportanceMeta,
    openNotificationTarget,
    recordNotificationUxEvent,
} from '../notificationUtils.js?v=3';
import { canUseReportingStatusWorkspace, reportingStatusHref } from './reportingStatuses.js?v=11';

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTH_NAMES_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const EVENT_TYPE_ICONS = { milestone: 'flag', planned_event: 'calendar-check', cyclic: 'refresh-cw', event: 'circle', pip: 'milestone' };
let notificationStoreUnsubscribe = null;

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

function getQuarter(date) {
    return Math.floor(date.getMonth() / 3) + 1;
}

function getQuarterLabel(q, year) {
    const labels = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' };
    return `${labels[q] || q} кв. ${year}`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
                        <button type="button" data-tl-action="view-month" style="font-size:12px;padding:4px 10px;border-radius:calc(var(--radius-md,8px) - 2px);border:1px solid ${st.view === 'month' ? 'var(--border-color)' : 'transparent'};background:${st.view === 'month' ? 'var(--bg-primary)' : 'transparent'};color:${st.view === 'month' ? 'var(--text-primary)' : 'var(--text-secondary)'};cursor:pointer;font-family:inherit;${st.view === 'month' ? 'box-shadow:0 1px 3px rgba(0,0,0,0.1);' : ''}">Месяц</button>
                        <button type="button" data-tl-action="view-quarter" style="font-size:12px;padding:4px 10px;border-radius:calc(var(--radius-md,8px) - 2px);border:1px solid ${st.view === 'quarter' ? 'var(--border-color)' : 'transparent'};background:${st.view === 'quarter' ? 'var(--bg-primary)' : 'transparent'};color:${st.view === 'quarter' ? 'var(--text-primary)' : 'var(--text-secondary)'};cursor:pointer;font-family:inherit;${st.view === 'quarter' ? 'box-shadow:0 1px 3px rgba(0,0,0,0.1);' : ''}">Квартал</button>
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
                        <button type="button" data-tl-action="view-month" style="font-size:12px;padding:4px 10px;border-radius:calc(var(--radius-md,8px) - 2px);border:1px solid ${st.view === 'month' ? 'var(--border-color)' : 'transparent'};background:${st.view === 'month' ? 'var(--bg-primary)' : 'transparent'};color:${st.view === 'month' ? 'var(--text-primary)' : 'var(--text-secondary)'};cursor:pointer;font-family:inherit;${st.view === 'month' ? 'box-shadow:0 1px 3px rgba(0,0,0,0.1);' : ''}">Месяц</button>
                        <button type="button" data-tl-action="view-quarter" style="font-size:12px;padding:4px 10px;border-radius:calc(var(--radius-md,8px) - 2px);border:1px solid ${st.view === 'quarter' ? 'var(--border-color)' : 'transparent'};background:${st.view === 'quarter' ? 'var(--bg-primary)' : 'transparent'};color:${st.view === 'quarter' ? 'var(--text-primary)' : 'var(--text-secondary)'};cursor:pointer;font-family:inherit;${st.view === 'quarter' ? 'box-shadow:0 1px 3px rgba(0,0,0,0.1);' : ''}">Квартал</button>
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
    <section class="widget dashboard-actions" aria-labelledby="dashboard-actions-title">
        <div class="widget-header">
            <div class="dashboard-widget-icon is-accent">
                <i data-lucide="list-checks"></i>
            </div>
            <div class="dashboard-widget-heading">
                <h2 id="dashboard-actions-title">Требует вашего действия</h2>
                <p>То, что сейчас ждёт ответа или решения</p>
            </div>
            <span class="dashboard-widget-count" id="dash-notif-count" aria-live="polite"></span>
            <a href="#/notifications" class="dashboard-widget-link" aria-label="Все уведомления"><span class="dashboard-link-full">Все уведомления</span><span class="dashboard-link-short" aria-hidden="true">Все</span></a>
        </div>
        <div class="widget-body dashboard-list-body" id="dash-notif-body">
            <p class="dashboard-list-state">Загрузка…</p>
        </div>
    </section>`;
}

const MEETING_META = {
    directorate: { label: 'Директорская оперативка', icon: 'briefcase' },
    did: { label: 'Оперативка ДИД', icon: 'layers' },
    key_projects: { label: 'Встреча по ключевым проектам', icon: 'key-round' },
};

function localDateIso(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseCalendarDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
        ? new Date(`${value}T12:00:00`)
        : null;
}

function relativeDateLabel(value) {
    const date = parseCalendarDate(value);
    if (!date) return '';
    const today = parseCalendarDate(localDateIso());
    const days = Math.round((date - today) / 86400000);
    return new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' }).format(days, 'day');
}

function renderUpcomingDatesWidget() {
    return `
    <section class="widget dashboard-dates" aria-labelledby="dashboard-dates-title">
        <div class="widget-header">
            <div class="dashboard-widget-icon is-neutral"><i data-lucide="calendar-days"></i></div>
            <div class="dashboard-widget-heading">
                <h2 id="dashboard-dates-title">Ближайшие даты</h2>
                <p>Встречи и события календаря</p>
            </div>
        </div>
        <div class="widget-body dashboard-list-body" id="dashboard-dates-body">
            <p class="dashboard-list-state">Загрузка…</p>
        </div>
    </section>`;
}

function renderDashboardShell(app) {
    const user = app.store.get('currentUser');
    return `
    <div class="page-header animate-fade-in dashboard-page-header">
        <h1>${greetingByTime()}, ${escapeHtml(user?.name?.split(' ')[0] || 'Гость')}</h1>
        <p>${escapeHtml(roleLabel(user))}</p>
    </div>
    <div id="timeline-container">${renderTimeline()}</div>
    <div class="dashboard-workspace animate-slide-up">
        ${renderNotificationsWidget()}
        ${renderUpcomingDatesWidget()}
    </div>`;
}

function normalizeMeetingDate(item, app) {
    const meta = MEETING_META[item.kind] || { label: item.title || 'Отчётная встреча', icon: 'calendar-check' };
    const title = item.title || meta.label;
    const context = title.trim().toLocaleLowerCase('ru-RU') === meta.label.trim().toLocaleLowerCase('ru-RU')
        ? 'Отчётная встреча'
        : meta.label;
    return {
        key: `meeting:${item.id}`,
        date: item.scheduled_date,
        title,
        context,
        icon: meta.icon,
        color: 'var(--accent)',
        href: canUseReportingStatusWorkspace(app)
            ? reportingStatusHref({ source: 'dashboard', kind: item.kind, meetingId: item.id })
            : '',
    };
}

function normalizeTimelineDate(item) {
    return {
        key: `timeline:${item.id}`,
        date: item.date,
        title: item.title || 'Событие календаря',
        context: item.project_name || 'Календарь проектов',
        icon: EVENT_TYPE_ICONS[item.event_type] || 'calendar',
        color: item.color || 'var(--text-secondary)',
        href: '',
    };
}

function renderUpcomingDates(items) {
    const body = document.getElementById('dashboard-dates-body');
    if (!body) return;
    if (!items.length) {
        body.innerHTML = '<div class="dashboard-empty"><i data-lucide="calendar-check"></i><div><strong>Ближайших дат нет</strong><span>Новые встречи и события появятся здесь.</span></div></div>';
    } else {
        body.innerHTML = items.map(item => {
            const date = parseCalendarDate(item.date);
            const day = date?.toLocaleDateString('ru-RU', { day: '2-digit' }) || '—';
            const month = date?.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '') || '';
            const weekday = date?.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '') || '';
            const content = `
                <time class="dashboard-date-tile" datetime="${escapeHtml(item.date)}"><strong>${day}</strong><span>${escapeHtml(month)}</span></time>
                <div class="dashboard-date-copy">
                    <div class="dashboard-date-title">${escapeHtml(item.title)}</div>
                    <div class="dashboard-date-meta"><span>${escapeHtml(weekday)}</span><span>${escapeHtml(relativeDateLabel(item.date))}</span><span>${escapeHtml(item.context)}</span></div>
                </div>
                <span class="dashboard-date-icon" style="color:${escapeHtml(item.color)}"><i data-lucide="${escapeHtml(item.icon)}"></i></span>`;
            return item.href
                ? `<a class="dashboard-date-item is-link" href="${escapeHtml(item.href)}">${content}</a>`
                : `<div class="dashboard-date-item">${content}</div>`;
        }).join('');
    }
    try { window.lucide?.createIcons({ attrs: { 'data-lucide': '' }, nameAttr: 'data-lucide' }); } catch (_) {}
}

async function loadUpcomingDates(app) {
    const body = document.getElementById('dashboard-dates-body');
    if (!body) return;
    const today = localDateIso();
    const year = new Date().getFullYear();
    const requests = await Promise.allSettled([
        app.api.get(`/reporting-meetings?include_closed=false&include_completeness=false&date_from=${today}`),
        app.api.get(`/timeline?year=${year}`),
        app.api.get(`/timeline?year=${year + 1}`),
    ]);
    const fulfilled = requests.filter(result => result.status === 'fulfilled');
    if (!fulfilled.length) {
        body.innerHTML = '<div class="dashboard-list-error" role="alert"><span>Не удалось загрузить ближайшие даты</span><button type="button" class="btn btn-secondary btn-sm" data-retry-dashboard-dates>Повторить</button></div>';
        body.querySelector('[data-retry-dashboard-dates]')?.addEventListener('click', () => loadUpcomingDates(app));
        return;
    }
    const meetings = requests[0].status === 'fulfilled' ? (requests[0].value?.items || []) : [];
    const timelineItems = requests.slice(1).flatMap(result => result.status === 'fulfilled' ? (result.value?.items || []) : []);
    const unique = new Map();
    [...meetings.map(item => normalizeMeetingDate(item, app)), ...timelineItems.map(normalizeTimelineDate)]
        .filter(item => item.date && item.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'ru'))
        .forEach(item => {
            const key = `${item.date}|${item.title.trim().toLocaleLowerCase('ru-RU')}`;
            if (!unique.has(key)) unique.set(key, item);
        });
    renderUpcomingDates([...unique.values()].slice(0, 3));
}

async function initTeamDashboard(app) {
    await Promise.all([
        loadTimelineData(app),
        loadUpcomingDates(app),
        renderNotifications(app.notificationStore?.snapshot || null),
    ]);
}

// ==================== SHARED WIDGETS ====================

async function renderNotifications(snapshot = null) {
    const notifBody = document.getElementById('dash-notif-body');
    const notifCount = document.getElementById('dash-notif-count');
    if (!notifBody) return;
    try {
        const notifData = snapshot || await window.app?.notificationStore?.refresh({ source:'dashboard' });
        const candidates = [
            ...(notifData?.action_items || []),
            ...(notifData?.recent_items || []).filter(item => !item.is_read && !item.is_resolved),
        ];
        const seen = new Set();
        const items = candidates.filter(item => {
            const key = item.target?.url || item.action_url || `notification:${item.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return !item.is_resolved;
        }).slice(0, 4);
        if (notifCount) {
            notifCount.textContent = items.length ? String(items.length) : '';
            notifCount.hidden = items.length === 0;
        }
        if (items.length === 0) {
            notifBody.innerHTML = '<div class="dashboard-empty"><i data-lucide="circle-check-big"></i><div><strong>Обязательных действий сейчас нет</strong><span>Можно продолжать работу по текущему плану.</span></div></div>';
            try { window.lucide?.createIcons({ attrs: { 'data-lucide': '' }, nameAttr: 'data-lucide' }); } catch (_) {}
            return;
        }
        notifBody.innerHTML = items.map(n => {
            const { icon, label: category } = notificationCategoryMeta(n.category);
            const { color } = notificationImportanceMeta(n.importance);
            const time = formatNotificationTime(n.created_at);
            const isUnread = !n.is_read && !n.is_resolved;
            return `
            <button type="button" class="dash-notif-item dash-action-item ${isUnread ? 'is-unread' : 'is-read'} importance-${escapeHtml(n.importance || 'low')}" data-notif-id="${n.id}" data-task-id="${n.task_id || ''}" data-category="${escapeHtml(n.category || '')}" data-resolved="false" data-action-url="${encodeURIComponent(n.target?.url || n.action_url || '')}" aria-label="${escapeHtml(notificationAccessibleLabel(n))}">
                <div class="dash-notif-icon" style="background:${color}22;color:${color};">
                    <i data-lucide="${icon}" style="width:16px;height:16px;"></i>
                </div>
                <div class="dash-notif-body">
                    <div class="dash-notif-title-row"><span class="dash-notif-title">${escapeHtml(n.title)}</span>${isUnread ? '<span class="dashboard-unread-dot" aria-label="Новое"></span>' : ''}</div>
                    <div class="dash-notif-meta"><span>${escapeHtml(category)}</span><time datetime="${escapeHtml(n.created_at || '')}">${escapeHtml(time)}</time></div>
                </div>
                <span class="dash-notif-action">${escapeHtml(notificationActionLabel(n))}<i data-lucide="arrow-right" aria-hidden="true"></i></span>
            </button>`;
        }).join('');
        notifBody.onclick = async (e) => {
            const item = e.target.closest('.dash-notif-item[data-notif-id]');
            if (!item) return;
            const notificationId = Number(item.dataset.notifId);
            if (notificationId && item.classList.contains('is-unread')) {
                try { await window.app.api.put('/notifications/read', { ids: [notificationId] }); }
                catch (error) { window.toast?.(window.formatErrorMessage?.(error)||'Не удалось обновить отметку о прочтении','warning'); }
            }
            const notification = {
                task_id: Number(item.dataset.taskId) || null,
                action_url: decodeURIComponent(item.dataset.actionUrl || ''),
                category: item.dataset.category || '',
                is_resolved: item.dataset.resolved === 'true',
            };
            recordNotificationUxEvent(window.app, 'notification_primary_action_clicked', {
                surface:'dashboard', category:notification.category || null,
            });
            openNotificationTarget(window.app, notification, { surface:'dashboard' });
            window.app.notificationStore?.invalidate().catch(() => {});
        };
        if (window.lucide) window.lucide.createIcons({ attrs: { 'data-lucide': '' }, nameAttr: 'data-lucide' });
    } catch (error) {
        const cachedSnapshot = window.app?.notificationStore?.snapshot;
        if (!snapshot && cachedSnapshot) {
            await renderNotifications(cachedSnapshot);
            notifBody.insertAdjacentHTML('afterbegin', '<div class="dash-notif-stale" role="status"><span>Показаны последние полученные действия</span><button type="button" class="btn btn-secondary btn-sm" data-retry-dash-notifications>Обновить</button></div>');
            notifBody.querySelector('[data-retry-dash-notifications]')?.addEventListener('click',()=>renderNotifications());
            return;
        }
        notifBody.innerHTML = `<div class="dash-notif-error" role="alert"><span>${escapeHtml(window.formatErrorMessage?.(error)||'Не удалось загрузить уведомления')}</span><button type="button" class="btn btn-secondary btn-sm" data-retry-dash-notifications>Повторить</button></div>`;
        notifBody.querySelector('[data-retry-dash-notifications]')?.addEventListener('click',()=>renderNotifications());
    }
}

// ==================== MAIN ====================

export function renderDashboard(app) {
    return renderDashboardShell(app);
}

export async function initDashboard(app) {
    try {
        notificationStoreUnsubscribe?.();
        notificationStoreUnsubscribe = app.notificationStore?.subscribe(({ snapshot }) => {
            if (snapshot) renderNotifications(snapshot);
        }) || null;

        await initTeamDashboard(app);

        const { openTaskModal, setOnTaskSaved } = await import('./modal.js?v=92');
        setOnTaskSaved(() => initDashboard(app));

    } catch (e) {
        console.error('Dashboard load error:', e);
    }
}
