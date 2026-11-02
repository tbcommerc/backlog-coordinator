import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildInventory} from './build-family-inventory.mjs';
import {buildReviewInventory} from './build-review-inventory.mjs';
const ledger=JSON.parse(readFileSync(new URL('./review-coverage.json',import.meta.url),'utf8'));
const inventory=buildReviewInventory();
const sourceDigest=createHash('sha256').update(JSON.stringify(buildInventory().sources)).digest('hex');
const evidence=new Map(ledger.evidence.map(e=>[e.id,e]));
for(const [family,record]of Object.entries(ledger.familyReview))if(['code-reviewed','accepted'].includes(record.status))for(const source of record.consumers){const module=inventory.modules.find(m=>m.path===source);if(!record.codeEvidence.some(e=>e.source===source&&e.sha256===module?.sha256&&['shared','exception','not-applicable'].includes(e.disposition)&&e.reason))throw Error('Current code review lacks a consumer disposition: '+family+' '+source);}
if(['code-reviewed','accepted'].includes(ledger.routeReview.status)&&ledger.routeReview.sourceSha256!==inventory.modules.find(m=>m.path==='js/router.js')?.sha256)throw Error('Route code review is stale');
if(evidence.size!==ledger.evidence.length)throw Error('Duplicate evidence id');
for(const f of inventory.families){
 const record=ledger.familyReview[f.family];if(!record)throw Error('Unreviewed family: '+f.family);
 if(JSON.stringify([...record.consumers].sort())!==JSON.stringify([...f.consumers].sort()))throw Error('Consumer discovery changed for '+f.family+'; review the diff before updating coverage.');
}
for(const e of ledger.evidence){
 for(const key of ['surface','function','role','states','theme','viewport','input','result','artifact'])if(!e[key])throw Error('Missing evidence field: '+key);
 if(!['live','fixture','code'].includes(e.kind))throw Error('Unknown evidence kind');
 if(!existsSync(new URL(e.artifact,import.meta.url)))throw Error('Evidence artifact missing: '+e.artifact);
}
for(const row of ledger.acceptance){
 if(!row.applicabilityReason||!row.requiredScenarios?.length||!row.roles?.length)throw Error('Acceptance needs a scoped scenario matrix');
 const surface=inventory.surfaces.find(s=>s.id===row.surface);if(!surface)throw Error('Unknown acceptance surface');
 for(const state of surface.declaredStates)if(!row.requiredScenarios.some(s=>s.state===state)&&!row.exclusions?.some(x=>x.state===state&&x.reason))throw Error('State omitted without applicability reason: '+state);
 for(const role of row.roles)if(!row.requiredScenarios.some(s=>s.role===role))throw Error('Role omitted: '+role);
 for(const scenario of row.requiredScenarios){
  const e=evidence.get(scenario.evidenceId);
  if(!e||e.sourceDigest!==sourceDigest||e.kind!=='live'||e.result!=='pass'||e.surface!==row.surface||e.role!==scenario.role||!e.states.includes(scenario.state)||e.theme!==scenario.theme||e.viewport!==scenario.viewport||e.input!==scenario.input)throw Error('Acceptance evidence does not cover scenario');
 }
}
console.log('Discovery/coverage structure checked. This is NOT complete UI acceptance.');
if(process.argv.includes('--acceptance')){
 for(const [family,record] of Object.entries(ledger.familyReview))if(record.status==='accepted')for(const source of record.consumers){
  const module=inventory.modules.find(m=>m.path===source);
  if(!record.codeEvidence.some(e=>e.source===source&&e.sha256===module.sha256&&['shared','exception','not-applicable'].includes(e.disposition)&&e.reason))throw Error('Accepted family lacks current consumer disposition: '+family+' '+source);
 }
 if(ledger.routeReview.status==='accepted'){
  for(const route of inventory.staticRoutes)if(!ledger.routeReview.routes?.includes(route))throw Error('Static route omitted: '+route);
  for(const candidate of inventory.routeEvidence)if(!ledger.routeReview.dynamicEvidence?.some(e=>e.line===candidate.line&&e.text===candidate.text&&e.reason))throw Error('Dynamic route evidence omitted at '+candidate.line);
 }
 const pending=inventory.surfaces.filter(s=>!ledger.acceptance.some(a=>a.surface===s.id));
 const families=Object.entries(ledger.familyReview).filter(([,r])=>r.status!=='accepted');
 if(pending.length||families.length||ledger.routeReview.status!=='accepted'){
  console.error('INCOMPLETE: '+pending.length+' surfaces, '+families.length+' families and dynamic route review require explicit evidence.');process.exitCode=1;
 }
}
