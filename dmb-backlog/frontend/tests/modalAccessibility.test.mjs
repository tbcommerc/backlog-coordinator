import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/modalAccessibility.js', import.meta.url), 'utf8');

assert.match(source, /aria-modal/);
assert.match(source, /aria-labelledby/);
assert.match(source, /event\.key === 'Escape'/);
assert.match(source, /event\.key !== 'Tab'/);
assert.match(source, /restoreFocus/);
assert.match(source, /MutationObserver/);
assert.match(source, /\.conflict-overlay/);
assert.match(source, /\.modal-backdrop/);
assert.match(source, /dialog/);
assert.match(source, /dialog\.close\(\)/);
assert.match(source, /const hasVisibleName = Boolean\(button\.textContent\.trim\(\)\)/);
assert.match(source, /if \(!hasVisibleName && !button\.hasAttribute\('aria-label'\)\)/);
