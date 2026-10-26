import { test, expect } from '@playwright/test';

test('ECharts waits for Inter before its first layout',async({page})=>{
  let releaseFont;
  await page.route('**/fonts/InterVariable.woff2',route=>new Promise(resolve=>{releaseFont=async()=>{await route.continue();resolve();};}));
  await page.goto('/e2e/fixtures/uiKitAdminReports.html?surface=analytics&type=tribe',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#dep-chart')).toBeAttached();
  expect(await page.evaluate(()=>Boolean(window.echarts?.getInstanceByDom(document.getElementById('dep-chart'))))).toBe(false);
  await expect.poll(()=>typeof releaseFont).toBe('function');await releaseFont();
  await expect.poll(()=>page.evaluate(()=>Boolean(window.echarts?.getInstanceByDom(document.getElementById('dep-chart'))))).toBe(true);
  expect(await page.evaluate(()=>document.fonts.check('400 12px Inter','Проверка'))).toBe(true);
  expect(await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('dep-chart')).getOption().textStyle.fontFamily)).toContain('Inter');
  expect(await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('dep-chart')).getOption().tooltip[0].textStyle.fontFamily)).toContain('Inter');
  expect(await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('dep-chart')).getOption().legend[0].textStyle.fontFamily)).toContain('Inter');
});

for(const theme of ['light','dark'])for(const width of [1440,390])
test(`Inter renders Cyrillic and Latin at every UI weight: ${theme}/${width}`,async({page,browserName})=>{
  await page.setViewportSize({width,height:900});await page.goto('/ui-catalog/core.html');
  await page.evaluate(async theme=>{
    document.documentElement.dataset.theme=theme;
    for(const weight of [400,500,600,700]){
      const span=document.createElement('span');span.id='font-probe-'+weight;span.textContent='АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ абвгдеёжзийклмнопрстуфхцчшщъыьэюя Latin 0123456789';span.style.fontWeight=String(weight);document.body.append(span);
    }
    await document.fonts.ready;
  },theme);
  expect(await page.evaluate(()=>[...document.fonts].some(f=>f.family.replace(/["']/g,'')==='Inter'&&f.status==='loaded'))).toBe(true);
  if(browserName!=='chromium')return; // CDP glyph inspection is Chromium-only; all engines check the loaded face above.
  const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
  const {root}=await cdp.send('DOM.getDocument');
  for(const weight of [400,500,600,700]){
    const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#font-probe-'+weight});
    const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});
    expect(fonts.length).toBeGreaterThan(0);
    for(const font of fonts){expect(font.isCustomFont).toBe(true);expect(font.familyName).toMatch(/Inter/);expect(font.glyphCount).toBeGreaterThan(0);}
  }
  await cdp.detach();
});

test('Chart.js waits for Inter before measuring labels on a cold load',async({page})=>{
  let releaseFont;
  await page.route('**/fonts/InterVariable.woff2',route=>new Promise(resolve=>{releaseFont=async()=>{await route.continue();resolve();};}));
  await page.goto('/e2e/fixtures/uiKitComposites.html?surface=report&kind=reg-directors',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#chart-report-status')).toBeAttached();
  expect(await page.evaluate(()=>Boolean(window.Chart?.getChart('chart-report-status')))).toBe(false);
  await expect.poll(()=>typeof releaseFont).toBe('function');await releaseFont();
  await page.evaluate(()=>document.fonts.ready);
  await expect.poll(()=>page.evaluate(()=>Boolean(window.Chart?.getChart('chart-report-status')))).toBe(true);
  const fonts=await page.evaluate(()=>{
    const c=Chart.getChart('chart-report-status'),p=c.options.plugins;
    return [c.options.font.family,p.title.font.family,p.legend.labels.font.family,p.tooltip.titleFont.family,p.tooltip.bodyFont.family,...Object.values(c.options.scales).map(s=>s.ticks.font.family)];
  });
  for(const font of fonts)expect(font).toContain('Inter');
  const widths=await page.evaluate(()=>{
    const c=Chart.getChart('chart-report-status'),s=c.scales.x;
    c.ctx.save();c.ctx.font=s._resolveTickFontOptions(0).string;
    const actual=s._getLabelSizes().widths[0],expected=c.ctx.measureText(s.ticks[0].label).width;c.ctx.restore();
    return {actual,expected};
  });
  expect(widths.actual).toBeCloseTo(widths.expected,1);
  for(const theme of ['dark','light']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    await expect.poll(()=>page.evaluate(()=>Chart.getChart('chart-report-status').options.font.family)).toContain('Inter');
  }
});
