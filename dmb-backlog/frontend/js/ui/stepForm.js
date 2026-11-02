import { escapeHtml as esc } from '../htmlUtils.js';
import { button } from './primitives.js';

export function stepForm({ id, label = 'Этапы формы', steps = [], active, navigation = false, className = '' } = {}) {
  if (!id || !steps.length || steps.some(s => !s.id || !s.label) || new Set(steps.map(s => s.id)).size !== steps.length) throw new TypeError('StepForm requires id and unique labelled steps');
  active = steps.some(s => s.id === active) ? active : steps[0].id;
  return `<section id="${esc(id)}" class="ui-step-form ${esc(className)}"><ol class="ui-step-list" aria-label="${esc(label)}">${steps.map((s, i) => `<li data-step-id="${esc(s.id)}"${s.id === active ? ' aria-current="step"' : ''}><span class="ui-step-number" aria-hidden="true">${i + 1}</span> ${navigation ? button({label:s.label,variant:'ghost',attrs:{'data-step-go':s.id}}) : `<span>${esc(s.label)}</span>`}</li>`).join('')}</ol>${steps.filter(s => s.content !== undefined).map(s => `<section class="ui-step-panel" data-step-panel="${esc(s.id)}" aria-labelledby="${esc(id)}-${esc(s.id)}-title"${s.id !== active ? ' hidden' : ''}><h3 id="${esc(id)}-${esc(s.id)}-title" tabindex="-1">${esc(s.label)}</h3>${s.content}</section>`).join('')}<p class="sr-only" data-step-status role="status"></p></section>`;
}

// Projection API for workflows whose transitions are owned by server/business
// state (analysis, approval, save). It never triggers navigation or moves focus.
export function setStepForm(root, active) {
  const steps = [...root.querySelectorAll('[data-step-id]')];
  const index = steps.findIndex(s => s.dataset.stepId === String(active));
  if (index < 0) return false;
  steps.forEach((step, i) => {
    if (i === index) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
    step.dataset.stepState = i < index ? 'complete' : i === index ? 'current' : 'upcoming';
  });
  root.querySelectorAll('[data-step-panel]').forEach(panel => panel.hidden = panel.dataset.stepPanel !== String(active));
  const status = root.querySelector('[data-step-status]');
  const message = `Шаг ${index + 1} из ${steps.length}: ${steps[index].querySelector('button')?.textContent.trim() || steps[index].lastElementChild.textContent.trim()}`;
  if (status && status.textContent !== message) status.textContent = message;
  return true;
}

const owners = new WeakMap();
export function bindStepForm(root, { beforeChange, onChange, onError = () => {}, validate = true } = {}) {
  owners.get(root)?.destroy();
  const ids = [...root.querySelectorAll('[data-step-id]')].map(s => s.dataset.stepId);
  if (!ids.length) throw new TypeError('StepForm has no steps');
  let active = root.querySelector('[aria-current="step"]')?.dataset.stepId || ids[0], pending = false, disposed = false, generation = 0, resetTimer;
  const initialStep = active;
  const form = root.closest('form'), previousNoValidate = form?.noValidate;
  if (form && validate) form.noValidate = true;
  const invalid = scope => [...scope.querySelectorAll('input,select,textarea')].find(control => control.willValidate && !control.validity.valid);
  const panelFor = id => [...root.querySelectorAll('[data-step-panel]')].find(panel => panel.dataset.stepPanel === id);
  function show(id, focus = true) {
    if (!setStepForm(root, id)) return false;
    active = id;
    if (focus) panelFor(id)?.querySelector('h3')?.focus();
    return true;
  }
  async function goTo(id) {
    if (disposed || pending || !ids.includes(id) || id === active) return false;
    if (validate && ids.indexOf(id) > ids.indexOf(active)) {
      // Validate every skipped step as well; forward navigation cannot bypass
      // required data in an intermediate panel.
      for (let i = 0; i < ids.indexOf(id); i++) {
        const panel = panelFor(ids[i]), field = panel && invalid(panel);
        if (field) { show(ids[i], false); field.focus(); field.reportValidity(); return false; }
      }
    }
    const ticket = ++generation, from = active;
    pending = true; root.setAttribute('aria-busy', 'true');
    try {
      if (beforeChange && await beforeChange({from,to:id}) === false) return false;
      if (disposed || ticket !== generation || !root.isConnected) return false;
      show(id); onChange?.({from,to:id}); return true;
    } catch (error) { if (!disposed && ticket === generation) onError(error); return false; }
    finally { if (!disposed && ticket === generation) { pending = false; root.removeAttribute('aria-busy'); } }
  }
  const click = event => {
    const trigger = event.target.closest('[data-step-go],[data-step-next],[data-step-back]');
    if (!trigger || !root.contains(trigger) || trigger.disabled) return;
    event.preventDefault();
    goTo(trigger.dataset.stepGo || ids[ids.indexOf(active) + (trigger.hasAttribute('data-step-next') ? 1 : -1)]);
  };
  const submit = event => {
    if (pending) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    const field = validate && invalid(form);
    if (!field) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const panel = field.closest('[data-step-panel]');
    if (panel && root.contains(panel)) show(panel.dataset.stepPanel, false);
    field.focus(); field.reportValidity();
  };
  const reset = event => { clearTimeout(resetTimer); resetTimer=setTimeout(()=>{if(!disposed&&!event.defaultPrevented){generation++;pending=false;root.removeAttribute('aria-busy');show(initialStep);}},0); };
  root.addEventListener('click', click); if (form && validate) form.addEventListener('submit', submit, true);
  form?.addEventListener('reset',reset);
  setStepForm(root, active);
  const controller = { goTo, get active() { return active; }, setStep(id) { if(disposed)return false;generation++; pending = false; root.removeAttribute('aria-busy'); return show(id, false); }, destroy() {
    if (disposed) return;
    disposed = true; generation++; clearTimeout(resetTimer);root.removeAttribute('aria-busy'); root.removeEventListener('click', click);form?.removeEventListener('reset',reset);
    if (form && validate) { form.removeEventListener('submit', submit, true); form.noValidate = previousNoValidate; }
    if (owners.get(root) === controller) owners.delete(root);
  } };
  owners.set(root, controller); return controller;
}
