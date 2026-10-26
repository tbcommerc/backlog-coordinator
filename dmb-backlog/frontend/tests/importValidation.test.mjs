import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../js/components/modal.js',import.meta.url),'utf8');
const start=source.indexOf('  const REQUIRED_IMPORT_FIELDS =');
const end=source.indexOf('  function fieldLabel(',start);
const helpers=source.slice(source.indexOf('  function _normHeader('),source.indexOf('  function renderPreview()'));
function validate(headers,rows){
 const context=vm.createContext({headers,rows});
 vm.runInContext(source.slice(start,end)+'\nfunction fieldLabel(key){return FIELD_LABEL_FALLBACK[key]||key;}\n'+helpers,context);
 return JSON.parse(vm.runInContext('JSON.stringify(validateRows({headers,rows}))',context));
}
test('preview warns about title, numeric bounds and unknown boolean with both header styles',()=>{
 for(const headers of [['title','team_id','financial_effect','effort_days','did_demo'],['Название задачи','Ответственная команда','Финансовый эффект (value в млн руб.)','Оценка трудозатрат (ЭО) (ч/д)','Демо для оперативного статуса ДИД']]){
  const errors=validate(headers,[['Я'.repeat(256),'Team','-1','10001','perhaps']]);
  assert.equal(errors.length,4,JSON.stringify(errors));
 }
});
test('preview keeps valid bounds, explicit false and Unicode title length',()=>{
 assert.deepEqual(validate(['title','team_id','financial_effect','effort_days','did_demo'],[['😀'.repeat(255),'Team','0','10000','нет']]),[]);
 assert.equal(validate(['title','team_id'],[['😀'.repeat(256),'Team']]).length,1);
});
test('preview rejects nonfinite and scientific numeric values',()=>{
 for(const value of ['NaN','Infinity','1e3','1e309'])assert.equal(validate(['title','team_id','financial_effect'],[['A','Team',value]]).length,1);
});
