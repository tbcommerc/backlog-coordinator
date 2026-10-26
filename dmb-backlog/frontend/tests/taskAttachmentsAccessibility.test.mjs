import assert from 'node:assert/strict';
import test from 'node:test';

import { renderAttachments } from '../js/components/taskAttachments.js';

function createContainer() {
  return { innerHTML: '' };
}

test('вложения объявлены списком, а действия имеют доступные имена', () => {
  const container = createContainer();
  renderAttachments(container, [{
    id: 7,
    task_id: 42,
    original_name: 'risk <map>.pdf',
    mime_type: 'application/pdf',
    file_size: 2048,
    user_name: 'Иван Петров',
    created_at: '2026-09-10T09:00:00Z',
  }]);

  assert.match(container.innerHTML, /role="list" aria-label="Вложения задачи"/);
  assert.match(container.innerHTML, /role="listitem"/);
  assert.match(container.innerHTML, /aria-label="Скачать risk &lt;map&gt;\.pdf"/);
  assert.match(container.innerHTML, /type="button" class="btn btn-ghost btn-sm square-icon ui-btn attachment-item-delete"/);
  assert.match(container.innerHTML, /aria-label="Удалить risk &lt;map&gt;\.pdf"/);
  assert.doesNotMatch(container.innerHTML, /risk <map>/);
});

test('пустой список вложений озвучивает состояние', () => {
  const container = createContainer();
  renderAttachments(container, []);
  assert.match(container.innerHTML, /role="status"/);
  assert.match(container.innerHTML, /Вложений пока нет/);
});

test('в read-only режиме файл можно скачать, но нельзя удалить', () => {
  const container = createContainer();
  renderAttachments(container, [{ id: 7, task_id: 42, original_name: 'audit.pdf' }], { canDelete: false });
  assert.match(container.innerHTML, /Скачать audit\.pdf/);
  assert.doesNotMatch(container.innerHTML, /attachment-item-delete/);
  assert.doesNotMatch(container.innerHTML, /__deleteAttachment/);
});
