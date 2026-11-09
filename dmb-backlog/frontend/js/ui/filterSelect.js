import { createPopover } from './popover.js';
import { escapeHtml as esc } from '../htmlUtils.js';
import { selectionList, filterSelectionList } from './selectionList.js';
import { filterPolicy } from './filterPolicy.js';
import { filterValues, encodeFilterValues, setFilterValue } from './filterValues.js';

// Explicit filter surfaces only: editing forms and pagination keep native selects.
export const FILTER_SELECT_SELECTOR = [
  '.filter-panel select', '.work-filter-panel select', '.an-control select',
  '.an-controls select', '.an-report-controls select', '.an-report-head select', '.admin-list-filter', '.admin-user-filter', '.audit-filter',
  'select[form="metric-filters"]',
  '.metric-period-bar select',
  'select[id*="-filter-"]', 'select[id$="-filter"]',
  '[id^="audit-filter-"]', '[data-directorate-filter]', '[data-meeting-filter]',
  '[data-reporting-team]', '[data-reporting-readiness]', '[data-team-weekly-team]',
  '#customer-status-filter', '#customer-request-sort', '#did-quarter',
  '#review-mode-filter', '#review-status-filter', '#review-sort',
  '#work-report-team', '#work-report-meeting', '[data-ui-filter-select]',
].join(',');

export function installFilterSelects(root = document) {
  const doc = root.ownerDocument || root;
  let active = null;
  const isFilter = node => node?.tagName === 'SELECT' && node.matches(FILTER_SELECT_SELECTOR);
  const mark = () => root.querySelectorAll(`select:is(${FILTER_SELECT_SELECTOR})`).forEach(select => {
    select.classList.add('ui-filter-select');
    const policy=filterPolicy(select);
    select.dataset.uiSelection=policy.mode;
    select.dataset.uiSelectionReason=policy.reason;
    if(select.hasAttribute('data-ui-filter-value')) {
      setFilterValue(select,select.dataset.uiFilterValue);delete select.dataset.uiFilterValue;
    }
    const slot = select.closest('label, .ui-field');
    if (slot) slot.classList.add('ui-filter-slot');
  });
  const labelFor = select => select.getAttribute('aria-label') ||
    select.labels?.[0]?.querySelector('.ui-field-label')?.textContent?.trim() ||
    select.labels?.[0]?.querySelector('span:not(.ui-icon)')?.textContent?.trim().replace(/:$/, '') || select.labels?.[0]?.textContent?.trim().replace(/:$/, '') || 'Фильтр';

  function open(select) {
    if (select.disabled) return;
    if (active?.select === select) { active.popover.close(); return; }
    active?.popover.close({restoreFocus:false});
    const label = labelFor(select);
    const options = [...select.options].filter(option=>!option.hasAttribute('data-ui-filter-summary'));
    const multiple=select.multiple || filterPolicy(select).mode==='multiple';
    const chosen=select.multiple?[...select.selectedOptions].map(option=>option.value):filterValues(select.value);
    chosen.filter(value=>!options.some(option=>option.value===value)).forEach(value=>{
      options.push(new Option(`Недоступное значение: ${value}`,value,true,true));
    });
    const allValue=options.some(option=>option.value==='')?'':options.some(option=>option.value==='any')?'any':options.some(option=>option.value==='all')?'all':null;
    if(!chosen.length&&allValue!==null)chosen.push(allValue);
    const panel = doc.createElement('div');
    panel.className = 'ui-filter-popover';
    panel.style.width = `${Math.max(320, select.closest('.ui-filter-slot')?.getBoundingClientRect().width || select.getBoundingClientRect().width)}px`;
    const items = options.map((option, index) => ({value:String(index), label:option.label, disabled:option.disabled || option.parentElement?.disabled}));
    panel.innerHTML = `<div class="ui-popover-header ui-popover-title">${esc(label)}</div>
      ${options.length > 7 ? '<div class="ui-popover-field"><input type="search" class="input ui-control" aria-label="Поиск значения" placeholder="Поиск значения…"></div>' : ''}
      <div class="ui-filter-options">${multiple ? selectionList({items, selected:options.flatMap((o,i)=>chosen.includes(o.value)?[String(i)]:[])}) :
        `<div class="ui-selection-list">${items.map((item,index)=>`<button type="button" class="ui-selection-option ui-filter-option" data-index="${index}" aria-pressed="${options[index].selected}" ${item.disabled?'disabled':''}><span>${esc(item.label)}</span><span aria-hidden="true">${options[index].selected?'✓':''}</span></button>`).join('') || '<div class="ui-popover-empty">Нет доступных значений</div>'}</div>`}</div>
      ${multiple ? '<div class="ui-popover-actions"><button type="button" class="btn btn-secondary btn-sm ui-btn" data-clear>Очистить</button><button type="button" class="btn btn-primary btn-sm ui-btn" data-apply>Применить</button></div>' : ''}`;
    const popover = createPopover({trigger:select,panel,label:`Фильтр: ${label}`,removeOnClose:true,onClose:()=>{active=null;}});
    active = {select,popover};
    const commit = () => {
      popover.close();
      select.dispatchEvent(new Event('input',{bubbles:true}));
      select.dispatchEvent(new Event('change',{bubbles:true}));
    };
    panel.addEventListener('click', event => {
      const option = event.target.closest('[data-index]');
      if (option && !option.disabled) { select.selectedIndex=Number(option.dataset.index); commit(); }
      if (event.target.closest('[data-clear]')) panel.querySelectorAll('input[type=checkbox]:not(:disabled)').forEach(input=>{input.checked=false;});
      if (event.target.closest('[data-apply]')) {
        const selected = new Set([...panel.querySelectorAll('input[type=checkbox]:checked')].map(input=>Number(input.value)));
        if(select.multiple)options.forEach((option,index)=>{if(!items[index].disabled)option.selected=selected.has(index);});
        else {
          const values=options.flatMap((option,index)=>selected.has(index)&&option.value!==allValue?[option.value]:[]);
          setFilterValue(select,values.length?encodeFilterValues(values):allValue??'');
        }
        commit();
      }
    });
    panel.addEventListener('change',event=>{
      if(event.target.type!=='checkbox'||!event.target.checked||allValue===null)return;
      const index=Number(event.target.value), isAll=options[index]?.value===allValue;
      panel.querySelectorAll('input[type=checkbox]').forEach(input=>{
        if(input!==event.target&&(isAll||options[Number(input.value)]?.value===allValue))input.checked=false;
      });
    });
    const search = panel.querySelector('input[type=search]');
    search?.addEventListener('input', event => filterSelectionList(panel.querySelector('.ui-selection-list'),event.target.value));
    search?.addEventListener('keydown', event => {
      if(event.key === 'ArrowDown') {
        event.preventDefault();
        const first=panel.querySelector('.ui-selection-option:not([hidden]):not(:disabled)');
        (first?.querySelector('input:not(:disabled)') || first)?.focus();
      }
    });
    popover.open();
  }
  const describe = event => {
    if(isFilter(event.target)) event.target.title=[...event.target.selectedOptions].map(option=>option.label).join(', ');
  };
  const pointer = event => { if (isFilter(event.target) && event.button === 0) {event.preventDefault();open(event.target);} };
  const click = event => {if(isFilter(event.target)) {event.preventDefault();if(event.detail===0 && !active)open(event.target);} };
  const keyboard = event => {
    if (!isFilter(event.target)) return;
    if (['Enter',' ','ArrowDown','ArrowUp','F4'].includes(event.key)) {event.preventDefault();open(event.target);}
  };
  root.addEventListener('pointerdown',pointer,true);
  root.addEventListener('click',click,true);
  root.addEventListener('keydown',keyboard,true);
  root.addEventListener('focusin',describe,true);
  root.addEventListener('pointerover',describe,true);
  // New routes and async filter fields join the same contract automatically.
  const observer = new MutationObserver(mark);
  observer.observe(root === doc ? doc.documentElement : root,{childList:true,subtree:true});
  mark();
  return () => {
    observer.disconnect();active?.popover.close({restoreFocus:false});
    root.removeEventListener('pointerdown',pointer,true);root.removeEventListener('click',click,true);root.removeEventListener('keydown',keyboard,true);
    root.removeEventListener('focusin',describe,true);root.removeEventListener('pointerover',describe,true);
  };
}
