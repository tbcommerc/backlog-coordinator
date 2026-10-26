import { test, expect } from '@playwright/test';
import { mockWorkspace } from './helpers/requirementWorkspace.mjs';

test('core typography roles apply without page adapters',async({page})=>{
  await page.goto('/ui-catalog/core.html');
  const label=page.locator('.ui-field .form-label').first();
  await expect(label).toHaveCSS('font-size','12px');await expect(label).toHaveCSS('font-weight','500');await expect(label).toHaveCSS('line-height','18px');
  await page.evaluate(async()=>{const{showFieldError}=await import('/js/uiFeedback.js');showFieldError(document.querySelector('input.ui-control'),'Укажите название рабочего элемента');});
  await expect(page.locator('.field-error-message')).toHaveCSS('font-size','14px');await expect(page.locator('.field-error-message')).toHaveCSS('line-height','21px');
});

test('bundled JetBrains Mono renders Russian, Latin and numbers at UI weights',async({page,browserName})=>{
  await page.goto('/ui-catalog/core.html');
  await page.evaluate(async()=>{
    for(const weight of [400,500,600,700]){
      const e=document.createElement('code');e.id='mono-'+weight;
      e.textContent='Заявка Ёё ID-12345 Latin';e.style.cssText=`font-family:var(--font-mono);font-size:14px;font-weight:${weight};display:block`;
      document.body.append(e);
    }
    // WebKit schedules font discovery after layout; ready may still refer to
    // the previous layout immediately after adding these probes.
    for(const weight of [400,500,600,700]){
      const faces=await document.fonts.load(`${weight} 14px "JetBrains Mono"`,'Заявка Ёё ID-12345 Latin');
      if(!faces.length)throw Error('Bundled monospace face is not declared');
    }
    await document.fonts.ready;
  });
  expect(await page.evaluate(()=>[...document.fonts].some(f=>f.family.replace(/["']/g,'')==='JetBrains Mono'&&f.status==='loaded'))).toBe(true);
  for(const weight of [400,500,600,700])expect(await page.locator('#mono-'+weight).evaluate(e=>getComputedStyle(e).fontFamily)).toContain('JetBrains Mono');
  if(browserName==='chromium'){
    const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
    const {root}=await cdp.send('DOM.getDocument');
    for(const weight of [400,500,600,700]){
      const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#mono-'+weight});
      const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});expect(fonts.length).toBeGreaterThan(0);
      for(const font of fonts){expect(font.isCustomFont).toBe(true);expect(font.familyName).toMatch(/JetBrains Mono/);}
    }
    await cdp.detach();
  }
});

for(const theme of ['auto','light','dark'])for(const width of [320,1440])
test(`requirement typography, text bounds and contrast: ${theme}/${width}`,async({page},info)=>{
  await page.emulateMedia({colorScheme:'light'});await page.setViewportSize({width,height:900});await mockWorkspace(page);
  await page.goto('/e2e/fixtures/requirementWorkspace.html#/agent-v2?session=doc-1');
  await page.getByRole('button',{name:'Материалы и история',exact:true}).waitFor();
  await page.evaluate(async theme=>{if(theme==='auto')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;await document.fonts.ready;},theme);
  const switches=page.locator('.agent-v2-view-switch .btn');
  for(const button of await switches.all()){
    await expect(button).toHaveCSS('font-weight','500');
    const bounds=await button.evaluate(e=>{const r=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);const t=range.getBoundingClientRect();return{left:t.left-r.left,right:r.right-t.right};});
    expect(bounds.left).toBeGreaterThanOrEqual(0);expect(bounds.right).toBeGreaterThanOrEqual(0);
  }
  const contrast=await page.locator('.agent-v2-journey li,.agent-v2-revision,.agent-v2-outline-more summary').evaluateAll(es=>{
    const rgb=s=>s.match(/[\d.]+/g).map(Number),lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
    return es.filter(e=>e.getClientRects().length).map(e=>{const layers=[];for(let n=e;n;n=n.parentElement)layers.unshift(getComputedStyle(n).backgroundColor);let bg=[255,255,255];for(const color of layers){const c=rgb(color),a=c[3]??1;bg=bg.map((v,i)=>c[i]*a+v*(1-a));}const l=lum(rgb(getComputedStyle(e).color)),b=lum(bg);return{text:e.textContent,ratio:(Math.max(l,b)+.05)/(Math.min(l,b)+.05)};});
  });
  for(const sample of contrast)expect(sample.ratio,sample.text).toBeGreaterThanOrEqual(4.5);
  await expect(page.locator('.agent-v2-section.is-empty .agent-v2-section-value').first()).toHaveCSS('font-style','normal');
  await page.screenshot({path:info.outputPath('requirements.png'),fullPage:true});
});

for(const theme of ['light','dark'])for(const [width,height] of [[320,568],[640,360]])
test(`B01 repeat discard stays in native modal with transient body focus: ${theme}/${width}`,async({page},info)=>{
  await page.setViewportSize({width,height});await page.goto('/e2e/fixtures/workResolution.html?theme='+theme);
  await page.locator('#open-resolution').click();await page.locator('#wr-placement').selectOption('project');
  for(let i=0;i<3;i++){
    await page.keyboard.press('Escape');const prompt=page.getByRole('alertdialog');await expect(prompt).toBeVisible();
    expect(await prompt.evaluate(e=>Boolean(e.closest('dialog:modal')))).toBe(true);
    await prompt.getByRole('button',{name:'Продолжить редактирование',exact:true}).click();
  }
  // Deterministically cover the focus gap, without force-click or a timing sleep.
  const bodyFocus=await page.evaluate(async()=>{
    const {confirmAction}=await import('/js/uiFeedback.js');
    document.activeElement.blur();const bodyFocus=document.activeElement===document.body;
    window.__confirmation=confirmAction({title:'Проверка владельца',message:'Открытый нативный диалог',confirmText:'Продолжить'});
    return bodyFocus;
  });
  expect(bodyFocus).toBe(true);
  const prompt=page.getByRole('alertdialog');await expect(prompt).toBeVisible();
  expect(await prompt.evaluate(e=>Boolean(e.closest('dialog:modal')))).toBe(true);
  await prompt.getByRole('button',{name:'Продолжить',exact:true}).click();expect(await page.evaluate(()=>window.__confirmation)).toBe(true);
  await page.keyboard.press('Escape');await page.getByRole('alertdialog').getByRole('button',{name:'Закрыть без сохранения',exact:true}).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);await expect(page.locator('#open-resolution')).toBeFocused();await page.screenshot({path:info.outputPath('closed.png')});
});

for(const fixture of ['uiKitExpress.html?theme=light','teamWeeklyReport.html','backlogAssistant.html'])
test(`meaningful text keeps the approved minimum: ${fixture}`,async({page},info)=>{
  await page.setViewportSize({width:1440,height:1000});await page.goto('/e2e/fixtures/'+fixture);await page.evaluate(()=>document.fonts.ready);
  const tiny=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getClientRects().length&&![...e.children].length&&e.textContent.trim()&&!e.closest('svg,script,style,.sr-only')&&e.getBoundingClientRect().width>1&&e.getBoundingClientRect().height>1&&parseFloat(getComputedStyle(e).fontSize)<12).map(e=>({tag:e.tagName,text:e.textContent.trim(),size:getComputedStyle(e).fontSize})));
  expect(tiny).toEqual([]);await page.screenshot({path:info.outputPath('typography.png'),fullPage:true});
});
