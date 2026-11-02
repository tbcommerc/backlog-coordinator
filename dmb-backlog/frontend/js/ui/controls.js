const busyControls = new WeakMap();

/** Repeated busy updates retain the original content and disabled state. */
export function setButtonBusy(control, busy, label) {
  if (!control) return;
  if (busy) {
    if (!busyControls.has(control)) busyControls.set(control, { html: control.innerHTML, label: control.textContent, disabled: control.disabled, ariaBusy: control.getAttribute('aria-busy') });
    control.disabled = true;
    control.setAttribute('aria-busy', 'true');
    const spinner = document.createElement('span');
    spinner.className = 'spinner ui-button-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label ?? busyControls.get(control).label;
    control.replaceChildren(spinner, text);
  } else {
    const original = busyControls.get(control);
    if (!original) return;
    control.innerHTML = original.html;
    control.disabled = original.disabled;
    if (original.ariaBusy == null) control.removeAttribute('aria-busy');
    else control.setAttribute('aria-busy', original.ariaBusy);
    busyControls.delete(control);
  }
}

// Also used by guarded, asynchronously rendered tab panels such as task cards.
export function tabNavigationTarget(root, event) {
  const vertical = root.getAttribute?.('aria-orientation') === 'vertical';
  const nextKey = vertical ? 'ArrowDown' : 'ArrowRight';
  const previousKey = vertical ? 'ArrowUp' : 'ArrowLeft';
  if (![nextKey, previousKey, 'Home', 'End'].includes(event.key)) return null;
  const enabled = [...root.querySelectorAll('[role="tab"]')].filter(tab => !tab.disabled);
  const index = enabled.indexOf(event.target.closest?.('[role="tab"]'));
  if (index < 0) return null;
  if (event.key === 'Home') return enabled[0];
  if (event.key === 'End') return enabled.at(-1);
  return enabled[(index + (event.key === nextKey ? 1 : -1) + enabled.length) % enabled.length];
}

/** Roving focus with manual activation: arrow keys do not trigger data requests. */
export function mountTabs(root, onSelect = () => {}) {
  const controls = [...root.querySelectorAll('[role="tab"]')];
  const choose = (tab) => {
    for (const item of controls) {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(item.getAttribute('aria-controls'));
      if (panel) panel.hidden = !active;
    }
    onSelect(tab.id);
  };
  const click = event => {
    const tab = event.target.closest('[role="tab"]');
    if (controls.includes(tab) && !tab.disabled) choose(tab);
  };
  const keydown = event => {
    const next = tabNavigationTarget(root, event);
    if (next) { event.preventDefault(); controls.forEach(tab => { tab.tabIndex = tab === next ? 0 : -1; }); next.focus(); }
  };
  root.addEventListener('click', click);
  root.addEventListener('keydown', keydown);
  return () => { root.removeEventListener('click', click); root.removeEventListener('keydown', keydown); };
}

// Keep the visual required marker aligned with native validity in dynamic forms.
export function setFieldRequired(control, required) {
  if (!control) return;
  control.required = Boolean(required);
  const label = control.labels?.[0];
  if (!label) return;
  let marker = label.querySelector('.required');
  if (required && !marker) {
    marker = document.createElement('span');
    marker.className = 'required'; marker.setAttribute('aria-hidden', 'true'); marker.textContent = ' *';
    label.append(marker);
  } else if (!required) marker?.remove();
}
