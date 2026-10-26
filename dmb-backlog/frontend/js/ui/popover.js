// Shared non-modal floating surface. Data, drafts and commits belong to callers.
let sequence = 0;
const stack = [];
const focusable = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]';
const visibleControls = panel => [...panel.querySelectorAll(focusable)].filter(el => el.getClientRects().length && !el.closest('[hidden], [inert]') && el.getAttribute('aria-disabled') !== 'true');

export function createPopover({ trigger, panel, label, role = 'dialog', align = 'start', width, resolveTrigger, removeOnClose = false, onClose, portal = true, focus = true } = {}) {
  if (!trigger || !panel) throw new TypeError('Popover requires a trigger and panel');
  const doc = panel.ownerDocument;
  const win = doc.defaultView;
  panel.id ||= `ui-popover-${++sequence}`;
  panel.classList.add('ui-popover');
  if (width) panel.dataset.uiWidth = ['small', 'default', 'wide'].includes(width) ? width : 'default';
  panel.setAttribute('role', role);
  if (label) panel.setAttribute('aria-label', label);
  panel.tabIndex = -1;
  panel.hidden = true;
  panel.style.display = 'none';
  let opened = false, marker, observer, resizeObserver;
  const anchor = () => resolveTrigger?.() || trigger;
  const syncTrigger = value => {
    const current = anchor();
    if (role !== 'tooltip') {
      current.setAttribute('aria-controls', panel.id);
      current.setAttribute('aria-expanded', String(value));
      current.setAttribute('aria-haspopup', role === 'menu' ? 'menu' : 'dialog');
    }
  };
  syncTrigger(false);
  const position = () => {
    if (!opened) return;
    const current = anchor();
    if (!current.isConnected) { close({ restoreFocus: false }); return; }
    syncTrigger(true);
    const viewport = win.visualViewport;
    const edge = 8, gap = 4;
    const x = viewport?.offsetLeft || 0, y = viewport?.offsetTop || 0;
    const width = viewport?.width || win.innerWidth, height = viewport?.height || win.innerHeight;
    panel.style.maxWidth = `${Math.max(0, width - edge * 2)}px`;
    panel.style.maxHeight = `${Math.max(0, height - edge * 2)}px`;
    const rect = current.getBoundingClientRect(), box = panel.getBoundingClientRect();
    const left = align === 'end' ? rect.right - box.width : rect.left;
    const below = rect.bottom + gap;
    const top = below + box.height <= y + height - edge ? below : rect.top - gap - box.height;
    panel.style.left = `${Math.max(x + edge, Math.min(left, x + width - box.width - edge))}px`;
    panel.style.top = `${Math.max(y + edge, Math.min(top, y + height - box.height - edge))}px`;
  };
  const topmost = () => stack.at(-1) === api;
  const outside = event => {
    if (!topmost()) return;
    while (stack.length && !stack.at(-1).panel.contains(event.target) && !stack.at(-1).trigger().contains(event.target)) stack.at(-1).close({ restoreFocus: false });
  };
  const keyboard = event => {
    if (!topmost() || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); close({ restoreFocus: role !== 'tooltip' }); return;
    }
    if (!panel.contains(event.target)) return;
    if (event.key === 'Tab') {
      const items = visibleControls(panel);
      const boundary = event.shiftKey ? items[0] : items.at(-1);
      if (role === 'menu' || doc.activeElement === boundary || !items.length) {
        const outsideItems = visibleControls(doc.body).filter(item => !panel.contains(item));
        const index = outsideItems.indexOf(anchor());
        const target = event.shiftKey ? anchor() : outsideItems.slice(index + 1).find(item => item.tabIndex >= 0);
        close({ restoreFocus: false });
        if (target) { event.preventDefault(); target.focus(); }
      }
      return;
    }
    const editable = event.target.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]');
    if (editable || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = visibleControls(panel);
    if (!items.length) return;
    const index = items.indexOf(doc.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    event.preventDefault(); items[next].focus();
  };
  const focusOutside = event => {
    if (topmost() && !panel.contains(event.target) && !anchor().contains(event.target)) close({ restoreFocus: false });
  };
  const routeChanged = () => close({ restoreFocus: false });
  // Run before legacy dialog capture listeners. An inline editor may consume
  // Escape locally without dismissing its containing popover.
  const escapeCapture = event => {
    if (event.key === 'Escape' && !event.target.closest('[data-ui-local-escape]')) keyboard(event);
  };
  function open() {
    if (opened) return;
    // Preserve nested panels; unrelated surfaces replace the previous one.
    while (stack.length && !stack.at(-1).panel.contains(anchor())) stack.at(-1).close({ restoreFocus: false });
    opened = true;
    // Keep the panel in its dialog's focus/inert boundary. Native top layer
    // still places it above clipped content without escaping the modal owner.
    const host = anchor().closest('[aria-modal="true"], dialog[open]') || doc.body;
    if (portal && panel.parentNode !== host) {
      if (panel.parentNode) { marker = doc.createComment('popover'); panel.before(marker); }
      host.append(panel);
    } else if (!panel.isConnected) host.append(panel);
    panel.hidden = false; panel.style.display = '';
    // The native top layer also works inside legacy high-z-index dialogs.
    if (typeof panel.showPopover === 'function') { panel.setAttribute('popover', 'manual'); panel.showPopover(); }
    syncTrigger(true); stack.push(api); position();
    doc.addEventListener('pointerdown', outside, true);
    doc.addEventListener('keydown', keyboard);
    win.addEventListener('keydown', escapeCapture, true);
    doc.addEventListener('focusin', focusOutside);
    win.addEventListener('resize', position);
    win.addEventListener('scroll', position, true);
    win.addEventListener('hashchange', routeChanged);
    win.visualViewport?.addEventListener('resize', position);
    win.visualViewport?.addEventListener('scroll', position);
    observer = new MutationObserver(() => { if (!anchor().isConnected || !panel.isConnected) close({ restoreFocus: false }); });
    observer.observe(doc.body, { childList: true, subtree: true });
    resizeObserver = new ResizeObserver(position); resizeObserver.observe(panel);
    if (focus) (visibleControls(panel)[0] || panel).focus({ preventScroll: true });
  }
  function close({ restoreFocus = true } = {}) {
    if (!opened) return;
    while (stack.includes(api) && stack.at(-1) !== api) stack.at(-1).close({ restoreFocus: false });
    opened = false; stack.splice(stack.indexOf(api), 1);
    observer?.disconnect(); resizeObserver?.disconnect();
    doc.removeEventListener('pointerdown', outside, true);
    doc.removeEventListener('keydown', keyboard);
    win.removeEventListener('keydown', escapeCapture, true);
    doc.removeEventListener('focusin', focusOutside);
    win.removeEventListener('resize', position);
    win.removeEventListener('scroll', position, true);
    win.removeEventListener('hashchange', routeChanged);
    win.visualViewport?.removeEventListener('resize', position);
    win.visualViewport?.removeEventListener('scroll', position);
    if (typeof panel.hidePopover === 'function' && panel.matches(':popover-open')) panel.hidePopover();
    panel.hidden = true; panel.style.display = 'none'; syncTrigger(false);
    if (marker) { marker.replaceWith(panel); marker = null; }
    if (removeOnClose) panel.remove();
    if (restoreFocus && anchor().isConnected) anchor().focus({ preventScroll: true });
    onClose?.();
  }
  const api = { panel, trigger: anchor, open, close, position, restoreFocus() { if (anchor().isConnected) anchor().focus({ preventScroll: true }); }, get isOpen() { return opened; }, toggle() { opened ? close() : open(); } };
  return api;
}

export function bindPopover(options) {
  const popover = createPopover(options);
  const toggle = () => popover.toggle();
  const keyboard = event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); popover.open(); }
  };
  options.trigger.addEventListener('click', toggle);
  options.trigger.addEventListener('keydown', keyboard);
  return Object.assign(popover, { destroy() {
    popover.close({ restoreFocus: false });
    options.trigger.removeEventListener('click', toggle);
    options.trigger.removeEventListener('keydown', keyboard);
  } });
}
