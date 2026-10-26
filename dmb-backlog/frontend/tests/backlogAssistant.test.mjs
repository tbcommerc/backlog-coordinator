import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAnswer, safeNavigator } from '../js/backlog-assistant/answer.js';
import { contextFromLocation, terminal, stateFor } from '../js/backlog-assistant/state.js';
import { renderPage } from '../js/backlog-assistant/page.js';
import { assistantApi } from '../js/backlog-assistant/api.js';

test('answer escapes model and server text and rejects external links', () => {
    const html = renderAnswer({ kind: 'answer', summary_claims: [{ type: 'fact', text: '<img onerror=alert(1)>' }],
        verified_blocks: [{ items: [{ title: '<script>bad</script>', navigator: 'javascript:alert(1)' }], total: 1 }],
        sources: [], limitations: [], coverage: {} });
    assert.ok(!html.includes('<script>') && !html.includes('<img'));
    assert.ok(!html.includes('javascript:'));
    assert.equal(safeNavigator('https://evil.invalid'), null);
    assert.equal(safeNavigator('#/backlog?task=1&tab=main'), '#/backlog?task=1&tab=main');
});
test('context does not infer arbitrary page filters or identity', () => {
    assert.equal(contextFromLocation('#/backlog?task=17&user_id=2').object_ref, 'task:17');
    assert.equal(contextFromLocation('#/customer/request/5').filters.object_type, 'request');
    assert.equal(contextFromLocation('#/backlog?task=bad').object_ref, null);
});
test('states are isolated and cancelled is terminal', () => {
    assert.notEqual(stateFor(1), stateFor(2));
    assert.equal(terminal('running'), false);
    assert.equal(terminal('cancelled'), true);
});
test('page and panel have distinct labelled textarea ids and live status', () => {
    const one = renderPage(), two = renderPage();
    assert.notEqual(one.match(/id="(ba-question-\d+)"/)[1], two.match(/id="(ba-question-\d+)"/)[1]);
    assert.match(one, /aria-live="polite"/);
    assert.match(one, /maxlength="8000"/);
});
test('transport preserves explicit idempotency key and marks polls passive', async () => {
    const calls = [];
    const api = assistantApi({ post: (...args) => calls.push(args), get: (...args) => calls.push(args) });
    await api.create({}, 'stable-key'); await api.run('run-id');
    assert.equal(calls[0][2].idempotencyKey, 'stable-key');
    assert.equal(calls[1][1].passive, true);
});


test('card description, request decision and history remain visible and escaped', () => {
    const html = renderAnswer({kind:'answer',verified_blocks:[{items:[{title:'Card',description:'<script>bad</script>',review_comment:'Нет владельца'}],history:[{field:'status_id',old:'1',new:'2',at:'2026-10-01'}],history_total:1,comments:[{text:'<img src=x onerror=alert(1)>'}],comments_total:1}],sources:[]});
    assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
    assert.ok(html.includes('Нет владельца'));
    assert.ok(html.includes('История изменений'));
    assert.ok(html.includes('&lt;img'));
    assert.ok(!html.includes('<script>'));
});


test('applied search terms are visible and escaped', () => {
    const html=renderAnswer({kind:'answer', verified_blocks:[{items:[], total:0, search_terms:[{term:'<script>',tokens:['<img>']}]}]});
    assert.match(html, /Условия поиска/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
});
