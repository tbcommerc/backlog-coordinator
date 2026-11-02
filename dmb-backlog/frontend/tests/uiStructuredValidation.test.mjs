import test from 'node:test';
import assert from 'node:assert/strict';
import {formatErrorMessage} from '../js/uiFeedback.js';
test('structured validation errors preserve a useful Russian explanation',()=>{
 assert.equal(formatErrorMessage({message:'HTTP 422',data:[{loc:['body'],msg:'Value error, Период должен быть от 1 дня до 10 лет'}]}),'Период должен быть от 1 дня до 10 лет');
 assert.equal(formatErrorMessage({message:'HTTP 422',data:[{loc:['body','title'],msg:'Field required'}]}),'Проверьте заполнение полей формы.');
 assert.equal(formatErrorMessage({message:'Конфликт версии',status:409}),'Конфликт версии');
});
