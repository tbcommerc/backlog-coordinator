import { escapeHtml } from '../htmlUtils.js';
import {
  formatNotificationTime,
  notificationCategoryMeta,
  notificationActionLabel,
  notificationImportanceMeta,
  openNotificationTarget,
  recordNotificationUxEvent,
  resolveNotificationTarget,
} from '../notificationUtils.js?v=3';
import { bindViewStateAction, renderViewState } from './viewState.js';

let page = 1, hasMore = true, loading = false, category = '', importance = '', view = 'all', requestId = 0, total = 0, liveHandler;
const CATEGORY_FILTERS = [['assignment','Назначения','user-plus'],['reporting','Встречи','clipboard-check'],['mention','Упоминания','at-sign'],['comment','Комментарии','message-circle'],['request','Запросы','clipboard-check']];
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
  const hasTarget = resolveNotificationTarget(n) !== '/notifications';
  const priorityBadge = ['critical','high'].includes(n.importance)
    ? `<span class="notification-priority notification-title-priority">${priority}</span>`
    : '';
  const unreadBadge = isUnread ? '<span class="notification-new-label">Новое</span>' : '';
  const readAction = n.is_resolved ? '' : isUnread
    ? '<button type="button" class="notification-icon-btn notification-read-btn" data-mark-read aria-label="Отметить прочитанным" title="Отметить прочитанным"><i data-lucide="mail-open" aria-hidden="true"></i></button>'
    : '<button type="button" class="notification-icon-btn notification-unread-btn" data-mark-unread aria-label="Отметить непрочитанным" title="Отметить непрочитанным"><i data-lucide="mail" aria-hidden="true"></i></button>';
  return `<article role="listitem" class="notification-card ${isUnread ? 'is-unread' : 'is-read'} ${n.is_resolved ? 'is-resolved' : ''} importance-${escapeHtml(n.importance || 'low')}" data-notif-id="${n.id}" data-category="${escapeHtml(n.category || '')}">
    <div class="notification-card-icon" style="background:${color}15;color:${color}"><i data-lucide="${icon}" aria-hidden="true"></i></div>
    <div class="notification-card-content"><div class="notification-card-title-row">${isUnread ? '<span class="notification-unread-dot" aria-hidden="true"></span>' : ''}<h3>${escapeHtml(n.title)}</h3>${unreadBadge}${priorityBadge}</div>
      <div class="notification-card-meta"><span class="notification-topic">${topic}</span>${n.is_resolved ? '<span class="notification-resolved-label">Закрыто</span>' : ''}<time datetime="${escapeHtml(n.created_at || '')}">${formatNotificationTime(n.created_at)}</time>${n.group_count > 1 ? `<span class="notification-group-count">${n.group_count} ${plural(n.group_count,'событие','события','событий')}</span>` : ''}</div>${n.body ? `<p>${escapeHtml(n.body)}</p>` : ''}</div>
    <div class="notification-card-actions">${hasTarget ? `<button type="button" data-open-notification data-task-id="${n.task_id || ''}" data-action-url="${encodeURIComponent(n.target?.url || n.action_url || '')}" class="btn btn-primary btn-sm" aria-label="${escapeHtml(actionLabel(n))}: ${escapeHtml(n.title)}">${actionLabel(n)} <i data-lucide="arrow-right" aria-hidden="true"></i></button>` : ''}${readAction}</div>
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

function params() {
  const p = new URLSearchParams({ page:String(page), per_page:'20' });
  if (category) p.set('category', category);
  if (importance) p.set('importance', importance);
  if (view === 'unread') p.set('unread_only','true'); if (view === 'action') p.set('requires_action','true'); if (view === 'resolved') p.set('resolved','true'); if (view === 'open') p.set('resolved','false');
  return p;
}

function readRouteState() {
  const [, raw = ''] = window.location.hash.slice(1).split('?');
  const route = new URLSearchParams(raw);
  const allowedViews = new Set(['all', 'action', 'unread', 'resolved']);
  view = allowedViews.has(route.get('view')) ? route.get('view') : 'all';
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
    const active = el.dataset.view === view;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-filter-category]').forEach(el => {
    const active = el.dataset.filterCategory === category;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-filter-importance]').forEach(el => {
    const active = el.dataset.filterImportance === importance;
    el.classList.toggle('active', active);
    el.setAttribute('aria-pressed', String(active));
  });
}

function updateFilterState() {
  const filtered = Boolean(category || importance || view !== 'all');
  const reset = document.getElementById('notification-reset');
  if (reset) reset.disabled = !filtered;
}

function emptyState(container) {
  const filtered = category || importance || view !== 'all';
  container.innerHTML = renderViewState({ kind:'empty', title:filtered ? 'Ничего не найдено' : 'У вас пока нет уведомлений', message:filtered ? 'Измените или сбросьте фильтры.' : 'Новые события появятся здесь.', actionLabel:filtered ? 'Сбросить фильтры' : '' });
  if (filtered) bindViewStateAction(container, () => { resetControls(); document.getElementById('notification-reset')?.click(); });
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
  const {count}=await app.api.get('/notifications/unread-count'), value=count>99?'99+':count, top=document.getElementById('notif-badge'), side=document.getElementById('notification-count');
  if(top){top.textContent=value;top.classList.toggle('hidden',count===0);} if(side)side.textContent=value;
}

async function load(app, append=false, silent=false) {
  if (loading && append) return; const id=++requestId, list=document.getElementById('notifications-list'), more=document.getElementById('notifications-load-more'); loading=true;
  if(!append&&list){list.setAttribute('aria-busy','true');if(!silent)list.innerHTML=renderViewState({kind:'loading',title:'Загружаем уведомления…'});} if(more){more.disabled=true;more.setAttribute('aria-busy','true');}
  try {
    const data=await app.api.get(`/notifications?${params()}`); if(id!==requestId||!list)return; if(!append)list.innerHTML=''; if(!data.items.length&&!append)emptyState(list);else list.insertAdjacentHTML('beforeend',renderItems(data.items,append));
    total=data.total||0;hasMore=data.items.length>0&&page*20<total;if(data.items.length)page+=1;updateCount();window.lucide?.createIcons();await Promise.allSettled([badge(app),summary(app)]);
  } catch(error) {
    if(id!==requestId||!list)return; if(append||silent)window.toast?.(window.formatErrorMessage?.(error)||'Не удалось обновить уведомления','error');else{list.innerHTML=renderViewState({kind:'error',message:window.formatErrorMessage?.(error)||'Повторите попытку позже.',actionLabel:'Повторить'});bindViewStateAction(list,()=>load(app));window.lucide?.createIcons();}
  } finally { if(id===requestId){loading=false;list?.removeAttribute('aria-busy');if(more){more.disabled=false;more.removeAttribute('aria-busy');}} }
}

export function renderNotifications() {
  const categoryFilters=CATEGORY_FILTERS.map(([key,label,icon])=>`<button type="button" class="filter-chip notification-filter-chip" data-filter-category="${key}" aria-pressed="false"><i data-lucide="${icon}" aria-hidden="true"></i>${label}</button>`).join('');
  const importanceFilters=IMPORTANCE_FILTERS.map(([key,label])=>`<button type="button" class="filter-chip notification-filter-chip notification-importance-chip importance-${key}" data-filter-importance="${key}" aria-pressed="false"><span class="notification-filter-dot" aria-hidden="true"></span>${label}</button>`).join('');
  return `<section class="notification-center animate-fade-in"><header class="notification-hero page-header"><div><h1>Мои уведомления</h1><p>Личные назначения, отчётные статусы и обсуждения команды</p><div class="notification-stats" aria-label="Сводка уведомлений"><span><strong id="notif-stat-action">—</strong> требуют действия</span><span><strong id="notif-stat-unread">—</strong> непрочитанных</span><span><strong id="notif-stat-today">—</strong> сегодня</span></div></div><div class="notification-header-actions"><a class="btn btn-secondary btn-sm" href="#/settings?section=notifications"><i data-lucide="settings" aria-hidden="true"></i> Настроить</a><button type="button" class="btn btn-secondary btn-sm" id="mark-all-read"><i data-lucide="check-check" aria-hidden="true"></i> Прочитать все</button></div></header>
  <div class="notification-workspace"><div class="notification-toolbar" aria-label="Фильтры уведомлений"><div class="notification-filter-group notification-state-filter" role="group" aria-labelledby="notification-state-label"><span class="notification-filter-group-label" id="notification-state-label">Состояние</span><div class="notification-filter-options"><button type="button" class="filter-chip notification-filter-chip active" aria-pressed="true" data-view="all">Все</button><button type="button" class="filter-chip notification-filter-chip" aria-pressed="false" data-view="action">Требуют действия</button><button type="button" class="filter-chip notification-filter-chip" aria-pressed="false" data-view="unread">Непрочитанные</button><button type="button" class="filter-chip notification-filter-chip" aria-pressed="false" data-view="resolved">Закрытые</button></div></div><button type="button" class="btn btn-secondary btn-sm" id="notification-reset" disabled>Сбросить</button><div class="notification-quick-filters"><div class="notification-filter-group" role="group" aria-labelledby="notification-category-label"><span class="notification-filter-group-label" id="notification-category-label">Категория</span><div class="notification-filter-options">${categoryFilters}</div></div><div class="notification-filter-group" role="group" aria-labelledby="notification-importance-label"><span class="notification-filter-group-label" id="notification-importance-label">Приоритет</span><div class="notification-filter-options">${importanceFilters}</div></div></div></div>
  <section class="notification-feed" aria-labelledby="notifications-heading"><div class="notification-feed-header"><div><h2 id="notifications-heading">Уведомления</h2><p id="notification-results-count" role="status" aria-live="polite">Загрузка…</p></div><button type="button" class="btn btn-secondary btn-sm" id="notifications-newer" hidden>Появились новые — показать</button></div><div id="notifications-list" role="list">${renderViewState({kind:'loading',title:'Загружаем уведомления…'})}</div><div class="notification-load-more"><button type="button" class="btn btn-secondary" id="notifications-load-more" hidden>Загрузить ещё</button></div></section></div></section>`;
}

export async function initNotifications(app) {
  page=1;hasMore=true;loading=false;category='';importance='';view='all';requestId+=1;
  readRouteState();
  syncControlState();
  updateFilterState();
  const reload=(silent=false)=>{page=1;hasMore=true;return load(app,false,silent);};
  const applyFilters=()=>{syncRouteState();syncControlState();updateFilterState();reload();};

  document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>{view=btn.dataset.view;applyFilters();}));
  document.querySelectorAll('[data-filter-category]').forEach(btn=>btn.addEventListener('click',()=>{category=category===btn.dataset.filterCategory?'':btn.dataset.filterCategory;applyFilters();}));
  document.querySelectorAll('[data-filter-importance]').forEach(btn=>btn.addEventListener('click',()=>{importance=importance===btn.dataset.filterImportance?'':btn.dataset.filterImportance;applyFilters();}));
  document.getElementById('notification-reset')?.addEventListener('click',()=>{resetControls();syncRouteState();reload();});
  document.getElementById('notifications-load-more')?.addEventListener('click',()=>load(app,true));
  document.getElementById('notifications-newer')?.addEventListener('click',async e=>{e.currentTarget.hidden=true;await reload(true);});

  document.getElementById('mark-all-read')?.addEventListener('click',async e=>{
    const btn=e.currentTarget;btn.disabled=true;btn.setAttribute('aria-busy','true');
    try{
      const result=await app.api.put('/notifications/read-all');
      const ids=result.changed_ids||[];
      await reload(true);
      window.toast?.('Все уведомления отмечены прочитанными','success',ids.length?{duration:7000,actionLabel:'Отменить',onAction:async()=>{try{await app.api.put('/notifications/unread',{ids});window.toast?.('Непрочитанные восстановлены','success');await reload(true);}catch(error){window.toast?.(window.formatErrorMessage?.(error)||'Не удалось отменить действие','error');}}}:undefined);
    }catch(error){window.toast?.(window.formatErrorMessage?.(error)||'Не удалось отметить уведомления','error');}
    finally{btn.removeAttribute('aria-busy');btn.disabled=false;}
  });

  document.getElementById('notifications-list')?.addEventListener('click',async e=>{
    const btn=e.target.closest('[data-open-notification],[data-mark-read],[data-mark-unread]');
    if(!btn)return;
    const card=btn.closest('.notification-card'),id=Number(card?.dataset.notifId);
    btn.disabled=true;btn.setAttribute('aria-busy','true');
    try{
      if(btn.matches('[data-mark-read],[data-mark-unread]')){
        const markUnread=btn.matches('[data-mark-unread]');
        setCardReadState(card, !markUnread);
        try {
          await app.api.put(markUnread?'/notifications/unread':'/notifications/read',{ids:[id]});
          Promise.allSettled([badge(app),summary(app)]);
        } catch (error) {
          setCardReadState(card, markUnread);
          throw error;
        }
      } else {
        if(card?.classList.contains('is-unread')){
          try{await app.api.put('/notifications/read',{ids:[id]});}catch(error){window.toast?.(window.formatErrorMessage?.(error)||'Не удалось обновить отметку о прочтении','warning');}
        }
        sessionStorage.setItem('notifications:return-scroll',String(window.scrollY));
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
    finally{if(btn.isConnected){btn.disabled=false;btn.removeAttribute('aria-busy');}}
  });

  if(liveHandler)document.removeEventListener('dmb:notification-changed',liveHandler);
  liveHandler=async event=>{
    if((window.location.hash.slice(1).split('?')[0]||'')!=='/notifications')return;
    const action=event.detail?.action,ids=event.detail?.notification_ids;
    if((action==='read'||action==='unread')&&Array.isArray(ids)){
      updateVisibleReadStates(ids,action==='read');
      await Promise.allSettled([badge(app),summary(app)]);
      return;
    }
    await Promise.allSettled([badge(app),summary(app)]);
    if(window.scrollY<240)await reload(true);
    else{const newer=document.getElementById('notifications-newer');if(newer)newer.hidden=false;}
  };
  document.addEventListener('dmb:notification-changed',liveHandler);

  await load(app);
  const returnScroll=Number(sessionStorage.getItem('notifications:return-scroll'));
  sessionStorage.removeItem('notifications:return-scroll');
  if(Number.isFinite(returnScroll)&&returnScroll>0)requestAnimationFrame(()=>window.scrollTo({top:returnScroll,behavior:'auto'}));
}
