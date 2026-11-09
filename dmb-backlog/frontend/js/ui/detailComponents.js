import { escapeHtml as esc } from '../htmlUtils.js';
import { attributes, button } from './primitives.js';
import { safeExternalUrl } from '../urlUtils.js';

// content/actions/footer/valueMarkup принимают только доверенную разметку компонентов.
function fieldParts({ label, value, valueMarkup, href, state = 'default', message = '', copy = false, className = '', attrs = {} }, term = 'dt', definition = 'dd') {
  const empty = valueMarkup == null && (value == null || value === '');
  state = ['loading', 'error', 'empty'].includes(state) ? state : empty ? 'empty' : 'default';
  const url = typeof href === 'string' && href.startsWith('#/') ? href : safeExternalUrl(href || '');
  const text = state === 'empty' ? '—' : String(value ?? '');
  const content = state === 'loading' ? '<span class="ui-readonly-skeleton" aria-hidden="true"></span><span class="sr-only">Загрузка…</span>'
    : state === 'error' ? esc(message || 'Не удалось загрузить значение')
    : state === 'empty' ? '—' : valueMarkup ?? (url ? `<a href="${esc(url)}">${esc(text)}</a>` : esc(text));
  return `<div class="ui-readonly-field ${esc(className)}" data-ui-state="${state}"${attributes(attrs)}${state === 'loading' ? ' aria-busy="true"' : ''}>
    <${term} class="ui-readonly-label">${esc(label)}</${term}>
    <${definition} class="ui-readonly-value"><span class="ui-readonly-content">${content}</span>${copy && state === 'default' && value != null ? button({ label: `Копировать: ${label}`, icon: 'copy', iconOnly: true, variant: 'ghost', size: 'small', attrs: { 'data-ui-copy': String(value) } }) + '<span class="ui-readonly-copy-status" role="status"></span>' : ''}</${definition}></div>`;
}

export function readOnlyField(options = {}) {
  return `<dl class="ui-description-list">${fieldParts(options)}</dl>`;
}

export function descriptionList({ items = [], className = '', attrs = {} } = {}) {
  return `<dl class="ui-description-list ${esc(className)}"${attributes(attrs)}>${items.map(item => fieldParts(item)).join('')}</dl>`;
}

export function bindReadOnlyFields(root, { writeText = value => navigator.clipboard.writeText(value) } = {}) {
  let disposed = false;
  const handle = async event => {
    const trigger = event.target.closest('[data-ui-copy]');
    if (!trigger || !root.contains(trigger) || trigger.disabled) return;
    const status = trigger.parentElement.querySelector('.ui-readonly-copy-status');
    trigger.disabled = true;
    try { await writeText(trigger.dataset.uiCopy); if (!disposed && status.isConnected) status.textContent = 'Скопировано'; }
    catch { if (!disposed && status.isConnected) status.textContent = 'Не удалось скопировать'; }
    finally { if (trigger.isConnected) trigger.disabled = false; }
  };
  root.addEventListener('click', handle);
  return () => { disposed = true; root.removeEventListener('click', handle); };
}

export function sectionCard({ title, content = '', description = '', actions = '', footer = '', collapsible = false, open = true, state = 'default', message = '', className = '', attrs = {}, level = 3, variant = 'card' } = {}) {
  const heading = [2, 3, 4].includes(level) ? `h${level}` : 'h3';
  state = ['loading', 'empty', 'error'].includes(state) ? state : 'default';
  const body = state === 'default' ? content : `<p class="ui-section-state" role="${state === 'error' ? 'alert' : 'status'}">${esc(message || ({ loading: 'Загрузка…', empty: 'Данных пока нет', error: 'Не удалось загрузить раздел' })[state])}</p>`;
  const header = `<${heading}>${esc(title)}</${heading}>${description ? `<p>${esc(description)}</p>` : ''}`;
  const tag = collapsible ? 'details' : 'section';
  return `<${tag} class="ui-section-card${variant === 'plain' ? ' ui-section-plain' : ''} ${esc(className)}" data-ui-state="${state}"${collapsible && open ? ' open' : ''}${attributes(attrs)}${state === 'loading' ? ' aria-busy="true"' : ''}>
    ${collapsible ? `<summary class="ui-disclosure-text ui-section-header">${header}</summary>` : `<header class="ui-section-header"><div>${header}</div>${actions ? `<div class="ui-section-actions">${actions}</div>` : ''}</header>`}
    <div class="ui-section-body">${collapsible && actions ? `<div class="ui-section-actions">${actions}</div>` : ''}${body}</div>${footer ? `<footer class="ui-section-footer">${footer}</footer>` : ''}</${tag}>`;
}
