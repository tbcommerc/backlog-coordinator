import { escapeHtml } from '../htmlUtils.js';

const META = {
  loading: { icon: 'loader-circle', defaultTitle: 'Загрузка…' },
  empty: { icon: 'inbox', defaultTitle: 'Данных пока нет' },
  error: { icon: 'triangle-alert', defaultTitle: 'Не удалось загрузить данные' },
};

export function renderViewState({ kind = 'empty', title, message = '', actionLabel = '' } = {}) {
  const meta = META[kind] || META.empty;
  return `
    <div class="view-state view-state-${escapeHtml(kind)}" role="${kind === 'error' ? 'alert' : 'status'}" ${kind === 'loading' ? 'aria-busy="true"' : ''}>
      <i data-lucide="${meta.icon}" class="view-state-icon" aria-hidden="true"></i>
      <h3>${escapeHtml(title || meta.defaultTitle)}</h3>
      ${message ? `<p>${escapeHtml(message)}</p>` : ''}
      ${actionLabel ? `<button type="button" class="btn btn-secondary" data-view-state-action>${escapeHtml(actionLabel)}</button>` : ''}
    </div>`;
}

export function bindViewStateAction(root, callback) {
  root?.querySelector('[data-view-state-action]')?.addEventListener('click', callback);
}
