import { escapeHtml as esc } from '../htmlUtils.js';
import { filterSummaryOption } from './filterValues.js';

const VARIANTS = new Set(['primary', 'secondary', 'ghost', 'danger', 'success', 'ai', 'ai-primary']);
const TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger', 'accent']);
const SIZE_SUFFIX = Object.assign(Object.create(null), { 'extra-small': 'xs', small: 'sm', large: 'lg' });
const BOOLEAN_ATTRIBUTES = new Set(['hidden', 'disabled', 'required', 'readonly', 'autofocus']);
// Names used by newer screens mapped to the bundled Lucide 0.263 set.
export const ICON_ALIASES = {
  "scan-search": "scan-line",
  "triangle-alert": "alert-triangle",
  "circle-check": "check-circle",
  "scan-eye": "scan",
  "git-compare-arrows": "git-compare",
  "message-square-text": "message-square",
  "circle-alert": "alert-circle",
  "circle-check-big": "check-circle-2",
  "clipboard-pen-line": "clipboard-edit",
  "route": "milestone",
  "lock-keyhole": "lock",
  "database-zap": "database",
  "chart-no-axes-column-decreasing": "bar-chart-3",
  "message-square-warning": "message-square",
  "user-round": "user",
  "clock-alert": "clock",
  "message-circle-warning": "message-circle",
  "circle-x": "x-circle",
  "loader-circle": "loader-2",
  "file-pen-line": "file-edit",
  "search-check": "search"
};

// Only presentation attributes are accepted. No event handlers, style or URLs.
export function attributes(values = {}) {
  return Object.entries(values).filter(([key, value]) =>
    /^(id|title|name|value|type|role|tabindex|hidden|disabled|required|readonly|autofocus|autocomplete|list|maxlength|min|max|step|rows|placeholder|aria-[a-z-]+|data-[a-z-]+)$/.test(key)
    && value != null && (value !== false || /^(aria-|data-)/.test(key))
  ).map(([key, value]) => value === true && BOOLEAN_ATTRIBUTES.has(key) ? ` ${key}` : ` ${key}="${esc(value)}"`).join('');
}

export function icon(name, className = '') {
  return name ? `<i data-lucide="${esc(ICON_ALIASES[name] || name)}" class="ui-icon ${esc(className)}" aria-hidden="true"></i>` : '';
}

// iconMarkup, when supplied, must be trusted SVG from a local icon renderer.
export function button({ label, icon: iconName, iconMarkup = '', variant = 'secondary', size = 'default', iconOnly = false, attrs = {}, className = '' } = {}) {
  const tone = VARIANTS.has(variant) ? variant : 'secondary';
  const sizeClass = SIZE_SUFFIX[size] ? ` btn-${SIZE_SUFFIX[size]}` : '';
  if (iconOnly && !label) throw new TypeError('IconButton requires an accessible label');
  const { type = 'button', ...rest } = attrs;
  return `<button type="${type === 'submit' ? 'submit' : type === 'reset' ? 'reset' : 'button'}" class="btn btn-${tone}${sizeClass} ui-btn${iconOnly ? ' btn-icon square-icon' : ''}${className ? ` ${esc(className)}` : ''}"${attributes({ ...rest, ...(iconOnly ? { 'aria-label': label, title: attrs.title || label } : {}) })}>${iconMarkup || icon(iconName || (tone.startsWith('ai') ? 'sparkles' : ''))}${iconOnly ? '' : `<span>${esc(label)}</span>`}</button>`;
}

// actions is trusted markup composed by the caller, never user-provided text.
export function pageHeader({ title, description = '', actions = '', id, className = '', level = 1 } = {}) {
  const heading = level === 2 ? 'h2' : 'h1';
  return `<div class="toolbar-title-row ui-page-header ${esc(className)}"><div class="toolbar-title-wrap"><${heading} class="toolbar-title"${attributes({ id })}>${esc(title)}</${heading}>${description ? `<p class="toolbar-subtitle">${esc(description)}</p>` : ''}</div>${actions}</div>`;
}

export function filterChip({ label, icon: iconName, count = '—', countId, selected = false, tone = 'neutral', attrs = {}, className = '' } = {}) {
  const { type: ignoredType, ...rest } = attrs;
  return `<button type="button" class="quick-filter-btn ui-filter-chip ${esc(className)}${selected ? ' active' : ''}"${attributes({ ...rest, 'aria-pressed': String(selected), 'data-ui-tone': TONES.has(tone) ? tone : 'neutral' })}>${iconName ? `<span class="quick-filter-icon">${icon(iconName)}</span>` : ''}<span class="quick-filter-info"><span class="quick-filter-label">${esc(label)}</span>${count == null ? '' : `<span class="sr-only"> · </span><strong class="quick-filter-count ui-counter"${attributes({ id: countId })}>${esc(count)}</strong>`}</span></button>`;
}

export function kpiCard({ label, value = '—', variant = 'metric', interactive = true, attrs = {}, className = '' } = {}) {
  const tag = interactive ? 'button' : 'div';
  return `<${tag}${interactive ? ' type="button"' : ''} class="ui-kpi-card ${esc(className)}"${attributes(attrs)}><span>${esc(label)}</span><span class="sr-only"> · </span><strong${variant === 'text' ? ' class="ui-kpi-text"' : ''}>${esc(value)}</strong></${tag}>`;
}

// content is trusted markup composed by the caller. Native details owns keyboard state.
export function collapseSection({ label, content = '', open = false, attrs = {}, className = '' } = {}) {
  return `<details class="ui-collapse-section ${esc(className)}"${open ? ' open' : ''}${attributes(attrs)}><summary>${esc(label)}</summary>${content}</details>`;
}

export function badge({ label, tone = 'neutral', icon: iconName = '', className = '', attrs = {} } = {}) {
  const { 'data-ui-tone': ignoredTone, ...rest } = attrs;
  return `<span class="badge ui-badge${className ? ` ${esc(className)}` : ''}" data-ui-tone="${TONES.has(tone) ? tone : 'neutral'}"${attributes(rest)}>${iconName ? icon(iconName) : ''}<span>${esc(label)}</span></span>`;
}

// Native checkbox keeps browser keyboard behavior and a full-size label target.
export function checkbox({ id, label, checked = false, disabled = false, attrs = {}, className = '' } = {}) {
  if (!id || !label) throw new TypeError('Checkbox requires id and label');
  const { type: ignoredType, checked: ignoredChecked, ...rest } = attrs;
  return `<label class="ui-checkbox${className ? ` ${esc(className)}` : ''}" for="${esc(id)}"><input type="checkbox"${attributes({ ...rest, id, disabled })}${checked ? ' checked' : ''}><span>${esc(label)}</span></label>`;
}

// A control without a wrapper supports dense table cells and inline editors.
// Its caller supplies a visible label or aria-label/aria-labelledby.
export function control({ id, value = '', kind = 'input', type = 'text', size = 'default', options = [], required = false, disabled = false, readonly = false, attrs = {}, className = '' } = {}) {
  const { type: ignoredType, value: ignoredValue, ...rest } = attrs;
  const common = attributes({ ...rest, id, required, disabled, readonly });
  const classes = `input ui-control${SIZE_SUFFIX[size] ? ` input-${SIZE_SUFFIX[size]}` : ''}${className ? ` ${esc(className)}` : ''}`;
  return kind === 'textarea'
    ? `<textarea class="${classes}"${common}>${esc(value)}</textarea>`
    : kind === 'select'
      ? `<select class="${classes}"${common}>${filterSummaryOption(value,options)}${options.map(option => `<option value="${esc(option.value)}"${String(option.value) === String(value) ? ' selected' : ''}${option.disabled ? ' disabled' : ''}>${esc(option.label)}</option>`).join('')}</select>`
      : `<input class="${classes}" type="${esc(['text', 'email', 'number', 'date', 'datetime-local', 'search', 'password', 'url', 'time', 'tel', 'month'].includes(type) ? type : 'text')}" value="${esc(value)}"${common}>`;
}

// controlMarkup is composed by the caller using control() and local helpers.
export function fieldFrame({ id, label, controlMarkup, required = false, hint = '', error = '', errorHidden = false, className = '', errorClassName = '' } = {}) {
  if (!id || !label) throw new TypeError('Field requires id and label');
  return `<div class="form-group ui-field ${esc(className)}"><label class="form-label" for="${esc(id)}">${esc(label)}${required ? '<span class="required" aria-hidden="true"> *</span>' : ''}</label>${controlMarkup}${hint ? `<p class="form-hint" id="${esc(id)}-hint">${esc(hint)}</p>` : ''}${error ? `<p class="form-error ${esc(errorClassName)}" id="${esc(id)}-error"${errorHidden ? ' hidden' : ''}>${esc(error)}</p>` : ''}</div>`;
}

export function field({ id, label, hint = '', error = '', errorHidden = false, className = '', controlClassName = '', errorClassName = '', ...props } = {}) {
  const describedBy = [props.attrs?.['aria-describedby'], hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  const controlMarkup = control({ ...props, id, className: controlClassName, attrs: { ...props.attrs, 'aria-invalid': error && !errorHidden ? 'true' : props.attrs?.['aria-invalid'], 'aria-describedby': describedBy || undefined } });
  return fieldFrame({ id, label, hint, error, errorHidden, className, errorClassName, required: props.required, controlMarkup });
}

export function tab({ id, label, panelId, selected = false, disabled = false, iconMarkup = '', attrs = {}, className = '' } = {}) {
  selected = selected && !disabled;
  return `<button type="button" class="ui-tab ${esc(className)}"${attributes({ ...attrs, id, role: 'tab', 'aria-controls': panelId, 'aria-selected': selected, tabindex: selected ? 0 : -1, disabled })}>${iconMarkup}<span>${esc(label)}</span></button>`;
}

// The renderers own appearance, callers own selection and business transitions.
export function tabs({ id, label, items = [], selected, orientation = 'horizontal' } = {}) {
  selected = items.find(item => item.id === selected && !item.disabled)?.id
    ?? items.find(item => !item.disabled)?.id;
  return `<div class="ui-tabs" role="tablist" aria-orientation="${orientation === 'vertical' ? 'vertical' : 'horizontal'}" aria-label="${esc(label)}">${items.map(item => tab({ id: `${id}-${item.id}-tab`, panelId: `${id}-${item.id}-panel`, label: item.label, selected: item.id === selected, disabled: item.disabled })).join('')}</div>`;
}
