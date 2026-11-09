import test from 'node:test';
import assert from 'node:assert/strict';
import { backlogContexts, defaultBacklogContext } from '../js/backlogContext.js';
test('team permissions never grant global read', () => {
 const u={team_id:7,permissions:{backlog_team:'write_all',task_edit:'team'}};
 assert.deepEqual(backlogContexts(u),['team']);
 assert.equal(defaultBacklogContext(u,'all'),'team');
 assert.deepEqual(backlogContexts({...u,team_id:null}),[]);
 assert.deepEqual(backlogContexts(null),[]);
});
test('remembered allowed context wins', () => {
 const u={team_id:7,permissions:{backlog_team:'write_own',backlog_dmb:'read',task_edit:'team'}};
 assert.equal(defaultBacklogContext(u),'team');
 assert.equal(defaultBacklogContext(u,'all'),'all');
});

test('BU-R01/R03: menu restores a canonical per-user context and never adopts another team session',async()=>{const {backlogMenuHref}=await import('../js/backlogContext.js');globalThis.localStorage={getItem:()=>JSON.stringify({lastScope:'team'})};globalThis.sessionStorage={getItem:()=>JSON.stringify({team:{teamId:7,state:{toolbar:{search:'Командный поиск'},page:{paginationPage:2}}}})};const u={id:101,team_id:7,permissions:{backlog_team:'write_own',backlog_dmb:'read',task_edit:'team'}};const p=new URLSearchParams(backlogMenuHref(u).split('?')[1]);assert.equal(p.get('bv'),'2');assert.equal(p.get('scope'),'team');assert.equal(p.get('q'),'Командный поиск');assert.equal(p.get('page'),'2');assert.equal(new URLSearchParams(backlogMenuHref({...u,team_id:8}).split('?')[1]).get('q'),null);});
