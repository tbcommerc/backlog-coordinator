import { escapeHtml as esc } from '../htmlUtils.js';
import { attributes, icon } from './primitives.js';

// One parameter, exactly one selected value. Domain handlers own selection:
// cancelled/failed asynchronous changes must not move the indicator.
export function segmentedControl({label,items=[],value,attrs={},className='',size='default',disabled=false}={}) {
  if (!label) throw new TypeError('SegmentedControl requires an accessible label');
  const selected=items.findIndex(item=>String(item.value)===String(value));
  const entry=selected>=0&&!items[selected].disabled?selected:items.findIndex(item=>!item.disabled);
  return `<div class="ui-segmented ${esc(className)}" data-ui-size="${['small','large','extra-small'].includes(size)?size:'default'}"${attributes({...attrs,role:'group','aria-label':label,'aria-disabled':disabled||undefined})}><span class="ui-segment-thumb" aria-hidden="true"></span>${items.map((item,index)=>`<button type="button" class="ui-segment-item${item.iconOnly?' ui-segment-icon':''}${item.className?' '+esc(item.className):''}"${attributes({...item.attrs,'data-segment-value':item.value,'aria-pressed':index===selected,tabindex:!disabled&&index===entry?0:-1,disabled:disabled||item.disabled,...(item.iconOnly?{'aria-label':item.label,title:item.attrs?.title||item.label}:{})})}>${item.iconMarkup||icon(item.icon)}${item.iconOnly?'':`<span>${esc(item.label)}</span>`}${item.count!=null?`<span class="ui-segment-count">${esc(item.count)}</span>`:''}</button>`).join('')}</div>`;
}

const itemsOf=group=>[...group.children].filter(el=>el.matches('.ui-segment-item'));
function sync(group) {
  const items=itemsOf(group),selected=items.find(el=>el.getAttribute('aria-pressed')==='true');
  const disabled=group.getAttribute('aria-disabled')==='true';
  const entry=!disabled&&(selected&&!selected.disabled?selected:items.find(el=>!el.disabled));
  items.forEach(el=>{const tab=el===entry?0:-1;if(el.tabIndex!==tab)el.tabIndex=tab;});
  const thumb=group.querySelector(':scope > .ui-segment-thumb');
  if(!thumb)return;
  if(!selected||!group.getClientRects().length){group.removeAttribute('data-segment-ready');group.removeAttribute('data-segment-animate');return;}
  if(group.hasAttribute('data-segment-ready'))group.setAttribute('data-segment-animate','');
  thumb.style.width=selected.offsetWidth+'px';
  thumb.style.transform=`translateX(${selected.offsetLeft}px)`;
  group.setAttribute('data-segment-ready','');
}

// One installation on the stable SPA host covers lazy pages and dialogs.
// The disposer disconnects observers and releases removed groups.
export function installSegmentedControls(root=document) {
  const win=root.ownerDocument?.defaultView||root.defaultView||window;
  const groups=new Set();let frame=0,disposed=false,pendingFocus=null;
  const refresh=()=>{
    frame=0;if(disposed)return;
    for(const group of groups)if(!group.isConnected||!root.contains(group)){resize?.unobserve(group);groups.delete(group);}
    const found=[...(root.matches?.('.ui-segmented')?[root]:[]),...root.querySelectorAll('.ui-segmented')];
    for(const group of found){if(!groups.has(group)){groups.add(group);resize?.observe(group);}sync(group);}
    if(pendingFocus&&!pendingFocus.item.isConnected){
      const doc=root.ownerDocument||root;
      if(doc.activeElement===doc.body&&Date.now()-pendingFocus.time<2000){
        const replacement=found.find(g=>g.id===pendingFocus.id&&g.getAttribute('aria-label')===pendingFocus.label);
        replacement?.querySelector('.ui-segment-item[aria-pressed="true"]:not(:disabled)')?.focus();
      }
      pendingFocus=null;
    }
  };
  const schedule=()=>{if(!disposed&&!frame)frame=win.requestAnimationFrame(refresh);};
  const resize=win.ResizeObserver?new win.ResizeObserver(schedule):null;
  const mutations=new win.MutationObserver(schedule);
  mutations.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-pressed','aria-disabled','disabled','hidden','data-theme','dir']});
  const keydown=event=>{
    const item=event.target.closest?.('.ui-segment-item'),group=item?.parentElement;
    if(!group?.matches('.ui-segmented')||group.getAttribute('aria-disabled')==='true')return;
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey)return;
    const enabled=itemsOf(group).filter(el=>!el.disabled);if(!enabled.length)return;
    event.preventDefault();
    const rtl=win.getComputedStyle(group).direction==='rtl';
    const step=(event.key==='ArrowLeft'?-1:1)*(rtl?-1:1);
    const index=event.key==='Home'?0:event.key==='End'?enabled.length-1:(enabled.indexOf(item)+step+enabled.length)%enabled.length;
    const target=enabled[index];target.focus();pendingFocus={item:target,id:group.id,label:group.getAttribute('aria-label'),time:Date.now()};if(target!==item)target.click();schedule();
  };
  const click=event=>{if(event.target.closest?.('.ui-segmented[aria-disabled="true"]')){event.preventDefault();event.stopImmediatePropagation();}};
  root.addEventListener('keydown',keydown);root.addEventListener('click',click,true);
  win.addEventListener('resize',schedule);root.fonts?.ready.then(schedule);refresh();
  return ()=>{disposed=true;win.cancelAnimationFrame(frame);mutations.disconnect();resize?.disconnect();groups.clear();root.removeEventListener('keydown',keydown);root.removeEventListener('click',click,true);win.removeEventListener('resize',schedule);};
}
