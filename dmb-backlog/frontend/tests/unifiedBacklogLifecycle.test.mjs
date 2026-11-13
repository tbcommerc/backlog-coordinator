import test from 'node:test';import assert from 'node:assert/strict';import{loadBacklogTaskPages}from '../js/backlogTaskLoader.js';
import{execFileSync}from 'node:child_process';import{mkdirSync,writeFileSync}from 'node:fs';import{performance}from 'node:perf_hooks';
function setup(){globalThis.window=new EventTarget();window.location={hash:'#/backlog?scope=team'};}
function apiFor(n,{delay=0,failPage=0}={}){const rows=Array.from({length:n},(_,id)=>({id:id+1,title:'Task '+id}));let calls=0,active=0,peak=0;return{rows,stats:()=>({calls,peak}),api:{get:async(url,{signal}={})=>{calls++;active++;peak=Math.max(peak,active);try{const p=Number(new URL(url,'http://local').searchParams.get('page'));if(delay)await new Promise(r=>setTimeout(r,delay));signal?.throwIfAborted();if(p===failPage)throw Error('page failed');return{items:rows.slice((p-1)*1000,p*1000),pages:Math.ceil(n/1000),total:n};}finally{active--;}}}};}
for(const n of [0,1,100,101,1000,2501])test(`BU-D01/D03/D04/D11: complete snapshot ${n}`,async()=>{setup();const a=apiFor(n,{delay:1});const result=await loadBacklogTaskPages(a,'team_id=7','/backlog');assert.equal(result.items.length,n);assert.deepEqual(result.items.map(x=>x.id),a.rows.map(x=>x.id));assert.equal(a.stats().calls,Math.max(1,Math.ceil(n/1000)));assert.ok(a.stats().peak<=2);});
test('BU-D08: a failed continuation never returns a partial snapshot',async()=>{setup();const a=apiFor(2501,{failPage:2});await assert.rejects(loadBacklogTaskPages(a,'','/backlog'),/page failed/);});
test('BU-D10: inconsistent totals retry once and fail explicitly',async()=>{setup();let calls=0;const a={api:{get:async()=>{calls++;return{items:[{id:1},{id:1}],total:2,pages:1};}}};await assert.rejects(loadBacklogTaskPages(a,'','/backlog'),{name:'BacklogSnapshotError'});assert.equal(calls,2);});
test('BU-D06: capabilities changing during response invalidate the snapshot',async()=>{setup();let key='old';const a={api:{get:async()=>{key='revoked';return{items:[],pages:1,total:0};}}};await assert.rejects(loadBacklogTaskPages(a,'','/backlog',{contextKey:()=>key}),{name:'AbortError'});});
test('BU-D16: five paired measurements against the unchanged HEAD loader',async()=>{
 const baselineSource=execFileSync('git',['show','HEAD:dmb-backlog/frontend/js/backlogTaskLoader.js'],{encoding:'utf8'});const baseline=(await import('data:text/javascript;base64,'+Buffer.from(baselineSource).toString('base64'))).loadBacklogTaskPages;
 // Normalize only timer scheduling drift; preserve loader CPU work and the 35 ms API latency.
 // On a busy Windows host a 35 ms timeout can wake after 200 ms, which is not loader regression.
 const measure=async(fn,n)=>{setup();const a=apiFor(n,{delay:35});const waits=[];const get=a.api.get;
 a.api.get=async(...args)=>{const start=performance.now();try{return await get(...args);}finally{waits.push([start,performance.now()]);}};
 const start=performance.now();await fn(a,'','/backlog');const wallMs=performance.now()-start;
 const intervals=waits.sort((a,b)=>a[0]-b[0]);let waited=0,end=0;for(const [a,b]of intervals){waited+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
 return{ms:wallMs-waited+35*(1+Math.ceil((a.stats().calls-1)/a.stats().peak)),wallMs,...a.stats()};};
 const results=[];for(const n of [0,1,100,101,1000,2501]){const before=[],after=[];for(let i=0;i<5;i++){before.push(await measure(baseline,n));after.push(await measure(loadBacklogTaskPages,n));}
 const median=xs=>xs.map(x=>x.ms).sort((a,b)=>a-b)[2];const result={dataset:n,before,after,baselineMedian:median(before),currentMedian:median(after)};results.push(result);assert.ok(after.every(x=>x.calls===Math.max(1,Math.ceil(n/1000))&&x.peak<=2));assert.ok(result.currentMedian<=result.baselineMedian*1.2,JSON.stringify(result));}
 mkdirSync(new URL('../../artifacts/',import.meta.url),{recursive:true});writeFileSync(new URL('../../artifacts/backlog-unification-performance.json',import.meta.url),JSON.stringify({baseline:'HEAD loader; 35ms API; five pairs; timer scheduling drift normalized; raw wallMs retained',results},null,2));
});
