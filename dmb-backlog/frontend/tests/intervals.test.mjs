import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dateRange, numberRange } from '../js/ui/intervals.js';

test('intervals require group identity and distinct endpoint IDs',()=>{
  for(const render of [dateRange,numberRange]){
    assert.throws(()=>render(),TypeError);
    assert.throws(()=>render({id:'x',label:'Period',from:{id:'same'},to:{id:'same'}}),TypeError);
  }
});
test('range uses safe fields, legend, associated hint and native constraints',()=>{
  const html=numberRange({id:'limits',label:'<Limits>',hint:'<Hint>',from:{value:0,name:'minimum',min:-5,max:10,step:0.5,attrs:{onclick:'bad'}},to:{value:1,name:'maximum'}});
  assert.match(html,/<legend>&lt;Limits&gt;<\/legend>/);assert.match(html,/value="0"/);
  assert.match(html,/min="-5" max="10" step="0.5"/);assert.match(html,/aria-describedby="limits-hint"/);
  assert.doesNotMatch(html,/onclick=|<Hint>/);
});
test('disabled readonly required hidden and optional ordering remain explicit',()=>{
  const html=dateRange({id:'period',label:'Period',required:true,disabled:true,readonly:true,order:false,attrs:{hidden:true},from:{required:false}});
  assert.match(html,/<fieldset[^>]* hidden[^>]* disabled/);
  assert.match(html,/data-range-order="false"/);
  assert.match(html,/<input[^>]*id="period-to"[^>]*required[^>]*disabled[^>]*readonly/);
  assert.doesNotMatch(html,/<input[^>]*id="period-from"[^>]*required/);
});
