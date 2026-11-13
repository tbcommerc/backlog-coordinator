import { getAllColumnKeys } from './components/taskColumns.js';
const clone=x=>JSON.parse(JSON.stringify(x));
const columns=getAllColumnKeys();
export const preferenceKey=id=>`dmb_backlog_workspace_v2:${id}`;
export const sessionKey=id=>`dmb_backlog_session_v2:${id}`;
const emptyContext=()=>({columns:{},views:{items:[],defaultId:null}});
export function emptyPreferences(id){return {schemaVersion:2,userId:id,revision:0,lastScope:null,contexts:{all:emptyContext(),team:emptyContext()},migration:{legacyImported:false}};}
export function normalizeColumns(raw={}) {
 const settings={}; for(const k of columns)if(typeof raw.settings?.[k]==='boolean')settings[k]=raw.settings[k]; settings.id=true;
 const order=['id',...new Set([...(Array.isArray(raw.order)?raw.order:[]),...columns].filter(k=>columns.includes(k)&&k!=='id'))];
 const widths={},fixed={}; for(const k of columns){ const w=raw.widths?.[k];if(Number.isFinite(w)&&w>=32&&w<=3000)widths[k]=w;const f=raw.fixed?.[k];if(f===true)fixed[k]=true;else if(Number.isFinite(f)&&f>=32&&f<=3000)fixed[k]=f; }
 const sort=columns.includes(raw.sort?.key)?{key:raw.sort.key,dir:raw.sort.dir==='desc'?'desc':'asc'}:{key:null,dir:'asc'};
 return {settings,order,widths,fixed,sort};
}
export function createBacklogPreferences(user,{storage=globalThis.localStorage,locks=globalThis.navigator?.locks,onWarning=()=>{}}={}) {
 const key=preferenceKey(user.id);let memory=emptyPreferences(user.id), pending=Promise.resolve(), memoryOnly=false;
 const read=()=>{if(memoryOnly)return clone(memory);try{const d=JSON.parse(storage.getItem(key)||'null');if(d?.schemaVersion>2){memoryOnly=true;onWarning('Найдена более новая версия настроек. Изменения доступны только в памяти.');return clone(memory);}if(d?.schemaVersion===2&&d.userId===user.id){if(d.contexts!=null&&(typeof d.contexts!=='object'||Array.isArray(d.contexts)))throw Error();d.contexts||={};for(const s of ['all','team']){const c=d.contexts[s]??emptyContext();if(typeof c!=='object'||Array.isArray(c))throw Error();c.columns=c.columns&&typeof c.columns==='object'?c.columns:{};c.views??={items:[],defaultId:null};if(!Array.isArray(c.views.items))throw Error();d.contexts[s]=c;}memory=d;}}catch{memoryOnly=true;onWarning('Настройки повреждены или недоступны. Изменения остаются в памяти; исходные данные сохранены.');}return clone(memory);};
 read();
 const update=mutate=>{
  pending=pending.then(async()=>{
   const work=async()=>{const d=read();await mutate(d);d.revision=(d.revision||0)+1;d.updatedAt=new Date().toISOString();memory=d;
    if(memoryOnly)return clone(d);
    if(!locks?.request){memoryOnly=true;onWarning('Блокировки браузера недоступны: настройки сохраняются только в памяти');return clone(d);}
    try{storage.setItem(key,JSON.stringify(d));const check=JSON.parse(storage.getItem(key)||'null');if(check?.revision!==d.revision)throw Error();}catch{memoryOnly=true;onWarning('Не удалось сохранить настройки; они остаются в памяти');} return clone(d);
   };
   return locks?.request?locks.request(`dmb-backlog-preferences-v2:${user.id}`,work):work();
  }).catch(e=>{onWarning(e.message||'Не удалось сохранить настройки');});return pending;
 };
 return {read,update,flush:()=>pending,context:scope=>read().contexts[scope]};
}
export function readBacklogSession(user,scope,storage=globalThis.sessionStorage){try{const d=JSON.parse(storage.getItem(sessionKey(user.id))||'{}');const v=d[scope];return scope==='team'&&v?.teamId!==user.team_id?null:v?.state||null;}catch{return null;}}
export function writeBacklogSession(user,scope,state,storage=globalThis.sessionStorage){try{const d=JSON.parse(storage.getItem(sessionKey(user.id))||'{}');d[scope]={teamId:user.team_id,state};storage.setItem(sessionKey(user.id),JSON.stringify(d));}catch{}}
export const LEGACY_CLAIM='dmb_backlog_legacy_claim_v2';
export function legacySources(storage=globalThis.localStorage){const result={};for(const s of ['backlog','team'])for(const prefix of ['dmb_saved_views_v1_','dmb_pinned_filters_v1_']){try{const v=storage.getItem(prefix+s);if(v!=null)result[prefix+s]=v;}catch{}}for(const k of ['dmb_backlog_columns_v1','dmb_team_columns_v1']){try{const v=storage.getItem(k);if(v!=null)result[k]=v;}catch{}}return result;}
export async function importLegacyPreferences(repo,user,{storage=globalThis.localStorage,locks=globalThis.navigator?.locks,allowClaim=false}={}) {
 if(!locks?.request)throw new Error('Перенос недоступен без блокировок браузера. Исходные настройки сохранены.');
 const errors=[]; const sources=legacySources(storage); const parse=k=>{try{return JSON.parse(sources[k]||'null');}catch{errors.push(k);return null;}};
 const work=async()=>{
  const existingClaim=JSON.parse(storage.getItem(LEGACY_CLAIM)||'null');if(existingClaim&&existingClaim.userId!==user.id&&!allowClaim)throw new Error('Прежние настройки уже связаны с другой учётной записью');
  await repo.update(d=>{for(const scope of ['all','team']){
   const old=scope==='all'?'backlog':'team';const c=d.contexts[scope];
   const raw=parse(scope==='all'?'dmb_backlog_columns_v1':'dmb_team_columns_v1');if(raw&&!c.legacyColumnsImported){const imported=normalizeColumns(raw);if(Object.keys(c.columns||{}).length&&c.columnSource!=='defaults'){c.views||={items:[],defaultId:null};const id=`legacy:columns:${scope}`;if(!c.views.items.some(v=>v.id===id))c.views.items.push({id,name:'Прежние колонки',state:{toolbar:{},page:{columns:imported.settings,columnOrder:imported.order,widths:imported.widths,fixed:imported.fixed,columnSort:imported.sort}}});}else{c.columns=imported;c.columnSource='legacy';}c.legacyColumnsImported=true;}
   const pinned=parse('dmb_pinned_filters_v1_'+old);if(Array.isArray(pinned)&&c.pinnedFilters==null)c.pinnedFilters=[...new Set(pinned.filter(x=>typeof x==='string'))].slice(0,5);
   const views=parse('dmb_saved_views_v1_'+old);c.views||={items:[],defaultId:null};
   for(const v of (Array.isArray(views?.items)?views.items:[])){if(!v?.id||typeof v.name!=='string'||!v.state||typeof v.state!=='object'){errors.push('invalid saved view');continue;}const toolbar=v.state.toolbar||{};const invalidFilter=Object.entries(toolbar.filters||{}).some(([k,values])=>['__proto__','constructor','prototype'].includes(k)||!Array.isArray(values)||values.length>100||values.some(x=>typeof x!=='string'));if(invalidFilter||(toolbar.search!=null&&typeof toolbar.search!=='string')){errors.push('invalid view filters');continue;}const id=`legacy:${old}:${v.id}`;if(!c.views.items.some(x=>x.id===id)){const page=v.state.page||{};const normalized=normalizeColumns({settings:page.columns,order:page.columnOrder,widths:page.widths,fixed:page.fixed,sort:page.columnSort});c.views.items.push({...v,id,name:v.name.slice(0,80),state:{toolbar:v.state.toolbar||{},page:{view:page.view==='cards'?'cards':'table',columns:normalized.settings,columnOrder:normalized.order,widths:normalized.widths,fixed:normalized.fixed,columnSort:normalized.sort}}});}}
   if(!c.views.defaultId&&views?.defaultId&&c.views.items.some(x=>x.id===`legacy:${old}:${views.defaultId}`))c.views.defaultId=`legacy:${old}:${views.defaultId}`;
   if(scope==='team')c.teamId=user.team_id;
  }d.migration={legacyImported:true,importedAt:new Date().toISOString(),sources:Object.keys(sources)};});
  if(locks?.request){const d=JSON.parse(storage.getItem(preferenceKey(user.id))||'null');if(!d?.migration?.legacyImported)throw new Error('Не удалось сохранить перенос. Исходные настройки не изменены.');storage.setItem(LEGACY_CLAIM,JSON.stringify({userId:user.id,sources:Object.keys(sources)}));if(JSON.parse(storage.getItem(LEGACY_CLAIM)||'null')?.userId!==user.id)throw new Error('Не удалось подтвердить владельца переноса. Исходные настройки сохранены.');}
 };
 if(locks?.request)await locks.request('dmb-backlog-legacy-claim-v2',work);else await work();
 return errors;
}
