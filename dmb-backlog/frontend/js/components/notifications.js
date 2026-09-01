import { escapeHtml } from '../htmlUtils.js';
import { bindViewStateAction, renderViewState } from './viewState.js';

let page = 1, hasMore = true, loading = false, category = '', view = 'all', importance = '', search = '', requestId = 0, total = 0, searchTimer;
const META = { risk:['alert-triangle','Риск'], deadline:['clock','Дедлайн'], status_change:['refresh-cw','Статус'], assignment:['user-plus','Назначение'], mention:['at-sign','Упоминание'], comment:['message-circle','Комментарий'], express:['zap','Экспресс'], editing:['pencil','Редактирование'], stale:['timer','Давность'], attrs:['file-text','Атрибуты'], system:['info','Система'] };
const COLORS = { critical:'var(--danger)', high:'var(--warning)', medium:'var(--info)', low:'var(--text-muted)' };
const PRIORITIES = { critical:'Критический', high:'Высокий', medium:'Обычный', low:'Информационный' };

function plural(number, one, few, many) {
  const mod100 = number % 100, mod10 = number % 10;
  if (mod100 >= 11 && mod100 <= 19) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function timeLabel(value) {
  if (!value) return '';
  const date = new Date(value), diff = Math.max(0, Date.now() - date.getTime());
  const mins = Math.floor(diff / 60000), hours = Math.floor(diff / 3600000), days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Только что'; if (mins < 60) return `${mins} мин. назад`; if (hours < 24) return `${hours} ч. назад`; if (days < 7) return `${days} д. назад`;
  const options = { day:'numeric', month:'short' };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString('ru-RU', options);
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
  const url = n.action_url || '';
  if (n.task_id) return ['comment','mention'].includes(n.category) ? 'К обсуждению' : 'Открыть задачу';
  if (url.includes('/settings')) return 'Настроить'; if (url.includes('/review/')) return 'Перейти к ревью'; if (url.includes('/customer/request/')) return 'Открыть запрос';
  if (url.includes('filter=')) return 'Показать задачи'; if (url.includes('/express-estimate')) return 'Открыть оценку'; return 'Открыть';
}

function renderItem(n) {
  const [icon, topic] = META[n.category] || META.system, color = COLORS[n.importance] || 'var(--text-muted)';
  return `<article class="notification-card ${n.is_read ? '' : 'is-unread'} ${n.is_resolved ? 'is-resolved' : ''} importance-${escapeHtml(n.importance || 'low')}" data-notif-id="${n.id}">
    <div class="notification-card-icon" style="background:${color}15;color:${color}"><i data-lucide="${icon}" aria-hidden="true"></i></div>
    <div class="notification-card-content"><div class="notification-card-title-row">${n.is_read ? '' : '<span class="notification-unread-dot" aria-label="Непрочитанное"></span>'}<h3>${escapeHtml(n.title)}</h3></div>
      <div class="notification-card-meta"><span class="notification-topic">${topic}</span><span class="notification-priority">${PRIORITIES[n.importance] || 'Информационный'}</span>${n.is_resolved ? '<span class="notification-resolved-label">Закрыто</span>' : ''}<time datetime="${escapeHtml(n.created_at || '')}">${timeLabel(n.created_at)}</time>${n.group_count > 1 ? `<span class="notification-group-count">${n.group_count} ${plural(n.group_count,'событие','события','событий')}</span>` : ''}</div>${n.body ? `<p>${escapeHtml(n.body)}</p>` : ''}</div>
    <div class="notification-card-actions">${(n.task_id || n.action_url) ? `<button type="button" data-open-notification data-task-id="${n.task_id || ''}" data-action-url="${encodeURIComponent(n.action_url || '')}" class="btn btn-primary btn-sm">${actionLabel(n)} <i data-lucide="arrow-right" aria-hidden="true"></i></button>` : ''}<details class="notification-more"><summary class="notification-icon-btn" aria-label="Другие действия"><i data-lucide="more-horizontal" aria-hidden="true"></i></summary><div class="notification-more-menu">${n.is_resolved ? '' : `<button type="button" data-resolve><i data-lucide="check" aria-hidden="true"></i><span>Больше не требует внимания</span></button>`}<button type="button" data-dismiss><i data-lucide="eye-off" aria-hidden="true"></i><span>Убрать из ленты</span></button></div></details></div>
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

function params() {
  const p = new URLSearchParams({ page:String(page), per_page:'20' });
  if (category) p.set('category', category); if (importance) p.set('importance', importance); if (search) p.set('search', search);
  if (view === 'unread') p.set('unread_only','true'); if (view === 'action') p.set('requires_action','true'); if (view === 'resolved') p.set('resolved','true'); if (view === 'open') p.set('resolved','false');
  return p;
}

function updateCount() {
  const count = document.getElementById('notification-results-count'); if (count) count.textContent = `${total} ${plural(total,'уведомление','уведомления','уведомлений')}`;
  const more = document.getElementById('notifications-load-more'); if (more) more.hidden = !hasMore;
}

function resetControls() {
  category = ''; view = 'all'; importance = ''; search = '';
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === 'all'));
  const priority = document.getElementById('notification-importance'), categorySelect = document.getElementById('notification-category'), query = document.getElementById('notification-search');
  if (priority) priority.value = ''; if (categorySelect) categorySelect.value = ''; if (query) query.value = '';
  updateFilterState();
}

function updateFilterState() {
  const filtered = Boolean(category || importance || search || view !== 'all');
  const reset = document.getElementById('notification-reset');
  if (reset) reset.hidden = !filtered;
}

function emptyState(container) {
  const filtered = category || importance || search || view !== 'all';
  container.innerHTML = renderViewState({ kind:'empty', title:filtered ? 'Ничего не найдено' : 'У вас пока нет уведомлений', message:filtered ? 'Измените или сбросьте фильтры.' : 'Новые события появятся здесь.', actionLabel:filtered ? 'Сбросить фильтры' : '' });
  if (filtered) bindViewStateAction(container, () => { resetControls(); document.getElementById('notification-reset')?.click(); });
}

async function summary(app) {
  try {
    const data = await app.api.get('/notifications/summary'), set = (id,value) => { const el=document.getElementById(id); if(el) el.textContent=value; };
    set('notif-stat-action',data.requires_action||0); set('notif-stat-unread',data.unread||0); set('notif-stat-today',data.today||0);
    const mark=document.getElementById('mark-all-read'); if(mark){ mark.disabled=!data.unread; mark.hidden=!data.unread; }
    document.querySelectorAll('[data-category-count]').forEach(el => { const value=data.by_category?.[el.dataset.categoryCount]||0; el.textContent=value ? `${value} ${plural(value,'новое','новых','новых')}` : ''; el.hidden=!value; });
  } catch { window.toast?.('Не удалось обновить сводку уведомлений','error'); }
}

async function badge(app) {
  const {count}=await app.api.get('/notifications/unread-count'), value=count>99?'99+':count, top=document.getElementById('notif-badge'), side=document.getElementById('notification-count');
  if(top){top.textContent=value;top.classList.toggle('hidden',count===0);} if(side)side.textContent=value;
}

async function load(app, append=false) {
  if (loading && append) return; const id=++requestId, list=document.getElementById('notifications-list'), more=document.getElementById('notifications-load-more'); loading=true;
  if(!append&&list){list.setAttribute('aria-busy','true');list.innerHTML=renderViewState({kind:'loading',title:'Загружаем уведомления…'});} if(more){more.disabled=true;more.setAttribute('aria-busy','true');}
  try {
    const data=await app.api.get(`/notifications?${params()}`); if(id!==requestId||!list)return; if(!append)list.innerHTML=''; if(!data.items.length&&!append)emptyState(list);else list.insertAdjacentHTML('beforeend',renderItems(data.items,append));
    total=data.total||0;hasMore=page*20<total;if(data.items.length)page+=1;updateCount();await Promise.allSettled([badge(app),summary(app)]);window.lucide?.createIcons();
  } catch(error) {
    if(id!==requestId||!list)return; if(append)window.toast?.(window.formatErrorMessage?.(error)||'Не удалось загрузить ещё уведомления','error');else{list.innerHTML=renderViewState({kind:'error',message:window.formatErrorMessage?.(error)||'Повторите попытку позже.',actionLabel:'Повторить'});bindViewStateAction(list,()=>load(app));window.lucide?.createIcons();}
  } finally { if(id===requestId){loading=false;list?.removeAttribute('aria-busy');if(more){more.disabled=false;more.removeAttribute('aria-busy');}} }
}

export function renderNotifications() {
  const cats=[['','Все категории'],['risk','Риски'],['deadline','Сроки'],['assignment','Назначения'],['mention','Упоминания'],['comment','Обсуждения'],['status_change','Статусы'],['stale','Требуют обновления'],['attrs','Неполные данные'],['system','Система']];
  return `<section class="notification-center animate-fade-in"><header class="notification-hero page-header"><div><h1>Мои уведомления</h1><p>События и действия по вашей зоне ответственности</p><div class="notification-stats" aria-label="Сводка уведомлений"><span><strong id="notif-stat-action">—</strong> требуют внимания</span><span><strong id="notif-stat-unread">—</strong> непрочитанных</span><span><strong id="notif-stat-today">—</strong> сегодня</span></div></div><div class="notification-header-actions"><a class="btn btn-secondary btn-sm" href="#/settings?section=notifications"><i data-lucide="settings" aria-hidden="true"></i> Настроить</a><button type="button" class="btn btn-secondary btn-sm" id="mark-all-read"><i data-lucide="check-check" aria-hidden="true"></i> Прочитать все</button></div></header>
  <div class="notification-workspace"><div class="notification-toolbar" aria-label="Фильтры уведомлений"><label class="notification-search"><i data-lucide="search" aria-hidden="true"></i><span class="sr-only">Поиск уведомлений</span><input id="notification-search" class="input" type="search" placeholder="Поиск по уведомлениям…"></label><div class="notification-view-switch" aria-label="Состояние"><button type="button" class="active" data-view="all">Все</button><button type="button" data-view="action">Требуют внимания</button><button type="button" data-view="unread">Непрочитанные</button><button type="button" data-view="resolved">Закрытые</button></div><select id="notification-category" class="input" aria-label="Категория">${cats.map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select><select id="notification-importance" class="input" aria-label="Приоритет"><option value="">Любой приоритет</option><option value="critical">Критический</option><option value="high">Высокий</option><option value="medium">Обычный</option><option value="low">Информационный</option></select><button type="button" class="btn btn-ghost btn-sm" id="notification-reset" hidden>Сбросить</button></div>
  <section class="notification-feed" aria-labelledby="notifications-heading"><div class="notification-feed-header"><div><h2 id="notifications-heading">Уведомления</h2><p id="notification-results-count" role="status" aria-live="polite">Загрузка…</p></div></div><div id="notifications-list" aria-live="polite">${renderViewState({kind:'loading',title:'Загружаем уведомления…'})}</div><div class="notification-load-more"><button type="button" class="btn btn-secondary" id="notifications-load-more" hidden>Загрузить ещё</button></div></section></div></section>`;
}

export async function initNotifications(app) {
  page=1;hasMore=true;loading=false;category='';view='all';importance='';search='';requestId+=1;
  const reload=()=>{page=1;hasMore=true;return load(app);};
  document.querySelectorAll('[data-view]').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('[data-view]').forEach(el=>el.classList.toggle('active',el===btn));view=btn.dataset.view;updateFilterState();reload();}));
  document.getElementById('notification-category')?.addEventListener('change',e=>{category=e.target.value;updateFilterState();reload();});
  document.getElementById('notification-importance')?.addEventListener('change',e=>{importance=e.target.value;updateFilterState();reload();});
  document.getElementById('notification-search')?.addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{search=e.target.value.trim();updateFilterState();reload();},300);});
  document.getElementById('notification-reset')?.addEventListener('click',()=>{resetControls();reload();});document.getElementById('notifications-load-more')?.addEventListener('click',()=>load(app,true));
  document.getElementById('mark-all-read')?.addEventListener('click',async e=>{const btn=e.currentTarget;btn.disabled=true;btn.setAttribute('aria-busy','true');try{await app.api.put('/notifications/read-all');window.toast?.('Все уведомления отмечены прочитанными','success');await reload();}catch(error){window.toast?.(window.formatErrorMessage?.(error)||'Не удалось отметить уведомления','error');}finally{btn.removeAttribute('aria-busy');}});
  document.getElementById('notifications-list')?.addEventListener('click',async e=>{const btn=e.target.closest('[data-resolve],[data-dismiss],[data-open-notification]');if(!btn)return;const card=btn.closest('.notification-card'),id=Number(card?.dataset.notifId);btn.disabled=true;btn.setAttribute('aria-busy','true');try{
    if(btn.matches('[data-resolve]')){await app.api.put(`/notifications/${id}/resolve`);window.toast?.('Уведомление закрыто. Состояние связанного объекта не изменилось.','success');await reload();}
    else if(btn.matches('[data-dismiss]')){await app.api.delete(`/notifications/${id}`);card?.remove();total=Math.max(0,total-1);updateCount();if(!document.querySelector('.notification-card'))emptyState(document.getElementById('notifications-list'));window.toast?.('Уведомление скрыто','info',{duration:7000,actionLabel:'Отменить',onAction:async()=>{try{await app.api.put(`/notifications/${id}/restore`);window.toast?.('Уведомление восстановлено','success');await reload();}catch{window.toast?.('Не удалось восстановить уведомление','error');}}});await Promise.allSettled([badge(app),summary(app)]);}
    else{const taskId=Number(btn.dataset.taskId),target=decodeURIComponent(btn.dataset.actionUrl||'').replace(/^#/,'');if(taskId)document.dispatchEvent(new CustomEvent('open-task',{detail:{taskId}}));else app.router.navigate(target||'/notifications');if(card?.classList.contains('is-unread')){await app.api.put('/notifications/read',{ids:[id]});card.classList.remove('is-unread');await Promise.allSettled([badge(app),summary(app)]);}}
  }catch(error){window.toast?.(window.formatErrorMessage?.(error)||'Не удалось выполнить действие','error');}finally{if(btn.isConnected){btn.disabled=false;btn.removeAttribute('aria-busy');}}});
  await load(app);
}
