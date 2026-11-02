import assert from 'node:assert/strict';
import {test} from 'node:test';
import {stepForm} from '../js/ui/stepForm.js';
import {splitPane} from '../js/ui/splitPane.js';
test('step form enforces identity and escapes labels',()=>{
 assert.throws(()=>stepForm(),TypeError);
 assert.throws(()=>stepForm({id:'s',steps:[{id:'a',label:'A'},{id:'a',label:'B'}]}),TypeError);
 const html=stepForm({id:'steps',active:'missing',navigation:true,steps:[{id:'a',label:'<A>',content:'<p>Trusted</p>'},{id:'b',label:'B',content:'B'}]});
 assert.match(html,/&lt;A&gt;/);assert.match(html,/data-step-id="a" aria-current="step"/);assert.match(html,/data-step-panel="b"[^>]* hidden/);
 assert.doesNotMatch(html,/<form/);assert.match(html,/type="button"/);
});
test('split pane has a labelled keyboard separator',()=>{
 assert.throws(()=>splitPane(),TypeError);
 const html=splitPane({id:'split',label:'<Width>',primary:'<p>Left</p>'});
 assert.match(html,/role="separator" tabindex="0" aria-orientation="vertical"/);assert.match(html,/aria-label="&lt;Width&gt;"/);
});
