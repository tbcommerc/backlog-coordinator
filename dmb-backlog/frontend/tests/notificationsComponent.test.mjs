import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../js/components/notifications.js', import.meta.url), 'utf8');

assert.match(source, /closest\('\.notification-card'\)/, 'actions must target the current notification card');
assert.doesNotMatch(source, /closest\('\.notification-item'\)/, 'legacy card selector must not return');
assert.match(source, /\/notifications\/\$\{nid\}\/resolve/, 'resolve action must call its API endpoint');
assert.match(source, /app\.api\.delete\(`\/notifications\/\$\{nid\}`\)/, 'dismiss action must call delete endpoint');

console.log('notificationsComponent.test.mjs: OK');
