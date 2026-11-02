import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entityPicker } from '../js/ui/entityPicker.js';

test('picker requires stable form identifiers and label',()=>{
  for(const options of [{},{id:'x'},{id:'x',name:'target'}])assert.throws(()=>entityPicker(options),TypeError);
});
test('picker escapes initial entity, IDs and labels without executable attributes',()=>{
  const markup=entityPicker({id:'x"',name:'target',label:'<Task>',selected:{value:'1"',label:'<img src=x>'},attrs:{onclick:'alert(1)',style:'display:none'}});
  assert.doesNotMatch(markup,/<img|onclick=|style=/);
  assert.match(markup,/&lt;img src=x&gt;/);assert.match(markup,/&lt;Task&gt;/);
  assert.match(markup,/for="x&quot;"/);
});
test('picker uses native required and disabled selection, zero is an entity key',()=>{
  const markup=entityPicker({id:'task',name:'target_id',label:'Task',selected:{value:0,label:'Zero'},required:true,disabled:true});
  assert.match(markup,/<select[^>]*required[^>]*disabled/);
  assert.match(markup,/<option value="0" selected>Zero/);
  assert.match(markup,/aria-describedby="task-status"/);
  assert.match(markup,/aria-hidden="true"> \*/);
});
