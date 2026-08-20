import assert from 'node:assert/strict';
import {
  acquireDictionaryLock,
  getDictionaryChanges,
  persistDictionaryItems,
  releaseDictionaryLock,
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
  items: [{ id: 1, name: '<Высокий>', code: 'HIGH', color: '#ff0000' }],
}, {
  escapeHtml,
  safeHexColor: value => value,
  autoDictColor: () => '#64748b',
  dictCodePlaceholder: () => 'Код',
});
assert.match(form, /&lt;Приоритеты&gt;/);
assert.ok(!form.includes('<Высокий>'));

const changes = getDictionaryChanges(
  [{ id: 1, name: 'Изменён', code: 'A', color: '' }, { id: null, name: 'Новый', code: 'B', color: '' }],
  [{ id: 1 }, { id: 2 }],
);
assert.deepEqual(changes.deleteIds, [2]);

const calls = [];
const app = { api: {
  post: async (url, payload) => calls.push(['post', url, payload]),
  put: async (url, payload) => calls.push(['put', url, payload]),
  delete: async url => calls.push(['delete', url]),
} };
await persistDictionaryItems(app, 'priorities', changes.validItems, changes.deleteIds);
assert.deepEqual(calls.map(call => call.slice(0, 2)), [
  ['put', '/admin/priorities/1'],
  ['post', '/admin/priorities'],
  ['delete', '/admin/priorities/2'],
]);
assert.equal(await acquireDictionaryLock(app, 'tags'), 'tag');
await releaseDictionaryLock(app, 'tag');
assert.deepEqual(calls.at(-2).slice(0, 2), ['post', '/admin/tag/lock']);
assert.deepEqual(calls.at(-1), ['delete', '/admin/tag/lock']);
