import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('SPA style fixtures load the same font faces before base typography',()=>{
  const root=new URL('../e2e/fixtures/',import.meta.url);
  for(const name of readdirSync(root).filter(name=>name.endsWith('.html'))){
    const html=readFileSync(new URL(name,root),'utf8');
    if(!html.includes('/css/base.css'))continue;
    assert.ok(html.includes('/css/fonts.css'),`Missing real font faces: ${name}`);
    assert.ok(html.indexOf('/css/fonts.css')<html.indexOf('/css/base.css'),`Font stylesheet must precede base: ${name}`);
  }
});

test('active styles and templates cannot reintroduce tiny text or private weights',()=>{
  const violations=[];
  function scan(root){for(const entry of readdirSync(root,{withFileTypes:true})){
    const path=join(root,entry.name);
    if(entry.isDirectory()){if(!['lib','assistant-v2'].includes(entry.name))scan(path);continue;}
    if(!/\.(css|js)$/.test(entry.name))continue;
    const source=readFileSync(path,'utf8');
    for(const m of source.matchAll(/font-size\s*:\s*(\d*\.?\d+)(px|rem)\b/g))if(+m[1]*(m[2]==='rem'?16:1)<12)violations.push(path+': '+m[0]);
    for(const m of source.matchAll(/\bfont\s*:\s*([^;{}]+)/g))for(const size of m[1].matchAll(/\b(\d+(?:\.\d+)?)px/g))if(+size[1]<12)violations.push(path+': '+m[0]);
    if(/font-weight\s*:\s*(550|650|750|800|900)\b|font:\s*(550|650|750|800|900)\b/.test(source))violations.push(path+': private weight');
    if(/line-height\s*:\s*normal\b/.test(source))violations.push(path+': platform line-height');
    if(/ui-monospace|Consolas|Fira Code/.test(source))violations.push(path+': unbundled monospace');
  }}
  scan(fileURLToPath(new URL('../css/',import.meta.url)));scan(fileURLToPath(new URL('../js/',import.meta.url)));
  assert.deepEqual(violations,[]);
});

test('bundled monospace includes its font data and redistribution license',()=>{
  const font=readFileSync(new URL('../fonts/JetBrainsMono-Variable.ttf',import.meta.url));
  assert.ok(font.length>100000);assert.equal(font.readUInt32BE(0),0x00010000);
  assert.match(readFileSync(new URL('../fonts/LICENSE-JetBrainsMono.txt',import.meta.url),'utf8'),/SIL OPEN FONT LICENSE/i);
  const tokens=readFileSync(new URL('../css/tokens.css',import.meta.url),'utf8');
  assert.match(tokens,/--font-mono:\s*'JetBrains Mono',\s*monospace/);
  assert.doesNotMatch(tokens,/Fira Code/);
});

test('kit imports precede style rules so browsers cannot silently drop a stylesheet',()=>{
  for(const name of readdirSync(new URL('../css/ui/',import.meta.url)).filter(n=>n.endsWith('.css'))){
    const css=readFileSync(new URL('../css/ui/'+name,import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//g,'');
    let ruleSeen=false;
    for(const chunk of css.split(/(@import[^;]+;)/)){
      if(chunk.trim().startsWith('@import'))assert.equal(ruleSeen,false,name);
      else if(chunk.trim())ruleSeen=true;
    }
  }
});
