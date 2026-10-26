import assert from 'node:assert/strict';
import { test } from 'node:test';
globalThis.window = {app:{store:{get:()=>({role_name:'Администратор'})}}};
const {columnFilters,getFilteredList} = await import('../js/components/filterToolbar.js');
const text = ['id','title','description','financial_effect_justification','key_project_status','directorate_status','did_status','link_mockups','link_jira','rejection_reason','comment'];
const select = ['status_name','priority_name','project_name','task_type_name','team_name','owner_name','created_by_name','business_customer','did_client_group','department_name','involved_teams','channel_name','deadline_name','metric_kr_unit','tags'];
const numbers = ['progress','effort_days','effort_rub','actual_effort_days','financial_effect','cv','metric_kr_plan','metric_kr_fact'];
const dates = ['date_received','created_at','updated_at','key_project_status_updated_at','directorate_status_updated_at','did_status_updated_at'];
const aliases = {id:'public_id',business_customer:'business_customer_name',did_client_group:'did_client_group_name',involved_teams:'involved_team_names'};
for (const scope of ['backlog','team']) {
 for (const key of [...text,...select,...numbers,...dates,'did_demo']) test(`${scope} filter ${key}: selected, different, null and AND`, () => {
  const field=aliases[key]||key;
  let good='Целевое значение',bad='Другое значение',tokens=['Целевое значение'];
  if(text.includes(key)) tokens=['__text__:целевое'];
  if(numbers.includes(key)) {good=25;bad=26;tokens=['__min__:25','__max__:25'];}
  if(dates.includes(key)) {good='2026-10-12T12:00:00';bad='2026-10-13T12:00:00';tokens=['__from__:2026-10-12','__to__:2026-10-12'];}
  if(key==='did_demo') {good=false;bad=true;tokens=['Нет'];}
  if(key==='tags') {good=[{name:good}];bad=[{name:bad}];}
  if(key==='involved_teams') {good=[good];bad=[bad];}
  const tasks=[{id:1,[field]:good},{id:2,[field]:bad},{id:3,[field]:null}];
  if(key==='cv') {Object.assign(tasks[0],{effort_rub:25_000_000,financial_effect:1});Object.assign(tasks[1],{effort_rub:26_000_000,financial_effect:1});}
  columnFilters[scope]={[key]:new Set(tokens)};
  assert.deepEqual(getFilteredList(scope,tasks).map(t=>t.id).sort((a,b)=>a-b),[1]);
  columnFilters[scope]={[key]:new Set(['__EMPTY__'])};
  assert.deepEqual(getFilteredList(scope,tasks).map(t=>t.id).sort((a,b)=>a-b),key==='id'?[]:[3]);
  columnFilters[scope]={[key]:new Set([...tokens,'__EMPTY__'])};
  assert.deepEqual(getFilteredList(scope,tasks).map(t=>t.id).sort((a,b)=>a-b),key==='id'?[1]:[1,3]);
  columnFilters[scope]={[key]:new Set(tokens),[key==='title'?'description':'title']:new Set(['__text__:нет совпадения'])};
  assert.deepEqual(getFilteredList(scope,tasks),[]);
  columnFilters[scope]={};
 });
}
