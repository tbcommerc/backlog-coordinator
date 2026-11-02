import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import vm from 'node:vm';
import {families} from '../ui-catalog/family-contracts.mjs';
import {ICON_ALIASES} from '../js/ui/primitives.js';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
function files(p){return readdirSync(new URL(p,root),{withFileTypes:true}).flatMap(e=>e.isDirectory()?['lib'].includes(e.name)?[]:files(p+'/'+e.name):[p+'/'+e.name]);}

test('U27 every public export has family, states and a real browser suite',()=>{
 const exports=[...read('js/ui/index.js').matchAll(/export\s*\{([^}]+)\}/g)].flatMap(m=>m[1].split(',').map(s=>s.trim()));
 assert.deepEqual(families.flatMap(f=>f.exports).sort(),exports.sort());
 for(const family of families){assert.ok(family.states.length>=2,family.name);assert.match(read('e2e/'+family.test),/test\(/,family.name);}
});

test('U28 core boundary follows every transitive CSS import',()=>{
 const seen=new Set();
 function visit(p){if(seen.has(p))return;seen.add(p);const css=read(p).replace(/\/\*[\s\S]*?\*\//g,'');
  const selectors=[...css.matchAll(/([^{}]+)\{/g)].map(m=>m[1]).join('\n');
  assert.doesNotMatch(selectors.replace(/url\([^)]*\)/g,''),/#[a-z][\w-]*|\.(?:admin-|task-detail|create-task|work-|notification-|audit-)/i,p);
  for(const [,name] of css.matchAll(/@import\s+url\(["']\.\/([^?"']+)/g))visit('css/ui/'+name);
 }visit('css/ui/core.css');assert.ok(seen.size>8);
});

test('U01 U28 all active CSS and inline JS token references are declared',()=>{
 const sources=[...files('css'),...files('js')].filter(p=>/\.(css|js)$/.test(p)).map(p=>[p,read(p)]);
 const definitions=new Set(sources.flatMap(([,s])=>[...s.matchAll(/(--[\w-]+)\s*:/g)].map(m=>m[1])));
 // Runtime layout/data properties must have an explicit writer, not a global waiver.
 for(const [,s]of sources)for(const [,name]of s.matchAll(/setProperty\(['"](--[\w-]+)['"]/g))definitions.add(name);
 const missing=[];
 for(const [p,s]of sources)for(const [,name]of s.matchAll(/var\((--[\w-]+)\s*\)/g))if(!definitions.has(name))missing.push(`${p}: ${name}`);
 assert.deepEqual([...new Set(missing)],[]);
});

test('U10 every static icon and public alias resolves in bundled Lucide',()=>{
 const context={};vm.runInNewContext(read('js/lib/lucide.min.js'),context);
 const normalize=s=>s.replaceAll('-','').toLowerCase();
 const known=new Set(Object.keys(context.lucide.icons).map(normalize)),missing=[];
 for(const [alias,name] of Object.entries(ICON_ALIASES))assert.ok(known.has(normalize(name)),alias+' → '+name);
 for(const p of files('js').filter(p=>p.endsWith('.js')))for(const [,name]of read(p).matchAll(/data-lucide="([a-z][a-z-]+)"/g))if(!known.has(normalize(name)))missing.push(p+': '+name);
 assert.deepEqual(missing,[]);
});

test('U12 U18 U20 consumers cannot regress to the reproduced invalid patterns',()=>{
 for(const p of files('js/components').filter(p=>p.endsWith('.js'))){const s=read(p);
  assert.doesNotMatch(s,/<input[^>]*class="ui-checkbox"/,p);
  assert.doesNotMatch(s,/<div class="progress-bar"/,p);
 }
 for(const [,tag]of read('js/components/expressEstimate.js').matchAll(/(<input[^>]*class="[^"]*qe-inline-(?:field-input|title)[^>]*>)/g))assert.match(tag,/aria-label=/);
});
