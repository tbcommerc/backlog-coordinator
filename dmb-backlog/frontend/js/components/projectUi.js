import { field, button } from '../ui/primitives.js';
import { escapeHtml as esc } from '../htmlUtils.js';

export const projectSections = [{id:'about',label:'Обзор'},{id:'backlog',label:'План'},{id:'gantt',label:'Гант и вехи'},{id:'deviations',label:'Отклонения'},{id:'results',label:'Результаты'},{id:'execution',label:'Рабочие задачи'}];
export const periodLabel = (year, quarter) => quarter ? `${quarter} квартал ${year}` : `${year} год`;
export function periodFields(year, quarter) {
    return field({id:'project-year',label:'Год',type:'number',value:year,attrs:{min:2000,max:2099,required:true}})+field({id:'project-quarter',label:'Период',kind:'select',value:quarter,options:[{value:0,label:'Весь год'},...[1,2,3,4].map(q=>({value:q,label:q+' квартал'}))]});
}
export function periodLinks(year, quarter, href) {
    const step = offset => {const index=year*4+(quarter||1)-1+offset;return {year:Math.floor(index/4),quarter:index%4+1,pg:null,rp:null,bucket:null};};
    const now=new Date();const y=Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Moscow',year:'numeric'}).format(now));const q=Math.ceil(Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Moscow',month:'numeric'}).format(now))/3);
    return `<nav class="project-period-nav" aria-label="Смена периода">${year>2000||quarter>1?`<a class="ui-nav-action" href="${esc(href(step(-1)))}" aria-label="Предыдущий квартал">Предыдущий</a>`:''}<a class="ui-nav-action" href="${esc(href({year:y,quarter:q,pg:null,rp:null,bucket:null}))}">Текущий</a>${year<2099||quarter<4?`<a class="ui-nav-action" href="${esc(href(step(1)))}" aria-label="Следующий квартал">Следующий</a>`:''}</nav>`;
}
export const applyControls = () => `<div class="project-filter-actions">${button({label:'Применить',attrs:{type:'submit',id:'project-apply'}})}<span class="project-filter-draft" role="status" aria-live="polite"></span></div>`;
export function markDraft(form) {form.addEventListener('input',()=>{form.querySelector('.project-filter-draft').textContent='Есть неприменённые изменения';});}
export const projectEmpty = (title,message,action='') => `<div class="project-empty" role="status"><strong>${esc(title)}</strong>${message?`<p>${esc(message)}</p>`:''}${action}</div>`;

export function compactPeriod(host, label) {
 const toolbar=host.querySelector('.project-period-toolbar');if(!toolbar)return;
 const wrapper=document.createElement('details');wrapper.className='project-period-disclosure';
 const summary=document.createElement('summary');summary.className='ui-disclosure-text';summary.textContent='Период: '+label;
 toolbar.before(wrapper);wrapper.append(summary,toolbar);
 const media=matchMedia('(max-width:700px)');wrapper.open=!media.matches;
 const adapt=()=>{if(!host.isConnected){media.removeEventListener('change',adapt);return;}wrapper.open=!media.matches;};media.addEventListener('change',adapt);
}
