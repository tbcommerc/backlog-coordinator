import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {counter} from '../js/ui/dataDisplay.js';
import {detectReviewFamilies} from '../ui-catalog/build-review-inventory.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('quantity consumers cannot be captured by InfoChip compatibility aliases',()=>{
 const css=read('css/ui/info-chips.css');assert.doesNotMatch(css,/audit-total-badge|outbox-attempts/);
 for(const file of ['js/app.js','js/components/sidebar.js','js/components/auditLog.js','js/components/outboxDeadLetters.js'])assert.match(read(file),/import\s*\{[^}]*\bcounter\b[^}]*\}\s*from[^;]*ui\/dataDisplay\.js/,file);
 const css2=read('css/components.css');for(const re of [/\.notif-badge\s*\{([^}]*)\}/,/\.sidebar-item \.item-badge\s*\{([^}]*)\}/])assert.doesNotMatch(css2.match(re)?.[1]||'',/\b(?:height|width|min-width|padding|background|font-size)\s*:/);
});
test('Counter owns capped full names, hidden state and severity tones',()=>{
 assert.match(counter({value:0}),/>0<\/span>/);assert.match(counter({value:null}),/неизвестно/);assert.match(counter({value:1000,cap:99}),/aria-label="Количество: 1000"[^>]*>99\+</);assert.match(counter({hidden:true}),/ hidden/);for(const tone of ['warning','danger'])assert.match(counter({value:12,tone}),new RegExp('data-ui-tone="'+tone+'"'));
});

test('Counter discovery includes the count composed inside an aliased FilterChip',()=>{assert.ok(detectReviewFamilies("import {filterChip as customName} from '../ui/primitives.js'; customName();").some(h=>h.family==='counter'));});
