import { escapeHtml } from './htmlUtils.js';

const ERROR_FALLBACK = 'Не удалось выполнить операцию. Попробуйте ещё раз.';

export function formatErrorMessage(error, fallback = ERROR_FALLBACK) {
  const raw = typeof error === 'string' ? error : error?.message;
  const message = String(raw || '').trim();
  if (!message) return fallback;
  if (/failed to fetch|networkerror|network request failed/i.test(message)) {
    return 'Сервер недоступен. Проверьте подключение и попробуйте ещё раз.';
  }
  return message;
}

export function showToast(message, type = 'success', options = {}) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const item = document.createElement('div');
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  item.className = `toast toast-${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const action = options.actionLabel
    ? `<button class="toast-action" type="button">${escapeHtml(options.actionLabel)}</button>`
    : '';
  item.innerHTML = `<span class="toast-icon">${icons[type] || '✓'}</span><span class="toast-message">${escapeHtml(message)}</span>${action}<button class="toast-close" type="button" aria-label="Закрыть">&times;</button>`;
  container.appendChild(item);
  const dismiss = () => {
    item.style.opacity = '0';
    window.setTimeout(() => item.remove(), 300);
  };
  const duration = options.persistent ? 0 : (options.duration || (type === 'error' ? 5000 : 3000));
  const timer = duration ? window.setTimeout(dismiss, duration) : null;
  item.querySelector('.toast-action')?.addEventListener('click', () => {
    if (timer) window.clearTimeout(timer);
    options.onAction?.();
    dismiss();
  });
  item.querySelector('.toast-close').addEventListener('click', () => {
    if (timer) window.clearTimeout(timer);
    dismiss();
  });
}

export function showFieldError(field, message) {
  if (!field) return;
  clearFieldError(field);
  const error = document.createElement('div');
  error.className = 'field-error-message';
  error.textContent = message;
  error.id = `field-error-${crypto.randomUUID()}`;
  field.setAttribute('aria-invalid', 'true');
  field.setAttribute('aria-describedby', error.id);
  field.insertAdjacentElement('afterend', error);
  field.focus();
}

export function clearFieldError(field) {
  if (!field) return;
  const describedBy = field.getAttribute('aria-describedby');
  if (describedBy?.startsWith('field-error-')) document.getElementById(describedBy)?.remove();
  field.removeAttribute('aria-invalid');
  field.removeAttribute('aria-describedby');
}

export function confirmAction({ title = 'Подтвердите действие', message = '', confirmText = 'Подтвердить', cancelText = 'Отмена', destructive = false } = {}) {
  return new Promise((resolve) => {
    const host = document.getElementById('feedback-dialog-container') || document.body;
    const overlay = document.createElement('div');
    overlay.className = 'feedback-confirm-overlay';
    overlay.innerHTML = `
      <div class="feedback-confirm" role="alertdialog" aria-modal="true" aria-labelledby="feedback-confirm-title" aria-describedby="feedback-confirm-message">
        <h3 id="feedback-confirm-title">${escapeHtml(title)}</h3>
        <p id="feedback-confirm-message">${escapeHtml(message)}</p>
        <div class="feedback-confirm-actions">
          <button type="button" class="btn btn-secondary" data-feedback-cancel>${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${destructive ? 'btn-danger' : 'btn-primary'}" data-feedback-confirm>${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    host.appendChild(overlay);
    const cancel = overlay.querySelector('[data-feedback-cancel]');
    const confirm = overlay.querySelector('[data-feedback-confirm]');
    const finish = (answer) => { overlay.remove(); resolve(answer); };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false); });
    overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') finish(false); });
    cancel.focus();
  });
}
