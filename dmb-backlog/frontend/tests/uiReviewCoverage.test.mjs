import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pagination} from '../js/ui/forms.js';
import {buildReviewInventory,detectors,detectReviewFamilies,reviewUiImports} from '../ui-catalog/build-review-inventory.mjs';
test('discovery finds local pagers even without a UI Kit import',()=>{
 for(const source of ['<div class="metric-pager">','data-page="2"','next_cursor','load-more'])assert.ok(detectors.pagination.test(source));
 const inventory=buildReviewInventory();
 for(const name of ['admin','taskTable','teamBacklog','metrics'])assert.ok(inventory.families.find(f=>f.family==='pagination').consumers.includes('js/components/'+name+'.js'));
 assert.ok(inventory.routeEvidence.some(r=>r.text.includes('/metrics')),'dynamic route candidates must not disappear');
 assert.ok(inventory.modules.some(m=>m.path==='js/agent-v2/workspace.js'));
 assert.ok(inventory.surfaces.every(s=>s.live==='not-reverified'),'historical claims cannot imply current live acceptance');
});
test('numbered pagination bounds huge totals and preserves per-consumer hooks',()=>{
 const html=pagination({page:500,pages:100000,pageAttrs:{'data-list-tab':'users'}});
 assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
 assert.equal((html.match(/data-list-tab="users"/g)||[]).length,5);
 assert.ok(html.length<6000);
 assert.match(html,/Страница 100000/);
 const step=pagination({page:10,pages:30,stepMode:true,scope:'test'});
 assert.match(step,/data-page="20"/);
 assert.doesNotMatch(pagination({page:1,pages:1}),/aria-current/);
});
test('every ordinary pager uses the common implementation',()=>{
 for(const name of ['admin','taskTable','teamBacklog','metrics','auditLog','customerPortal','modal','outboxDeadLetters','workUi']){
  const text=readFileSync(new URL('../js/components/'+name+'.js',import.meta.url),'utf8');
  assert.match(text,/import \{ pagination(?: as \w+)? \} from ['"]\.\.\/ui\/forms.js['"]/ ,name);
  assert.doesNotMatch(text,/for \(let p = 1; p <= totalPages|<span>\$\{(?:data\.)?page\} \/ \$\{(?:data\.)?pages\}/,name);
 }
});

test('pager actions distinguish arrow intent from page numbers sharing the same delta',()=>{const html=pagination({page:1,pages:3,stepMode:true,scope:'work'});assert.match(html,/data-page="1" data-page-scope="work" data-page-action="next"/);assert.match(html,/data-page="1" data-page-scope="work" data-page-action="number"/);});

test('discovery follows named UI imports independently of local aliases',()=>{
 const source="import { progress as anyPercent, field as arbitraryInput, tabs as sectionNavigation } from '../ui/index.js';";const found=detectReviewFamilies(source).map(f=>f.family);for(const f of ['progress','field','tabs'])assert.ok(found.includes(f),f);assert.equal(reviewUiImports(source).find(i=>i.exported==='progress').local,'anyPercent');
 const inventory=buildReviewInventory();for(const file of ['taskTable','teamBacklog','modal','customerPortal','customerReport','reports'])assert.ok(inventory.families.find(f=>f.family==='progress').consumers.includes('js/components/'+file+'.js'),file);
});

test('unsupported UI import syntax cannot silently bypass discovery',()=>{
 const inventory=buildReviewInventory();for(const module of inventory.modules){if(module.path.startsWith('js/ui/'))continue;const source=readFileSync(new URL('../'+module.path,import.meta.url),'utf8');assert.doesNotMatch(source,/import\s+\*[^;]+from\s*['"][^'"]*\/ui\//,module.path+': namespace imports require extending discovery first');assert.doesNotMatch(source,/import\s*\(\s*['"][^'"]*\/ui\//,module.path+': dynamic imports require extending discovery first');}
});
