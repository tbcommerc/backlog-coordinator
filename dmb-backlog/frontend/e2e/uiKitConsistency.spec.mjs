import { test, expect } from '@playwright/test';
import {writeFile} from 'node:fs/promises';

const surfaces = [
 ...['review','workTasks','workReports','workProjects','agentV1','agentV2','assistant'].map(surface=>[surface,`uiKitConsistency.html?surface=${surface}`]),
 ['analytics','uiKitAdminReports.html?surface=analytics&type=tribe'],
 ['reports','uiKitAdminReports.html?surface=reports'],
 ['customer','uiKitAdminReports.html?surface=customer'],
 ['directorate','uiKitAdminReports.html?surface=directorate'],
 ['meetings','uiKitAdminReports.html?surface=meetings'],
 ['audit','uiKitRegistries.html?surface=audit'],
 ['outbox','uiKitRegistries.html?surface=outbox'],
 ['notifications','uiKitRegistries.html?surface=notifications'],
 ['settings','uiKitSettings.html?'], ['express','uiKitExpress.html?'],
 ['statuses','uiKitReportingWorkspaces.html?surface=statuses'],
 ['quarterly','uiKitReportingWorkspaces.html?surface=quarterly'],
 ['kanban','uiKitComposites.html?surface=kanban'],
 ['report-table','uiKitComposites.html?report=quarterly-goals'],
 ['task-card','taskCardIncrement.html?surface=card'],
];
for (const [theme,compact,width] of [['light',false,1440],['dark',false,1440],['light',true,1440],['dark',false,390]]) {
 test(`same components share computed styles: ${theme}/${compact}/${width}`,async({page},info)=>{
  test.setTimeout(180000);
  const violations=[];
  for (const [name,url] of surfaces) {
   await page.setViewportSize({width,height:1000});
   await page.goto(`/e2e/fixtures/${url}&theme=${theme}&compact=${compact}`);
   await page.waitForFunction(()=>document.documentElement.dataset.fixtureReady==='true'||document.documentElement.dataset.ready==='true');
   await page.evaluate(({theme,compact})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.compact=String(compact);},{theme,compact});
   await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important;}'});
   await page.evaluate(()=>document.fonts.ready);
   const differences=await page.evaluate(()=>{
    const read=(e,keys)=>{const s=getComputedStyle(e);return Object.fromEntries(keys.map(k=>[k,s[k]]));};
    const root=document.createElement('div');root.style.cssText='position:fixed;left:-10000px;top:0';document.body.append(root);
    const failures=[];
    for(const actual of document.querySelectorAll('.btn')){
     if(root.contains(actual)||!actual.getClientRects().length||actual.closest('[hidden]'))continue;
     const variant=['primary','secondary','ghost','danger','success'].find(x=>actual.classList.contains('btn-'+x));
     if(!variant)continue;
     const ref=document.createElement('button');ref.className='btn btn-'+variant+' '+[...actual.classList].filter(c=>['btn-xs','btn-sm','btn-lg','btn-icon','square-icon','ui-responsive-icon'].includes(c)).join(' ');ref.textContent='Reference';ref.disabled=actual.disabled;root.append(ref);
     ref.classList.toggle('ui-btn',actual.classList.contains('ui-btn'));
     for(const state of ['active','is-active'])ref.classList.toggle(state,actual.classList.contains(state));
     for(const attr of ['aria-pressed','aria-selected','aria-busy'])if(actual.hasAttribute(attr))ref.setAttribute(attr,actual.getAttribute(attr));
     const keys=['fontFamily','fontSize','fontWeight','lineHeight','borderRadius','backgroundColor','color','borderTopColor','paddingTop','paddingBottom','minHeight'];
     const a=read(actual,keys),b=read(ref,keys);const delta=Object.fromEntries(keys.filter(k=>a[k]!==b[k]).map(k=>[k,[a[k],b[k]]]));
     if(actual.matches('.btn-icon,.square-icon')&&Math.abs(actual.getBoundingClientRect().width-actual.getBoundingClientRect().height)>1)delta.square=[actual.getBoundingClientRect().width,actual.getBoundingClientRect().height];
     if(Object.keys(delta).length)failures.push({type:'button',label:actual.id||actual.textContent.trim().slice(0,35)||actual.className,delta});ref.remove();
    }
    for(const actual of document.querySelectorAll('input.input,select.input,textarea.ui-control')){
     if(!actual.getClientRects().length||actual.matches('[type="checkbox"],[type="radio"],[type="range"],[type="file"],[multiple]'))continue;
     const ref=document.createElement(actual.tagName);ref.className='input ui-control '+[...actual.classList].filter(c=>/^input-(xs|sm|lg)$/.test(c)).join(' ');if(actual.tagName==='INPUT')ref.type=actual.type;ref.disabled=actual.disabled;ref.readOnly=actual.readOnly;root.append(ref);
     for(const attr of ['aria-invalid','size'])if(actual.hasAttribute(attr))ref.setAttribute(attr,actual.getAttribute(attr));
     const keys=['fontFamily','fontWeight','fontSize','borderRadius','backgroundColor','color',...(parseFloat(getComputedStyle(actual).borderTopWidth)>0?['borderTopColor']:[]),'lineHeight',...(actual.tagName==='TEXTAREA'?[]:['height','minHeight','paddingTop','paddingBottom'])];
     const a=read(actual,keys),b=read(ref,keys);const delta=Object.fromEntries(keys.filter(k=>a[k]!==b[k]).map(k=>[k,[a[k],b[k]]]));
     if(Object.keys(delta).length)failures.push({type:'field',label:actual.id||actual.className,delta});ref.remove();
    }
    for(const actual of document.querySelectorAll('.badge')){
     if(root.contains(actual)||!actual.getClientRects().length)continue;
     const ref=document.createElement('span');ref.className='badge ui-badge';if(actual.dataset.uiTone)ref.dataset.uiTone=actual.dataset.uiTone;ref.textContent='Reference';root.append(ref);
     const keys=['fontFamily','fontSize','fontWeight','lineHeight','borderRadius','paddingTop','paddingBottom','borderTopWidth',...(actual.dataset.uiTone?['backgroundColor','color']:[])];const a=read(actual,keys),b=read(ref,keys);
     const delta=Object.fromEntries(keys.filter(k=>a[k]!==b[k]).map(k=>[k,[a[k],b[k]]]));
     if(Object.keys(delta).length)failures.push({type:'badge',label:actual.textContent.trim().slice(0,35),delta});ref.remove();
    }
    for(const table of document.querySelectorAll('.ui-table-data,.ui-table-admin,.ui-table-editor')){
     const ref=document.createElement('table');ref.className='ui-table '+(table.classList.contains('ui-table-editor')?'ui-table-editor':'ui-table-data');ref.innerHTML='<thead><tr><th>Header</th></tr></thead>';root.append(ref);
     for(const attr of ['data-ui-layout','data-ui-density'])if(table.hasAttribute(attr))ref.setAttribute(attr,table.getAttribute(attr));
     const keys=['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textTransform','backgroundColor','color','paddingTop','paddingBottom','paddingLeft','paddingRight'];const expected=read(ref.querySelector('th'),keys);
     for(const th of table.querySelectorAll(':scope > thead > tr > th')){
      if(!th.getClientRects().length)continue;const current=read(th,keys);const delta=Object.fromEntries(keys.filter(k=>current[k]!==expected[k]).map(k=>[k,[current[k],expected[k]]]));
      if(!table.classList.contains('ui-table-editor')&&th.getBoundingClientRect().height+1<ref.querySelector('th').getBoundingClientRect().height)delta.headerHeight=[th.getBoundingClientRect().height,ref.querySelector('th').getBoundingClientRect().height];
      for(const sort of th.querySelectorAll('.table-sort-button,.did-sort')){
      const text=sort.querySelector('span')||sort;const visible=read(text,['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textTransform','color']);
       for(const key of Object.keys(visible))if(visible[key]!==expected[key])delta['sort.'+key]=[visible[key],expected[key]];
      }
      if(Object.keys(delta).length)failures.push({type:'table-header',label:table.className+':'+th.textContent.trim().slice(0,25),delta});
     }ref.remove();
    }
    for(const header of document.querySelectorAll('.ui-data-grid-head')){
     if(!header.getClientRects().length)continue;
     const ref=document.createElement('table');ref.className='ui-table ui-table-data';ref.innerHTML='<thead><tr><th>Header</th></tr></thead>';root.append(ref);
     const keys=['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textTransform','backgroundColor','color'];const a=read(header,keys),b=read(ref.querySelector('th'),keys);
     const delta=Object.fromEntries(keys.filter(k=>a[k]!==b[k]).map(k=>[k,[a[k],b[k]]]));if(Object.keys(delta).length)failures.push({type:'grid-header',label:header.className,delta});ref.remove();
    }
    // Whole semantic families and their visible subparts, not only .btn/.badge.
    for(const selector of ['.ui-filter-chip','.ui-kpi-card','.ui-avatar','.ui-progress','.ui-checkbox','.ui-tab','.ui-collapse-section']){
     for(const actual of document.querySelectorAll(selector)){
      if(root.contains(actual)||!actual.getClientRects().length)continue;
      const ref=actual.cloneNode(true);ref.removeAttribute('id');
      ref.className=[...actual.classList].filter(c=>c.startsWith('ui-')||c==='quick-filter-btn'||c==='active').join(' ');
      const host=document.createElement('div');
      if(actual.matches('.ui-tab')){host.className='ui-tabs';host.setAttribute('aria-orientation',actual.closest('[aria-orientation]')?.getAttribute('aria-orientation')||'horizontal');}
      root.append(host);host.append(ref);
      const parts=[actual,...actual.querySelectorAll('.quick-filter-label,.quick-filter-count,.quick-filter-icon,strong,summary,input,.ui-progress-track,.ui-progress-value')];
      const refs=[ref,...ref.querySelectorAll('.quick-filter-label,.quick-filter-count,.quick-filter-icon,strong,summary,input,.ui-progress-track,.ui-progress-value')];
      const keys=['fontFamily','fontSize','fontWeight','lineHeight','borderRadius','paddingTop','paddingBottom','minHeight','backgroundColor','color','opacity'];
      parts.forEach((part,i)=>{if(!part.getClientRects().length)return;const a=read(part,keys),b=read(refs[i],keys),delta=Object.fromEntries(keys.filter(k=>a[k]!==b[k]).map(k=>[k,[a[k],b[k]]]));if(Object.keys(delta).length)failures.push({type:selector,label:part.className||part.tagName,delta});});host.remove();
     }
    }
    root.remove();return failures;
   });
   for(const difference of differences)violations.push({surface:name,...difference});
   if(!compact&&width===1440&&['analytics','outbox','task-card','review','workTasks'].includes(name))await page.screenshot({path:info.outputPath(`${name}-${theme}.png`),fullPage:true});
  }
  await info.attach('computed-style-differences',{body:JSON.stringify(violations,null,2),contentType:'application/json'});
  await writeFile(info.outputPath('differences.json'),JSON.stringify(violations,null,2));
  expect(violations).toEqual([]);
 });
}
