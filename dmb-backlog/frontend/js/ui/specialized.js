import {escapeHtml as esc} from '../htmlUtils.js';
import {attributes,button} from './primitives.js';

export function segmentedControl({label,items=[],value,attrs={}}={}) {
  return `<div class="ui-segmented" role="group" aria-label="${esc(label)}">${items.map(item=>button({label:item.label,attrs:{...attrs,...item.attrs,'aria-pressed':item.value===value,disabled:item.disabled}})).join('')}</div>`;
}

export function rangeControl({id,label,value=0,min=0,max=100,step=1,disabled=false,attrs={}}={}) {
  if(!id||!label)throw new TypeError('Range requires id and label');
  return `<label class="ui-range" for="${esc(id)}"><span>${esc(label)}</span><input type="range"${attributes({...attrs,id,value,min,max,step,disabled})}></label>`;
}

export function fileUpload({id,label='Выберите файл',hint='',accept='',multiple=false,disabled=false,className='',inputAttrs={}}={}) {
  if(!id)throw new TypeError('Upload requires id');
  const describedBy=[inputAttrs['aria-describedby'],id+'-status'].filter(Boolean).join(' ');
  return `<label class="ui-upload ${esc(className)}" data-ui-state="${disabled?'disabled':'idle'}" for="${esc(id)}"><span id="${esc(id)}-label">${esc(label)}</span><input${attributes({...inputAttrs,'aria-labelledby':id+'-label',type:'file',id,accept:accept||undefined,multiple,disabled,'aria-describedby':describedBy})}><span id="${esc(id)}-status" data-upload-status role="status">${esc(hint)}</span></label>`;
}

// The caller owns transport, cancellation and domain limits. This owns presentation only.
export function setUploadState(root,state,message='') {
  if(!['idle','dragover','selected','uploading','cancelled','error','disabled'].includes(state))throw new TypeError('Unknown upload state');
  root.dataset.uiState=state;
  root.setAttribute('aria-busy',String(state==='uploading'));
  const input=root.querySelector('input[type=file]');
  if(input) { input.disabled=['disabled','uploading'].includes(state); input.setAttribute('aria-invalid',String(state==='error')); }
  let status=root.querySelector('[data-upload-status]');
  if(!status){status=document.createElement('span');status.dataset.uploadStatus='';status.setAttribute('role','status');root.append(status);}
  if(input?.id){
    status.id ||= `${input.id}-status`;
    const descriptions=new Set((input.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean));
    descriptions.add(status.id);input.setAttribute('aria-describedby',[...descriptions].join(' '));
  }
  status.textContent=message;
}

export function loadMore({loading=false,disabled=false,loaded=null,total=null,attrs={}}={}) {
  const count = loaded != null && total != null && Number.isFinite(Number(loaded)) && Number.isFinite(Number(total)) ? ` · ${Number(loaded)} из ${Number(total)}` : '';
  return button({label:loading?'Загружаем…':`Загрузить ещё${count}`,attrs:{...attrs,'data-ui-load-more':'',disabled:disabled||loading,'aria-busy':loading}});
}

export function cursorPagination({hasPrevious=false,hasNext=false,loading=false,label='Продолжение списка',previousAttrs={},nextAttrs={}}={}) {
  return `<nav class="ui-pagination" aria-label="${esc(label)}">${button({label:'Назад',variant:'ghost',attrs:{...previousAttrs,'data-cursor-direction':'previous',disabled:loading||!hasPrevious}})}${button({label:'Далее',variant:'ghost',attrs:{...nextAttrs,'data-cursor-direction':'next',disabled:loading||!hasNext}})}</nav>`;
}
