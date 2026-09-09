const OVERLAY_SELECTOR = '.modal-overlay, .admin-modal-overlay, .feedback-confirm-overlay, .conflict-overlay, .modal-backdrop, dialog';
const CLOSE_SELECTOR = '.modal-close, .modal-close-x, .modal-cancel-btn, .prioritiser-requirements-x, .task-detail-btn-close, #td-close-btn, #create-close-btn, #bc-modal-close, [data-feedback-cancel], [data-modal-close], dialog [data-close]';
const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const previousFocus = new WeakMap();
let headingSequence = 0;

function visibleFocusable(dialog) {
  return [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)]
    .filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

export function enhanceDialogOverlay(overlay, focusOrigin = document.activeElement) {
  if (!overlay || overlay.dataset.a11yDialogReady === 'true') return overlay;
  const dialog = overlay.matches('dialog, [role="dialog"], [role="alertdialog"]')
    ? overlay
    : overlay.querySelector('[role="dialog"], [role="alertdialog"]') || overlay.firstElementChild;
  if (!dialog) return overlay;

  overlay.dataset.a11yDialogReady = 'true';
  previousFocus.set(overlay, focusOrigin instanceof HTMLElement ? focusOrigin : null);
  if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  const heading = dialog.querySelector('h1, h2, h3, .modal-title');
  if (heading && !dialog.hasAttribute('aria-labelledby')) {
    if (!heading.id) heading.id = `dialog-title-${++headingSequence}`;
    dialog.setAttribute('aria-labelledby', heading.id);
  }
  if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
    dialog.setAttribute('aria-label', 'Диалоговое окно');
  }

  dialog.querySelectorAll(CLOSE_SELECTOR).forEach((button) => {
    const hasVisibleName = Boolean(button.textContent.trim());
    if (!hasVisibleName && !button.hasAttribute('aria-label')) button.setAttribute('aria-label', 'Закрыть диалог');
    if (button.tagName === 'BUTTON' && !button.hasAttribute('type')) button.type = 'button';
  });
  dialog.querySelectorAll('button').forEach((button) => {
    const hasText = Boolean(button.textContent.trim());
    if (!hasText && !button.hasAttribute('aria-label') && button.title) {
      button.setAttribute('aria-label', button.title);
    }
  });

  dialog.setAttribute('tabindex', '-1');
  window.requestAnimationFrame(() => {
    if (!overlay.isConnected) return;
    const initial = dialog.querySelector('[autofocus]') || visibleFocusable(dialog)[0] || dialog;
    initial.focus();
  });
  return overlay;
}

function activeOverlay() {
  return [...document.querySelectorAll(OVERLAY_SELECTOR)]
    .filter((overlay) => overlay.dataset.a11yDialogReady === 'true')
    .filter((overlay) => !overlay.matches('dialog') || overlay.open)
    .at(-1);
}

function restoreFocus(overlay) {
  const origin = previousFocus.get(overlay);
  if (origin?.isConnected) window.requestAnimationFrame(() => origin.focus());
  previousFocus.delete(overlay);
}

function handleKeydown(event) {
  const overlay = activeOverlay();
  if (!overlay) return;
  const dialog = overlay.matches('dialog, [role]') ? overlay : overlay.querySelector('[role="dialog"], [role="alertdialog"]');
  if (!dialog) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    const close = dialog.querySelector(CLOSE_SELECTOR);
    if (close) close.click();
    else if (dialog.matches('dialog')) dialog.close();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = visibleFocusable(dialog);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function initModalAccessibility() {
  document.querySelectorAll(OVERLAY_SELECTOR).forEach((overlay) => enhanceDialogOverlay(overlay));
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches(OVERLAY_SELECTOR)) enhanceDialogOverlay(node);
        node.querySelectorAll?.(OVERLAY_SELECTOR).forEach((overlay) => enhanceDialogOverlay(overlay));
      });
      mutation.removedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches(OVERLAY_SELECTOR)) restoreFocus(node);
        node.querySelectorAll?.(OVERLAY_SELECTOR).forEach(restoreFocus);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', handleKeydown, true);
  return () => {
    observer.disconnect();
    document.removeEventListener('keydown', handleKeydown, true);
  };
}
