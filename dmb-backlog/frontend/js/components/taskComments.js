import { escapeHtml } from '../htmlUtils.js';
import { avatar } from '../ui/dataDisplay.js';

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

function renderComment(comment, users, canReply, depth = 0) {
  const name = comment.user_name || 'Пользователь';
  const commentId = Number(comment.id) || 0;
  let text = escapeHtml(comment.text);
  for (const user of users) {
    if ((comment.mentioned_user_ids || []).includes(user.id)) {
      const escapedName = escapeHtml(user.name);
      const pattern = new RegExp(`@${escapedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
      text = text.replace(pattern, `<span class="comment-mention">@${escapedName}</span>`);
    }
  }
  const replies = (comment.replies || []).map(reply => renderComment(reply, users, canReply, depth + 1)).join('');
  return `<article class="comment-item${depth ? ' comment-item-reply' : ''}" id="task-comment-${commentId}" data-comment-id="${commentId}" tabindex="-1" aria-label="Комментарий пользователя ${escapeHtml(name)}">
    ${avatar({ name, className: 'task-detail-avatar' })}
    <div class="comment-body">
      <div class="comment-header"><span class="comment-author">${escapeHtml(name)}</span><span class="comment-time">${escapeHtml(commentTime(comment.created_at))}</span></div>
      <div class="comment-text">${text}</div>
      ${canReply ? `<div class="comment-actions"><button type="button" class="btn btn-secondary btn-sm ui-btn comment-reply-btn" data-reply-id="${commentId}" data-reply-name="${escapeHtml(name)}" aria-label="Ответить пользователю ${escapeHtml(name)}">Ответить</button></div>` : ''}
      ${replies ? `<div class="comment-replies">${replies}</div>` : ''}
    </div>
  </article>`;
}

export function renderComments(container, comments, users, options = {}) {
  if (!container) return;
  const items = Array.isArray(comments) ? comments : [];
  const canReply = options.canReply !== false;
  container.innerHTML = items.length
    ? `<div class="comments-feed" role="feed" aria-label="Комментарии задачи">${items.map(item => renderComment(item, users || [], canReply)).join('')}</div>`
    : '<div class="ui-component-empty" role="status">Комментариев пока нет</div>';
  container.querySelectorAll('[data-reply-id]').forEach(button => {
    button.addEventListener('click', () => {
      window.__setReplyTo?.(Number(button.dataset.replyId), button.dataset.replyName || 'Пользователь');
    });
  });
}

export function renderMentionOptions(dropdown, users) {
  dropdown.setAttribute?.('role', 'listbox');
  dropdown.setAttribute?.('aria-label', 'Пользователи для упоминания');
  dropdown.innerHTML = users.map((user, index) => {
    const displayName = user.name || user.login || user.email || '';
    const userId = Number(user.id) || 0;
    return `<div class="mention-item ui-selection-option${index === 0 ? ' selected' : ''}" id="mention-option-${userId}" role="option" aria-selected="${index === 0 ? 'true' : 'false'}" data-user-id="${userId}" data-user-name="${escapeHtml(displayName)}">
      ${avatar({ name: displayName, size: 24, className: 'task-detail-avatar' })}
      <span>${escapeHtml(displayName)}</span>
    </div>`;
  }).join('');
}

export function focusCommentTarget(container, commentId) {
  const id = Number(commentId);
  if (!container || !Number.isInteger(id) || id <= 0) return false;
  const target = container.querySelector?.(`[data-comment-id="${id}"]`);
  if (!target) return false;
  container.querySelectorAll?.('.comment-item.is-targeted').forEach(item => item.classList.remove('is-targeted'));
  target.classList.add('is-targeted');
  target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  target.focus?.({ preventScroll: true });
  return true;
}
