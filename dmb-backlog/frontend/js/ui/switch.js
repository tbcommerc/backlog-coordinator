import { escapeHtml as esc } from '../htmlUtils.js';
import { attributes } from './primitives.js';

// The native checkbox owns keyboard, checked and disabled behavior. The caller
// owns persistence; the track is decorative and never a second control.
export function toggleSwitch({ id, label, description = '', checked = false, disabled = false, attrs = {}, className = '' } = {}) {
  if (!id || !label) throw new TypeError('Switch requires id and label');
  const { type: ignoredType, role: ignoredRole, checked: ignoredChecked, 'aria-checked': ignoredCheckedState, ...rest } = attrs;
  const describedBy = [rest['aria-describedby'], description && `${id}-description`].filter(Boolean).join(' ');
  return `<label class="ui-switch${className ? ` ${esc(className)}` : ''}" for="${esc(id)}"><input class="ui-switch-input" type="checkbox" role="switch"${attributes({ ...rest, id, disabled, 'aria-labelledby': `${id}-label`, 'aria-describedby': describedBy || undefined })}${checked ? ' checked' : ''}><span class="ui-switch-copy"><span class="ui-switch-label" id="${esc(id)}-label">${esc(label)}</span>${description ? `<span class="ui-switch-description" id="${esc(id)}-description">${esc(description)}</span>` : ''}</span><span class="ui-switch-track" aria-hidden="true"></span></label>`;
}
