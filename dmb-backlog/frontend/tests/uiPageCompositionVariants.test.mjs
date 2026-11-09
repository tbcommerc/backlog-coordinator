import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionCard } from '../js/ui/detailComponents.js';
import { filterChip, kpiCard, routeTabs } from '../js/ui/primitives.js';

test('plain sections retain escaping, error announcement and collapse semantics', () => {
  const html = sectionCard({ title:'<script>', variant:'plain', state:'error', message:'<ошибка>', collapsible:true, open:false });
  assert.match(html, /<details class="ui-section-card ui-section-plain/);
  assert.match(html, /<summary/);
  assert.match(html, /role="alert"/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;ошибка&gt;/);
  assert.doesNotMatch(html, / open|<script>/);
  assert.doesNotMatch(sectionCard({title:'Обычная',variant:'unknown'}), /ui-section-plain/);
});

test('collection navigation keeps filter semantics and accessible zero count', () => {
  const html = filterChip({label:'Мне принять',count:0,selected:true,variant:'navigation'});
  assert.match(html, /type="button"/);
  assert.match(html, /ui-filter-navigation/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, />0<\/strong>/);
  assert.doesNotMatch(html, /role="tab"/);
  assert.doesNotMatch(filterChip({label:'Фильтр',variant:'unknown'}), /ui-filter-navigation/);
});


test('compact metrics keep real values and route tabs preserve native link semantics', () => {
 const metric=kpiCard({label:'Завершено работ',value:0,variant:'inline'});
 assert.match(metric,/ui-kpi-inline/);assert.match(metric,/>0<\/strong>/);assert.match(metric,/type="button"/);
 const links=routeTabs({label:'Запросы',selected:'requests',items:[{id:'requests',label:'<Запрос>',href:'#/review'},{id:'unsafe',label:'Other',href:'javascript:alert(1)'}]});
 assert.match(links,/href="#\/review" aria-current="page"/);assert.match(links,/&lt;Запрос&gt;/);assert.doesNotMatch(links,/javascript:|role="tab"/);
});
