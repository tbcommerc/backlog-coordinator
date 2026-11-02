import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataTable, tableCell } from '../js/ui/dataTable.js';

test('cell escaping, safe links, zero, invalid numbers and calendar dates', () => {
  assert.match(tableCell({value:0,type:'number'}),/>0</);
  for (const value of [null,undefined,'',NaN,Infinity,'bad']) assert.match(tableCell({value,type:'number'}),/—/);
  assert.match(tableCell({value:'<script>',secondary:'<img>'}),/&lt;script&gt;/);
  assert.doesNotMatch(tableCell({value:'URL',type:'link',href:'javascript:alert(1)'}),/<a /);
  assert.match(tableCell({value:'Task',type:'link',href:'#/work-tasks/1'}),/href="#\/work-tasks\/1"/);
  assert.match(tableCell({value:'Site',type:'link',href:'https://example.org'}),/href="https:\/\/example.org\/"/);
  assert.match(tableCell({value:'2026-10-29',type:'date'}),/>29.10.2026</);
  assert.doesNotMatch(tableCell({value:'2026-02-30',type:'date'}),/<time/);
  assert.match(tableCell({value:'<active>',type:'badge'}),/&lt;active&gt;/);
});

test('table requires a caption and unique named columns', () => {
  for (const options of [{}, {label:'Rows'}, {label:'Rows',columns:[{key:'x'}]}, {label:'Rows',columns:[{key:'x',label:'X'},{key:'x',label:'Y'}]}]) assert.throws(()=>dataTable(options),TypeError);
  const markup=dataTable({label:'<Caption>',columns:[{key:'x',label:'<X>'}],rows:[{x:'<script>'}],attrs:{onclick:'bad',hidden:true}});
  assert.match(markup,/<caption class="sr-only">&lt;Caption&gt;<\/caption>/);
  assert.match(markup,/scope="col"/);
  assert.match(markup,/ hidden/);
  assert.doesNotMatch(markup,/<script>|onclick=/);
});

test('states do not render stale rows or invoke renderers; retry is explicit', () => {
  for (const state of ['loading','error','empty']) {
    const markup=dataTable({label:'Rows',columns:[{key:'x',label:'X',render:()=>{throw Error('must not render');}}],rows:[{x:'old'}],state,actionLabel:'Повторить',actionAttrs:{'data-retry':'yes'}});
    assert.doesNotMatch(markup,/<tbody>/);
    assert.equal(markup.includes('data-retry'),state!=='loading');
    if(state==='loading')assert.match(markup,/aria-busy="true"/);
    if(state==='error')assert.match(markup,/role="alert"/);
  }
});

test('sort state is controlled and renderer preserves supplied row order', () => {
  const markup=dataTable({label:'Rows',columns:[{key:'x',label:'X',sortable:true}],rows:[{x:'B'},{x:'A'}],sort:{key:'x',direction:'asc'}});
  assert.match(markup,/aria-sort="ascending"/);
  assert.match(markup,/сортировать по убыванию/);
  assert.ok(markup.indexOf('>B<')<markup.indexOf('>A<'));
});
