console.log('[DMB] reviewPage.js loaded');

import {
  getSignalTarget,
  getRequestStage,
  humanizeSignal,
  renderRequestHistory,
  renderRequestJourney,
  renderRequestParticipants,
  renderRequestStatusBadge,
  renderRequestSummary,
  renderRequirementSections,
  signalCount,
  signalGroups,
} from './requestPresentation.js';

const INTENTS = { feature:'Новая возможность', change:'Изменение', problem:'Проблема', incident:'Инцидент', clarification:'Уточнение' };
let reviewRows = [];

export function renderReviewPage() {
  return `<div class="review-queue-card request-list-panel animate-fade-in" id="review-queue-card"><div class="customer-request-toolbar review-request-toolbar"><div class="toolbar-title-row request-list-title-row"><div class="toolbar-title-wrap"><h1 class="toolbar-title" id="review-list-title">Ревью запросов</h1><p class="toolbar-subtitle">Проверьте качество требования и передайте готовые запросы в проработку</p></div><div class="request-list-title-meta"><span class="text-secondary" id="review-count" role="status" aria-live="polite">Загрузка…</span></div></div><div class="filter-panel customer-request-filter-panel"><div class="filter-toolbar-row customer-request-controls"><label class="relative filter-search-wrap customer-request-search"><span class="sr-only">Поиск</span><i data-lucide="search"></i><input id="review-search" type="search" placeholder="Поиск..." aria-label="Поиск по названию, автору или команде"></label><div class="customer-request-main-filters"><select id="review-status-filter" class="input" aria-label="Фильтр очереди"><option value="action">Требуют действия</option><option value="all">Все запросы</option><option value="submitted">Новые запросы</option><option value="in_review">На ревью</option><option value="signals">Есть сигналы</option><option value="returned">На уточнении</option><option value="in_progress">В проработке</option></select><select id="review-sort" class="input" aria-label="Сортировка очереди"><option value="oldest">Старые сначала</option><option value="signals">Больше сигналов</option><option value="quality">Низкое качество</option><option value="newest">Новые сначала</option></select></div></div></div><div class="customer-request-quick-filters review-request-quick-filters" id="review-summary" aria-label="Быстрые фильтры"><button type="button" class="quick-filter-btn" data-review-filter="submitted" aria-pressed="false"><span class="quick-filter-icon"><i data-lucide="inbox"></i></span><span class="quick-filter-info"><span class="quick-filter-label">Новые</span><strong class="quick-filter-count" id="review-new-count">—</strong></span></button><button type="button" class="quick-filter-btn" data-review-filter="in_review" aria-pressed="false"><span class="quick-filter-icon"><i data-lucide="search-check"></i></span><span class="quick-filter-info"><span class="quick-filter-label">На ревью</span><strong class="quick-filter-count" id="review-review-count">—</strong></span></button><button type="button" class="quick-filter-btn" data-review-filter="signals" aria-pressed="false"><span class="quick-filter-icon"><i data-lucide="circle-alert"></i></span><span class="quick-filter-info"><span class="quick-filter-label">Сигналы</span><strong class="quick-filter-count" id="review-risk-count">—</strong></span></button></div></div>
  <div class="review-table-body review-list-scroll" id="review-list-content" tabindex="0" aria-label="Список запросов на ревью. Область прокручивается"><div class="customer-request-loading"><span class="spinner"></span><span>Загружаем запросы…</span></div></div></div>`;
}

export async function initReviewPage(app) {
  document.getElementById('review-search')?.addEventListener('input', renderReviewList);
  document.getElementById('review-status-filter')?.addEventListener('change', renderReviewList);
  document.getElementById('review-sort')?.addEventListener('change', renderReviewList);
  document.querySelectorAll('[data-review-filter]').forEach(button => button.addEventListener('click', () => {
    const filter = document.getElementById('review-status-filter');
    if (filter) filter.value = button.dataset.reviewFilter;
    renderReviewList();
    document.getElementById('review-queue-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  try { const data = await app.api.get('/agent/requests/review'); reviewRows = Array.isArray(data) ? data : []; updateSummary(); renderReviewList(); }
  catch (e) { const content=document.getElementById('review-list-content'); if(content) content.innerHTML=`<div class="customer-request-state is-error"><i data-lucide="cloud-off"></i><strong>Не удалось загрузить запросы</strong><span>${esc(e.message||'Повторите попытку позже')}</span></div>`; window.lucide?.createIcons(); }
}

function updateSummary() {
  document.getElementById('review-summary')?.toggleAttribute('hidden', reviewRows.length === 0);
  setText('review-new-count', reviewRows.filter(r => r.status === 'submitted').length);
  setText('review-review-count', reviewRows.filter(r => r.status === 'in_review').length);
  setText('review-risk-count', reviewRows.filter(r => signalCount(r.draft) > 0).length);
}

function renderReviewList() {
  const content = document.getElementById('review-list-content'); if (!content) return;
  const q = (document.getElementById('review-search')?.value || '').trim().toLowerCase();
  const filter = document.getElementById('review-status-filter')?.value || 'action';
  const sort = document.getElementById('review-sort')?.value || 'oldest';
  const matchesFilter = r => filter === 'all' || (filter === 'action' ? ['submitted','in_review'].includes(r.status) : filter === 'signals' ? signalCount(r.draft) > 0 : r.status === filter);
  const rows = reviewRows.filter(r => (!q || [r.title,r.author_name,r.team_name,r.assignee_name].some(v => String(v||'').toLowerCase().includes(q))) && matchesFilter(r));
  rows.sort((a,b) => sort === 'signals' ? signalCount(b.draft)-signalCount(a.draft) : sort === 'quality' ? qualityScore(a)-qualityScore(b) : sort === 'newest' ? time(b.created_at)-time(a.created_at) : time(a.created_at)-time(b.created_at));
  document.querySelectorAll('[data-review-filter]').forEach(button => { const active=button.dataset.reviewFilter === filter; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); });
  const queue = document.getElementById('review-queue-card');
  const trulyEmpty = reviewRows.length === 0;
  queue?.classList.toggle('is-empty', trulyEmpty);
  setText('review-count', `Показано ${rows.length} из ${reviewRows.length}`);
  if (!rows.length) {
    content.innerHTML = trulyEmpty
      ? '<div class="customer-request-state"><div class="customer-request-state-icon review-empty-icon"><i data-lucide="check"></i></div><strong>Очередь пуста</strong><span>Новые требования появятся здесь после отправки<br>из диалога с ИИ-ассистентом.</span></div>'
      : '<div class="customer-request-state"><i data-lucide="search-x"></i><strong>Ничего не найдено</strong><span>Попробуйте изменить поиск или фильтр.</span><button class="btn btn-secondary btn-sm" id="clear-review-filters">Сбросить фильтры</button></div>';
    document.getElementById('clear-review-filters')?.addEventListener('click', () => { document.getElementById('review-search').value=''; document.getElementById('review-status-filter').value='all'; renderReviewList(); });
    window.lucide?.createIcons();
    return;
  }
  content.innerHTML = `<div class="customer-request-cards review-request-cards" aria-label="Список запросов на ревью">${rows.map(renderReviewCard).join('')}</div>`;
  window.lucide?.createIcons();
}

function renderReviewCard(request) {
  const draft=request.draft||{}, groups=signalGroups(draft), issues=signalCount(draft), score=qualityScore(request), age=requestAge(request.created_at), overdue=isOverdue(request);
  const unassigned=['submitted','in_review'].includes(request.status)&&!request.reviewer_name;
  const regulated=toCardList(draft.regulatory_flags).length>0;
  const priority=[request.status==='submitted'?'is-new':'',issues>=3||regulated?'has-many-signals':'',unassigned?'is-unassigned':'',overdue?'is-overdue':''].filter(Boolean).join(' ');
  const owner=request.status==='in_progress' ? request.assignee_name||request.team_name||'Не назначен' : request.reviewer_name||'Не взят в работу';
  const taxonomy=[['Вопросы','circle-help','Открытые вопросы'],['Конфликты','git-compare-arrows','Противоречия'],['Риски','triangle-alert','Риски'],['Допущения','lightbulb','Допущения']].map(([label,icon,key])=>{const count=groups.find(([name])=>name===key)?.[1].length||0;return `<span class="review-signal-chip${count?' has-value':''}"><i data-lucide="${icon}"></i>${label}<strong>${count}</strong></span>`;}).join('');
  const product=[draft.product,draft.module].filter(Boolean).map(value=>esc(value)).join(' · ');
  const action=request.status==='submitted'?'Взять на ревью':request.status==='in_review'?'Принять решение':request.status==='returned'?'Проверить уточнения':request.status==='in_progress'?'Контролировать проработку':'Открыть запрос';
  return `<a href="#/review/${esc(request.id)}" class="customer-request-card review-request-card ${priority}"><div class="customer-request-card-main"><div class="customer-request-card-heading"><div><span class="customer-request-card-id">Запрос #${esc(request.id)}</span><h3>${esc(request.title||'Без названия')}</h3></div>${badge(request.status)}</div><div class="review-card-tags">${draft.priority?`<span class="request-priority-chip"><i data-lucide="flag"></i>${esc(draft.priority)}</span>`:''}${product?`<span><i data-lucide="boxes"></i>${product}</span>`:''}${regulated?'<span class="is-regulated"><i data-lucide="shield-alert"></i>Регуляторные требования</span>':''}</div><div class="customer-request-card-meta"><span><i data-lucide="user-round"></i>${esc(request.author_name||'Автор не указан')} · ${esc(request.team_name||'Без команды')}</span><span class="${unassigned?'is-attention':''}"><i data-lucide="user-check"></i>${esc(owner)}</span><span class="${overdue?'is-attention':''}" title="Создан ${date(request.created_at)}"><i data-lucide="clock-3"></i>${esc(age)}</span></div><div class="review-signal-taxonomy" aria-label="Сигналы запроса">${taxonomy}</div></div><div class="customer-request-card-next review-request-card-next"><span>Готовность к решению</span><div class="review-request-card-indicators">${scoreView(score)}${issues?`<span class="review-attention"><i data-lucide="alert-circle"></i>${issues} ${plural(issues,'сигнал','сигнала','сигналов')}</span>`:'<span class="review-ready"><i data-lucide="check"></i>Сигналов нет</span>'}</div><strong class="review-card-action">${action}</strong><small>Открыть запрос <i data-lucide="arrow-right"></i></small></div></a>`;
}

function toCardList(value){return Array.isArray(value)?value.filter(Boolean):value?[value]:[];}
function requestAge(iso){const created=Date.parse(iso||'');if(!Number.isFinite(created))return 'Возраст неизвестен';const days=Math.max(0,Math.floor((Date.now()-created)/86400000));return days===0?'Сегодня':`${days} ${plural(days,'день','дня','дней')} в очереди`;}
function isOverdue(request){const value=request.sla_deadline||request.expected_at||request.expected_date;const deadline=Date.parse(value||'');return Number.isFinite(deadline)&&deadline<Date.now()&&!['in_progress','approved','rejected'].includes(request.status);}

export async function renderReviewDetailPage(app, requestId) {
  let req; try { req=await app.api.get(`/agent/requests/${requestId}`); } catch(e) { return `<div class="page-header"><h1>Запрос</h1><p>Ошибка загрузки: ${esc(e.message)}</p><a href="#/review" class="btn btn-secondary btn-sm">Назад</a></div>`; }
  const d=req.draft||{}, user=app.store.get('currentUser'), canReview=(user?.permissions?.review||'none')!=='none';
  const quality=Number(d.quality_score ?? d.completeness_score ?? 0), completeness=Number(d.completeness_score||0);
  return `<div class="page-header review-detail-header"><a href="#/review" class="review-back"><i data-lucide="arrow-left"></i>Очередь ревью</a><div class="review-title-line"><h1>${esc(req.title)}</h1>${renderRequestStatusBadge(req)}</div><p>#${req.id} · ${esc(req.author_name||'Автор не указан')} · ${esc(req.team_name||'Без команды')} · ${date(req.created_at)}</p></div>
  ${renderRequestJourney(req)}${renderRequestSummary(req)}${req.reject_reason?`<section class="review-return-note${req.status==='rejected'?' is-rejected':''}"><i data-lucide="${req.status==='rejected'?'x-circle':'message-circle-warning'}"></i><div><strong>${req.status==='rejected'?'Причина отклонения':'Комментарий к уточнению'}</strong><span>${esc(req.reject_reason)}</span></div></section>`:''}<div class="review-detail-layout"><main class="review-detail-main">
  ${renderAttentionPanel(d)}
  ${renderRequirementSections(d)}
  ${renderRequestHistory(req)}
  <details class="card review-more review-ai-assessment"><summary>Оценка подготовки запроса <span>Справочные сигналы ИИ</span><i data-lucide="chevron-down"></i></summary><div class="card-body"><div class="review-metrics">${metric('Полнота',completeness,'Насколько заполнены обязательные разделы требования')}${metric('Качество',quality,'Насколько формулировки конкретны, непротиворечивы и проверяемы')}<div><span>Уверенность ИИ</span><strong>${confidence(d.confidence)}</strong><small>Надёжность автоматической интерпретации</small></div><div><span>Тип обращения</span><strong>${esc(INTENTS[d.intent]||d.intent||'Не определён')}</strong><small>Определён ассистентом по содержанию</small></div></div><p class="review-score-help"><i data-lucide="info"></i><span><strong>75–100%</strong> — высокая оценка, <strong>50–74%</strong> — требуется проверка, <strong>до 49%</strong> — существенные пробелы. Проценты помогают при ревью, но не заменяют решение специалиста.</span></p></div></details>
  </main><aside class="review-detail-aside"><section class="card review-decision-card"><div class="card-header"><h2 class="card-title">Следующий шаг</h2></div><div class="card-body">${nextStep(req,canReview)}</div></section>${renderRequestParticipants(req)}</aside></div>`;
}

export async function initReviewDetailPage(app, requestId) {
  document.getElementById('btn-claim')?.addEventListener('click',e=>updateStatus(app,requestId,{status:'in_review',version:buttonVersion(e)},'Запрос взят на ревью'));
  document.getElementById('btn-approve')?.addEventListener('click',()=>assignModal(app,requestId));
  document.getElementById('btn-return')?.addEventListener('click',e=>reasonModal(app,requestId,'returned',buttonVersion(e)));
  document.getElementById('btn-reject')?.addEventListener('click',e=>reasonModal(app,requestId,'rejected',buttonVersion(e)));
  document.querySelectorAll('[data-request-target]').forEach(control=>control.addEventListener('click',()=>focusRequestSection(control.dataset.requestTarget)));
  window.lucide?.createIcons();
}

function nextStep(req,canReview) {
  const signals=signalCount(req.draft), signalNote=signals?`В запросе ${signals} ${plural(signals,'сигнал','сигнала','сигналов')} для проверки.`:'Ассистент не выявил открытых сигналов.';
  if(canReview && ['submitted','returned'].includes(req.status)) return `<div class="review-next-copy"><i data-lucide="search"></i><div><strong>Начните ревью</strong><span>Запрос закрепится за вами. ${signalNote}</span></div></div><button class="btn btn-primary" id="btn-claim" data-request-version="${esc(req.version??0)}">Взять на ревью</button>`;
  if(canReview && req.status==='in_review') return `<div class="review-next-copy"><i data-lucide="git-pull-request-arrow"></i><div><strong>Примите решение</strong><span>Передайте аналитику или верните заказчику с комментарием.</span></div></div><button class="btn btn-success" id="btn-approve" data-request-version="${esc(req.version??0)}">Передать в проработку</button><button class="btn btn-secondary" id="btn-return" data-request-version="${esc(req.version??0)}">Вернуть на уточнение</button><button class="btn btn-ghost btn-sm review-reject-link" id="btn-reject" data-request-version="${esc(req.version??0)}">Отклонить запрос</button>`;
  if(req.status==='in_progress') return `<div class="review-next-copy is-done"><i data-lucide="workflow"></i><div><strong>Передан в проработку</strong><span>Ответственный: ${esc(req.assignee_name||'не назначен')}.</span></div></div>`;
  return `<div class="review-next-copy"><i data-lucide="clock"></i><div><strong>Ожидает следующего этапа</strong><span>${esc(getRequestStage(req).label)}</span></div></div>`;
}

function renderAttentionPanel(draft) {
  const groups=signalGroups(draft);
  if(!groups.length) return '<section class="review-ready-panel"><i data-lucide="check-circle"></i><div><strong>Ассистент не выявил открытых сигналов</strong><span>Ревьюеру всё равно нужно проверить формулировки и критерии приёмки.</span></div></section>';
  return `<section class="card review-attention-panel"><div class="card-header"><div><h2 class="card-title">Требует внимания</h2><p class="review-card-subtitle">Выберите сигнал, чтобы перейти к связанному разделу паспорта</p></div><span class="review-attention-count">${groups.reduce((n,[,v])=>n+v.length,0)}</span></div><div class="card-body">${groups.map(([l,v])=>`<div class="review-issue-group"><h3>${esc(l)}</h3><ul>${v.map(x=>{const target=getSignalTarget(x,l);return `<li><button type="button" class="review-signal-link" data-request-target="${esc(target)}"><span>${esc(humanizeSignal(x))}</span><i data-lucide="arrow-down-right"></i></button></li>`;}).join('')}</ul></div>`).join('')}</div></section>`;
}

function focusRequestSection(id){const target=document.getElementById(id);if(!target)return;const details=target.closest('details');if(details)details.open=true;target.scrollIntoView({behavior:'smooth',block:'center'});target.classList.remove('is-signal-target');requestAnimationFrame(()=>{target.classList.add('is-signal-target');target.focus({preventScroll:true});window.setTimeout(()=>target.classList.remove('is-signal-target'),1800);});}

async function updateStatus(app,id,payload,message){try{await app.api.put(`/agent/requests/${id}/status`,payload);window.toast?.(message,'success');window.location.hash=`#/review/${id}`;window.location.reload();}catch(e){window.toast?.(window.formatErrorMessage?.(e)||'Не удалось обновить запрос','error');}}
async function assignModal(app,id){try{const req=await app.api.get(`/agent/requests/${id}`);if(!req.team_id)return window.toast?.('У запроса не указана команда','warning');const users=await app.api.get(`/agent/teams/${req.team_id}/ba`);modal({title:'Передать в проработку',body:`<p class="text-secondary">Выберите аналитика для следующего этапа.</p><label class="form-label">Ответственный BA</label><select id="assignee-select" class="input"><option value="">— Выберите —</option>${users.map(u=>`<option value="${u.id}">${esc(u.name)} (${esc(u.role||'—')})</option>`).join('')}</select>`,confirm:'Передать',klass:'btn-success',action:async m=>{const f=m.querySelector('#assignee-select'),uid=parseInt(f.value);if(!uid)return window.showFieldError?.(f,'Выберите ответственного');await updateStatus(app,id,{status:'in_progress',assignee_id:uid,version:req.version??0},'Запрос передан в проработку');return true;}});}catch(e){window.toast?.('Не удалось загрузить аналитиков','error');}}
function reasonModal(app,id,status,version){const back=status==='returned';modal({title:back?'Вернуть на уточнение':'Отклонить запрос',body:`<p class="text-secondary">Комментарий увидит заказчик.</p><label class="form-label">Комментарий (обязательно)</label><textarea id="review-reason" class="input" rows="5" placeholder="Что именно нужно уточнить"></textarea>`,confirm:back?'Вернуть заказчику':'Отклонить',klass:back?'btn-primary':'btn-danger',action:async m=>{const f=m.querySelector('#review-reason'),reason=f.value.trim();if(!reason)return window.showFieldError?.(f,'Добавьте комментарий');await updateStatus(app,id,{status,reject_reason:reason,version},back?'Запрос возвращён на уточнение':'Запрос отклонён');return true;}});}
function buttonVersion(event){return Number(event.currentTarget?.dataset?.requestVersion??0);}
function modal({title,body,confirm,klass,action}){const m=document.createElement('div');m.className='modal-overlay';const titleId=`review-modal-title-${Date.now()}`;m.innerHTML=`<div class="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1"><div class="modal-header"><h3 id="${titleId}">${title}</h3><button type="button" class="modal-close" data-close aria-label="Закрыть диалог">&times;</button></div><div class="modal-body">${body}</div><div class="modal-footer"><button type="button" class="btn btn-secondary btn-sm modal-cancel-btn" data-close>Отмена</button><button type="button" class="btn ${klass} btn-sm" id="modal-confirm">${confirm}</button></div></div>`;document.body.appendChild(m);const close=()=>m.remove();m.querySelectorAll('[data-close]').forEach(x=>x.onclick=close);m.addEventListener('mousedown',e=>{if(e.target===m)close();});m.querySelector('#modal-confirm').onclick=async e=>{e.currentTarget.disabled=true;e.currentTarget.setAttribute('aria-busy','true');try{if(await action(m))close();}catch(err){window.toast?.(window.formatErrorMessage?.(err)||'Не удалось выполнить действие','error');}finally{if(e.currentTarget.isConnected){e.currentTarget.disabled=false;e.currentTarget.removeAttribute('aria-busy');}}};}

function metric(label,score,hint){return `<div title="${esc(hint)}"><span>${label}</span><strong class="${tone(score)}">${score}%</strong><div class="review-score-track" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.max(0,Math.min(100,score))}"><span class="${tone(score)}" style="width:${Math.max(0,Math.min(100,score))}%"></span></div><small>${esc(hint)}</small></div>`;}
function scoreView(score){return `<div class="review-list-score"><strong class="${tone(score)}">${score}%</strong><span>${score>=75?'Высокая':score>=50?'Средняя':'Низкая'}</span></div>`;}
function tone(n){return n>=75?'is-good':n>=50?'is-medium':'is-low';} function confidence(v){return ({high:'Высокая',medium:'Средняя',low:'Низкая'})[v]||'Не определена';}
function qualityScore(r={}){const d=r.draft||r;return Number(d.quality_score ?? d.completeness_score ?? 0);} function time(iso){const value=Date.parse(iso||'');return Number.isFinite(value)?value:0;} function plural(n,one,few,many){const m=n%100;if(m>=11&&m<=14)return many;const d=n%10;return d===1?one:d>=2&&d<=4?few:many;}
function badge(s){return renderRequestStatusBadge({status:s});} function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=String(v);}
function date(iso){if(!iso)return '—';const d=new Date(iso);return isNaN(d)?esc(iso):`${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`;} function relativeDate(iso){const d=new Date(iso);if(!iso||isNaN(d))return '—';const today=new Date(),day=new Date(d.getFullYear(),d.getMonth(),d.getDate()),current=new Date(today.getFullYear(),today.getMonth(),today.getDate()),days=Math.round((current-day)/86400000),clock=d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});return days===0?`Сегодня, ${clock}`:days===1?`Вчера, ${clock}`:date(iso);} function esc(v){const d=document.createElement('div');d.textContent=v==null?'':String(v);return d.innerHTML;}
