import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const component = readFileSync(new URL('../js/components/outboxDeadLetters.js', import.meta.url), 'utf8');
const router = readFileSync(new URL('../js/router.js', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../js/components/sidebar.js', import.meta.url), 'utf8');

assert.match(component, /\/admin\/outbox\/dead-letters\?/);
assert.match(component, /expected_attempts: attempts/);
assert.match(component, /client_request_id: crypto\.randomUUID\(\)/);
assert.match(component, /confirmAction\(/);
assert.match(component, /escapeHtml\(JSON\.stringify/);
assert.match(component, /Ошибки доставки событий/);
assert.match(component, /Ошибок доставки нет/);
assert.match(component, /outbox-overview-metrics/);
assert.match(component, /outbox-search-field/);
assert.match(component, /outbox-error-message/);
assert.match(component, /icon: 'rotate-ccw'/);
assert.match(component, /data-label="Причина"/);
assert.doesNotMatch(component, />Dead-letter outbox</);
assert.doesNotMatch(component, /innerHTML\s*=\s*item\.payload/);

assert.match(router, /requiresFullAdmin = [^;]*path === '\/outbox-dead-letters'/);
assert.match(router, /requiresFullAdmin && adminAccess !== 'full'/);
assert.match(sidebar, /adminAccess === 'full'/);
assert.match(sidebar, /Ошибки доставки/);
assert.match(sidebar, /data-lucide="alert-triangle"/);
assert.doesNotMatch(sidebar, /data-lucide="triangle-alert"/);

console.log('outboxDeadLetters.test.mjs: OK');
