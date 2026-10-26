import { field, button } from '../ui/primitives.js';
import { escapeHtml as esc } from '../htmlUtils.js';
import { mountWorkPicker } from './workPicker.js';

export async function mountRelations(root, app, kind, id, version, { canEdit = true } = {}) {
    root.innerHTML = `<details><summary>Зависимости</summary><div data-relations>Загрузка…</div><form data-dependency>${field({id:'dep-kind',label:'Зависит от',kind:'select',options:[{value:'work',label:'Рабочая задача'},{value:'major',label:'Текущая задача'}]})}${field({id:'dep-id',label:'Номер работы',type:'number',required:true})}${button({label:'Добавить зависимость',attrs:{type:'submit'}})}</form><p role="alert" data-error></p></details>${kind==='major'?`<details><summary>Внешнее исполнение</summary><p>Только ссылки. Подключение к трекеру не настроено.</p><div data-external></div><form data-external-form>${field({id:'external-url',label:'Ссылка на внешнюю работу',type:'url',required:true})}${button({label:'Добавить ссылку',attrs:{type:'submit'}})}</form><p role="alert" data-external-error></p></details><details><summary>Привязать существующую рабочую задачу</summary><form data-placement>${field({id:'place-id',label:'Номер рабочей задачи',type:'number',required:true})}${button({label:'Показать перенос',attrs:{type:'submit'}})}</form><div data-placement-preview></div></details>`:''}`;
    const load=async()=>{try{const rows=await app.api.get(`/work-dependencies/${kind}/${id}`);root.querySelector('[data-relations]').innerHTML=rows.map(x=>`<div class="work-relation"><a href="${x.kind==='work'?'#/work-tasks/'+x.target_id:'#/backlog?task='+x.target_id}">${esc(x.public_id)} · ${esc(x.title)}</a>${canEdit?`<details><summary>Снять зависимость</summary><form data-remove-relation="${x.id}" data-version="${x.version}">${field({id:'remove-reason-'+x.id,label:'Причина снятия',required:true})}${button({label:'Подтвердить снятие',attrs:{type:'submit'}})}</form></details>`:''}</div>`).join('')||'Зависимостей нет';}catch(e){root.querySelector('[data-relations]').textContent=e.message;}};
    const picker = mountWorkPicker(root.querySelector('#dep-id'), app, {kind:()=>root.querySelector('#dep-kind').value,label:'Связанная работа'});
    root.querySelector('#dep-kind').onchange=()=>picker?.reset();
    root.querySelector('[data-relations]').onsubmit=async e=>{
        const form=e.target.closest('[data-remove-relation]');if(!form)return;e.preventDefault();
        const submit=form.querySelector('button');if(submit.disabled)return;submit.disabled=true;
        try{await app.api.post(`/work-dependencies/${form.dataset.removeRelation}/deactivate`,{version:Number(form.dataset.version),reason:form.querySelector('input').value});await load();}
        catch(err){root.querySelector('[data-error]').textContent=err.message;}
        finally{submit.disabled=false;}
    };
    if (!canEdit) root.querySelector('[data-dependency]').remove();
    else root.querySelector('[data-dependency]').onsubmit=async e=>{e.preventDefault();try{await app.api.post('/work-dependencies',{source:{kind,id},target:{kind:root.querySelector('#dep-kind').value,id:Number(root.querySelector('#dep-id').value)},source_version:typeof version === 'function' ? version() : version});await load();}catch(err){root.querySelector('[data-error]').textContent=err.message;}};
    if(kind==='major'){
        mountWorkPicker(root.querySelector('#place-id'),app,{kind:'work',editable:true,label:'Выбрать рабочую задачу'});
        const links=async()=>{try{const rows=await app.api.get(`/tasks/${id}/external-links`);root.querySelector('[data-external]').innerHTML=rows.map(x=>`<p><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.url)}</a> — только ссылка</p>`).join('')||'Ссылок пока нет';}catch(e){root.querySelector('[data-external]').textContent=e.message;}};
        root.querySelector('[data-external-form]').onsubmit=async e=>{e.preventDefault();try{await app.api.post(`/tasks/${id}/external-links`,{url:root.querySelector('#external-url').value});await links();}catch(err){root.querySelector('[data-external-error]').textContent=err.message;}};
        root.querySelector('[data-placement]').onsubmit=async e=>{e.preventDefault();const out=root.querySelector('[data-placement-preview]');try{const row=await app.api.get('/work-tasks/'+Number(root.querySelector('#place-id').value));out.innerHTML=`<p>${esc(row.public_id)} · ${esc(row.title)}: ${esc(row.context?.title||'Самостоятельная')} → текущая задача</p>${button({label:'Подтвердить перенос',attrs:{'data-confirm-placement':''}})}`;out.querySelector('button').onclick=async()=>{try{await app.api.post(`/work-tasks/${row.id}/placement`,{version:row.version,major_task_id:id,direct_project_id:null,reason:'Перенос подтверждён из карточки текущей задачи'});out.textContent='Рабочая задача привязана';document.dispatchEvent(new CustomEvent('dmb:work-changed'));}catch(err){out.textContent=err.message;}};}catch(err){out.textContent=err.message;}};
        await links();
    }
    await load();
}
