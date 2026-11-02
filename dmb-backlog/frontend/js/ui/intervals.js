import { escapeHtml as esc } from '../htmlUtils.js';
import { attributes, field } from './primitives.js';

function interval(type, { id, label, from = {}, to = {}, required = false, disabled = false, readonly = false, order = true, hint = '', className = '', attrs = {} } = {}) {
  if (!id || !label) throw new TypeError('Range requires id and label');
  const firstId = from.id || `${id}-from`, lastId = to.id || `${id}-to`;
  if (firstId === lastId) throw new TypeError('Range endpoints require distinct IDs');
  const endpoint = (item, side) => field({
    id: side === 'from' ? firstId : lastId,
    label: item.label || (side === 'from' ? 'От' : 'До'),
    type, value: item.value ?? '', required: item.required ?? required, controlClassName: item.controlClassName || '',
    disabled: disabled || !!item.disabled, readonly: readonly || !!item.readonly,
    attrs: { ...item.attrs, name: item.name, min: item.min, max: item.max, step: item.step ?? (type === 'number' ? 'any' : undefined), 'data-range-side': side,
      'aria-describedby': [item.attrs?.['aria-describedby'], hint && `${id}-hint`].filter(Boolean).join(' ') || undefined },
  });
  return `<fieldset class="ui-interval ${esc(className)}"${attributes({ ...attrs, id, disabled, 'data-range-type': type, 'data-range-order': order })}><legend>${esc(label)}</legend><div class="ui-interval-fields">${endpoint(from, 'from')}${endpoint(to, 'to')}</div>${hint ? `<p class="ui-interval-hint" id="${esc(id)}-hint">${esc(hint)}</p>` : ''}</fieldset>`;
}

export function dateRange(options) { return interval('date', options); }
export function numberRange(options) { return interval('number', options); }

// Pure validation result for showFormErrors(form, errors). No subscriptions,
// mutation of values, or ownership of server errors/customValidity.
export function validateRanges(root) {
  const ranges = [...(root.matches?.('.ui-interval') ? [root] : []), ...root.querySelectorAll('.ui-interval')];
  const errors = {};
  for (const range of ranges) {
    if (range.dataset.rangeOrder === 'false' || range.closest('[hidden]')) continue;
    const from = range.querySelector('[data-range-side="from"]'), to = range.querySelector('[data-range-side="to"]');
    // Native required, badInput, step, min/max are owned by the browser.
    if (!from || !to || !from.willValidate || !to.willValidate || !from.validity.valid || !to.validity.valid || from.value === '' || to.value === '') continue;
    if (Number.isFinite(from.valueAsNumber) && Number.isFinite(to.valueAsNumber) && from.valueAsNumber > to.valueAsNumber) {
      errors[to.id] = range.dataset.rangeType === 'date' ? 'Окончание периода должно быть не раньше начала' : 'Верхняя граница должна быть не меньше нижней';
    }
  }
  return errors;
}
