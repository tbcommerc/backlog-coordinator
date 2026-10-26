import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../js/components/agentChat.js', import.meta.url), 'utf8')
  .replace(/import \{ confirmAction \} from '\.\.\/uiFeedback\.js(?:\?v=\d+)?';/, 'const confirmAction = async () => false;')
  .replace(/import \{ enhanceDialogOverlay \} from '\.\.\/modalAccessibility\.js(?:\?v=\d+)?';/, 'const enhanceDialogOverlay = () => {};')
  .replace("'../ui/actionMenu.js'", JSON.stringify(new URL('../js/ui/actionMenu.js', import.meta.url).href));
const { getCoreRequirementProgress, renderCoreRequirementProgress, getDraftChanges } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const core = { need_statement: 'Нужна сверка', role: 'Оператор', process: 'Расчёты', to_be: 'Система показывает расхождения' };

const empty = getCoreRequirementProgress();
assert.equal(empty.count, 0);
assert.equal(empty.total, 4);
assert.equal(empty.nextSlot, 'need_statement');
assert.equal(empty.fields.every(field => field.state === 'empty'), true);

const partial = getCoreRequirementProgress({ ...core, to_be: '' });
assert.equal(partial.count, 3);
assert.equal(partial.nextSlot, 'to_be');
assert.match(partial.message, /результат/);

const ordered = getCoreRequirementProgress({ role: 'Оператор' }, [], { expectedSlot: 'process' });
assert.equal(ordered.count, 1, 'filling is not tied to a linear interview sequence');
assert.equal(ordered.nextSlot, 'process');

for (const value of ['Не знаю', 'Не знаю, нужно уточнить', 'Не применимо', 'Неизвестно.', 'Затрудняюсь']) {
  const model = getCoreRequirementProgress({ ...core, role: value });
  assert.equal(model.count, 3, `${value} must not count as a fact`);
  assert.equal(model.fields.find(field => field.key === 'role').state, 'unknown');
}

const skipped = getCoreRequirementProgress({ ...core, role: '' }, [{ key: 'role', skipped: true }]);
assert.equal(skipped.count, 3);
assert.equal(skipped.fields[1].state, 'unknown');
const confidence = getCoreRequirementProgress(core, [{ key: 'role', needs_review: true }], { canGenerate: true });
assert.equal(confidence.count, 4, 'a captured answer and the need to verify it are different signals');
assert.equal(confidence.fields[1].state, 'review');
assert.match(confidence.message, /Проверьте/);

const complete = getCoreRequirementProgress({ ...core, product: 'Не знаю', risks: '' }, [], { canGenerate: true });
assert.equal(complete.count, 4, 'optional fields must not change the denominator');
assert.match(complete.message, /можно сформировать черновик/);

const blocked = getCoreRequirementProgress(core, [], { draft: {
  review_findings: [{ field: 'business_rules', severity: 'error', message: 'Конфликт правил' }],
} });
assert.equal(blocked.count, 4);
assert.match(blocked.message, /исправьте 1 блокер/);
assert.doesNotMatch(blocked.message, /можно.*отправ/);
const coreConflict = getCoreRequirementProgress(core, [], { draft: {
  review_findings: [{ field: 'primary_role', severity: 'error', message: 'Нужно проверить роль' }],
} });
assert.equal(coreConflict.fields[1].state, 'review');

const savedDraft = getCoreRequirementProgress(core, [], { draft: { review_findings: [] } });
assert.match(savedDraft.message, /проверьте его перед отправкой/);
const reverted = getCoreRequirementProgress({ ...core, process: 'Не знаю' });
assert.equal(reverted.count, 3, 'an edit can reduce progress again');

const markup = renderCoreRequirementProgress();
assert.equal((markup.match(/data-core-field="/g) || []).length, 4);
assert.equal((markup.match(/data-core-segment="/g) || []).length, 4);
assert.match(markup, /aria-live="polite"/);
assert.match(markup, /<button[^>]+id="chat-interview-progress-text"/, 'the compact status must remain an accessible field shortcut');
assert.doesNotMatch(markup, /tabindex="-1"/);
const progressPosition = source.indexOf('${renderCoreRequirementProgress()}');
assert.ok(progressPosition > source.indexOf('id="requirement-map-card"'), 'progress must be rendered inside the requirement document');
assert.ok(progressPosition < source.indexOf('id="requirement-map-fields"'), 'progress must precede requirement fields');
assert.ok(!source.slice(source.indexOf('class="chat-input-area"'), source.indexOf('class="chat-input-wrapper"')).includes('renderCoreRequirementProgress'), 'the composer must not contain the progress block');
assert.match(source, /tabCount\.textContent = `\$\{model\.count\}\/\$\{model\.total\}`/, 'the mobile requirement tab must expose compact progress');
assert.match(source, /text\.dataset\.coreProgressSlot = model\.nextSlot \|\| ''/, 'the compact status must open the next required field');
console.log('agentCoreProgress.test.mjs: OK');

// Comparison uses the accepted draft, covers dialogue edits, and never crosses draft IDs.
assert.deepEqual(getDraftChanges(null, core), []);
assert.deepEqual(getDraftChanges({ id: 'a', process: 'Old' }, { id: 'b', process: 'New' }), []);
const changes = getDraftChanges(
  { id: 'a', primary_role: 'Оператор', affected_users: ['Аналитик'], process: 'Расчёты' },
  { id: 'a', primary_role: 'Контролёр', affected_users: ['Аналитик', 'Аудитор'], process: 'Расчёты' },
);
assert.equal(changes.length, 2);
assert.deepEqual(changes.map(change => change.field), ['primary_role', 'affected_users']);
assert.equal(changes[0].before, 'Оператор');
assert.equal(changes[1].after, 'Аналитик; Аудитор');
