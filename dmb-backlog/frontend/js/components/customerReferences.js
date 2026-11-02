import { escapeHtml } from '../htmlUtils.js';
import { renderViewState, bindViewStateAction } from './viewState.js';
import { formatErrorMessage, confirmAction } from '../uiFeedback.js';
import { button, field, checkbox } from '../ui/primitives.js';
import { setButtonBusy } from '../ui/controls.js';
import { enhanceDialogOverlay } from '../modalAccessibility.js';

export async function openCustomerReferences(kind, app) {
  const endpoint = `/admin/customer-references/${kind}`;
  const origin = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'customer-reference-dialog';
  dialog.setAttribute('aria-labelledby', 'customer-reference-title');
  document.body.appendChild(dialog);
  let items = [], initial = '', busy = false, discardPending = null;
  const snapshot = () => JSON.stringify([...dialog.querySelectorAll('[data-editor] input')].map(input => input.type === 'checkbox' ? input.checked : input.value));
  const dirty = () => initial && snapshot() !== initial;
  async function discardThen(action) {
    if (busy || discardPending) return;
    if (!dirty()) { action(); return; }
    discardPending = confirmAction({title:'Несохранённые изменения',message:'Закрыть форму без сохранения?',confirmText:'Не сохранять',cancelText:'Продолжить редактирование',destructive:true});
    const discard = await discardPending; discardPending = null;
    if (discard && dialog.isConnected) { initial = ''; action(); }
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); discardThen(() => dialog.close()); });
  dialog.addEventListener('close', () => { dialog.remove(); if(origin?.isConnected)origin.focus(); });
  dialog.innerHTML = '<h2 id="customer-reference-title">Клиенты ДИД</h2>' + renderViewState({kind:'loading',title:'Загружаем справочник…'}) + button({label:'Закрыть',attrs:{'data-close':''}});
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  enhanceDialogOverlay(dialog,origin);dialog.showModal();
  function render() {
    initial = '';
    dialog.innerHTML = `<div class="did-filter-panel-head"><h2 id="customer-reference-title">Клиенты ДИД</h2>${button({label:'Закрыть',icon:'x',iconOnly:true,variant:'ghost',attrs:{'data-close':''}})}</div><p class="text-muted">Группировка задач в отчёте для бизнес-заказчиков ДИД.</p><div role="alert" data-error tabindex="-1"></div><div class="customer-reference-list">${items.map(item => `<div class="customer-reference-row"><span>${escapeHtml(item.name)} ${item.is_active ? '' : '· Неактивна'}</span>${button({label:'Изменить',size:'small',attrs:{'data-edit':item.id,'aria-label':'Изменить: '+item.name}})}</div>`).join('') || renderViewState({kind:'empty',title:'Справочник пока пуст'})}</div>${button({label:'Добавить запись',variant:'primary',attrs:{'data-new':''}})}<div data-editor></div>`;
    dialog.querySelector('[data-close]').onclick = () => discardThen(() => dialog.close());
    dialog.querySelector('[data-new]').onclick = () => discardThen(() => editor(null));
    dialog.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => discardThen(() => editor(items.find(i => i.id === Number(b.dataset.edit)))); });
    window.lucide?.createIcons();
  }
  async function load() {
    dialog.innerHTML = '<h2 id="customer-reference-title">Клиенты ДИД</h2>' + renderViewState({kind:'loading',title:'Обновляем список…'}) + button({label:'Закрыть',attrs:{'data-close':''}});
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.querySelector('[data-close]').focus();
    try { items = await app.api.get(endpoint); if(!dialog.isConnected)return;render();if(document.activeElement===document.body||document.activeElement===dialog)dialog.querySelector('[data-close]').focus();app.didClientGroups=items.filter(i=>i.is_active); }
    catch(error) { if(!dialog.isConnected)return;dialog.innerHTML='<h2 id="customer-reference-title">Клиенты ДИД</h2>'+renderViewState({kind:'error',message:formatErrorMessage(error),actionLabel:'Повторить'})+button({label:'Закрыть',attrs:{'data-close':''}});bindViewStateAction(dialog,load);dialog.querySelector('[data-close]').onclick=()=>dialog.close(); }
  }
  function editor(item) {
    const host = dialog.querySelector('[data-editor]');
    host.innerHTML = `<form class="customer-reference-editor"><h3>${item ? 'Изменить запись' : 'Новая запись'}</h3>${field({id:'cr-name',label:'Название',value:item?.name || '',required:true,attrs:{name:'name',maxlength:100}})}${field({id:'cr-code',label:'Код',value:item?.code || '',required:true,attrs:{name:'code',maxlength:50}})}${field({id:'cr-order',label:'Порядок',type:'number',value:item?.sort_order ?? 0,attrs:{name:'order',min:0,max:100000}})}${checkbox({id:'cr-active',label:'Активна',checked:item?.is_active!==false,attrs:{name:'active'}})}<div class="did-actions">${button({label:'Сохранить',variant:'primary',attrs:{type:'submit'}})}${button({label:'Отмена',attrs:{'data-cancel':''}})}</div></form>`;
    initial = snapshot();
    host.querySelector('[data-cancel]').onclick = () => discardThen(() => { initial = ''; host.innerHTML = '';dialog.querySelector('[data-new]').focus(); });
    host.querySelector('form').onsubmit = async event => {
      event.preventDefault();if(busy)return;
      const form=event.target,fields=form.elements;
      const command={name:fields.name.value,code:fields.code.value,sort_order:Number(fields.order.value),is_active:fields.active.checked,expected:item};
      const controls=[...dialog.querySelectorAll('button,input,select,textarea')].map(e=>[e,e.disabled]);
      const submit=form.querySelector('[type=submit]');const error=dialog.querySelector('[data-error]');error.textContent='';
      busy=true;dialog.setAttribute('aria-busy','true');setButtonBusy(submit,true);controls.forEach(([e])=>e.disabled=true);
      let saved=false;
      try {if(item)await app.api.put(`${endpoint}/${item.id}`,command);else await app.api.post(endpoint,command);saved=true;initial='';}
      catch(e){error.textContent=formatErrorMessage(e);error.focus();}
      finally {busy=false;dialog.removeAttribute('aria-busy');setButtonBusy(submit,false);controls.forEach(([e,disabled])=>e.disabled=disabled);}
      if(saved&&dialog.isConnected){await load();dialog.querySelector('[data-new], [data-view-state-action]')?.focus();}
    };
    host.querySelector('input').focus();
  }
  await load();
}
