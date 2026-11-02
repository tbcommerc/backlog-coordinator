import { descriptionList, sectionCard } from '../ui/detailComponents.js';
import { dataTable, tableCell } from '../ui/dataTable.js';
import { field, tabs, badge, button, filterChip } from '../ui/primitives.js';
import { mountTabs } from '../ui/controls.js';
import { escapeHtml as esc } from '../htmlUtils.js';
import { renderViewState } from './viewState.js';
import { formatErrorMessage } from '../uiFeedback.js';
import { workPager, workDate } from './workUi.js?v=2';

const sections = [{id:'about',label:'Обзор'},{id:'backlog',label:'Задачи'},{id:'execution',label:'Рабочие задачи'},{id:'metrics',label:'Метрики'}];
const bucketNames = {all:'Все сроки',1:'I квартал',2:'II квартал',3:'III квартал',4:'IV квартал',annual:'Год без квартала',unplanned:'Без определённого периода'};
const resultNames = {work:'Рабочие задачи',backlog:'Выполнение задач бэклога',moves:'Изменения плана',metrics:'Метрики'};
const val = value => esc(value ?? '—');
const empty = message => renderViewState({title:'Нет доступных записей',message});
const projectStatusBadge = status => badge({label:status||'Статус не указан',tone:String(status||'').trim().toLowerCase()==='активен'?'success':'neutral'});
const note = text => `<p class="project-note">${text}</p>`;

export async function initProjectWorkspace(app, mountExecution) {
    const root = document.getElementById('work-projects-page');
    const body = root.querySelector('#work-project-body');
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const id = Number(params.get('project'));
    const live = () => root.isConnected;
    const href = changes => {
        const next = new URLSearchParams(id ? location.hash.split('?')[1] || '' : params);
        next.delete('task');
        for (const [key,value] of Object.entries(changes)) value === null || value === '' ? next.delete(key) : next.set(key,String(value));
        return '#/work-projects' + (next.size ? '?' + next : '');
    };
    const link = (label, changes, cls='ui-link') => `<a class="${cls}" href="${esc(href(changes))}">${esc(label)}</a>`;
    const failure = e => renderViewState({kind:'error',title:'Не удалось загрузить раздел',message:formatErrorMessage(e),actionLabel:'Повторить',actionAttrs:{'data-project-retry':true}});
    let reload;
    body.addEventListener('click', e => { if(e.target.closest('[data-project-retry]'))reload?.(); });
    if (!id) {
        let generation = 0;
        body.innerHTML = `<form class="project-catalog-toolbar">${field({id:'work-project-search',label:'Поиск проекта',type:'search',value:params.get('cq')||'',attrs:{placeholder:'Название или код проекта'}})}<div class="project-catalog-actions">${button({label:'Найти',attrs:{type:'submit'}})}${button({label:'Сбросить',variant:'ghost',attrs:{type:'reset','data-project-reset':true}})}</div><span id="project-search-count" role="status"></span></form><div id="work-project-list"></div>`;
        const form = body.querySelector('form'), list = body.querySelector('#work-project-list');
        const search = form.querySelector('input'), reset = form.querySelector('[data-project-reset]');
        const syncReset = () => { reset.hidden = !search.value && !params.get('cq'); };
        form.oninput = syncReset; syncReset();
        const load = async () => {
            const token = ++generation;
            list.innerHTML = renderViewState({kind:'loading',title:'Загружаем проекты'});
            try {
                const data = await app.api.get('/projects?' + new URLSearchParams({q:params.get('cq')||'',page:params.get('cp')||1}));
                if(!live() || token!==generation)return;
                body.querySelector('#project-search-count').textContent = `Найдено: ${data.total}`;
                list.innerHTML = data.items.length ? `<ul class="project-catalog">${data.items.map(p=>`<li><a class="project-card project-direction-card" href="${esc(href({project:p.id,section:'about'}))}" aria-label="${esc(p.name)}">${projectStatusBadge(p.status)}<span class="project-card-name" title="${esc(p.name)}">${esc(p.name)}</span><p class="project-card-description" title="${esc(p.description||'Описание направления пока не заполнено.')}">${esc(p.description||'Описание направления пока не заполнено.')}</p><span class="project-card-owner" title="Ответственный PL: ${val(p.responsible)}">Ответственный PL: ${val(p.responsible)}</span><span class="project-card-footer">Задач бэклога доступно: ${p.backlog_count}</span></a></li>`).join('')}</ul>${workPager(data.page,data.total,24,'catalog')}` : empty('Измените поиск или уточните название проекта.');
                list.querySelectorAll('[data-page-scope="catalog"]').forEach(b=>b.onclick=()=>{params.set('cp',Math.max(1,data.page+Number(b.dataset.page)));history.replaceState(null,'',href({}));load();});
            } catch(e){if(live()&&token===generation)list.innerHTML=failure(e);}
        };
        form.onsubmit = e => {e.preventDefault();params.set('cq',form.querySelector('input').value.trim());params.delete('cp');history.replaceState(null,'',href({}));syncReset();load();};
        form.onreset = e => {e.preventDefault();search.value='';params.delete('cq');params.delete('cp');history.replaceState(null,'',href({}));syncReset();load();search.focus();};
        // Local draft remains until submit; browser history keeps the applied query.
        reload=load; await load(); return;
    }
    const requestedSection = params.get('section') || (params.has('major') || params.has('scope') ? 'execution' : 'about');
    const section = requestedSection==='planning' ? 'backlog' : requestedSection==='results' && params.get('result')==='metrics' ? 'metrics' : requestedSection;
    const navigation = section==='results' ? [...sections,{id:'results',label:'История результатов'}] : sections;
    if(!navigation.some(x=>x.id===section)){body.innerHTML=renderViewState({title:'Раздел проекта не найден',message:'Откройте обзор проекта.'})+link('О проекте',{section:'about'});return;}
    const yearValue = params.get('year');
    const currentYear = Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Moscow',year:'numeric'}).format(new Date()));
    const year = yearValue ? Number(yearValue) : currentYear;
    let data;
    const load = async () => {
        root.querySelector('.project-return')?.remove();
        body.innerHTML=renderViewState({kind:'loading',title:'Загружаем проект'});
        try {
            data=await app.api.get(`/projects/${id}/workspace?year=${year}`);
            if(!live())return;
            root.querySelector('h1').textContent=data.project.name;
            root.querySelector('.toolbar-subtitle')?.remove();
            body.innerHTML=`<div class="project-return">${link('← Все проекты',{project:null,section:null,major:null,scope:null})}${projectStatusBadge(data.project.status)}</div>${tabs({id:'project',label:'Разделы проекта',items:navigation,selected:section})}${navigation.map(s=>`<section id="project-${s.id}-panel" role="tabpanel" aria-labelledby="project-${s.id}-tab" tabindex="0"${s.id===section?'':' hidden'}></section>`).join('')}`;
            root.querySelector('.ui-page-header').append(body.querySelector('.project-return'));
            mountTabs(body.querySelector('.ui-tabs'), tabId => {location.hash=href({section:tabId.replace(/^project-|\-tab$/g,'')});});
            const host=body.querySelector(`#project-${section}-panel`);
            if(section==='about')about(host);
            if(section==='backlog')await backlog(host);
            if(section==='execution')await mountExecution(app,host);
            if(section==='results'||section==='metrics')await results(host);
        }catch(e){if(live())body.innerHTML=failure(e);}
    };
    function about(host) {
        const p=data.project,w=data.work;
        host.innerHTML=`<div class="project-about">${sectionCard({ title: 'О направлении', level: 2, content: `<p class="project-description">${esc(p.description||'Описание направления пока не заполнено.')}</p>${note('Проект объединяет связанные работы. Состав и ожидаемые результаты уточняются по мере развития бэклога и планирования по кварталам.')}${descriptionList({ className: 'project-passport', items: [{ label: 'Ответственный PL', value: p.responsible }, { label: 'Участвующие команды', value: data.teams.map(t=>t.name).join(', ') || 'Нет доступных работ команд' }] })}${note('Команды определены по доступным вам задачам и метрикам.')}` })}${sectionCard({ title: 'Текущая работа', level: 2, content: `<div class="project-signals">${signal('Задачи бэклога',data.backlog_total,{section:'backlog'})}${signal('Активные рабочие задачи',w.active,{section:'execution'})}${signal('Просрочены',w.overdue,{section:'execution',wa:'overdue'})}${signal('С препятствием',w.blocked,{section:'execution',wa:'blocked'})}${signal('На приёмке',w.in_acceptance,{section:'execution',ws:'in_acceptance'})}${signal('Метрики',data.metrics_total,{section:'metrics',result:null})}</div><details class="project-planning-help"><summary>О показателях</summary>${note('Показатели относятся к доступным вам работам. Просрочки, препятствия и приёмка могут пересекаться; общий процент завершения направления не рассчитывается.')}</details>` })}</div>`;
    }
    function signal(label,count,changes) {return `<a class="project-signal" href="${esc(href({major:null,scope:null,wa:null,ws:null,wview:null,wq:null,wt:null,wu:null,wdir:null,wpriority:null,wperiod:null,wp:null,...changes}))}"><span>${esc(label)}</span><strong>${count}</strong></a>`;}
    function yearField(){return field({id:'project-year',label:'Год',type:'number',value:year,attrs:{min:2000,max:2099,step:1,required:true}});}
    const taskLink = row => link((row.public_id||'TASK-'+row.id)+' · '+row.title,{task:row.id});
    function taskTable(items) { return dataTable({ label: 'Задачи бэклога проекта', rows: items, responsive: 'cards', density: 'compact', tableClassName: 'project-backlog-table', columns: [
        { key: 'task', label: 'Задача', render: taskLink },
        { key: 'team', label: 'Команда / ответственный', render: r => tableCell({ value: r.team, secondary: r.owner }) },
        { key: 'deadline', label: 'Период' },
        { key: 'status', label: 'Статус', render: r => badge({ label: r.status || 'Не указан' }) },
        { key: 'priority', label: 'Приоритет' },
    ] }); }

    async function backlog(host) {
        const bucket=params.get('bucket')||'all';
        host.innerHTML=`${section==='backlog'?`<h2>Задачи проекта</h2><div class="project-plan-grid">${Object.entries(bucketNames).filter(([k])=>k!=='all').map(([k,label])=>`${filterChip({label:k==='annual'?'Без квартала':k==='unplanned'?'Без периода':label,count:data.plan[k],selected:bucket===k,className:'project-plan-card',attrs:{'data-project-bucket':k,title:label}})}`).join('')}</div>`:'<h2>Бэклог проекта</h2>'}<form class="project-data-filters">${yearField()}${field({id:'project-bucket',label:'Период задач',kind:'select',value:bucket,options:Object.entries(bucketNames).map(([value,label])=>({value,label}))})}${field({id:'project-backlog-state',label:'Состояние',kind:'select',value:params.get('bstate')||'all',options:[{value:'all',label:'Все задачи'},{value:'active',label:'Активные'},{value:'closed',label:'Закрытые'}]})}${field({id:'project-backlog-search',label:'Поиск задач бэклога',type:'search',value:params.get('bq')||'',attrs:{placeholder:'Название или TASK-ID'}})}${button({label:'Применить',attrs:{type:'submit'}})}</form><details class="project-planning-help"><summary>Как устроен план</summary>${note('Годовые задачи без квартала показаны отдельно. Задача с несколькими кварталами входит в каждый из них. «Все сроки» включает все годы; выбранный год ограничивает квартал или годовой горизонт. План можно пересматривать через карточку задачи с учётом ваших прав.')}</details><div class="project-data-result"></div>`;
        host.querySelectorAll('[data-project-bucket]').forEach(control=>control.onclick=()=>{location.hash=href({bucket:control.dataset.projectBucket,bp:null});});
        const form=host.querySelector('form');
        form.onsubmit=e=>{e.preventDefault();location.hash=href({year:form.querySelector('#project-year').value,bucket:form.querySelector('#project-bucket').value,bstate:form.querySelector('#project-backlog-state').value,bq:form.querySelector('#project-backlog-search').value.trim(),bp:null});};
        const result=host.querySelector('.project-data-result');
        result.innerHTML=renderViewState({kind:'loading',title:'Загружаем задачи бэклога'});
        try{
            const rows=await app.api.get(`/projects/${id}/backlog?`+new URLSearchParams({year,bucket,q:params.get('bq')||'',state:params.get('bstate')||'all',page:params.get('bp')||1}));
            if(!live())return;
            result.innerHTML=note(`Найдено задач: ${rows.total}`)+(rows.items.length?taskTable(rows.items):empty('В этой выборке нет задач. Измените период, состояние или поиск.'))+workPager(rows.page,rows.total,30,'backlog');
            result.querySelectorAll('[data-page-scope="backlog"]').forEach(b=>b.onclick=()=>{location.hash=href({bp:Math.max(1,rows.page+Number(b.dataset.page))});});
        }catch(e){if(live())result.innerHTML=failure(e);}
    }
    async function results(host) {
        const kind=section==='metrics'?'metrics':params.get('result')||'work',quarter=params.get('quarter')||'0';
        host.innerHTML=`<h2>${section==='metrics'?'Метрики проекта':'История результатов'}</h2><form class="project-data-filters">${yearField()}${field({id:'project-quarter',label:section==='metrics'?'Период метрик':'Период результатов',kind:'select',value:quarter,options:[{value:0,label:'Весь год'},...[1,2,3,4].map(q=>({value:q,label:q+' квартал'}))]})}${section==='metrics'?'':field({id:'project-result-kind',label:'Показать результаты',kind:'select',value:kind,options:Object.entries(resultNames).map(([value,label])=>({value,label}))})}${button({label:'Показать',attrs:{type:'submit'}})}</form><div class="project-data-result"></div>`;
        const form=host.querySelector('form');
        form.onsubmit=e=>{e.preventDefault();location.hash=href({year:form.querySelector('#project-year').value,quarter:form.querySelector('#project-quarter').value,result:section==='metrics'?null:form.querySelector('#project-result-kind').value,rp:null});};
        const result=host.querySelector('.project-data-result');
        result.innerHTML=renderViewState({kind:'loading',title:'Загружаем результаты'});
        try{
            const rows=await app.api.get(`/projects/${id}/results?`+new URLSearchParams({year,quarter,kind,page:params.get('rp')||1}));
            if(!live())return;
            const explanations={work:'Рабочие задачи, которые сейчас выполнены и имеют дату завершения в выбранном периоде. Повторно открытые задачи сюда не входят.',backlog:'Зафиксированные переходы задач бэклога в статус «Выполнена» за период. Повторное выполнение отражается отдельным событием; текущий статус может отличаться.',moves:'Изменения срока из истории задач за период. Причина переноса отдельно не фиксировалась: её можно уточнить в комментариях и истории карточки.',metrics:'Периоды метрик, пересекающие выбранный интервал. Факт — последний замер не позже конца интервала и сегодняшнего дня; «До периода» — последний замер до его начала. Цель и состояние периода показаны в текущей редакции.'};
            let content=empty('Нет доступных записей за выбранный период. Отсутствие записей не подтверждает отсутствие работы: старые события могли не фиксироваться.');
            if(rows.items.length){
                const columns=kind==='metrics'?['Метрика / период','До периода','Факт','Цель','Дата замера']:kind==='moves'?['Задача','Дата изменения','Было','Стало']:['Задача','Дата',kind==='work'?'Результат':'Событие'];
                const cells = r => {
                    const task=kind==='work'?`<a class="ui-link" href="#/work-tasks/${r.id}">WRK-${r.id} · ${esc(r.title)}</a>`:taskLink(r);
                    return kind==='metrics'?[`<a class="ui-link" href="#/metrics/${r.id}">${esc(r.title)}</a><br>${esc(r.period)}`,val(r.previous_fact),val(r.summary.fact)+' '+esc(r.unit),r.direction==='range'?`${val(r.target)}–${val(r.upper)} ${esc(r.unit)}`:val(r.target)+' '+esc(r.unit),workDate(r.summary.measured_on)]:kind==='moves'?[task,workDate(r.changed_at),esc(r.before),esc(r.after)]:[task,workDate(r.completed_at||r.changed_at),kind==='work'?esc(r.result||'Результат не описан'):'Переход в «Выполнена»'];
                };
                content=dataTable({ label: resultNames[kind], rows: rows.items.map(cells), responsive: 'cards', density: 'compact', tableClassName: 'project-backlog-table', columns: columns.map((label,i)=>({ key: String(i), label, render: r => tableCell({ markup: r[i] }) })) });
            }
            result.innerHTML=note(explanations[kind]+' Принадлежность проекту и доступность проверяются на текущий момент.')+note(`Записей: ${rows.total}`)+content+workPager(rows.page,rows.total,30,'results');
            result.querySelectorAll('[data-page-scope="results"]').forEach(b=>b.onclick=()=>{location.hash=href({rp:Math.max(1,rows.page+Number(b.dataset.page))});});
        }catch(e){if(live())result.innerHTML=failure(e);}
    }
    reload=load;await load();
}
