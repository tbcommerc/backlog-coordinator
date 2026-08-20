import { escapeHtml } from '../htmlUtils.js';

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

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

function renderAttachmentItem(attachment) {
  const taskId = Number(attachment.task_id) || 0;
  const attachmentId = Number(attachment.id) || 0;
  const size = formatFileSize(attachment.file_size);
  const date = attachment.created_at
    ? new Date(attachment.created_at).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';
  return `<div class="attachment-item" data-id="${attachmentId}">
    <div class="attachment-item-icon">${getFileIcon(attachment.mime_type)}</div>
    <div class="attachment-item-info">
      <div class="attachment-item-name">
        <button type="button" class="attachment-download-link" onclick="window.__downloadAttachment(${taskId}, ${attachmentId})">${escapeHtml(attachment.original_name)}</button>
      </div>
      <div class="attachment-item-meta">
        ${size ? `<span>${size}</span>` : ''}
        ${attachment.user_name ? `<span>${escapeHtml(attachment.user_name)}</span>` : ''}
        ${date ? `<span>${escapeHtml(date)}</span>` : ''}
      </div>
    </div>
    <button class="attachment-item-delete" title="Удалить файл" onclick="window.__deleteAttachment(${taskId}, ${attachmentId})">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
    </button>
  </div>`;
}

export function renderAttachments(container, attachments) {
  if (!container) return;
  const items = Array.isArray(attachments) ? attachments : [];
  container.innerHTML = items.length
    ? `<div class="attachments-list">${items.map(renderAttachmentItem).join('')}</div>`
    : '';
}
