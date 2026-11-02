import assert from 'node:assert/strict';
import {test} from 'node:test';
import {filterValues,filterMatches,encodeFilterValues,filterSummaryOption,toggleFilterValues} from '../js/ui/filterValues.js';
import {directorateVisibleTasks} from '../js/components/directorateReport.js';
import {filterReportingStatusItems} from '../js/components/reportingStatuses.js';

test('OR within one filter preserves punctuation and AND between filters',()=>{
 const value=encodeFilterValues(['Команда, А','Команда Б']);
 assert.deepEqual(filterValues(value),['Команда, А','Команда Б']);
 assert.ok(filterMatches(value,'Команда, А'));assert.ok(!filterMatches(value,'Команда В'));
 const tasks=[{project_name:'А',task_type_name:'Цель'},{project_name:'Б',task_type_name:'Задача'},{project_name:'В',task_type_name:'Цель'}];
 assert.equal(directorateVisibleTasks(tasks,{project:'["А","Б"]',type:'Цель'}).length,1);
 assert.match(filterSummaryOption('["1","2"]',[{value:1,label:'Один'},{value:2,label:'Два'}]),/Один · Два/);
});

test('reporting status supports multiple teams and readiness states',()=>{
 const items=[{task_id:1,team_id:1,is_ready:true,text:'Готов'},{task_id:2,team_id:2,is_ready:false,text:'Черновик'},{task_id:3,team_id:3,is_ready:false,text:''}];
 assert.deepEqual(filterReportingStatusItems(items,{teamId:'["1","2"]',readiness:'["ready","drafts"]'}).map(x=>x.task_id),[1,2]);
});

test('category and state shortcuts preserve other selections and reset All',()=>{
 const selected=toggleFilterValues('assignment','reporting');
 assert.deepEqual(filterValues(selected),['assignment','reporting']);
 assert.equal(toggleFilterValues(selected,'assignment'),'reporting');
 assert.equal(toggleFilterValues(selected,''),'');
 assert.equal(toggleFilterValues('all','unread','all'),'unread');
 assert.deepEqual(filterValues(toggleFilterValues('unread','resolved','all')),['unread','resolved']);
 assert.equal(toggleFilterValues('["unread","resolved"]','all','all'),'all');
});
