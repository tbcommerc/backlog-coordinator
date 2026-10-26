import assert from 'node:assert/strict';

globalThis.window = {
  app: { store: { get: () => ({ role: 'Администратор' }) } },
};

const { columnFilters, getFilteredList, savedViewStateKey } = await import('../js/components/filterToolbar.js');

const tasks = [
  {
    id: 1,
    public_id: 'TASK-000-001',
    title: 'Мобильный кабинет',
    description: 'Новый сценарий клиента',
    status_name: 'В РАБОТЕ',
    business_customer_name: 'Розница',
    date_received: '2026-08-10',
    progress: 35,
    financial_effect: 12.5,
    did_demo: true,
    tags: [{ name: 'mobile' }, { name: 'important' }],
  },
  {
    id: 2,
    public_id: 'TASK-000-002',
    title: 'Архивный отчёт',
    description: '',
    status_name: 'ХОЛД',
    business_customer_name: null,
    date_received: '2026-07-01',
    progress: 80,
    financial_effect: null,
    did_demo: false,
    tags: [],
  },
];

function apply(key, values) {
  columnFilters.backlog = { [key]: new Set(values) };
  return getFilteredList('backlog', tasks).map(task => task.id);
}

assert.deepEqual(apply('status_name', ['В РАБОТЕ']), [1], 'select filters must use resolved task labels');
assert.deepEqual(apply('business_customer', ['Розница']), [1], 'customer filter must use the displayed customer name');
assert.deepEqual(apply('business_customer', ['__EMPTY__']), [2], 'select filters must support missing values');
assert.deepEqual(apply('description', ['__text__:клиента']), [1], 'text filters must match a fragment');
assert.deepEqual(apply('description', ['__EMPTY__']), [2], 'text filters must support missing values');
assert.deepEqual(apply('progress', ['__min__:30', '__max__:40']), [1], 'numeric filters must support inclusive ranges');
assert.deepEqual(apply('financial_effect', ['__EMPTY__']), [2], 'numeric filters must support missing values');
assert.deepEqual(apply('date_received', ['__from__:2026-08-01', '__to__:2026-08-31']), [1], 'date filters must support inclusive ranges');
assert.deepEqual(apply('tags', ['important']), [1], 'multi-value filters must match tag labels');
assert.deepEqual(apply('did_demo', ['Нет']), [2], 'boolean filters must expose Да/Нет values');

columnFilters.backlog = {
  status_name: new Set(['В РАБОТЕ']),
  progress: new Set(['__min__:30']),
};
assert.deepEqual(getFilteredList('backlog', tasks).map(task => task.id), [1], 'different filters must combine with AND');

columnFilters.backlog = {};

const legacySavedState = {
  toolbar: { search: '', sort: 'id-desc', filters: {} },
  page: { columns: { title: true }, columnOrder: ['title'] },
};
const normalizedAppliedState = {
  toolbar: { filters: {}, sort: 'id-desc', search: '' },
  page: { columnOrder: ['title', 'new_column'], columns: { title: true, new_column: false } },
};
const appliedBaseline = savedViewStateKey(normalizedAppliedState);
assert.notEqual(
  savedViewStateKey(legacySavedState),
  appliedBaseline,
  'a legacy saved view may differ structurally after new fields are normalized into it',
);
assert.equal(
  savedViewStateKey({ ...normalizedAppliedState, toolbar: { search: '', filters: {}, sort: 'id-desc' } }),
  appliedBaseline,
  'the applied baseline must ignore object key order and remain clean before user changes',
);
assert.notEqual(
  savedViewStateKey({ ...normalizedAppliedState, page: { ...normalizedAppliedState.page, columns: { title: false, new_column: false } } }),
  appliedBaseline,
  'a real user change must differ from the applied baseline',
);

console.log('filter toolbar behavior: OK');
