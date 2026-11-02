import { escapeHtml } from './htmlUtils.js';

const ERROR_FALLBACK = 'Не удалось выполнить операцию. Попробуйте ещё раз.';
// Versioned and unversioned imports share ownership of the same field error.
const fieldErrors = globalThis[Symbol.for('ui-kit.field-errors')] ||= new WeakMap();

export function formatErrorMessage(error, fallback = ERROR_FALLBACK) {
  const issues=Array.isArray(error?.data)?error.data:Array.isArray(error?.data?.detail)?error.data.detail:[];
  if(issues.length){const messages=[...new Set(issues.map(issue=>String(issue.msg||'').replace(/^Value error,\s*/,'' )).filter(message=>/[а-яё]/i.test(message)))];return messages.length?messages.slice(0,3).join('. '):'Проверьте заполнение полей формы.';}
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

export function showFieldError(field, message, {focus = true} = {}) {
  if (!field) return;
  clearFieldError(field);
  const frameError = field.id && field.closest?.('.ui-field')?.querySelector(`[id="${CSS.escape(field.id)}-error"]`);
  const error = frameError || document.createElement('div');
  error.classList.add('field-error-message', 'ui-field-error');
  error.textContent = message;
  if (!error.id) error.id = `field-error-${crypto.randomUUID()}`;
  error.hidden = false;
  fieldErrors.set(field, { error, frame: Boolean(frameError), invalid: field.getAttribute('aria-invalid') });
  field.setAttribute('aria-invalid', 'true');
  const descriptions = new Set((field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  descriptions.add(error.id);
  field.setAttribute('aria-describedby', [...descriptions].join(' '));
  if (!frameError) field.insertAdjacentElement('afterend', error);
  if (focus) field.focus();
}

export function clearFieldError(field) {
  if (!field) return;
  const owned = fieldErrors.get(field);
  if (!owned) {
    const error = field.id && field.closest?.('.ui-field')?.querySelector(`[id="${CSS.escape(field.id)}-error"]`);
    if (error && !error.hidden) {
      error.hidden = true; field.removeAttribute('aria-invalid');
      const descriptions = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== error.id);
      if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' '));
      else field.removeAttribute('aria-describedby');
    }
    return;
  }
  const descriptions = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== owned.error.id);
  if (owned.frame) { owned.error.hidden = true; owned.error.textContent = ''; } else owned.error.remove();
  if (owned.invalid == null) field.removeAttribute('aria-invalid');
  else field.setAttribute('aria-invalid', owned.invalid);
  if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' '));
  else field.removeAttribute('aria-describedby');
  fieldErrors.delete(field);
}

// Reference counts preserve lower layers even when confirmations finish out of order.
const confirmationInert = globalThis[Symbol.for('ui-kit.confirmation-inert')] ||= new WeakMap();
function isolateConfirmation(overlay, modalOwner) {
  const held = [];
  let branch = overlay;
  while (branch.parentElement) {
    const parent = branch.parentElement;
    for (const sibling of parent.children) {
      if (sibling === branch) continue;
      const state = confirmationInert.get(sibling) || { count: 0, initial: sibling.inert };
      state.count++; confirmationInert.set(sibling, state); sibling.inert = true; held.push(sibling);
    }
    if (parent === modalOwner || parent === document.body) break;
    branch = parent;
  }
  return () => held.forEach(node => {
    const state = confirmationInert.get(node);
    if (!state || --state.count > 0) return;
    node.inert = state.initial; confirmationInert.delete(node);
  });
}

export function confirmAction({ title = 'Подтвердите действие', message = '', confirmText = 'Подтвердить', cancelText = 'Отмена', destructive = false } = {}) {
  return new Promise((resolve) => {
    const focusOrigin = document.activeElement;
    let titleId = 'feedback-confirm-title', suffix = 0;
    while (document.getElementById(titleId)) titleId = 'feedback-confirm-title-' + (++suffix);
    const messageId = titleId.replace('-title', '-message');
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
      <div class="feedback-confirm app-modal app-modal--small" role="alertdialog" aria-modal="true" aria-labelledby="${titleId}" aria-describedby="${messageId}">
        <div class="feedback-confirm-header">
          <h3 class="feedback-confirm-title" id="${titleId}">${escapeHtml(title)}</h3>
        </div>
        <div class="feedback-confirm-body">
          <p id="${messageId}">${escapeHtml(message)}</p>
        </div>
        <div class="feedback-confirm-actions">
          <button type="button" class="btn btn-secondary" data-feedback-cancel>${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${destructive ? 'btn-danger' : 'btn-primary'}" data-feedback-confirm>${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    host.appendChild(overlay);
    const releaseBackground = isolateConfirmation(overlay, modalOwner);
    const cancel = overlay.querySelector('[data-feedback-cancel]');
    const confirm = overlay.querySelector('[data-feedback-confirm]');
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      releaseBackground();
      if (focusOrigin?.isConnected && typeof focusOrigin.focus === 'function') {
        focusOrigin.focus();
      }
      resolve(answer);
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false); });
    overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); } });
    cancel.focus();
  });
}
