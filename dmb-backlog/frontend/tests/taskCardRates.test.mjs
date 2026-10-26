import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCompetencyRateTable,
  competencyRateForYear,
  deadlineYearFromReference,
} from '../js/taskCardRates.js';

const references = [
  { id: 1, code: 'Q4_2025', name: 'IV квартал 2025' },
  { id: 2, code: 'Y2026', name: '2026 год' },
  { id: 3, code: 'no_deadline', name: 'Без срока' },
];

test('год ставки определяется из code дедлайна так же, как на backend', () => {
  assert.equal(deadlineYearFromReference({ id: 1, name: 'другое' }, references), 2025);
  assert.equal(deadlineYearFromReference({ name: '2026 год' }, references), 2026);
  assert.equal(deadlineYearFromReference({ id: 3, name: 'Без срока' }, references), null);
});

test('карточка берёт ставку года дедлайна и актуальную при отсутствии точного года', () => {
  const table = buildCompetencyRateTable([
    { competency: 'Delivery', year: 2025, rate: '10000', is_active: true },
    { competency: 'Delivery', year: 2026, rate: '12000', is_active: true },
    { competency: 'Delivery', year: 2027, rate: '15000', is_active: false },
  ]);
  assert.equal(competencyRateForYear(table, 'Delivery', 2025), 10000);
  assert.equal(competencyRateForYear(table, 'Delivery', 2024), 12000);
  assert.equal(competencyRateForYear(table, 'Delivery'), 12000);
  assert.equal(competencyRateForYear(table, 'Unknown', 2025), 0);
});

test('некорректные ставки не попадают в расчёт', () => {
  const table = buildCompetencyRateTable([
    null,
    { competency: '', year: 2026, rate: 100 },
    { competency: 'FE', year: 'bad', rate: 100 },
    { competency: 'FE', year: 2026, rate: 'bad' },
  ]);
  assert.equal(competencyRateForYear(table, 'FE', 2026), 0);
});
