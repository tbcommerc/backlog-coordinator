import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNotificationTarget, resolveNotificationTarget } from '../js/notificationUtils.js';
test('work target never aliases a Task id',()=>{
 assert.equal(resolveNotificationTarget({category:'work',target:{kind:'work',url:'/work-tasks/42',work_task_id:42}}),'/work-tasks/42');
});
test('work target rejects unexpected origins and parameters',()=>{
 for(const url of ['https://other.example/work-tasks/42','//other.example/work-tasks/42','/work-tasks/42?task=8','/work-tasks/0','/work-tasks/42#extra']) assert.equal(normalizeNotificationTarget(url),'');
});
