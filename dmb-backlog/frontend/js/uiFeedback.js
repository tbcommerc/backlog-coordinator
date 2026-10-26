import { escapeHtml } from './htmlUtils.js';

const ERROR_FALLBACK = 'Не удалось выполнить операцию. Попробуйте ещё раз.';
// Versioned and unversioned imports share ownership of the same field error.
const fieldErrors = globalThis[Symbol.for('ui-kit.field-errors')] ||= new WeakMap();

export function formatErrorMessage(error, fallback = ERROR_FALLBACK) {
  const raw = typeof error === 'string' ? error : error?.message;
  const message = String(raw || '').trim();
  if (!message) return fallback;
  if (/failed to fetch|networkerror|network request failed/i.test(message)) {
    return 'Сервер недоступен. Проверьте подключение и попробуйте ещё раз.';
  }
  const standardMessages = {
    'not found': 'Запрошенные данные недоступны. Обновите страницу и повторите попытку.',
    'internal server error': 'Не удалось обработать запрос. Повторите попытку позже.',
    'service unavailable': 'Сервис временно недоступен. Повторите попытку позже.',
    'unauthorized': 'Сеанс завершён. Войдите в систему ещё раз.',
    'forbidden': 'У вас нет доступа к этим данным.',
    'failed to load': 'Не удалось загрузить данные. Повторите попытку.',
  };
  if (standardMessages[message.toLowerCase()]) return standardMessages[message.toLowerCase()];
  return message;
}

export function showToast(message, type = 'success', options = {}) {
  if (type === 'error') message = formatErrorMessage(message);
  const container = document.getElementById('toast-container');
  if (!container) return;
  const item = document.createElement('div');
  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  item.className = `toast toast-${type}`;
  item.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const action = options.actionLabel
    ? `<button class="btn btn-secondary btn-sm ui-btn toast-action" type="button">${escapeHtml(options.actionLabel)}</button>`
    : '';
  item.innerHTML = `<span class="toast-icon">${icons[type] || '✓'}</span><span class="toast-message">${escapeHtml(message)}</span>${action}<button class="square-icon btn btn-ghost btn-sm ui-btn toast-close" type="button" aria-label="Закрыть">&times;</button>`;
  container.appendChild(item);
  // Popovers live above every z-index. Raise feedback after the active panel.
  if (typeof container.showPopover === 'function') {
    container.setAttribute('popover', 'manual');
    if (container.matches(':popover-open')) container.hidePopover();
    container.showPopover();
  }
  let timer = null, dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    window.clearTimeout(timer);
    // Removing a focused action must not leave keyboard focus on the body.
    if (item.contains(document.activeElement) && focusOrigin?.isConnected) focusOrigin.focus();
    item.style.opacity = '0';
    window.setTimeout(() => {
      item.remove();
      if (!container.children.length && container.matches('[popover]') && container.matches(':popover-open')) container.hidePopover();
    }, 300);
  };
  const focusOrigin = document.activeElement;
  // Actions have no implicit deadline. An explicit duration may opt into one.
  const duration = options.persistent ? 0 : (options.duration ?? (options.actionLabel ? 0 : type === 'error' ? 5000 : 3000));
  let hovered = false;
  const resume = () => {
    window.clearTimeout(timer);
    if (!dismissed && duration > 0 && !hovered && !item.contains(document.activeElement)) timer = window.setTimeout(dismiss, duration);
  };
  item.addEventListener('pointerenter', () => { hovered = true; window.clearTimeout(timer); });
  item.addEventListener('pointerleave', () => { hovered = false; resume(); });
  item.addEventListener('focusin', () => window.clearTimeout(timer));
  item.addEventListener('focusout', () => queueMicrotask(resume));
  resume();
  item.querySelector('.toast-action')?.addEventListener('click', () => {
    if (timer) window.clearTimeout(timer);
    dismiss();
    options.onAction?.();
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
  fieldErrors.set(field, { error, invalid: field.getAttribute('aria-invalid') });
  field.setAttribute('aria-invalid', 'true');
  const descriptions = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  descriptions.add(error.id);
  field.setAttribute('aria-describedby', [...descriptions].join(' '));
  field.insertAdjacentElement('afterend', error);
  field.focus();
}

export function clearFieldError(field) {
  if (!field) return;
  const owned = fieldErrors.get(field);
  if (!owned) return;
  const descriptions = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== owned.error.id);
  owned.error.remove();
  if (owned.invalid == null) field.removeAttribute('aria-invalid');
  else field.setAttribute('aria-invalid', owned.invalid);
  if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' '));
  else field.removeAttribute('aria-describedby');
  fieldErrors.delete(field);
}

export function confirmAction({ title = 'Подтвердите действие', message = '', confirmText = 'Подтвердить', cancelText = 'Отмена', destructive = false } = {}) {
  return new Promise((resolve) => {
    const focusOrigin = document.activeElement;
    // A native modal makes siblings inert and paints above every z-index.
    // Keep its confirmation inside the same top-layer dialog.
    // Focus may temporarily be on body after the previous confirmation closes.
    // :modal identifies the native top-layer owner independently of focus.
    const nativeDialogs = [...document.querySelectorAll('dialog[open]')];
    const modalOwner = nativeDialogs.reverse().find(dialog => dialog.matches(':modal'));
    const host = modalOwner || focusOrigin?.closest?.('dialog[open]') || document.getElementById('feedback-dialog-container') || document.body;
    const overlay = document.createElement('div');
    overlay.className = 'feedback-confirm-overlay';
    overlay.innerHTML = `
      <div class="feedback-confirm app-modal app-modal--small" role="alertdialog" aria-modal="true" aria-labelledby="feedback-confirm-title" aria-describedby="feedback-confirm-message">
        <div class="feedback-confirm-header">
          <h3 id="feedback-confirm-title">${escapeHtml(title)}</h3>
        </div>
        <div class="feedback-confirm-body">
          <p id="feedback-confirm-message">${escapeHtml(message)}</p>
        </div>
        <div class="feedback-confirm-actions">
          <button type="button" class="btn btn-secondary" data-feedback-cancel>${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${destructive ? 'btn-danger' : 'btn-primary'}" data-feedback-confirm>${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    host.appendChild(overlay);
    const cancel = overlay.querySelector('[data-feedback-cancel]');
    const confirm = overlay.querySelector('[data-feedback-confirm]');
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      if (focusOrigin?.isConnected && typeof focusOrigin.focus === 'function') {
        focusOrigin.focus();
      }
      resolve(answer);
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false); });
    overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') finish(false); });
    cancel.focus();
  });
}
