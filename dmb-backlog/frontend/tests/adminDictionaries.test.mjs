import assert from 'node:assert/strict';
import {
  acquireDictionaryLock,
  getDictionaryChanges,
  persistDictionaryItems,
  releaseDictionaryLock,
  renderCompetencyCostDictionaryForm,
  renderDictionariesTab,
  renderDictionaryForm,
} from '../js/components/adminDictionaries.js';

const escapeHtml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const html = renderDictionariesTab(
  {
    priorities: [{ name: '<script>priority</script>', color: '#ff0000' }],
    competencyCosts: [
      { competency: 'Frontend', year: 2025, rate: 100 },
      { competency: 'Frontend', year: 2026, rate: 120 },
    ],
  },
  {
    priority: { locked: true, is_mine: false, lock_owner_name: '<Admin>' },
  },
  escapeHtml,
);

assert.match(html, /data-dict="priorities"/);
assert.match(html, /Стоимость компетенций/);
assert.match(html, /Frontend: 120/);
assert.match(html, /&lt;Admin&gt;/);
assert.ok(!html.includes('<script>priority</script>'));

const form = renderDictionaryForm({
  dictKey: 'priorities',
  dictLabel: '<Приоритеты>',
  items: [{ id: 1, name: '<Высокий>', code: 'HIGH', color: '#ff0000', usage_count: 12 }, { id: 2, name: 'Архивный', code: 'OLD', color: '#777777', is_active: false, usage_count: 3 }],
}, {
  escapeHtml,
  safeHexColor: value => value,
  autoDictColor: () => '#64748b',
  dictCodePlaceholder: () => 'Код',
});
assert.match(form, /&lt;Приоритеты&gt;/);
assert.ok(!form.includes('<Высокий>'));
assert.match(form, /id="dict-search"/);
assert.match(form, /dict-drag-handle/);
assert.match(form, /dict-usage-badge/);
assert.match(form, />12</);
assert.match(form, /dict-restore-btn/);
assert.match(form, /id="dict-archive"/);

const competencyForm = renderCompetencyCostDictionaryForm({
  dictLabel: 'Стоимость компетенций',
  items: [{ id: 1, competency: 'Frontend', year: 2026, rate: 120 }],
}, escapeHtml);
assert.match(competencyForm, /id="cc-inline-editor" hidden/);
assert.match(competencyForm, /id="cc-inline-value"/);
assert.match(competencyForm, /id="cc-inline-confirm"/);
assert.match(competencyForm, /id="cc-inline-cancel"/);
assert.match(competencyForm, /type="button"[^>]+id="cc-add-year"/);

const changes = getDictionaryChanges(
  [{ id: 1, name: 'Изменён', code: 'A', color: '' }, { id: null, name: 'Новый', code: 'B', color: '' }],
  [{ id: 1 }, { id: 2 }],
);
assert.deepEqual(changes.deleteIds, [2]);

const calls = [];
const app = { api: {
  post: async (url, payload) => { calls.push(['post', url, payload]); return { version: 7 }; },
  put: async (url, payload) => { calls.push(['put', url, payload]); return { items: [], added: 1, updated: 1, archived: 1 }; },
  delete: async url => calls.push(['delete', url]),
} };
await persistDictionaryItems(app, 'priorities', changes.validItems, 7);
assert.deepEqual(calls.map(call => call.slice(0, 2)), [
  ['put', '/admin/dictionaries/priority/batch'],
]);
assert.equal(calls[0][2].version, 7);
assert.deepEqual(calls[0][2].items.map(item => item.name), ['Изменён', 'Новый']);
assert.deepEqual(await acquireDictionaryLock(app, 'tags'), { type: 'tag', version: 7 });
await releaseDictionaryLock(app, 'tag');
assert.deepEqual(calls.at(-2).slice(0, 2), ['post', '/admin/tag/lock']);
assert.deepEqual(calls.at(-1), ['delete', '/admin/tag/lock']);
