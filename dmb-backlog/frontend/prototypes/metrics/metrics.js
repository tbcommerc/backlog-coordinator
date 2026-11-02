import {button,field,pageHeader,filterChip,kpiCard,badge,tabs} from '../../js/ui/primitives.js';
import {escapeHtml as esc} from '../../js/htmlUtils.js';
import {renderSidebar} from '../../js/components/sidebar.js';

const TODAY='2026-10-26', CURRENT='2026-Q4';
const periods={'2026-Q4':{label:'IV квартал 2026',start:'2026-10-01',end:'2026-12-31'},'2026-Q3':{label:'III квартал 2026',start:'2026-07-01',end:'2026-09-30'},'2027-Q1':{label:'I квартал 2027',start:'2027-01-01',end:'2027-03-31'}};
const titles={active:'Активен',draft:'Черновик',completed:'Завершён',cancelled:'Отменён'};
const directions={up:'Увеличить',down:'Уменьшить',range:'Удерживать в границах'};
const state={period:CURRENT,query:'',team:'',project:'',owner:'',lifecycle:'',scope:'all',attention:'',advanced:false,tab:'overview'};
state.listPeriod=CURRENT;
let serial=100, noticeTimer, focusBeforeDialog;
const measurement=(value,date,comment='')=>({id:++serial,value,date,source:'Операционный отчёт',author:'Анна Морозова',comment});
const kr=(baseline,target,values,extra={})=>({baseline,target,baselineDate:'2026-10-01',direction:'up',state:'active',frequency:7,measurements:values.map(v=>measurement(v[1],v[0])),...extra});
const metrics=[
 {id:'MET-001',title:'Доля автоматизированных операций',team:'Core',owner:'Анна Морозова',unit:'%',project:'Автоматизация операций',description:'Увеличить долю операций, выполняемых без ручного участия, в основном операционном процессе.',method:'Количество операций без ручного участия / общее количество операций × 100%. Исключаем тестовые и отменённые операции. Факт — значение за завершённую неделю.',source:'Операционный отчёт · раздел «Автоматизация»',priority:'Высокий',tags:'Автоматизация, эффективность',customer:'Операционный блок',department:'Операционное управление',client:'Внутренние подразделения',teams:'Delivery',notes:[],history:[],tasks:[{id:'DMB-241',title:'Автоматизировать обработку типовых операций',status:'В работе'},{id:'WRK-108',title:'Проверить покрытие автоматизацией',status:'На приёмке'},{id:'WRK-116',title:'Уточнить правила исключения операций',status:'Выполнена'}],periods:{
  '2026-Q4':kr(50,80,[['2026-10-05',54],['2026-10-12',58],['2026-10-19',62],['2026-10-26',65]]),
  '2026-Q3':kr(30,50,[['2026-07-31',36],['2026-08-31',43],['2026-09-30',50]],{state:'completed',baselineDate:'2026-07-01'})}},
 {id:'MET-002',title:'Время обработки заявки',team:'Delivery',owner:'Иван Соколов',unit:'мин',project:'Клиентский путь',description:'Сократить медианное время от регистрации заявки до результата.',method:'Медиана времени обработки всех завершённых заявок за неделю. Тестовые обращения исключаются.',source:'Отчёт по заявкам',tasks:[],periods:{[CURRENT]:kr(30,15,[['2026-10-05',27],['2026-10-12',24],['2026-10-19',21]],{direction:'down'})}},
 {id:'MET-003',title:'Доступность платформы',team:'Core',owner:'Анна Морозова',unit:'%',project:'Надёжность платформы',description:'Поддерживать доступность сервисов в установленном диапазоне.',method:'Доступные минуты / все минуты отчётного интервала × 100%. Измерение за завершённые сутки.',source:'Отчёт доступности',tasks:[],periods:{[CURRENT]:kr(99.9,99.9,[['2026-10-24',99.96],['2026-10-25',99.98],['2026-10-26',99.97]],{direction:'range',upper:100,frequency:1})}},
 {id:'MET-004',title:'Доля сверок без расхождений',team:'Post-Trade',owner:'Мария Волкова',unit:'%',project:'Качество данных',description:'Увеличить долю сверок, не требующих ручного разбора.',method:'Количество сверок без расхождений / все сверки × 100%.',source:'Реестр сверок',tasks:[],periods:{[CURRENT]:kr(75,95,[['2026-10-05',84],['2026-10-12',96]])}},
 {id:'MET-005',title:'Доля заявок без возврата',team:'Delivery',owner:'Иван Соколов',unit:'%',project:'Клиентский путь',description:'Снизить число возвратов заявок на уточнение.',method:'Заявки без возврата / завершённые заявки × 100%.',source:'Отчёт по заявкам',tasks:[],periods:{[CURRENT]:kr(60,85,[])}},
 {id:'MET-006',title:'Критические инциденты',team:'Core',owner:'Анна Морозова',unit:'шт.',project:'Надёжность платформы',description:'Сократить число критических инцидентов за отчётный интервал.',method:'Количество подтверждённых критических инцидентов за завершённую неделю.',source:'Журнал инцидентов',tasks:[],periods:{[CURRENT]:kr(8,0,[['2026-10-05',5],['2026-10-12',3],['2026-10-19',1],['2026-10-26',0]],{direction:'down'})}},
 {id:'MET-007',title:'Покрытие регрессионными проверками',team:'Delivery',owner:'Мария Волкова',unit:'%',project:'Качество поставки',description:'Определить целевое покрытие критических сценариев.',method:'',source:'',tasks:[],periods:{[CURRENT]:kr(null,null,[],{state:'draft'})}},
 {id:'MET-008',title:'Доля повторных обращений',team:'Post-Trade',owner:'Мария Волкова',unit:'%',project:'Клиентский путь',description:'Снизить долю обращений по уже решённым вопросам.',method:'Повторные обращения / все обращения × 100%.',source:'Реестр обращений',tasks:[],periods:{[CURRENT]:kr(20,10,[['2026-10-05',18],['2026-10-12',17],['2026-10-19',19],['2026-10-26',21]],{direction:'down'})}}
];
metrics.forEach(m=>{m.history??=[];m.notes??=[];m.priority??='Обычный';m.tags??='';m.files??=[];m.reporting??={};});
const fmt=v=>v==null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(v);
const date=d=>d?d.split('-').reverse().join('.'):'—';
const shortDate=d=>date(d).slice(0,5);
const plusDays=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const days=(a,b)=>Math.round((Date.parse(a)-Date.parse(b))/86400000);
const ico=name=>'<i data-lucide="'+name+'" aria-hidden="true"></i>';
const btn=(label,action,variant='secondary',icon='',extra={})=>button({label,variant,icon,attrs:{'data-action':action,...extra}});
const options=values=>values.map(v=>({value:v,label:v}));
const select=(id,label,items,value='')=>field({id,label,kind:'select',options:items,value});
const last=k=>k.measurements.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.id-b.id).at(-1);
function progress(k) {const v=last(k)?.value;if(v==null||k.baseline==null||k.target==null||k.direction==='range'||k.baseline===k.target)return null;return (v-k.baseline)/(k.target-k.baseline)*100;}
function achieved(k) {const v=last(k)?.value;if(v==null||k.target==null)return false;return k.direction==='range'?v>=k.target&&v<=k.upper:k.direction==='down'?v<=k.target:v>=k.target;}
function freshness(k) {if(k.state!=='active')return {label:k.state==='completed'?'Итог периода':'Не требуется',tone:'neutral',next:null};const v=last(k),due=v?plusDays(v.date,k.frequency):periods[state.period]?.start||TODAY;if(!v)return {label:'Нет данных',tone:'neutral',next:due};return due<TODAY?{label:'Просрочено на '+days(TODAY,due)+' дн.',tone:'warning',next:due}:{label:due===TODAY?'Обновить сегодня':'Актуально',tone:due===TODAY?'warning':'success',next:due};}
const status=k=>badge({label:titles[k.state],tone:k.state==='active'?'info':k.state==='completed'?'success':'neutral'});
const targetText=(m,k)=>k.target==null?'—':(k.direction==='range'?fmt(k.target)+'–'+fmt(k.upper):(k.direction==='down'?'≤ ':'≥ ')+fmt(k.target))+' '+m.unit;
function result(m,k,compact=false) {if(k.state==='draft')return '<span class="metric-muted">Цель не задана</span>';if(!last(k))return '<span class="metric-muted">Нет данных</span>';if(k.direction==='range')return badge({label:achieved(k)?'В границах':'Вне границ',tone:achieved(k)?'success':'danger'});const p=progress(k);if(p==null)return '<span class="metric-muted">Нет базы расчёта</span>';return '<span class="'+(achieved(k)?'metric-text-success':'')+'">'+fmt(p)+'%</span>'+(compact?'<div class="metric-progress '+(achieved(k)?'success':'')+'"><span style="width:'+Math.max(0,Math.min(100,p))+'%"></span></div>':'');}
const periodOptions=()=>Object.entries(periods).map(([value,p])=>({value,label:p.label}));
const metricUrl=(m,period=state.period)=>'#/metrics/'+m.id+'?period='+encodeURIComponent(period);
function hydrate(){window.lucide?.createIcons();}
function notify(message){clearTimeout(noticeTimer);const n=document.getElementById('notice');n.textContent=message;n.hidden=false;noticeTimer=setTimeout(()=>{n.hidden=true;},4500);}
function shell(){
 document.getElementById('shell').innerHTML=renderSidebar()+'<div class="main-wrapper"><header class="navbar"><div class="navbar-left">'+button({label:'Открыть меню',icon:'menu',iconOnly:true,className:'metric-mobile-menu',attrs:{'data-action':'menu'}})+'<nav class="navbar-breadcrumb" aria-label="Навигация"><a href="#/metrics" class="breadcrumb-parent">Управление бэклогом</a><span class="breadcrumb-separator">/</span><span class="breadcrumb-current">Метрики</span></nav></div><div class="navbar-right">'+button({label:'Переключить тему',icon:'moon',iconOnly:true,attrs:{'data-action':'theme'}})+'<span class="metric-avatar" title="Анна Морозова">АМ</span></div></header><main class="main-content"><div id="content"></div></main></div>';
 const side=document.querySelector('.sidebar');side.classList.remove('collapsed');
 side.querySelectorAll('.sidebar-item').forEach(a=>{a.classList.remove('active');a.dataset.previewNav='true';});
 const work=side.querySelector('a[href="#/work-tasks"]');
 work.insertAdjacentHTML('afterend','<a href="#/metrics" class="sidebar-item active" aria-current="page">'+ico('line-chart')+'<span>Метрики</span></a>');
 side.querySelector('.sidebar-toggle').dataset.action='collapse-menu';
}
function baseRows(){return metrics.filter(m=>m.periods[state.period]).filter(m=>(!state.query||(m.title+' '+m.id+' '+m.owner).toLowerCase().includes(state.query.toLowerCase()))&&(!state.team||m.team===state.team)&&(!state.project||m.project===state.project)&&(!state.owner||m.owner===state.owner)&&(!state.lifecycle||m.periods[state.period].state===state.lifecycle));}
function selectedRows(){return baseRows().filter(m=>{const k=m.periods[state.period];return (state.scope!=='mine'||m.owner==='Анна Морозова')&&(state.scope!=='draft'||k.state==='draft')&&(!state.attention||(state.attention==='active'&&k.state==='active')||(state.attention==='achieved'&&k.direction!=='range'&&achieved(k))||(state.attention==='stale'&&k.state==='active'&&last(k)&&freshness(k).next<TODAY)||(state.attention==='none'&&k.state==='active'&&!last(k)));});}
function list(){
 document.title='Метрики · Прототип';
 document.getElementById('content').innerHTML='<section class="metric-page">'+pageHeader({title:'Метрики',description:'Цели по периодам, измерения и результат команд.',actions:btn('Создать метрику','create','primary','plus')})+'<div class="metric-kpis" id="kpis"></div><div class="metric-filter">'+field({id:'search',label:'Поиск метрики',type:'search',value:state.query,attrs:{placeholder:'Название, ID или владелец'}})+select('period','Период KR',periodOptions(),state.period)+select('team','Команда',[{value:'',label:'Все команды'},...options(['Core','Delivery','Post-Trade'])],state.team)+button({label:'Фильтры',icon:'sliders-horizontal',attrs:{id:'filters-toggle','data-action':'filters','aria-expanded':state.advanced,'aria-controls':'advanced'}})+'</div><div id="advanced" class="metric-advanced"'+(state.advanced?'':' hidden')+'>'+select('project','Проект',[{value:'',label:'Все проекты'},...options([...new Set(metrics.map(m=>m.project))])],state.project)+select('owner','Владелец',[{value:'',label:'Все владельцы'},...options(['Анна Морозова','Иван Соколов','Мария Волкова'])],state.owner)+select('lifecycle','Состояние KR',[{value:'',label:'Все состояния'},...Object.entries(titles).map(([value,label])=>({value,label}))],state.lifecycle)+'</div><div class="filter-caption"><div class="filter-chips" id="scopes"></div><div class="metric-inline"><span id="count" class="metric-muted" role="status"></span>'+btn('Сбросить','reset','ghost')+'</div></div><div id="rows"></div></section>';
 ['search','period','team','project','owner','lifecycle'].forEach(id=>document.getElementById(id).addEventListener(id==='search'?'input':'change',e=>{state[id==='search'?'query':id]=e.target.value;drawRows();}));
 drawRows();
}
function drawRows(){
 const base=baseRows(),rows=selectedRows(),isActive=m=>m.periods[state.period].state==='active';
 const summaries=[['Активные KR',base.filter(isActive).length,'active'],['Цель достигнута',base.filter(m=>achieved(m.periods[state.period])&&m.periods[state.period].direction!=='range').length,'achieved'],['Обновление просрочено',base.filter(m=>isActive(m)&&last(m.periods[state.period])&&freshness(m.periods[state.period]).next<TODAY).length,'stale'],['Ожидают первого факта',base.filter(m=>isActive(m)&&!last(m.periods[state.period])).length,'none']];
 document.getElementById('kpis').innerHTML=summaries.map(([label,value,attention])=>kpiCard({label,value,attrs:{'data-attention':attention,'aria-pressed':state.attention===attention}})).join('');
 document.getElementById('scopes').innerHTML=[['Все','all',base.length],['Мои','mine',base.filter(m=>m.owner==='Анна Морозова').length],['Черновики','draft',base.filter(m=>m.periods[state.period].state==='draft').length]].map(([label,scope,count])=>filterChip({label,count,selected:state.scope===scope,attrs:{'data-scope':scope}})).join('');
 document.getElementById('count').textContent='Показано '+rows.length+' из '+base.length;
 document.getElementById('rows').innerHTML=rows.length?'<div class="metric-table-panel"><table class="metric-table"><colgroup><col style="width:29%"><col style="width:15%"><col style="width:11%"><col style="width:12%"><col style="width:13%"><col style="width:14%"><col style="width:6%"></colgroup><thead><tr><th>Метрика</th><th>Команда / владелец</th><th>Цель</th><th>Факт</th><th>Результат</th><th>Данные</th><th><span class="sr-only">Действия</span></th></tr></thead><tbody>'+rows.map(m=>{
 const k=m.periods[state.period],v=last(k),f=freshness(k);return '<tr><td><a class="metric-name" href="'+metricUrl(m)+'">'+esc(m.title)+'</a><div class="metric-inline metric-muted"><span class="metric-id">'+m.id+'</span>'+status(k)+'</div></td><td data-label="Команда / владелец">'+esc(m.team)+'<div class="metric-muted">'+esc(m.owner)+'</div></td><td data-label="Цель"><span class="metric-number">'+esc(targetText(m,k))+'</span></td><td data-label="Факт"><span class="metric-number">'+(v?fmt(v.value)+' '+esc(m.unit):'—')+'</span><div class="metric-muted">'+(v?date(v.date):'Нет измерений')+'</div></td><td data-label="Результат">'+result(m,k,true)+'</td><td data-label="Данные"><span class="metric-status-text metric-text-'+f.tone+'">'+ico(f.tone==='warning'?'clock':f.tone==='success'?'check-circle-2':'minus')+esc(f.label)+'</span></td><td class="row-action">'+button({label:'Открыть '+m.title,icon:'chevron-right',iconOnly:true,variant:'ghost',attrs:{'data-open':m.id}})+'</td></tr>';
 }).join('')+'</tbody></table><div class="metric-pager"><span class="metric-muted">'+periods[state.period].label+' · одна строка на метрику</span><span class="metric-muted">'+rows.length+' метрик</span></div></div>':'<div class="metric-table-panel metric-empty">'+ico('search')+'<h2>Метрики не найдены</h2><p class="metric-muted">Измените период или сбросьте фильтры.</p>'+btn('Сбросить фильтры','reset')+'</div>';
 hydrate();
}
let currentMetric=null;
function card(m){
 const k=m.periods[state.period];if(!k){state.period=Object.keys(m.periods)[0];location.replace(metricUrl(m));return;}
 currentMetric=m;document.title=m.title+' · Метрики · Прототип';
 const v=last(k),p=progress(k),fresh=freshness(k),closed=k.state==='completed'||k.state==='cancelled';
 const action=k.state==='draft'?btn('Активировать KR','activate','primary','play'):closed?'':btn('Добавить измерение','measure','primary','plus');
 const achievedText=!v?'Ожидает измерения':k.direction==='range'?(achieved(k)?'В пределах нормы':'Нарушение границ'):achieved(k)?'Цель достигнута':'Цель ещё не достигнута';
 document.getElementById('content').innerHTML='<section class="metric-page"><a class="metric-back" href="#/metrics">'+ico('arrow-left')+'Все метрики</a>'+pageHeader({title:m.title,className:'metric-header-detail',actions:'<div class="metric-actions">'+btn('Редактировать','edit','secondary','pencil')+action+'</div>'})+'<div class="metric-meta"><span class="metric-id">'+m.id+'</span>'+status(k)+'<span>'+directions[k.direction]+'</span><span class="metric-project-chip">'+ico('folder')+esc(m.project||'Без проекта')+'</span></div><div class="metric-period-bar"><div class="metric-inline">'+select('card-period','Период KR',Object.keys(m.periods).map(key=>({value:key,label:periods[key].label})),state.period)+'<span class="metric-period-dates">'+date(periods[state.period].start)+' — '+date(periods[state.period].end)+'</span></div><div class="metric-actions">'+(!closed?btn('Настроить цель','goal','ghost','settings-2'):'')+btn('Новый период','new-period','secondary','calendar-plus')+(k.state==='active'?btn('Завершить период','finish','ghost'):'')+'</div></div>'+
 (closed?'<div class="metric-callout metric-period-note">'+ico('archive')+'<div>Период '+titles[k.state].toLowerCase()+'. Сохранены его цель, измерения и итоговый результат.</div></div>':fresh.tone==='warning'||!v?'<div class="metric-callout">'+ico('clock')+'<div>'+(v?esc(fresh.label)+'. Последнее измерение — '+date(v.date)+'.':'Пока нет измерений. Добавьте первый факт, чтобы увидеть результат KR.')+'</div></div>':'')+
 '<div class="metric-facts"><div class="metric-fact"><span class="metric-muted">Исходное значение</span><strong class="value">'+fmt(k.baseline)+' <small>'+esc(m.unit)+'</small></strong><span class="metric-muted">На '+date(k.baselineDate)+'</span></div><div class="metric-fact"><span class="metric-muted">Цель на '+date(periods[state.period].end)+'</span><strong class="value">'+(k.direction==='range'?fmt(k.target)+'–'+fmt(k.upper):fmt(k.target))+' <small>'+esc(m.unit)+'</small></strong><span class="metric-muted">'+directions[k.direction]+'</span></div><div class="metric-fact"><span class="metric-muted">Последний факт</span><strong class="value">'+fmt(v?.value)+' <small>'+esc(m.unit)+'</small></strong><span class="metric-muted">'+(v?'Измерено '+date(v.date):'Нет данных')+'</span></div><div class="metric-fact"><span class="metric-muted">'+(k.direction==='range'?'Соблюдение границ':'Выполнение KR')+'</span><strong class="value">'+(k.direction==='range'?(v?(achieved(k)?'В норме':'Вне нормы'):'—'):(p==null?'—':fmt(p)+'%'))+'</strong><span class="metric-muted">'+achievedText+'</span></div></div><div class="metric-tabs">'+tabs({id:'metric',label:'Разделы карточки метрики',selected:state.tab,items:[{id:'overview',label:'Обзор'},{id:'measurements',label:'Измерения · '+k.measurements.length},{id:'tasks',label:'Связанные задачи · '+m.tasks.length},{id:'history',label:'История'}]})+'</div><div id="card-content" role="tabpanel" aria-labelledby="metric-'+state.tab+'-tab"></div></section>';
 document.getElementById('card-period').onchange=e=>{state.period=e.target.value;location.hash=metricUrl(m);};
 document.querySelectorAll('[role=tab]').forEach(t=>{const id=t.id.replace('metric-','').replace('-tab','');t.onclick=()=>{state.tab=id;card(m);document.getElementById('metric-'+id+'-tab').focus();};t.onkeydown=e=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();const all=[...document.querySelectorAll('[role=tab]')],i=all.indexOf(t);all[e.key==='Home'?0:e.key==='End'?all.length-1:(i+(e.key==='ArrowRight'?1:-1)+all.length)%all.length].click();};});
 const panel=document.getElementById('card-content');panel.id='metric-'+state.tab+'-panel';
 panel.innerHTML=state.tab==='overview'?overview(m,k):state.tab==='measurements'?measurements(m,k):state.tab==='tasks'?linkedTasks(m):history(m);
 hydrate();if(state.tab==='overview')requestAnimationFrame(()=>chart(m,k));
}
function panel(title,body,action=''){return '<section class="metric-panel"><div class="metric-panel-head"><h2>'+title+'</h2>'+action+'</div>'+body+'</section>';}
function definition(label,value){return '<div><dt>'+label+'</dt><dd>'+value+'</dd></div>';}
function overview(m,k){
 const f=freshness(k),v=last(k);
 return '<div class="metric-content"><div class="metric-stack">'+panel('Динамика показателя','<div class="metric-chart-key"><span><i></i>Факт, '+esc(m.unit)+'</span><span><i class="goal-key"></i>'+(k.direction==='range'?'Границы нормы':'Цель на конец периода')+'</span></div><div id="chart"></div><p class="metric-muted">Только фактические измерения. '+(k.direction==='range'?'Проверяем каждое измерение на соответствие границам.':'Прогноз и промежуточный план не заданы.')+'</p>')+
 panel('Что измеряем','<p class="metric-method">'+esc(m.description)+'</p><div class="metric-formula">'+esc(m.method||'Методика расчёта ещё не заполнена')+'</div><dl class="metric-defs">'+definition('Источник данных',esc(m.source||'Не указан'))+'</dl>')+
 reportingPanel(m)+panel('Обсуждение и материалы','<div class="metric-note"><span class="metric-muted">Анна Морозова · 26 октября</span><p>'+(m.id==='MET-001'?'Прирост после автоматизации типовых операций. Следующий шаг — подключить оставшиеся сценарии обработки.':'Измерения и пояснения к результату сохраняем в этой карточке.')+'</p></div>'+m.notes.map(n=>'<div class="metric-note"><span class="metric-muted">Анна Морозова · 26 октября</span><p>'+esc(n)+'</p></div>').join('')+'<div class="metric-materials"><div class="metric-panel-head"><h3>Вложения · '+m.files.length+'</h3>'+btn('Добавить файл','attach','ghost','paperclip')+'</div><div>'+m.files.map(f=>'<p class="metric-muted">'+esc(f.name)+' · '+Math.ceil(f.size/1024)+' КБ</p>').join('')+(m.files.length?'':'<p class="metric-muted">Файлы и подтверждения для метрики.</p>')+'</div><input id="metric-file" type="file" hidden></div>',btn('Комментарий','comment','ghost','message-square'))+
 '</div><aside class="metric-stack">'+panel('Ответственность','<dl class="metric-defs">'+definition('Команда',esc(m.team))+definition('Владелец','<span class="metric-inline"><span class="metric-avatar">'+esc(m.owner.split(' ').map(s=>s[0]).join(''))+'</span>'+esc(m.owner)+'</span>')+definition('Вовлечённые команды',esc(m.teams||'Не указаны'))+definition('Проект',esc(m.project||'Без проекта'))+'</dl>')+
 panel('Обновление данных','<dl class="metric-defs">'+definition('Периодичность',k.frequency===1?'Ежедневно':k.frequency===7?'Еженедельно':'Каждые '+k.frequency+' дней')+definition('Следующее измерение',f.next?date(f.next):'Не требуется')+definition('Актуальность','<span class="metric-text-'+f.tone+'">'+esc(f.label)+'</span>')+definition('Последнее значение',v?fmt(v.value)+' '+esc(m.unit)+' · '+date(v.date):'Нет данных')+'</dl>')+
 panel('Дополнительно','<dl class="metric-defs">'+definition('Приоритет',esc(m.priority))+definition('Бизнес-заказчик',esc(m.customer||'Не указан'))+definition('Подразделение',esc(m.department||'Не указано'))+definition('Клиент ДИД',esc(m.client||'Не указан'))+definition('Теги',esc(m.tags||'Без тегов'))+definition('Вес оценки периода',k.weight!=null?fmt(k.weight)+'%':'Не задан')+definition('Прогноз выполнения',k.forecast!=null?fmt(k.forecast)+'%':'Не задан')+'</dl>')+'</aside></div>';
}
function chart(m,k){
 const el=document.getElementById('chart');if(!el)return;
 if(!k.measurements.length){el.innerHTML='<div class="metric-empty">'+ico('line-chart')+'<p>График появится после первого измерения</p></div>';hydrate();return;}
 const points=k.measurements.slice().sort((a,b)=>a.date.localeCompare(b.date));
 const W=Math.max(260,el.clientWidth),H=228,L=45,R=22,T=22,B=34;
 const values=points.map(v=>v.value).concat([k.baseline,k.target,k.direction==='range'?k.upper:null].filter(v=>v!=null)),lo=Math.min(...values),hi=Math.max(...values),span=hi-lo||Math.max(1,Math.abs(hi)*.1);
 const min=lo-span*.2,max=hi+span*.2;
 const start=Date.parse(k.baselineDate||points[0].date),end=Math.max(start+86400000,Date.parse(points.at(-1).date)),x=d=>L+(Date.parse(d)-start)/(end-start)*(W-L-R),y=v=>T+(max-v)/(max-min)*(H-T-B);
 const p=points.map(v=>x(v.date)+','+y(v.value)).join(' ');
 let svg='<svg class="metric-chart" role="img" aria-label="Динамика фактических измерений, '+esc(m.unit)+'. Точные значения доступны во вкладке Измерения." viewBox="0 0 '+W+' '+H+'">';
 for(let i=0;i<5;i++){const v=min+(max-min)*i/4,Y=y(v);svg+='<line class="grid" x1="'+L+'" x2="'+(W-R)+'" y1="'+Y+'" y2="'+Y+'"/><text x="'+(L-9)+'" y="'+(Y+4)+'" text-anchor="end">'+fmt(v)+'</text>';}
 if(k.direction==='range')svg+='<rect x="'+L+'" y="'+y(k.upper)+'" width="'+(W-L-R)+'" height="'+(y(k.target)-y(k.upper))+'" fill="var(--success-light)"/>';
 [k.target,k.direction==='range'?k.upper:null].filter(v=>v!=null).forEach(v=>{svg+='<line class="goal" x1="'+L+'" x2="'+(W-R)+'" y1="'+y(v)+'" y2="'+y(v)+'"/>';});
 svg+='<polyline class="actual" points="'+p+'"/>'+points.map(v=>'<circle class="dot" cx="'+x(v.date)+'" cy="'+y(v.value)+'" r="4"><title>'+date(v.date)+': '+fmt(v.value)+' '+esc(m.unit)+'</title></circle>').join('');
 const ticks=[k.baselineDate,points[Math.floor((points.length-1)/2)].date,points.at(-1).date].filter((v,i,a)=>a.indexOf(v)===i);
 ticks.forEach((d,i)=>{svg+='<text x="'+x(d)+'" y="'+(H-10)+'" text-anchor="'+(i===0?'start':i===ticks.length-1?'end':'middle')+'">'+shortDate(d)+'</text>';});
 el.innerHTML=svg+'</svg>';
}
function reportingPanel(m){
 const types=['Ключевые проекты','Директорская','Оперативка ДИД'];
 return '<details class="metric-panel ui-collapse-section"><summary>Статусы для встреч</summary><div class="metric-reporting">'+types.map(t=>'<div class="metric-linked"><div><strong>'+t+'</strong><p class="metric-muted">'+esc(m.reporting[t]||'Статус ещё не подготовлен')+'</p></div>'+btn('Подготовить','report','ghost','pencil',{'data-meeting':t})+'</div>').join('')+'</div></details>';
}
function measurements(m,k){
 const closed=['completed','cancelled'].includes(k.state);
 if(!k.measurements.length)return panel('История измерений','<div class="metric-empty">'+ico('bar-chart-3')+'<h2>Пока нет измерений</h2><p class="metric-muted">Нулевое значение будет показано как 0. Отсутствие данных — отдельно.</p>'+(!closed&&k.state!=='draft'?btn('Добавить первое измерение','measure','primary','plus'):'')+'</div>');
 return '<div class="metric-table-panel"><table class="metric-table"><thead><tr><th>Дата измерения</th><th>Значение</th><th>Источник</th><th>Автор и комментарий</th><th>Действия</th></tr></thead><tbody>'+k.measurements.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(v=>'<tr><td data-label="Дата">'+date(v.date)+'</td><td data-label="Значение"><span class="metric-number">'+fmt(v.value)+' '+esc(m.unit)+'</span></td><td data-label="Источник">'+esc(v.source)+'</td><td data-label="Автор и комментарий">'+esc(v.author)+'<div class="metric-muted">'+esc(v.comment||'Без комментария')+'</div></td><td class="row-action">'+(!closed?btn('Исправить','correct','ghost','pencil',{'data-measurement':v.id}):'<span class="metric-muted">Итог периода</span>')+'</td></tr>').join('')+'</tbody></table></div><p class="metric-muted" style="margin-top:12px">Исправление сохраняет предыдущую редакцию и причину в истории.</p>';
}
function linkedTasks(m){return panel('Работы, влияющие на метрику','<p class="metric-muted" style="margin-bottom:16px">Выполнение задачи не изменяет факт автоматически. Связь не меняет основной проект задачи.</p><div class="metric-links">'+(m.tasks.length?m.tasks.map(t=>'<div class="metric-linked"><div><span class="metric-id">'+t.id+'</span><p><strong>'+esc(t.title)+'</strong></p></div>'+badge({label:t.status,tone:t.status==='Выполнена'?'success':'info'})+'</div>').join(''):'<p class="metric-muted">Связанных задач пока нет.</p>')+'</div>',btn('Связать задачу','link','secondary','link'));}
function history(m){return panel('История изменений','<ul class="metric-history">'+m.history.map(h=>'<li><span class="metric-muted">'+date(TODAY)+'</span><div><strong>'+esc(h.title)+'</strong><p>'+esc(h.detail)+'</p><span class="metric-muted">Анна Морозова</span></div></li>').join('')+'<li><span class="metric-muted">01.10.2026</span><div><strong>Открыт период IV квартал 2026</strong><p>Сохранены исходное значение, цель и правила измерения.</p><span class="metric-muted">Анна Морозова</span></div></li><li><span class="metric-muted">01.07.2026</span><div><strong>Создан паспорт метрики</strong><p>Назначены команда и владелец.</p></div></li></ul>');}
function log(m,title,detail){m.history.unshift({title,detail});}
function route(){const match=location.hash.match(/^#\/metrics\/(MET-\d+)(?:\?(.*))?$/);if(match){const m=metrics.find(m=>m.id===match[1]);if(m){if(!currentMetric)state.listPeriod=state.period;state.period=new URLSearchParams(match[2]).get('period')||state.period;card(m);return;}}if(currentMetric)state.period=state.listPeriod;currentMetric=null;state.tab='overview';list();}
function dialog(title,body,submitLabel,onSubmit,secondary=''){
 focusBeforeDialog=document.activeElement;
 const d=document.getElementById('editor');
 d.innerHTML='<form id="editor-form"><div class="metric-dialog-head"><h2 id="editor-title">'+esc(title)+'</h2>'+button({label:'Закрыть',icon:'x',iconOnly:true,variant:'ghost',attrs:{'data-action':'close-dialog'}})+'</div><div class="metric-dialog-body">'+body+'<div class="metric-alert" id="form-error" role="alert"></div></div><footer class="metric-dialog-foot">'+btn('Отмена','close-dialog')+secondary+button({label:submitLabel,variant:'primary',attrs:{type:'submit'}})+'</footer></form>';
 d.showModal();hydrate();
 const form=document.getElementById('editor-form');form.onsubmit=e=>{e.preventDefault();onSubmit(new FormData(form));};
 const initial=new URLSearchParams(new FormData(form)).toString();
 d.oncancel=e=>{if(new URLSearchParams(new FormData(form)).toString()!==initial&&!confirm('Отменить несохранённые изменения?'))e.preventDefault();};
 d.onclose=()=>{focusBeforeDialog?.isConnected?focusBeforeDialog.focus():document.querySelector('h1')?.focus();};
}
function closeDialog(){document.getElementById('editor').close();}
function error(message){document.getElementById('form-error').textContent=message;}
function input(name,label,value='',type='text',required=false,hint=''){return field({id:'f-'+name,label,value:value??'',type,required,hint,attrs:{name,step:type==='number'?'any':undefined}});}
function area(name,label,value='',required=false){return field({id:'f-'+name,label,value,kind:'textarea',required,attrs:{name,rows:3}});}
function choice(name,label,items,value,required=false){return field({id:'f-'+name,label,kind:'select',options:items,value,required,attrs:{name}});}
function measure(m,editId=null){
 const k=m.periods[state.period],old=k.measurements.find(v=>v.id===Number(editId));if(k.state!=='active')return;
 dialog(old?'Исправить измерение':'Добавить измерение','<p class="metric-muted">'+esc(m.title)+' · '+periods[state.period].label+'</p><div class="ui-form-grid">'+input('value','Значение, '+m.unit,old?.value??'','number',true)+input('date','Дата измерения',old?.date||TODAY,'date',true)+'</div>'+input('source','Источник / подтверждение',old?.source||m.source,'text',true)+area('comment',old?'Причина исправления':'Комментарий',old?'':old?.comment||'',!!old)+'<p class="metric-muted">Последний факт определяется датой измерения. Ноль — допустимое значение.</p>',old?'Сохранить исправление':'Добавить измерение',fd=>{
 const raw=String(fd.get('value')),value=Number(raw),d=String(fd.get('date')),source=String(fd.get('source')).trim(),comment=String(fd.get('comment')).trim();
 if(raw.trim()===''||!Number.isFinite(value))return error('Введите конечное число.');
 if(d>TODAY||d<periods[state.period].start||d>periods[state.period].end)return error('Дата должна быть в выбранном периоде и не позже 26.10.2026.');
 if(k.measurements.some(v=>v.date===d&&v.id!==old?.id))return error('На эту дату уже есть измерение. Исправьте существующее значение.');
 if(!source||old&&!comment)return error('Заполните источник и причину исправления.');
 if(old){const before=old.value;Object.assign(old,{value,date:d,source,comment});log(m,'Исправлено измерение от '+date(d),fmt(before)+' → '+fmt(value)+' '+m.unit+'. Причина: '+comment);}
 else {k.measurements.push({...measurement(value,d,comment),source});log(m,'Добавлено измерение',date(d)+': '+fmt(value)+' '+m.unit+'. '+comment);}
 closeDialog();card(m);notify('Измерение сохранено в прототипе.');
 });
}
function passport(m=null){
 dialog(m?'Паспорт метрики':'Создать метрику',input('title','Название метрики',m?.title||'','text',true)+area('description','Что измеряем',m?.description||'')+'<div class="ui-form-grid">'+choice('team','Команда',options(['Core','Delivery','Post-Trade']),m?.team||'Core',true)+choice('owner','Владелец',options(['Анна Морозова','Иван Соколов','Мария Волкова']),m?.owner||'Анна Морозова',true)+input('unit','Единица измерения',m?.unit||'%','text',true)+input('project','Проект',m?.project||'')+'</div>'+area('method','Методика расчёта',m?.method||'')+input('source','Источник данных',m?.source||'')+'<details><summary>Дополнительные атрибуты</summary><div class="ui-form-grid" style="margin-top:16px">'+input('teams','Вовлечённые команды',m?.teams||'')+choice('priority','Приоритет',options(['Низкий','Обычный','Высокий']),m?.priority||'Обычный')+input('customer','Бизнес-заказчик',m?.customer||'')+input('department','Подразделение',m?.department||'')+input('client','Клиент ДИД',m?.client||'')+input('tags','Теги',m?.tags||'')+'</div></details>'+(m?'':'<p class="metric-muted">Сначала сохраним паспорт. Затем зададим цель периода и активируем KR.</p>'),m?'Сохранить':'Создать черновик',fd=>{
 const data=Object.fromEntries(fd);if(!data.title.trim()||!data.unit.trim())return error('Название и единица измерения не могут быть пустыми.');
 if(m){if(Object.values(m.periods).some(k=>k.measurements.length)&&data.unit!==m.unit)return error('Единицу нельзя менять при наличии измерений. Создайте отдельную метрику с новой единицей.');Object.assign(m,data);log(m,'Изменён паспорт метрики','Сохранены атрибуты и методика расчёта.');}
 else{m={...data,id:'MET-'+String(metrics.length+1).padStart(3,'0'),tasks:[],notes:[],history:[],files:[],reporting:{},periods:{[state.period]:kr(null,null,[],{state:'draft',baselineDate:periods[state.period].start})}};metrics.push(m);}
 closeDialog();location.hash=metricUrl(m);card(m);notify('Паспорт сохранён. '+(m.periods[state.period].state==='draft'?'Настройте цель перед активацией.':''));
 });
}
function goal(m,isNew=false){
 const k=m.periods[state.period];
 const available=Object.keys(periods).filter(p=>!m.periods[p]);
 if(isNew&&!available.length)return notify('Для доступных периодов цели уже созданы.');
 dialog(isNew?'Новый период KR':'Настроить цель периода',
 (isNew?choice('period','Период',available.map(p=>({value:p,label:periods[p].label})),available.at(-1),true):'<p class="metric-muted">'+periods[state.period].label+' · '+esc(m.title)+'</p>')+
 '<div class="ui-form-grid">'+choice('direction','Направление цели',Object.entries(directions).map(([value,label])=>({value,label})),k.direction,true)+choice('frequency','Обновлять данные', [{value:1,label:'Ежедневно'},{value:7,label:'Еженедельно'},{value:30,label:'Каждые 30 дней'},{value:90,label:'Каждые 90 дней'}],k.frequency,true)+input('baseline','Исходное значение, '+m.unit,isNew?last(k)?.value:k.baseline,'number')+input('baselineDate','Дата исходного значения',isNew?(last(k)?.date||TODAY):k.baselineDate,'date',true)+input('target','Цель / нижняя граница, '+m.unit,isNew?'':k.target,'number',true)+'<div id="upper-field">'+input('upper','Верхняя граница, '+m.unit,k.upper,'number')+'</div>'+input('weight','Вес оценки, %',isNew?'':k.weight,'number')+input('forecast','Прогноз выполнения, %',isNew?'':k.forecast,'number')+'</div>'+(!isNew&&k.state==='active'?area('reason','Причина изменения цели','',true):'')+'<p class="metric-muted">Новый период сохраняет историю предыдущего. Исходное значение подтверждается отдельно.</p>',isNew?'Создать период':'Сохранить цель',fd=>{
 const direction=String(fd.get('direction')),baseline=fd.get('baseline')===''?null:Number(fd.get('baseline')),target=Number(fd.get('target')),upper=fd.get('upper')===''?null:Number(fd.get('upper')),key=isNew?String(fd.get('period')):state.period,baselineDate=String(fd.get('baselineDate'));
 if(!Number.isFinite(target)||direction!=='range'&&(baseline==null||!Number.isFinite(baseline)))return error('Для роста и снижения укажите исходное и целевое значения.');
 if(direction==='up'&&target<=baseline||direction==='down'&&target>=baseline)return error('Цель должна соответствовать направлению: выше базы для роста, ниже для снижения.');
 if(direction==='range'&&(upper==null||!Number.isFinite(upper)||upper<target))return error('Верхняя граница должна быть не ниже нижней.');
 if(baselineDate>TODAY)return error('Дата исходного значения не может быть в будущем.');
 if(baselineDate>periods[key].start)return error('Исходное значение должно быть зафиксировано не позже начала периода.');
 const weight=fd.get('weight')===''?null:Number(fd.get('weight')),forecast=fd.get('forecast')===''?null:Number(fd.get('forecast'));
 if([weight,forecast].some(v=>v!=null&&(!Number.isFinite(v)||v<0||v>100)))return error('Вес и прогноз должны быть от 0 до 100%.');
 const values={direction,baseline,target,upper,baselineDate,frequency:Number(fd.get('frequency')),weight,forecast};
 if(isNew){m.periods[key]={...values,state:'draft',measurements:[]};state.period=key;log(m,'Создан новый период',periods[key].label);}
 else {const previous=targetText(m,k);Object.assign(k,values);log(m,'Изменена цель периода',previous+' → '+targetText(m,k)+'. '+String(fd.get('reason')||''));}
 closeDialog();location.hash=metricUrl(m);card(m);notify('Цель периода сохранена в прототипе.');
 });
 const direction=document.getElementById('f-direction'),upper=document.getElementById('upper-field');const sync=()=>{upper.hidden=direction.value!=='range';document.getElementById('f-upper').required=direction.value==='range';};direction.onchange=sync;sync();
}
document.addEventListener('click',e=>{
 const preview=e.target.closest('[data-preview-nav]');if(preview){e.preventDefault();notify('В этом прототипе доступен раздел «Метрики».');return;}
 const open=e.target.closest('[data-open]');if(open){state.tab='overview';location.hash=metricUrl(metrics.find(m=>m.id===open.dataset.open));return;}
 const attention=e.target.closest('[data-attention]');if(attention){state.attention=state.attention===attention.dataset.attention?'':attention.dataset.attention;drawRows();return;}
 const scope=e.target.closest('[data-scope]');if(scope){state.scope=scope.dataset.scope;state.attention='';drawRows();return;}
 const a=e.target.closest('[data-action]');if(!a)return;
 const action=a.dataset.action,m=currentMetric,k=m?.periods[state.period];
 if(action==='theme'){document.documentElement.dataset.theme=document.documentElement.dataset.theme==='light'?'dark':'light';return;}
 if(action==='menu'||action==='collapse-menu'){if(innerWidth<=1000)document.querySelector('.sidebar').classList.toggle('open');else document.querySelector('.sidebar').classList.toggle('collapsed');return;}
 if(action==='close-dialog'){const d=document.getElementById('editor');const event=new Event('cancel',{cancelable:true});if(d.dispatchEvent(event))closeDialog();return;}
 if(action==='filters'){state.advanced=!state.advanced;document.getElementById('advanced').hidden=!state.advanced;a.setAttribute('aria-expanded',String(state.advanced));return;}
 if(action==='reset'){Object.assign(state,{query:'',team:'',project:'',owner:'',lifecycle:'',scope:'all',attention:''});list();return;}
 if(action==='create'){passport();return;}
 if(!m)return;
 if(action==='attach'){
 const f=document.getElementById('metric-file');f.onchange=()=>{if(f.files[0]){m.files.push({name:f.files[0].name,size:f.files[0].size});log(m,'Прикреплён файл',f.files[0].name);card(m);notify('Имя файла добавлено в прототип. Файл не отправлялся на сервер.');}};f.click();
}
 if(action==='report'){
 const meeting=a.dataset.meeting;
 dialog('Статус · '+meeting,area('status','Статус метрики для встречи',m.reporting[meeting]||'',true),'Сохранить статус',fd=>{m.reporting[meeting]=String(fd.get('status'));log(m,'Подготовлен статус',meeting);closeDialog();card(m);notify('Статус сохранён в прототипе.');});
 }
 if(action==='measure')measure(m);
 if(action==='correct')measure(m,a.dataset.measurement);
 if(action==='edit')passport(m);
 if(action==='goal')goal(m);
 if(action==='new-period')goal(m,true);
 if(action==='comment')dialog('Комментарий к метрике',area('comment','Комментарий','',true),'Добавить',fd=>{const value=String(fd.get('comment')).trim();if(!value)return error('Введите комментарий.');m.notes.push(value);closeDialog();card(m);notify('Комментарий добавлен в прототипе.');});
 if(action==='link')dialog('Связать задачу',choice('task','Доступные задачи',[{value:'WRK-142',label:'WRK-142 · Проверить качество исходных данных'},{value:'DMB-267',label:'DMB-267 · Улучшить обработку исключений'}],'WRK-142',true)+'<p class="metric-muted">Демонстрационный выбор. Основной контекст задачи сохраняется.</p>','Связать',fd=>{const id=String(fd.get('task'));if(m.tasks.some(t=>t.id===id))return error('Эта задача уже связана с метрикой.');m.tasks.push({id,title:id==='WRK-142'?'Проверить качество исходных данных':'Улучшить обработку исключений',status:'В работе'});log(m,'Связана задача',id);closeDialog();card(m);});
 if(action==='activate'){
  if(!m.method.trim()||!m.source.trim()||k.target==null||k.direction!=='range'&&k.baseline==null)return notify('Для активации заполните методику, источник, исходное значение и цель.');
  if(k.baselineDate>TODAY)return notify('Подтвердите исходное значение на фактическую дату.');k.state='active';log(m,'KR активирован',periods[state.period].label);card(m);notify('KR активирован в прототипе.');
 }
 if(action==='finish')dialog('Завершить период','<p>Будут зафиксированы цель и текущий факт. Результат: <strong>'+(!last(k)?'Нет данных':achieved(k)?'Цель достигнута':'Цель не достигнута')+'</strong>.</p>'+area('summary','Итог периода','',true),'Завершить период',fd=>{k.state='completed';log(m,'Завершён период',String(fd.get('summary')));closeDialog();card(m);});
});
window.addEventListener('hashchange',()=>{document.querySelector('.sidebar')?.classList.remove('open');route();window.scrollTo(0,0);});
window.addEventListener('resize',()=>{if(currentMetric&&state.tab==='overview')chart(currentMetric,currentMetric.periods[state.period]);});
shell();route();hydrate();
