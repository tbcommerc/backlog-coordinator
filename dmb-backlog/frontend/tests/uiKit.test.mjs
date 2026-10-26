import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attributes, button, checkbox, control, field, fieldFrame, tab, tabs, pageHeader, filterChip } from '../js/ui/primitives.js';
import { tabNavigationTarget } from '../js/ui/controls.js';
import { toggleSwitch } from '../js/ui/switch.js';
import { avatar, tag, progress } from '../js/ui/dataDisplay.js';

test('data display escapes labels, constrains colours and clamps progress',()=>{
  assert.match(tag({label:'<script>',color:'red;display:none'}),/&lt;script&gt;/);
  assert.doesNotMatch(tag({label:'Tag',color:'red;display:none'}),/style=/);
  assert.match(tag({label:'Tag',color:'#abcdef'}),/--ui-tag-color:#abcdef/);
  assert.match(avatar({name:'<alice> bob',size:999}),/data-ui-size="32"/);
  assert.doesNotMatch(avatar({name:'<alice> bob'}),/<alice>/);
  assert.match(progress({value:120}),/aria-valuenow="100"/);
  assert.match(progress({value:-5}),/aria-valuenow="0"/);
  assert.doesNotMatch(progress({value:null}),/aria-valuenow=/);
  assert.match(progress({value:NaN}),/aria-valuetext="Нет данных"/);
});

test('components escape text and attributes and reject executable attributes', () => {
  const label = '<img src=x onerror=alert(1)>';
  for (const markup of [button({label}),pageHeader({title:label}),filterChip({label}),field({id:'unsafe" autofocus="true',label,value:label})]) {
    assert.ok(!markup.includes('<img'));
    assert.ok(markup.includes('&lt;img'));
  }
  assert.equal(attributes({onclick:'alert(1)',style:'display:none',href:'javascript:alert(1)'}),'');
  assert.equal(attributes({disabled:true,hidden:false,'aria-busy':true,'aria-expanded':false}), ' disabled aria-busy="true" aria-expanded="false"');
});

test('button has one explicit type and icon-only actions require an accessible name', () => {
  const markup=button({label:'Сохранить',attrs:{type:'submit'}});
  assert.equal((markup.match(/\btype=/g)||[]).length,1);
  assert.match(markup,/type="submit"/);
  assert.throws(()=>button({icon:'plus',iconOnly:true}),TypeError);
  assert.match(button({label:'Добавить',icon:'plus',iconOnly:true}),/aria-label="Добавить"/);
});

test('checkbox preserves native semantics, label association and escaped values', () => {
  const markup = checkbox({ id: 'visible', label: 'Показать <имя>', checked: true, disabled: true, attrs: { value: '"A"', type: 'text', onclick: 'bad()' } });
  assert.match(markup, /for="visible"/);
  assert.match(markup, /type="checkbox"/);
  assert.match(markup, /id="visible" disabled checked/);
  assert.match(markup, /Показать &lt;имя&gt;/);
  assert.match(markup, /value="&quot;A&quot;"/);
  assert.doesNotMatch(markup, /onclick|type="text"/);
  assert.doesNotMatch(checkbox({ id: 'off', label: 'Выключен' }), / checked| disabled/);
  assert.throws(() => checkbox({ id: 'missing-label' }), TypeError);
});

test('field associates both help and validation with the editable control', () => {
  const markup=field({id:'name',label:'Название',required:true,hint:'Введите название',error:'Обязательное поле',attrs:{type:'submit',value:'ignored'}});
  assert.equal((markup.match(/\btype=/g)||[]).length,1);
  assert.equal((markup.match(/\bvalue=/g)||[]).length,1);
  assert.match(markup,/for="name"/);
  assert.match(markup,/aria-describedby="name-hint name-error"/);
  assert.match(markup,/aria-invalid="true"/);
  assert.match(markup,/id="name-error"/);
});

test('switch keeps native checked state and separates label from description', () => {
  const markup=toggleSwitch({id:'notifications',label:'Комментарии <команды>',description:'Текст <подсказки>',checked:true,disabled:true,attrs:{'aria-checked':false,type:'text',role:'button',onclick:'bad()','aria-describedby':'save-status'}});
  assert.match(markup,/type="checkbox" role="switch"/);
  assert.match(markup,/ checked/);
  assert.match(markup,/ disabled/);
  assert.match(markup,/aria-labelledby="notifications-label"/);
  assert.match(markup,/aria-describedby="save-status notifications-description"/);
  assert.match(markup,/Комментарии &lt;команды&gt;/);
  assert.match(markup,/Текст &lt;подсказки&gt;/);
  assert.doesNotMatch(markup,/aria-checked|onclick|role="button"|type="text"/);
  assert.throws(()=>toggleSwitch({id:'missing-label'}),TypeError);
});

test('vertical tabs use Up/Down and keep horizontal arrows available to their contents', () => {
  const controls=[{disabled:false},{disabled:true},{disabled:false}];
  const root={querySelectorAll:()=>controls,getAttribute:()=> 'vertical'};
  const event=key=>({key,target:{closest:()=>controls[0]}});
  assert.equal(tabNavigationTarget(root,event('ArrowDown')),controls[2]);
  assert.equal(tabNavigationTarget(root,event('ArrowUp')),controls[2]);
  assert.equal(tabNavigationTarget(root,event('ArrowRight')),null);
  assert.equal(tabNavigationTarget(root,event('End')),controls[2]);
});

test('inline controls preserve limits, selected legacy values and escape editable text', () => {
  const number = control({ type: 'number', value: 17, attrs: { min: 0, max: 100, step: 1, 'data-k': 'effort', 'aria-label': 'Оценка' } });
  assert.match(number, /type="number" value="17" min="0" max="100" step="1"/);
  assert.match(number, /aria-label="Оценка"/);
  const value = '</textarea><script>alert(1)</script>';
  assert.doesNotMatch(control({ kind: 'textarea', value, attrs: { rows: 4, maxlength: 255 } }), /<script>/);
  assert.match(control({ kind: 'select', value: 7, options: [{ value: '', label: '—' }, { value: 7, label: 'Архивное значение' }] }), /value="7" selected>Архивное значение/);
});

test('composed fields keep counters and hidden errors associated with a visible label', () => {
  const markup = fieldFrame({ id: 'title', label: 'Название', required: true, controlMarkup: control({ id: 'title', attrs: { 'aria-describedby': 'title-error' } }) + '<span>0 / 255</span>', error: 'Введите название', errorHidden: true });
  assert.match(markup, /for="title"/);
  assert.match(markup, /aria-describedby="title-error"/);
  assert.match(markup, /id="title-error" hidden/);
  assert.match(markup, /<span>0 \/ 255<\/span>/);
  assert.doesNotMatch(markup, /aria-invalid="true"/);
});

test('shared tabs expose selection and skip disabled controls without changing selection', () => {
  assert.match(tab({ id: 'main', panelId: 'body', label: 'Основное', selected: true }), /role="tab" aria-controls="body" aria-selected="true" tabindex="0"/);
  assert.match(tab({ id: 'other', panelId: 'body', label: 'Другое' }), /aria-selected="false" tabindex="-1"/);
  const controls = [{ disabled: false }, { disabled: true }, { disabled: false }];
  const root = { querySelectorAll: () => controls };
  const event = key => ({ key, target: { closest: () => controls[0] } });
  assert.equal(tabNavigationTarget(root, event('ArrowRight')), controls[2]);
  assert.equal(tabNavigationTarget(root, event('ArrowLeft')), controls[2]);
  assert.equal(tabNavigationTarget(root, event('Home')), controls[0]);
  assert.equal(tabNavigationTarget(root, event('End')), controls[2]);
  assert.equal(tabNavigationTarget(root, event('Enter')), null);
});

test('tabs always select an enabled item, including stale and disabled selections', () => {
  const items = [{id:'off',label:'Отключена',disabled:true},{id:'on',label:'Доступна'}];
  for (const selected of [undefined, 'off', 'missing', 'on']) {
    const markup = tabs({id:'safe',label:'Выбор',items,selected});
    assert.match(markup, /id="safe-off-tab"[^>]*aria-selected="false" tabindex="-1" disabled/);
    assert.match(markup, /id="safe-on-tab"[^>]*aria-selected="true" tabindex="0"/);
    assert.equal((markup.match(/aria-selected="true"/g)||[]).length, 1);
  }
  assert.doesNotMatch(tabs({id:'none',items:items.slice(0,1)}), /aria-selected="true"|tabindex="0"/);
  assert.doesNotMatch(tab({id:'off',disabled:true,selected:true}), /aria-selected="true"|tabindex="0"/);
  assert.doesNotThrow(() => tabs());
});
