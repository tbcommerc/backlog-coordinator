import { escapeHtml } from '../htmlUtils.js';

import { formatFileSize } from '../ui/dataDisplay.js';

function getFileIcon(mimeType) {
  const type = String(mimeType || '');
  if (type.startsWith('image/')) return '🖼️';
  if (type.includes('pdf')) return '📕';
  if (type.includes('word') || type.includes('document')) return '📘';
  if (type.includes('sheet') || type.includes('excel')) return '📗';
  if (type.includes('presentation') || type.includes('powerpoint')) return '📙';
  if (/(zip|rar|7z|tar)/.test(type)) return '🗜️';
  if (type.startsWith('text/')) return '📝';
  return '📄';
}

function renderAttachmentItem(attachment, canDelete, variant = '') {
  const taskId = Number(attachment.task_id) || 0;
  const attachmentId = Number(attachment.id) || 0;
  const size = formatFileSize(attachment.file_size);
  const date = attachment.created_at
    ? new Date(attachment.created_at).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';
  const fileName = escapeHtml(attachment.original_name || 'Файл');
  return `<article class="attachment-item" data-id="${attachmentId}" role="listitem" aria-label="Файл ${fileName}">
    <div class="attachment-item-icon" aria-hidden="true">${variant === 'task-detail' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>' : getFileIcon(attachment.mime_type)}</div>
    <div class="attachment-item-info">
      <div class="attachment-item-name">
        <button type="button" class="ui-link attachment-download-link${variant === 'task-detail' ? ' ui-task-file-name' : ''}" onclick="window.__downloadAttachment(${taskId}, ${attachmentId})" aria-label="Скачать ${fileName}">${fileName}</button>
      </div>
      <div class="attachment-item-meta">
        ${size ? `<span>${size}</span>` : ''}
        ${attachment.user_name ? `<span>${escapeHtml(attachment.user_name)}</span>` : ''}
        ${date ? `<span>${escapeHtml(date)}</span>` : ''}
      </div>
    </div>
    <div class="ui-task-file-actions">${variant === 'task-detail' ? `<button type="button" class="btn btn-ghost btn-sm square-icon ui-btn" aria-label="Скачать ${fileName}" onclick="window.__downloadAttachment(${taskId}, ${attachmentId})"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5"/></svg></button>` : ''}
    ${canDelete ? `<button type="button" class="btn btn-ghost btn-sm square-icon ui-btn ${variant === 'task-detail' ? 'ui-task-file-delete' : 'attachment-item-delete'}" title="Удалить файл" aria-label="Удалить ${fileName}" onclick="window.__deleteAttachment(${taskId}, ${attachmentId})">
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
    </button>` : ''}</div>
  </article>`;
}

export function renderAttachments(container, attachments, options = {}) {
  if (!container) return;
  const items = Array.isArray(attachments) ? attachments : [];
  const canDelete = options.canDelete !== false;
  container.innerHTML = items.length
    ? `<div class="attachments-list" role="list" aria-label="Вложения задачи">${items.map(item => renderAttachmentItem(item, canDelete, options.variant)).join('')}</div>`
    : '<div class="ui-component-empty" role="status">Вложений пока нет</div>';
}
