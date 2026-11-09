import test from 'node:test';import assert from 'node:assert/strict';
import {parseBacklogRoute as parse,buildBacklogHref as build,safeBacklogReturn} from '../js/backlogRouteState.js';
test('BU-R08/F04: full query round-trip preserves Unicode, sets and page',()=>{
 const state={toolbar:{search:'Кириллица & + % "',sort:'id-asc',filters:{status_name:['А','Б','А'],_urgent:['yes']}},page:{view:'cards',paginationPage:3,columnSort:{key:'title',dir:'desc'}}};
 const value=parse(build('team',state,{task:41,tab:'com',comment:9}),['status_name']);
 assert.deepEqual(value.errors,[]);assert.equal(value.scope,'team');assert.equal(value.toolbar.search,state.toolbar.search);assert.deepEqual(value.toolbar.filters.status_name,['А','Б']);assert.equal(value.page.paginationPage,3);assert.equal(value.params.get('comment'),'9');
});
for(const hash of ['#/backlog?scope=wrong','#/backlog?scope=all&scope=team','#/backlog?bv=3','#/backlog?filters=nope','#/backlog?page=-1','#/backlog?cs=unsafe','#/backlog?filters={"__proto__":["yes"]}'])test(`BU-R07/R09: rejects ${hash}`,()=>assert.ok(parse(hash).errors.length));
test('BU-R16: return address rejects external URLs and other routes',()=>{
 for(const value of ['https://example.com','//example.com','#/work-tasks','javascript:alert(1)',null])assert.equal(safeBacklogReturn(value,'fallback'),'fallback');
 assert.equal(safeBacklogReturn('#/backlog?scope=team'),'#/backlog?scope=team');
});
test('BU-R05/S02: legacy alias and explicit empty snapshot',()=>{assert.equal(parse('#/team-backlog').scope,'team');const r=parse('#/backlog?bv=2&scope=all');assert.equal(r.explicit,true);assert.equal(r.toolbar.search,'');assert.deepEqual(r.toolbar.filters,{});});

test('BU-C10: nested Task links preserve the current list and old external routes remain compatible',async()=>{const {backlogTaskHref}=await import('../js/backlogRouteState.js');const href=backlogTaskHref(42,'#/backlog?bv=2&scope=team&q='+encodeURIComponent('Кириллица & текст')+'&page=2&task=41&tab=com&comment=9');const route=parse(href);assert.equal(route.scope,'team');assert.equal(route.toolbar.search,'Кириллица & текст');assert.equal(route.page.paginationPage,2);assert.equal(route.params.get('task'),'42');assert.equal(route.params.has('comment'),false);for(const origin of ['#/notifications','#/analytics/tribe','#/reports','#/review/7','#/work-projects','#/work-tasks/1'])assert.equal(backlogTaskHref(42,origin),'#/backlog?task=42');assert.equal(backlogTaskHref(-1),'#/backlog');});
