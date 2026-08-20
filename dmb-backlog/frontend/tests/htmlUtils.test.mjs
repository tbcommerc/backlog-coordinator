import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/htmlUtils.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { escapeHtml } = await import(moduleUrl);

const payload = `<img src=x onerror="alert('xss')"><script>alert(1)</script>&`;
const escaped = escapeHtml(payload);

assert.equal(
  escaped,
  '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;',
);
assert.ok(!escaped.includes('<script>'));
assert.ok(!escaped.includes('<img'));
assert.equal(escapeHtml(null), '');

console.log('htmlUtils XSS tests passed');
