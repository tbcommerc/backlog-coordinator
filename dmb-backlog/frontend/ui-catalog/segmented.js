import {segmentedControl,installSegmentedControls} from '../js/ui/segmented.js';
import {button} from '../js/ui/primitives.js';
const examples=[
 ['scope','Область бэклога',{size:'small',className:'ui-segmented-compact',value:'tribe',items:[{value:'team',label:'Команда'},{value:'tribe',label:'Трайб'}]}],
 ['icons','Вид реестра',{size:'small',value:'table',items:[{value:'table',label:'Таблица',icon:'table',iconOnly:true},{value:'cards',label:'Карточки',icon:'layout-grid',iconOnly:true}]}],
 ['period','Период метрик',{value:'quarter',items:[{value:'quarter',label:'За квартал'},{value:'year',label:'За год'}]}],
 ['work','Представление задач',{value:0,items:['Список','Доска','Сводка'].map((label,value)=>({value,label}))}],
 ['quarters','Квартал карточки',{value:2,items:[1,2,3,4].map(value=>({value,label:`${value} кв.`,attrs:{'aria-label':`${value} квартал`,title:`${value} квартал`}}))}],
 ['calendar','Календарь встреч',{size:'small',value:'cards',items:[{value:'cards',label:'Карточки'},{value:'timeline',label:'Хронология'}]}],
 ['chart','Режим диаграммы',{size:'small',value:'util',items:[{value:'util',label:'Утилизация'},{value:'balance',label:'Баланс'}]}],
 ['theme','Тема интерфейса',{size:'small',value:'system',items:[{value:'system',label:'Как в системе'},{value:'light',label:'Светлая'},{value:'dark',label:'Тёмная'}]}],
 ['density','Плотность',{value:'comfortable',items:[{value:'comfortable',label:'Комфортная',icon:'list'},{value:'compact',label:'Компактная',icon:'menu'}]}],
 ['activity','Вид активности',{size:'small',value:'all',items:[{value:'all',label:'Всё'},{value:'comments',label:'Комментарии'},{value:'history',label:'Изменения'}]}],
 ['count','Счётчики',{value:'all',items:[{value:'all',label:'Все',count:24},{value:'mine',label:'Мои',count:8}]}],
 ['disabled','Недоступный контрол',{disabled:true,value:'a',items:[{value:'a',label:'Команда'},{value:'b',label:'Трайб'}]}],
 ['partial','Недоступный сегмент',{value:'a',items:[{value:'a',label:'Первый'},{value:'b',label:'Второй',disabled:true},{value:'c',label:'Третий'}]}],
 ['sizes','Компактный размер',{size:'extra-small',value:'a',items:[{value:'a',label:'Команда'},{value:'b',label:'Трайб'}]}],
 ['large','Крупный размер',{size:'large',value:'a',items:[{value:'a',label:'Команда'},{value:'b',label:'Трайб'}]}],
 ['filled','Заполнение ширины',{className:'ui-segmented-fill',value:1,items:[1,2,3].map(value=>({value,label:`${value} мес.`}))}]
];
document.querySelector('#segmented-examples').innerHTML=examples.map(([id,label,opts])=>`<section class="segment-demo" data-demo="${id}"><h2>${label}</h2>${segmentedControl({...opts,label,attrs:{id:'segment-'+id}})}${id==='scope'?button({label:'Добавить задачу',size:'small',variant:'primary'}):''}</section>`).join('');
document.querySelector('#segmented-examples').addEventListener('click',event=>{
 const item=event.target.closest('.ui-segment-item');if(!item||item.disabled)return;
 const group=item.parentElement;if(group.getAttribute('aria-disabled')==='true')return;
 for(const el of group.querySelectorAll('.ui-segment-item'))el.setAttribute('aria-pressed',String(el===item));
 document.querySelector('#segmented-result').textContent=group.getAttribute('aria-label')+': '+item.getAttribute('data-segment-value');
});
document.querySelector('#catalog-theme').onclick=()=>document.documentElement.dataset.theme=document.documentElement.dataset.theme==='light'?'dark':'light';
window.disposeSegmented=installSegmentedControls();window.lucide?.createIcons();
