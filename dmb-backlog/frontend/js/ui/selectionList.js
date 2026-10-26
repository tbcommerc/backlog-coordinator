import { escapeHtml } from '../htmlUtils.js';

// Native checkboxes keep Space, disabled and form semantics. Callers own selection.
export function selectionList({ items = [], selected = [], itemAttribute = 'value', className = '', emptyText = 'Нет доступных значений' } = {}) {
  if (!['value', 'data-val'].includes(itemAttribute)) throw new TypeError('Unsupported selection attribute');
  const values = new Set(selected);
  return `<div class="ui-selection-list ${escapeHtml(className)}">${items.length ? items.map(item => `<label class="ui-selection-option"><input type="checkbox" ${itemAttribute}="${escapeHtml(String(item.value))}"${values.has(item.value) ? ' checked' : ''}${item.disabled ? ' disabled' : ''}><span>${escapeHtml(String(item.label))}</span></label>`).join('') : `<div class="ui-popover-empty" role="status">${escapeHtml(emptyText)}</div>`}</div>`;
}

export function filterSelectionList(list, query) {
  const text = query.trim().toLocaleLowerCase();
  list.querySelectorAll('.ui-selection-option').forEach(option => { option.hidden = !option.textContent.toLocaleLowerCase().includes(text); });
  let empty = list.querySelector('[data-search-empty]');
  if (!empty) {
    empty = list.ownerDocument.createElement('div');
    empty.className = 'ui-popover-empty'; empty.dataset.searchEmpty = '';
    empty.setAttribute('role', 'status'); empty.textContent = 'Ничего не найдено'; list.append(empty);
  }
  empty.hidden = Boolean(list.querySelector('.ui-selection-option:not([hidden])'));
}
