import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import { buildDialogBridges } from '../ui-catalog/build-dialog-bridges.mjs';
const read=name=>readFileSync(new URL('../css/ui/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
test('core has no page selectors, dialog IDs or imports of legacy styles',()=>{
  for(const name of ['core.css','sizing.css','tables.css','foundations.css','interactions.css']){
    const source=read(name).replace(/\/\*[\s\S]*?\*\//g,'').replace(/url\([^)]*\)/g,'');
    assert.doesNotMatch(source, /#[a-z][\w-]*|\.(?:admin-|an-page|dict-editor|role-form|display-col|task-detail|create-task|work-table|outbox-table|ui-customer-report|chat-send-btn)/i,name);
    assert.doesNotMatch(source, /@import[^;]*(?:adapters|pages|components|login|modal-system)\.css/,name);
  }
});
test('all sizing/table bridges are generated from the shared contracts',()=>{
  assert.equal(read('dialog-bridges.css'), buildDialogBridges());
  assert.doesNotMatch(read('adapters.css'), /--ui-(?:size|target|font|line|icon|padding-x)\s*:/);
  assert.doesNotMatch(read('adapters.css'), /@media[^{}]*\{\s*\}/);
  const rules = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([,selector,body]) => [selector.trim(), body.trim()]);
  const shared = new Map(['core.css','sizing.css','tables.css'].flatMap(name=>rules(read(name))));
  // Check every adapter rule, including ones outside the old marked sections.
  for (const [selector, body] of rules(read('adapters.css'))) {
    const canonical = selector.replaceAll(':is(#task-detail-overlay, #create-task-overlay)', ':root');
    assert.notEqual(shared.get(canonical), body, `Hand-copied core rule: ${selector}`);
  }
});

test('shared CSS references declared tokens or explicit runtime layout variables',()=>{
  const names=readdirSync(new URL('../css/ui/',import.meta.url)).filter(name=>name.endsWith('.css'));
  const source=names.map(read).join('\n');
  const definitions=source+readFileSync(new URL('../css/tokens.css',import.meta.url),'utf8');
  const declared=new Set([...definitions.matchAll(/(--[\w-]+)\s*:/g)].map(match=>match[1]));
  for(const dynamic of ['--ui-column-rows','--ui-tag-color','--avatar-size'])declared.add(dynamic);
  const unknown=[...new Set([...source.matchAll(/var\((--[\w-]+)/g)].map(match=>match[1]).filter(name=>!declared.has(name)))];
  assert.deepEqual(unknown,[]);
});

test('SPA loads the kit after every page stylesheet',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map(match=>match[1]);
  assert.match(styles.at(-1), /\/ui\/kit\.css\?/);
});
