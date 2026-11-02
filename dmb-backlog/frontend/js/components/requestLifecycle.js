import { button, field } from '../ui/primitives.js';
import { escapeHtml as esc } from '../htmlUtils.js';
import { renderViewState } from './viewState.js';

const LABELS = {accept:'Принять в бэклог',defer:'Отложить',reconsider:'Пересмотреть решение',withdraw:'Отозвать запрос',follow_up:'Изменить следующий шаг',place:'Разместить запрос'};
const HINTS = {
  accept:'Потребность будет принята в бэклог. Укажите следующий шаг и дату его выполнения; срок реализации согласуется отдельно.',
  defer:'Запрос сохранится в реестре. В указанную дату он попадёт в выборку «Пора пересмотреть».',
  reconsider:'Начнётся повторное рассмотрение с тем же номером запроса. Прежнее решение и требования останутся в истории.',
  withdraw:'Запрос останется в истории со статусом «Отозван». Связанные работы не отменяются автоматически: их судьбу нужно согласовать с командой.',
  follow_up:'Зафиксируйте ответственного за общение с заказчиком, следующий шаг и срок. Эти сведения будут видны заказчику.',
};

export async function mountRequestLifecycle(root, app, id, reviewer=false) {
  root.innerHTML=renderViewState({kind:'loading',title:'Загружаем сопровождение запроса…'});
  try {
    const req=await app.api.get(`/agent/requests/${id}`);
    if(!root.isConnected)return;
    const actions=(req.lifecycle_actions||[]).filter(x=>reviewer || x==='withdraw');
    root.innerHTML=`<div class="card-header"><h2 class="card-title">Сопровождение запроса</h2></div><div class="card-body"><p>Ответственный: <strong>${esc(req.coordinator_name||req.reviewer_name||'Пока не назначен')}</strong></p><p>${esc(req.next_action||'Следующий шаг ещё не указан')}</p>${req.next_action_due?`<p>Срок следующего шага: <strong>${esc(req.next_action_due)}</strong>${req.follow_up_due?' · Требует внимания':''}</p>`:''}<div class="review-decision-actions">${actions.map(action=>button({label:LABELS[action],variant:action==='withdraw'?'secondary':'primary',attrs:{'data-lifecycle':action}})).join('')}</div></div>`;
    root.querySelectorAll('[data-lifecycle]').forEach(control=>control.onclick=async()=>{
      if(control.dataset.lifecycle==='place') {
        const {openWorkResolution}=await import('./workResolution.js?v=3');
        return openWorkResolution(app,req,control);
      }
      await lifecycleDialog(app,req,control.dataset.lifecycle,control);
    });
  } catch(error) {
    root.innerHTML=renderViewState({kind:'error',title:'Не удалось загрузить сопровождение',message:error.message,actionLabel:'Повторить'});
    root.querySelector('button')?.addEventListener('click',()=>mountRequestLifecycle(root,app,id,reviewer));
  }
  window.lucide?.createIcons?.();
}

async function lifecycleDialog(app,req,action,trigger) {
  trigger.disabled=true;
  const planning=['accept','defer','follow_up'].includes(action);
  let coordinators=[];
  try {if(planning)coordinators=await app.api.get(`/agent/requests/${req.id}/coordinators`);}
  catch(e){window.toast?.(e.message,'error');trigger.disabled=false;return;}
  trigger.disabled=false;
  const dialog=document.createElement('dialog');dialog.className='work-dialog';dialog.setAttribute('aria-labelledby','request-lifecycle-title');
  const current=app.store.get('currentUser');
  dialog.innerHTML=`<form><header class="work-dialog-head"><h2 id="request-lifecycle-title">${LABELS[action]}</h2></header><div class="work-dialog-body"><p>${HINTS[action]}</p>${field({id:'rl-reason',label:'Причина / основание',kind:'textarea',required:true})}${planning?`${field({id:'rl-owner',label:'Ответственный за запрос',kind:'select',required:true,value:req.coordinator_id||current?.id,options:coordinators.map(x=>({value:x.id,label:x.name}))})}${field({id:'rl-next',label:'Следующий шаг',required:true,value:req.next_action|| (action==='defer'?'Повторно рассмотреть приоритет запроса':'Согласовать приоритет и план исполнения')})}${field({id:'rl-date',label:action==='defer'?'Дата пересмотра':'Срок следующего шага',type:'date',required:true,value:req.next_action_due||''})}`:''}<p role="alert" tabindex="-1"></p></div><footer class="work-dialog-footer">${button({label:'Отмена',attrs:{'data-cancel':''}})}${button({label:LABELS[action],variant:'primary',attrs:{type:'submit'}})}</footer></form>`;
  document.body.append(dialog);dialog.showModal();
  let busy=false;
  const close=()=>{if(busy)return;dialog.close();dialog.remove();if(trigger.isConnected)trigger.focus();};
  dialog.querySelector('[data-cancel]').onclick=close;
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  dialog.querySelector('#rl-reason').maxLength=2000;
  if(planning){dialog.querySelector('#rl-next').maxLength=500;dialog.querySelector('#rl-date').min=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});}
  dialog.querySelector('form').onsubmit=async e=>{
    e.preventDefault();if(busy)return;
    const error=dialog.querySelector('[role=alert]');
    const body={action,version:req.version,reason:dialog.querySelector('#rl-reason').value.trim()};
    if(planning)Object.assign(body,{coordinator_id:Number(dialog.querySelector('#rl-owner').value),next_action:dialog.querySelector('#rl-next').value.trim(),next_action_due:dialog.querySelector('#rl-date').value});
    busy=true;dialog.querySelectorAll('button').forEach(x=>x.disabled=true);error.textContent='';
    try {await app.api.post(`/agent/requests/${req.id}/lifecycle`,body);busy=false;close();window.toast?.('Решение сохранено','success');await app.router.refreshCurrentRoute();}
    catch(err){error.textContent=err.message;error.focus();}
    finally{busy=false;dialog.querySelectorAll('button').forEach(x=>x.disabled=false);}
  };
}
