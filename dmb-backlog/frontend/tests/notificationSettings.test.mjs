import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../js/components/notificationPreferences.js', import.meta.url), 'utf8');

assert.match(source, /key: 'assignment'.*mandatory: true/, 'assignment must always be enabled');
assert.match(source, /key: 'reporting'.*mandatory: true/, 'reporting reminders must always be enabled');
assert.match(source, /key: 'mention'.*mandatory: true/, 'mentions must always be enabled');
assert.match(source, /key: 'comment'/, 'team comments must remain configurable');
assert.match(source, /Всегда включено/, 'mandatory state must be explicit to users');
assert.doesNotMatch(source, /notif-master-toggle/, 'there must be no misleading master switch');
assert.doesNotMatch(source, /key: '(?:risk|deadline|stale|attrs|status_change|express|system)'/, 'legacy settings must stay hidden');

console.log('notificationSettings.test.mjs: OK');
