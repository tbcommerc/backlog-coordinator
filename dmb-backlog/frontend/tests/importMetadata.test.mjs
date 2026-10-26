import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeCsvContent} from '../js/taskCsv.js';
test('metadata matches the decoder actually used',()=>{
 const le=Buffer.from('\ufeffТест','utf16le'),be=Buffer.from(le);be.swap16();
 for(const [bytes,encoding] of [[Buffer.from('Тест'),'UTF-8'],[le,'UTF-16 LE'],[be,'UTF-16 BE'],[Uint8Array.from([0xd2,0xe5,0xf1,0xf2]),'Windows-1251']]){
  assert.deepEqual(decodeCsvContent(bytes,true),{text:'Тест',encoding});
 }
});