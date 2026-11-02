import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
const root=new URL('../js/',import.meta.url);
function walk(path=''){return readdirSync(new URL(path,root),{withFileTypes:true}).flatMap(e=>e.isDirectory()?['lib','assistant-v2'].includes(e.name)?[]:walk(path+e.name+'/'):[path+e.name]);}
test('all active SPA renderers leave the main landmark to the application shell',()=>{
 for(const path of walk().filter(p=>p.endsWith('.js')&&p!=='app.js'))assert.doesNotMatch(readFileSync(new URL(path,root),'utf8'),/<main\b|role=["']main["']/i,path);
 assert.match(readFileSync(new URL('app.js',root),'utf8'),/<main\b/);
});
