import test from 'node:test';
import assert from 'node:assert/strict';
import {fileUpload} from '../js/ui/specialized.js';
test('Upload composition preserves external descriptions and owns the input identity and status link',()=>{
 const html=fileUpload({id:'work-file-7',label:'Добавить файл',hint:'До 50 МБ',className:'work-upload',inputAttrs:{'data-work-upload':'','aria-describedby':'domain-hint',id:'other',type:'text'}});
 assert.match(html,/for="work-file-7"/);assert.match(html,/id="work-file-7"/);assert.match(html,/type="file"/);assert.match(html,/aria-describedby="domain-hint work-file-7-status"/);assert.match(html,/id="work-file-7-status"/);assert.match(html,/aria-labelledby="work-file-7-label"/);assert.match(html,/id="work-file-7-label"/);assert.doesNotMatch(html,/id="other"|type="text"/);
});
