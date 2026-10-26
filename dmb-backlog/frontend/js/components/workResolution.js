import { escapeHtml as esc } from '../htmlUtils.js';
import { button, field } from '../ui/primitives.js';
import { enhanceDialogOverlay } from '../modalAccessibility.js';
import { setButtonBusy } from '../ui/controls.js';
import { confirmAction } from '../uiFeedback.js';
import { renderViewState, bindViewStateAction } from './viewState.js';
import { WORK_STATUSES } from './workTasks.js?v=26';
import { mountWorkPicker } from './workPicker.js';

const options = rows => [{value:'',label:'Выберите'}, ...rows.map(x => ({value:x.id,label:x.name}))];

export async function openWorkResolution(app, request, focusOrigin = document.activeElement) {
    const dialog = document.createElement('dialog'); dialog.className = 'work-dialog work-resolution-dialog';
    dialog.setAttribute('aria-labelledby', 'work-resolution-title');
    const [refs, types, channels] = await Promise.all([app.api.get('/work-tasks/options'), app.api.get('/admin/task-types'), app.api.get('/admin/channels')]);
    const f = (id,label,props={}) => field({id:'wr-'+id,label,...props});
    dialog.innerHTML = `<header class="work-dialog-head"><h2 id="work-resolution-title">Разместить запрос</h2>${button({label:'Закрыть',attrs:{'data-close':''}})}</header><form class="work-resolution-form"><div class="work-dialog-body"><fieldset class="work-resolution-fields"><p>После подтверждения решение и связь с редакцией требований будут сохранены вместе.</p>${f('decision','Результат ревью',{kind:'select',options:[{value:'create_work',label:'Создать рабочую задачу'},{value:'create_major',label:'Создать текущую задачу'},{value:'link_work',label:'Связать рабочую задачу'},{value:'link_major',label:'Связать текущую задачу'}]})}<div data-create>${f('title','Название',{value:request.title})}${f('description','Ожидаемый результат',{kind:'textarea',value:request.description || ''})}${f('team','Команда',{kind:'select',value:request.team_id,options:options(refs.teams)})}<div data-work>${f('direction','Направление',{kind:'select',options:[{value:'organizational',label:'Организационное'},{value:'product',label:'Продуктовое'}]})}${f('placement','Размещение',{kind:'select',options:[{value:'standalone',label:'Самостоятельная'},{value:'project',label:'В проекте'},{value:'major',label:'В текущей задаче'}]})}${f('project','Проект',{kind:'select',options:options(refs.projects)})}${f('parent','Номер текущей задачи',{type:'number'})}<p>Приёмка обязательна. Приёмщиком станете вы.</p></div><div data-major hidden>${f('type','Тип задачи',{kind:'select',options:options(types.items || types)})}${f('channel','Канал',{kind:'select',options:options(channels.items || channels)})}${f('date','Дата поступления',{type:'date',value:new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'})})}</div></div><div data-link hidden>${f('search','Поиск выбранного типа работы',{type:'search'})}${button({label:'Найти',attrs:{'data-search':''}})}<div data-results></div>${f('target','Номер выбранной работы',{type:'number'})}</div>${f('scope','Какую потребность покрывает работа',{kind:'textarea',required:true})}${f('coverage','Покрытие требований',{kind:'select',options:[{value:'partial',label:'Частичное'},{value:'full',label:'Полное — подтверждено ревьюером'}]})}<div data-parts></div>${button({label:'Добавить часть запроса',attrs:{'data-add-part':''}})}<p>Для разбиения добавьте части, затем подтвердите размещение. Текущая форма также войдёт в решение.</p><p role="alert" data-error tabindex="-1"></p></fieldset></div><footer class="work-dialog-footer">${button({label:'Подтвердить размещение',variant:'primary',attrs:{type:'submit'}})}</footer></form>`;
    document.body.append(dialog); enhanceDialogOverlay(dialog, focusOrigin); dialog.showModal();
    let busy = false, dirty = false, discardPending = false; const parts = []; const key = crypto.randomUUID();
    dialog.addEventListener('input', () => { dirty = true; });
    dialog.addEventListener('change', () => { dirty = true; });
    const value = id => dialog.querySelector('#wr-'+id).value;
    mountWorkPicker(dialog.querySelector('#wr-parent'),app,{editable:true,label:'Крупная задача'});
    const close = async (force = false) => {
        if (busy || discardPending) return;
        if (dirty && !force) {
            discardPending = true;
            const discard = await confirmAction({ title: 'Закрыть без сохранения?', message: 'Размещение и добавленные части запроса не сохранены.', confirmText: 'Закрыть без сохранения', cancelText: 'Продолжить редактирование', destructive: true });
            discardPending = false;
            if (!discard) return;
        }
        dialog.close(); dialog.remove();
        if (focusOrigin?.isConnected) focusOrigin.focus();
    };
    dialog.querySelector('[data-close]').onclick = () => close();
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    let searchVersion = 0;
    const searchButton = dialog.querySelector('[data-search]');
    const syncMode = () => {
        searchVersion++; setButtonBusy(searchButton, false);
        const d=value('decision'); dialog.querySelector('[data-create]').hidden=d.startsWith('link'); dialog.querySelector('[data-link]').hidden=!d.startsWith('link'); dialog.querySelector('[data-work]').hidden=d!=='create_work'; dialog.querySelector('[data-major]').hidden=d!=='create_major'; dialog.querySelector('#wr-target').value=''; dialog.querySelector('[data-results]').textContent='';
    };
    const syncFields = () => {
        const decision = value('decision'), create = decision.startsWith('create');
        const required = new Set(create ? ['title', 'team'] : ['target']);
        if (decision === 'create_major') ['type', 'channel', 'date'].forEach(id => required.add(id));
        if (decision === 'create_work' && value('placement') !== 'standalone') required.add(value('placement') === 'project' ? 'project' : 'parent');
        for (const id of ['title','team','target','type','channel','date','project','parent']) dialog.querySelector('#wr-'+id).required = required.has(id);
        for (const id of ['project','parent']) dialog.querySelector('#wr-'+id).closest('.ui-field').hidden = decision !== 'create_work' || value('placement') !== (id === 'project' ? 'project' : 'major');
    };
    dialog.querySelector('#wr-decision').onchange = () => { syncMode(); syncFields(); };
    dialog.querySelector('#wr-placement').onchange = syncFields;
    syncFields();
    const submit = dialog.querySelector('[type="submit"]');
    const setSaving = saving => {
        busy = saving;
        dialog.querySelector('form').setAttribute('aria-busy', String(saving));
        dialog.querySelector('fieldset').disabled = saving;
        dialog.querySelector('[data-close]').disabled = saving;
        setButtonBusy(submit, saving, 'Сохраняем…');
    };
    searchButton.onclick = async () => {
        const version = ++searchVersion;
        setButtonBusy(searchButton, true, 'Ищем…');
        try {
            const d=value('decision'); const result=await app.api.get('/work-targets?editable=true&kind='+(d==='link_work'?'work':'major')+'&q='+encodeURIComponent(value('search')));
            if (!dialog.isConnected || version !== searchVersion) return;
            const rows=result.items || result.tasks || result;
            const root=dialog.querySelector('[data-results]'); root.innerHTML=rows.slice(0,30).map(x=>button({label:(x.public_id || x.id)+' · '+x.title,attrs:{'data-target':x.id}})).join('') || 'Ничего не найдено';
            root.onclick=e=>{const id=e.target.closest('[data-target]')?.dataset.target;if(id) dialog.querySelector('#wr-target').value=id;};
        } catch(e) {if(dialog.isConnected && version === searchVersion)dialog.querySelector('[data-error]').textContent=e.message;}
        finally {if(version === searchVersion)setButtonBusy(searchButton, false);}
    };
    const readPart = () => {
        const body={version:request.version,decision:value('decision'),scope_text:value('scope'),coverage:value('coverage')};
        if(body.decision==='create_work') body.work={title:value('title'),description:value('description'),execution_team_id:Number(value('team')),work_direction:value('direction'),acceptance_required:true,major_task_id:value('placement')==='major'?Number(value('parent')):null,direct_project_id:value('placement')==='project'?Number(value('project')):null};
        else if(body.decision==='create_major') body.major={title:value('title'),description:value('description'),team_id:Number(value('team')),task_type_id:Number(value('type')),channel_id:Number(value('channel')),date_received:value('date')};
        else body.target_id=Number(value('target'));
        return body;
    };
    dialog.querySelector('[data-add-part]').onclick=()=>{
        if(busy || !dialog.querySelector('form').reportValidity())return;
        parts.push(readPart());
        dialog.querySelector('[data-parts]').innerHTML=parts.map((p,i)=>`<p>${i+1}. ${esc(p.work?.title || p.major?.title || ('№ '+p.target_id))}: ${esc(p.scope_text)} ${button({label:'Убрать',attrs:{'data-remove-part':i}})}</p>`).join('');
        dialog.querySelector('#wr-title').value=''; dialog.querySelector('#wr-scope').value=''; dialog.querySelector('#wr-target').value='';
    };
    dialog.querySelector('[data-parts]').onclick=e=>{const el=e.target.closest('[data-remove-part]');if(el&&!busy){parts.splice(Number(el.dataset.removePart),1);el.closest('p').remove();[...dialog.querySelectorAll('[data-remove-part]')].forEach((b,i)=>b.dataset.removePart=i);}};
    dialog.querySelector('form').onsubmit=async e=>{
        e.preventDefault(); if(busy)return;
        dialog.querySelector('[data-error]').textContent='';
        setSaving(true);
        const part=readPart(); const split=parts.length>0 || request.appendParts;
        const body=split?{version:request.version,reason:'Разбиение запроса: '+part.scope_text,parts:[...parts,part]}:part;
        try {await app.api.request('POST',`/requests/${request.id}/${split?'split':'resolution'}`,body,{idempotencyKey:key});setSaving(false);await close(true);await app.router.refreshCurrentRoute();}
        catch(err){setSaving(false);const error=dialog.querySelector('[data-error]');error.textContent=err.message;error.focus();}
    };
}

export async function mountFulfillment(root, app, id, reviewer = false) {
    if(!root)return;
    root.innerHTML = renderViewState({kind:'loading',title:'Загружаем результат запроса…'});
    window.lucide?.createIcons?.();
    try {
        const data=await app.api.get(`/requests/${id}/fulfillment`);
        root.innerHTML=`<h3>Размещение и результат</h3><p>${esc(data.message || (data.coverage==='full'?'Покрытие подтверждено полностью':'Покрытие частичное'))}</p>${data.works.map(x=>`<article><strong>${esc(x.public_id)} · ${esc(x.title)}</strong><p>${esc(WORK_STATUSES[x.status] || 'Учитывается в бэклоге')}</p><p>${esc(x.scope_text)}</p>${x.result_text?`<p>${esc(x.result_text)}</p>`:''}</article>`).join('')}<p>${data.fulfillment==='fulfilled'?'Результат запроса подтверждён':'Результат запроса ещё не подтверждён'}</p>`;
        if(reviewer && data.review_decision) {
            const add=document.createElement('div');add.innerHTML=button({label:'Добавить части запроса'});root.append(add);add.querySelector('button').onclick=event=>openWorkResolution(app,{id,version:data.version,title:'',description:'',appendParts:true},event.currentTarget);
            const form=document.createElement('form');
            form.innerHTML=field({id:'fulfillment-result',label:'Подтверждённый результат запроса',kind:'textarea',required:true})+button({label:'Подтвердить полное выполнение запроса',attrs:{type:'submit'}})+'<p role="alert" tabindex="-1"></p>';
            root.append(form);
            let saving = false;
            form.onsubmit=async e=>{
                e.preventDefault(); if(saving)return;
                const input=form.querySelector('textarea'), submit=form.querySelector('[type=submit]'), error=form.querySelector('[role=alert]');
                const body={version:data.version,coverage:'full',fulfillment:'fulfilled',result_text:input.value};
                saving=true;error.textContent='';input.disabled=true;form.setAttribute('aria-busy','true');setButtonBusy(submit,true);
                try {await app.api.post(`/requests/${id}/fulfillment`,body);await mountFulfillment(root,app,id,true);}
                catch(err){error.textContent=err.message;error.focus();}
                finally {saving=false;input.disabled=false;form.removeAttribute('aria-busy');setButtonBusy(submit,false);}
            };
        }
    } catch(e) {root.innerHTML=renderViewState({kind:'error',title:'Не удалось загрузить результат запроса',message:e.message,actionLabel:'Повторить'});bindViewStateAction(root,()=>mountFulfillment(root,app,id,reviewer));}
    finally {window.lucide?.createIcons?.();}
}
