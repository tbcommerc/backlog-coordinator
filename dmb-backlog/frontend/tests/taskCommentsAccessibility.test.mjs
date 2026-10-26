import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { focusCommentTarget, renderComments, renderMentionOptions } from '../js/components/taskComments.js';

const componentsCss = readFileSync(new URL('../css/components.css', import.meta.url), 'utf8');

test('comments expose stable deep-link targets and accessible reply actions', () => {
  const container = {
    innerHTML: '',
    querySelectorAll: () => [],
  };

  renderComments(container, [{
    id: 42,
    user_name: 'Анна Смирнова',
    text: 'Проверить расчёт',
    mentioned_user_ids: [],
    replies: [],
  }], []);

  assert.match(container.innerHTML, /role="feed"/);
  assert.match(container.innerHTML, /id="task-comment-42"/);
  assert.match(container.innerHTML, /data-comment-id="42"/);
  assert.match(container.innerHTML, /aria-label="Ответить пользователю Анна Смирнова"/);
  assert.match(container.innerHTML, /type="button"/);
});

test('mention suggestions use listbox and option semantics', () => {
  const attributes = new Map();
  const dropdown = {
    innerHTML: '',
    setAttribute: (name, value) => attributes.set(name, value),
  };

  renderMentionOptions(dropdown, [
    { id: 7, name: 'Иван Иванов' },
    { id: 8, name: 'Мария Петрова' },
  ]);

  assert.equal(attributes.get('role'), 'listbox');
  assert.equal(attributes.get('aria-label'), 'Пользователи для упоминания');
  assert.match(dropdown.innerHTML, /id="mention-option-7" role="option" aria-selected="true"/);
  assert.match(dropdown.innerHTML, /id="mention-option-8" role="option" aria-selected="false"/);
});

test('comment deep-link focuses and highlights the requested comment', () => {
  const calls = [];
  const target = {
    classList: { add: name => calls.push(['add', name]) },
    scrollIntoView: options => calls.push(['scroll', options.block]),
    focus: options => calls.push(['focus', options.preventScroll]),
  };
  const container = {
    querySelector: selector => selector === '[data-comment-id="42"]' ? target : null,
    querySelectorAll: () => [],
  };

  assert.equal(focusCommentTarget(container, 42), true);
  assert.deepEqual(calls, [
    ['add', 'is-targeted'],
    ['scroll', 'center'],
    ['focus', true],
  ]);
  assert.equal(focusCommentTarget(container, 'bad-id'), false);
});

test('targeted comment keeps a visible focus cue across themes and reduced motion', () => {
  assert.match(componentsCss, /\.comment-item\.is-targeted\s*\{[\s\S]*?border-color:\s*var\(--accent\)/);
  assert.match(componentsCss, /\.comment-item\.is-targeted::before\s*\{/);
  assert.match(componentsCss, /\.comment-item\.is-targeted:focus-visible\s*\{[\s\S]*?outline:/);
  assert.match(componentsCss, /\[data-theme="dark"\]\s+\.comment-item\.is-targeted\s*\{/);
  assert.match(componentsCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.comment-item\.is-targeted\s*\{[\s\S]*?animation:\s*none/);
});

test('read-only comments keep the feed but omit reply actions', () => {
  const container = {
    innerHTML: '',
    querySelectorAll: () => [],
  };
  renderComments(container, [{ id: 5, text: 'Read only', user_name: 'User', replies: [] }], [], { canReply: false });
  assert.match(container.innerHTML, /role="feed"/);
  assert.doesNotMatch(container.innerHTML, /data-reply-id=/);
  assert.doesNotMatch(container.innerHTML, /comment-reply-btn/);
});
