import { escapeHtml as esc } from '../htmlUtils.js';
import { button } from './primitives.js';

// Native radios provide arrow-key selection and form submission without JS.
export function radioGroup({ id, name = id, label, options = [], value, disabled = false, required = false } = {}) {
  if (!id || !name || !label) throw new TypeError('RadioGroup requires id, name and label');
  return `<fieldset class="ui-choice-group" id="${esc(id)}"${disabled ? ' disabled' : ''}><legend>${esc(label)}</legend>${options.map((option, index) => `<label class="ui-checkbox" for="${esc(id)}-${index}"><input type="radio" id="${esc(id)}-${index}" name="${esc(name)}" value="${esc(option.value)}"${String(value) === String(option.value) ? ' checked' : ''}${option.disabled ? ' disabled' : ''}${required ? ' required' : ''}><span>${esc(option.label)}</span></label>`).join('')}</fieldset>`;
}

export function alert({ title = '', message = '', tone = 'info', live = false } = {}) {
  const safeTone = ['neutral', 'info', 'success', 'warning', 'danger'].includes(tone) ? tone : 'info';
  return `<div class="ui-alert" data-ui-tone="${safeTone}"${live ? ` role="${safeTone === 'danger' ? 'alert' : 'status'}"` : ''}>${title ? `<strong>${esc(title)}</strong>` : ''}<p>${esc(message)}</p></div>`;
}

// Data loading belongs to the caller; buttons expose the destination page.
export function pagination({ page = 1, pages = 1, disabled = false, label = 'Страницы', className = '', buttonClassName = '', total, stepMode = false, scope } = {}) {
  pages = Number.isFinite(Number(pages)) ? Math.max(1, Math.trunc(Number(pages))) : 1;
  page = Number.isFinite(Number(page)) ? Math.min(pages, Math.max(1, Math.trunc(Number(page)))) : 1;
  const action = (label, icon, target, unavailable) => button({ label, icon, variant: 'ghost', size: 'small', className: buttonClassName, attrs: { 'data-page': stepMode ? target - page : target, 'data-page-scope': scope, disabled: disabled || unavailable } });
  return `<nav class="ui-pagination ${esc(className)}" aria-label="${esc(label)}">${action('Назад', 'chevron-left', page - 1, page <= 1)}<span aria-live="polite">Страница <strong>${page}</strong> из ${pages}${total == null ? '' : ` · Всего ${esc(total)}`}</span>${action('Далее', 'chevron-right', page + 1, page >= pages)}</nav>`;
}
