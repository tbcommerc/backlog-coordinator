import { dataTable, tableCell } from '../ui/dataTable.js';
import { setFilterValue } from '../ui/filterValues.js';
import { field, pageHeader, badge } from '../ui/primitives.js';
import { escapeHtml as esc } from '../htmlUtils.js';
import { WORK_STATUSES } from './workUi.js?v=2';
import { renderViewState } from './viewState.js';
import { workDate, workStatus, workMetrics, workPager, focusWorkPager } from './workUi.js?v=2';
import { formatErrorMessage } from '../uiFeedback.js';

export function renderWorkReports() {
    return `<section class="work-page">${pageHeader({title:'Снимок задач встречи',actions:'<div class="work-actions"><a class="ui-link" href="#/work-tasks?display=summary&view=all">Текущие задачи</a><span id="work-report-date" class="work-report-note"></span></div>'})}<div id="work-report-controls" class="work-panel work-report-controls"></div><div id="work-report-result" aria-live="polite"></div></section>`;
}

export async function initWorkReports(app) {
    const controls = document.getElementById('work-report-controls');
    const root = document.getElementById('work-report-result');
    let generation = 0, report = null;
    const pages = { tasks: 1, obligations: 1 };
    const pageSize = 20;
    function collection(kind) {
        const major = kind === 'obligations';
        const query = controls.querySelector('#work-report-search').value.trim().toLocaleLowerCase('ru');
        const rows = (major ? report.major_items || [] : report.items).filter(x => `${x.public_id || 'WRK-' + x.id} ${x.title}`.toLocaleLowerCase('ru').includes(query));
        pages[kind] = Math.min(pages[kind], Math.max(1, Math.ceil(rows.length / pageSize)));
        const items = rows.slice((pages[kind] - 1) * pageSize, pages[kind] * pageSize);
        const target = root.querySelector(`[data-report-list="${kind}"]`);
        if (!items.length) {
            target.innerHTML = renderViewState({title:query ? 'Ничего не найдено' : major ? 'Задач бэклога нет' : 'Рабочих задач нет',message:query ? 'Измените название или идентификатор в поиске.' : 'В выбранном периоде и команде нет доступных записей.'});
            return;
        }
        const columns = major ? [
            { key: 'task', label: 'Задача бэклога', render: x => `<a class="ui-link work-task-link" href="#/work-reports?task=${x.id}">${esc(x.public_id)} · ${esc(x.title)}</a>` },
            ...[['total','Рабочих задач'],['done','Выполнено'],['overdue','Просрочено'],['blocked','Блокеры'],['in_acceptance','На приёмке'],['external_links','Внешние ссылки']].map(([key,label])=>({ key, label, render: x => { const n=key==='external_links'?x.external_links:x.work[key]; return n && ['overdue','blocked'].includes(key)?badge({label:n,tone:'danger'}):tableCell({value:n??0,type:'number'}); } })),
        ] : [
            { key: 'task', label: 'Рабочая задача', render: x => `<a class="ui-link work-task-link" href="#/work-tasks/${x.id}">WRK-${x.id} · ${esc(x.title)}</a>` },
            { key: 'status', label: 'Статус', render: x => workStatus(x.status,WORK_STATUSES) },
            { key: 'due_date', label: 'Срок', render: x => tableCell({value:workDate(x.due_date)}) },
            { key: 'result', label: 'Результат и блокеры', render: x => `<div class="work-result-text">${x.blocked_reason?`<p class="work-warning">Блокер: ${esc(x.blocked_reason)}</p>`:''}${x.result_text?`<p>${esc(x.result_text)}</p>`:x.blocked_reason?'':'<span class="work-muted">Не указан</span>'}</div>` },
        ];
        target.innerHTML = dataTable({ label: major?'Задачи бэклога':'Рабочие задачи', rows: items, columns, responsive: 'cards', density: 'compact', tableClassName: 'work-report-table' }) + workPager(pages[kind],rows.length,pageSize,kind);
    }
    function lists() { collection('tasks'); if (report.major_summary) collection('obligations'); }
    function render() {
        document.getElementById('work-report-date').textContent = `${report.mode==='snapshot'?'Неизменяемый снимок':'Текущее состояние'} · ${workDate(report.as_of)}`;
        root.innerHTML = `${workMetrics(report.summary,true)}<section class="work-section"><header class="work-section-head"><h2>Рабочие задачи ${badge({label:report.summary.total})}</h2></header><div class="work-panel" data-report-list="tasks"></div></section>${report.major_summary?`<section class="work-section"><header class="work-section-head"><div><h2>Задачи бэклога ${badge({label:report.major_summary.obligations})}</h2><p>С внешними ссылками: ${esc(report.major_summary.with_external_links)}. Статусы внешних задач не загружаются.</p></div></header><div class="work-panel" data-report-list="obligations"></div></section>`:''}<p class="work-report-footnote">Только доступные вам работы. Рабочие задачи и задачи бэклога учитываются отдельно. Финансовые показатели не суммируются.</p>`;
        lists();
    }
    async function load() {
        const token = ++generation;
        document.getElementById('work-report-date').textContent = '';
        root.innerHTML = renderViewState({kind:'loading',title:'Готовим отчёт'});
        const params = new URLSearchParams();
        const team = controls.querySelector('#work-report-team').value;
        const meeting = controls.querySelector('#work-report-meeting').value;
        if (team) params.set('team_id',team);
        if (meeting) params.set('meeting_id',meeting);
        if (meeting && location.hash.startsWith('#/work-reports')) history.replaceState(null,'','#/work-reports?'+params);
        try {
            const data = await app.api.get('/work-reports?' + params);
            if (token !== generation || !root.isConnected) return;
            if (!data.available) { root.innerHTML = renderViewState({kind:'unavailable',title:'Снимок недоступен',message:data.message}); return; }
            report=data; pages.tasks=pages.obligations=1; render();
        } catch (e) {
            if (token===generation && root.isConnected) root.innerHTML = renderViewState({kind:'error',title:'Не удалось загрузить отчёт',message:formatErrorMessage(e),actionLabel:'Повторить',actionAttrs:{'data-retry-report':true}});
        }
    }
    async function init() {
        controls.innerHTML = renderViewState({kind:'loading',title:'Загружаем параметры отчёта'});
        try {
            const [refs,meetings] = await Promise.all([app.api.get('/work-tasks/options'),app.api.get('/reporting-meetings?include_completeness=false')]);
            if (!controls.isConnected) return;
            const list = Array.isArray(meetings)?meetings:(meetings.items || meetings.meetings || []);
            const kinds = {team_weekly:'Недельная встреча команды',tribe_weekly:'Недельная встреча трайба',quarterly:'Квартальная встреча'};
            controls.innerHTML = field({id:'work-report-team',label:'Команда',kind:'select',options:[{value:'',label:'Все доступные команды'},...refs.teams.map(x=>({value:x.id,label:x.name}))]}) + field({id:'work-report-meeting',label:'Период отчёта',kind:'select',options:[{value:'',label:'Текущее состояние'},...list.map(x=>({value:x.id,label:(x.title || kinds[x.kind] || 'Отчётная встреча')+' · '+workDate(x.scheduled_date)}))]});
            const initial = new URLSearchParams(location.hash.split('?')[1] || '');
            if (initial.has('meeting_id')) {
                const select = controls.querySelector('#work-report-meeting');
                if (![...select.options].some(o => o.value === initial.get('meeting_id'))) select.add(new Option('Выбранная встреча',initial.get('meeting_id')));
                controls.querySelector('#work-report-meeting').value = initial.get('meeting_id');
                controls.querySelector('#work-report-meeting option[value=""]')?.remove();
            }
            if (initial.has('team_id')) setFilterValue(controls.querySelector('#work-report-team'),initial.get('team_id'));
            controls.insertAdjacentHTML('beforeend', field({id:'work-report-search',label:'Поиск в отчёте',type:'search',attrs:{placeholder:'Название или идентификатор',title:'Поиск уточняет списки, не изменяя сводные показатели'}}));
            controls.querySelector('#work-report-search').oninput=()=>{if(report && root.querySelector('[data-report-list]')){pages.tasks=pages.obligations=1;lists();}};
            controls.onchange=e=>{if(e.target.matches('select'))load();}; await load();
        } catch(e) {
            if (controls.isConnected) controls.innerHTML=renderViewState({kind:'error',message:formatErrorMessage(e),actionLabel:'Повторить',actionAttrs:{'data-retry-controls':true}});
        }
    }
    controls.onclick=e=>{if(e.target.closest('[data-retry-controls]'))init();};
    root.onclick=e=>{
        if(e.target.closest('[data-retry-report]'))load();
        const pager=e.target.closest('[data-page-scope]');
        if(pager){const kind=pager.dataset.pageScope;pages[kind]+=Number(pager.dataset.page);collection(kind);focusWorkPager(root,kind,pager.dataset.page,pager.dataset.pageAction);}
    };
    await init();
}
