import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadMore,cursorPagination} from '../js/ui/specialized.js';
import {detectReviewFamilies} from '../ui-catalog/build-review-inventory.mjs';
const read=p=>readFileSync(new URL('../js/'+p,import.meta.url),'utf8');
test('append and cursor aliases remain in pagination discovery; tables are not tabs',()=>{
 const hits=detectReviewFamilies("import {loadMore as anotherName,cursorPagination as nextThing} from '../ui/specialized.js'; anotherName(); nextThing();");assert.ok(hits.some(h=>h.family==='pagination'));assert.ok(!detectReviewFamilies('<div role="table">text</div>').some(h=>h.family==='tabs'));
});
test('append family owns wording, known zero count and busy semantics',()=>{
 assert.match(loadMore({loaded:0,total:25}),/Загрузить ещё · 0 из 25/);assert.doesNotMatch(loadMore(),/из null/);assert.match(loadMore({loading:true}),/aria-busy="true"/);assert.match(loadMore({loading:true}),/disabled/);
});
test('cursor family preserves consumer context and disables absent directions',()=>{
 const html=cursorPagination({hasNext:true,nextAttrs:{'data-board-page':'ready','aria-label':'Следующие: К исполнению'}});assert.match(html,/data-board-page="ready"/);assert.match(html,/aria-label="Следующие: К исполнению"/);assert.match(html,/data-cursor-direction="previous"[^>]*disabled/);
});
test('append and cursor consumers cannot restore private controls',()=>{
 assert.match(read('components/workBoard.js'),/cursorPagination\(/);assert.doesNotMatch(read('components/workBoard.js'),/btn\('(?:Назад|Далее)'/);
 for(const p of ['components/reportingStatuses.js','components/notifications.js','backlog-assistant/answer.js'])assert.match(read(p),/\bloadMore\(/,p);
 assert.doesNotMatch(read('components/expressEstimate.js'),/loadMore\.textContent\s*=/);
});

test('real panel tabs use the shared navigation; URL navigation remains links',()=>{
 for(const file of ['admin','agentChat','directorateReport','modal','reportingStatuses','workTaskDrawer'])assert.match(read('components/'+file+'.js'),/tabNavigationTarget/,file);
 assert.match(read('components/settings.js'),/mountTabs/);
 assert.match(read('components/metrics.js'),/aria-current/);
 assert.match(read('components/reviewPage.js'),/href="#\/review/);
});
