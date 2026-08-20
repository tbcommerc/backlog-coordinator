import { escapeHtml } from '../htmlUtils.js';

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return escapeHtml((parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0][0] || '?').toUpperCase());
}

function avatarColor(name) {
  const colors = ['#6366f1','#8b5cf6','#a855f7','#ec4899','#f43f5e','#f97316','#f59e0b','#10b981','#06b6d4','#0ea5e9'];
  let hash = 0;
  for (const char of String(name || '')) hash = char.charCodeAt(0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function commentTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const diff = Date.now() - date;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return 'Только что';
  if (mins < 60) return `${mins} мин. назад`;
  if (hours < 24) return `${hours} ч. назад`;
  if (days < 7) return `${days} д. назад`;
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function renderComment(comment, users, depth = 0) {
  const name = comment.user_name || 'Пользователь';
  let text = escapeHtml(comment.text);
  for (const user of users) {
    if ((comment.mentioned_user_ids || []).includes(user.id)) {
      const escapedName = escapeHtml(user.name);
      const pattern = new RegExp(`@${escapedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
      text = text.replace(pattern, `<span class="comment-mention">@${escapedName}</span>`);
    }
  }
  const replies = (comment.replies || []).map(reply => renderComment(reply, users, depth + 1)).join('');
  return `<div class="comment-item${depth ? ' comment-item-reply' : ''}">
    <div class="task-detail-avatar" style="width:32px;height:32px;background:${avatarColor(name)};font-size:12px;flex-shrink:0;">${initials(name)}</div>
    <div class="comment-body">
      <div class="comment-header"><span class="comment-author">${escapeHtml(name)}</span><span class="comment-time">${escapeHtml(commentTime(comment.created_at))}</span></div>
      <div class="comment-text">${text}</div>
      <div class="comment-actions"><button class="comment-reply-btn" data-reply-id="${Number(comment.id) || 0}" data-reply-name="${escapeHtml(name)}">Ответить</button></div>
      ${replies ? `<div class="comment-replies">${replies}</div>` : ''}
    </div>
  </div>`;
}

export function renderComments(container, comments, users) {
  if (!container) return;
  const items = Array.isArray(comments) ? comments : [];
  container.innerHTML = items.length
    ? `<div class="comments-feed">${items.map(item => renderComment(item, users || [])).join('')}</div>`
    : '<div class="text-muted" style="text-align:center;padding:20px;">Комментариев пока нет</div>';
  container.querySelectorAll('[data-reply-id]').forEach(button => {
    button.addEventListener('click', () => {
      window.__setReplyTo?.(Number(button.dataset.replyId), button.dataset.replyName || 'Пользователь');
    });
  });
}

export function renderMentionOptions(dropdown, users) {
  dropdown.innerHTML = users.map((user, index) => {
    const displayName = user.name || user.login || user.email || '';
    return `<div class="mention-item${index === 0 ? ' selected' : ''}" data-user-id="${Number(user.id) || 0}" data-user-name="${escapeHtml(displayName)}">
      <div class="task-detail-avatar" style="width:24px;height:24px;background:${avatarColor(displayName)};font-size:9px;">${initials(displayName)}</div>
      <span>${escapeHtml(displayName)}</span>
    </div>`;
  }).join('');
}
