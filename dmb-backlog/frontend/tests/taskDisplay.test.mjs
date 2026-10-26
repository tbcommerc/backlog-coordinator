import {test} from 'node:test';import assert from 'node:assert/strict';import {formatCreatedDate} from '../js/taskDisplay.js';
test('creation date is localized and missing or invalid dates stay empty',()=>{for(const v of [null,'','bad'])assert.equal(formatCreatedDate(v),'—');const v='2026-09-01T09:00:00Z';assert.equal(formatCreatedDate(v),new Date(v).toLocaleString('ru-RU'));assert.ok(!formatCreatedDate(v).includes('T09'));});
import {supplementalTaskValue} from '../js/taskDisplay.js';
test('supplemental fields distinguish false from missing and preserve values',()=>{assert.equal(supplementalTaskValue('did_demo',{did_demo:false}),'Нет');assert.equal(supplementalTaskValue('did_demo',{}),'—');assert.equal(supplementalTaskValue('created_by',{created_by_name:'Автор'}),'Автор');assert.equal(supplementalTaskValue('financial_effect_justification',{financial_effect_justification:'Причина'}),'Причина');});

import {taskStatusTone,taskPriorityTone} from '../js/taskDisplay.js';
test('task status tones preserve meaning for canonical and display labels',()=>{
 assert.equal(taskStatusTone('ПРИНЯТА В РАБОТУ'),'info');
 assert.equal(taskStatusTone(' В работе '),'info');
 assert.equal(taskStatusTone('Выполнена'),'success');
 assert.equal(taskStatusTone('Отклонена'),'danger');
 assert.equal(taskStatusTone('ХОЛД'),'accent');
 assert.equal(taskStatusTone('Новый неизвестный статус'),'neutral');
});
test('priority tones are independent of display case and missing priorities stay neutral',()=>{
 assert.equal(taskPriorityTone('Высокий'),'danger');
 assert.equal(taskPriorityTone(' СРЕДНИЙ '),'warning');
 assert.equal(taskPriorityTone('Низкий'),'neutral');
 assert.equal(taskPriorityTone(null),'neutral');
});
