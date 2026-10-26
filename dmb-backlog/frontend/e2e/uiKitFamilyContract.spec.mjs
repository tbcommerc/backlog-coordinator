import {test,expect} from '@playwright/test';

// Render production modules with in-memory responses; never connect to a DB.
const surfaces = [
 ...['teams','projects','businessCustomers','users','roles','home','dictionaries','display','reports','audit'].map(tab=>[`admin-${tab}`,`uiKitAdminReports.html?surface=admin&admin_tab=${tab}`]),
 ...['tribe','po-pl','it'].map(type=>[`analytics-${type}`,`uiKitAdminReports.html?surface=analytics&type=${type}`]),
 ...['dashboard','reports','directorate','customer','meetings'].map(surface=>[surface,`uiKitAdminReports.html?surface=${surface}`]),
 ['express','uiKitExpress.html?'],['settings','uiKitSettings.html?'],
 ...['audit','outbox','notifications'].map(surface=>[surface,`uiKitRegistries.html?surface=${surface}`]),
 ['kanban','uiKitComposites.html?surface=kanban'],
 ...['statuses','quarterly'].map(surface=>[surface,`uiKitReportingWorkspaces.html?surface=${surface}`]),
];
for(const [name,url] of surfaces) test(`family contract: ${name}`,async({browser})=>{
 test.setTimeout(120000);
 for(const [theme,compact,width,touch] of [['light',false,1280,false],['dark',true,1280,false],['light',true,390,false],['dark',false,1280,true]]) {
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:touch});const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`/e2e/fixtures/${url}&theme=${theme}&compact=${compact}`);
  await page.evaluate(({theme,compact})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.compact=String(compact);},{theme,compact});
  await expect(page.locator('#page-content')).not.toBeEmpty();
  await page.evaluate(()=>document.fonts.ready);
  const controls=await page.locator('#page-content').evaluate(root=>[...root.querySelectorAll('.btn,.iconbtn,input.input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),select.input:not([multiple])')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(e=>{
   const box=e.getBoundingClientRect(),s=getComputedStyle(e);
   return {name:e.textContent.trim().slice(0,60)||e.id||e.name,w:box.width,h:box.height,expected:parseFloat(s.getPropertyValue('--ui-size')),min:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--control-target-min')),square:e.matches('.square-icon,.btn-icon,.iconbtn'),single:e.matches('input,select')};
  }));
  for(const c of controls){
   const size=Math.max(c.expected||28,c.min||0);
   expect(c.h,`${theme}/${compact}/${width}/${name}: ${c.name}`).toBeGreaterThanOrEqual(size-0.1);
   if(c.square){expect(c.w,c.name).toBeCloseTo(c.h,0);expect(c.h,c.name).toBeCloseTo(size,0);}
   if(c.single)expect(c.h,c.name).toBeCloseTo(size,0);
  }
  expect(errors,`${name}: runtime errors`).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),`${name}: document overflow`).toBeLessThanOrEqual(1);
  if(name==='analytics-tribe') {
   const trigger=page.locator('[data-detail-target][role="button"]').first();
   await trigger.focus();await trigger.press('Enter');
   const detail=page.locator('.an-detail.is-open');await expect(detail).toBeVisible();
   const close=detail.getByRole('button',{name:'Закрыть детализацию'}), box=await close.boundingBox();
   expect(box.width).toBeCloseTo(box.height,0);expect(box.height).toBeGreaterThanOrEqual(width===390||touch?44:compact?24:28);
   await close.focus();await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);await expect(trigger).toBeFocused();
  }
  if(name==='analytics-tribe') {
   const trigger=page.locator('[data-detail-target][role="button"]').first();
   await trigger.focus();await trigger.press('Enter');
   const detail=page.locator('.an-detail.is-open');await expect(detail).toBeVisible();
   const close=detail.getByRole('button',{name:'Закрыть детализацию'}), box=await close.boundingBox();
   expect(box.width).toBeCloseTo(box.height,0);expect(box.height).toBeGreaterThanOrEqual(width===390||touch?44:compact?24:28);
   await close.focus();await page.keyboard.press('Escape');await expect(detail).toHaveCount(0);await expect(trigger).toBeFocused();
  }
  await context.close();
 }
});
