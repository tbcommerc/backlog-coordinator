import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../js/components/notifications.js', import.meta.url), 'utf8');

assert.match(source, /closest\('\.notification-card'\)/, 'actions must target the current notification card');
assert.doesNotMatch(source, /closest\('\.notification-item'\)/, 'legacy card selector must not return');
assert.match(source, /\/notifications\/\$\{id\}\/resolve/, 'resolve action must call its API endpoint');
assert.match(source, /app\.api\.delete\(`\/notifications\/\$\{id\}`\)/, 'dismiss action must call delete endpoint');
assert.match(source, /\/notifications\/\$\{id\}\/restore/, 'dismiss must provide a recoverable undo action');
assert.match(source, /requires_action/, 'requires-action filter must be connected to the API');
assert.match(source, /unread_only/, 'unread filter must be connected to the API');
assert.match(source, /id="notification-category"/, 'category filter must use a compact select control');
assert.doesNotMatch(source, /data-stat-view/, 'summary must not duplicate the primary state filter');
assert.match(source, /<time datetime=/, 'notification time must be machine-readable');
assert.match(source, /notification-time-group/, 'notifications must be grouped by time');
assert.match(source, /notification-unread-dot/, 'unread state must have its own visual marker');
assert.match(source, /aria-label="Другие действия"/, 'secondary actions must expose an accessible menu trigger');
assert.match(source, /Больше не требует внимания/, 'resolve wording must describe its inbox effect');
assert.match(source, /#\/settings\?section=notifications/, 'settings action must open notification preferences directly');
assert.doesNotMatch(source, /IntersectionObserver/, 'explicit load-more control must remain available');

console.log('notificationsComponent.test.mjs: OK');
