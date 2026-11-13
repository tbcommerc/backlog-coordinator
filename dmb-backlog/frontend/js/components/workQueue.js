import { button, icon } from '../ui/primitives.js';
import { avatar } from '../ui/dataDisplay.js';
import { escapeHtml as esc } from '../htmlUtils.js';
import { WORK_STATUSES, workStatus, workDate, workPager } from './workUi.js?v=2';
import { priorityBadge } from './workProductivity.js';

export const workToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });
const active = row => !['done', 'cancelled'].includes(row.status);
export const workIsLate = (row, today = workToday()) => active(row) && !!row.due_date && row.due_date < today;

export function workDueLabel(row, today = workToday()) {
    if (!row.due_date) return 'Без срока';
    if (workIsLate(row, today)) {
        const days = Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(row.due_date + 'T12:00:00Z')) / 86400000);
        return `Просрочено на ${days} д.`;
    }
    if (row.due_date === today && active(row)) return 'Сегодня';
    const tomorrow = new Date(today + 'T12:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
    if (active(row) && row.due_date === tomorrow.toISOString().slice(0,10)) return 'Завтра';
    return new Date(row.due_date+'T12:00:00Z').toLocaleDateString('ru-RU', {day:'numeric',month:'short',...(row.due_date.slice(0,4)!==today.slice(0,4)?{year:'numeric'}:{})});
}

export function workQueueGroup(row, sort = 'attention', today = workToday()) {
    if (sort === 'newest') return 'Сначала новые';
    if (sort === 'priority') return 'По приоритету';
    if (!active(row)) return 'Завершённые';
    if (workIsLate(row, today)) return 'Просроченные';
    if (sort === 'attention') {
        if (row.status === 'in_acceptance') return 'Ожидают приёмки';
        if (!row.assignee_id) return 'Без исполнителя';
        if (['proposed', 'declined'].includes(row.assignment_state)) return 'Нужно решение команды';
    }
    if (!row.due_date) return 'Без срока';
    if (row.due_date === today) return 'Сегодня';
    const end = new Date(today + 'T12:00:00Z');
    end.setUTCDate(end.getUTCDate() + (7 - (end.getUTCDay() || 7)));
    return row.due_date <= end.toISOString().slice(0, 10) ? 'На этой неделе' : 'Позже';
}

export function renderWorkQueue(data, { selectedId = null, sort = 'attention', page = 1, personal = false, userId = null, collapsed = new Set(), grouped = false, activeAttention = new Set() } = {}) {
    const today = workToday(), groups = [];
    // Group the current server page only; do not imply that a group count is a global total.
    for (const row of data.items) {
        const group = grouped ? workQueueGroup(row, sort, today) : '';
        if (groups.at(-1)?.[0] !== group) groups.push([group, []]);
        groups.at(-1)[1].push(row);
    }
    const plural = n => n % 100 >= 11 && n % 100 <= 14 ? 'задач' : n % 10 === 1 ? 'задача' : n % 10 >= 2 && n % 10 <= 4 ? 'задачи' : 'задач';
    const counts = data.summary || {};
    const attention = [['overdue','просрочены']].filter(([key])=>Number.isFinite(counts[key]) && counts[key]>0).map(([key,label])=>`<button type="button" class="btn btn-ghost btn-sm ui-btn work-queue-attention" data-work-quick="${key}" aria-pressed="${activeAttention.has(key)}">${counts[key]} ${key==='overdue' && counts[key]===1?'просрочена':label}</button>`).join('<span aria-hidden="true">·</span>');
    const glyph = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" width="20" height="20" aria-hidden="true">${body}</svg>`;
    const nextIcon = row => glyph(row.status==='ready' ? '<path d="m7 4 14 8-14 8Z"/>' : '<path d="M6 3h9l4 4v14H6Z"/><path d="M14 3v5h5M9 12h7M9 16h5"/>');
    return `<div class="work-panel work-queue-panel${personal?' is-personal-queue':''}"><table class="ui-table ui-table-data work-table work-queue" data-ui-table="registry" data-ui-column-state="work-queue" data-ui-sticky-header="page">
        <caption><div class="work-queue-heading"><strong>${data.total} ${plural(data.total)}</strong><button type="button" class="ui-link work-grouping-toggle" data-work-grouping aria-pressed="${grouped}">${grouped?'Без группировки':'Группировать задачи'}</button><div class="work-queue-attention-list">${attention}</div></div><span class="sr-only">${data.total ? (page-1)*30+1 : 0}–${Math.min(page*30,data.total)} из ${data.total}</span></caption>
        <thead><tr><th scope="col">Задача</th><th scope="col">${personal?'Состояние работы':'Исполнитель'}</th><th scope="col">Срок</th><th scope="col">Статус</th><th scope="col"><span class="sr-only">Меню</span></th></tr></thead>
        ${[...groups].map(([group, rows]) => `<tbody>${grouped?`<tr class="work-queue-group"><th scope="rowgroup" colspan="5"><button type="button" class="ui-surface-action work-group-toggle" data-work-group="${esc(group)}" aria-expanded="${!collapsed.has(group)}" aria-label="${esc(group)}: ${rows.length} на этой странице">${esc(group)} <span class="work-group-count">${rows.length}</span><span aria-hidden="true">${collapsed.has(group)?'Показать':'Скрыть'}</span></button></th></tr>`:''}${rows.map(row => {
            const note = active(row) && row.assignment_state === 'proposed' ? 'Ожидает принятия командой'
                : active(row) && row.assignment_state === 'declined' ? 'Назначение отклонено'
                : '';
            const nextActor = row.next_step?.actor_name || (row.status === 'in_acceptance' ? row.acceptor_name : row.assignee_name);
            const own = personal && Number(row.assignee_id) === Number(userId);
            return `<tr data-work-row="${row.id}" class="${[Number(row.id) === selectedId?'is-selected':'',own?'is-own-task':''].filter(Boolean).join(' ')}"${collapsed.has(group)?' hidden':''}>
                <td data-label="Задача"><button type="button" class="ui-link work-task-link ui-table-title" title="${esc(row.title)}" data-work-id="${row.id}" aria-label="${esc(row.public_id)} · ${esc(row.title)}" aria-pressed="${Number(row.id) === selectedId}"><span class="work-queue-title">${esc(row.title)}</span></button>
                <div class="work-queue-context ui-table-meta"><span class="work-public-id ui-table-id">${esc(row.public_id)}</span>${row.context?.title ? `<span class="work-context-name" title="${esc(row.context.title)}">${esc(row.context.title)}</span>` : ''}${['high','urgent'].includes(row.priority)||note ? `<span class="work-queue-signals">${['high','urgent'].includes(row.priority)?priorityBadge(row.priority):''}${note ? `<span class="work-queue-note" title="${esc(note)}">${esc(note)}</span>` : ''}</span>` : ''}</div></td>
                <td class="work-queue-person">${personal ? `<div class="work-personal-next">${nextIcon(row)}<div><span>${esc(({new:'Нужна подготовка',ready:'Можно начать',in_progress:'Нужен результат',in_acceptance:'Ожидает приёмки',done:'Выполнена',cancelled:'Отменена'})[row.status])}</span>${nextActor && (row.status==='in_acceptance' || !own) ? `<small>${esc(nextActor)}</small>`:''}</div></div>` : `<div class="work-queue-person-line">${avatar({name:row.assignee_name || '',size:24})}<span class="work-queue-assignee">${esc(row.assignee_name||'Без исполнителя')}</span></div>${row.status==='in_acceptance'?`<span class="work-queue-note">Принимает: ${esc(nextActor||'Не назначен')}</span>`:''}`}</td>
                <td class="work-queue-state"><span tabindex="0" class="work-queue-due ${workIsLate(row, today) ? 'work-warning' : ''}" title="${esc(workDate(row.due_date))}" aria-label="${esc(workDate(row.due_date))}">${workIsLate(row,today)?`${esc(new Date(row.due_date+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'short'}))}<small>${esc(workDueLabel(row,today))}</small>`:esc(workDueLabel(row, today))}</span></td>
                <td class="work-queue-status">${workStatus(row.status)}${row.checklist_progress?.total ? `<span class="work-checklist-summary" title="Чек-лист ${row.checklist_progress.done}/${row.checklist_progress.total}" aria-label="Чек-лист ${row.checklist_progress.done}/${row.checklist_progress.total}">${glyph('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M8 11l2 2 5-5M9 17h6"/>')}<span>${row.checklist_progress.done} из ${row.checklist_progress.total}</span></span>` : ''}</td>
                <td class="work-queue-menu">${button({label:`Действия ${row.public_id}`,icon:'more-horizontal',iconOnly:true,variant:'ghost',attrs:{'data-queue-menu':row.id}})}</td>
            </tr>`;
        }).join('')}</tbody>`).join('')}</table></div><div class="work-queue-footer"><span>${data.total<=30?`${data.total===1?'Показана':'Показаны все'} ${data.total} ${plural(data.total)}`:`${(page-1)*30+1}–${Math.min(page*30,data.total)} из ${data.total}`}</span></div>${workPager(page, data.total)}`;
}
