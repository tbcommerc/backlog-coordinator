import { segmentedControl } from '../ui/segmented.js';
import { bindActionMenu } from '../ui/actionMenu.js';
import { showFormErrors, clearFormErrors } from '../ui/validation.js';
import { formatFileSize } from '../ui/dataDisplay.js';
import { fileUpload, setUploadState } from '../ui/specialized.js';
import { descriptionList, sectionCard } from '../ui/detailComponents.js';
import { bindDetailPanel } from '../ui/detailPanel.js';
import { transitionWork } from './workActions.js';
import { button, field, collapseSection } from '../ui/primitives.js';
import { escapeHtml as esc } from '../htmlUtils.js';
import { formatErrorMessage } from '../uiFeedback.js';
import { enhanceDialogOverlay } from '../modalAccessibility.js';
import { WORK_STATUSES, workStatus } from './workUi.js?v=2';
import { mountRelations } from './workRelations.js?v=3';
import { mountWorkPicker } from './workPicker.js';
import { workDueLabel, workIsLate } from './workQueue.js?v=9';
import { WORK_PRIORITIES, priorityBadge, checklistValue, checklistCount, checklistProgress, checklistView, mountChecklistEditor, mountWorkTemplates } from './workProductivity.js';

const HISTORY = { checklist: 'Изменён чек-лист', created: 'Создана', updated: 'Изменена', transition: 'Изменён статус', placement: 'Изменено размещение', assignment: 'Решение команды', reassignment: 'Предложена другой команде', comment: 'Добавлен комментарий', attachment: 'Добавлен файл' };
const action = (label, name, extra = {}) => button({ label, ...extra, attrs: { 'data-work-action': name, ...extra.attrs } });
const opt = (rows, empty = 'Не выбран') => [{ value: '', label: empty }, ...rows.map(x => ({ value: x.id, label: (x.name || x.title) + (x.login_notice ? ' — ' + x.login_notice : '') }))];
const number = value => value ? Number(value) : null;
const message = e => Number(e?.status) === 409 ? 'Данные изменены другим участником. Черновик сохранён. Закройте панель и откройте задачу снова для сверки.' : formatErrorMessage(e);
const dateTime = value => {
    const date = new Date(value);
    return value && !Number.isNaN(date.getTime()) ? date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '';
};

export async function openWork(app, id = null, majorId = null, changed = () => {}, projectId = null, onClose = () => {}, presentation = {}) {
    let inline = !!presentation.container;
    let userFullscreen = false;
    let lastLayout = {container:presentation.container,fullscreen:presentation.fullscreen,board:presentation.board,returnLabel:presentation.returnLabel};
    const overview = true;
    const origin = document.activeElement;
    const originList = origin?.closest('.work-list-surface') || document;
    const restoreFocus = () => {
        const target = origin?.isConnected ? origin : id ? originList.querySelector(`[data-work-id="${Number(id)}"]`) : null;
        target?.focus();
    };
    const dialog = document.createElement('dialog');
    dialog.dataset.uiLayout = 'consumer';
    dialog.dataset.nonmodal=String(inline);
    dialog.className = 'work-dialog' + (inline ? ' work-dialog-inline' : '') + (presentation.board ? ' work-board-detail' : '');
    if (inline) { dialog.setAttribute('role', 'region'); dialog.setAttribute('open', ''); dialog.tabIndex = -1; }
    if(presentation.fullscreen)dialog.classList.add('is-fullscreen');
    dialog.setAttribute('aria-labelledby', 'work-drawer-title');
    dialog.innerHTML = `<header class="work-dialog-head"><h2 id="work-drawer-title">Рабочая задача</h2>${action('Закрыть', 'close', { attrs: { 'data-close': '' } })}</header><div class="work-dialog-body" role="status">Загрузка…</div>`;
    let mutationEpoch = 0;
    let busy = false, closeAfterNavigation = false, renderController, renderGeneration = 0, draftFailed = false, discardDraft = false;
    let detailController, cardMenu;
    const close = (restoreRoute = true, force = false) => {
        if (busy && !force) return false;
        if(draftFailed&&!discardDraft&&!force){
            let warning=dialog.querySelector('[data-close-warning]');
            if(!warning){warning=document.createElement('div');warning.dataset.closeWarning='';warning.className='work-conflict';warning.setAttribute('role','alert');warning.innerHTML=`<p>Не удалось сохранить черновик. Продолжите редактирование или закройте без сохранения.</p>${action('Продолжить редактирование','keep-editing')}${action('Закрыть без сохранения','discard-draft')}`;dialog.append(warning);
                warning.onclick=e=>{const a=e.target.closest('[data-work-action]')?.dataset.workAction;if(a==='keep-editing')warning.remove();if(a==='discard-draft'){discardDraft=true;close(restoreRoute);}};
            }warning.querySelector('button').focus();return false;
        }
        window.removeEventListener('hashchange', navigationChanged);
        document.removeEventListener('dmb:session-ended', sessionEnded);
        renderController?.abort(); ++renderGeneration;
        cardMenu?.destroy(); detailController?.destroy();
        if (!inline) dialog.close();
        dialog.remove();
        presentation.onDispose?.(restoreRoute);
        if (restoreRoute) { onClose(); restoreFocus(); }
        return true;
    };
    const openingHash = location.hash;
    const sessionEnded = () => close(false, true);
    document.addEventListener('dmb:session-ended', sessionEnded);
    const navigationChanged = () => {
        if (location.hash === openingHash) return;
        if (busy) closeAfterNavigation = true;
        else close(false);
    };
    window.addEventListener('hashchange', navigationChanged);
    detailController = bindDetailPanel(dialog, { onClose: () => close(), isBusy: () => busy, focusOrigin: origin });
    dialog.onclick = e => { if (e.target.closest('[data-work-action="close"]')) detailController.requestClose('button'); };
    detailController.present({ container: presentation.container, fullscreen: presentation.fullscreen });
    const controller = { close, isBusy:()=>busy, focus: () => (dialog.querySelector('[data-close]') || dialog).focus(),
        layout: ({container, fullscreen, board, returnLabel}) => {
            lastLayout = {container,fullscreen,board,returnLabel};
            if (userFullscreen) {container=null;fullscreen=true;}
            const nextInline=!!container, focus=document.activeElement, inside=dialog.contains(focus);
            dialog.classList.toggle('is-fullscreen',fullscreen);dialog.classList.toggle('work-board-detail',board);
            presentation.returnLabel=returnLabel;
            if(nextInline===inline){detailController.present({container,fullscreen});return;}
            inline=nextInline;dialog.classList.toggle('work-dialog-inline',inline);
            detailController.present({container,fullscreen});
            if(inside&&focus?.isConnected)focus.focus({preventScroll:true});
        }
    };
    presentation.onMount?.(controller);
    if (inline) controller.focus();
    const render = async () => {
    cardMenu?.destroy();
    const request = ++renderGeneration;
    renderController?.abort();
    renderController = new AbortController();
    const listen = (target, type, fn) => target.addEventListener(type, fn, {signal:renderController.signal});
    try {
        let [row, options] = await Promise.all([id ? app.api.get('/work-tasks/' + id) : null, app.api.get('/work-tasks/options')]);
        if (!dialog.isConnected || request !== renderGeneration) return;
        const createKey = crypto.randomUUID();
        const key = `work-draft:${app.store.get('currentUser')?.id}:${id || 'new'}:${majorId || ''}:${projectId || ''}`;
        let recovered = null;
        try { recovered = JSON.parse(sessionStorage.getItem(key)); } catch { /* Storage may be unavailable. */ }
        const base = row || { title: '', description: '', execution_team_id: app.store.get('currentUser')?.team_id, work_direction: 'organizational', major_task_id: majorId, direct_project_id: projectId };
        const draft = { ...base, ...(recovered || {}) };
        draft.priority ||= 'normal';
        draft.checklist = JSON.stringify(checklistValue(draft.checklist));
        const editable = row ? row.can_edit && !['done', 'cancelled'].includes(row.status) : options.can_create;
        let editing = editable || !row || !!row.can_decide_assignment;
        const f = (name, label, extra = {}) => field({ id: 'wf-' + name, label, value: draft[name] ?? '', disabled: !editable, ...extra, attrs: { 'data-work-field': name, ...(extra.kind === 'textarea' ? { rows: 3 } : {}), ...extra.attrs } });
        const transitionLabel = target => ({ new: 'Восстановить задачу', ready: row?.status === 'done' ? 'Переоткрыть' : 'Передать исполнителю', in_progress: row?.status === 'in_acceptance' ? 'Вернуть на доработку' : 'Начать работу', in_acceptance: 'Передать на приёмку', done: row?.status === 'in_acceptance' ? 'Принять результат' : 'Завершить', cancelled: 'Отменить задачу' })[target];
        const actions = row?.available_actions || [];
        const primary = actions.find(s => s !== 'cancelled' && !(row.status === 'in_acceptance' && s === 'in_progress'));
        const person = id => options.users.find(u => u.id === id)?.name;
        const activeWork = row && !['done', 'cancelled'].includes(row.status);
        const defaultNextStep = !row ? '' : activeWork && row.assignment_state === 'proposed' ? 'Команда выполнения должна принять поручение и назначить исполнителя и срок.' : activeWork && row.assignment_state === 'declined' ? 'Команда отклонила поручение. Постановщику нужно уточнить задачу или предложить её другой команде.' : ({
            new: 'Постановщику нужно указать ожидаемый результат, исполнителя и срок, затем передать задачу исполнителю.',
            ready: `${person(row.assignee_id) || 'Исполнитель'}: следующий шаг — начать работу.`,
            in_progress: `${person(row.assignee_id) || 'Исполнитель'}: ${row.acceptance_required ? 'подготовить результат и передать на приёмку' : 'зафиксировать результат и завершить задачу'}.`,
            in_acceptance: `${person(row.acceptor_id) || 'Приёмщик'}: проверить результат — принять или вернуть на доработку.`,
            done: 'Задача выполнена. Результат сохранён.',
            cancelled: 'Задача отменена. Причина доступна в истории изменений.'
        })[row.status] || '';
        const nextStep = row?.next_step?.label ? `${row.next_step.actor_name || person(row.assignee_id) || 'Ответственный'}: ${row.next_step.label}.` : defaultNextStep;
        const panel = (name, content) => name === 'task'
            ? `<section id="work-card-task-panel">${content}</section>`
            : `<details id="work-card-${name}-panel" class="ui-collapse-section work-page-section"><summary class="ui-disclosure-text">${name === 'activity' ? 'Активность' : 'Материалы'}</summary>${content}</details>`;
        const hadFocus = dialog.contains(document.activeElement);
        dialog.innerHTML = `
            <header class="work-dialog-head">
                <div class="work-dialog-heading"><h2 id="work-drawer-title">${row ? esc(row.public_id) : 'Новая рабочая задача'}</h2>${row ? workStatus(row.status, WORK_STATUSES) + (['high','urgent'].includes(row.priority)?priorityBadge(row.priority):'') : ''}</div>
                ${row?`<div class="work-card-navigation">${action(userFullscreen ? 'Обычный размер' : 'На весь экран','fullscreen',{variant:'ghost',icon:'maximize',iconOnly:true})}</div>${action('Ещё','card-menu',{variant:'ghost',attrs:{'data-card-menu-trigger':''}})}<div class="work-card-menu" data-card-menu hidden>${presentation.onWidth ? '<label class="work-card-width">Ширина карточки<input type="range" min="440" max="760" step="1" value="'+(presentation.width || 560)+'" data-card-width></label>' : ''}${action('Скопировать ссылку','copy-link',{variant:'ghost'})}${row.can_place?action('Переместить','show-placement',{variant:'ghost'}):''}${row.can_reassign?action('Предложить другой команде','show-reassignment',{variant:'ghost'}):''}${options.can_create?action('Сохранить как шаблон','show-template',{variant:'ghost'}):''}</div>`:''}
                ${action('Закрыть', 'close', { icon: 'x', iconOnly: true, variant: 'ghost', attrs: { 'data-close': '' } })}
                ${row ? `<p class="work-dialog-context">${esc(row.context?.title || 'Самостоятельная задача')} · ${esc(options.teams.find(t => t.id === row.execution_team_id)?.name || 'Команда не указана')}</p>` : ''}
            </header>
            <div class="work-dialog-notices"><div class="work-error" role="alert" tabindex="-1"></div><p class="work-draft-notice" ${recovered ? '' : 'hidden'}>Восстановлен несохранённый черновик. Проверьте изменения.</p></div>
            <div class="work-dialog-body">
                ${panel('task', `
                    ${overview && row ? `<section class="work-card-overview"><h3 class="work-card-title">${esc(row.title)}</h3>${descriptionList({className:'work-card-properties',items:[
                        {label:'Исполнитель',value:person(row.assignee_id) || 'Не назначен'},
                        {label:'Срок',valueMarkup:row.due_date ? `<span>${esc(new Date(row.due_date+'T12:00:00Z').toLocaleDateString('ru-RU',{day:'numeric',month:'long',year:'numeric'}))}</span><small class="work-due-relative">${esc(workDueLabel(row))}</small>` : 'Без срока',className:workIsLate(row)?'work-warning':''},
                        {label:'Постановщик',value:person(row.requester_id) || row.requester_name || 'Не указан'},
                        {label:'Приёмщик',value:person(row.acceptor_id) || (row.acceptance_required?'Не назначен':'Не требуется')}
                    ]})}${sectionCard({title:'Ожидаемый результат',variant:'plain',level:4,className:'work-card-description',content:`<p>${esc(row.description || 'Пока не описан')}</p>`})}</section>` : ''}
                    ${row ? `<p class="work-next-step" role="note">${esc(nextStep)}</p>` : ''}
                    ${row?.return_feedback ? `<section class="work-return-feedback" role="note"><h3>Возвращено на доработку</h3><p>${esc(row.return_feedback.reason)}</p><p class="work-muted">${esc(row.return_feedback.actor_name)} · ${esc(dateTime(row.return_feedback.created_at))}</p>${action('Показать историю', 'show-history', {variant:'ghost'})}</section>` : ''}
                    ${row && !editable ? checklistView(row) : ''}
                    ${!row ? `<p class="work-create-context">Команда: ${esc(options.teams.find(t=>t.id===Number(draft.execution_team_id))?.name || 'Не выбрана')} · ${draft.major_task_id?'Связана с задачей № '+esc(draft.major_task_id):draft.direct_project_id?'Проект: '+esc(options.projects.find(p=>p.id===Number(draft.direct_project_id))?.name || draft.direct_project_id):'Самостоятельная задача'}</p>` : ''}${!row && options.can_create ? '<div data-work-templates></div>' : ''}
                    <form novalidate id="work-card-form" class="work-form"${editing ? '' : ' hidden'}>
                        ${f('title', 'Название', { className: 'work-title-field', required: true, attrs: { maxlength: 255 } })}
                        ${f('description', 'Ожидаемый результат', { kind: 'textarea' })}
                        ${row && ['in_progress','in_acceptance'].includes(row.status) ? f('change_reason','Причина изменения условий или приёмщика',{kind:'textarea',hint:'Обязательна при изменении ожиданий или приёмщика. Предъявленный результат будет возвращён на доработку.'}) : ''}
                        ${f('priority', 'Приоритет', {kind:'select',options:Object.entries(WORK_PRIORITIES).map(([value,label])=>({value,label}))})}
                        <details class="ui-collapse-section work-card-details" ${checklistValue(draft.checklist).length ? 'open' : ''}><summary class="ui-disclosure-text">Состав чек-листа</summary><input type="hidden" id="wf-checklist" data-work-field="checklist" value="${esc(draft.checklist)}"><div data-checklist-editor></div></details>
                        <div class="work-two work-assignment-fields">${f('assignee_id', 'Исполнитель', { kind: 'select', disabled: !editable && !row?.can_decide_assignment, options: opt(options.users.filter(u => u.team_id === Number(draft.execution_team_id)), 'Не назначен') })}${f('due_date', 'Срок', { type: 'date', disabled: !editable && !row?.can_decide_assignment })}</div><p class="work-muted" data-work-assignment-note hidden>Исполнителя назначит принимающая команда после принятия поручения.</p>
                        <div class="work-card-options"><details class="ui-collapse-section work-card-details"><summary class="ui-disclosure-text">Команда и связь с проектом</summary><div class="work-two">
                            ${f('execution_team_id', 'Команда выполнения', { kind: 'select', options: opt(options.teams), disabled: !!row || !editable })}
                            ${f('work_direction', 'Направление', { kind: 'select', options: [{ value: 'organizational', label: 'Организационное' }, { value: 'product', label: 'Продуктовое' }], disabled: !!row || !editable })}
                            ${f('acceptor_id', 'Приёмщик', { kind: 'select', options: opt(options.users) })}
                            ${!row ? f('acceptance_required', 'Приёмка результата', { kind: 'select', value: String(draft.acceptance_required === true || draft.acceptance_required === 'true'), options: [{ value: 'false', label: 'Не обязательна для своей команды' }, { value: 'true', label: 'Обязательна' }] }) : `<p class="work-muted work-acceptance-note">Приёмка ${row.acceptance_required ? 'обязательна' : 'не обязательна'}</p>`}
                        </div>${!row ? `<div class="work-two">${f('direct_project_id', 'Прямой проект', { kind: 'select', options: opt(options.projects, 'Самостоятельная или в задаче') })}${f('major_task_id', 'Номер текущей задачи', { type: 'number', hint: 'Укажите проект или задачу; пустые поля — самостоятельная работа.' })}</div>` : ''}</details>
                        </div>
                    </form>
                    ${row?.result_text ? sectionCard({title:'Результат работы',variant:'plain',className:'work-saved-result',content:`<p class="work-result-text">${esc(row.result_text)}</p>`}) : ''}
                    ${actions.length || row?.can_decide_assignment ? `<section class="work-execution"><div class="work-actions" data-status-actions>${actions.filter(s => s !== 'cancelled').map(s => action(transitionLabel(s), 'transition:' + s, { variant: s === primary && !row.can_decide_assignment ? 'primary' : 'secondary' })).join('')}${actions.includes('cancelled') ? `<details class="work-more-actions"><summary class="ui-disclosure-text">Ещё</summary>${action('Отменить задачу', 'transition:cancelled', {variant:'ghost'})}</details>` : ''}${row.can_decide_assignment ? action('Принять назначение', 'accept-assignment', { variant: 'primary' }) + action('Отклонить назначение', 'decline-assignment') : ''}</div><form class="work-transition-form" hidden><h3 data-transition-title></h3><div data-transition-fields></div><div class="work-actions">${button({ label: 'Подтвердить', variant: 'primary', attrs: { type: 'submit', 'data-confirm-transition': '' } })}${action('Назад', 'cancel-transition', { variant: 'ghost' })}</div></form></section>` : ''}
                `)}
                ${row ? panel('activity', `${row.can_collaborate ? `<form class="work-comment-form">${f('comment', 'Комментарий', { kind: 'textarea', disabled: false, attrs: { rows: 1, placeholder: 'Обсудите задачу или уточните результат' } })}${button({ label: 'Отправить комментарий', variant: 'primary', attrs: { type: 'submit' } })}</form>` : ''}<div class="work-collaboration" aria-live="polite">Загрузка…</div>`) : ''}
                ${row ? panel('resources', `<section class="work-files"><h3>Файлы</h3><div data-work-files>Загрузка…</div>${row.can_collaborate ? fileUpload({id:'work-attachment-file-'+id,label:'Добавить файл',hint:'До 50 МБ',className:'work-upload',inputAttrs:{class:'ui-file-input','data-work-upload':''}}) : ''}</section><div data-work-relations></div>${row.can_place ? `<details class="ui-collapse-section work-card-details"><summary class="ui-disclosure-text">Переместить или отвязать</summary><p class="work-muted">Выберите один новый контекст. Пустые поля сделают задачу самостоятельной.</p><div class="work-two">${f('move-major', 'Номер текущей задачи', { type: 'number', disabled: false })}${f('move-project', 'Прямой проект', { kind: 'select', options: opt(options.projects), disabled: false })}</div>${f('move-reason', 'Причина переноса', { kind: 'textarea', disabled: false })}${action('Подтвердить перенос', 'move')}</details>` : ''}${row.can_reassign ? `<details class="ui-collapse-section work-card-details"><summary class="ui-disclosure-text">Предложить другой команде</summary><p class="work-muted">Исполнитель будет снят; новая команда должна принять назначение.</p>${f('reassign-team', 'Новая команда', { kind: 'select', options: opt(options.teams), disabled: false })}${f('reassign-reason', 'Причина передачи', { kind: 'textarea', disabled: false })}${action('Предложить команде', 'reassign')}</details>` : ''}`) : ''}
            </div>
            <footer class="work-dialog-footer"><span class="work-save-status" role="status">${editable ? '' : 'Просмотр задачи'}</span><div class="work-actions" data-edit-actions${editing ? '' : ' hidden'}>${editable ? action(row ? 'Сохранить изменения' : 'Создать', 'save', { variant: row ? 'secondary' : 'primary' }) : ''}</div></footer>`;

        const savedResult = dialog.querySelector('.work-saved-result');
        window.lucide?.createIcons();
        const cardTitle=dialog.querySelector('.work-card-title');
        if(cardTitle){
            dialog.querySelector('.work-dialog-context').before(cardTitle);
            cardTitle.hidden = !!editable;
            cardTitle.tabIndex=0;
            cardTitle.setAttribute('aria-label',row.title);
        }
        if (savedResult && ['in_acceptance','done'].includes(row?.status)) {
            dialog.querySelector('#work-card-task-panel').prepend(savedResult);
            if(row.status==='done')savedResult.insertAdjacentHTML('beforeend',`<p class="work-muted">Выполнена: ${esc(dateTime(row.completed_at)||'Дата не указана')}</p>`);
        }
        if(row){
            const properties=dialog.querySelector('.work-card-properties');
            const extra = document.createElement('div');
            extra.innerHTML = descriptionList({items:[
                {label:'Команда',value:options.teams.find(t=>t.id===row.execution_team_id)?.name||'Не указана'},
                {label:'Направление',value:row.work_direction==='product'?'Продуктовое':'Организационное'},
                {label:'Приоритет',value:WORK_PRIORITIES[row.priority||'normal']}
            ]});
            properties.append(...extra.querySelector('dl').children);
            const details=document.createElement('details');details.className='ui-collapse-section work-card-details';details.innerHTML='<summary class="ui-disclosure-text">Дополнительные сведения</summary><dl class="ui-description-list work-card-properties"></dl>';
            [...properties.children].filter((_,i)=>[2,4,5,6].includes(i)).forEach(el=>details.querySelector('dl').append(el));
            dialog.querySelector('.work-card-overview').append(details);
            if (!editable) {
                properties.classList.replace('work-card-properties','ui-detail-summary');
                dialog.querySelector('#work-card-task-panel').prepend(properties);
            }
            if(savedResult && row.status==='in_acceptance' && !editable){
                const expected=dialog.querySelector('.work-card-description');
                savedResult.after(expected);
                const checklist=dialog.querySelector('.work-checklist-view');
                if(checklist)expected.after(checklist);
            }
            if(activeWork&&row.return_feedback){
                const feedback=dialog.querySelector('.work-return-feedback')||dialog.querySelector('.work-next-step');
                if(feedback){
                    if(savedResult && row.status==='in_acceptance')savedResult.after(feedback);
                    else dialog.querySelector('#work-card-task-panel').prepend(feedback);
                }
            }
        }
        if(row?.status==='new'){
            const missing=row.readiness?.missing_fields||['description','assignee_id','due_date'].filter(name=>!row[name]);
            const labels={description:'ожидаемый результат',assignee_id:'исполнитель',due_date:'срок'};
            dialog.querySelector('.work-card-title').insertAdjacentHTML('afterend',`<p class="work-readiness">${missing.length?'Для готовности нужны: '+missing.map(x=>labels[x]||x).join(', '):'Обязательные сведения заполнены'}${row.assignment_state==='proposed'?'. Ожидается принятие назначения командой':''}</p>`);
        }
        for(const [id,name] of [['#wf-move-major','placement'],['#wf-reassign-team','reassignment']]){
            const section=dialog.querySelector(id)?.closest('details');if(section){section.hidden=true;section.open=true;section.dataset.contextAction=name;dialog.querySelector('#work-card-task-panel').append(section);}
        }
        const statusActions = dialog.querySelector('[data-status-actions]');
        if(statusActions){
            const more=dialog.querySelector('[data-card-menu]');
            statusActions.querySelectorAll('[data-work-action]').forEach(control=>{
                const name=control.dataset.workAction;
                const keep=name==='accept-assignment'||name==='decline-assignment'||name==='transition:'+primary||row?.status==='in_acceptance'&&name==='transition:in_progress';
                if(!keep&&more)more.append(control);
            });
            statusActions.querySelectorAll('details').forEach(el=>el.remove());
        }
        if (statusActions) dialog.querySelector('.work-dialog-footer').append(statusActions);
        const editButton=dialog.querySelector('[data-work-action=edit]');if(editButton)dialog.querySelector('.work-dialog-footer').prepend(editButton);
        if(row)cardMenu=bindActionMenu({trigger:dialog.querySelector('[data-card-menu-trigger]'),panel:dialog.querySelector('[data-card-menu]'),label:'Дополнительные действия',align:'end'});
        if (!inline) enhanceDialogOverlay(dialog, origin);
        const q = selector => dialog.querySelector(selector);
        const checklistEditor = mountChecklistEditor(q('[data-checklist-editor]'), q('#wf-checklist'), editable, {
            completion: !!row && !!editable, canCheck: !!row?.can_check, savedIds: (row?.checklist || []).map(item => item.id)
        });
        if (row && editable) {
            const checklist = q('#wf-checklist').closest('details');
            checklist.replaceWith(q('#wf-checklist'), q('[data-checklist-editor]'));
            const title = q('#wf-title').closest('.ui-field');
            q('.work-card-title').remove();
            title.classList.add('work-card-title-editor');
            // One editable representation; the read-only overview is only for viewers.
            q('.work-card-overview').remove();
            const primaryFields = document.createElement('div');
            primaryFields.className = 'work-primary-fields';
            primaryFields.append(q('.work-assignment-fields'), q('#wf-priority').closest('.ui-field'));
            q('#wf-description').closest('.ui-field').before(primaryFields);
            q('#wf-acceptor_id').closest('.work-two').insertAdjacentHTML('beforeend', `<p class="work-muted">Постановщик: ${esc(person(row.requester_id) || row.requester_name || 'Не указан')}</p>`);
        }
        if (!row || editable) {
            const title = q('#wf-title').closest('.ui-field');
            title.classList.add('work-card-title-editor');
            q('#wf-title').setAttribute('form', 'work-card-form');
            const context = q('.work-dialog-context');
            if (context) context.before(title);
            else q('.work-dialog-head').append(title);
        }
        if (row && !editable) q('#wf-checklist').closest('details').hidden = true;
        const syncChangeReason = () => {
            const reason = q('#wf-change_reason');
            if (!reason) return;
            reason.closest('.ui-field').hidden = !reason.value && q('#wf-description').value === (row.description || '') && String(q('#wf-acceptor_id').value) === String(row.acceptor_id || '');
        };
        listen(dialog, 'input', syncChangeReason);
        listen(dialog, 'change', syncChangeReason);
        syncChangeReason();
        const setEditing = value => {
            editing = value;
            q('.work-form').hidden = !value;
            q('[data-edit-actions]').hidden = !value;
            if (q('.work-card-overview')) q('.work-card-overview').hidden = value;
        };
        if (overview) setEditing(editing);
        if (inline && hadFocus) controller.focus();
        mountWorkPicker(q('#wf-major_task_id'),app,{editable:true,label:'Задача бэклога',selected:majorId ? row?.context?.title || '' : ''});
        if(!row){
            const acceptance=q('#wf-acceptance_required').closest('.ui-field'),acceptor=q('#wf-acceptor_id').closest('.ui-field');q('.work-assignment-fields').after(acceptance,acceptor);
            q('.work-card-options').insertAdjacentHTML('beforebegin',collapseSection({label:'Приоритет и чек-лист',className:'work-card-details',attrs:{'data-productivity-options':''}}));
            const productivity=q('[data-productivity-options]');
            productivity.append(q('#wf-priority').closest('.ui-field'),q('#wf-checklist').closest('details'));
            productivity.open=draft.priority && draft.priority!=='normal' || checklistValue(draft.checklist).length>0;
            q('.work-assignment-fields').insertAdjacentHTML('afterend','<p class="work-muted work-create-hint">Для передачи в работу нужны ожидаемый результат, исполнитель и срок.</p>');
            const project=q('#wf-direct_project_id').closest('.ui-field'),major=q('#wf-major_task_id').closest('.ui-field');
            project.parentElement.insertAdjacentHTML('beforebegin',field({id:'wf-context-kind',label:'Контекст',kind:'select',value:draft.major_task_id?'major':draft.direct_project_id?'project':'standalone',options:[{value:'standalone',label:'Самостоятельная'},{value:'project',label:'В проекте'},{value:'major',label:'В крупной задаче'}]}));
            const context=q('#wf-context-kind');
            const syncContext=()=>{project.hidden=context.value!=='project';major.hidden=context.value!=='major';if(context.value!=='project')q('#wf-direct_project_id').value='';if(context.value!=='major')q('#wf-major_task_id').value='';};
            syncContext();listen(context,'change',()=>{syncContext();persist();});
        }
        mountWorkPicker(q('#wf-move-major'),app,{editable:true,label:'Задача бэклога'});
        const syncCreateContext=()=>{const note=q('.work-create-context');if(note)note.textContent=`Команда: ${options.teams.find(t=>t.id===Number(q('#wf-execution_team_id').value))?.name || 'Не выбрана'} · ${q('#wf-major_task_id').value?'Связана с задачей № '+q('#wf-major_task_id').value:q('#wf-direct_project_id').value?'Проект: '+(options.projects.find(p=>p.id===Number(q('#wf-direct_project_id').value))?.name || q('#wf-direct_project_id').value):'Самостоятельная задача'}`;};listen(dialog,'change',syncCreateContext);
        const syncAssignment = () => {
            const crossTeam = !row && Number(q('#wf-execution_team_id').value) !== Number(app.store.get('currentUser')?.team_id);
            const pendingOtherTeam = row?.assignment_state === 'proposed' && !row.can_decide_assignment;
            q('#wf-assignee_id').disabled = (!editable && !row?.can_decide_assignment) || crossTeam || pendingOtherTeam;
            if (crossTeam) q('#wf-assignee_id').value = '';
            if(!row){const required=q('#wf-acceptance_required');required.disabled=crossTeam;if(crossTeam)required.value='true';q('#wf-acceptor_id').closest('.ui-field').hidden=required.value!=='true'&&!q('#wf-acceptor_id').value;}
            q('[data-work-assignment-note]').hidden = !crossTeam && !pendingOtherTeam;
        };
        syncAssignment();
        const loginNote=document.createElement('p');loginNote.className='work-assignment-warning';loginNote.setAttribute('role','status');q('.work-assignment-fields').after(loginNote);
        const showLoginNotice=()=>{loginNote.textContent=['assignee_id','acceptor_id'].map(name=>{const u=options.users.find(u=>u.id===Number(q('#wf-'+name).value));return u?.login_notice ? `${name==='assignee_id'?'Исполнитель':'Приёмщик'}: ${u.login_notice}. До завершения этого шага человек не сможет войти и обработать задачу.` : '';}).filter(Boolean).join(' ');loginNote.hidden=!loginNote.textContent;};
        listen(dialog,'change',showLoginNotice);showLoginNotice();
        if(!row)listen(q('#wf-acceptance_required'),'change',syncAssignment);
        const read = () => ({ ...pendingDraft, ...Object.fromEntries([...dialog.querySelectorAll('[data-work-field]')].map(el => [el.dataset.workField, el.value])) });
        let pendingDraft = { result_text: draft.result_text || '', reason: draft.reason || '' };
        const savedValues = Object.fromEntries([...q('.work-form').elements].filter(el => el.matches('[data-work-field]')).map(el => [el.dataset.workField, el.dataset.workField === 'checklist' ? JSON.stringify(base.checklist || []) : el.dataset.workField === 'priority' ? base.priority || 'normal' : String(base[el.dataset.workField] ?? '')]));
        const saveStatus = text => { q('.work-save-status').textContent = text; };
        const storeDraft = value => {
            const delta = Object.fromEntries(Object.entries(value).filter(([name, text]) => row && name in savedValues ? String(text ?? '') !== savedValues[name] : name === 'result_text' ? text !== (row?.result_text || '') : text !== ''));
            Object.keys(delta).length ? sessionStorage.setItem(key, JSON.stringify(delta)) : sessionStorage.removeItem(key);
        };
        const persist = () => {
            try { storeDraft(read()); draftFailed=false;saveStatus('Есть несохранённые изменения. Черновик сохранён в этой вкладке'); }
            catch { draftFailed=true;saveStatus('Черновик не сохранён — не закрывайте карточку'); }
        };
        const clearFields = fields => {
            const value = read();
            fields.forEach(name => { delete value[name]; delete pendingDraft[name]; });
            try { storeDraft(value); } catch { /* Saving on server succeeded. */ }
        };
        const showError = text => { q('.work-error').textContent = text; q('.work-error').focus(); };
        const revealSection = (name) => {
            const section = q(`#work-card-${name}-panel`);
            if (section?.matches('details')) { section.open = true; section.scrollIntoView({block:'nearest'}); }
        };
        listen(dialog, 'input', e => { if (e.target.matches('[data-work-field]')) { if (e.target.dataset.workField === 'title') e.target.setCustomValidity(''); persist(); } });
        listen(dialog, 'change', e => { if (e.target.matches('[data-work-field]')) persist(); });
        q('#wf-execution_team_id').addEventListener('change', e => {
            q('#wf-assignee_id').innerHTML = opt(options.users.filter(u => u.team_id === Number(e.target.value)), 'Не назначен').map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join('');
            syncAssignment();
            persist();
        });
        let activityPages = {comments: [], history: []};
        let activityCursors = {comments: null, history: null};
        let activityRequest = 0;
        const loadActivity = async (older = null) => {
            const ticket = ++activityRequest;
            try {
                const previousMode = q('#work-activity-mode')?.value || 'all';
                const scroll = q('.work-collaboration').parentElement;
                const previousScroll = scroll.scrollTop;
                const previousHeight = scroll.scrollHeight;
                const pages = await Promise.all(['comments','history'].filter(kind => !older || kind === older).map(async kind => {
                    const cursor = older ? activityCursors[kind] : null;
                    const page = await app.api.get(`/work-tasks/${id}/${kind}?paginated=true${cursor ? '&before='+cursor : ''}`);
                    return {kind, page};
                }));
                if (!dialog.isConnected || request !== renderGeneration || ticket !== activityRequest) return;
                for (const {kind, page} of pages) {
                    const items = Array.isArray(page) ? page : page.items;
                    activityPages[kind] = older ? (kind === 'comments' ? [...items, ...activityPages[kind]] : [...activityPages[kind], ...items]) : items;
                    activityCursors[kind] = page.next_cursor || null;
                }
                const {comments, history} = activityPages;
                const composer=q('.work-comment-form');if(composer)q('.work-collaboration').after(composer);
                const displayChange = (field,value) => field==='status' ? WORK_STATUSES[value] || value : field==='assignment_state' ? ({proposed:'Предложено',accepted:'Принято',declined:'Отклонено'}[value] || value) : value;
                q('.work-collaboration').innerHTML = `<h3>Комментарии · ${comments.length}</h3>${comments.map(c => `<article class="work-comment" data-event-time="${esc(c.created_at || '')}"><div class="work-activity-meta"><strong>${esc(options.users.find(u => u.id === c.author_id)?.name || 'Участник')}</strong><time>${esc(dateTime(c.created_at))}</time></div><p>${esc(c.body)}</p></article>`).join('') || '<p class="work-muted">Комментариев пока нет.</p>'}<details class="ui-collapse-section work-card-details" data-work-history><summary class="ui-disclosure-text">История изменений · ${history.length}</summary>${history.map(h => `<article class="work-history-item" data-event-time="${esc(h.created_at || '')}"><div class="work-activity-meta"><strong>${esc(HISTORY[h.action] || ({dependency_added:'Добавлена зависимость',dependency_removed:'Снята зависимость'}[h.action]) || 'Изменение')}</strong><span>${esc(h.actor_name || 'Участник')}</span><time>${esc(dateTime(h.created_at))}</time></div><details class="work-history-details"><summary class="ui-disclosure-text">Подробности изменения</summary>${(h.changes || []).map(c=>`<p>${esc(c.label)}: ${esc(displayChange(c.field,c.before))} → ${esc(displayChange(c.field,c.after))}</p>`).join('')}${h.reason ? `<p>${esc(h.reason)}</p>` : ''}${h.previous_result ? `<p>Предыдущий результат: ${esc(h.previous_result)}</p>` : ''}</details></article>`).join('') || '<p class="work-muted">История пуста.</p>'}</details>`;
                const activity=q('.work-collaboration');
                for (const kind of ['comments','history']) {
                    if (!activityCursors[kind]) continue;
                    const host = kind === 'comments' ? activity : activity.querySelector('[data-work-history]');
                    host.insertAdjacentHTML('beforeend', button({label: kind === 'comments' ? 'Предыдущие комментарии' : 'Более ранние изменения', variant:'secondary', attrs:{'data-older-activity':kind}}));
                }
                activity.querySelectorAll('[data-older-activity]').forEach(el => el.onclick = async () => {
                    el.disabled = true;
                    await loadActivity(el.dataset.olderActivity);
                });
                activity.insertAdjacentHTML('afterbegin', segmentedControl({label:'Вид активности',className:'work-activity-filters',size:'small',value:'all',items:[['all','Всё'],['comments','Комментарии'],['history','Изменения']].map(([mode,label])=>({value:mode,label,attrs:{'data-activity-mode':mode}}))})+field({id:'work-activity-mode',label:'Показать',kind:'select',options:[{value:'comments',label:'Комментарии'},{value:'history',label:'История'},{value:'all',label:'Всё'}]}));
                const timeline=document.createElement('div');timeline.className='work-activity-timeline';activity.querySelector('[data-work-history]').before(timeline);
                const commentNodes=[...activity.querySelectorAll('.work-comment')],eventNodes=[...activity.querySelectorAll('.work-history-item')];
                const filterActivity=()=>{
                    const mode=q('#work-activity-mode').value,history=activity.querySelector('[data-work-history]');
                    commentNodes.forEach(el=>history.before(el));eventNodes.forEach(el=>history.append(el));
                    const commentForm=q('.work-comment-form');if(commentForm)commentForm.hidden=mode==='history';
                    activity.querySelectorAll('[data-activity-mode]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.activityMode===mode)));
                    activity.querySelectorAll(':scope > h3,:scope > .work-comment,:scope > p').forEach(el=>el.hidden=mode==='history'||mode==='all'&&!el.matches('.work-comment'));
                    history.hidden=mode==='comments';history.open=mode!=='comments';history.classList.toggle('is-timeline',mode==='all');
                    timeline.hidden=mode!=='all';
                    if(mode==='all')[...commentNodes,...eventNodes].sort((a,b)=>(b.dataset.eventTime||'').localeCompare(a.dataset.eventTime||'')).forEach(el=>{el.hidden=false;timeline.append(el);});
                    if(mode==='all'&&!commentNodes.length&&!eventNodes.length)timeline.textContent='Событий пока нет.';
                };
                q('#work-activity-mode').closest('.ui-field').hidden=true;q('#work-activity-mode').value=previousMode;q('#work-activity-mode').onchange=filterActivity;activity.querySelectorAll('[data-activity-mode]').forEach(el=>el.onclick=()=>{q('#work-activity-mode').value=el.dataset.activityMode;filterActivity();});filterActivity();
                if (older) scroll.scrollTop = previousScroll + (older === 'comments' ? scroll.scrollHeight - previousHeight : 0);
            } catch (e) {
                if (!dialog.isConnected || ticket !== activityRequest) return;
                const activity = q('.work-collaboration');
                if (older) {
                    activity.querySelector('[data-activity-error]')?.remove();
                    activity.insertAdjacentHTML('afterbegin', '<p role="alert" data-activity-error>'+esc(message(e))+'</p>');
                    activity.querySelectorAll('[data-older-activity]').forEach(el => el.disabled = false);
                } else activity.textContent = message(e);
            }
        };
        const loadFiles = async () => {
            try {
                const files = await app.api.get(`/work-tasks/${id}/attachments`);
                if (dialog.isConnected && request === renderGeneration) q('[data-work-files]').innerHTML = files.map(file => `<div class="work-file">${button({ label: file.filename, variant: 'ghost', attrs: { 'data-download': file.id, 'data-filename': file.filename } })}<span class="work-muted">${esc(formatFileSize(file.size))}</span></div>`).join('') || '<p class="work-muted">Файлов пока нет.</p>';
            } catch (e) { if (dialog.isConnected) q('[data-work-files]').textContent = message(e); }
        };
        const send = async (operation, { clear = [], stay = false, refresh = false, after = async () => {} } = {}) => {
            if (busy) return;
            if(!navigator.onLine){showError('Нет связи. Черновик сохранён локально. Повторите после восстановления сети.');persist();return;}
            ++mutationEpoch; busy = true; q('.work-error').textContent = ''; dialog.setAttribute('aria-busy', 'true');
            // Keep controls stable and prevent edits while their values are being sent.
            const enabled = [...dialog.querySelectorAll('button, input, select, textarea')].filter(el => !el.disabled);
            const focusBeforeSave = document.activeElement;
            enabled.forEach(el => { el.disabled = true; }); saveStatus('Сохранение…');
            let success = false, saved;
            try {
                const result = await operation();
                if (!dialog.isConnected) return;
                saved = result;
                if (row && result?.version) row.version = result.version;
                clearFields(clear); await after(result); success = true;
                saveStatus('Сохранено');
            } catch (e) {
                if (!dialog.isConnected) return;
                showError(message(e)); saveStatus('Не удалось сохранить');
                if(Number(e.status)===409&&row){
                    persist();
                    try{
                        const fresh=await app.api.get('/work-tasks/'+id);
                        if(!dialog.isConnected)return;
                        q('[data-work-conflict]')?.remove();
                        const conflict=document.createElement('section');conflict.dataset.workConflict='';conflict.className='work-conflict';
                        const labels={title:'Название',description:'Ожидаемый результат',due_date:'Срок',priority:'Приоритет',result_text:'Результат работы',status:'Статус'};
                        conflict.innerHTML='<h3>Задача изменена другим участником</h3><p>Ваш ввод сохранён. Сравните значения перед повтором.</p>'+Object.entries(labels).filter(([name])=>String(row[name]??'')!==String(fresh[name]??'')).map(([name,label])=>`<dl><dt>${label}</dt><dd>Было: ${esc(row[name]||'—')}</dd><dd>Сейчас: ${esc(fresh[name]||'—')}</dd><dd>Мой ввод: ${esc(read()[name]||'—')}</dd></dl>`).join('')+action('Загрузить актуальную версию и мой черновик','resolve-conflict');
                        conflict.onclick=async event=>{if(event.target.closest('[data-work-action=resolve-conflict]')){persist();await render();saveStatus('Актуальная версия загружена. Проверьте черновик и явно сохраните изменения.');}};
                        q('.work-dialog-body').prepend(conflict);conflict.scrollIntoView({block:'nearest'});
                    }catch(readError){if([403,404].includes(Number(readError.status)))await render();else showError('Не удалось загрузить актуальную версию. Ваш ввод сохранён.');}
                }
            }
            finally { busy = false; dialog.removeAttribute('aria-busy'); enabled.forEach(el => { el.disabled = false; }); }
            if (closeAfterNavigation) { close(false); return; }
            if (success) {
                if (overview && !row && saved?.id) id = saved.id;
                if (refresh || (overview && !stay)) {
                    await render();
                    (dialog.querySelector('[data-status-actions] button') || dialog.querySelector('[data-work-action=save]') || dialog.querySelector('[data-close]'))?.focus();
                } else if (!stay) close();
                else if (focusBeforeSave?.isConnected) focusBeforeSave.focus();
                try { await changed({ ...saved, id }); } catch { /* The mutation succeeded; the parent owns reload errors. */ }
                if (!inline && !stay && !refresh) restoreFocus();
            }
        };
        listen(dialog, 'input', event => {if(event.target.matches('[data-card-width]'))presentation.onWidth?.(Number(event.target.value));});
        listen(dialog, 'change', async event => {
            const checkbox = event.target.closest('[data-check-item]');
            if (!checkbox || !row?.can_check || busy) return;
            const itemId = checkbox.dataset.checkItem, completed = checkbox.checked;
            checkbox.checked = !completed;
            await send(() => app.api.patch(`/work-tasks/${id}/checklist/${encodeURIComponent(itemId)}`, {version:row.version,completed}), {
                stay:true,
                after: async result => {
                    row.checklist = result.checklist;
                    savedValues.checklist = JSON.stringify(result.checklist);
                    const items = checklistValue(q('#wf-checklist').value).map(item => item.id === itemId ? {...item,completed} : item);
                    checklistEditor.replace(items);
                    try {storeDraft(read());} catch { /* Keep the existing draft if storage is unavailable. */ }
                    if (!editable) {
                        checkbox.checked = completed;
                        q('[data-checklist-count]').textContent = checklistCount(result.checklist);
                        q('.work-checklist-view .ui-progress').outerHTML = checklistProgress(result.checklist);
                    }
                    dialog.querySelectorAll('[data-check-item]').forEach(control => {
                        if (control.dataset.checkItem === itemId) control.focus({preventScroll:true});
                    });
                }
            });
        });
        if (q('[data-work-templates]')) mountWorkTemplates(q('[data-work-templates]'), app, {
            canApply:!row, isBusy:()=>busy,
            getContent:()=>{
                const v=read();
                return {title:v.title,description:v.description,priority:v.priority,work_direction:v.work_direction,
                    acceptance_required:row ? row.acceptance_required : v.acceptance_required==='true',
                    checklist:checklistValue(v.checklist).map(x=>x.title)};
            },
            apply:content=>{
                for (const name of ['title','description','priority','work_direction','acceptance_required']) {
                    const input=q('#wf-'+name);if(input)input.value=String(content[name]);
                }
                checklistEditor.replace(content.checklist.map(title=>({id:crypto.randomUUID(),title,completed:false})));
                q('#wf-checklist').closest('details').open=content.checklist.length>0;
                const productivity=q('[data-productivity-options]');if(productivity)productivity.open=content.priority!=='normal'||content.checklist.length>0;
                syncAssignment();
                persist();q('#wf-title').focus();
            }
        });
        q('.work-form').onsubmit = e => {
            e.preventDefault(); if (!editable) return;
            const v = read();
            clearFormErrors(dialog);const errors={};
            if(!v.title.trim())errors['wf-title']='Укажите название задачи';
            [...q('.work-form').elements].filter(el=>el.matches(':invalid')).forEach(el=>{errors[el.id] ||= el.validationMessage;});
            if(Object.keys(errors).length){showFormErrors(dialog,errors);q('.work-form').prepend(q('[data-ui-error-summary]'));return;}
            const values = { title: v.title.trim(), description: v.description, priority:v.priority, checklist:checklistValue(v.checklist), assignee_id: number(v.assignee_id), due_date: v.due_date || null, acceptor_id: number(v.acceptor_id) };
            if (row) {
                const patch = Object.fromEntries(Object.entries(values).filter(([name, value]) => name === 'checklist' ? JSON.stringify(value) !== JSON.stringify(row.checklist || []) : name === 'priority' ? value !== (row.priority || 'normal') : String(value ?? '') !== String(row[name] ?? '')));
                if (v.change_reason?.trim()) patch.reason = v.change_reason.trim();
                send(() => app.api.patch('/work-tasks/' + id, { ...patch, version: row.version }), { clear: Object.keys(savedValues) });
            } else {
                send(() => app.api.request('POST', '/work-tasks', { ...values, execution_team_id: number(v.execution_team_id), work_direction: v.work_direction, acceptance_required: v.acceptance_required === 'true', major_task_id: number(v.major_task_id), direct_project_id: number(v.direct_project_id) }, { idempotencyKey: createKey }), { clear: Object.keys(read()) });
            }
        };
        const save = () => {
            if (busy || !editable) return;
            revealSection('task');
            if (inline) setEditing(true);
            q('.work-form').querySelectorAll(':invalid').forEach(el => { const details = el.closest('details'); if (details) details.open = true; });
            q('.work-form').requestSubmit();
        };
        let selectedAction = null;
        const cancelTransition = () => {
            const v = read(); pendingDraft = { result_text: v.result_text, reason: v.reason }; q('.work-transition-form').hidden = true; q('[data-status-actions]').hidden = false;
            q(`[data-work-action="${selectedAction}"]`)?.focus(); selectedAction = null;
        };
        const chooseTransition = name => {
            if(q('[data-card-menu]'))q('[data-card-menu]').open=false;
            selectedAction = name;
            const target = name.split(':')[1];
            const reasonRequired = target === 'cancelled' || ['done','cancelled'].includes(row.status) || (row.status === 'in_acceptance' && target === 'in_progress') || name === 'decline-assignment';
            const accepting = row.status === 'in_acceptance' && target === 'done';
            const resultRequired = !accepting && ['done', 'in_acceptance'].includes(target);
            if (target && !reasonRequired && !resultRequired && !accepting) {
                send(() => transitionWork(app,row,target), {refresh:true});
                return;
            }
            const v = read(); pendingDraft = { result_text: v.result_text, reason: v.reason };
            const label = target ? transitionLabel(target) : name === 'accept-assignment' ? 'Принять назначение' : 'Отклонить назначение';
            q('[data-status-actions]').hidden = true;
            q('.work-transition-form').hidden = false;
            q('[data-transition-title]').textContent = label;
            q('[data-confirm-transition] span').textContent = label;
            q('[data-confirm-transition]').classList.toggle('btn-danger', target === 'cancelled');
            q('[data-confirm-transition]').classList.toggle('btn-primary', target !== 'cancelled');
            q('[data-transition-fields]').innerHTML = `${accepting ? '<p>Подтвердите принятие показанного результата. Его текст и редакция останутся без изменений.</p>' : ''}${resultRequired ? field({ id: 'wf-result_text', label: 'Фактический результат', value: v.result_text || row.result_text || '', kind: 'textarea', required: true, attrs: { rows: 3, maxlength:30000, 'data-work-field': 'result_text' } }) : ''}${reasonRequired ? field({ id: 'wf-reason', label: 'Причина', value: v.reason || '', kind: 'textarea', required: true, attrs: { rows: 3, maxlength:5000, 'data-work-field': 'reason' } }) : ''}${resultRequired && (row.checklist||[]).some(x=>!x.completed)?`<p class="work-muted">Не выполнено пунктов: ${row.checklist.filter(x=>!x.completed).length}</p>`:''}<p class="work-muted">${name === 'accept-assignment' ? 'Будут использованы выбранные исполнитель и срок. Изменённое описание сохраните заранее.' : 'Изменения полей задачи сохраняются отдельно кнопкой внизу.'}</p>`;
            (q('.work-transition-form textarea') || q('[data-confirm-transition]')).focus();
        };
        q('.work-transition-form')?.addEventListener('submit', e => {
            e.preventDefault(); const v = read();
            if (selectedAction.startsWith('transition:')) send(() => transitionWork(app,row,selectedAction.split(':')[1],{...(row.status==='in_acceptance' && selectedAction==='transition:done' ? {} : {result_text:v.result_text||''}),reason:v.reason||''}), { clear: ['result_text', 'reason'], refresh:true });
            else send(() => app.api.post(`/work-tasks/${id}/assignment-decisions`, { version: row.version, decision: selectedAction === 'accept-assignment' ? 'accepted' : 'declined', assignee_id: number(v.assignee_id), due_date: v.due_date || null, reason: v.reason || '' }), { clear: ['reason','assignee_id','due_date'], refresh:true });
        });
        q('.work-comment-form')?.addEventListener('submit', e => {
            e.preventDefault(); const comment = q('#wf-comment');
            if (!comment.value.trim()) { comment.setCustomValidity('Напишите комментарий'); comment.reportValidity(); return; }
            send(() => app.api.post(`/work-tasks/${id}/comments`, { version: row.version, body: comment.value.trim() }), { clear: ['comment'], stay: true, after: async () => { comment.value = ''; await loadActivity(); } });
        });
        q('#wf-comment')?.addEventListener('input', e => e.target.setCustomValidity(''));
        q('[data-work-upload]')?.addEventListener('change', e => {
            const input = e.target, file = input.files[0], upload = input.closest('.ui-upload'); if (!file) { setUploadState(upload,'cancelled','Выбор файла отменён'); return; }
            if (file.size > 50 * 1024 * 1024) { setUploadState(upload,'error','Максимальный размер файла — 50 МБ'); showError('Максимальный размер файла — 50 МБ'); input.value = ''; return; }
            const data = new FormData(); data.append('file', file); data.append('version', row.version);
            send(async () => { setUploadState(upload,'uploading','Загрузка файла…'); try { const result = await app.api.post(`/work-tasks/${id}/attachments`, data); setUploadState(upload,'selected','Файл загружен'); return result; } catch(error) { setUploadState(upload,'error',message(error)); throw error; } }, { stay: true, after: async () => { input.value = ''; await Promise.all([loadFiles(), loadActivity()]); } });
        });
        dialog.onclick = async e => {
            if (busy) return;
            const download = e.target.closest('[data-download]');
            if (download) { try { await app.api.download(`/work-tasks/${id}/attachments/${download.dataset.download}/download`, download.dataset.filename); } catch (err) { showError(message(err)); } return; }
            const a = e.target.closest('[data-work-action]')?.dataset.workAction;
            if(a && a!=='card-menu')cardMenu?.close({restoreFocus:false});
            if (a === 'fullscreen') {userFullscreen=!userFullscreen;controller.layout(lastLayout);const control=e.target.closest('button'),label=control?.querySelector('span'),text=userFullscreen?'Обычный размер':'На весь экран';if(label)label.textContent=text;control?.setAttribute('aria-label',text);control?.setAttribute('title',text);}
            if (a === 'close') close();
            if (a === 'save') save();
            if (a === 'edit') {
                setEditing(true);
                (q('.work-form input:not(:disabled)') || q('.work-form textarea:not(:disabled)'))?.focus();
            }
            if (a === 'view') { setEditing(false); q('[data-work-action=edit]')?.focus(); }
            if (a === 'show-history') { revealSection('activity'); const history=q('[data-work-history]'); if(history){if(q('#work-activity-mode')){q('#work-activity-mode').value='history';q('#work-activity-mode').onchange();}history.hidden=false;history.open=true;history.scrollIntoView({block:'nearest'});} }
            if (!row) return;
            if(a==='copy-link'){try{await navigator.clipboard.writeText(location.origin+location.pathname+'#/work-tasks/'+row.id);saveStatus('Ссылка скопирована');}catch{showError('Не удалось скопировать ссылку. Скопируйте адрес страницы.');}}
            if(a==='show-template'){
                revealSection('task');let host=q('[data-save-template]');if(!host){host=document.createElement('div');host.dataset.saveTemplate='';q('#work-card-task-panel').append(host);mountWorkTemplates(host,app,{canApply:false,isBusy:()=>busy,getContent:()=>({title:row.title,description:row.description,priority:row.priority||'normal',work_direction:row.work_direction,acceptance_required:row.acceptance_required,checklist:(row.checklist||[]).map(x=>x.title)}),apply:()=>{}});host.querySelector('details').open=true;}host.scrollIntoView({block:'nearest'});
            }
            if(a==='show-placement'||a==='show-reassignment'){revealSection('task');const section=q(`[data-context-action="${a.slice(5)}"]`);section.hidden=false;section.scrollIntoView({block:'nearest'});section.querySelector('input:not([type=hidden]),select,textarea')?.focus();}
            if(a?.startsWith('show-'))q('[data-card-menu]').open=false;
            const v = read();
            if (a?.startsWith('transition:') || ['accept-assignment', 'decline-assignment'].includes(a)) chooseTransition(a);
            if (a === 'cancel-transition') cancelTransition();
            if (a === 'reassign') send(() => app.api.post(`/work-tasks/${id}/reassignment`, { version: row.version, execution_team_id: number(v['reassign-team']), reason: v['reassign-reason'] || '' }), { clear: ['reassign-team', 'reassign-reason'] });
            if (a === 'move') send(() => app.api.post(`/work-tasks/${id}/placement`, { version: row.version, major_task_id: number(v['move-major']), direct_project_id: number(v['move-project']), reason: v['move-reason'] || '' }), { clear: ['move-major', 'move-project', 'move-reason'] });
        };
        listen(dialog, 'keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); save(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!busy) { const form = e.target.closest('form'); if (form) form.requestSubmit(); else save(); } }
        });
        controller.action = name => {
            if(busy)return;
            if(name==='edit'){setEditing(true);q('#wf-title')?.focus();return;}
            if(name.startsWith('transition:') && !row?.available_actions?.includes(name.split(':')[1])){showError('Действие больше недоступно. Проверьте актуальные данные.');return;}
            if(['accept-assignment','decline-assignment'].includes(name)&&!row?.can_decide_assignment)return;
            chooseTransition(name);
        };
        controller.externalChange = async () => {
            if(!row||busy)return;
            const epoch=mutationEpoch;
            try{const fresh=await app.api.get('/work-tasks/'+id);if(!dialog.isConnected || request!==renderGeneration || busy || epoch!==mutationEpoch)return;
                if(fresh.version>row.version)saveStatus('Задача изменена другим участником. Закройте и откройте карточку для сверки; ввод сохранён.');
            }catch(e){if([403,404].includes(Number(e.status))){try{sessionStorage.removeItem(key);}catch{};render();}}
        };
        controller.membership = included => {
            let note=q('[data-membership-note]');
            if(!note){note=document.createElement('p');note.dataset.membershipNote='';note.setAttribute('role','status');q('.work-dialog-notices').append(note);}
            note.hidden=included!==false;note.textContent=included===false?'Задача больше не входит в текущую подборку. Карточка остаётся открытой.':'';
        };
        if (row) {
            const relations = q('[data-work-relations]');
            await Promise.all([loadActivity(), loadFiles(), mountRelations(relations, app, 'work', id, () => row.version, { canEdit: !!row.can_place })]);
        }
    } catch (e) {
        if (!dialog.isConnected || request !== renderGeneration) return;
        if([403,404].includes(Number(e.status))){try{sessionStorage.removeItem(`work-draft:${app.store.get('currentUser')?.id}:${id || 'new'}:${majorId || ''}:${projectId || ''}`);}catch{}}
        dialog.innerHTML = `<header class="work-dialog-head"><h2 id="work-drawer-title">Рабочая задача</h2>${action('Закрыть', 'close', { attrs: { 'data-close': '' } })}</header><div class="work-dialog-body"><p role="alert">${esc(message(e))}</p>${[403,404].includes(Number(e.status))?'<p>Проверьте ссылку или обратитесь к постановщику. Закройте карточку, чтобы вернуться к доступным задачам.</p>':''}</div>`;
        dialog.onclick = e => { if (e.target.closest('[data-work-action="close"]')) close(); };
    }
    };
    await render();
    return controller;
}
