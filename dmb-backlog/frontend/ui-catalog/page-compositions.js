import { filterChip, field, sectionCard, descriptionList, badge, button, tabs, routeTabs, kpiCard } from '../js/ui/index.js';

document.querySelector('#catalog-main').innerHTML = `
  <section class="catalog-section catalog-section--wide"><header><h2>Подборки и основные условия</h2></header>
    <nav aria-label="Подборки">${filterChip({label:'Мне выполнить',count:8,selected:true,variant:'navigation'})}${filterChip({label:'Мне принять',count:2,variant:'navigation'})}</nav>
    <div class="ui-registry-toolbar ui-registry-fields">${field({id:'sample-status',label:'Статус:',kind:'select',className:'ui-field-inline',options:[{value:'active',label:'Активные'}]})}${field({id:'sample-sort',label:'Сортировка:',kind:'select',className:'ui-field-inline',options:[{value:'attention',label:'По вниманию'}]})}</div>
  </section>
  <section class="catalog-section"><header><h2>Карточка с общей поверхностью</h2></header>
    ${descriptionList({className:'ui-detail-summary',items:[{label:'Исполнитель',value:'Александр Константинопольский'},{label:'Срок',value:'6 ноября 2026 г.'}]})}
    ${sectionCard({title:'Результат работы',variant:'plain',content:'Шаблон согласован с участниками.'})}
    ${sectionCard({title:'Дополнительные сведения',variant:'plain',collapsible:true,open:false,content:'Стандартное управление Enter и Space.'})}
  </section>`;
document.querySelector('#catalog-main').insertAdjacentHTML('beforeend',`<section class="catalog-section"><header><h2>Узкие рабочие поверхности</h2></header><p>Статус сохраняет смысл при переносе, действие — доступное имя на телефоне.</p>${badge({label:'Пока не достигнута: ожидается подтверждение',tone:'warning',wrap:true})}${button({label:'Фильтры',icon:'sliders-horizontal',className:'ui-btn-mobile-icon'})}${tabs({id:'fit-example',label:'Разделы',variant:'fit',items:[{id:'result',label:'Показатели'},{id:'talk',label:'Обсуждение'},{id:'history',label:'История'}]})}${field({id:'fluid-example',label:'Команда',kind:'select',className:'ui-field-fluid',attrs:{'data-ui-filter-select':''},options:[{value:'a',label:'Команда развития продукта'}]})}</section>`);
window.lucide?.createIcons();
document.documentElement.dataset.ready = 'true';

document.querySelector('#catalog-main').insertAdjacentHTML('beforeend', `<section class="catalog-section catalog-section--wide"><header><h2>Маршруты и компактные показатели</h2></header>${routeTabs({label:'Разделы запросов',selected:'requests',items:[{id:'requests',label:'Запросы',href:'#/review'},{id:'requirements',label:'Редакции БТ',href:'#/review?tab=requirements'}]})}<div class="ui-summary-strip">${kpiCard({label:'Задачи · период',value:19,variant:'inline'})}${kpiCard({label:'Отклонения · весь проект',value:24,variant:'inline'})}</div><div class="ui-registry-toolbar ui-registry-search-row"><label class="ui-registry-search"><span class="sr-only">Поиск</span><input class="input ui-control" type="search" placeholder="Название или номер"></label>${button({label:'Все фильтры',icon:'sliders-horizontal'})}${button({label:'Сброс',icon:'rotate-ccw'})}</div></section>`);
window.lucide?.createIcons();
