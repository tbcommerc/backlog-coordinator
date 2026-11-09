import { getAllColumnKeys } from './components/taskColumns.js';
const cols=new Set(getAllColumnKeys());
const quick=new Set(['_overdue','_urgent','_active','_hold','_rejected','_current','_last_quarter','_high_cv']);
const scalar=['bv','scope','q','filters','sort','cs','cd','view','page','task','tab','comment'];
export function parseBacklogRoute(hash, filterKeys=[]) {
 const [path,query='']=String(hash).replace(/^#/,'').split('?');
 const p=new URLSearchParams(query); const errors=[];
 for(const k of scalar) if(p.getAll(k).length>1) errors.push(`Параметр ${k} повторяется`);
 const scope=path==='/team-backlog'?'team':p.get('scope')||'all';
 if(!['all','team'].includes(scope)) errors.push('Неизвестная область');
 if(p.has('bv')&&p.get('bv')!=='2') errors.push('Версия адреса не поддерживается');
 const q=p.get('q')||''; if(q.length>2000) errors.push('Поиск превышает 2000 символов');
 let filters={};
 try {
  const raw=p.get('filters')||'{}'; if(new TextEncoder().encode(raw).length>16384) throw Error();
  const f=JSON.parse(raw); if(!f||Array.isArray(f)||typeof f!=='object') throw Error();
  for(const [k,v] of Object.entries(f)) {
   if(['__proto__','constructor','prototype'].includes(k)||(!quick.has(k)&&filterKeys.length&&!filterKeys.includes(k))||!Array.isArray(v)||v.length>100||v.some(x=>typeof x!=='string')) throw Error();
   if(v.length) filters[k]=[...new Set(v)];
  }
 } catch {errors.push('Некорректные фильтры в адресе');}
 const view=p.get('view')||'table'; if(!['table','cards'].includes(view)) errors.push('Неизвестное представление');
 const cs=p.get('cs'); if(cs&&!cols.has(cs)) errors.push('Неизвестная колонка сортировки');
 const cd=p.get('cd')||'asc'; if(!['asc','desc'].includes(cd)) errors.push('Некорректное направление сортировки');
 const rawPage=p.get('page')||'1'; const page=Number(rawPage);
 if(!/^[1-9]\d*$/.test(rawPage)||!Number.isSafeInteger(page)) errors.push('Некорректная страница');
 const sort=p.get('sort')||'id-desc';
 if(!['id-desc','id-asc','priority-desc','priority-asc','prog-desc','prog-asc','title-asc','title-desc','deadline-asc','deadline-desc'].includes(sort)) errors.push('Неизвестная сортировка');
 return {scope,toolbar:{search:q,sort,filters},page:{view,columnSort:{key:cs||null,dir:cd},paginationPage:Number.isSafeInteger(page)&&page>0?page:1},explicit:p.get('bv')==='2',params:p,errors};
}
export function buildBacklogHref(scope,state={},card={}) {
 const p=new URLSearchParams({bv:'2',scope}); const t=state.toolbar||{}; const v=state.page||{};
 if(t.search) p.set('q',t.search);
 if(t.sort&&t.sort!=='id-desc') p.set('sort',t.sort);
 const filters={}; for(const k of Object.keys(t.filters||{}).sort()) if(t.filters[k]?.length) filters[k]=[...new Set(t.filters[k])].sort();
 if(Object.keys(filters).length) p.set('filters',JSON.stringify(filters));
 if(v.view&&v.view!=='table') p.set('view',v.view);
 if(v.columnSort?.key){p.set('cs',v.columnSort.key);p.set('cd',v.columnSort.dir||'asc');}
 if(v.paginationPage>1) p.set('page',String(v.paginationPage));
 for(const k of ['task','tab','comment']) if(card[k]) p.set(k,String(card[k]));
 return '#/backlog?'+p.toString();
}
export function safeBacklogReturn(value,fallback='#/backlog') {
 if(typeof value!=='string'||!/^#\/backlog(?:\?|$)/.test(value)||value.length>24576) return fallback;
 return parseBacklogRoute(value).errors.length?fallback:value;
}
export function withBacklogReturn(href,current=globalThis.location?.hash) {
 const [path,query='']=href.split('?'); const p=new URLSearchParams(query);
 if(/^#\/backlog(?:\?|$)/.test(current||''))p.set('return_to',current);
 return path+'?'+p.toString();
}

export function backlogTaskHref(taskId,hash=globalThis.window?.location?.hash||globalThis.location?.hash||''){const id=Number(taskId);if(!Number.isSafeInteger(id)||id<=0)return '#/backlog';if(/^#\/(?:backlog|team-backlog)(?:\?|$)/.test(hash)){const route=parseBacklogRoute(hash);if(!route.errors.length)return buildBacklogHref(route.scope,{toolbar:route.toolbar,page:route.page},{task:id});}return '#/backlog?task='+id;}
