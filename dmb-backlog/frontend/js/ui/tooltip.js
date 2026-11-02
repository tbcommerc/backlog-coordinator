import { createPopover } from './popover.js';

// Tooltip content is text or trusted local markup supplied as a DOM node.
// The trigger must already have an accessible name; this adds a description.
export function bindTooltip({ trigger, panel }) {
  panel.classList.add('ui-tooltip');
  const popover = createPopover({ trigger, panel, role: 'tooltip', focus: false });
  const previous = trigger.getAttribute('aria-describedby');
  trigger.setAttribute('aria-describedby', [...new Set([...(previous || '').split(/\s+/), panel.id].filter(Boolean))].join(' '));
  let timer;
  const open = () => { clearTimeout(timer); popover.open(); };
  const scheduleClose = () => { timer = setTimeout(() => popover.close({ restoreFocus: false }), 100); };
  for (const node of [trigger, panel]) {
    node.addEventListener('pointerenter', open);
    node.addEventListener('pointerleave', scheduleClose);
  }
  trigger.addEventListener('focus', open);
  trigger.addEventListener('blur', scheduleClose);
  return Object.assign(popover, { destroy() {
    clearTimeout(timer); popover.close({ restoreFocus: false });
    for (const node of [trigger, panel]) {
      node.removeEventListener('pointerenter', open); node.removeEventListener('pointerleave', scheduleClose);
    }
    trigger.removeEventListener('focus', open); trigger.removeEventListener('blur', scheduleClose);
    const remaining = (trigger.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== panel.id);
    if (remaining.length) trigger.setAttribute('aria-describedby', remaining.join(' ')); else trigger.removeAttribute('aria-describedby');
  } });
}
