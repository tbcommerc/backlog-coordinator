import { escapeHtml as esc } from '../htmlUtils.js';
import { button } from './primitives.js';
import { enhanceDialogOverlay } from '../modalAccessibility.js';

const owner = Symbol.for('ui-kit.detail-panel');

// body/actions/footer — доверенная разметка. Данные и разрешения принадлежат экрану.
export function detailPanel({ id, title, body = '', actions = '', footer = '', size = 'default' } = {}) {
  if (!id || !title) throw new TypeError('DetailPanel requires id and title');
  return `<dialog id="${esc(id)}" class="ui-detail-panel${size === 'wide' ? ' ui-detail-panel-wide' : ''}" aria-labelledby="${esc(id)}-title"><header class="ui-detail-panel-header"><h2 id="${esc(id)}-title">${esc(title)}</h2><div class="ui-detail-panel-actions">${actions}${button({ label: 'Закрыть', variant: 'ghost', attrs: { 'data-ui-panel-close': '', 'data-close': '' } })}</div></header><div class="ui-detail-panel-body">${body}</div>${footer ? `<footer class="ui-detail-panel-footer">${footer}</footer>` : ''}</dialog>`;
}

// onClose обрабатывает запрос закрытия (включая проверку черновика и маршрута).
// Если передан onClose, удалением управляет потребитель; false означает отказ.
export function bindDetailPanel(dialog, { onClose, isBusy = () => false, focusOrigin = document.activeElement } = {}) {
  if (dialog?.tagName !== 'DIALOG') throw new TypeError('DetailPanel requires a dialog');
  if (dialog[owner]) return dialog[owner];
  let disposed = false, pending = false;
  dialog.classList.add('ui-detail-panel');
  const restoreFocus = () => { if (focusOrigin?.isConnected) focusOrigin.focus({ preventScroll: true }); };
  const requestClose = (reason = 'button') => {
    if (disposed || pending || isBusy()) return false;
    if (!onClose) { controller.destroy(); dialog.close(); dialog.remove(); restoreFocus(); return true; }
    const result = onClose(reason);
    if (result?.then) {
      pending = true;
      return Promise.resolve(result).finally(() => { pending = false; });
    }
    return result;
  };
  const click = event => {
    if (event.target.closest('[data-ui-panel-close]')?.closest('dialog') === dialog) requestClose('button');
  };
  const cancel = event => { event.preventDefault(); requestClose('escape'); };
  const keydown = event => {
    if (event.key === 'Escape' && !event.defaultPrevented && dialog.dataset.nonmodal === 'true' && event.target.closest('dialog') === dialog) {
      event.preventDefault(); event.stopPropagation(); requestClose('escape');
    }
  };
  const controller = {
    requestClose,
    present({ container = null, fullscreen = false } = {}) {
      if (disposed) return;
      const inline = !!container, wasInline = dialog.dataset.nonmodal === 'true', focus = document.activeElement, inside = dialog.contains(focus);
      const changed = dialog.dataset.nonmodal !== String(inline);
      if (dialog.open && changed) dialog.close();
      dialog.dataset.nonmodal = String(inline);
      dialog.classList.toggle('ui-detail-panel-inline', inline);
      dialog.classList.toggle('ui-detail-panel-fullscreen', !!fullscreen);
      dialog.setAttribute('role', inline ? 'region' : 'dialog');
      dialog.tabIndex = -1;
      if (inline) dialog.removeAttribute('aria-modal'); else dialog.setAttribute('aria-modal', 'true');
      // Уже смонтированное модальное окно сохраняет родителя и его делегированные обработчики.
      const parent = container || (dialog.isConnected && !wasInline ? dialog.parentElement : document.body);
      if (dialog.parentElement !== parent) parent.append(dialog);
      if (!dialog.open) { if (inline) dialog.show(); else dialog.showModal(); }
      if (!inline) enhanceDialogOverlay(dialog, focusOrigin);
      if (inside && focus?.isConnected) focus.focus({ preventScroll: true });
    },
    focus() { (dialog.querySelector('[data-close]') || dialog).focus(); },
    destroy() {
      disposed = true;
      dialog.removeEventListener('click', click);
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('keydown', keydown);
      delete dialog[owner];
    },
  };
  dialog[owner] = controller;
  dialog.addEventListener('click', click);
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('keydown', keydown);
  return controller;
}
