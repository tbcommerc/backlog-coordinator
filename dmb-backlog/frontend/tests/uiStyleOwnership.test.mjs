import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
function* consumers(root=fileURLToPath(new URL('../js/',import.meta.url))){
 for(const entry of readdirSync(root,{withFileTypes:true})){
  if(entry.isDirectory()){if(!['lib','ui'].includes(entry.name))yield* consumers(join(root,entry.name));}
  else if(entry.name.endsWith('.js'))yield join(root,entry.name);
 }
}
test('active table templates declare a kit recipe and cannot redefine cell typography or density inline',()=>{
 const violations=[];
 for(const path of consumers()){
  const source=readFileSync(path,'utf8');
  for(const m of source.matchAll(/<(table|th|td)\b[^>]*>/g)){
   const tag=m[0];
   if(m[1]==='table'&&!/class="[^"]*ui-table-(?:data|admin|editor|prose)/.test(tag))violations.push(`${path}: unclassified table`);
   if(m[1]!=='table'){
    const style=tag.match(/style="([^"]*)"/)?.[1]||'';
    if(/(?:^|;)\s*(?:padding(?:-top|-bottom)?|font-size|letter-spacing)\s*:/.test(style))violations.push(`${path}: private cell style`);
   }
  }
 }
 assert.deepEqual(violations,[]);
});
test('review and mobile backlog controls cannot override the shared size scale with important',()=>{
 for(const file of ['pages.css','components.css']){
  const css=readFileSync(new URL('../css/'+file,import.meta.url),'utf8');
  for(const [,selector,body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
   if((/review-(?:search|control)/.test(selector)&&/\.input\b/.test(selector))||/#(?:btn-ext|f-(?:backlog|team)-(?:sort|reset))/.test(selector))
    assert.doesNotMatch(body,/(?:height|font-size|padding|border-radius)\s*:[^;]*!important/,selector);
  }
 }
});
