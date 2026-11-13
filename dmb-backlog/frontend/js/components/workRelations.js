import { backlogTaskHref } from '../backlogRouteState.js';
import {showFormErrors,clearFormErrors} from '../ui/validation.js';
import { field, button } from '../ui/primitives.js';
import { setButtonBusy } from '../ui/controls.js';
import { escapeHtml as esc } from '../htmlUtils.js';
import { mountWorkPicker } from './workPicker.js';

export async function mountRelations(root, app, kind, id, version, { canEdit = true, composition = '' } = {}) {
    if (!root) return;
    root.removeAttribute('aria-busy');
    const prefix = 'relations-' + crypto.randomUUID();
    const ids = { kind:prefix+'-kind', target:prefix+'-target', url:prefix+'-url', placement:prefix+'-placement' };
    const error = name => `<p role="alert" tabindex="-1" data-${name}></p>`;
    root.innerHTML = `<details><summary class="ui-disclosure-text">Зависимости</summary><div data-relations>Загрузка…</div>${canEdit ? `<form data-dependency>${field({id:ids.kind,label:'Зависит от',kind:'select',options:[{value:'work',label:'Рабочая задача'},{value:'major',label:'Текущая задача'}]})}${field({id:ids.target,label:'Номер работы',type:'number',required:true})}${button({label:'Добавить зависимость',attrs:{type:'submit'}})}</form>` : ''}${error('error')}</details>${kind==='major' ? `<details><summary class="ui-disclosure-text">Внешнее исполнение</summary><p>Только ссылки. Подключение к трекеру не настроено.</p><div data-external></div>${canEdit ? `<form data-external-form>${field({id:ids.url,label:'Ссылка на внешнюю работу',type:'url',required:true})}${button({label:'Добавить ссылку',attrs:{type:'submit'}})}</form>` : ''}${error('external-error')}</details>${canEdit ? `<details><summary class="ui-disclosure-text">Привязать существующую рабочую задачу</summary><form data-placement>${field({id:ids.placement,label:'Номер рабочей задачи',type:'number',required:true})}${button({label:'Показать перенос',attrs:{type:'submit'}})}</form><div data-placement-preview></div>${error('placement-error')}</details>` : ''}` : ''}`;
    if (composition === 'task-detail' && kind === 'major') {
        root.classList.add('ui-task-work-relations');
        const dependencies = root.querySelector('[data-relations]').closest('details');
        const external = root.querySelector('[data-external]').closest('details');
        const placement = root.querySelector('[data-placement]')?.closest('details');
        const section = document.createElement('section');
        section.className = 'ui-task-external-work';
        section.innerHTML = '<div class="ui-task-secondary-head"><h2>Внешнее исполнение</h2>' + (canEdit ? button({ label:'Добавить', variant:'ghost', icon:'plus', attrs:{'data-task-external-toggle':'','aria-expanded':'false'} }) : '') + '</div><p class="ui-task-secondary-meta">Работы, которые ведутся в другой системе. Ссылки на документы находятся во вкладке «Ссылки и файлы».</p>';
        external.querySelector('summary')?.remove();
        external.querySelector(':scope>p:not([role])')?.remove();
        section.append(...external.childNodes);
        external.replaceWith(section);
        root.prepend(section);
        dependencies.querySelector('summary').textContent = 'Зависимости этой задачи';
        if (placement) { placement.dataset.taskPlacement = ''; placement.hidden = true; }
        const externalForm = section.querySelector('[data-external-form]');
        if (externalForm) {
            externalForm.hidden = true;
            section.querySelector('[data-task-external-toggle]').onclick = event => {
                externalForm.hidden = !externalForm.hidden;
                event.currentTarget.setAttribute('aria-expanded', String(!externalForm.hidden));
                if (!externalForm.hidden) externalForm.querySelector('input')?.focus();
            };
        }
    }
    if (composition === 'task-detail') window.lucide?.createIcons();
    const content = root.querySelector('[data-relations]');
    const live = () => root.isConnected && root.contains(content);
    const showError = (node, err) => { if(live()){node.textContent=err.message;node.focus();} };
    let saving=false;
    async function runForm(form, out, operation) {
        if (!canEdit || !live() || saving) return;
        const controls=[...root.querySelectorAll('input,select,textarea,button')].map(el=>[el,el.disabled]);
        const submit=form.querySelector('[type=submit]');
        clearFormErrors(form);saving=true;root.setAttribute('aria-busy','true');form.setAttribute('aria-busy','true');out.textContent='';
        setButtonBusy(submit,true);controls.forEach(([el])=>el.disabled=true);
        try { await operation(); }
        catch(err) { showError(out,err); }
        finally { setButtonBusy(submit,false);controls.forEach(([el,disabled])=>el.disabled=disabled);form.removeAttribute('aria-busy');if(live())root.removeAttribute('aria-busy');saving=false; }
    }
    const load=async()=>{
        try {
            const rows=await app.api.get(`/work-dependencies/${kind}/${id}`);
            if(!live())return;
            content.innerHTML=rows.map(x=>`<div class="work-relation"><a href="${esc(x.kind==='work'?'#/work-tasks/'+x.target_id:backlogTaskHref(x.target_id))}">${esc(x.public_id)} · ${esc(x.title)}</a>${canEdit ? `<details><summary class="ui-disclosure-text">Снять зависимость</summary><form data-remove-relation="${x.id}" data-version="${x.version}">${field({id:prefix+'-remove-'+x.id,label:'Причина снятия',required:true})}${button({label:'Подтвердить снятие',attrs:{type:'submit'}})}</form></details>` : ''}</div>`).join('')||'Зависимостей нет';
        } catch(err) { if(live())content.textContent=err.message; }
    };
    if(canEdit) {
        const form=root.querySelector('[data-dependency]'),kindInput=root.querySelector('#'+ids.kind),target=root.querySelector('#'+ids.target);
        const picker=mountWorkPicker(target,app,{kind:()=>kindInput.value,label:'Связанная работа'});
        kindInput.onchange=()=>picker?.reset();
        form.onsubmit=e=>{e.preventDefault();if(saving)return;if(!target.value){showFormErrors(form,{[target.id+'-search']:'Выберите связанную работу из результатов поиска.'});return;}const body={source:{kind,id},target:{kind:kindInput.value,id:Number(target.value)},source_version:typeof version==='function'?version():version};return runForm(form,root.querySelector('[data-error]'),async()=>{await app.api.post('/work-dependencies',body);await load();});};
        content.onsubmit=e=>{
            const remove=e.target.closest('[data-remove-relation]');if(!remove)return;e.preventDefault();
            const body={version:Number(remove.dataset.version),reason:remove.querySelector('input').value};
            return runForm(remove,root.querySelector('[data-error]'),async()=>{await app.api.post(`/work-dependencies/${remove.dataset.removeRelation}/deactivate`,body);await load();});
        };
    }
    if(kind==='major') {
        const external=root.querySelector('[data-external]');
        const links=async()=>{try{const rows=await app.api.get(`/tasks/${id}/external-links`);if(live())external.innerHTML=rows.map(x=>`<p><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.url)}</a> — только ссылка</p>`).join('')||'Ссылок пока нет';}catch(err){if(live())external.textContent=err.message;}};
        if(canEdit) {
            const form=root.querySelector('[data-external-form]');
            form.onsubmit=e=>{e.preventDefault();const url=root.querySelector('#'+ids.url).value;return runForm(form,root.querySelector('[data-external-error]'),async()=>{await app.api.post(`/tasks/${id}/external-links`,{url});await links();});};
            const placement=root.querySelector('[data-placement]'),target=root.querySelector('#'+ids.placement),preview=root.querySelector('[data-placement-preview]');
            mountWorkPicker(target,app,{kind:'work',editable:true,label:'Выбрать рабочую задачу'});
            let generation=0;
            target.addEventListener('input',()=>{generation++;preview.replaceChildren();});
            placement.onsubmit=e=>{
                e.preventDefault();if(saving)return;if(!target.value){showFormErrors(placement,{[target.id+'-search']:'Выберите рабочую задачу из результатов поиска.'});return;}const run=++generation,targetId=Number(target.value);
                return runForm(placement,root.querySelector('[data-placement-error]'),async()=>{
                    const row=await app.api.get('/work-tasks/'+targetId);if(!live()||run!==generation)return;
                    preview.innerHTML=`<p>${esc(row.public_id)} · ${esc(row.title)}: ${esc(row.context?.title||'Самостоятельная')} → текущая задача</p><form data-confirm-placement>${button({label:'Подтвердить перенос',attrs:{type:'submit'}})}</form>`;
                    const confirm=preview.querySelector('form');
                    confirm.onsubmit=event=>{event.preventDefault();return runForm(confirm,root.querySelector('[data-placement-error]'),async()=>{
                        await app.api.post(`/work-tasks/${row.id}/placement`,{version:row.version,major_task_id:id,direct_project_id:null,reason:'Перенос подтверждён из карточки текущей задачи'});
                        if(live()){preview.textContent='Рабочая задача привязана';document.dispatchEvent(new CustomEvent('dmb:work-changed'));}
                    });};
                });
            };
        }
        await links();
    }
    await load();
}
