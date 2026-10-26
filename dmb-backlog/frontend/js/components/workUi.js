import { pagination } from '../ui/forms.js';
import { badge, button } from '../ui/primitives.js';
import { escapeHtml as esc } from '../htmlUtils.js';

export const WORK_STATUSES = { new: 'Новая', ready: 'К исполнению', in_progress: 'В работе', in_acceptance: 'На приёмке', done: 'Выполнена', cancelled: 'Отменена' };

export function workDate(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : value || 'Не указан';
}

export function workStatus(status, labels) {
    const tones = { done: 'success', in_progress: 'info', in_acceptance: 'warning', cancelled: 'neutral', ready: 'accent' };
    return badge({ label: labels[status] || status, tone: tones[status] || 'neutral' });
}

export function workMetrics(summary, extended = false) {
    const items = [['total', 'Всего', 'neutral'], ...(extended ? [['active', 'В работе', 'info']] : []), ['done', 'Выполнено', 'success'], ['overdue', 'Просрочено', 'danger'], ...(extended ? [['blocked', 'С блокером', 'danger']] : []), ['in_acceptance', 'На приёмке', 'warning'], ...(extended ? [['proposals', 'Предложено командам', 'neutral']] : [])];
    return `<dl class="work-metrics" aria-label="Сводка по текущим условиям">${items.map(([key, label, tone]) => `<div class="work-metric" data-tone="${summary[key] ? tone : 'neutral'}"><dt>${label}</dt><dd>${esc(summary[key] ?? 0)}</dd></div>`).join('')}</dl>`;
}

export function workPager(page, total, size = 30, scope = 'work') {
    if (total <= size) return '';
    return pagination({page,pages:Math.ceil(total/size),total,stepMode:true,scope,className:'work-pagination',label:'Страницы списка'});
}

export function focusWorkPager(root, scope, step) {
    const selector = `[data-page-scope="${scope}"]`;
    const same = root.querySelector(`${selector}[data-page="${step}"]:not(:disabled)`);
    (same || root.querySelector(`${selector}:not(:disabled)`))?.focus();
}
