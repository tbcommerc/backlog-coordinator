import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { decodeCsvContent, parseCsvRows } from '../js/taskCsv.js';

test('CSV decoding and parsing preserves BOM encodings, blank prefix and quoted newline', () => {
  const text = '\r\n  \r\ntitle;team_id;description\r\nТест;Команда;"first\r\nsecond"\r\n';
  const le = Buffer.from('\ufeff' + text, 'utf16le');
  const be = Buffer.from(le); be.swap16();
  for (const bytes of [Buffer.from('\ufeff' + text), le, be]) {
    const result = parseCsvRows(decodeCsvContent(bytes));
    assert.equal(result.delimiter, ';');
    assert.deepEqual(result.rows[1], ['Тест', 'Команда', 'first\r\nsecond']);
  }
  assert.equal(decodeCsvContent(Uint8Array.from([0xd2,0xe5,0xf1,0xf2])), 'Тест');
  assert.throws(() => decodeCsvContent(Buffer.from('title;team_id', 'utf16le')), /BOM/);
});

test('delimiter ignores punctuation inside quoted headers', () => {
  assert.equal(parseCsvRows('title,team_id,"notes;extra"\nOne,Team,value').delimiter, ',');
  assert.deepEqual(parseCsvRows('title;team_id\n ; \nOne;Team').rows, [['title','team_id'],['One','Team']]);
});

test('IMP-02 actual modal validation treats technical keys and labels identically', () => {
  const source = readFileSync(new URL('../js/components/modal.js', import.meta.url), 'utf8');
  const start = source.indexOf("  const REQUIRED_IMPORT_FIELDS =");
  const end = source.indexOf('  function fieldLabel(', start);
  const helperStart = source.indexOf('  function _normHeader(');
  const helperEnd = source.indexOf('  function renderPreview()', helperStart);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end) + '\nfunction fieldLabel(key) { return FIELD_LABEL_FALLBACK[key] || key; }\n' + source.slice(helperStart, helperEnd), context);
  const rows = [['', 'Team', '2026-02-30', '101', 'bad']];
  const keys = ['title','team_id','date_received','progress','financial_effect'];
  context.keys = keys; context.rows = rows;
  const counts = vm.runInContext('JSON.stringify([validateRows({headers: keys, rows}), validateRows({headers: keys.map(fieldLabel), rows})].map(x => x.map(e => e.message)))', context);
  const [technical, labels] = JSON.parse(counts);
  assert.equal(technical.length, 4);
  assert.deepEqual(technical, labels);
});
