import assert from 'node:assert/strict';
import test from 'node:test';

import { renderTaskCardMarkdown } from '../js/taskCardMarkdown.js';

test('описание задачи форматирует базовый Markdown', () => {
  const html = renderTaskCardMarkdown([
    '### Контекст',
    '',
    '**Важно:** проверить `payload`.',
    '',
    '- Первый пункт',
    '- Второй пункт',
  ].join('\n'));

  assert.match(html, /<h5>Контекст<\/h5>/);
  assert.match(html, /<strong>Важно:<\/strong>/);
  assert.match(html, /<code>payload<\/code>/);
  assert.match(html, /<ul><li>Первый пункт<\/li><li>Второй пункт<\/li><\/ul>/);
});

test('сырой HTML экранируется и не превращается в исполняемую разметку', () => {
  const html = renderTaskCardMarkdown('<img src=x onerror=alert(1)> **текст**');

  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<strong>текст<\/strong>/);
});

test('ссылки используют allow-list безопасных схем', () => {
  const html = renderTaskCardMarkdown([
    '[Документация](https://example.com/docs)',
    '[Внутренняя](#/tasks)',
    '[Протокольная](//evil.example/path)',
    '[Опасная](javascript:alert(1))',
  ].join('\n'));

  assert.match(html, /href="https:\/\/example\.com\/docs" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /href="#\/tasks"/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.doesNotMatch(html, /href="\/\/evil\.example/i);
  assert.match(html, /Опасная\)/);
});

test('блоки кода экранируют содержимое', () => {
  const html = renderTaskCardMarkdown('```js\n<script>alert(1)</script>\n```');

  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/i);
});

test('пустое описание сохраняет прежнее нейтральное состояние', () => {
  assert.equal(renderTaskCardMarkdown('  '), '<p>—</p>');
});
