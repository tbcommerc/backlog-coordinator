import {button,icon} from './primitives.js';

// Explicit opt-in composition. Backlog never imports or mounts this variant.
export function mountRegistryPanel(root, kind) {
 if(!root)return;
 if(!document.querySelector('link[data-registry-reference]')){
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('../../css/ui/registry-panel.css',import.meta.url).href;css.dataset.registryReference='';document.head.append(css);
 }
 root.classList.add('ui-registry-reference');root.dataset.registryReference=kind;
 const header=root.querySelector('.ui-page-header');
 header?.classList.add('ui-page-header-inline-context','ui-page-header-compact-actions');
 const actions=header?.querySelector('.ui-registry-actions,.toolbar-actions');
 header?.querySelectorAll('#review-count,#customer-requests-count').forEach(el=>el.classList.add('sr-only'));
 actions?.classList.add('toolbar-actions');
 header?.querySelectorAll('.btn').forEach(el=>el.classList.add('btn-sm'));
 header?.querySelectorAll('.ui-segmented').forEach(el=>el.dataset.uiSize='small');
 header?.querySelectorAll('.btn-primary,.btn-ai-primary').forEach(el=>el.classList.add('ui-btn-mobile-icon'));
 if(kind==='metrics'){
  const period=header?.querySelector('.qmetric-header-period');if(period&&actions)actions.prepend(period);
  period?.querySelectorAll('.ui-control').forEach(el=>el.classList.add('input-sm'));
 }
 if(kind==='work'&&actions){
  const create=actions.querySelector('[data-work-create-slot]');if(create)actions.prepend(create);
  actions.querySelectorAll('.btn-ghost').forEach(el=>el.classList.replace('btn-ghost','btn-secondary'));
  const collection=root.querySelector('.work-mobile-collection'),form=root.querySelector('.work-filter-panel');
  if(collection&&form&&collection.parentElement===form.querySelector('.work-filters')){
   form.before(collection);
   collection.addEventListener('change',event=>form.onchange?.(event));
  }
 }
 const panels={metrics:'.filter-panel',projects:'.project-catalog-search',review:'.ui-registry-search-row',customer:'.ui-registry-search-row',work:'.work-toolbar'};
 const panel=root.querySelector(panels[kind]);if(!panel)return;
 panel.classList.add('ui-reference-panel');
 panel.querySelectorAll('.btn').forEach(el=>el.classList.add('btn-sm'));
 panel.querySelectorAll('input:not([type=hidden]),select').forEach(el=>el.classList.add('input-sm'));
 if(kind==='customer'){
  const create=root.querySelector('#customer-primary-action'),refresh=root.querySelector('#refresh-requests-btn');
  if(create){create.classList.replace('btn-ai-primary','btn-primary');if(!create.dataset.sessionId){const ico=create.querySelector('svg,i');if(ico)ico.outerHTML=icon('plus');}}
  if(refresh)actions.append(refresh);
  const sort=root.querySelector('.ui-registry-sort');if(sort)panel.insertBefore(sort,root.querySelector('#customer-reset'));
  const collections=root.querySelector('.ui-registry-collections'),mobile=root.querySelector('.ui-registry-mobile-collection');
  if(collections)panel.after(collections);if(mobile)collections?.after(mobile);
  return;
 }
 if(kind==='projects'){
  const count=root.querySelector('#project-search-count');if(count){count.classList.add('ui-reference-result-count');root.querySelector('.project-catalog-toolbar')?.after(count);}
  const group=header?.querySelector('.ui-segmented'),table=group?.querySelector('[data-catalog-view=table]');if(table&&group.querySelector('.ui-segment-item')!==table)group.querySelector('.ui-segment-thumb')?.after(table);
  header?.querySelectorAll('.ui-segment-item').forEach(el=>{el.classList.add('ui-segment-icon');const text=el.querySelector('span');if(text){el.setAttribute('aria-label',text.textContent);el.title=text.textContent;text.classList.add('sr-only');}});
 }
 const config={
  metrics:['#qmetric-filter-extra','.qmetric-filter-more',['#qmetric-filter-team_id','#qmetric-filter-owner_id','#qmetric-filter-project_id','#qmetric-filter-metric_state','#qmetric-filter-scope']],
  projects:['#project-catalog-filters','.project-catalog-extra',['#catalog-team','#catalog-owner']],
  review:['#review-filters-panel','.ui-registry-filter-grid',['#review-mode-filter','#review-status-filter','#review-team_ids','#review-customer_ids','#review-coordinator_ids']]
 }[kind];
 if(config){
  const [extraSelector,homeSelector,selectors]=config,extra=root.querySelector(extraSelector),home=extra?.querySelector(homeSelector);
  if(extra&&home){
   let pins=panel.querySelector('.ui-reference-pins');if(!pins){pins=document.createElement('div');pins.className='ui-reference-pins';(kind==='metrics'?panel.querySelector('.filter-toolbar-row'):panel).append(pins);}
   pins.style.setProperty('--registry-pin-count',selectors.length);
   const place=()=>{for(const selector of selectors){const field=root.querySelector(selector)?.closest('.ui-field');if(!field)continue;const destination=extra.hidden?pins:home;if(field.parentElement!==destination)destination.append(field);field.classList.toggle('ui-field-inline',extra.hidden);field.querySelectorAll('.ui-control').forEach(el=>el.classList.toggle('input-sm',extra.hidden));}pins.hidden=!extra.hidden;};
   const labels={metrics:['Команда','Владелец','Проект','Состояние','Область'],review:['Режим','Стадия','Команда','Заказчик','Ответственный']}[kind];
   if(labels)selectors.forEach((selector,index)=>{const control=root.querySelector(selector),label=control?.closest('.ui-field')?.querySelector('.form-label');if(label){control.setAttribute('aria-label',control.getAttribute('aria-label')||label.textContent);label.textContent=labels[index]+':';}});
   place();
   if(!Object.hasOwn(extra.dataset,'referenceObserved')){extra.dataset.referenceObserved='';new MutationObserver(place).observe(extra,{attributes:true,attributeFilter:['hidden']});}
  }
 }
 const quick=root.querySelector({metrics:'.qmetric-signals',review:'#review-summary',work:'.work-focus-nav'}[kind]||'.no-reference-quick');
 if(quick&&!quick.previousElementSibling?.matches('[data-reference-quick]')){
  const wrap=document.createElement('div');wrap.innerHTML=button({label:'Быстрые фильтры',icon:'zap',size:'small',className:'ui-reference-quick-toggle',attrs:{'data-reference-quick':'','aria-expanded':false}});const toggle=wrap.firstElementChild;quick.before(toggle);quick.classList.add('ui-reference-quick');toggle.onclick=()=>{const expanded=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(expanded));quick.classList.toggle('is-expanded',expanded);};
 }
 if(quick)quick.previousElementSibling?.toggleAttribute('hidden',quick.hidden);
 window.lucide?.createIcons();
}
