import { progress } from '../ui/dataDisplay.js';
import {escapeHtml as esc} from '../htmlUtils.js';
import {button, field} from '../ui/primitives.js';
import {formatErrorMessage} from '../uiFeedback.js';

export const WORK_PRIORITIES = {low:'Низкий',normal:'Обычный',high:'Высокий',urgent:'Срочный'};
export const priorityBadge = value => `<span class="work-priority" data-priority="${Object.hasOwn(WORK_PRIORITIES,value) ? value : 'normal'}">${esc(WORK_PRIORITIES[value] || WORK_PRIORITIES.normal)}</span>`;
export function checklistValue(value) {
    try { const items = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(items) ? items : []; }
    catch { return []; }
}
export const checklistCount = items => `${items.filter(x=>x.completed).length} из ${items.length}`;
export function checklistView(row) {
    const items = row.checklist || [];
    if (!items.length) return '';
    return `<section class="work-checklist-view" aria-label="Чек-лист"><h3>Чек-лист · <span data-checklist-count>${checklistCount(items)}</span></h3>${progress({value:100*items.filter(x=>x.completed).length/items.length,label:'Прогресс чек-листа'})}<ul>${items.map(item=>`<li><label class="ui-checkbox"><input type="checkbox" data-check-item="${esc(item.id)}" ${item.completed?'checked':''} ${row.can_check?'':'disabled'}><span>${esc(item.title)}</span></label></li>`).join('')}</ul><p class="work-muted">Пункты помогают отслеживать работу; завершение подтверждается отдельно.</p></section>`;
}

export function mountChecklistEditor(host, input, editable) {
    let items = checklistValue(input.value);
    const emit = () => {input.value=JSON.stringify(items);input.dispatchEvent(new Event('input',{bubbles:true}));};
    const render = () => {
        host.innerHTML = `<ol class="work-checklist-editor">${items.map((item,index)=>`<li><input class="input ui-control" aria-label="Пункт ${index+1}" data-item-title="${index}" value="${esc(item.title)}" maxlength="300" required ${editable?'':'disabled'}><div class="work-checklist-tools">${button({label:'Выше',variant:'ghost',attrs:{'data-item-up':index,'aria-label':`Переместить пункт ${index+1} выше`,disabled:!editable || index===0}})}${button({label:'Убрать',variant:'ghost',attrs:{'data-item-remove':index,'aria-label':`Убрать пункт ${index+1}`,disabled:!editable}})}</div></li>`).join('')}</ol>${editable?button({label:'Добавить пункт',variant:'secondary',attrs:{'data-item-add':'',disabled:items.length>=50}}):''}<p class="work-muted">До 50 пунктов. Изменения сохраняются вместе с задачей.</p>`;
    };
    host.oninput = event => {
        if (!event.target.matches('[data-item-title]')) return;
        items[Number(event.target.dataset.itemTitle)].title=event.target.value;emit();
    };
    host.onclick = event => {
        if(!editable) return;
        const target=event.target.closest('button');if(!target)return;
        let focus;
        if(target.hasAttribute('data-item-add')) {if(items.length>=50)return;items.push({id:crypto.randomUUID(),title:'',completed:false});focus=items.length-1;}
        else if(target.hasAttribute('data-item-remove')) {const n=Number(target.dataset.itemRemove);items.splice(n,1);focus=Math.min(n,items.length-1);}
        else if(target.hasAttribute('data-item-up')) {const n=Number(target.dataset.itemUp);if(n<1)return;[items[n-1],items[n]]=[items[n],items[n-1]];focus=n-1;}
        else return;
        emit();render();(host.querySelector(`[data-item-title="${focus}"]`) || host.querySelector('[data-item-add]'))?.focus();
    };
    render();
    return {replace(value) {items=checklistValue(value);input.value=JSON.stringify(items);render();}};
}

export function mountWorkTemplates(host, app, {getContent, apply, canApply, isBusy}) {
    host.innerHTML=`<details class="work-card-details"><summary>${canApply?'Из шаблона':'Сохранить как шаблон'}</summary><p class="work-muted">Личные шаблоны переносят содержание, приоритет и чек-лист. Исполнитель, дата и выполненные отметки не копируются.</p><div data-template-controls></div><p data-template-message role="status"></p></details>`;
    const controls=host.querySelector('[data-template-controls]'),notice=host.querySelector('[data-template-message]');
    let items=[],selected='',busy=false;
    const selectedItem=()=>items.find(x=>String(x.id)===selected);
    const render=()=>{
        controls.innerHTML=field({id:'wf-template',label:'Шаблон',kind:'select',value:selected,options:[{value:'',label:'Выберите шаблон'},...items.map(x=>({value:x.id,label:x.name}))]})+
            field({id:'wf-template-name',label:'Название шаблона',value:selectedItem()?.name||'',attrs:{maxlength:120,placeholder:'Например, подготовка встречи'}})+
            `<div class="work-actions">${canApply?button({label:'Применить к новой задаче',attrs:{'data-template-action':'apply',disabled:!selected}}):''}${button({label:'Сохранить новый шаблон',attrs:{'data-template-action':'create'}})}${button({label:'Обновить выбранный',attrs:{'data-template-action':'update',disabled:!selected}})}${button({label:'Удалить выбранный',variant:'ghost',attrs:{'data-template-action':'archive',disabled:!selected}})}${button({label:'Обновить список',variant:'ghost',attrs:{'data-template-action':'reload'}})}</div><p class="work-muted">Применение заменяет название, описание, приоритет, направление, приёмку и чек-лист в новой задаче. Сохранение шаблона не сохраняет саму задачу.</p><div data-template-confirm hidden></div>`;
        controls.querySelector('select').onchange=event=>{selected=event.target.value;render();};
    };
    const load=async()=>{const data=await app.api.get('/work-task-templates');if(!host.isConnected)return;items=(data.items||[]).filter(x=>x.content);if(!selectedItem())selected='';render();};
    const run=async operation=>{
        if(busy || isBusy())return;busy=true;notice.textContent='Сохранение…';controls.querySelectorAll('button,input,select').forEach(x=>x.disabled=true);
        try {await operation();if(host.isConnected){await load();notice.textContent='Готово';}}
        catch(e){if(host.isConnected){notice.textContent=formatErrorMessage(e);render();}}
        finally{busy=false;}
    };
    host.querySelector('details').addEventListener('toggle',async event=>{
        if(!event.target.open || controls.children.length)return;
        try{await load();}catch(e){notice.textContent=formatErrorMessage(e);render();}
    });
    controls.onclick=event=>{
        const action=event.target.closest('[data-template-action]')?.dataset.templateAction;
        if(!action || busy || isBusy())return;
        if(action==='reload'){run(load);return;}
        const item=selectedItem();
        if(action==='apply' && canApply && item){const confirm=controls.querySelector('[data-template-confirm]');confirm.hidden=false;confirm.innerHTML=`<p>Заменить название, ожидаемый результат, приоритет, направление, приёмку и чек-лист значениями шаблона «${esc(item.name)}»?</p>${button({label:'Применить шаблон',attrs:{'data-template-action':'confirm-apply'}})}${button({label:'Отмена',variant:'ghost',attrs:{'data-template-action':'cancel-apply'}})}`;return;}
        if(action==='cancel-apply'){controls.querySelector('[data-template-confirm]').hidden=true;return;}
        if(action==='confirm-apply' && canApply && item){apply(structuredClone(item.content));controls.querySelector('[data-template-confirm]').hidden=true;notice.textContent='Шаблон применён к черновику. Проверьте поля и создайте задачу.';return;}
        const name=controls.querySelector('#wf-template-name').value.trim();
        if(action==='archive' && item){
            const confirm=controls.querySelector('[data-template-confirm]');confirm.hidden=false;
            confirm.innerHTML=`<p>Удалить личный шаблон «${esc(item.name)}»? Созданные задачи сохранятся.</p>${button({label:'Подтвердить удаление',attrs:{'data-template-action':'confirm-archive'}})}`;return;
        }
        if(action==='confirm-archive' && item){run(()=>app.api.post(`/work-task-templates/${item.id}/archive`,{version:item.version}));return;}
        if(!['create','update'].includes(action))return;
        if(!name){notice.textContent='Укажите название шаблона';controls.querySelector('#wf-template-name').focus();return;}
        const content=getContent();
        if(!content.title.trim() || content.checklist.some(x=>!x.trim())){notice.textContent='Заполните название задачи и все пункты чек-листа';return;}
        run(async()=>{
            const data=action==='update' && item
                ?await app.api.request('PUT',`/work-task-templates/${item.id}`,{name,content,version:item.version})
                :await app.api.post('/work-task-templates',{name,content});
            selected=String(data.id);
        });
    };
}
