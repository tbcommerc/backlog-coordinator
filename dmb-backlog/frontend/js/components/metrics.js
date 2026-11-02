import { filterValues, filterSummaryOption, encodeFilterValues } from '../ui/filterValues.js';
import {showFormErrors,clearFormErrors} from '../ui/validation.js';
import {enhanceDialogOverlay} from '../modalAccessibility.js';
import {progress as kitProgress, formatFileSize} from '../ui/dataDisplay.js';
import {renderViewState} from './viewState.js';
import { pagination as kitPagination } from '../ui/forms.js';
import {escapeHtml as esc} from '../htmlUtils.js';
import {pageHeader,button,badge,filterChip,icon} from '../ui/primitives.js';
import {confirmAction,showToast,formatErrorMessage} from '../uiFeedback.js';
import {descriptionList,sectionCard} from '../ui/detailComponents.js';
import {bindDetailPanel} from '../ui/detailPanel.js';
import {dataTable,tableCell} from '../ui/dataTable.js';
import {entityPicker,bindEntityPicker} from '../ui/entityPicker.js';
import {dateRange,numberRange,validateRanges} from '../ui/intervals.js';

let app, options, data, selected, root, listData, listHash='', dirty=false, busy=false, contextHash='', requestSerial=0;
let returnMetricId=null;
let filterTimer, searchFocus=null;
let targetPicker=null;
function disposeTargetPicker(){targetPicker?.destroy();targetPicker=null;}
const names={draft:'Черновик',active:'Активен',completed:'Завершён',cancelled:'Отменён',up:'Увеличение',down:'Снижение',range:'Удержание диапазона',daily:'Ежедневно',weekly:'Еженедельно',monthly:'Ежемесячно',quarterly:'Ежеквартально',interval:'Через N дней',achieved:'Цель достигнута',not_achieved:'Цель не достигнута',no_data:'Нет измерений',violated:'Были нарушения',unconfirmed:'Удержание не подтверждено',within_range:'Диапазон удержан',overdue:'Замер просрочен',missing:'Нет измерений',today:'Замер сегодня',current:'Данные актуальны',closed:'Период закрыт'};
const actions={created:'Метрика создана',passport:'Паспорт изменён',period_created:'Добавлен период',period_updated:'Изменена цель или график',activate:'Период активирован',complete:'Период завершён',cancel:'Период отменён',reopen:'Период открыт повторно',measurement_added:'Добавлено измерение',measurement_corrected:'Исправлено измерение',comment:'Добавлен комментарий',linked:'Добавлена связь',unlinked:'Удалена связь',report:'Сохранён статус встречи',file_added:'Прикреплён файл',file_removed:'Удалено вложение',archive:'Изменён архивный статус',migrated:'Перенесено из задач'};
const numeric=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:4});
const n=v=>v===null||v===undefined?'—':numeric.format(Number(v));
const dt=v=>v?new Date(v.length===10?v+'T12:00:00':v).toLocaleDateString('ru-RU'):'—';
const text=v=>esc(v??'—');
const btn=(label,act,attrs={},variant='secondary',ico='')=>button({label,variant,icon:ico,attrs:{'data-act':act,...attrs}});
const empty=(title,description='',scope='partial')=>renderViewState({kind:'empty',title,message:description,scope});
const panel=(title,content,controls='')=>sectionCard({title,content,actions:controls,level:2});
const params=()=>new URLSearchParams((listHash||location.hash).split('?')[1]||'');
const metricId=()=>Number(location.hash.match(/^#\/metrics\/(\d+)/)?.[1]||0);
const editable=()=>!!data?.permissions?.edit&&!data.is_archived;
const period=()=>data?.periods?.find(p=>p.id===selected)||null;
const points=()=>data.measurements.filter(m=>m.period_id===selected);
const stateBadge=s=>badge({label:names[s]||s,tone:s==='active'?'info':s==='completed'?'success':'neutral'});
function opt(list,value,blank='Все'){return filterSummaryOption(value,list.map(x=>({value:x.id??x.key,label:x.name??x.label})))+(blank===null?'':`<option value="">${esc(blank)}</option>`)+list.map(x=>`<option value="${esc(x.id??x.key)}" ${String(x.id??x.key)===String(value)?'selected':''}>${esc(x.name??x.label)}</option>`).join('');}
function select(name,label,list,value,blank='Все',attrs=''){return `<label class="ui-field"><span class="ui-field-label">${esc(label)}</span><select class="input ui-control" name="${name}" ${attrs}>${opt(list,value,blank)}</select></label>`;}
function input(name,label,value='',type='text',attrs=''){return `<label class="ui-field"><span class="ui-field-label">${esc(label)}</span><input class="input ui-control" name="${name}" type="${type}" value="${esc(value??'')}" ${attrs}></label>`;}
function area(name,label,value='',attrs=''){return `<label class="ui-field full"><span class="ui-field-label">${esc(label)}</span><textarea class="input ui-control" name="${name}" ${attrs}>${esc(value??'')}</textarea></label>`;}
function queryChange(values){const p=params();Object.entries(values).forEach(([k,v])=>v===null||v===''?p.delete(k):p.set(k,v));const hash='#/metrics'+(p.size?'?'+p:'');if(location.hash===hash)return false;location.hash=hash;return true;}
function scheduleFilterSearch(field){
 clearTimeout(filterTimer);const hash=location.hash;
 filterTimer=setTimeout(()=>{if(field.isConnected&&location.hash===hash)applyFilters();},350);
}
function applyFilters(values={}){
 clearTimeout(filterTimer);
 const form=root?.querySelector('#metric-filters');if(!form)return;
 const fields=new FormData(form),next={page:''};
 for(const key of ['q','period','team_id','owner_id','project_id','state','sort'])next[key]=fields.get(key)||'';
 next.archived=fields.get('archived')?'true':'';
 const search=form.elements.q;
 searchFocus=document.activeElement===search?{value:search.value,start:search.selectionStart,end:search.selectionEnd}:null;
 if(!queryChange({...next,...values}))searchFocus=null;
}
function currentPeriod(){const p=params();return p.get('period')||options.current_period;}
function choosePeriod(){const requested=Number(params().get('period_id'));selected=data.periods.find(p=>p.id===requested)?.id||data.periods.find(p=>p.state==='active')?.id||data.periods[0]?.id||null;}
function icons(){window.lucide?.createIcons();}
function problem(error){return `<section class="metric-page">${pageHeader({title:'Метрики'})}${renderViewState({kind:error?.status===403?'forbidden':error?.status===404?'unavailable':'error',title:error?.status===404?'Метрика недоступна':undefined,message:formatErrorMessage(error),actionLabel:[403,404].includes(error?.status)?'':'Повторить',actionAttrs:{'data-act':'refresh'}})}</section>`;}
export async function renderMetrics(application){
  clearTimeout(filterTimer);
  app=application;const ticket=++requestSerial,hash=location.hash,id=metricId(),query=params();
  try{
    const loadedOptions=await app.api.get('/metrics/options');
    if(!id&&!query.has('period'))query.set('period',loadedOptions.current_period);
    const loadedData=await app.api.get(id?'/metrics/'+id:'/metrics?'+query);
    if(ticket!==requestSerial||hash!==location.hash)return '';
    options=loadedOptions;data=loadedData;contextHash=hash;
    if(id){
      const listQuery=new URLSearchParams(lastList().split('?')[1]||'');
      if(!listQuery.has('period'))listQuery.set('period',options.current_period);
      listData=await app.api.get('/metrics?'+listQuery);
      if(ticket!==requestSerial||hash!==location.hash)return '';
    }else listData=loadedData;
    if(!id)sessionStorage.setItem('metrics.last-list.'+options.user_id,hash);
    if(id)choosePeriod();
    // Preserve typing that continued while the registry request was in flight.
    if(!id&&searchFocus){const field=root?.querySelector('#metric-filters [name=q]');if(field&&document.activeElement===field)searchFocus={value:field.value,start:field.selectionStart,end:field.selectionEnd};}
    return `<div id="metrics-root" class="metric-page">${surface()}</div>`;
  }catch(e){if(ticket!==requestSerial||hash!==location.hash)return '';return `<div id="metrics-root" class="metric-page">${problem(e)}</div>`;}
}
export function initMetrics(application){
  disposeTargetPicker();
  app=application;root=document.getElementById('metrics-root');if(!root)return;
  root.addEventListener('click',click);
  root.addEventListener('change',change);
  root.addEventListener('submit',submit);
  root.addEventListener('input',e=>{
    if(e.target.closest('#metric-filters')&&e.target.name==='q'){
      scheduleFilterSearch(e.target);
    }
    if(e.target.closest('#metric-editor'))dirty=true;
  });
  app.router.onBeforeNavigate=async()=>{const d=document.getElementById('metric-editor');if(busy)return false;if(!d?.open)return true;return !dirty||await discardChanges();};
  mountCard();
  if(!metricId()&&returnMetricId){root.querySelector(`a.metric-name[href^="#/metrics/${returnMetricId}?"] , a.metric-name[href="#/metrics/${returnMetricId}"]`)?.focus({preventScroll:true});returnMetricId=null;}
  icons();
  if(searchFocus&&!metricId()){
    const field=root.querySelector('#metric-filters [name=q]');
    if(field){field.value=searchFocus.value;field.focus({preventScroll:true});field.setSelectionRange(searchFocus.start,searchFocus.end);if(field.value!==(params().get('q')||''))scheduleFilterSearch(field);}
    searchFocus=null;
  }
}
if(!globalThis.__metricUnload){globalThis.__metricUnload=true;window.addEventListener('beforeunload',e=>{if(dirty&&document.getElementById('metric-editor')?.open){e.preventDefault();e.returnValue='';}});}
function registry(){
  const p=params(), f=(key)=>p.get(key)||'', list=data.items||[];
  const compactSelect=(name,label,items,value,blank='Все')=>`<label class="metric-filter-control">${icon('filter')}<span>${esc(label)}:</span><select class="input ui-control" name="${name}" aria-label="${esc(label)}">${opt(items,value,blank)}</select></label>`;
  const filters=`<form id="metric-filters" class="filter-panel" aria-label="Фильтры метрик"><div class="metric-search-row">
    <label class="filter-search-wrap metric-search">${icon('search')}<input class="input ui-control" type="search" name="q" value="${esc(f('q'))}" placeholder="Поиск по ID, названию, владельцу…" aria-label="Поиск метрик" autocomplete="off"></label>
    </div><div class="metric-main-filters">
    ${compactSelect('period','Период',options.periods,currentPeriod(),null)}
    ${compactSelect('team_id','Команда',options.teams,f('team_id'))}
    ${compactSelect('owner_id','Владелец',options.users,f('owner_id'))}
    ${compactSelect('state','Состояние',Object.entries(names).slice(0,4).map(([id,name])=>({id,name})),f('state'))}
    ${compactSelect('project_id','Проект',options.projects,f('project_id'))}
    </div><div class="metric-filter-actions">${btn('Сброс','reset',{},'secondary','rotate-ccw')}</div></form>`;
  const chips=[['active','Активные','activity','info'],['achieved','Цель достигнута','check-circle','success'],['overdue','Просрочен замер','clock','danger'],['missing','Без измерений','minus-circle','neutral']].map(([key,label,ico,tone])=>filterChip({label,icon:ico,tone,count:data.summary[key],selected:filterValues(f('attention')).includes(key),attrs:{'data-act':'attention','data-key':key}})).join('');
  return `<div class="metric-toolbar ui-toolbar-stack">${pageHeader({title:'Метрики',description:'Цели, измерения и результаты команд',actions:`<div class="metric-actions">${options.can_create?btn('Новая метрика','create',{},'primary','plus'):''}${button({label:'Обновить',icon:'refresh-cw',iconOnly:true,attrs:{'data-act':'refresh'}})}</div>`})}${filters}<div class="quick-filters-row metric-chips" role="group" aria-label="Быстрые выборки метрик">${chips}</div></div>
    <div class="metric-period-bar metric-registry-bar"><div class="metric-actions metric-collections"><div class="ui-segmented metric-scope" role="group" aria-label="Область метрик">${btn('Все метрики','scope',{'data-key':'all','aria-pressed':f('scope')!=='mine'})}${btn('Мои метрики','scope',{'data-key':'mine','aria-pressed':f('scope')==='mine'})}</div><label class="ui-checkbox"><input type="checkbox" name="archived" form="metric-filters" ${f('archived')==='true'?'checked':''}><span>Архив метрик</span></label></div><div class="metric-list-controls">
    ${select('sort','Сортировка',[{id:'title',name:'По названию'},{id:'updated',name:'Недавно изменённые'},{id:'due',name:'По сроку замера'},{id:'progress',name:'По прогрессу'}],f('sort')||'title',null,'form="metric-filters"')}
    <span class="metric-muted" role="status">Найдено: ${data.total}</span></div></div>
    ${dataTable({label:'Реестр метрик',rows:list,className:'metric-table-panel',responsive:'cards',stateTitle:'Метрики не найдены',message:options.can_create?'Измените фильтры или создайте новую метрику.':'Измените фильтры или сбросьте условия поиска.',columns:[
      {key:'title',label:'Метрика',render:row=>tableCell({markup:`<a class="metric-name" href="#/metrics/${row.id}${row.period?'?period_id='+row.period.id:''}">${esc(row.title)}</a>`,secondary:[row.public_id,row.team,row.project].filter(Boolean).join(' · ')})},
      {key:'fact',label:'Факт / цель',render:row=>{const p=row.period,s=p?.summary;return tableCell({markup:`<strong>${n(s?.fact)}</strong> / ${p?.direction==='range'?n(p.target)+'–'+n(p.upper):n(p?.target)} ${esc(row.unit)}`,secondary:s?.measured_on?dt(s.measured_on):'Нет датированного замера'});}},
      {key:'result',label:'Результат',render:row=>tableCell({markup:result(row.period)+progress(row.period)})},
      {key:'due',label:'Следующий замер',render:row=>{const p=row.period,s=p?.summary;return tableCell({value:s?.freshness==='closed'?'—':dt(s?.next_due),className:s?.freshness==='overdue'?'metric-text-warning':'',secondary:p?names[s?.freshness]:'Нужен период'});}},
      {key:'owner',label:'Владелец'},
      {key:'state',label:'Состояние',render:row=>tableCell({markup:stateBadge(row.period?.state||'draft'),secondary:row.legacy_task_id?'Перенесена из задач':''})},
    ]})}<div class="ui-page-footer metric-pager"><span class="text-secondary" role="status">Показано ${data.total?(data.page-1)*25+1:0}–${Math.min(data.page*25,data.total)} из ${data.total}</span>${data.pages>1?kitPagination({page:data.page,pages:data.pages,label:'Страницы метрик',previousAttrs:{'data-act':'page'},nextAttrs:{'data-act':'page'},pageAttrs:{'data-act':'page'}}):''}</div>`;
}
function progress(p){return kitProgress({value:p?.summary?.progress??null,label:'Прогресс метрики',tone:p?.summary?.progress>=100?'success':'accent'});}
function result(p){
  if(!p||p.summary.fact===null)return 'Нет измерений';
  if(p.direction==='range')return p.summary.achieved?'В диапазоне':'Вне диапазона';
  return p.summary.progress==null?'Нужна база':n(p.summary.progress)+'%';
}
function lastList(){const h=sessionStorage.getItem('metrics.last-list.'+options.user_id)||'#/metrics';return /^#\/metrics(?:\?|$)/.test(h)?h:'#/metrics';}
function card(){
 const p=period(),s=p?.summary,tab=params().get('section')||'overview',can=editable();
 const controls=`<div class="metric-actions">${can&&p?.state==='active'?btn('Внести замер','measure',{},'primary','plus'):''}${can?btn('Редактировать','passport',{},'secondary','pencil'):''}${btn('Обновить','refresh',{},'ghost','refresh-cw')}</div>`;
 const tabs=[['overview','Обзор'],['measurements','Измерения'],['links','Связанные задачи'],['reports','Статусы встреч'],['comments','Комментарии'],['files','Файлы'],['history','История']];
 const nav=`<nav class="metric-tabs" aria-label="Карточка метрики">${tabs.map(([id,label])=>`<a class="metric-tab ${tab===id?'active':''}" href="#/metrics/${data.id}?period_id=${selected||''}&section=${id}" ${tab===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav>`;
 return `<div class="metric-card-top"><span class="metric-muted">Карточка метрики · ${text(data.public_id)}</span>${btn('Закрыть','card-close',{'aria-label':'Закрыть карточку метрики','data-close':true},'ghost','x')}</div>
 ${pageHeader({title:data.title,description:[data.public_id,data.team,data.owner].filter(Boolean).join(' · '),actions:controls,className:'metric-header-detail'})}
 ${data.is_archived?`<div class="metric-callout">Метрика в архиве.${data.permissions.edit?btn('Восстановить','archive'):''}</div>`:''}
 ${data.legacy?`<div class="metric-callout">${icon('info')}<span>Перенесена из ${text(data.legacy.public_id)}. Исходные значения и история сохранены. Для начала ведения уточните паспорт, цель и график.</span></div>`:''}
 <div class="metric-period-bar"><div class="metric-inline">${select('period_id','Период',data.periods.map(x=>({id:x.id,name:x.label})),selected,data.periods.length?null:'Нет периодов')}${p?`<span class="metric-muted">${dt(p.start_date)}–${dt(p.end_date)}</span>${stateBadge(p.state)}`:''}</div>
 <div class="metric-actions">${can?btn('Новый период','period-new',{},'secondary','calendar-plus'):''}${can&&p&&['active','draft'].includes(p.state)?btn('Настроить период','period-edit'):''}
 ${can&&p?.state==='draft'?btn('Активировать','activate',{},'primary'):''}${can&&p?.state==='active'?btn('Завершить','complete'):''}${can&&p&&['active','draft'].includes(p.state)?btn('Отменить период','cancel',{},'ghost'):''}${can&&p&&['completed','cancelled'].includes(p.state)?btn('Открыть повторно','reopen'):''}</div></div>
 ${p?`<div class="metric-facts"><div class="metric-fact"><span class="metric-muted">База · ${dt(p.baseline_date)}</span><strong class="value">${n(p.baseline)}</strong><span class="metric-muted">${esc(data.unit)}</span></div>
 <div class="metric-fact"><span class="metric-muted">${p.direction==='range'?'Допустимый диапазон':'Цель'}</span><strong class="value">${n(p.target)}${p.direction==='range'?'–'+n(p.upper):''}</strong><span class="metric-muted">${names[p.direction]||'Направление не задано'}</span></div>
 <div class="metric-fact"><span class="metric-muted">Последний факт · ${dt(s.measured_on)}</span><strong class="value">${n(s.fact)}</strong><span class="metric-muted">${esc(data.unit)}</span></div>
 <div class="metric-fact"><span class="metric-muted">Результат</span><strong class="value">${result(p)}</strong>${progress(p)}<span class="metric-muted">${esc(names[p.outcome||s.outcome]||'')}</span></div></div>
 ${s.freshness==='overdue'?`<div class="metric-callout">${icon('clock')}Просрочено замеров: ${s.missed_count}. Первый пропущенный срок — ${dt(s.next_due)}.</div>`:''}
 ${p.legacy_fact!==null?`<div class="metric-callout">Исходный факт: ${n(p.legacy_fact)} ${esc(data.unit)}. Дата неизвестна; в графике и прогрессе не используется.</div>`:''}
 ${p.closing_note?`<div class="metric-callout">${text(p.closing_note)}</div>`:''}`:empty('Создайте первый период','Укажите цель, базу и даты, затем активируйте период.')}
 ${nav}${tab==='overview'?overview():tab==='measurements'?measurements():tab==='links'?links():tab==='reports'?reports():tab==='comments'?comments():tab==='files'?files():history()}
 <div class="metric-actions">${can?btn('В архив','archive',{},'ghost','archive'):''}</div>`;
}
function definitions(entries){return descriptionList({items:entries.map(([label,value])=>({label,value}))});}
function overview(){const p=period();return `<div class="metric-content"><div class="metric-stack">${panel('Динамика',p?chart(p):empty('Пока нет периода'))}
 ${panel('Методика и источник',definitions([['Описание',data.description||'—'],['Методика периода',p?.method_snapshot||data.method||'Не заполнена'],['Источник периода',p?.source_snapshot||data.source||'Не заполнен'],['График',p?(names[p.cadence]+(p.interval_days?' · '+p.interval_days+' дн.':'')+' · первый замер '+dt(p.first_due_date)):'—']]))}
 ${data.legacy?panel('Исходные сведения',`<details><summary>Показать все поля исходного KR</summary>${legacySnapshot()}</details>`):''}</div>
 <aside class="metric-stack">${panel('Паспорт метрики',definitions([['Владелец',data.owner],['Ответственная команда',data.team],['Вовлечённые команды',data.involved_teams.map(x=>x.name).join(', ')||'—'],['Проект',data.project],['Бизнес-заказчик',data.business_customer],['Подразделение',data.department],['Клиент ДИД',data.did_client_group],['Приоритет',data.priority],['Теги',data.tags.join(', ')||'—'],['Вес, %',n(p?.weight)],['Прогноз, %',n(p?.forecast)]]))}</aside></div>`;}
function chart(p){
 const pts=points().slice().sort((a,b)=>a.measured_on.localeCompare(b.measured_on));
 if(!pts.length)return empty('Пока нет измерений','Первый датированный замер появится на графике.');
 const vals=pts.map(x=>Number(x.value)).concat([p.target,p.upper,p.baseline].filter(x=>x!=null).map(Number)),low=Math.min(...vals),high=Math.max(...vals),span=high-low||Math.max(1,Math.abs(high)*.1);
 const min=low-span*.12,max=high+span*.12;const x=d=>58+(Date.parse(d)-Date.parse(p.start_date))/Math.max(86400000,Date.parse(p.end_date)-Date.parse(p.start_date))*600;
 const y=v=>202-(Number(v)-min)/(max-min)*168;
 const line=pts.map(a=>x(a.measured_on)+','+y(a.value)).join(' ');
 return `<svg viewBox="0 0 700 245" class="metric-chart" role="img" aria-label="Динамика измерений; точные значения во вкладке Измерения">
 ${[0,1,2,3].map(i=>{const v=min+(max-min)*i/3;return `<line class="grid" x1="58" x2="660" y1="${y(v)}" y2="${y(v)}"/><text x="50" y="${y(v)+4}" text-anchor="end">${n(v)}</text>`;}).join('')}
 ${p.direction==='range'&&p.upper!=null?`<rect class="area" x="58" width="600" y="${y(p.upper)}" height="${y(p.target)-y(p.upper)}"/>`:''}
 ${[p.target,p.direction==='range'?p.upper:null].filter(v=>v!=null).map(v=>`<line class="goal" x1="58" x2="658" y1="${y(v)}" y2="${y(v)}"/>`).join('')}
 <polyline class="actual" points="${line}"/>${pts.map(a=>`<circle class="dot" cx="${x(a.measured_on)}" cy="${y(a.value)}" r="4"><title>${dt(a.measured_on)}: ${n(a.value)}</title></circle>`).join('')}
 <text x="58" y="230">${dt(p.start_date)}</text><text x="658" y="230" text-anchor="end">${dt(p.end_date)}</text></svg><p class="metric-muted">Сплошная линия — факт · пунктир — цель${p.direction==='range'?' · фон — допустимый диапазон':''}</p>`;
}
function measurements(){
 const p=period(),rows=points(),canEdit=editable()&&p?.state==='active';
 return panel('Измерения',dataTable({label:'Измерения метрики',rows,className:'metric-table-panel',responsive:'cards',stateTitle:'Нет датированных замеров',columns:[
  {key:'measured_on',label:'Дата',type:'date'},
  {key:'value',label:'Значение',render:m=>tableCell({value:m.value,type:'number',secondary:data.unit})},
  {key:'source',label:'Источник и комментарий',render:m=>tableCell({value:m.source,secondary:m.comment})},
  {key:'author',label:'Автор'},
  ...(canEdit?[{key:'actions',label:'Действия',render:m=>btn('Исправить','measure',{'data-id':m.id,'aria-label':`Исправить замер от ${dt(m.measured_on)}`})}]:[]),
 ]}),canEdit?btn('Внести замер','measure',{},'primary','plus'):'');
}
function links(){return panel('Связанные задачи',data.links.length?`<div class="metric-links">${data.links.map(l=>`<div class="metric-linked"><div>${l.kind==='work'?`<a href="#/work-tasks/${l.target_id}">${text(l.public_id)} · ${esc(l.title)}</a>`:`<button class="metric-link-button ui-link" data-act="open-task" data-id="${l.target_id}">${text(l.public_id)} · ${esc(l.title)}</button>`}<p class="metric-muted">${text(l.team)} · ${text(l.state)}</p></div>${editable()?btn('Убрать связь','unlink',{'data-id':l.id},'ghost'):''}</div>`).join('')}</div>`:empty('Нет связанных задач','Связи показывают работы, влияющие на результат метрики.'),editable()?btn('Связать задачу','link',{},'secondary','link'):'');}
function comments(){const all=[...(data.legacy?.comments||[]).map(x=>({...x,legacy:true})),...data.comments];return panel('Комментарии',`<div class="metric-stack">${all.length?all.map(c=>`<article class="metric-note"><div class="metric-muted">${text(c.author)} · ${dt(c.created_at)}${c.legacy?' · из исходной задачи':''}${c.parent_id?' · ответ на #'+c.parent_id:''}</div><p class="metric-pre">${esc(c.text)}</p></article>`).join(''):empty('Комментариев пока нет')}</div>`,data.permissions.comment&&!data.is_archived?btn('Добавить комментарий','comment',{},'secondary','message-square'):'');}
function files(){const all=[...data.files,...(data.legacy?.files||[]).map(x=>({...x,legacy:true}))];return panel('Файлы',all.length?`<div class="metric-links">${all.map(f=>`<div class="metric-linked"><div><button class="metric-link-button ui-link" data-act="download" data-id="${f.id}" data-legacy="${!!f.legacy}">${esc(f.filename)}</button><p class="metric-muted">${esc(formatFileSize(f.size))} · ${dt(f.created_at)}${f.legacy?' · из исходной задачи':''}${f.measurement_id?' · замер #'+f.measurement_id:''}</p></div>${editable()&&!f.legacy?btn('Удалить','file-remove',{'data-id':f.id},'ghost'):''}</div>`).join('')}</div>`:empty('Файлов пока нет'),editable()?btn('Прикрепить файл','file',{},'secondary','paperclip'):'');}
function reports(){const p=period(),rows=data.reports.filter(x=>x.period_id===selected);return panel('Статусы встреч',`<div class="metric-stack">${rows.length?rows.map(r=>`<article class="metric-note"><strong>${text(r.meeting_kind)} · ${dt(r.meeting_date)}</strong><p class="metric-pre">${esc(r.text)}</p><p class="metric-muted">Снимок на ${dt(r.updated_at)} · факт ${n(r.snapshot.summary.fact)} · цель ${n(r.snapshot.target)} · ${result(r.snapshot)}</p>${editable()&&options.meetings.some(m=>m.id===r.meeting_id&&m.state==='planned')?btn('Изменить статус','report',{'data-id':r.id}):''}</article>`).join(''):empty('Для периода ещё нет статусов')}
 ${data.legacy?.reports.length?`<details><summary>Статусы исходной задачи (${data.legacy.reports.length})</summary>${data.legacy.reports.map(r=>`<article class="metric-note"><p class="metric-pre">${text(r.status_text)}</p><p class="metric-muted">Встреча #${r.meeting_id}</p><pre>${esc(JSON.stringify({progress:r.progress_snapshot,status:r.task_status_snapshot,revisions:r.revisions||[]},null,2))}</pre></article>`).join('')}</details>`:''}</div>`,editable()&&p?btn('Добавить статус','report',{},'secondary','clipboard-list'):'');}
function history(){const entries=[...data.history,...(data.legacy?.history||[]).map(x=>({...x,legacy:true}))].sort((a,b)=>b.created_at.localeCompare(a.created_at));return panel('История изменений',entries.length?`<ol class="metric-history">${entries.map(h=>`<li><div class="metric-muted">${dt(h.created_at)}<br>${text(h.author)}</div><div><strong>${text(actions[h.action]||h.action)}${h.legacy?' · исходная задача':''}</strong>${h.reason?`<p class="metric-pre">${esc(h.reason)}</p>`:''}<details><summary>Изменённые значения</summary>${diff(h.before,h.after)}</details></div></li>`).join('')}</ol>`:empty('История пуста'));}
function diff(before,after){if(typeof before!=='object'||typeof after!=='object')return `<p>Было: ${text(before)}<br>Стало: ${text(after)}</p>`;const keys=[...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(k=>JSON.stringify(before?.[k])!==JSON.stringify(after?.[k]));return `<dl class="metric-defs">${keys.map(k=>`<div><dt>${fieldNames[k]||esc(k)}</dt><dd>${text(JSON.stringify(before?.[k])??'—')} → ${text(JSON.stringify(after?.[k])??'—')}</dd></div>`).join('')}</dl>`;}
const fieldNames={title:'Название',description:'Описание',team_id:'Команда',owner_id:'Владелец',unit:'Единица',method:'Методика',source:'Источник',value:'Значение',measured_on:'Дата замера',target:'Цель',baseline:'База',baseline_date:'Дата базы',direction:'Направление',state:'Состояние',cadence:'Частота',first_due_date:'Первый замер',start_date:'Начало',end_date:'Окончание',upper:'Верхняя граница',weight:'Вес',forecast:'Прогноз',metric_kr_plan:'Исходный план',metric_kr_fact:'Исходный факт',metric_kr_unit:'Исходная единица',key_project_status:'Ключевые проекты',directorate_status:'Директорская оперативка',did_status:'Оперативка ДИД',comment:'Комментарий'};
function legacySnapshot(){return definitions(Object.entries(data.legacy.snapshot||{}).filter(([k,v])=>v!=null).map(([k,v])=>[fieldNames[k]||k,typeof v==='object'?JSON.stringify(v):String(v)]));}

function surface(){
 if(!metricId())return registry();
 const metric=data;let background;
 try{data=listData;listHash=lastList();background=registry();}finally{data=metric;listHash='';}
 return `${background}<dialog id="metric-card" class="metric-card" data-ui-layout="consumer" aria-label="Карточка метрики"><div class="metric-page">${card()}</div></dialog>`;
}
function mountCard(){
 const dialog=root.querySelector('#metric-card');if(!dialog)return;
 bindDetailPanel(dialog,{onClose:closeCard,isBusy:()=>busy}).present();
}
function closeCard(){if(busy)return;returnMetricId=data.id;location.hash=lastList();}
function draw(){root.innerHTML=surface();mountCard();icons();}
let formOrigin=null,discardPending=null;
function discardChanges(){return discardPending ||= confirmAction({title:'Несохранённые изменения',message:'Закрыть форму без сохранения?',confirmText:'Не сохранять',cancelText:'Продолжить редактирование',destructive:true}).finally(()=>{discardPending=null;});}
function openForm(title,content,kind,extra={},submitLabel='Сохранить'){
 if(busy)return;formOrigin=document.activeElement;disposeTargetPicker();document.getElementById('metric-editor')?.remove();dirty=false;
 const dialog=document.createElement('dialog');dialog.id='metric-editor';dialog.className='metric-editor';
 dialog.innerHTML=`<form id="metric-command"><div class="metric-dialog-head"><h2>${esc(title)}</h2>${btn('Закрыть','close',{'aria-label':'Закрыть форму','data-close':true},'ghost','x')}</div><div class="metric-dialog-body"><div class="metric-alert" role="alert" id="metric-form-error"></div><div class="metric-form-grid">${content}</div></div><div class="metric-dialog-foot">${btn('Отмена','close',{'data-close':true})}${btn(submitLabel,'save',{type:'submit'},'primary')}</div></form>`;
 dialog.querySelectorAll('input[name],select[name],textarea[name]').forEach(field=>{field.id ||= 'metric-field-'+field.name;const label=field.closest('label')?.querySelector('.ui-field-label');if(label){label.id=field.id+'-label';field.setAttribute('aria-labelledby',label.id);}});
 root.append(dialog);dialog.dataset.kind=kind;dialog.commandExtra=extra;dialog.commandVersion=data?.version;dialog.requestKey=crypto.randomUUID();
 dialog.addEventListener('cancel',e=>{e.preventDefault();closeForm();});const initial=dialog.querySelector('input:not([type=hidden]),select,textarea');initial?.setAttribute('autofocus','');enhanceDialogOverlay(dialog,formOrigin);dialog.showModal();icons();initial?.focus();
}
async function closeForm(force=false){if(busy&&!force)return;if(!force&&dirty&&!await discardChanges())return;disposeTargetPicker();document.getElementById('metric-editor')?.remove();dirty=false;if(formOrigin?.isConnected)formOrigin.focus();}
function passportForm(create=false){
 const m=create?{team_id:options.team_id,owner_id:options.user_id}:data;
 openForm(create?'Новая метрика':'Паспорт метрики',`${input('title','Название *',m.title,'text','required maxlength="255"')}
 ${select('team_id','Ответственная команда *',options.edit_scope==='team'?options.teams.filter(t=>t.id===options.team_id):options.teams,m.team_id,'Выберите команду','required')}
 ${select('owner_id','Владелец *',options.users,m.owner_id,'Выберите владельца','required')}
 ${input('unit','Единица измерения *',m.unit,'text','required maxlength="50"')}
 ${select('project_id','Проект',options.projects,m.project_id,'Не привязана')}
 ${select('priority_id','Приоритет',options.priorities,m.priority_id,'Не указан')}
 ${area('description','Описание',m.description,'maxlength="10000"')}
 ${area('method','Методика расчёта',m.method,'maxlength="10000"')}
 ${area('source','Источник данных',m.source,'maxlength="2000"')}
 <p class="metric-muted full">Методика и источник обязательны для активации. Изменения паспорта применяются к новым периодам; активированный период хранит собственный снимок.</p>
 ${select('business_customer_id','Бизнес-заказчик',options.business_customers,m.business_customer_id,'Не указан')}
 ${select('department_id','Подразделение',options.departments,m.department_id,'Не указано')}
 ${select('did_client_group_id','Клиент ДИД',options.did_client_groups,m.did_client_group_id,'Не указан')}
 <label class="ui-field"><span class="ui-field-label">Вовлечённые команды</span><select class="input ui-control" name="involved_team_ids" multiple size="4">${options.teams.map(t=>`<option value="${t.id}" ${m.involved_team_ids?.includes(t.id)?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
 ${input('tags','Теги через запятую',(m.tags||[]).join(', '),'text','maxlength="2400"')}
 ${!create?area('reason','Комментарий к изменению','','maxlength="2000"'):''}`,create?'create':'passport');
}
function periodForm(isNew){
 const old=period(),fallback=options.periods.find(p=>p.key===options.current_period);
 const p=isNew?{label:fallback.label,start_date:fallback.start_date,end_date:fallback.end_date,direction:old?.direction||'up',cadence:old?.cadence||'weekly',first_due_date:fallback.start_date}:old;
 openForm(isNew?'Новый период KR':'Цель и график измерений',`${input('label','Название периода *',p.label,'text','required maxlength="120"')}
 ${select('direction','Направление',[{id:'up',name:names.up},{id:'down',name:names.down},{id:'range',name:names.range}],p.direction,'Не выбрано')}
 ${dateRange({id:'metric-period-dates',label:'Период',required:true,className:'full',from:{id:'metric-field-start_date',name:'start_date',label:'Начало',value:p.start_date},to:{id:'metric-field-end_date',name:'end_date',label:'Окончание',value:p.end_date}})}
 ${input('baseline','База',p.baseline,'number','step="any"')}${input('baseline_date','Дата базы',p.baseline_date,'date')}
 ${numberRange({id:'metric-target-range',label:'Целевые значения',className:'full',order:p.direction==='range',from:{id:'metric-field-target',name:'target',label:'Цель / нижняя граница',value:p.target},to:{id:'metric-field-upper',name:'upper',label:'Верхняя граница (для диапазона)',value:p.upper}})}
 ${select('cadence','Частота',Object.entries(names).filter(([k])=>['daily','weekly','monthly','quarterly','interval'].includes(k)).map(([id,name])=>({id,name})),p.cadence,null)}
 ${input('interval_days','Интервал, дней (через N дней)',p.interval_days,'number','min="1" max="366"')}
 ${input('first_due_date','Первый плановый замер',p.first_due_date,'date')}
 ${input('weight','Вес, %',p.weight,'number','step="any" min="0" max="100"')}${input('forecast','Прогноз, %',p.forecast,'number','step="any" min="0" max="100"')}
 <p class="metric-muted full">Новый период сохраняется черновиком. Периоды одной метрики не пересекаются. Для увеличения и снижения нужны база и её дата; для диапазона — обе границы.</p>
 ${!isNew?area('reason','Причина изменения'+(p.state==='active'?' *':''),'',p.state==='active'?'required maxlength="2000"':'maxlength="2000"'):''}`,isNew?'period-new':'period-edit',{period_id:p.id});
}
function measureForm(id){
 const p=period(),m=id?data.measurements.find(x=>x.id===id):{};
 openForm(id?'Исправить измерение':'Внести замер',`${input('measured_on','Дата измерения *',m.measured_on||[options.today,p.end_date].sort()[0],'date',`required min="${p.start_date}" max="${[options.today,p.end_date].sort()[0]}"`)}
 ${input('value','Значение, '+data.unit+' *',m.value,'number','required step="any"')}
 ${area('source','Источник или ссылка *',m.source||p.source_snapshot||data.source,'required maxlength="2000"')}
 ${area('comment','Комментарий',m.comment,'maxlength="5000"')}
 ${id?area('reason','Причина исправления *','','required maxlength="2000"'):''}
 <p class="metric-muted full">Один замер на дату. Нулевое значение допустимо. Исправление сохраняется в истории.</p>`,'measure',{id,period_id:p.id},id?'Сохранить исправление':'Добавить замер');
}
function switchCardLocation(hash){
 ++requestSerial;window.history.pushState(null,'',hash);app.router.lastHash=hash.slice(1);contextHash=hash;choosePeriod();draw();
 root.querySelector('.metric-tab[aria-current=page]')?.focus({preventScroll:true});
}
async function click(e){
 if(busy){e.preventDefault();return;}
 const tab=e.target.closest('.metric-tab');
 if(tab&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&e.button===0){e.preventDefault();switchCardLocation(tab.hash);return;}
 const target=e.target.closest('[data-act]');if(!target||target.disabled)return;const act=target.dataset.act,id=Number(target.dataset.id);
 try{
  if(act==='card-close'){closeCard();return;}
  if(act==='refresh'){const host=root,html=await renderMetrics(app);if(host===root&&host.isConnected&&html){host.innerHTML=html.replace(/^<div[^>]*>|<\/div>$/g,'');mountCard();icons();}return;}
  if(act==='reset'){clearTimeout(filterTimer);searchFocus=null;if(location.hash==='#/metrics')draw();else location.hash='/metrics';return;}
  if(act==='scope'){applyFilters({scope:target.dataset.key});return;}
  if(act==='attention'){
    const selected=new Set(filterValues(params().get('attention')));
    selected.has(target.dataset.key)?selected.delete(target.dataset.key):selected.add(target.dataset.key);
    applyFilters({attention:encodeFilterValues([...selected])});return;
  }
  if(act==='page'){queryChange({page:target.dataset.page});return;}
  if(act==='create'){passportForm(true);return;}if(act==='passport'){passportForm();return;}
  if(act==='period-new'||act==='period-edit'){periodForm(act==='period-new');return;}
  if(act==='measure'){measureForm(id);return;}
  if(act==='close'){closeForm();return;}
  if(act==='comment'){openForm('Комментарий',area('text','Текст *','','required maxlength="10000"'),'comment');return;}
  if(['activate','complete','cancel','reopen'].includes(act)){
    const p=period();const label={activate:'Активировать период',complete:'Завершить период',cancel:'Отменить период',reopen:'Открыть период повторно'}[act];
    openForm(label,`<p class="full">${esc(p.label)} · ${result(p)}. ${act==='complete'?'Завершение периода фиксирует результат независимо от достижения цели.':''}</p>
    ${act!=='activate'?area('reason',act==='complete'?'Итоговый комментарий *':'Причина *','','required maxlength="5000"'):''}
    ${act==='complete'&&p.summary.fact===null?'<label class="ui-checkbox full"><input name="confirm_no_data" type="checkbox" required><span>Подтверждаю завершение без измерений</span></label>':''}`,'transition',{action:act,period_id:p.id},label);return;
  }
  if(act==='archive'){openForm(data.is_archived?'Вернуть из архива':'Архивировать метрику',area('reason','Причина *','','required maxlength="2000"'),'archive',{archive:!data.is_archived});return;}
  if(act==='link'){
   openForm('Связать задачу',`${select('kind','Тип',[{id:'task',name:'Крупная задача бэклога'},{id:'work',name:'Рабочая задача'}],'task',null)}${entityPicker({id:'metric-field-target_id',name:'target_id',label:'Задача',searchName:'target_query',searchLabel:'Поиск задачи',required:true,className:'full',hint:'Показано до 30 доступных задач. Уточните поиск при необходимости.'})}`,'link');
   const dialog=document.getElementById('metric-editor');
   targetPicker=bindEntityPicker(dialog.querySelector('.ui-entity-picker'),{errorMessage:formatErrorMessage,load:async(q,{signal})=>{
    const kind=dialog.querySelector('[name=kind]').value;
    const result=await app.api.get('/metrics/targets?'+new URLSearchParams({kind,q}),{signal});
    return result.items.map(item=>({value:item.id,label:item.public_id+' · '+item.title}));
   }});
   await targetPicker.refresh();return;
  }
  if(act==='open-task'){document.dispatchEvent(new CustomEvent('open-task',{detail:{taskId:id}}));return;}
  if(act==='unlink'){if(await confirmAction({title:'Убрать связь?',message:'Сама задача сохранится.',confirmText:'Убрать связь',destructive:true}))await mutate('DELETE','/links/'+id+'?version='+data.version);return;}
  if(act==='report'){
   const r=data.reports.find(x=>x.id===id)||{},meetings=options.meetings.filter(x=>x.state==='planned').map(x=>({id:x.id,name:x.kind+' · '+dt(x.scheduled_date)}));
   openForm('Статус для встречи',`${select('meeting_id','Запланированная встреча *',meetings,r.meeting_id,'Выберите встречу','required')}${area('text','Статус *',r.text,'required maxlength="10000"')}<p class="metric-muted full">Сохранятся текст и снимок результата выбранного периода. Повторное сохранение обновляет статус этой встречи; прежняя версия остаётся в истории.</p>`,'report',{period_id:selected});return;
  }
  if(act==='file'){openForm('Прикрепить файл',`${input('file','Файл до 50 МБ *','','file','required')}${select('measurement_id','Связать с замером',data.measurements.map(m=>({id:m.id,name:dt(m.measured_on)+' · '+n(m.value)})),'','К метрике в целом')}`,'file','', 'Загрузить');return;}
  if(act==='download'){const legacy=target.dataset.legacy==='true',f=(legacy?data.legacy.files:data.files).find(x=>x.id===id);await app.api.download('/metrics/'+data.id+'/files/'+id+'/download?legacy='+legacy,f.filename);return;}
  if(act==='file-remove'){if(await confirmAction({title:'Удалить вложение?',message:'Запись об удалении останется в истории.',confirmText:'Удалить',destructive:true}))await mutate('DELETE','/files/'+id+'?version='+data.version);return;}
  if(act==='conflict-refresh'){
    const d=document.getElementById('metric-editor');const fresh=await app.api.get('/metrics/'+data.id);d.commandVersion=fresh.version;data=fresh;
    root.querySelector('#metric-form-error').innerHTML='Карточка обновлена. Сверьте актуальные значения ниже; поля формы сохранены. Затем повторите сохранение.<details><summary>Актуальные значения</summary><pre>'+esc(JSON.stringify({title:fresh.title,description:fresh.description,team:fresh.team,owner:fresh.owner,unit:fresh.unit,method:fresh.method,source:fresh.source,project:fresh.project,tags:fresh.tags,periods:fresh.periods,measurements:fresh.measurements},null,2))+'</pre></details>';return;
  }
 }catch(error){showToast(formatErrorMessage(error),'error');}
}
function change(e){
 if(e.target.closest('#metric-editor')&&e.target.name==='direction')document.getElementById('metric-target-range')?.setAttribute('data-range-order',String(e.target.value==='range'));
 if(e.target.name==='period_id'&&!e.target.closest('#metric-editor')){const p=params();p.set('period_id',e.target.value);switchCardLocation('#/metrics/'+data.id+'?'+p);}
 if(e.target.form?.id==='metric-filters'&&(e.target.tagName==='SELECT'||e.target.type==='checkbox'))e.target.form.requestSubmit();
 if(e.target.closest('#metric-editor')&&e.target.name==='kind')targetPicker?.refresh({reset:true});
}
async function mutate(method,suffix,body){if(busy)return;busy=true;root.setAttribute('aria-busy','true');try{const updated=await app.api.request(method,'/metrics/'+data.id+suffix,body);data=updated;draw();root.querySelector('.metric-tab[aria-current=page]')?.focus();showToast('Сохранено');}finally{busy=false;root.removeAttribute('aria-busy');}}
async function submit(e){
 if(e.target.id==='metric-filters'){e.preventDefault();applyFilters();return;}
 if(e.target.id!=='metric-command')return;e.preventDefault();if(busy)return;
 clearFormErrors(e.target);
 const d=document.getElementById('metric-editor'),kind=d.dataset.kind,extra=d.commandExtra||{},f=new FormData(e.target),values=Object.fromEntries(f.entries());
 root.querySelector('#metric-form-error').textContent='';
 if(kind.startsWith('period-')){const errors=validateRanges(e.target);if(values.first_due_date&&((values.start_date&&values.first_due_date<values.start_date)||(values.end_date&&values.first_due_date>values.end_date)))errors['metric-field-first_due_date']='Первый замер должен быть внутри периода';if(Object.keys(errors).length){showFormErrors(e.target,errors);return;}}
 const previousPeriodIds=new Set(data?.periods?.map(p=>p.id)||[]);const version=d.commandVersion;let path='/metrics/'+data?.id,method='POST',body={version};
 if(kind==='create'||kind==='passport'){
  body={};for(const key of ['title','description','unit','method','source'])body[key]=values[key]||'';
  for(const key of ['team_id','owner_id','project_id','priority_id','business_customer_id','department_id','did_client_group_id'])body[key]=values[key]?Number(values[key]):null;
  body.involved_team_ids=f.getAll('involved_team_ids').map(Number);body.tags=(values.tags||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(kind==='create')path='/metrics';else{method='PATCH';body.version=version;body.reason=values.reason||'';}
 }else if(kind.startsWith('period-')){
  for(const k of ['label','cadence'])body[k]=values[k];body.direction=values.direction||null;
  for(const k of ['start_date','end_date','baseline_date','first_due_date'])body[k]=values[k]||null;
  for(const k of ['baseline','target','upper','interval_days','weight','forecast'])body[k]=values[k]===''?null:Number(values[k]);
  body.reason=values.reason||'';path+='/periods';if(kind==='period-edit'){method='PATCH';path+='/'+extra.period_id;}
 }else if(kind==='measure'){
  body={version,measured_on:values.measured_on,value:Number(values.value),source:values.source,comment:values.comment||'',reason:values.reason||''};
  if(extra.id){method='PATCH';path+='/measurements/'+extra.id;}else path+='/periods/'+extra.period_id+'/measurements';
 }else if(kind==='transition'){path+='/periods/'+extra.period_id+'/transition';body={version,action:extra.action,reason:values.reason||'',confirm_no_data:!!values.confirm_no_data};}
 else if(kind==='comment'){path+='/comments';body.text=values.text;}
 else if(kind==='archive'){path+='/archive';body.archive=extra.archive;body.reason=values.reason;}
 else if(kind==='link'){path+='/links';body.kind=values.kind;body.target_id=Number(values.target_id);}
 else if(kind==='report'){path+='/reports';body.period_id=extra.period_id;body.meeting_id=Number(values.meeting_id);body.text=values.text;}
 else if(kind==='file'){path+='/files';body=new FormData();body.set('version',version);body.set('file',f.get('file'));if(values.measurement_id)body.set('measurement_id',values.measurement_id);}
 const controls=new Map([...d.querySelectorAll('button,input,select,textarea')].map(control=>[control,control.disabled]));controls.forEach((wasDisabled,control)=>control.disabled=true);busy=true;d.setAttribute('aria-busy','true');root.querySelector('#metric-form-error').textContent='';
 try{
  const fresh=await app.api.request(method,path,body,kind==='create'?{idempotencyKey:d.requestKey}:{});
  busy=false;await closeForm(true);showToast('Сохранено');
  if(kind==='create'){location.hash='/metrics/'+fresh.id;return;}
  data=fresh;if(kind==='period-new')selected=fresh.periods.find(p=>!previousPeriodIds.has(p.id))?.id||fresh.periods[0]?.id;
  if(!selected)choosePeriod();
  if(kind==='period-new'){const query=params();query.set('period_id',selected);location.hash='/metrics/'+data.id+'?'+query;return;}
  draw();
 }catch(error){
  busy=false;d.removeAttribute('aria-busy');controls.forEach((wasDisabled,control)=>control.disabled=wasDisabled);const alert=root.querySelector('#metric-form-error');
  alert.innerHTML=esc(formatErrorMessage(error))+(error.status===409?`<div>${btn('Обновить данные карточки','conflict-refresh')}</div>`:'');alert.setAttribute('tabindex','-1');const issues=Array.isArray(error.data)?error.data:Array.isArray(error.data?.detail)?error.data.detail:[];const fields=Object.fromEntries(issues.filter(issue=>d.querySelector('[name="'+CSS.escape(String(issue.loc?.at(-1)||''))+'"]')).map(issue=>['metric-field-'+issue.loc.at(-1),/[а-яё]/i.test(issue.msg||'')?issue.msg:'Проверьте значение поля']));if(Object.keys(fields).length)showFormErrors(e.target,fields);else alert.focus();alert.scrollIntoView({block:'nearest'});icons();
 }
}
