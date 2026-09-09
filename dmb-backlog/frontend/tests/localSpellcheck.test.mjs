import assert from 'node:assert/strict';
import test from 'node:test';

import { isSpellcheckEligible, prepareSpellcheckControl } from '../js/localSpellcheck.js';

function control(overrides = {}) {
  const attributes = overrides.attributes || {};
  return {
    tagName: 'INPUT',
    type: 'text',
    id: '',
    name: '',
    className: '',
    inputMode: '',
    disabled: false,
    readOnly: false,
    dataset: {},
    lang: '',
    spellcheck: false,
    getAttribute(name) { return attributes[name] || null; },
    setAttribute(name, value) { attributes[name] = value; },
    ...overrides,
  };
}

test('native spellcheck covers semantic inputs and every textarea', () => {
  assert.equal(isSpellcheckEligible(control({ id: 'edit-title' })), true);
  assert.equal(isSpellcheckEligible(control({ tagName: 'TEXTAREA', id: 'comment-textarea' })), true);
  assert.equal(isSpellcheckEligible(control({ id: 'task-search-input', type: 'search' })), false);
});

test('native spellcheck excludes technical values and supports explicit policy', () => {
  assert.equal(isSpellcheckEligible(control({ id: 'jira-link' })), false);
  assert.equal(isSpellcheckEligible(control({ id: 'dictionary-code' })), false);
  assert.equal(isSpellcheckEligible(control({ id: 'ordinary-title', dataset: { spellcheck: 'off' } })), false);
  assert.equal(isSpellcheckEligible(control({ id: 'search-alias', dataset: { spellcheck: 'on' } })), true);
  assert.equal(isSpellcheckEligible(control({ id: 'title', readOnly: true })), false);
});

test('eligible controls use native Russian spellcheck without application panels', () => {
  const semantic = control({ tagName: 'TEXTAREA', id: 'status-textarea' });
  prepareSpellcheckControl(semantic);
  assert.equal(semantic.spellcheck, true);
  assert.equal(semantic.getAttribute('spellcheck'), 'true');
  assert.equal(semantic.lang, 'ru');
  assert.equal(semantic.dataset.nativeSpellcheckReady, 'true');

  const technical = control({ id: 'technical-search', type: 'search' });
  prepareSpellcheckControl(technical);
  assert.equal(technical.spellcheck, false);
  assert.equal(technical.getAttribute('spellcheck'), 'false');
});
