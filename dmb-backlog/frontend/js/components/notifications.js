import { renderNotificationPreferences, initNotificationPreferences } from './notificationPreferences.js';
import {filterValues,toggleFilterValues as toggleChoice} from '../ui/filterValues.js';
import { counter } from '../ui/dataDisplay.js';
import { loadMore } from '../ui/specialized.js';
import { escapeHtml } from '../htmlUtils.js';
import {
  formatNotificationTime,
  notificationDeadlineMeta,
  notificationCategoryMeta,
  notificationActionLabel,
  notificationImportanceMeta,
  notificationReadLocked,
  openNotificationTarget,
  recordNotificationUxEvent,
  resolveNotificationTarget,
} from '../notificationUtils.js?v=12';
import { bindViewStateAction, renderViewState } from './viewState.js';
import { button, icon, pageHeader, filterChip } from '../ui/primitives.js';
import { setButtonBusy } from '../ui/controls.js';

let page = 1, hasMore = true, loading = false, category = '', importance = '', view = 'all', requestId = 0, total = 0, liveHandler;
const CATEGORY_FILTERS = [['assignment','Назначения','user-plus'],['reporting','Встречи','clipboard-check'],['meeting_capture','Разборы встреч','clipboard-check'],['mention','Упоминания','at-sign'],['comment','Комментарии','message-circle'],['request','Запросы','clipboard-check']];
const IMPORTANCE_FILTERS = [['high','Высокий'],['medium','Обычный'],['low','Информационный']];

function plural(number, one, few, many) {
  const mod100 = number % 100, mod10 = number % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function timeGroup(value) {
  const date = new Date(value), today = new Date();
  today.setHours(0, 0, 0, 0); date.setHours(0, 0, 0, 0);
  const days = Math.round((today - date) / 86400000);
  if (days <= 0) return ['today', 'Сегодня'];
  if (days === 1) return ['yesterday', 'Вчера'];
  if (days < 7) return ['week', 'На этой неделе'];
  return ['earlier', 'Ранее'];
}

function actionLabel(n) {
  return notificationActionLabel(n);
}

function renderItem(n) {
  const { icon, label: topic } = notificationCategoryMeta(n.category);
  const { color, label: priority } = notificationImportanceMeta(n.importance);
  const isUnread = !n.is_read && !n.is_resolved;
  const readLocked = notificationReadLocked(n);
  const hasTarget = resolveNotificationTarget(n) !== '/notifications';
  const priorityBadge = ['critical','high'].includes(n.importance)
    ? `<span class="notification-priority notification-title-priority">${priority}</span>`
    : '';
  const unreadBadge = isUnread ? '<span class="notification-new-label">Новое</span>' : '';
  const deadline = notificationDeadlineMeta(n);
  const deadlineBadge = deadline
    ? `<span class="notification-deadline-badge is-${deadline.tone}"><i data-lucide="calendar-clock" aria-hidden="true"></i><span>Срок ${escapeHtml(deadline.dateLabel)}</span><strong>${escapeHtml(deadline.daysLabel)}</strong></span>`
    : '';
  const readAction = n.is_resolved || readLocked ? '' : isUnread
    ? button({ label: 'Отметить прочитанным', icon: 'mail-open', iconOnly: true, variant: 'ghost', size: 'small', className: 'notification-read-btn', attrs: { 'data-mark-read': true } })
    : button({ label: 'Отметить непрочитанным', icon: 'mail', iconOnly: true, variant: 'ghost', size: 'small', className: 'notification-unread-btn', attrs: { 'data-mark-unread': true } });
  return `<article role="listitem" class="notification-card ${isUnread ? 'is-unread' : 'is-read'} ${n.is_resolved ? 'is-resolved' : ''} importance-${escapeHtml(n.importance || 'low')}" data-notif-id="${n.id}" data-category="${escapeHtml(n.category || '')}" data-read-locked="${readLocked ? 'true' : 'false'}">
    <div class="notification-card-icon" style="background:${color}15;color:${color}"><i data-lucide="${icon}" aria-hidden="true"></i></div>
    <div class="notification-card-content"><div class="notification-card-title-row">${isUnread ? '<span class="notification-unread-dot" aria-hidden="true"></span>' : ''}<h3>${escapeHtml(n.title)}</h3>${unreadBadge}${priorityBadge}</div>
      <div class="notification-card-meta"><span class="notification-topic">${topic}</span>${n.is_resolved ? '<span class="notification-resolved-label">Закрыто</span>' : ''}${deadlineBadge}<time datetime="${escapeHtml(n.created_at || '')}">${formatNotificationTime(n.created_at)}</time>${n.group_count > 1 ? `<span class="notification-group-count">${n.group_count} ${plural(n.group_count,'событие','события','событий')}</span>` : ''}</div>${n.body ? `<p>${escapeHtml(n.body)}</p>` : ''}</div>
    <div class="notification-card-actions">${hasTarget ? button({ label: actionLabel(n), icon: 'arrow-right', variant: !isUnread && !n.is_resolved ? 'secondary' : 'primary', size: 'small', attrs: { 'data-open-notification': true, 'data-task-id': n.task_id || '', 'data-action-url': encodeURIComponent(n.target?.url || n.action_url || ''), 'aria-label': `${actionLabel(n)}: ${n.title}` } }) : ''}${readAction}</div>
  </article>`;
}

function renderItems(items, append) {
  let previous = append ? document.querySelector('.notification-time-group:last-of-type')?.dataset.timeGroup : '';
  return items.map(item => {
    const [key, label] = timeGroup(item.created_at);
    const heading = key === previous ? '' : `<h3 class="notification-time-group" data-time-group="${key}">${label}</h3>`;
    previous = key;
    return heading + renderItem(item);
  }).join('');
}

function setCardReadState(card, isRead) {
  if (!card || card.classList.contains('is-resolved')) return;
  const titleRow = card.querySelector('.notification-card-title-row');
  const action = card.querySelector('[data-mark-read],[data-mark-unread]');
  card.classList.toggle('is-read', isRead);
  card.classList.toggle('is-unread', !isRead);
  const targetAction = card.querySelector('[data-open-notification]');
  targetAction?.classList.toggle('btn-primary', !isRead);
  targetAction?.classList.toggle('btn-secondary', isRead);
  titleRow?.querySelector('.notification-unread-dot')?.remove();
  titleRow?.querySelector('.notification-new-label')?.remove();
  if (!isRead && titleRow) {
    titleRow.insertAdjacentHTML('afterbegin', '<span class="notification-unread-dot" aria-hidden="true"></span>');
    titleRow.querySelector('h3')?.insertAdjacentHTML('afterend', '<span class="notification-new-label">Новое</span>');
  }
  if (action) {
    action.toggleAttribute('data-mark-read', !isRead);
    action.toggleAttribute('data-mark-unread', isRead);
    action.classList.toggle('notification-read-btn', !isRead);
    action.classList.toggle('notification-unread-btn', isRead);
    const label = isRead ? 'Отметить непрочитанным' : 'Отметить прочитанным';
    action.setAttribute('aria-label', label);
    action.setAttribute('title', label);
    action.innerHTML = `<i data-lucide="${isRead ? 'mail' : 'mail-open'}" aria-hidden="true"></i>`;
  }
  window.lucide?.createIcons();
}

function updateVisibleReadStates(ids, isRead) {
  (ids || []).forEach(id => {
    const card = document.querySelector(`.notification-card[data-notif-id="${Number(id)}"]`);
    setCardReadState(card, isRead);
  });
}

function removeVisibleNotifications(ids) {
  (ids || []).forEach(id => {
    document.querySelector(`.notification-card[data-notif-id="${Number(id)}"]`)?.remove();
  });
}

function params() {
  const p = new URLSearchParams({ page:String(page), per_page:'20' });
  if (category) p.set('category', category);
  if (importance) p.set('importance', importance);
  if(filterValues(view).length>1){p.set('views',view);return p;}
  if (view === 'unread') p.set('unread_only','true'); if (view === 'action') p.set('requires_action','true'); if (view === 'resolved') p.set('resolved','true'); if (view === 'open') p.set('resolved','false');
  return p;
}

function readRouteState() {
  const [, raw = ''] = window.location.hash.slice(1).split('?');
  const route = new URLSearchParams(raw);
  const allowedViews = new Set(['all', 'action', 'unread', 'resolved']);
  view = filterValues(route.get('view')).length && filterValues(route.get('view')).every(value=>allowedViews.has(value)) ? route.get('view') : 'all';
  category = route.get('category') || '';
  importance = route.get('importance') || '';
}

function syncRouteState() {
  const route = new URLSearchParams();
  if (view !== 'all') route.set('view', view);
  if (category) route.set('category', category);
  if (importance) route.set('importance', importance);
  const query = route.toString();
  history.replaceState(history.state, '', `#/notifications${query ? `?${query}` : ''}`);
}

function updateCount() {
  const count = document.getElementById('notification-results-count'); if (count) count.textContent = `${total} ${plural(total,'уведомление','уведомления','уведомлений')}`;
  const more = document.getElementById('notifications-load-more'); if (more) more.hidden = !hasMore;
}

function resetControls() {
  category = ''; importance = ''; view = 'all';
  syncControlState();
  updateFilterState();
}

function syncControlState() {
  document.querySelectorAll('[data-view]').forEach(el => {
    const active = filterValues(view).includes(el.dataset.view);
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-filter-category]').forEach(el => {
    const active = el.dataset.filterCategory ? filterValues(category).includes(el.dataset.filterCategory) : !category;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-filter-importance]').forEach(el => {
    const active = el.dataset.filterImportance ? filterValues(importance).includes(el.dataset.filterImportance) : !importance;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
}

function updateFilterState() {
  const filtered = Boolean(category || importance || view !== 'all');
  const reset = document.getElementById('notification-reset');
  if (reset) reset.disabled = !filtered;
}

function emptyState(container, app) {
  const filtered = category || importance || view !== 'all';
  container.innerHTML = renderViewState({ kind:'empty', title:filtered ? 'Ничего не найдено' : 'У вас пока нет уведомлений', message:filtered ? 'Измените или сбросьте фильтры.' : 'Новые события появятся здесь.', actionLabel:filtered ? 'Сбросить фильтры' : '' });
  if (filtered) bindViewStateAction(container, () => { resetControls(); syncRouteState(); page=1; hasMore=true; load(app); });
}

async function summary(app) {
  try {
    const snapshot = await app.notificationStore.refresh({ source:'center' });
    const data = snapshot.summary, set = (id,value) => { const el=document.getElementById(id); if(el) el.textContent=value; };
    set('notif-stat-action',data.requires_action||0); set('notif-stat-unread',data.unread||0); set('notif-stat-today',data.today||0);
    const mark=document.getElementById('mark-all-read'); if(mark){ mark.disabled=!data.unread; mark.hidden=!data.unread; }
    document.querySelectorAll('[data-category-count]').forEach(el => { const value=data.by_category?.[el.dataset.categoryCount]||0; el.textContent=value ? `${value} ${plural(value,'новое','новых','новых')}` : ''; el.hidden=!value; });
  } catch { window.toast?.('Не удалось обновить сводку уведомлений','error'); }
}

async function badge(app) {
  if (app.refreshNotifications) return app.refreshNotifications();
  const {count}=await app.api.get('/notifications/unread-count'), top=document.getElementById('notif-badge'), side=document.getElementById('notification-count');
  if(top)top.outerHTML=counter({value:count,cap:99,tone:'unread',label:'Непрочитанных уведомлений',id:'notif-badge',className:'notif-badge',hidden:count===0});if(side)side.outerHTML=counter({value:count,cap:99,tone:'unread',label:'Непрочитанных уведомлений',id:'notification-count',className:'item-badge'});
}

async function load(app, append=false, silent=false) {
  if (append && (loading || !hasMore)) return; const focused=document.activeElement, focusedCard=focused?.closest?.('.notification-card'), focusedId=focusedCard?.dataset.notifId, focusedIndex=focusedCard ? [...document.querySelectorAll('.notification-card')].indexOf(focusedCard) : -1; const id=++requestId, list=document.getElementById('notifications-list'), more=document.getElementById('notifications-load-more'); loading=true;
  if(!append&&list){list.setAttribute('aria-busy','true');if(!silent)list.innerHTML=renderViewState({kind:'loading',title:'Загружаем уведомления…'});} setButtonBusy(more,true,'Загружаем…');
  try {
    const data=await app.api.get(`/notifications?${params()}`); if(id!==requestId||!list)return; if(!append)list.innerHTML=''; if(!data.items.length&&!append)emptyState(list,app);else list.insertAdjacentHTML('beforeend',renderItems(data.items,append));
    if (focusedId && (document.activeElement === focused || document.activeElement === document.body)) {
      const cards=[...list.querySelectorAll('.notification-card')];
      const next=cards.find(card=>card.dataset.notifId===focusedId)||cards[Math.min(focusedIndex,cards.length-1)];
      const target=next?.querySelector('[data-mark-read],[data-mark-unread]')||next?.querySelector('button')||document.getElementById('notifications-heading');
      if(target){if(target.tagName==='H2')target.setAttribute('tabindex','-1');target.focus({preventScroll:true});}
    }
    total=data.total||0;hasMore=data.items.length>0&&page*20<total;if(data.items.length)page+=1;updateCount();window.lucide?.createIcons();await Promise.allSettled([badge(app),summary(app)]);
  } catch(error) {
    if(id!==requestId||!list)return; if(append||silent)window.toast?.(window.formatErrorMessage?.(error)||'Не удалось обновить уведомления','error');else{total=0;hasMore=false;updateCount();document.getElementById('notification-results-count').textContent='Количество неизвестно';list.innerHTML=renderViewState({kind:'error',message:window.formatErrorMessage?.(error)||'Повторите попытку позже.',actionLabel:'Повторить'});bindViewStateAction(list,()=>load(app));window.lucide?.createIcons();}
  } finally { if(id===requestId){loading=false;list?.removeAttribute('aria-busy');setButtonBusy(more,false);} }
}

export function renderNotifications() {
  const filter = (label, attrs, selected = false, iconName) => filterChip({label,icon:iconName,count:null,selected,className:'notification-filter-chip',attrs});
  const categoryFilters = CATEGORY_FILTERS.map(([key,label,iconName]) => filter(label, { 'data-filter-category': key }, false, iconName)).join('');
  const importanceFilters = IMPORTANCE_FILTERS.map(([key,label]) => filter(label, { 'data-filter-importance': key })).join('');
  const stateFilters = [['all','Все'],['action','Требуют действия'],['unread','Непрочитанные'],['resolved','Закрытые']].map(([key,label]) => filter(label, { 'data-view': key }, key === 'all')).join('');
  const stats = '<div class="notification-stats" aria-label="Сводка уведомлений"><span><strong id="notif-stat-action">—</strong> требуют действия</span><span><strong id="notif-stat-unread">—</strong> непрочитанных</span><span><strong id="notif-stat-today">—</strong> сегодня</span></div>';
  const actions = `<div class="notification-header-actions">${button({ label: 'Прочитать все', icon: 'check-check', size: 'small', attrs: { id: 'mark-all-read', title: 'Во всех категориях, независимо от фильтров. Обязательные действия остаются до выполнения.' } })}</div>`;
  return `<section class="notification-center animate-fade-in"><header class="page-header">${pageHeader({ title: 'Мои уведомления', description: 'Назначения, отчётные статусы и обсуждения команды', className: 'notification-hero', actions: stats + actions })}</header>
  ${renderNotificationPreferences()}
  <div class="notification-workspace"><div class="notification-toolbar" aria-label="Фильтры уведомлений"><div class="notification-filter-group notification-state-filter" role="group" aria-labelledby="notification-state-label"><span class="notification-filter-group-label" id="notification-state-label">Состояние</span><div class="notification-filter-options">${stateFilters}</div></div>${button({ label: 'Сбросить', size: 'small', attrs: { id: 'notification-reset', disabled: true } })}<div class="notification-quick-filters"><div class="notification-filter-group" role="group" aria-labelledby="notification-category-label"><span class="notification-filter-group-label" id="notification-category-label">Категория</span><div class="notification-filter-options">${categoryFilters}</div></div><div class="notification-filter-group" role="group" aria-labelledby="notification-importance-label"><span class="notification-filter-group-label" id="notification-importance-label">Приоритет</span><div class="notification-filter-options">${importanceFilters}</div></div></div></div>
  <section class="notification-feed" aria-labelledby="notifications-heading"><div class="notification-feed-header"><div><h2 id="notifications-heading">Уведомления</h2><p id="notification-results-count" role="status" aria-live="polite">Загрузка…</p></div>${button({ label: 'Появились новые — показать', size: 'small', attrs: { id: 'notifications-newer', hidden: true } })}</div><div id="notifications-list" role="list">${renderViewState({kind:'loading',title:'Загружаем уведомления…'})}</div><div class="notification-load-more">${loadMore({ attrs: { id: 'notifications-load-more', hidden: true } })}</div></section></div></section>`;
}

export async function initNotifications(app) {
  initNotificationPreferences(app);
  page=1;hasMore=true;loading=false;category='';importance='';view='all';requestId+=1;
  readRouteState();
  syncControlState();
  updateFilterState();
  const reload=(silent=false)=>{page=1;hasMore=true;return load(app,false,silent);};
  const applyFilters=()=>{syncRouteState();syncControlState();updateFilterState();reload();};

  document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>{view=toggleChoice(view,btn.dataset.view,'all');applyFilters();}));
  document.querySelectorAll('[data-filter-category]').forEach(btn=>btn.addEventListener('click',()=>{category=toggleChoice(category,btn.dataset.filterCategory);applyFilters();}));
  document.querySelectorAll('[data-filter-importance]').forEach(btn=>btn.addEventListener('click',()=>{importance=toggleChoice(importance,btn.dataset.filterImportance);applyFilters();}));
  document.getElementById('notification-reset')?.addEventListener('click',()=>{resetControls();syncRouteState();reload();});
  document.getElementById('notifications-load-more')?.addEventListener('click',()=>load(app,true));
  document.getElementById('notifications-newer')?.addEventListener('click',async e=>{e.currentTarget.hidden=true;await reload(true);});

  document.getElementById('mark-all-read')?.addEventListener('click',async e=>{
    const btn=e.currentTarget;setButtonBusy(btn,true,'Отмечаем…');
    try{
      const result=await app.api.put('/notifications/read-all');
      const ids=result.changed_ids||[];
      await reload(true);
      window.toast?.(ids.length ? `Отмечено прочитанными: ${ids.length}. Во всех категориях; обязательные действия остаются до выполнения.` : 'Нет уведомлений для отметки. Обязательные действия остаются до выполнения.',ids.length?'success':'info',ids.length?{duration:7000,actionLabel:'Отменить',onAction:async()=>{try{await app.api.put('/notifications/unread',{ids});window.toast?.('Непрочитанные восстановлены','success');await reload(true);}catch(error){window.toast?.(window.formatErrorMessage?.(error)||'Не удалось отменить действие','error');}}}:undefined);
    }catch(error){window.toast?.(window.formatErrorMessage?.(error)||'Не удалось отметить уведомления','error');}
    finally{setButtonBusy(btn,false);}
  });

  document.getElementById('notifications-list')?.addEventListener('click',async e=>{
    const btn=e.target.closest('[data-open-notification],[data-mark-read],[data-mark-unread]');
    if(!btn || btn.disabled)return;
    const card=btn.closest('.notification-card'),id=Number(card?.dataset.notifId);
    btn.disabled=true;btn.setAttribute('aria-busy','true');
    try{
      if(btn.matches('[data-mark-read],[data-mark-unread]')){
        const markUnread=btn.matches('[data-mark-unread]');
        setCardReadState(card, !markUnread);
        setButtonBusy(btn,true);
        try {
          await app.api.put(markUnread?'/notifications/unread':'/notifications/read',{ids:[id]});
          Promise.allSettled([badge(app),summary(app)]);
          reload(true);
        } catch (error) {
          setButtonBusy(btn,false);
          setCardReadState(card, markUnread);
          throw error;
        }
      } else {
        setButtonBusy(btn,true,'Открываем…');
        if(card?.classList.contains('is-unread') && card.dataset.readLocked !== 'true'){
          try{await app.api.put('/notifications/read',{ids:[id]});}catch(error){window.toast?.(window.formatErrorMessage?.(error)||'Не удалось обновить отметку о прочтении','warning');}
        }
        sessionStorage.setItem('notifications:return-scroll',String(document.querySelector('.main-content')?.scrollTop || window.scrollY));
        sessionStorage.setItem('notifications:return-pages',String(Math.max(1,page-1)));
        const notification = {
          task_id:Number(btn.dataset.taskId)||null,
          action_url:decodeURIComponent(btn.dataset.actionUrl||''),
          category:card?.dataset.category||'',
          is_resolved:card?.classList.contains('is-resolved'),
        };
        recordNotificationUxEvent(app, 'notification_primary_action_clicked', {
          surface:'center', category:notification.category || null,
        });
        openNotificationTarget(app, notification, { surface:'center' });
      }
    }catch(error){window.toast?.(window.formatErrorMessage?.(error)||'Не удалось выполнить действие','error');}
    finally{if(btn.isConnected){setButtonBusy(btn,false);btn.disabled=false;btn.removeAttribute('aria-busy');}}
  });

  if(liveHandler)document.removeEventListener('dmb:notification-changed',liveHandler);
  liveHandler=async event=>{
    if((window.location.hash.slice(1).split('?')[0]||'')!=='/notifications')return;
    const action=event.detail?.action,ids=event.detail?.notification_ids;
    if(action==='removed'&&Array.isArray(ids)){
      removeVisibleNotifications(ids);
      await reload(true);
      return;
    }
    if((action==='read'||action==='unread')&&Array.isArray(ids)){
      updateVisibleReadStates(ids,action==='read');
      await reload(true);
      return;
    }
    await Promise.allSettled([badge(app),summary(app)]);
    if(window.scrollY<240)await reload(true);
    else{const newer=document.getElementById('notifications-newer');if(newer)newer.hidden=false;}
  };
  document.addEventListener('dmb:notification-changed',liveHandler);

  await load(app);
  const returnPages = Number(sessionStorage.getItem('notifications:return-pages')) || 1;
  sessionStorage.removeItem('notifications:return-pages');
  while (hasMore && page <= returnPages) {
    const previousPage = page;
    await load(app,true);
    if (page === previousPage) break;
  }
  const returnScroll=Number(sessionStorage.getItem('notifications:return-scroll'));
  sessionStorage.removeItem('notifications:return-scroll');
  if(Number.isFinite(returnScroll)&&returnScroll>0)requestAnimationFrame(()=>{const scroller=document.querySelector('.main-content');if(scroller)scroller.scrollTop=returnScroll;else window.scrollTo({top:returnScroll,behavior:'auto'});});
}
