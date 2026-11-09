import { buildBacklogHref } from './backlogRouteState.js';
const DMB = new Set(['read', 'read_write']);
const TEAM = new Set(['read_own', 'write_own', 'read_all', 'write_all']);
export function hasTeamBacklogAccess(user) { return !!user && user.permissions?.customer_portal_mode !== 'only' && TEAM.has(user.permissions?.backlog_team); }
export function backlogContexts(user) {
 if (!user || user.permissions?.customer_portal_mode === 'only') return [];
 const scopes=[];
 if(hasTeamBacklogAccess(user) && Number.isSafeInteger(Number(user.team_id)) && Number(user.team_id)>0) scopes.push('team');
 if(DMB.has(user.permissions?.backlog_dmb)) scopes.push('all');
 return scopes;
}
export function defaultBacklogContext(user,last) {
 const scopes=backlogContexts(user);
 if(scopes.includes(last)) return last;
 if(scopes.includes('team') && (user.permissions?.task_edit==='team'||!scopes.includes('all'))) return 'team';
 return scopes.includes('all')?'all':scopes[0]||null;
}
export function backlogMenuHref(user) {
 let doc={};try{doc=JSON.parse(localStorage.getItem(`dmb_backlog_workspace_v2:${user?.id}`)||'{}')||{};}catch{}
 const scope=defaultBacklogContext(user,doc.lastScope)||'team';let state;
 try{const stored=JSON.parse(sessionStorage.getItem(`dmb_backlog_session_v2:${user?.id}`)||'{}')[scope];if(scope!=='team'||stored?.teamId===user?.team_id)state=stored?.state;}catch{}
 if(!state){const context=doc.contexts?.[scope];if(scope!=='team'||context?.teamId==null||context.teamId===user?.team_id)state=context?.views?.items?.find(v=>v.id===context.views.defaultId)?.state;}
 return buildBacklogHref(scope,state||{});
}
