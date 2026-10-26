import { escapeHtml } from '../htmlUtils.js';
import { button, icon } from '../ui/primitives.js';

const META = {
  loading: { icon: 'loader-circle', defaultTitle: 'Загрузка…' },
  empty: { icon: 'inbox', defaultTitle: 'Данных пока нет' },
  error: { icon: 'triangle-alert', defaultTitle: 'Не удалось загрузить данные' },
  forbidden: { icon: 'lock-keyhole', defaultTitle: 'Недостаточно прав' },
  unavailable: { icon: 'cloud-off', defaultTitle: 'Сервис временно недоступен' },
};

export function renderViewState({ kind = 'empty', title, message = '', actionLabel = '', actionId, actionAttrs = {}, actionVariant = 'secondary', hint = '' } = {}) {
  const meta = META[kind] || META.empty;
  const loadingClass = kind === 'loading' ? ' content-loading-state' : '';
  return `
    <div class="view-state view-state-${escapeHtml(kind)}${loadingClass}" role="${kind === 'error' ? 'alert' : 'status'}" ${kind === 'loading' ? 'aria-busy="true"' : ''}>
      ${icon(meta.icon, 'view-state-icon')}
      <h3>${escapeHtml(title || meta.defaultTitle)}</h3>
      ${message ? `<p>${escapeHtml(message)}</p>` : ''}
      ${actionLabel ? button({ label: actionLabel, variant: actionVariant, attrs: { ...actionAttrs, id: actionId, 'data-view-state-action': true } }) : ''}
      ${hint ? `<p class="view-state-hint">${escapeHtml(hint)}</p>` : ''}
    </div>`;
}

export function bindViewStateAction(root, callback) {
  root?.querySelector('[data-view-state-action]')?.addEventListener('click', callback);
}

const tableStateObservers = new WeakMap();

export function fitTableViewState(root) {
  if (!root) return;
  tableStateObservers.get(root)?.disconnect();
  tableStateObservers.delete(root);
  const scrollContainer = root?.querySelector('.table-container');
  const state = scrollContainer?.querySelector('.table-view-state-cell .view-state');
  if (!scrollContainer || !state) return;
  const fit = () => { state.style.width = `${scrollContainer.clientWidth}px`; };
  fit();
  if (typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() => {
    if (!scrollContainer.isConnected || !state.isConnected) {
      observer.disconnect();
      return;
    }
    fit();
  });
  observer.observe(scrollContainer);
  tableStateObservers.set(root, observer);
}
