import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const root=new URL('../',import.meta.url).pathname.replace(/^\/(\w:)/,'$1');
const files=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.name==='lib'?[]:e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);
test('content link styles do not reintroduce accent or info text colours',()=>{
 const violations=[];
 for(const file of files(join(decodeURIComponent(root),'css')).filter(p=>p.endsWith('.css'))){
  const css=readFileSync(file,'utf8');
  for(const [,selector,body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
   if(!/(?<![\w-])a(?=[\s:.\[>#,{]|$)|link|an-task-id|pip-task-id|ui-table-title|metric-name/.test(selector))continue;
   if(/(?<![\w-])color\s*:\s*var\(--(?:accent(?:-text|-hover)?|info)\)/.test(body))violations.push({file,selector:selector.trim()});
  }
 }
 assert.deepEqual(violations,[]);
 assert.match(readFileSync(join(decodeURIComponent(root),'css/tokens.css'),'utf8'),/--text-link:\s*var\(--text-primary\)/);
});
test('active JavaScript anchors have no inline blue or accent text',()=>{
 const violations=[];
 for(const file of files(join(decodeURIComponent(root),'js')).filter(p=>p.endsWith('.js'))){
  for(const [tag] of readFileSync(file,'utf8').matchAll(/<a\b[^>]*>/g))if(/style="[^"]*color:\s*(?:var\(--(?:accent|info)|#(?:1e40af|3b82f6|2563eb|0000ff))/i.test(tag))violations.push(file);
 }
 assert.deepEqual(violations,[]);
});
