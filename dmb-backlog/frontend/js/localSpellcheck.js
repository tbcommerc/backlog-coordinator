const EXCLUDED_CONTROL_HINT = /(?:search|filter|email|password|url|link|jira|code|login|tag|token|identifier|phone|inn|snils|report-filter)/i;

let mutationObserver = null;

function controlHint(control) {
  return [control.id, control.name, control.className, control.getAttribute?.('aria-label')]
    .filter(value => typeof value === 'string')
    .join(' ');
}

export function isSpellcheckEligible(control) {
  if (!control || control.disabled || control.readOnly) return false;
  if (control.dataset?.spellcheck === 'off') return false;
  if (control.dataset?.spellcheck === 'on') return true;

  const tagName = String(control.tagName || '').toLowerCase();
  if (tagName === 'textarea') return true;
  if (tagName !== 'input') return false;

  const type = String(control.type || 'text').toLowerCase();
  if (type !== 'text') return false;
  if (String(control.inputMode || '').toLowerCase() === 'numeric') return false;
  return !EXCLUDED_CONTROL_HINT.test(controlHint(control));
}

export function prepareSpellcheckControl(control) {
  if (!control || control.dataset?.nativeSpellcheckReady === 'true') return;

  const enabled = isSpellcheckEligible(control);
  control.spellcheck = enabled;
  control.setAttribute('spellcheck', enabled ? 'true' : 'false');
  control.dataset.nativeSpellcheckReady = 'true';

  if (enabled && !control.lang) control.lang = 'ru';
}

function prepareTree(root) {
  if (root?.matches?.('input, textarea')) prepareSpellcheckControl(root);
  root?.querySelectorAll?.('input, textarea').forEach(prepareSpellcheckControl);
}

export function initLocalSpellcheck(root = document.body) {
  if (!root) return;
  prepareTree(root);
  if (mutationObserver) return;

  mutationObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE) prepareTree(node);
    }));
  });
  mutationObserver.observe(root, { childList: true, subtree: true });
}
