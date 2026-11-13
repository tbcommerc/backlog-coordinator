import { mountRegistryPanel } from '../ui/registryPanel.js';
import { compactPeriod, projectSections, periodFields, periodLinks, applyControls, markDraft, projectEmpty } from './projectUi.js';
import { mountProjectManagement } from './projectManagement.js?v=1';
import { dataTable, tableCell } from '../ui/dataTable.js';
import { field, tabs, badge, button, pageHeader, icon } from '../ui/primitives.js';
import { mountTabs } from '../ui/controls.js';
import { segmentedControl } from '../ui/segmented.js';
import { escapeHtml as esc } from '../htmlUtils.js';
import { renderViewState } from './viewState.js';
import { formatErrorMessage } from '../uiFeedback.js';
import { workPager, workDate } from './workUi.js?v=2';

const sections = projectSections;
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
    const catalogueParams=new URLSearchParams([...params].filter(([key])=>['cq','cp','cteam','cowner','cview'].includes(key)));
    const catalogueHref='#/work-projects'+(catalogueParams.size?'?'+catalogueParams:'');
    const link = (label, changes, cls='ui-link') => `<a class="${cls}" href="${esc(href(changes))}">${esc(label)}</a>`;
    const failure = e => renderViewState({kind:'error',title:'Не удалось загрузить раздел',message:formatErrorMessage(e),actionLabel:'Повторить',actionAttrs:{'data-project-retry':true}});
    let reload;
    body.addEventListener('click', e => { if(e.target.closest('[data-project-retry]'))reload?.(); });
    if (!id) {
        let generation = 0, searchTimer, currentData;
        if(!['cards','table'].includes(params.get('cview')))params.delete('cview');
        root.querySelector('.ui-page-header').outerHTML=pageHeader({title:'Проекты',className:'ui-registry-header',titleAccessory:'<span id="project-search-count" role="status"></span>',actions:`<div class="ui-registry-actions">${segmentedControl({label:'Вид каталога',value:params.get('cview')||'cards',items:[{value:'cards',label:'Карточки',icon:'layout-grid',attrs:{'data-catalog-view':'cards'}},{value:'table',label:'Таблица',icon:'table',attrs:{'data-catalog-view':'table'}}]})}</div>`});
        body.innerHTML = `<form class="project-catalog-toolbar"><div class="project-catalog-search ui-registry-toolbar"><label class="project-catalog-search-field ui-search-field"><span class="sr-only">Поиск проекта</span>${icon('search')}<input id="work-project-search" type="search" class="input ui-control" aria-label="Поиск проекта" placeholder="Название или код проекта" value="${esc(params.get('cq')||'')}"></label><div class="project-catalog-actions">${button({label:'Все фильтры',icon:'sliders-horizontal',attrs:{'data-catalog-filters':true,'aria-expanded':false,'aria-controls':'project-catalog-filters'}})}${button({label:'Сброс',icon:'rotate-ccw',attrs:{type:'reset','data-project-reset':true}})}</div></div><div id="project-catalog-filters" hidden><div class="project-catalog-extra"></div><div class="project-catalog-filter-actions">${button({label:'Отмена',variant:'ghost',attrs:{'data-catalog-cancel':true}})}${button({label:'Применить фильтры',variant:'primary',attrs:{type:'submit'}})}</div></div></form><div class="project-catalog-chips ui-registry-conditions" aria-label="Применённые условия"></div><div id="work-project-list"></div>`;
        const form = body.querySelector('form'), list = body.querySelector('#work-project-list');
        const search = form.querySelector('#work-project-search'), reset = form.querySelector('[data-project-reset]');
        const filterPanel=form.querySelector('#project-catalog-filters'),filterButton=form.querySelector('[data-catalog-filters]');
        const fields=[['cteam','catalog-team','Команда задач бэклога'],['cowner','catalog-owner','Ответственный PL']];
        const closeFilters=()=>{filterPanel.hidden=true;filterButton.setAttribute('aria-expanded','false');filterButton.focus();};
        const restoreFilters=()=>fields.forEach(([key,id])=>{const el=form.querySelector('#'+id);if(el)el.value=params.get(key)||'';});
        const syncReset = () => {
            reset.disabled=!search.value&&!params.get('cq')&&!params.get('cteam')&&!params.get('cowner');
            const active=fields.filter(([key])=>params.get(key));
            filterButton.querySelector('span').textContent='Все фильтры'+(active.length?' · '+active.length:'');
            body.querySelector('.project-catalog-chips').innerHTML=active.map(([key,,label])=>button({label:label+': '+params.get(key),icon:'x',variant:'ghost',size:'small',attrs:{'data-catalog-clear':key,'aria-label':'Снять фильтр: '+label}})).join('');
            window.lucide?.createIcons();
        };
        const applySearch=()=>{clearTimeout(searchTimer);if(!live())return;const q=search.value.trim();if(q===(params.get('cq')||''))return;q?params.set('cq',q):params.delete('cq');params.delete('cp');history.replaceState(null,'',href({}));syncReset();load();};
        search.oninput=()=>{syncReset();clearTimeout(searchTimer);searchTimer=setTimeout(applySearch,350);};
        search.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();applySearch();}};
        filterButton.onclick=()=>{const opening=filterPanel.hidden;restoreFilters();filterPanel.hidden=!opening;filterButton.setAttribute('aria-expanded',String(opening));};
        form.querySelector('[data-catalog-cancel]').onclick=()=>{restoreFilters();closeFilters();};
        filterPanel.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();restoreFilters();closeFilters();}};
        body.querySelector('.project-catalog-chips').onclick=event=>{const key=event.target.closest('[data-catalog-clear]')?.dataset.catalogClear;if(!key)return;params.delete(key);params.delete('cp');history.replaceState(null,'',href({}));restoreFilters();syncReset();load();filterButton.focus();};
        root.querySelectorAll('[data-catalog-view]').forEach(b=>b.onclick=()=>{params.set('cview',b.dataset.catalogView);history.replaceState(null,'',href({}));root.querySelectorAll('[data-catalog-view]').forEach(item=>item.setAttribute('aria-pressed',String(item===b)));if(currentData)renderList(currentData);});
        syncReset();
        const renderList = data => {
            list.innerHTML = data.items.length ? `<ul class="project-catalog">${data.items.map(p=>`<li><a class="project-card project-direction-card" href="${esc(href({project:p.id,section:'about'}))}" aria-label="${esc(p.name)}">${projectStatusBadge(p.status)}<span class="project-card-name" title="${esc(p.name)}">${esc(p.name)}</span><p class="project-card-description" title="${esc(p.description||'Описание направления пока не заполнено.')}">${esc(p.description||'Описание направления пока не заполнено.')}</p><span class="project-card-owner" title="Ответственный PL: ${val(p.responsible||'Не указан')}">Ответственный PL: ${val(p.responsible||'Не указан')}</span><span class="project-card-footer">Задач бэклога доступно: ${p.backlog_count}</span><span class="project-catalog-signals">Просрочено в бэклоге: ${p.overdue??0}<br>Ближайшая веха: ${p.next_milestone?workDate(p.next_milestone):'Не задана'}</span></a></li>`).join('')}</ul>${workPager(data.page,data.total,24,'catalog')}` : empty('Измените поиск или уточните название проекта.');
            if(params.get('cview')==='table'&&data.items.length)list.innerHTML=dataTable({stickyHeader:true,variant:'registry',tableClassName:'project-catalog-table',label:'Каталог проектов',rows:data.items,responsive:'cards',columns:[{key:'name',label:'Проект',render:p=>`<a class="ui-table-title" title="${esc(p.name)}" href="${esc(href({project:p.id,section:'about'}))}">${esc(p.name)}</a>`},{key:'pl',label:'Ответственный PL',render:p=>esc(p.responsible||'Не указан')},{key:'status',label:'Статус',render:p=>projectStatusBadge(p.status)},{key:'count',label:'Задач бэклога',render:p=>String(p.backlog_count)},{key:'overdue',label:'Просрочено в бэклоге',render:p=>String(p.overdue??0)},{key:'milestone',label:'Ближайшая веха',render:p=>p.next_milestone?workDate(p.next_milestone):'Не задана'}]})+workPager(data.page,data.total,24,'catalog');
            list.querySelectorAll('[data-page-scope="catalog"]').forEach(b=>b.onclick=()=>{params.set('cp',Math.max(1,data.page+Number(b.dataset.page)));history.replaceState(null,'',href({}));load();});
        };
        const load = async () => {
            const token = ++generation;
            currentData=null;
            currentData=null;
            list.innerHTML = renderViewState({kind:'loading',title:'Загружаем проекты'});
            try {
                const data = await app.api.get('/projects?' + new URLSearchParams({q:params.get('cq')||'',page:params.get('cp')||1,team:params.get('cteam')||'',owner:params.get('cowner')||''}));
                if(!live() || token!==generation)return;
                const pick=(id,label,key,values)=>field({id,label,kind:'select',value:params.get(key)||'',options:[{value:'',label:'Все'},...(values||[]).map(value=>({value,label:value}))]});
                const draft=filterPanel.hidden?null:Object.fromEntries(fields.map(([key,id])=>[key,form.querySelector('#'+id)?.value]));
                form.querySelector('.ui-reference-pins')?.replaceChildren();
                form.querySelector('.project-catalog-extra').innerHTML=pick('catalog-team','Команда задач бэклога','cteam',data.filter_options?.teams)+pick('catalog-owner','Ответственный PL','cowner',data.filter_options?.owners);
                if(draft)fields.forEach(([key,id])=>{if(draft[key]!=null)form.querySelector('#'+id).value=draft[key];});
                root.querySelector('#project-search-count').textContent = `Найдено: ${data.total}`;
                currentData=data;renderList(data);mountRegistryPanel(root,'projects');
            } catch(e){if(live()&&token===generation)list.innerHTML=failure(e);}
        };
        form.addEventListener('change',event=>{if(event.target.closest('.ui-reference-pins'))form.requestSubmit();});
        form.onsubmit = e => {e.preventDefault();clearTimeout(searchTimer);const q=search.value.trim();q?params.set('cq',q):params.delete('cq');for(const [key,id] of fields){const value=form.querySelector('#'+id)?.value||'';value?params.set(key,value):params.delete(key);}params.delete('cp');history.replaceState(null,'',href({}));closeFilters();syncReset();load();};
        form.onreset = e => {e.preventDefault();clearTimeout(searchTimer);search.value='';for(const key of ['cq','cteam','cowner','cp'])params.delete(key);history.replaceState(null,'',href({}));restoreFilters();syncReset();load();search.focus();};
        reload=load; await load(); return;
    }
    const requestedSection = params.get('section') || (params.has('major') || params.has('scope') ? 'execution' : 'about');
    const section = requestedSection==='planning' ? 'backlog' : requestedSection==='metrics' ? 'results' : requestedSection;
    if(requestedSection==='metrics')params.set('result','metrics');
    const navigation = sections;
    if(!navigation.some(x=>x.id===section)){body.innerHTML=renderViewState({title:'Раздел проекта не найден',message:'Откройте обзор проекта.'})+link('О проекте',{section:'about'});return;}
    const yearValue = params.get('year');
    const currentYear = Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Moscow',year:'numeric'}).format(new Date()));
    const year = yearValue ? Number(yearValue) : currentYear;
    const quarter = params.has('quarter') ? Number(params.get('quarter')) : Math.ceil(Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Moscow',month:'numeric'}).format(new Date()))/3);
    let data;
    const load = async () => {
        const nav=body.querySelector('.project-navigation');
        body.innerHTML=(nav?.outerHTML||'')+renderViewState({kind:'loading',title:'Загружаем проект'});
        try {
            data=await app.api.get(`/projects/${id}/workspace?year=${year}`);
            if(!live())return;
            root.querySelector('h1').textContent=data.project.name;
            root.querySelector('.toolbar-subtitle')?.remove();
            if(data.project.description)root.querySelector('h1').insertAdjacentHTML('afterend',`<p class="toolbar-subtitle project-description">${esc(data.project.description)}</p>`);
            body.innerHTML=`<div class="project-return"><a class="ui-nav-action" href="${esc(catalogueHref)}">Все проекты</a>${projectStatusBadge(data.project.status)}</div><div class="project-navigation"><div class="project-mobile-nav">${field({id:'project-section',label:'Раздел проекта',kind:'select',value:section,options:navigation.map(s=>({value:s.id,label:s.label}))})}</div>${tabs({id:'project',label:'Разделы проекта',items:navigation,selected:section})}</div>${navigation.map(s=>`<section id="project-${s.id}-panel" role="tabpanel" aria-labelledby="project-${s.id}-tab" tabindex="0"${s.id===section?'':' hidden'}></section>`).join('')}`;
            root.querySelector('.ui-page-header .project-return')?.remove();
            root.querySelector('.ui-page-header').append(body.querySelector('.project-return'));
            body.querySelector('#project-section').onchange=e=>{location.hash=href({section:e.target.value});};
            const bc=document.getElementById('breadcrumb-nav');
            if(bc){bc.querySelector('[data-project-crumb]')?.remove();bc.querySelector('.breadcrumb-current')?.insertAdjacentHTML('beforebegin',`<span data-project-crumb><a class="breadcrumb-parent" href="${esc(href({section:'about'}))}">Проект</a><span class="breadcrumb-separator" aria-hidden="true">/</span></span>`);}
            if(root.dataset.restoreFocus){const focus=document.getElementById(root.dataset.restoreFocus);(focus||body.querySelector('[aria-selected="true"]'))?.focus({preventScroll:true});}
            mountTabs(body.querySelector('.ui-tabs'), tabId => {location.hash=href({section:tabId.replace(/^project-|\-tab$/g,'')});});
            const host=body.querySelector(`#project-${section}-panel`);
            if(['about','backlog','gantt','deviations'].includes(section))await mountProjectManagement(app,host,{id,year,quarter,params,href,section,workspace:data});
            if(section==='execution')await mountExecution(app,host);
            if(section==='results')await results(host);
            body.style.minHeight='';
            if(root.dataset.restoreFocus){const focus=document.getElementById(root.dataset.restoreFocus);if(focus&&root.contains(focus))focus.focus({preventScroll:true});}
            const header=root.querySelector('.ui-page-header');
            const size=new ResizeObserver(()=>{if(!live()){size.disconnect();return;}root.style.setProperty('--project-header-height',header.offsetHeight+'px');});size.observe(header);
        }catch(e){if(live())body.innerHTML=failure(e);}
    };
    function yearField(){return field({id:'project-year',label:'Год',type:'number',value:year,attrs:{min:2000,max:2099,step:1,required:true}});}
    const taskLink = row => `<a class="ui-table-title" title="${esc(row.title)}" href="${esc(href({task:row.id}))}">${esc((row.public_id||'TASK-'+row.id)+' · '+row.title)}</a>`;
    async function results(host) {
        const kind=params.get('result')||'work',resultQuarter=params.has('quarter')?params.get('quarter'):String(quarter);
        host.innerHTML=`<div class="project-period-toolbar"><form class="project-data-filters">${periodFields(year,resultQuarter)}${applyControls()}</form>${periodLinks(year,Number(resultQuarter),href)}</div><nav class="project-result-types" aria-label="Виды результатов"></nav><div class="project-data-result"></div>`;
        compactPeriod(host,`${resultQuarter?resultQuarter+' квартал':'Весь год'} ${year}`);
        const form=host.querySelector('form');markDraft(form);
        form.onsubmit=e=>{e.preventDefault();location.hash=href({year:form.querySelector('#project-year').value,quarter:form.querySelector('#project-quarter').value,rp:null});};
        const result=host.querySelector('.project-data-result');
        result.innerHTML=renderViewState({kind:'loading',title:'Загружаем результаты'});
        try{
            const batches=await Promise.all(Object.keys(resultNames).map(async type=>[type,await app.api.get(`/projects/${id}/results?`+new URLSearchParams({year,quarter:resultQuarter,kind:type,page:type===kind?params.get('rp')||1:1}))]));
            const byKind=Object.fromEntries(batches),rows=byKind[kind];
            host.querySelector('.project-result-types').innerHTML=Object.entries(resultNames).map(([type,label])=>`<a class="project-result-type${type===kind?' is-current':''}" ${type===kind?'aria-current="page"':''} href="${esc(href({result:type,rp:null}))}">${esc(label)} <strong>${byKind[type].total}</strong></a>`).join('');
            if(!live())return;
            const explanations={work:'Рабочие задачи, которые сейчас выполнены и имеют дату завершения в выбранном периоде. Повторно открытые задачи сюда не входят.',backlog:'Зафиксированные переходы задач бэклога в статус «Выполнена» за период. Повторное выполнение отражается отдельным событием; текущий статус может отличаться.',moves:'Изменения срока из истории задач за период. Для точного плана показана сохранённая причина; для прежних изменений она может отсутствовать.',metrics:'Периоды метрик, пересекающие выбранный интервал. Для квартальных метрик показан явный факт, для прежних — последний замер в пределах интервала и сегодняшнего дня. «До периода» относится к прежним метрикам. Цель и состояние периода показаны в текущей редакции.'};
            let content=projectEmpty('Нет результатов этого вида за период','Выберите другой вид результатов или период. Старые события могли не фиксироваться.');
            if(rows.items.length){
                const columns=kind==='metrics'?['Метрика / период','До периода','Факт','Цель','Дата факта / замера']:kind==='moves'?['Задача','Дата изменения','Было','Стало','Причина']:['Задача','Дата',kind==='work'?'Результат':'Событие'];
                const cells = r => {
                    const task=kind==='work'?`<a class="ui-table-title" title="${esc(r.title)}" href="#/work-tasks/${r.id}">WRK-${r.id} · ${esc(r.title)}</a>`:taskLink(r);
                    return kind==='metrics'?[`<a class="ui-table-title" title="${esc(r.title)}" href="#/metrics/${r.id}">${esc(r.title)}</a><span class="ui-table-meta">${esc(r.period)}</span>`,val(r.previous_fact),val(r.summary.fact)+' '+esc(r.unit),r.direction==='range'?`${val(r.target)}–${val(r.upper)} ${esc(r.unit)}`:val(r.target)+' '+esc(r.unit),workDate(r.summary.measured_on)]:kind==='moves'?[task,workDate(r.changed_at),esc(r.before),esc(r.after),esc(r.reason||'Не зафиксирована')]:[task,workDate(r.completed_at||r.changed_at),kind==='work'?esc(r.result||'Результат не описан'):'Переход в «Выполнена»'];
                };
                content=dataTable({stickyHeader:true, variant: 'registry', label: resultNames[kind], rows: rows.items.map(cells), responsive: 'cards', tableClassName: 'project-management-table', columns: columns.map((label,i)=>({ key: String(i), label, render: r => tableCell({ markup: r[i] }) })) });
            }
            result.innerHTML=content+workPager(rows.page,rows.total,30,'results')+'<details class="project-method"><summary class="ui-disclosure-text">Как считается</summary>'+note(explanations[kind]+' Принадлежность проекту и доступность проверяются на текущий момент.')+'</details>';
            result.querySelectorAll('[data-page-scope="results"]').forEach(b=>b.onclick=()=>{location.hash=href({rp:Math.max(1,rows.page+Number(b.dataset.page))});});
        }catch(e){if(live())result.innerHTML=failure(e);}
    }
    reload=load;await load();
}
