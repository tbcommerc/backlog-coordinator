import { escapeHtml as esc } from '../htmlUtils.js';
import { attributes, badge } from './primitives.js';
import { safeExternalUrl } from '../urlUtils.js';
import { renderViewState } from '../components/viewState.js';

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 4 });
const missing = value => value == null || value === '';

// Returns cell CONTENT, not <td>. markup is a trusted composition slot only.
export function tableCell({ value, type = 'text', secondary = '', href = '', tone = 'neutral', markup, className = '' } = {}) {
  let content = missing(value) ? '—' : esc(value);
  if (markup != null) content = markup;
  else if (!missing(value)) {
    if (type === 'number') content = Number.isFinite(Number(value)) ? esc(numberFormat.format(Number(value))) : '—';
    if (type === 'date') {
      // Date-only values have no timezone; never shift them to the previous day.
      const raw = String(value), dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
      const date = new Date(dateOnly ? raw + 'T12:00:00Z' : raw);
      const valid = !Number.isNaN(date.valueOf()) && (!dateOnly || date.toISOString().slice(0, 10) === raw);
      content = valid ? `<time datetime="${esc(raw)}">${esc(date.toLocaleDateString('ru-RU', dateOnly ? { timeZone: 'UTC' } : undefined))}</time>` : '—';
    }
    if (type === 'link') {
      const url = typeof href === 'string' && href.startsWith('#/') ? href : safeExternalUrl(href);
      if (url) content = `<a href="${esc(url)}">${esc(value)}</a>`;
    }
    if (type === 'badge') content = badge({ label: String(value), tone });
  }
  return `<div class="ui-table-cell ${esc(className)}" data-ui-type="${esc(['text','number','date','link','badge'].includes(type) ? type : 'text')}"><div class="ui-table-cell-value">${content}</div>${missing(secondary) ? '' : `<div class="ui-table-cell-secondary">${esc(secondary)}</div>`}</div>`;
}

// render(row, index) returns trusted cell content. Sorting is controlled by the
// consumer: the component never sorts one page of a server-side registry.
export function dataTable({ label, columns = [], rows = [], sort = null, state = 'default', stateTitle, message = '', actionLabel = '', actionAttrs = {}, toolbar = '', footer = '', responsive = 'scroll', stickyHeader = false, variant = 'default', density = 'default', className = '', tableClassName = '', attrs = {} } = {}) {
  if (!label || !columns.length || columns.some(c => !c.key || !c.label) || new Set(columns.map(c => c.key)).size !== columns.length) {
    throw new TypeError('DataTable requires a label and columns with unique keys and labels');
  }
  state = ['loading','error','empty'].includes(state) ? state : rows.length ? 'default' : 'empty';
  const header = columns.map(col => {
    const direction = sort?.key === col.key && ['asc','desc'].includes(sort.direction) ? sort.direction : null;
    const title = col.sortable ? `<button type="button" class="btn btn-ghost btn-sm ui-btn ui-table-sort table-sort-button"${attributes({ 'data-ui-sort': col.key, title: col.label, 'aria-label': `${col.label}: сортировать по ${direction === 'asc' ? 'убыванию' : 'возрастанию'}`, disabled: state === 'loading' })}><span class="th-label">${esc(col.label)}</span><span class="sort-icon" aria-hidden="true">${direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : '↕'}</span></button>` : `<span class="ui-table-heading" title="${esc(col.label)}"><span class="th-label">${esc(col.label)}</span></span>`;
    return `<th scope="col" data-column-key="${esc(col.key)}"${col.resizable === false ? ' data-ui-resizable="false"' : ''}${col.sortable ? ` aria-sort="${direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}"` : ''}>${title}</th>`;
  }).join('');
  const body = state === 'default' ? rows.map((row, index) => `<tr>${columns.map(col => `<td data-label="${esc(col.label)}">${col.render ? col.render(row, index) : tableCell({ value: row[col.key], type: col.type })}</td>`).join('')}</tr>`).join('') : '';
  return `<div class="ui-data-table ${esc(className)}"${attributes({ ...attrs, 'data-ui-state': state, 'data-ui-responsive': responsive === 'cards' ? 'cards' : 'scroll', 'data-ui-table': variant === 'registry' ? 'registry' : 'default' })}>
    ${toolbar ? `<div class="ui-data-table-toolbar">${toolbar}</div>` : ''}
    ${state === 'default' ? `<div class="ui-data-table-scroll" role="region" aria-label="${esc(label)} — таблица" tabindex="0"><table${stickyHeader ? ' data-ui-sticky-header="page"' : ''} class="ui-table ui-table-data ${esc(tableClassName)}" data-ui-table="${variant === 'registry' ? 'registry' : 'default'}" data-ui-density="${density === 'compact' ? 'compact' : 'default'}"><caption class="sr-only">${esc(label)}</caption><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>` : `<div aria-label="${esc(label)}">${renderViewState({ kind: state, title: stateTitle, message, actionLabel: state === 'loading' ? '' : actionLabel, actionAttrs, scope: 'partial' })}</div>`}
    ${footer ? `<div class="ui-data-table-footer">${footer}</div>` : ''}
  </div>`;
}

// Bind to a stable host. Rebinding replaces the previous listener; dispose is
// safe even after another owner has rebound the host. Native buttons own keys.
const bindings = new WeakMap();
export function bindDataTable(root, { onSort } = {}) {
  bindings.get(root)?.();
  const click = event => {
    const trigger = event.target.closest('[data-ui-sort]');
    if (!trigger || !root.contains(trigger) || trigger.disabled || trigger.closest('[aria-busy="true"]')) return;
    const direction = trigger.closest('th')?.getAttribute('aria-sort') === 'ascending' ? 'desc' : 'asc';
    onSort?.({ key: trigger.dataset.uiSort, direction }, trigger);
  };
  const dispose = () => { root.removeEventListener('click', click); if (bindings.get(root) === dispose) bindings.delete(root); };
  root.addEventListener('click', click);
  bindings.set(root, dispose);
  return dispose;
}
