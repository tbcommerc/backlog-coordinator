import { escapeHtml as esc } from '../htmlUtils.js';

// primary and secondary are trusted component markup.
export function splitPane({ id, label = 'Ширина правой панели', primary = '', secondary = '', className = '' } = {}) {
  if (!id) throw new TypeError('SplitPane requires id');
  return `<div id="${esc(id)}" class="ui-split-pane ${esc(className)}"><div data-split-primary>${primary}</div><div data-split-handle role="separator" tabindex="0" aria-orientation="vertical" aria-label="${esc(label)}"></div><div data-split-secondary>${secondary}</div></div>`;
}

const owners = new WeakMap();
export function bindSplitPane(root, { size = 560, min = 320, max = 760, minPrimary = 320, breakpoint = 900, onResize } = {}) {
  owners.get(root)?.destroy();
  const handle = root.querySelector('[data-split-handle]');
  if (!handle || !Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) throw new TypeError('SplitPane requires a handle and valid limits');
  const hadClass = root.classList.contains('ui-split-pane'), oldSize = root.style.getPropertyValue('--ui-split-size');
  const oldActive=root.getAttribute('data-ui-split-active');
  const originalAttrs=new Map(['hidden','aria-valuemin','aria-valuemax','aria-valuenow','aria-valuetext'].map(name=>[name,handle.getAttribute(name)]));
  root.classList.add('ui-split-pane');
  let wanted = Number.isFinite(Number(size)) ? Number(size) : min, current, enabled = true, dragging = null, disposed = false;
  const bounds = () => { const high = Math.max(0, Math.min(max, root.clientWidth - minPrimary - 12)); return {low:Math.min(min,high),high}; };
  function sync() {
    if (disposed) return;
    const active = enabled && root.clientWidth >= breakpoint;
    root.dataset.uiSplitActive = String(active); handle.hidden = !active;
    if (!active) { stop(); return; }
    const {low,high} = bounds(); current = Math.max(low, Math.min(high, wanted));
    root.style.setProperty('--ui-split-size', current + 'px');
    handle.setAttribute('aria-valuemin',String(low)); handle.setAttribute('aria-valuemax',String(high)); handle.setAttribute('aria-valuenow',String(current)); handle.setAttribute('aria-valuetext',`${Math.round(current)} пикселей`);
  }
  function setSize(value, notify = true) {
    if (disposed || !Number.isFinite(Number(value))) return;
    wanted = Math.max(min,Math.min(max,Math.round(Number(value)))); sync();
    if (notify) onResize?.(wanted);
  }
  const move = event => { if (dragging !== event.pointerId) return; setSize(root.getBoundingClientRect().right-event.clientX); };
  function stop() {
    if (dragging != null && handle.hasPointerCapture?.(dragging)) handle.releasePointerCapture(dragging);
    dragging = null; root.removeAttribute('data-ui-resizing');
  }
  const down = event => {
    if (event.button !== 0 || handle.hidden) return;
    event.preventDefault(); dragging = event.pointerId; handle.setPointerCapture(event.pointerId); handle.focus(); root.dataset.uiResizing='true';
  };
  const key = event => {
    if (handle.hidden || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();
    const {low,high}=bounds(),step=event.shiftKey?50:10;
    setSize(event.key==='Home'?low:event.key==='End'?high:current+(event.key==='ArrowLeft'?step:-step));
  };
  handle.addEventListener('pointerdown',down);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);handle.addEventListener('lostpointercapture',stop);handle.addEventListener('keydown',key);
  const observer=new ResizeObserver(sync);observer.observe(root);sync();
  const controller={setSize,setActive(value){enabled=!!value;sync();},get size(){return current;},destroy(){
    if(disposed)return;stop();disposed=true;observer.disconnect();
    handle.removeEventListener('pointerdown',down);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',stop);handle.removeEventListener('pointercancel',stop);handle.removeEventListener('lostpointercapture',stop);handle.removeEventListener('keydown',key);
    if(oldActive==null)root.removeAttribute('data-ui-split-active');else root.setAttribute('data-ui-split-active',oldActive);
    for(const [name,value]of originalAttrs){if(value==null)handle.removeAttribute(name);else handle.setAttribute(name,value);}
    if(oldSize)root.style.setProperty('--ui-split-size',oldSize);else root.style.removeProperty('--ui-split-size');if(!hadClass)root.classList.remove('ui-split-pane');
    if(owners.get(root)===controller)owners.delete(root);
  }};
  owners.set(root,controller);return controller;
}
