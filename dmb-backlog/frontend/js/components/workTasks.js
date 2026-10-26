import { mountWorkBoard } from './workBoard.js?v=4';
import { openWork } from './workTaskDrawer.js?v=13';
export { openWork };
import { escapeHtml as esc } from '../htmlUtils.js';
import { button, field, pageHeader, filterChip, kpiCard } from '../ui/primitives.js';
import { formatErrorMessage } from '../uiFeedback.js';
import { renderViewState } from './viewState.js';
import { WORK_STATUSES, workDate, workStatus, workMetrics, workPager, focusWorkPager } from './workUi.js?v=2';
import { mountWorkPicker } from './workPicker.js';
import { renderWorkQueue } from './workQueue.js?v=12';
import { WORK_PRIORITIES } from './workProductivity.js';
import { bindActionMenu } from '../ui/actionMenu.js';
import { transitionWork } from './workActions.js';

export { WORK_STATUSES };
const action = (label, name, extra = {}) => button({ label, ...extra, attrs: { 'data-work-action': name, disabled: extra.disabled, ...extra.attrs } });
const opt = (rows, empty = 'Не выбран') => [{ value: '', label: empty }, ...rows.map(x => ({ value: x.id, label: x.name || x.title }))];
const error = e => Number(e?.status) === 409 ? 'Данные изменены другим участником. Черновик сохранён. Закройте панель и откройте задачу снова для сверки.' : formatErrorMessage(e);
const late = row => row.due_date && !['done','cancelled'].includes(row.status) && row.due_date < new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});
const nextWorkStep = row => row.status === 'in_acceptance' ? 'Принять результат' : row.blocked_reason ? 'Снять препятствие' : row.assignment_state === 'proposed' ? 'Принять назначение' : !row.assignee_id ? 'Назначить исполнителя' : row.status === 'new' ? 'Передать исполнителю' : row.status === 'ready' ? 'Начать работу' : 'Подготовить результат';

export function renderWorkTasks() {
    return `<section class="work-page work-task-workplace">${pageHeader({ title: 'Рабочие задачи', description: 'Личная очередь и задачи команды', actions: '<div data-work-display-slot></div><div data-work-create-slot></div>' })}<div id="work-list"></div></section>`;
}

export async function initWorkTasks(app) {
    const match = location.hash.match(/\/work-tasks\/(\d+)/);
    const reload = await mountWorkList(document.getElementById('work-list'), app, null, null, true);
    if (match) await reload.open(Number(match[1]));
}

const listCleanups = new WeakMap();
export function disposeWorkList(root) { listCleanups.get(root)?.(); }

export async function mountWorkList(root, app, majorId = null, projectId = null, workspace = false) {
    if (!root) return;
    disposeWorkList(root);
    root.classList.add('work-list-surface');
    root.classList.toggle('work-workspace',workspace);
    const prefix = majorId ? `work-${majorId}-` : 'work-';
    const controlId = id => id.replace(/^work-/, prefix);
    const query = selector => root.querySelector(selector.replaceAll('#work-', '#' + prefix));
    const listField = props => field({ ...props, id: controlId(props.id) });
    let page = 1, generation = 0, disposed = false;
    let queueMenus=[],deferredQueueRefresh=false;
    const collapsedGroups = new Set();
    const clearQueueMenus=()=>{queueMenus.forEach(menu=>menu.destroy());queueMenus=[];};
    let inspector = null, selectedId = null, inspectorOpen = false, board = null, boardEnabled = false;
    let mobileColumn = new URLSearchParams(location.hash.split('?')[1] || '').get('column') || 'new';
    const openingId = location.hash.match(/^#\/work-tasks\/(\d+)/)?.[1];
    if (workspace && openingId) selectedId = Number(openingId);
    const defaultView = majorId || projectId ? 'all' : 'mine';
    const initial = new URLSearchParams(location.hash.split('?')[1] || '');
    let grouped = initial.get('grouped') === '1';
    if (workspace && /^\d+$/.test(initial.get('page') || '')) page = Math.max(1, Number(initial.get('page')));
    const attention = new Set(workspace ? (initial.get('attention') || '').split(',').filter(x => ['overdue','blocked','unassigned'].includes(x)) : []);
    let display = workspace && ['summary','board'].includes(initial.get('display')) ? initial.get('display') : 'list';
    let listPage = display==='list'?page:1;
    let invalidFilters = false;
    const collections = { mine: 'Мне выполнить', acceptance: 'Мне принять', requested: 'Я поручил', team: 'Команда', all: 'Все доступные' };
    const live = () => !disposed && root.isConnected;
    const layoutInspector=()=>{
        if(!live()){disposeWorkList(root);return;}
        if(!inspectorOpen||!inspector)return;
        const host=query('.work-inspector-host'),modal=root.clientWidth<1080;
        host.hidden=modal;root.classList.toggle('has-work-inspector',!modal);
        inspector.layout({container:modal?null:host,fullscreen:root.clientWidth<640,board:display==='board',returnLabel:display==='board'?'К доске':'К списку'});
    };
    const fitInspector=()=>{const host=query('.work-inspector-host');if(!host || host.hidden)return;const top=host.getBoundingClientRect().top;host.style.setProperty('--work-inspector-height',Math.max(180,window.innerHeight-Math.max(12,top)-12)+'px');};
    const layoutObserver=new ResizeObserver(()=>{layoutInspector();fitInspector();});layoutObserver.observe(root);
    window.addEventListener('scroll',fitInspector,true);window.addEventListener('resize',fitInspector);
    root.innerHTML = `${workspace ? `<nav class="work-workspace-nav" aria-label="Представление задач">${['list','board','summary'].map(mode => button({label:({list:'Список',board:'Доска',summary:'Сводка'})[mode],variant:'secondary',attrs:{'data-work-display':mode,'aria-pressed':String(mode === display)}})).join('')}</nav><nav class="work-collections" aria-label="Подборки задач">${Object.entries(collections).map(([value,label]) => filterChip({label,count:'—',selected:value === defaultView,attrs:{'data-work-collection':value}})).join('')}</nav>` : ''}<div class="work-list-actions"></div><form class="work-filter-panel" aria-label="Фильтры рабочих задач"><div class="work-filters">
        ${listField({ id: 'work-view', label: 'Показать задачи', kind: 'select', value: defaultView, options: Object.entries(collections).map(([value,label]) => ({value,label})) })}
        ${listField({ id: 'work-status', label: 'Статус', kind: 'select', value:workspace?'active':'', options: [{ value: '', label: 'Все статусы' }, { value: 'active', label: 'Активные' }, {value:'active_done',label:'Активные и выполненные'}, ...Object.entries(WORK_STATUSES).map(([value, label]) => ({ value, label }))] })}
        ${listField({ id: 'work-search', label: 'Название или номер', type: 'search', className: 'work-search-field', attrs: { placeholder: 'Название или номер задачи' } })}
        ${listField({id:'work-sort',label:'Сортировка',kind:'select',value:workspace?'attention':'due',options:[{value:'attention',label:'По вниманию'},{value:'priority',label:'По приоритету'},{value:'due',label:'По сроку'},{value:'newest',label:'Сначала новые'}]})}
        ${button({ label: 'Найти', attrs: { type: 'submit' } })}</div>
        <div class="work-filter-tools">${action('Фильтры', 'filters', { variant: 'ghost', iconMarkup:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 6h7m4 0h7M3 18h7m4 0h7"/><circle cx="12" cy="6" r="2"/><circle cx="12" cy="18" r="2"/></svg>', attrs: { 'aria-label': 'Дополнительные фильтры', 'aria-expanded': false, 'aria-controls': controlId('work-extra-filters') } })}${action('Сбросить', 'reset', { variant: 'ghost', attrs: { hidden: true } })}<span class="work-muted" data-filter-count></span></div>
        <div id="${controlId('work-extra-filters')}" class="work-extra-filters" hidden>
        ${listField({id:'work-priority',label:'Приоритет',kind:'select',options:[{value:'',label:'Все приоритеты'},...Object.entries(WORK_PRIORITIES).map(([value,label])=>({value,label}))]})}
        ${listField({id:'work-direction',label:'Направление',kind:'select',options:[{value:'',label:'Все направления'},{value:'product',label:'Продуктовое'},{value:'organizational',label:'Организационное'}]})}
        ${listField({id:'work-attention',label:'Требует внимания',kind:'select',options:[{value:'',label:'Все задачи'},{value:'overdue',label:'Просроченные'},{value:'blocked',label:'Есть препятствие'},{value:'unassigned',label:'Без исполнителя'}]})}
        ${listField({id:'work-done-period',label:'Выполненные за период',kind:'select',options:[{value:'all',label:'За всё время'},{value:'7d',label:'За 7 дней'},{value:'30d',label:'За 30 дней'}]})}<div class="work-option-fields"></div></div><p class="work-options-error" role="status" hidden></p></form>
        ${workspace ? '<div class="work-workspace-layout"><div class="work-queue-column"><p class="work-list-message" role="status" hidden></p><div class="work-results" aria-live="polite"></div></div><aside class="work-inspector-host" aria-label="Выбранная задача" hidden></aside></div>' : '<div class="work-results" aria-live="polite"></div>'}`;
    if (majorId) query('#work-view').closest('.ui-field').hidden = true;
    const result = query('.work-results');
    if(workspace)query('.work-filter-tools').insertAdjacentHTML('beforeend',action('Обновить','board-refresh',{variant:'ghost'}));
    const form = query('form');
    if (!workspace) query('#work-extra-filters').prepend(query('#work-sort').closest('.ui-field'));
    if (workspace) query('#work-view').closest('.ui-field').classList.add('work-mobile-collection');
    if (workspace) {
        const displaySlot = root.parentElement.querySelector('[data-work-display-slot]');
        if (displaySlot) {
            const nav = query('.work-workspace-nav');
            displaySlot.append(nav);
            nav.onclick = event => root.onclick?.(event);
            const compact = document.createElement('select');
            compact.className = 'work-display-compact';
            compact.setAttribute('aria-label', 'Представление задач');
            compact.innerHTML = '<option value="list">Список</option><option value="board">Доска</option><option value="summary">Сводка</option>';
            compact.value = display;
            compact.onchange = () => nav.querySelector(`[data-work-display="${compact.value}"]`)?.click();
            displaySlot.append(compact);
        }
    }
    const createSlot = root.parentElement.querySelector(':scope > .ui-page-header [data-work-create-slot], :scope > .work-section-head [data-work-create-slot]') || query('.work-list-actions');
    createSlot.innerHTML = action('Создать задачу', 'create', { variant: 'primary', iconMarkup:'<svg class="work-create-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>', attrs: { hidden: true, 'aria-label':'Создать задачу', title:'Создать задачу' } });
    const createButton = createSlot.querySelector('button');
    createButton.onclick = () => workspace ? openSelected(null) : openWork(app, null, majorId, load, projectId);
    let filterSnapshot = null, searchTimer = null;
    const value = id => filterSnapshot && Object.hasOwn(filterSnapshot,id) ? filterSnapshot[id] : query('#' + id)?.value || '';
    const filterPanel = query('#work-extra-filters');
    filterPanel.insertAdjacentHTML('afterbegin',`<div class="work-filter-heading"><h2>Фильтры</h2>${action('Закрыть','cancel-filters',{variant:'ghost',attrs:{'aria-label':'Закрыть фильтры'}})}</div>`);
    const focusLabels = {today:'Сегодня',overdue:'Просрочены',blocked:'Есть препятствие'};
    if(workspace){
        filterPanel.insertAdjacentHTML('beforeend',listField({id:'work-focus',label:'Быстрая выборка',kind:'select',options:[{value:'',label:'Все задачи'},...Object.entries(focusLabels).map(([value,label])=>({value,label}))]}));
        query('#work-focus').closest('.ui-field').hidden=false;
        form.insertAdjacentHTML('afterend','<nav class="work-focus-nav" aria-label="Быстрые выборки"></nav>');
    }
    const renderCounts = data => {
        if(!workspace)return;
        query('.work-focus-nav').hidden=display==='summary';
        const focusedKey=document.activeElement?.closest('.work-focus-nav')?document.activeElement.dataset.workFocus:null;
        for(const [key,label] of Object.entries(collections)){
            const count=data.collection_counts?.[key] ?? '—';
            root.querySelector(`[data-work-collection="${key}"] .quick-filter-count`).textContent=count;
            query('#work-view').querySelector(`option[value="${key}"]`).textContent=`${label} · ${count}`;
        }
        query('.work-focus-nav').innerHTML=Object.entries(focusLabels).map(([key,label])=>filterChip({label,count:data.focus_counts?.[key] ?? '—',selected:value('work-focus')===key,attrs:{'data-work-focus':key}})).join('');
        if(focusedKey)query(`[data-work-focus="${focusedKey}"]`)?.focus({preventScroll:true});
    };
    if(workspace){
        query('#work-attention').closest('.ui-field').hidden=true;
        filterPanel.insertAdjacentHTML('beforeend',`<fieldset class="work-attention-fields"><legend>Все выбранные признаки</legend>${[['overdue','Просрочены'],['blocked','С препятствием'],['unassigned','Без исполнителя']].map(([key,label])=>`<label><input type="checkbox" data-attention-draft="${key}"> ${label}</label>`).join('')}</fieldset>`);
    }
    query('.work-filter-tools').insertAdjacentHTML('beforeend',listField({id:'work-completed',label:'Выполненные',kind:'select',options:[{value:'hidden',label:'Активные'},{value:'7d',label:'Выполненные: 7 дней'},{value:'30d',label:'Выполненные: 30 дней'},{value:'all',label:'Выполненные: все'}]}));
    filterPanel.insertAdjacentHTML('beforeend', `<div class="work-filter-apply">${action('Применить','apply-filters',{variant:'primary'})}${action('Отмена','cancel-filters',{variant:'ghost'})}</div>`);
    query('.work-filter-panel').insertAdjacentHTML('afterend','<div class="work-filter-chips" aria-label="Применённые условия"></div>');
    query('.work-attention-menu')?.remove();
    query('#work-search').setAttribute('aria-label','Найти рабочую задачу');
    query('.work-filter-tools').insertAdjacentHTML('afterbegin',action('Поиск','toggle-search',{variant:'ghost',attrs:{'aria-expanded':false}})+action('×','clear-search',{variant:'ghost',attrs:{'aria-label':'Очистить поиск'}}));
    query('.work-filters').append(query('[data-work-action=toggle-search]'));
    const closeFilters = (apply = false) => {
        const wasOpen=!filterPanel.hidden;
        if (!apply && filterSnapshot) for (const [id,v] of Object.entries(filterSnapshot)) query('#'+id).value=v;
        filterSnapshot=null;filterPanel.hidden=true;root.dataset.filtersOpen='false';
        filterPanel.removeAttribute('role');filterPanel.removeAttribute('aria-modal');
        query('[data-work-action=filters]').setAttribute('aria-expanded','false');
        if(wasOpen)query('[data-work-action=filters]').focus();
    };
    const renderChips = () => {
        root.classList.toggle('has-work-search',!!value('work-search'));
        query('[data-work-action=clear-search]').hidden=!value('work-search');
        const defaults={'work-status':workspace?'active':'','work-sort':workspace?'attention':'due','work-done-period':'all'};
        const ids=['work-search','work-status','work-sort','work-team','work-assignee','work-filter-project','work-parent','work-direction','work-priority','work-done-period','work-focus'];
        query('.work-filter-chips').innerHTML=ids.filter(id=>value(id)&&value(id)!==defaults[id]).map(id=>{
            const el=query('#'+id),label=el?.selectedOptions?.[0]?.textContent||value(id);
            return button({label:label+' ×',variant:'ghost',attrs:{'data-remove-filter':id,'aria-label':'Убрать условие: '+label}});
        }).join('')+[...attention].map(key=>button({label:({overdue:'Просрочены',blocked:'С препятствием',unassigned:'Без исполнителя'})[key]+' ×',variant:'ghost',attrs:{'data-remove-attention':key}})).join('')+(attention.size>1?'<span class="work-muted">Все выбранные признаки</span>':'');
        query('#work-done-period').closest('.ui-field').hidden=!['','done','active_done'].includes(value('work-status'));
        query('#work-completed').value=['','done','active_done'].includes(value('work-status'))?value('work-done-period')||'all':'hidden';
        query('#work-completed').disabled=value('work-view')==='acceptance';
    };
    const shared = {view:'work-view',focus:'work-focus',status:'work-status',sort:'work-sort',q:'work-search',team:'work-team',assignee:'work-assignee',direction:'work-direction',attention:'work-attention',parent:'work-parent',priority:'work-priority',project:'work-filter-project',done_period:'work-done-period'};
    if (workspace) {
        query('#work-extra-filters').insertAdjacentHTML('beforeend', listField({id:'work-parent',label:'Номер родительской задачи',type:'number',attrs:{min:1}}));
        for (const [param,id] of Object.entries(shared)) if (initial.has(param) && query('#'+id) && !['team','assignee','attention'].includes(param)) { const control=query('#'+id);control.value=initial.get(param);if(control.tagName==='SELECT'&&control.value!==initial.get(param))invalidFilters=true; }
        if(initial.has('attention') && initial.get('attention').split(',').filter(Boolean).some(key=>!['overdue','blocked','unassigned'].includes(key)))invalidFilters=true;
        if (!Object.hasOwn(collections,value('work-view'))) query('#work-view').value = defaultView;
        mountWorkPicker(query('#work-parent'),app,{label:'Родительская задача'});
    }
    filterPanel.append(query('.work-filter-apply'));
    const completedField=query('#work-completed').closest('.ui-field');
    const sortField=query('#work-sort').closest('.ui-field');
    const filterMedia=matchMedia('(max-width:900px)');
    const placeFilters=()=>{
        if(workspace && filterMedia.matches){filterPanel.insertBefore(completedField,query('.work-filter-apply'));filterPanel.insertBefore(sortField,query('.work-filter-apply'));}
        else {query('.work-filter-tools').append(completedField);if(workspace)query('.work-filters').append(sortField);}
        query('[data-work-action=apply-filters] span').textContent=filterMedia.matches?'Показать задачи':'Применить';
    };
    filterMedia.addEventListener('change',placeFilters);placeFilters();
    const syncLocation = () => {
        if (!workspace || !live()) return;
        const params = new URLSearchParams({display});
        if(grouped)params.set('grouped','1');
        params.set('status',value('work-status'));
        for (const [param,id] of Object.entries(shared)) if (value(id)) params.set(param,value(id));
        if (attention.size) params.set('attention',[...attention].join(',')); else params.delete('attention');
        if (display === 'list' && page > 1) params.set('page', String(page));
        if (display === 'board') params.set('column',mobileColumn);
        const path = selectedId ? '/work-tasks/'+selectedId : '/work-tasks';
        history.replaceState(null,'','#'+path+'?'+params);
        root.parentElement.querySelectorAll('[data-work-display]').forEach(el => el.setAttribute('aria-pressed',String(el.dataset.workDisplay === display)));
        const compact = root.parentElement.querySelector('.work-display-compact');
        if(compact)compact.value=display;
        root.querySelectorAll('[data-work-collection]').forEach(el => {
            const selected = el.dataset.workCollection === value('work-view');
            el.setAttribute('aria-pressed', String(selected));
            el.classList.toggle('active', selected);
        });
        root.querySelectorAll('[data-work-quick]').forEach(el => el.setAttribute('aria-pressed',String(attention.has(el.dataset.workQuick))));
    };
    function markSelection() {
        board?.select();
        root.querySelectorAll('[data-work-row]').forEach(row => row.classList.toggle('is-selected', Number(row.dataset.workRow) === selectedId));
        root.querySelectorAll('[data-work-id]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.workId) === selectedId)));
    }
    async function openSelected(id, requestedAction = null) {
        if (!live()) return;
        if (inspectorOpen && selectedId === id) { inspector?.focus(); if(requestedAction)inspector?.action?.(requestedAction); return; }
        const old = inspector;
        if (old && !old.close(false)) {
            const notice = query('.work-list-message');
            notice.hidden = false; notice.textContent = 'Дождитесь сохранения открытой задачи.';
            return;
        }
        const host = query('.work-inspector-host');
        query('.work-list-message').hidden = true;
        const positionKey=`work-list-position:${app.store.get('currentUser')?.id}:${location.hash.split('?')[1]||''}`;
        try{sessionStorage.setItem(positionKey,JSON.stringify({id,windowY:scrollY,mainY:document.querySelector('.main-content')?.scrollTop||0}));}catch{}
        if(id && !location.hash.startsWith(`#/work-tasks/${id}?`))history.pushState(null,'',location.href);
        selectedId = id; inspectorOpen = true;
        const boardModal = root.clientWidth < (display === 'board' ? 1080 : 1080);
        host.hidden = boardModal;
        root.classList.toggle('has-work-inspector',!boardModal); markSelection(); syncLocation();
        let mountedController;
        await openWork(app, id, null, async saved => {
            if (saved?.id && inspectorOpen && inspector === mountedController) selectedId = saved.id;
            syncLocation(); await load();
        }, null, () => {}, {
            container: boardModal ? null : host, board: display === 'board', fullscreen:root.clientWidth < 640, returnLabel: display === 'board' ? 'К доске' : 'К списку',
            onMount: controller => { mountedController = controller; inspector = controller; fitInspector(); },
            onDispose: restoreRoute => {
                inspector = null; inspectorOpen = false; selectedId = null;
                host.hidden = true; root.classList.remove('has-work-inspector'); markSelection();
                if (restoreRoute && live()) syncLocation();
            }
        });
        if(requestedAction)mountedController?.action?.(requestedAction);
        if(board)await board.load();
    }
    const hasFilters = () => value('work-focus') || attention.size || value('work-status') !== (workspace ? 'active' : '') || value('work-sort') !== (workspace ? 'attention' : 'due') || ['work-search', 'work-direction', 'work-attention', 'work-team', 'work-assignee', 'work-parent', 'work-priority', 'work-filter-project'].some(id => value(id));
    async function loadOptions() {
        try {
            const options = await app.api.get('/work-tasks/options');
            if (!live()) return;
            createButton.hidden = !options.can_create;
            boardEnabled = options.board_enabled === true;
            root.parentElement.querySelector('[data-work-display=board]')?.toggleAttribute('hidden',!boardEnabled);
            root.parentElement.querySelector('.work-display-compact option[value=board]')?.toggleAttribute('disabled',!boardEnabled);
            document.querySelector('.sidebar a[href="#/kanban"]')?.toggleAttribute('hidden',boardEnabled);
            query('.work-option-fields').innerHTML = listField({id:'work-team',label:'Команда',kind:'select',options:opt(options.teams,'Все команды')}) + listField({id:'work-assignee',label:'Исполнитель',kind:'select',options:opt(options.users,'Все исполнители')}) + listField({id:'work-filter-project',label:'Проект',kind:'select',options:opt(options.projects||[],'Все проекты')});
            if (workspace) for (const [param,id] of [['team','work-team'],['assignee','work-assignee'],['project','work-filter-project']]) if (initial.has(param)) {query('#'+id).value = initial.get(param);if(query('#'+id).value!==initial.get(param))invalidFilters=true;}
            query('.work-options-error').hidden = true;
            if (workspace) {
                // Team and status remain available in the compact filter panel.
                query('.work-filter-heading').after(query('#work-status').closest('.ui-field'));
            }
        } catch {
            if (!live()) return;
            const notice = query('.work-options-error');
            notice.hidden = false;
            notice.innerHTML = `Не удалось загрузить команды, исполнителей и доступность создания. ${action('Повторить', 'options')}`;
        }
    }
    async function load() {
        if (!live()) return;
        const request = ++generation;
        if(invalidFilters){result.innerHTML=renderViewState({kind:'error',title:'Некорректные условия в ссылке',message:'Сбросьте фильтры и задайте нужные условия заново.',actionLabel:'Сбросить условия',actionAttrs:{'data-work-action':'reset'}});return;}
        syncLocation();
        renderChips();
        if (!result.children.length) result.innerHTML = renderViewState({ kind: 'loading', title: 'Загружаем задачи' });
        result.setAttribute('aria-busy','true');
        query('[data-work-action=reset]').hidden = !hasFilters();
        const extraCount = ['work-direction', 'work-attention', 'work-team', 'work-assignee', 'work-parent', 'work-priority', 'work-filter-project'].filter(id => value(id)).length + (value('work-status') !== (workspace ? 'active' : '') ? 1 : 0);
        query('[data-filter-count]').textContent = extraCount ? `Дополнительных фильтров: ${extraCount}` : '';
        const params = new URLSearchParams({ view: majorId ? 'all' : value('work-view'), status: value('work-status'), sort:value('work-sort') || 'due', q: value('work-search').trim(), page });
        if(value('work-focus'))params.set('focus',value('work-focus'));
        if(selectedId&&display!=='board')params.set('selected_id',selectedId);
        if (value('work-priority')) params.set('priority',value('work-priority'));
        if(value('work-filter-project'))params.set('effective_project_id',value('work-filter-project'));
        if(value('work-done-period'))params.set('done_period',value('work-done-period'));
        if (majorId) params.set('major_task_id', majorId);
        if (projectId) params.set('direct_project_id', projectId);
        if (workspace && value('work-parent')) params.set('major_task_id',value('work-parent'));
        for (const [id, param] of [['work-direction','work_direction'],['work-team','execution_team_id'],['work-assignee','assignee_id']]) if (value(id)) params.set(param, value(id));
        for (const key of workspace ? attention : [value('work-attention')].filter(Boolean)) params.set(key,'true');
        root.classList.toggle('work-board-mode',display==='board');
        if(display!=='board'&&board){board.destroy();board=null;result.innerHTML='';}
        if(display==='board'){
            if(!boardEnabled){result.innerHTML='<p>Доска рабочих задач пока выключена. Перейдите к списку: условия сохранятся.</p>';result.removeAttribute('aria-busy');return;}
            if(!board)board=mountWorkBoard(result,app,{
                open:openSelected,selected:()=>selectedId,initialColumn:mobileColumn,
                onColumn:value=>{mobileColumn=value;syncLocation();},
                canAct:id=>!inspectorOpen || selectedId===id && !inspector?.isBusy?.(),
                counts:data=>{inspector?.membership?.(data.selected_matches);renderCounts(data);},
                showDone:()=>{query('#work-status').value='active_done';query('#work-done-period').value='7d';load();}
            });
            await board.load(params);result.removeAttribute('aria-busy');return;
        }
        try {
            const data = await app.api.get('/work-tasks?' + params);
            if (request !== generation || !live()) return;
            inspector?.membership?.(data.selected_matches);
            if (workspace) {
                renderCounts(data);
                if (display === 'summary') {
                    const metrics = [['overdue','Просрочены'],['blocked','Есть препятствие'],['in_acceptance','Ожидают приёмки'],['unassigned','Без исполнителя'],['active','Активные'],['done','Выполнены'],['total','Всего']];
                    result.innerHTML = `<section aria-label="Сводка задач"><h2>Состояние задач</h2><p class="work-muted">${esc(collections[value('work-view')])}. Показатели учитывают выбранные фильтры и могут пересекаться.</p><div class="work-summary-grid">${metrics.map(([key,label]) => {
                        const filtered=data.summary_states?.[key]?.state==='filtered'||key==='done'&&(!['','done','active_done'].includes(value('work-status'))||value('work-view')==='acceptance');
                        const n=data.summary?.[key];
                        const text=filtered?'Не включены':Number.isFinite(n)?n:'—';
                        return kpiCard({label,value:text,className:'work-metric',attrs:{'data-work-metric':key,hidden:key==='total'&&data.summary?.active===n,disabled:!filtered&&!n}});
                    }).join('')}</div>${!data.total ? '<p>По выбранным условиям задач нет.</p>' : ''}</section>`;
                    const priorities=data.attention_items || data.items.filter(x=>!['done','cancelled'].includes(x.status)).slice(0,5);
                    if(priorities.length) result.insertAdjacentHTML('beforeend',`<section class="work-priorities"><h2>Ближайшие действия</h2><p class="work-muted">Просрочки, приёмка и препятствия — затем ближайшие сроки. До пяти задач по выбранным условиям.</p><ul class="work-priority-list">${priorities.map(x=>`<li><button class="ui-link work-task-link" data-work-id="${x.id}">${esc(x.public_id)} · ${esc(x.title)}</button><div>${workStatus(x.status,WORK_STATUSES)} <span class="${late(x)?'work-warning':''}">${late(x)?'Просрочено · ':''}${esc(workDate(x.due_date))}</span></div><p>${esc(x.next_step?.label||nextWorkStep(x))} · ${esc(x.next_step?.actor_name || (x.status==='in_acceptance' ? x.acceptor_name || 'Приёмщик не назначен' : x.assignee_name || 'Исполнитель не назначен'))}</p>${x.blocked_reason?`<p class="work-warning">${esc(x.blocked_reason)}</p>`:''}</li>`).join('')}</ul></section>`);
                    return;
                }
            }
            if (!data.items.length && page > 1) { page = Math.max(1, Math.ceil(data.total / 30)); return load(); }
            if (workspace && data.items.length) {
                const focusedId = result.contains(document.activeElement) ? document.activeElement.dataset.workId : null;
                result.innerHTML = renderWorkQueue(data, { selectedId, sort:value('work-sort'), page, personal:value('work-view')==='mine', userId:app.store.get('currentUser')?.id, collapsed:collapsedGroups, grouped, activeAttention:attention });
                clearQueueMenus();
                result.querySelectorAll('[data-queue-menu]').forEach(trigger=>{
                    const row=data.items.find(x=>x.id===Number(trigger.dataset.queueMenu)),panel=document.createElement('div');
                    panel.innerHTML=button({label:'Открыть задачу',attrs:{'data-queue-command':'open'}})+(row.available_actions||[]).map(target=>button({label:({ready:'Передать исполнителю',in_progress:row.status==='in_acceptance'?'Вернуть на доработку':'Начать работу',in_acceptance:'Передать на приёмку',done:row.status==='in_acceptance'?'Принять результат':'Завершить',cancelled:'Отменить задачу'})[target],attrs:{'data-queue-command':target}})).join('');
                    root.append(panel);
                    const menu=bindActionMenu({trigger,panel,label:`Действия ${row.public_id}`,onClose:()=>{if(deferredQueueRefresh&&live()){deferredQueueRefresh=false;queueMicrotask(load);}}});
                    panel.onclick=async event=>{const command=event.target.closest('[data-queue-command]')?.dataset.queueCommand;if(!command)return;
                        menu.close?.();
                        if(command==='open'){await openSelected(row.id);return;}
                        if(command==='in_progress'&&row.status==='ready'){
                            panel.querySelectorAll('button').forEach(x=>x.disabled=true);
                            try{await transitionWork(app,row,command);await load();}catch(e){const note=query('.work-list-message');note.hidden=false;note.textContent=formatErrorMessage(e);}
                        }else await openSelected(row.id,'transition:'+command);
                    };
                    const destroy=menu.destroy;menu.destroy=()=>{destroy();panel.remove();};queueMenus.push(menu);
                });
                if (focusedId) result.querySelector(`[data-work-id="${Number(focusedId)}"]`)?.focus({preventScroll:true});
                return;
            }
            const constrained = ['work-search','work-direction','work-team','work-assignee','work-priority','work-focus','work-filter-project','work-parent'].some(id=>value(id)) || attention.size>0 || !['active',''].includes(value('work-status'));
            const emptyQueue = value('work-view')==='mine' ? 'Вам пока не назначены задачи' : value('work-view')==='acceptance' ? 'Нет результатов, ожидающих вашей приёмки' : value('work-view')==='requested' ? 'Вы пока не поручили задач' : 'Рабочих задач пока нет';
            const filtered = value('work-view') !== 'all' || ['work-status', 'work-search', 'work-direction', 'work-attention', 'work-team', 'work-assignee', 'work-priority'].some(id => value(id));
            result.innerHTML = `${workspace ? '' : workMetrics(data.summary)}<div class="work-panel">${data.items.length ? `<div class="work-table-wrap"><table data-ui-density="compact" class="ui-table ui-table-data work-table"><caption class="sr-only">Рабочие задачи</caption><thead><tr><th scope="col">Задача</th><th scope="col">Исполнитель</th><th scope="col">Срок</th><th scope="col">Статус</th><th scope="col">Контекст</th></tr></thead><tbody>${data.items.map(x => `<tr><td data-label="Задача"><button class="ui-link work-task-link" data-work-id="${x.id}">${esc(x.public_id)} · ${esc(x.title)}</button>${!['done','cancelled'].includes(x.status) && x.blocked_reason ? '<span class="work-warning">Есть блокер</span>' : ''}</td><td data-label="Исполнитель">${esc(x.assignee_name || 'Не назначен')}</td><td data-label="Срок">${esc(workDate(x.due_date))}</td><td data-label="Статус">${workStatus(x.status, WORK_STATUSES)}${!['done','cancelled'].includes(x.status) && x.assignment_state === 'proposed' ? '<small>Ожидает принятия командой</small>' : !['done','cancelled'].includes(x.status) && x.assignment_state === 'declined' ? '<small>Назначение отклонено</small>' : ''}</td><td data-label="Контекст">${esc(x.context?.title || 'Самостоятельная')}</td></tr>`).join('')}</tbody></table></div>` : renderViewState({ title: constrained ? 'Задачи не найдены по условиям' : emptyQueue, message: constrained ? 'Измените поиск или сбросьте условия, сохранив выбранную очередь.' : 'Откройте все доступные задачи или выберите другую очередь.', actionLabel: constrained ? 'Сбросить условия' : 'Показать все доступные', actionAttrs: { 'data-work-action': constrained ? 'reset' : 'clear' } })}${workPager(page, data.total)}</div>`;
            for (const item of data.items.filter(late)) {
                const cell=result.querySelector(`[data-work-id="${item.id}"]`)?.closest('tr')?.querySelector('[data-label="Срок"]');
                if(cell){cell.classList.add('work-warning');cell.insertAdjacentHTML('beforeend','<small class="work-overdue-label">Просрочено</small>');}
            }
        } catch (e) {
            if (request === generation && live()) result.innerHTML = renderViewState({ kind: 'error', title: 'Не удалось загрузить задачи', message: error(e), actionLabel: 'Повторить', actionAttrs: { 'data-work-action': 'search' } });
        } finally {
            if (request === generation && live()) result.removeAttribute('aria-busy');
        }
    }
    root.onclick = async event => {
        if(event.target.closest('[data-work-grouping]')) { grouped=!grouped; collapsedGroups.clear(); await load(); return; }
        if (event.target.closest('.work-inspector-host, [data-board-root], [data-queue-menu], [data-queue-command]')) return;
        const groupButton=event.target.closest('[data-work-group]');
        if(groupButton){const group=groupButton.dataset.workGroup,collapsed=groupButton.getAttribute('aria-expanded')==='true';collapsed?collapsedGroups.add(group):collapsedGroups.delete(group);groupButton.setAttribute('aria-expanded',String(!collapsed));groupButton.querySelector('[aria-hidden]').textContent=collapsed?'▸':'▾';groupButton.closest('tbody').querySelectorAll('[data-work-row]').forEach(row=>row.hidden=collapsed);return;}
        const focus=event.target.closest('[data-work-focus]')?.dataset.workFocus;
        if(focus){closeFilters();query('#work-focus').value=value('work-focus')===focus?'':focus;attention.clear();query('#work-attention').value='';query('#work-status').value='active';page=1;await load();return;}
        const removed=event.target.closest('[data-remove-filter]')?.dataset.removeFilter;
        const removedAttention=event.target.closest('[data-remove-attention]')?.dataset.removeAttention;
        if(removed||removedAttention){closeFilters();if(removed)query('#'+removed).value=({'work-status':'active','work-sort':'attention','work-done-period':'all'})[removed]||'';if(removedAttention){attention.delete(removedAttention);query('#work-attention').value=attention.size===1?[...attention][0]:'';}page=1;await load();return;}
        const mode = event.target.closest('[data-work-display]')?.dataset.workDisplay;
        const collection = event.target.closest('[data-work-collection]')?.dataset.workCollection;
        const metric = event.target.closest('[data-work-metric]')?.dataset.workMetric;
        const quick = event.target.closest('[data-work-quick]')?.dataset.workQuick;
        if (mode || collection || metric || quick) {
            if (quick) { attention.has(quick) ? attention.delete(quick) : attention.add(quick); query('#work-attention').value = attention.size === 1 ? [...attention][0] : ''; }
            if (mode) {
                if(display==='list')listPage=page;
                history.pushState(null,'',location.href);
                display = mode;
                page=mode==='list'?listPage:1;layoutInspector();await load();return;
            }
            if (collection) {closeFilters();query('#work-view').value = collection;if(query('#work-focus'))query('#work-focus').value='';}
            if (metric) {
                display = 'list';
                if (['overdue','blocked','unassigned'].includes(metric)) { attention.add(metric); query('#work-attention').value = attention.size === 1 ? metric : ''; }
                if (['in_acceptance','done','active'].includes(metric)) query('#work-status').value = metric;
                if(metric==='done'){query('#work-done-period').value='7d';if(value('work-view')==='acceptance'){query('#work-status').value='in_acceptance';const notice=query('.work-list-message');notice.hidden=false;notice.textContent='«Мне принять» включает только ожидающие приёмки работы. Выберите другую подборку для выполненных.';}}
            }
            page = 1; await load(); return;
        }
        const id = event.target.closest('[data-work-id]')?.dataset.workId;
        if (id) { if (workspace) await openSelected(Number(id)); else await openWork(app, Number(id), null, load); return; }
        const a = event.target.closest('[data-work-action]')?.dataset.workAction;
        if(a==='toggle-search'){const opened=root.classList.toggle('search-open');event.target.closest('button').setAttribute('aria-expanded',String(opened));if(opened)query('#work-search').focus();return;}
        if(a==='clear-search'){query('#work-search').value='';page=1;await load();return;}
        if (a === 'filters') {
            const panel = query('#work-extra-filters');
            if(!panel.hidden){closeFilters();return;}
            filterSnapshot=Object.fromEntries([...panel.querySelectorAll('input[id],select[id]')].map(el=>[el.id.replace(prefix,'work-'),el.value]));
            panel.querySelectorAll('[data-attention-draft]').forEach(el=>el.checked=attention.has(el.dataset.attentionDraft));
            panel.hidden = false;
            if(filterMedia.matches){panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','Фильтры рабочих задач');panel.querySelector('[aria-label="Закрыть фильтры"]').focus();}
            root.dataset.filtersOpen=String(!panel.hidden);
            event.target.closest('button').setAttribute('aria-expanded', String(!panel.hidden));
        }
        if(a==='cancel-filters'){closeFilters();return;}
        if(a==='apply-filters'){closeFilters(true);attention.clear();if(workspace)filterPanel.querySelectorAll('[data-attention-draft]:checked').forEach(el=>attention.add(el.dataset.attentionDraft));else if(value('work-attention'))attention.add(value('work-attention'));page=1;await load();return;}
        if (a === 'options') await loadOptions();
        if (a === 'board-refresh') { if(board)await board.refresh();else await load(); }
        if (a === 'reset' || a === 'clear') {
            const collection=value('work-view');closeFilters();invalidFilters=false;form.reset();
            attention.clear();
            query('#work-view').value = a === 'clear' ? 'all' : collection;
            if (a === 'clear') query('#work-status').value = '';
            page = 1; await load();
        }
        if (a === 'search') { page = 1; await load(); }
        const step = event.target.closest('[data-page-scope="work"]')?.dataset.page;
        if (step) { page = Math.max(1, page + Number(step)); await load(); if (live()) { result.tabIndex=-1; result.focus({preventScroll:true}); result.scrollIntoView({block:'start'}); } }
    };
    form.onsubmit = e => { e.preventDefault(); clearTimeout(searchTimer);page = 1; load(); };
    form.onkeydown=e=>{
        if(e.key==='Escape'&&!filterPanel.hidden){e.preventDefault();e.stopPropagation();closeFilters();}
        if(e.key==='Tab'&&!filterPanel.hidden&&filterMedia.matches){const controls=[...filterPanel.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
    };
    query('#work-search').oninput=()=>{clearTimeout(searchTimer);generation++;searchTimer=setTimeout(()=>{page=1;load();},300);};
    form.onchange = e => { if(e.target===query('#work-completed')){query('#work-status').value=e.target.value==='hidden'?'active':'active_done';query('#work-done-period').value=e.target.value==='hidden'?'all':e.target.value;} if(filterPanel.contains(e.target))return; if (e.target.matches('select')) { page = 1; load(); } };
    let refreshTimer=null,maxTimer=null;
    const refresh = () => {
        if(!live()){disposeWorkList(root);return;}
        inspector?.externalChange?.();
        const run=()=>{clearTimeout(refreshTimer);clearTimeout(maxTimer);refreshTimer=maxTimer=null;if(board)board.refresh();else if(root.querySelector('[data-queue-menu][aria-expanded=true]'))deferredQueueRefresh=true;else load();};
        clearTimeout(refreshTimer);refreshTimer=setTimeout(run,350);if(!maxTimer)maxTimer=setTimeout(run,2000);
    };
    const navigation = () => { if(workspace)disposeWorkList(root); };
    const stopResponsive=()=>filterMedia.removeEventListener('change',placeFilters);
    window.addEventListener('hashchange',navigation);
    document.addEventListener('dmb:work-changed', refresh);
    listCleanups.set(root, () => { if(disposed)return;disposed = true; generation++;layoutObserver.disconnect();window.removeEventListener('scroll',fitInspector,true);window.removeEventListener('resize',fitInspector);stopResponsive();clearTimeout(searchTimer);clearQueueMenus();clearTimeout(refreshTimer);clearTimeout(maxTimer);board?.destroy(); inspector?.close(false); window.removeEventListener('hashchange',navigation);document.removeEventListener('dmb:work-changed', refresh); createButton.remove(); });
    await loadOptions();
    if (live()) await load();
    if(workspace&&!openingId){try{const saved=JSON.parse(sessionStorage.getItem(`work-list-position:${app.store.get('currentUser')?.id}:${location.hash.split('?')[1]||''}`));if(saved){scrollTo(0,saved.windowY);const main=document.querySelector('.main-content');if(main)main.scrollTop=saved.mainY;root.querySelector(`[data-work-id="${Number(saved.id)}"]`)?.focus({preventScroll:true});}}catch{}}
    if(workspace && sessionStorage.getItem('work-board-redirect-notice')){
        sessionStorage.removeItem('work-board-redirect-notice');
        const notice=query('.work-list-message');notice.hidden=false;notice.textContent='Доска рабочих задач находится в разделе «Задачи»';
    }
    load.open = openSelected;
    return load;
}

