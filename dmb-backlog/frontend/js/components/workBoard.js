import {cursorPagination} from '../ui/specialized.js';
import {escapeHtml as esc} from '../htmlUtils.js';
import {button,field,icon} from '../ui/primitives.js';
import {bindActionMenu} from '../ui/actionMenu.js';
import {formatErrorMessage} from '../uiFeedback.js';
import {priorityBadge} from './workProductivity.js';
import {workDueLabel} from './workQueue.js?v=9';
import {transitionWork} from './workActions.js';

const btn=(label,attrs={},variant='ghost')=>button({label,variant,attrs});
export function boardCard(row,selected,{personal=false,userId=null}={}) {
 const closed=['done','cancelled'].includes(row.status),progress=row.checklist_progress;
 const date=row.status==='done' ? `Выполнена ${row.completed_at?new Date(row.completed_at).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit'}):'— дата неизвестна'}` : workDueLabel(row);
 const overdue=date.match(/^Просрочено на (\d+) д\./);
 const compactDate=overdue ? `${overdue[1]} д. проср.` : date;
 const actor=row.next_step?.actor_name||row.next_actor_label|| (row.status==='in_acceptance'?row.acceptor_name:row.assignee_name)||'Не назначен';
 const actorTitle=(row.status==='in_acceptance'?'Принимает результат: ':'Исполнитель: ')+actor.replace(/^Принимает:\s*/, '');
 return `<li class="work-board-card${selected===row.id?' is-selected':''}" data-board-card="${row.id}">
 <div class="work-board-card-head"><span class="work-public-id">${esc(row.public_id)}</span>${['high','urgent'].includes(row.priority)?priorityBadge(row.priority):''}${button({label:`Действия ${row.public_id}`,icon:'more-horizontal',iconOnly:true,size:'small',variant:'ghost',attrs:{'data-board-menu':row.id}})}</div>
 <button class="ui-link work-board-title" data-work-id="${row.id}" title="${esc(row.title)}">${esc(row.title)}</button>
 ${row.context?.title ? `<p class="work-board-context" title="${esc(row.context.title)}">${icon('folder')}<span>${esc(row.context.title)}</span></p>` : ''}
 <div class="work-board-meta">
 ${personal && Number(row.assignee_id)===Number(userId) && row.status!=='in_acceptance' ? '' : `<span class="work-board-person" title="${esc(actorTitle)}">${icon(row.status==='in_acceptance'?'user-check':'user')}<span>${esc(actor.replace(/^Принимает:\s*/, ''))}</span></span>`}
 ${progress?.total?`<span class="work-board-checklist" aria-label="Чек-лист: ${progress.done} из ${progress.total}" title="Чек-лист: ${progress.done} из ${progress.total}">${icon('list-checks')}<span>${progress.done}/${progress.total}</span></span>`:''}
 <span class="work-board-due${row.is_overdue?' work-warning':''}" title="${esc(date)}${row.due_date?' · '+esc(row.due_date):''}" aria-label="${esc(date)}">${icon(row.status==='done'?'check':'calendar-days')}<span>${esc(compactDate)}</span></span>
 </div>
 ${!closed&&row.assignment_state==='proposed'?'<p class="work-board-signal">Ожидает принятия командой</p>':''}
 ${!closed&&row.assignment_state==='declined'?'<p class="work-board-signal">Назначение отклонено</p>':''}
 ${!closed&&row.return_feedback_present?'<p class="work-board-signal">Возвращено на доработку</p>':''}</li>`;
}

export function mountWorkBoard(host,app,{open,counts,showDone,selected=()=>null,onColumn=()=>{},initialColumn='new',canAct=()=>true}) {
 let disposed=false,generation=0,params='',data=null,menus=[],reading=false,pending=false,drag=null,pointer=null,animation=0;
 let column=initialColumn,pages={},scrolls={},scrollLeft=0,savedKey='',deferredRender=false,lastDate=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});
 const abort=new AbortController(),listen=(el,type,fn,options={})=>el.addEventListener(type,fn,{...options,signal:abort.signal});
 const busy=new Set(),cursorBusy=new Set(),cursorGeneration=new Map();
 host.innerHTML=`<div data-board-root><div class="work-board-toolbar"><div data-board-mobile></div>${btn('Обновить',{'data-board-refresh':''})}</div><p class="work-board-notice" role="status" aria-live="polite"></p><div class="work-board-scroll" tabindex="0" aria-label="Доска рабочих задач"></div><div data-board-cancelled></div></div>`;
 host.removeAttribute('aria-live');
 const root=host.firstElementChild,notice=root.querySelector('.work-board-notice'),scroller=root.querySelector('.work-board-scroll'),cancelled=root.querySelector('[data-board-cancelled]');
 const say=text=>{notice.textContent=text;};
 const all=()=>data?[...data.columns,data.cancelled]:[];
 const find=id=>all().flatMap(x=>x.items).find(x=>x.id===Number(id));
 const storageKey=()=>`work-board:${app.store.get('currentUser')?.id}:${params}`;
 const capture=()=>{
  scrollLeft=scroller.scrollLeft;
  root.querySelectorAll('[data-board-items]').forEach(el=>scrolls[el.dataset.boardItems]=el.scrollTop);
  try{sessionStorage.setItem(storageKey(),JSON.stringify({pages,scrolls,scrollLeft,at:Date.now()}));}catch{}
 };
 const restore=()=>{
  scroller.scrollLeft=scrollLeft;
  root.querySelectorAll('[data-board-items]').forEach(el=>el.scrollTop=scrolls[el.dataset.boardItems]||0);
 };
 const clearMenus=()=>{menus.forEach(x=>x.destroy());menus=[];};
 const renderColumn=d=>`<section class="work-board-column ${d.state==='filtered'?'is-filtered':''}" data-board-column="${d.status}" aria-label="${esc(d.title)}" ${d.state==='included'?'':'data-filtered'}>
 <header><h2 tabindex="-1">${esc(d.title)}${d.total===null?'':` · ${d.total}`}</h2>${d.status==='done'?`<span class="work-muted">${({'7d':'За 7 дней','30d':'За 30 дней',all:'За всё время'})[new URLSearchParams(params).get('done_period')||'all']||'За всё время'}</span>`:''}</header>
 ${d.state==='filtered'?`<p>Скрыта фильтром</p>${d.status==='done'&&data.filters.view!=='acceptance'?btn('Показать за 7 дней',{'data-board-done':''}):''}`:
 `<ul data-board-items="${d.status}">${d.items.map(x=>boardCard(x,selected(),{personal:new URLSearchParams(params).get('view')==='mine',userId:app.store.get('currentUser')?.id})).join('')||'<li class="work-board-empty">Задач нет</li>'}</ul>
 ${d.previous_cursor || d.next_cursor ? `<footer aria-label="Страницы: ${esc(d.title)}"><span>${d.range_start}–${d.range_end} из ${d.total}</span>${cursorPagination({hasPrevious:!!d.previous_cursor,hasNext:!!d.next_cursor,label:`Страницы: ${d.title}`,previousAttrs:{'data-board-page':d.status,'data-direction':'previous','aria-label':`Предыдущие: ${d.title}`},nextAttrs:{'data-board-page':d.status,'data-direction':'next','aria-label':`Следующие: ${d.title}`}})}<p data-column-error="${d.status}" role="status"></p></footer>` : ''}`}</section>`;
 const chooseColumn=value=>{
  column=value;onColumn(column);
  root.querySelectorAll('[data-board-column]').forEach(el=>el.classList.toggle('is-mobile-column',el.dataset.boardColumn===column));
  const select=root.querySelector('#work-board-column');if(select)select.value=column;
  if(column==='cancelled'&&host.clientWidth<640)cancelled.querySelector('details')?.setAttribute('open','');
  const included=all().filter(x=>x.state==='included'),index=included.findIndex(x=>x.status===column);
  root.querySelector('[data-board-step="-1"]')?.toggleAttribute('disabled',index<=0);
  root.querySelector('[data-board-step="1"]')?.toggleAttribute('disabled',index>=included.length-1);
 };
 function render() {
  if(!data||disposed)return;
  if(root.querySelector('[data-board-menu][aria-expanded="true"]')){deferredRender=true;return;}
  deferredRender=false;
  const focusId=document.activeElement?.closest('[data-board-card]')?.dataset.boardCard;
  const hadFocus=root.contains(document.activeElement);
  clearMenus();
  // Keep the five-column active view, but omit unrelated columns for a specific status.
  const statuses=data.columns.filter(x=>x.state==='included');
  scroller.innerHTML=statuses.map(renderColumn).join('');
  const wasOpen=cancelled.querySelector('details')?.open;
  cancelled.innerHTML=data.cancelled.state==='included'?`<details ${wasOpen||data.filters.status==='cancelled'?'open':''}><summary class="ui-disclosure-text">Отменённые · ${data.cancelled.total}</summary>${renderColumn(data.cancelled)}</details>`:'';
  const included=all().filter(x=>x.state==='included');
  root.querySelector('[data-board-mobile]').innerHTML=field({id:'work-board-column',label:'Этап',kind:'select',value:column,options:included.map(x=>({value:x.status,label:`${x.title} · ${x.total}`}))});
  if(!included.some(x=>x.status===column))column=included[0]?.status||'';
  chooseColumn(column);
  window.lucide?.createIcons();
  root.querySelectorAll('[data-board-menu]').forEach(trigger=>{
   const row=find(trigger.dataset.boardMenu),panel=document.createElement('div');
   panel.innerHTML=btn('Открыть задачу',{'data-board-operation':'open'})+
    (row.transition_options||[]).map(x=>btn(x.enabled?x.label:`${x.label}: заполните обязательные поля`,{'data-board-operation':x.enabled?x.target:'edit',disabled:!x.enabled&&!row.can_edit})).join('')+
    (row.can_decide_assignment?btn('Принять назначение',{'data-board-operation':'accept-assignment'})+btn('Отклонить назначение',{'data-board-operation':'decline-assignment'}):'');
   root.append(panel);
   panel.addEventListener('click',event=>{const op=event.target.closest('[data-board-operation]')?.dataset.boardOperation;if(op)act(row,op);});
   const menu=bindActionMenu({trigger,panel,label:`Действия ${row.public_id}`,onClose:()=>{if(deferredRender&&!disposed)queueMicrotask(render);}});
   const destroy=menu.destroy;menu.destroy=()=>{destroy();panel.remove();};menus.push(menu);
  });
  root.querySelectorAll('[data-board-card]').forEach(el=>{if(busy.has(Number(el.dataset.boardCard)))el.setAttribute('aria-busy','true');});
  restore();resize();
  if(hadFocus){const target=focusId?root.querySelector(`[data-work-id="${focusId}"]`):null;(target||root.querySelector('[data-board-column] h2')||root.querySelector('[data-board-refresh]'))?.focus({preventScroll:true});}
 }
 function resize(){
  const available=innerHeight-scroller.getBoundingClientRect().top-16;
  root.classList.toggle('is-board-mobile',host.clientWidth<640);
  scroller.style.height=host.clientWidth>=640&&available>=280?`${available}px`:'';
 }
 const observer=new ResizeObserver(resize);observer.observe(host);listen(window,'resize',resize);
 async function load(nextParams=params) {
  if(disposed)return;
  const parsed=new URLSearchParams(nextParams);parsed.delete('page');parsed.delete('per_page');parsed.set('page_size','20');parsed.sort();nextParams=parsed.toString();
  const changed=nextParams!==params;
  if(reading&&!changed){pending=true;return;}
  if(changed){if(params)capture();params=nextParams;pages={};scrolls={};scrollLeft=0;savedKey='';
   try{const saved=JSON.parse(sessionStorage.getItem(storageKey()));if(saved&&Date.now()-saved.at<1800000){pages=saved.pages||{};scrolls=saved.scrolls||{};scrollLeft=saved.scrollLeft||0;}}catch{}
  }
  const request=++generation;reading=true;root.setAttribute('aria-busy','true');say(data&&!changed?'Обновление…':'Загрузка…');
  if(changed&&!data){clearMenus();scroller.innerHTML='<p>Загружаем колонки · —</p>';cancelled.innerHTML='';}
  try{
   const response=await app.api.get('/work-tasks/board?'+params+(selected()?`&selected_id=${selected()}`:''));
   if(disposed||request!==generation)return;
   if(savedKey&&savedKey!==response.query_key){pages={};say('Условия или дата изменились. Позиции обновлены.');}
   savedKey=response.query_key;
   const restored=await Promise.all(Object.entries(pages).map(async([status,cursor])=>{
    if(!cursor)return null;
    try{return await app.api.get(`/work-tasks/board/columns/${status}?${params}&cursor=${encodeURIComponent(cursor)}`);}catch{return {expired:status};}
   }));
   if(disposed||request!==generation)return;
   if(data)capture();data=response;
   let expired=false;
   for(const item of restored){if(!item)continue;if(item.expired){delete pages[item.expired];expired=true;continue;}const d=item.column;if(d.status==='cancelled')data.cancelled=d;else data.columns=data.columns.map(x=>x.status===d.status?d:x);}
   counts(data);render();say(data.selected_matches===false?'Задача больше не входит в текущую подборку. Условия сохранены.':expired?'Позиция устарела. Показана первая страница.':data.total?'':'По выбранным условиям задач нет. Измените или сбросьте фильтры.');
  }catch(e){if(!disposed&&request===generation){say(`Данные не обновлены. ${formatErrorMessage(e)}`);if([403,404].includes(Number(e.status))){clearMenus();data=null;scroller.innerHTML='';cancelled.innerHTML='';try{sessionStorage.removeItem(storageKey());}catch{}}}}
  finally{if(request===generation){reading=false;root.removeAttribute('aria-busy');if(pending){pending=false;load();}}}
 }
 async function pageColumn(status,direction,retryCursor) {
  if(cursorBusy.has(status)||reading)return;
  const descriptor=all().find(x=>x.status===status),cursor=retryCursor??descriptor?.[direction+'_cursor'];if(!cursor&&direction!=='first')return;
  const token=(cursorGeneration.get(status)||0)+1;cursorGeneration.set(status,token);cursorBusy.add(status);
  const epoch=generation;root.querySelector(`[data-board-column="${status}"]`)?.setAttribute('aria-busy','true');
  try{
   const result=await app.api.get(`/work-tasks/board/columns/${status}?${params}${cursor?'&cursor='+encodeURIComponent(cursor):''}`);
   if(disposed||epoch!==generation||cursorGeneration.get(status)!==token)return;
   capture();pages[status]=cursor||null;scrolls[status]=0;
   if(status==='cancelled')data.cancelled=result.column;else data.columns=data.columns.map(x=>x.status===status?result.column:x);
   render();capture();root.querySelector(`[data-board-column="${status}"] h2`)?.focus({preventScroll:true});
  }catch(e){if(disposed||epoch!==generation)return;
   if(Number(e.status)===409){delete pages[status];say('Позиция устарела. Обновляем колонку.');pending=true;}
   else{const error=root.querySelector(`[data-column-error="${status}"]`);if(error){error.textContent=formatErrorMessage(e);const retry=document.createElement('button');retry.className='btn btn-ghost ui-btn';retry.textContent='Повторить';retry.onclick=()=>pageColumn(status,direction,cursor);error.append(retry);}}
  }finally{cursorBusy.delete(status);root.querySelector(`[data-board-column="${status}"]`)?.removeAttribute('aria-busy');if(pending&&!reading){pending=false;load();}}
 }
 async function act(row,operation) {
  if(disposed||busy.has(row.id)||!canAct(row.id))return;
  if(['open','edit','accept-assignment','decline-assignment'].includes(operation)){await open(row.id,operation==='open'?null:operation);return;}
  const option=row.transition_options?.find(x=>x.target===operation);
  if(!option?.enabled)return;
  if(option.requires_input?.length){await open(row.id,'transition:'+operation);return;}
  busy.add(row.id);const element=root.querySelector(`[data-board-card="${row.id}"]`);element?.setAttribute('aria-busy','true');
  try{await transitionWork(app,row,operation);await load();say(`${row.public_id}: ${option.label}.`);
   (root.querySelector(`[data-work-id="${row.id}"]`)||root.querySelector(`[data-board-column="${row.status}"] h2`))?.focus({preventScroll:true});
  }catch(e){await load();say(Number(e.status)===409?'Задача изменена другим участником. Проверьте актуальные данные.':`Исход записи требует сверки. ${formatErrorMessage(e)}`);await open(row.id);}
  finally{busy.delete(row.id);element?.removeAttribute('aria-busy');root.querySelector(`[data-board-card="${row.id}"]`)?.removeAttribute('aria-busy');}
 }
 listen(root,'click',event=>{
  const target=event.target;
  if(target.closest('[data-board-menu], [data-board-operation]'))return;
  if(target.closest('[data-board-refresh]')){load();return;}
  if(target.closest('[data-board-done]')){showDone();return;}
  const pager=target.closest('[data-board-page]');if(pager){pageColumn(pager.dataset.boardPage,pager.dataset.direction);return;}
  const step=target.closest('[data-board-step]');if(step){const included=all().filter(x=>x.state==='included');chooseColumn(included[included.findIndex(x=>x.status===column)+Number(step.dataset.boardStep)]?.status||column);return;}
  const card=target.closest('[data-board-card]');if(card&&!target.closest('button:not([data-work-id])')&&!getSelection()?.toString()){if(pointer?.moved)return;open(Number(card.dataset.boardCard));}
 });
 listen(root,'change',e=>{if(e.target.id==='work-board-column')chooseColumn(e.target.value);});
 listen(scroller,'scroll',capture,{passive:true});
 listen(root,'focusin',e=>e.target.closest('[data-board-card]')?.scrollIntoView({block:'nearest',inline:'nearest'}));
 const cancelDrag=(message='')=>{
  cancelAnimationFrame(animation);animation=0;root.querySelectorAll('.is-dragging,.is-drop-target,.is-drop-active').forEach(x=>x.classList.remove('is-dragging','is-drop-target','is-drop-active'));
  root.querySelectorAll('[data-drop-label]').forEach(x=>x.remove());drag=null;if(message)say(message);
 };
 listen(root,'pointerdown',event=>{
  if(event.pointerType==='touch'||event.button!==0||event.target.closest('button:not([data-work-id]),a,input,select,textarea,summary'))return;
  // A title click opens the task; moving past the threshold drags the card.
  // Menu controls and expandable blocker content retain their own gestures.
  const card=event.target.closest('[data-board-card]');if(!card)return;
  const row=find(card.dataset.boardCard);if(!row||busy.has(row.id)||!canAct(row.id))return;
  event.preventDefault();
  pointer={id:event.pointerId,x:event.clientX,y:event.clientY,row,card,moved:false};
 });
 listen(window,'pointermove',event=>{
  if(!pointer||event.pointerId!==pointer.id)return;
  if(!drag&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)<6)return;
  event.preventDefault();pointer.moved=true;
  if(!drag){drag=pointer;pointer.card.classList.add('is-dragging');
   getSelection()?.removeAllRanges();
   for(const option of pointer.row.transition_options||[]){if(!option.enabled||option.target==='cancelled')continue;
    const col=root.querySelector(`[data-board-column="${option.target}"]:not([data-filtered])`);if(!col)continue;col.classList.add('is-drop-target');
    const label=document.createElement('p');label.dataset.dropLabel='';label.textContent=option.requires_input.includes('reason')?'Указать причину':option.requires_input.length?'Указать результат':option.label;col.prepend(label);
   }
  }
  drag.lastX=event.clientX;drag.lastY=event.clientY;
  const hover=document.elementFromPoint(event.clientX,event.clientY)?.closest('.is-drop-target');root.querySelectorAll('.is-drop-active').forEach(x=>x.classList.remove('is-drop-active'));hover?.classList.add('is-drop-active');
  if(!animation){const tick=()=>{if(!drag)return;const bounds=scroller.getBoundingClientRect();if(drag.lastX<bounds.left+40)scroller.scrollLeft-=12;if(drag.lastX>bounds.right-40)scroller.scrollLeft+=12;animation=requestAnimationFrame(tick);};animation=requestAnimationFrame(tick);}
 },{passive:false});
 listen(window,'pointerup',event=>{
  if(!pointer)return;const current=drag,target=document.elementFromPoint(event.clientX,event.clientY)?.closest('.is-drop-target')?.dataset.boardColumn;
  cancelDrag();if(current&&target&&target!==current.row.status)act(current.row,target);
  // Suppress the synthetic click after a completed gesture.
  setTimeout(()=>{pointer=null;},0);
 });
 listen(window,'pointercancel',()=>{cancelDrag();pointer=null;});
 listen(window,'keydown',e=>{if(e.key==='Escape'&&drag){e.preventDefault();cancelDrag('Перенос отменён');pointer=null;}});
 listen(document,'visibilitychange',()=>{if(document.visibilityState==='visible')load();});
 listen(window,'online',()=>load());listen(window,'offline',()=>say('Нет сети. Данные могут быть устаревшими.'));
 listen(document,'dmb:event-stream-status',event=>{if(event.detail?.connected)load();else say('Связь с обновлениями потеряна. Данные могут быть устаревшими; доступно ручное обновление.');});
 const clock=setInterval(()=>{const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});if(today!==lastDate){lastDate=today;pages={};load();}},60000);
 return {load,refresh:()=>{if(drag){cancelDrag('Задача могла измениться. Повторите перенос после обновления.');pointer=null;}return load();},
  select:()=>root.querySelectorAll('[data-board-card]').forEach(x=>x.classList.toggle('is-selected',Number(x.dataset.boardCard)===selected())),
  destroy(){capture();disposed=true;generation++;abort.abort();observer.disconnect();clearInterval(clock);cancelDrag();clearMenus();host.setAttribute('aria-live','polite');}};
}
