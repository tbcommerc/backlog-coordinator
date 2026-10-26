import test from 'node:test';
import assert from 'node:assert/strict';
import { newMeetingItem, reviewIssues, readTranscriptFile, renderMeetingCapture, meetingReviewSummary } from '../js/components/meetingCapture.js';

test('review summary counts missing facts without treating them as confirmation blockers', () => {
    const action = { ...newMeetingItem('a'), selected: true, link_choice: 'none', owner_text: '  ' };
    const agreement = { ...newMeetingItem('b'), kind: 'agreement', owner_text: 'Анна', due_date: '2026-10-17' };
    assert.deepEqual(meetingReviewSummary([action, agreement]), { total: 2, checked: 1, actions: 1, agreements: 1, missingOwner: 1, missingDate: 1 });
    assert.deepEqual(reviewIssues([action, agreement]), []);
    assert.equal(meetingReviewSummary([]).total, 0);
});

test('confirmation requires selection and an explicit link decision', () => {
    const item = newMeetingItem('one');
    assert.equal(item.selected, false);
    assert.ok(reviewIssues([item]).length);
    item.selected = true;
    assert.ok(reviewIssues([item]).length);
    item.link_choice = 'task';
    assert.ok(reviewIssues([item]).length);
    item.task_id = 42;
    assert.deepEqual(reviewIssues([item]), []);
    item.link_choice = 'none'; item.task_id = null;
    assert.deepEqual(reviewIssues([item]), []);
    item.title = '  ';
    assert.ok(reviewIssues([item]).length);
});

test('file upload validates extension, encoding, binary data and both size limits', async () => {
    const file = (text, name = 'Встреча.txt') => { const bytes = new TextEncoder().encode(text); return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer }; };
    assert.equal(await readTranscriptFile(file('Анна: подготовлю отчёт.')), 'Анна: подготовлю отчёт.');
    for (const value of [file(''), file('abc', 'x.docx'), file('abc\0'), file('x'.repeat(60001)), { name: 'x.txt', size: 240001 }]) await assert.rejects(readTranscriptFile(value));
    await assert.rejects(readTranscriptFile({ name: 'x.txt', size: 1, arrayBuffer: async () => new Uint8Array([255]).buffer }), /UTF-8/);
});

test('page has a dedicated workspace and announces errors accessibly', () => {
    const html = renderMeetingCapture();
    assert.match(html, /Поручения из встреч/);
    assert.match(html, /role="alert"/);
    assert.match(html, /Мои разборы встреч/);
});
