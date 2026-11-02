import { bindPopover, bindActionMenu, bindTooltip, selectionList, filterSelectionList } from '../js/ui/index.js';
import { alert, radioGroup, pagination, kpiCard, collapseSection } from '../js/ui/index.js';
import { button, control, checkbox, toggleSwitch, field, badge, avatar, tag, progress, filterChip, tabs, mountTabs, renderViewState, confirmAction, showToast, initModalAccessibility, setButtonBusy } from '../js/ui/index.js';
import { renderAgentV2 } from '../js/agent-v2/workspace.js?v=10';
import { renderComments } from '../js/components/taskComments.js?v=4';
import { renderAttachments } from '../js/components/taskAttachments.js?v=3';
import { readOnlyField, descriptionList, bindReadOnlyFields, sectionCard, detailPanel, bindDetailPanel } from '../js/ui/index.js';
import { dataTable, tableCell, bindDataTable } from '../js/ui/index.js';
import { entityPicker, bindEntityPicker } from '../js/ui/index.js';
import { dateRange, numberRange, validateRanges, showFormErrors, clearFormErrors } from '../js/ui/index.js';
import { stepForm, bindStepForm, splitPane, bindSplitPane } from '../js/ui/index.js';

const section = (id, title, hint, content, wide = false) => `<section class="catalog-section${wide ? ' catalog-section--wide' : ''}" id="${id}"><header><h2>${title}</h2><span>${hint}</span></header>${content}</section>`;
const accents = [['indigo','Индиго'],['emerald','Изумрудный'],['amber','Янтарный'],['rose','Розовый'],['sky','Голубой'],['violet','Фиолетовый'],['cyan','Бирюзовый'],['orange','Оранжевый'],['teal','Морская волна'],['purple','Пурпурный']];
document.getElementById('catalog-controls').innerHTML =
  field({ id:'kit-theme', label:'Тема', kind:'select', value:'light', options:[{value:'light',label:'Светлая'},{value:'dark',label:'Тёмная'}] }) +
  field({ id:'kit-density', label:'Плотность', kind:'select', value:'false', options:[{value:'false',label:'Комфортная'},{value:'true',label:'Компактная'}] }) +
  field({ id:'kit-accent', label:'Акцент', kind:'select', value:'indigo', options:accents.map(([value,label])=>({value,label})) });

document.getElementById('catalog-main').innerHTML = [
  section('workflow-components','Шаги и разделённая область','StepForm · SplitPane',`<form id="demo-step-form">${stepForm({id:'demo-steps',navigation:true,steps:[{id:'details',label:'Описание',content:field({id:'demo-step-name',label:'Название',required:true,attrs:{name:'title'}})+button({label:'Далее',attrs:{'data-step-next':true}})},{id:'review',label:'Проверка',content:'<p>Данные первого шага сохраняются при возврате.</p>'+button({label:'Назад',attrs:{'data-step-back':true}})+button({label:'Завершить пример',attrs:{type:'submit'}})}]})}<p id="demo-step-result" role="status"></p></form>${splitPane({id:'demo-split',label:'Ширина области деталей',primary:'<p>Список записей</p>',secondary:'<p>Детали выбранной записи</p><p>Разделитель работает мышью и стрелками. Home/End задают границы.</p>'})}`,true),
  section('intervals','Диапазоны','DateRange · NumberRange',`<form id="demo-intervals" class="catalog-stack">${dateRange({id:'demo-dates',label:'Период',required:true,from:{name:'from',value:'2026-10-01'},to:{name:'to',value:'2026-12-31'}})}${numberRange({id:'demo-numbers',label:'Допустимые значения',from:{name:'min',value:0},to:{name:'max',value:100},hint:'Ноль и равные границы допустимы.'})}${button({label:'Проверить диапазоны',attrs:{type:'submit'}})}<span id="demo-interval-result" role="status"></span></form>`),
  section('entity-pickers','Выбор сущности','EntityPicker · серверный или локальный поиск',entityPicker({id:'demo-entity',name:'task_id',label:'Задача',searchLabel:'Поиск задачи',required:true,hint:'Найдите задачу по коду или названию и выберите её из списка.'})),
  section('data-tables','Таблицы данных','DataTable · TableCell', '<div id="demo-data-table"></div>', true),
  section('detail-components','Карточки сущностей','ReadOnlyField · SectionCard · DetailPanel',
    '<div class="catalog-stack">' + sectionCard({title:'Паспорт',content:descriptionList({items:[{label:'Название',value:'Подготовить запуск продукта'},{label:'Код',value:'WRK-42',copy:true},{label:'Оценка',value:0},{label:'Владелец',value:null},{label:'Связанный проект',value:'Запуск продукта',href:'https://example.org/project'}]})}) +
    sectionCard({title:'Дополнительные сведения',collapsible:true,open:false,content:'Подробности доступны по Enter или Space.'}) +
    readOnlyField({label:'Расчёт',state:'loading'}) + readOnlyField({label:'Последнее обновление',state:'error'}) +
    button({label:'Открыть панель деталей',attrs:{id:'demo-detail-panel'}}) + '</div>'),
  section('registry-composition','Реестры','KpiCard · CollapseSection · FilterChip', kpiCard({label:'Активные задачи',value:12}) + collapseSection({label:'Дополнительные условия',content:filterChip({label:'В работе',count:12,selected:true})+filterChip({label:'Все категории',count:null})})),
  section('alerts','Сообщения','Alert · все тона', ['neutral','info','success','warning','danger'].map(tone=>alert({title:tone,message:'Сообщение с безопасным текстовым содержимым.',tone})).join('')),
  section('choices','Выбор и страницы','RadioGroup · Pagination', radioGroup({id:'demo-radio',label:'Плотность списка',value:'normal',options:[{value:'normal',label:'Обычная'},{value:'compact',label:'Компактная'}]}) + pagination({page:2,pages:5})),
  section('vertical-tabs','Вертикальные вкладки','Стрелки вверх/вниз, Home/End', tabs({id:'vertical',label:'Вертикальные вкладки',orientation:'vertical',items:[{id:'one',label:'Первая'},{id:'two',label:'Вторая'}]})+'<div id="vertical-one-panel" role="tabpanel" aria-labelledby="vertical-one-tab">Первая панель</div><div id="vertical-two-panel" role="tabpanel" aria-labelledby="vertical-two-tab" hidden>Вторая панель</div>'),
  section('popover-widths','Ширина панелей','Small · Default · Wide', ['small','default','wide'].map(width=>button({label:width,attrs:{'data-width-demo':width}})+`<div id="width-${width}" hidden>Панель ${width}; ширина ограничивается окном.</div>`).join('')),
  section('ai-actions','Вызов агентов','Button · ai / ai-primary',
    `<div class="catalog-row">${button({label:'AI-расчёт',variant:'ai'})}${button({label:'AI-анализ',variant:'ai-primary'})}${button({label:'AI-расчёт недоступен',variant:'ai',attrs:{disabled:true,title:'Заполните обязательные поля'}})}</div><div class="catalog-row">${button({label:'Анализируем…',variant:'ai',attrs:{'aria-busy':true,disabled:true}})}${button({label:'Проверить черновик',variant:'ai',size:'small'})}</div><p class="catalog-caption">Мягкий фиолетовый акцент — стандарт вызова агента; сплошная заливка — главное AI-действие экрана. Иконка искр обязательна. Сохранение и отправка на согласование используют обычные кнопки.</p>`),
  section('actions','Действия','Button · IconButton',
    `<div class="catalog-row">${button({label:'Создать задачу',icon:'plus',variant:'primary',attrs:{id:'sample-primary'}})}${button({label:'Сохранить',icon:'check'})}${button({label:'Отмена',variant:'ghost'})}</div><div class="catalog-row">${button({label:'Удалить',variant:'danger',size:'small'})}${button({label:'Готово',variant:'success',size:'small'})}${button({label:'Обновить',icon:'refresh-cw',iconOnly:true,size:'small'})}${button({label:'Недоступно',attrs:{disabled:true}})}</div><p class="catalog-caption">Одна иерархия действий. Предсказуемые размеры и видимый фокус.</p><div class="catalog-row">${button({label:'Проверить ожидание',attrs:{id:'demo-busy'}})}<span class="catalog-inline-status" id="busy-result" role="status"></span></div>`),
  section('forms','Поля формы','Field · Validation',
    `<form class="catalog-form" id="demo-form">${field({id:'sample-name',label:'Название задачи',value:'Обновление клиентского пути',required:true,hint:'Кратко опишите ожидаемый результат.'})}${field({id:'sample-owner',label:'Исполнитель',kind:'select',options:[{value:'',label:'Не выбран'},{value:'analyst',label:'Аналитик команды'}],error:'Выберите исполнителя перед сохранением.'})}${checkbox({id:'sample-visible',label:'Показывать в реестре',checked:true})}${button({label:'Проверить форму',variant:'primary',attrs:{type:'submit'}})}<span class="catalog-inline-status" id="form-result" role="status"></span></form>`),
  section('info-chips','Информационные чипсы','Единый стиль · проверено 26.10.2026',
    `<div class="catalog-row">${badge({label:'Бэклог'})}${badge({label:'В работе',tone:'info'})}${badge({label:'Готово',tone:'success',icon:'check'})}${badge({label:'На проверке',tone:'warning'})}${badge({label:'Высокий',tone:'danger',icon:'arrow-up'})}${badge({label:'Приостановлено',tone:'accent'})}</div><div class="catalog-row">${tag({label:'Платформа',color:'#6366f1'})}${tag({label:'Внутренняя задача'})}${badge({label:'27 окт. · завтра',tone:'warning',icon:'calendar-clock'})}<span class="notification-deadline-badge is-danger"><i data-lucide="calendar-clock" aria-hidden="true"></i><span>Срок 25 окт.</span><strong>Просрочено на 1 день</strong></span></div><p class="catalog-caption">24 px минимум · Inter 12/18, 500 · скругление 6 px · отступы 3×8 px · без рамок и теней. Текст всегда в одну строку; контейнер прокручивается или показывает полную подпись отдельно. Цвет справочника — точка; смысловые иконки — 14 px.</p>`),
  section('statuses','Статусы и фильтры','Badge · FilterChip',
    `<div class="catalog-row">${badge({label:'На ревью',tone:'info'})}${badge({label:'Требует внимания',tone:'warning'})}${badge({label:'Завершено',tone:'success'})}${badge({label:'Ошибка',tone:'danger'})}</div><p class="catalog-caption">Статус выражается текстом и цветом. Фильтр показывает выбор и количество.</p><div class="catalog-filters">${filterChip({label:'Все задачи',icon:'layout-list',count:24,selected:true,attrs:{'data-demo-filter':'all'}})}${filterChip({label:'Требуют внимания',icon:'circle-alert',tone:'warning',count:3,attrs:{'data-demo-filter':'attention'}})}</div>`),
  section('navigation','Вкладки и диалоги','Tabs · Dialog',
    `${tabs({id:'sample',label:'Пример вкладок',items:[{id:'main',label:'Основное'},{id:'history',label:'История'}]})}<div class="catalog-panel" id="sample-main-panel" role="tabpanel" aria-labelledby="sample-main-tab" tabindex="0"><p>Общие правила навигации с клавиатуры и сохранения контекста.</p><div class="catalog-row">${button({label:'Открыть подтверждение',attrs:{id:'demo-dialog'}})}${button({label:'Показать уведомление',variant:'ghost',attrs:{id:'demo-toast'}})}</div></div><div class="catalog-panel" id="sample-history-panel" role="tabpanel" aria-labelledby="sample-history-tab" tabindex="0" hidden><p>История изменений остаётся частью карточки.</p></div><p class="catalog-inline-status" id="dialog-result" role="status"></p>`),
  section('sizes','Размеры и плотность','Одна шкала для кнопок, иконок и полей',
    [['extra-small','В строках · 24 px'],['small','Компактный · 28 px'],['default','Обычный · 32 px'],['large','Крупный · 40 px']].map(([size,label])=>`<div class="catalog-size-row"><strong>${label}</strong>${button({label:'Действие',icon:'check',size})}${button({label:`Обновить: ${label}`,icon:'refresh-cw',iconOnly:true,size})}${control({size,value:'Значение поля',attrs:{'aria-label':`Поле: ${label}`}})}</div>`).join('')+'<p class="catalog-caption">Плотный режим: обычный размер 28 px, крупный — 36 px. На телефоне и при сенсорном вводе область нажатия не меньше 44 px. Кнопки с одной иконкой всегда квадратные.</p>',true),
  section('toggle-actions','Фильтры без счётчика','Button · aria-pressed',
    `<div class="catalog-row" role="group" aria-label="Пример фильтров">${button({label:'Требуют действия',icon:'check-circle',size:'small',attrs:{'aria-pressed':true,'data-demo-toggle':true}})}${button({label:'Непрочитанные',icon:'mail',size:'small',attrs:{'aria-pressed':false,'data-demo-toggle':true}})}${button({label:'Недоступный фильтр',size:'small',attrs:{'aria-pressed':false,disabled:true}})}</div><p class="catalog-caption">Выбор отражён цветом и aria-pressed. Размер и фокус совпадают с обычной кнопкой. Enter и пробел переключают фильтр.</p>`),
  section('switches','Переключатели','Switch · Автоматическое применение',
    `<div class="catalog-form">${toggleSwitch({id:'demo-switch',label:'Комментарии команды',description:'Изменение применяется сразу.',checked:true})}${toggleSwitch({id:'demo-switch-off',label:'Показывать подсказки'})}${toggleSwitch({id:'demo-switch-disabled',label:'Управляется организацией',checked:true,disabled:true})}${toggleSwitch({id:'demo-switch-busy',label:'Сохраняем изменения…',checked:true,disabled:true,attrs:{'aria-busy':true}})}<span class="catalog-inline-status" id="switch-result" role="status"></span></div>`),
  section('data-display','Данные и участники','Avatar · Tag · Progress',
    `<div class="catalog-row">${[20,24,32,40,48].map(size=>avatar({name:'Анна Смирнова',size})).join('')}${tag({label:'Клиентский путь',color:'#10b981'})}${tag({label:'Длинная метка предметной области'})}</div><div class="catalog-form">${progress({value:65,showValue:true,label:'Готовность задачи'})}${progress({value:100,showValue:true,tone:'success',label:'Завершённая задача'})}${progress({showValue:true,label:'Прогресс без данных'})}</div>`),
  section('action-recipes','Действия в содержимом','Link · Surface action',
    `<div class="catalog-form"><button type="button" class="ui-link" data-demo-content-action>Открыть связанную задачу</button><button type="button" class="ui-surface-action ui-panel" data-demo-content-action>Карточка с длинным содержимым сохраняет собственную компоновку и общую область нажатия.</button><span id="content-action-result" role="status"></span></div>`),
  section('collaboration','Комментарии и вложения','Реальные компоненты карточки задачи',
    '<div id="catalog-comments"></div><div id="catalog-attachments"></div><p id="collaboration-result" role="status" class="catalog-caption"></p>',true),
  section('registry','Плотный реестр','Table · Семантика данных',
    `<div class="ui-table-scroll"><table class="ui-table ui-table-data"><thead><tr><th scope="col">Задача</th><th scope="col">Статус</th><th scope="col">Исполнитель</th><th scope="col">Прогресс</th></tr></thead><tbody><tr><td>Обновление клиентского пути</td><td>${badge({label:'В работе',tone:'info'})}</td><td>Команда продукта</td><td>65%</td></tr><tr><td>Автоматизация отчётности</td><td>${badge({label:'На ревью',tone:'warning'})}</td><td>Аналитик</td><td>20%</td></tr><tr><td>Проверка интеграции</td><td>${badge({label:'Завершено',tone:'success'})}</td><td>Команда платформы</td><td>100%</td></tr></tbody></table></div>`, true),
  section('states','Состояния страницы','ViewState',
    `<div class="catalog-states">${renderViewState({kind:'loading',title:'Загружаем задачи…'})}${renderViewState({kind:'empty',title:'Ничего не найдено',message:'Измените поиск или сбросьте фильтры.',actionLabel:'Сбросить фильтры'})}${renderViewState({kind:'error',title:'Не удалось загрузить',message:'Ваши изменения сохранены в черновике.',actionLabel:'Повторить'})}</div>`,true),
  section('composites','Выпадающие панели','Popover · SelectionList · ActionMenu · Tooltip',
    `<div class="catalog-row">${button({label:'Выбор значений',attrs:{id:'demo-selection-trigger'}})}${button({label:'Действия',attrs:{id:'demo-menu-trigger'}})}${button({label:'Описание',attrs:{id:'demo-tooltip-trigger'}})}</div>
    <div id="demo-selection-panel" hidden><div class="ui-popover-header"><strong>Фильтр</strong></div>${control({type:'search',attrs:{'aria-label':'Поиск значения',id:'demo-selection-search'}})}${selectionList({items:[{value:'one',label:'Длинное название команды для проверки переноса текста на узком экране'},{value:'two',label:'Команда продукта'},{value:'three',label:'Недоступное значение',disabled:true}],selected:['two']})}</div>
    <div id="demo-menu-panel" hidden>${button({label:'Открыть',attrs:{'data-demo-menu':'open'}})}${button({label:'Недоступное действие',attrs:{disabled:true}})}${button({label:'Скопировать ссылку',attrs:{'data-demo-menu':'copy'}})}</div>
    <div id="demo-tooltip-panel" hidden>Escape закрывает подсказку. Она также доступна при фокусе с клавиатуры.</div><p class="catalog-caption" id="demo-menu-result" role="status">Стрелки/Home/End перемещают фокус, Escape возвращает его на кнопку.</p>`),
  section('table-variants','Варианты таблиц','Общий контракт · Плотность и назначение',
    '<div class="ui-table-scroll ui-table-surface"><table class="ui-table ui-table-editor"><thead><tr><th>Компетенция</th><th>Оценка, ч/д</th></tr></thead><tbody><tr><td>Аналитика</td><td>' + control({id:'catalog-table-estimate',type:'number',value:5,size:'extra-small',attrs:{'aria-label':'Оценка аналитики',min:0},className:'ui-number-cell'}) + '</td></tr></tbody></table></div><p class="catalog-caption">Редактор использует компактные отступы; заголовки совпадают с реестрами.</p><div class="ui-table-scroll"><table class="ui-table ui-table-prose"><thead><tr><th>Вопрос</th><th>Ответ</th></tr></thead><tbody><tr><td>Что изменилось?</td><td>Таблица в тексте сохраняет обычный регистр заголовков.</td></tr></tbody></table></div>'),
  section('assistant','Рабочая область ассистента','Общая тема · Реальный компонент',renderAgentV2({}),true),
].join('');

const demoSteps=bindStepForm(document.getElementById('demo-steps'));
document.getElementById('demo-step-form').addEventListener('submit',event=>{event.preventDefault();document.getElementById('demo-step-result').textContent='Пример завершён. Данные не отправлены.';});
const demoSplit=bindSplitPane(document.getElementById('demo-split'),{size:300,min:180,max:500,minPrimary:200,breakpoint:600});
window.addEventListener('pagehide',()=>{demoSteps.destroy();demoSplit.destroy();},{once:true});

document.getElementById('demo-intervals').addEventListener('submit',event=>{
  event.preventDefault();clearFormErrors(event.target);
  const errors=validateRanges(event.target);
  document.getElementById('demo-interval-result').textContent=Object.keys(errors).length?'':'Диапазоны корректны';
  if(Object.keys(errors).length)showFormErrors(event.target,errors);
});

const demoEntityPicker = bindEntityPicker(document.getElementById('demo-entity-picker'),{load:async query=>[
  {value:'1',label:'WRK-1 · Проверить расчёт показателя'},
  {value:'2',label:'WRK-2 · Согласовать критерии приёмки'},
].filter(item=>item.label.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')))});
demoEntityPicker.refresh();
window.addEventListener('pagehide',()=>demoEntityPicker.destroy(),{once:true});

const tableDemo = document.getElementById('demo-data-table');
const demoRows = [{title:'Качество данных',value:0,date:'2026-10-29',state:'В работе'}, {title:'Скорость обработки',value:1250.5,date:null,state:'Черновик'}];
function renderTableDemo(sort = {key:'title',direction:'asc'}) {
  const rows = [...demoRows].sort((a,b)=>(sort.key==='value' ? a.value-b.value : a.title.localeCompare(b.title,'ru'))*(sort.direction==='desc'?-1:1));
  tableDemo.innerHTML = dataTable({label:'Пример показателей',rows,sort,responsive:'cards',className:'ui-table-surface',columns:[
    {key:'title',label:'Показатель',sortable:true},
    {key:'value',label:'Значение',type:'number',sortable:true},
    {key:'date',label:'Дата',type:'date'},
    {key:'state',label:'Состояние',render:row=>tableCell({value:row.state,type:'badge',tone:row.state==='В работе'?'info':'neutral'})},
  ]});
}
renderTableDemo();
const disposeTableDemo = bindDataTable(tableDemo, {onSort:(sort)=>{renderTableDemo(sort);tableDemo.querySelector(`[data-ui-sort="${sort.key}"]`)?.focus();}});
window.addEventListener('pagehide',disposeTableDemo,{once:true});

renderComments(document.getElementById('catalog-comments'), [{id:1,user_name:'Анна Смирнова',text:'Проверим расчёт и приложенную схему.',created_at:'2026-09-01T10:00:00Z',replies:[]}], []);
renderAttachments(document.getElementById('catalog-attachments'), [{id:1,task_id:1,original_name:'Схема клиентского пути.pdf',mime_type:'application/pdf',file_size:2048}]);
window.__setReplyTo=()=>{document.getElementById('collaboration-result').textContent='Выбран ответ на комментарий. Пример не отправляет данные.';};
window.__downloadAttachment=()=>{document.getElementById('collaboration-result').textContent='Выбрано скачивание. В каталоге используется демонстрационный файл.';};
window.__deleteAttachment=()=>{document.getElementById('collaboration-result').textContent='Выбрано удаление. Демонстрационный файл сохранён.';};
document.querySelectorAll('[data-demo-content-action]').forEach(control=>control.addEventListener('click',()=>{document.getElementById('content-action-result').textContent='Действие доступно с клавиатуры и мышью.';}));

for (const [id, attribute] of [['kit-theme','theme'],['kit-density','compact'],['kit-accent','accent']]) {
  document.getElementById(id).addEventListener('change',event=>{ document.documentElement.dataset[attribute]=event.target.value; });
}
const tabCleanups = [...document.querySelectorAll('.ui-tabs')].map(root => mountTabs(root));
const widthPopovers = [...document.querySelectorAll('[data-width-demo]')].map(trigger=>bindPopover({trigger,panel:document.getElementById(`width-${trigger.dataset.widthDemo}`),width:trigger.dataset.widthDemo,label:`Панель ${trigger.dataset.widthDemo}`}));
const cleanupTabs = () => { tabCleanups.forEach(cleanup=>cleanup()); widthPopovers.forEach(popover=>popover.destroy()); };
const cleanupDialogs = initModalAccessibility();
window.addEventListener('pagehide',()=>{cleanupTabs();cleanupDialogs();},{once:true});
document.getElementById('demo-dialog').addEventListener('click', async () => {
  const confirmed = await confirmAction({title:'Сохранить изменения?',message:'Это демонстрация компонента. Данные приложения не изменятся.',confirmText:'Сохранить',cancelText:'Отмена'});
  document.getElementById('dialog-result').textContent=confirmed?'Изменения подтверждены':'Действие отменено';
});
document.getElementById('demo-toast').addEventListener('click',()=>showToast('Изменения сохранены'));
document.getElementById('demo-busy').addEventListener('click',event=>{
  const control=event.currentTarget;
  setButtonBusy(control,true,'Сохраняем…');
  window.setTimeout(()=>{setButtonBusy(control,false);document.getElementById('busy-result').textContent='Готово';},800);
});
document.getElementById('demo-switch').addEventListener('change',event=>{
  const control=event.currentTarget;
  control.disabled=true; control.setAttribute('aria-busy','true');
  window.setTimeout(()=>{
    control.disabled=false; control.removeAttribute('aria-busy');
    document.getElementById('switch-result').textContent=control.checked?'Комментарии включены':'Комментарии выключены';
  },800);
});
document.getElementById('demo-form').addEventListener('submit',event=>{
  event.preventDefault();
  const owner=document.getElementById('sample-owner');
  const error=document.getElementById('sample-owner-error');
  if(!owner.value){owner.setAttribute('aria-invalid','true');error.hidden=false;owner.focus();return;}
  owner.removeAttribute('aria-invalid');owner.removeAttribute('aria-describedby');error.hidden=true;
  document.getElementById('form-result').textContent='Форма заполнена. Данные никуда не отправлены.';
});
document.querySelectorAll('[data-demo-filter]').forEach(control=>control.addEventListener('click',()=>{
  document.querySelectorAll('[data-demo-filter]').forEach(item=>{const active=item===control;item.setAttribute('aria-pressed',String(active));item.classList.toggle('active',active);});
}));
document.querySelectorAll('[data-demo-toggle]').forEach(control=>control.addEventListener('click',()=>{
  control.setAttribute('aria-pressed',String(control.getAttribute('aria-pressed') !== 'true'));
}));
window.lucide?.createIcons();
document.documentElement.dataset.ready='true';
bindReadOnlyFields(document.getElementById('detail-components'));
document.getElementById('demo-detail-panel').addEventListener('click', () => {
  const host = document.createElement('div');
  host.innerHTML = detailPanel({id:'catalog-detail',title:'Рабочая задача',body:sectionCard({title:'Ожидаемый результат',content:readOnlyField({label:'Описание',value:'Согласовать сценарии и подготовить запуск.'})}),footer:'Пример общей панели деталей'});
  bindDetailPanel(host.firstElementChild).present();
});

bindPopover({trigger:document.getElementById('demo-selection-trigger'),panel:document.getElementById('demo-selection-panel'),label:'Фильтр'});
bindActionMenu({trigger:document.getElementById('demo-menu-trigger'),panel:document.getElementById('demo-menu-panel')});
bindTooltip({trigger:document.getElementById('demo-tooltip-trigger'),panel:document.getElementById('demo-tooltip-panel')});
document.getElementById('demo-selection-search').addEventListener('input',event=>filterSelectionList(document.querySelector('#demo-selection-panel .ui-selection-list'),event.target.value));
document.querySelectorAll('[data-demo-menu]').forEach(button=>button.addEventListener('click',()=>{document.getElementById('demo-menu-result').textContent='Выбрано: '+button.textContent;}));
