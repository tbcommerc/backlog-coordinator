import {showFieldError,clearFieldError} from '../uiFeedback.js';

// Field IDs are keys; messages are text. Focus goes to the first error once.
export function showFormErrors(form,errors={}) {
  form.querySelector('[data-ui-error-summary]')?.remove();
  const entries=Object.entries(errors).map(([id,message])=>[form.querySelector(`[id="${CSS.escape(id)}"]`),String(message)]).filter(([field])=>field);
  if(!entries.length)return;
  const summary=document.createElement('div');summary.className='ui-alert ui-form-error-summary';summary.dataset.uiErrorSummary='';summary.dataset.uiTone='danger';summary.setAttribute('role','alert');
  const title=document.createElement('strong');title.textContent=`Проверьте поля: ${entries.length}`;summary.append(title);const list=document.createElement('ul');summary.append(list);
  for(const [field,message] of entries){showFieldError(field,message,{focus:false});const link=document.createElement('a');link.className='ui-link';link.href='#'+encodeURIComponent(field.id);link.textContent=message;link.addEventListener('click',e=>{e.preventDefault();field.focus();});const item=document.createElement('li');item.append(link);list.append(item);}
  form.prepend(summary);entries[0][0].focus();
}
export function clearFormErrors(form) {
  form.querySelector('[data-ui-error-summary]')?.remove();
  form.querySelectorAll('input,select,textarea').forEach(clearFieldError);
}
