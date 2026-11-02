import {test,expect} from '@playwright/test';
import {mockApp} from './helpers/backlogMock.mjs';
const fingerprint=nav=>nav.evaluate(e=>{
 const style=(node,keys)=>Object.fromEntries(keys.map(k=>[k,getComputedStyle(node)[k]]));
 const keys=['height','minHeight','padding','fontFamily','fontSize','fontWeight','lineHeight','borderRadius','borderWidth','color','backgroundColor','opacity'];
 return {nav:style(e,['gap']),current:style(e.querySelector('[aria-current]'),keys),next:style([...e.querySelectorAll('button')].find(b=>b.textContent.trim()==='Далее'),keys),previous:style([...e.querySelectorAll('button')].find(b=>b.textContent.trim()==='Назад'),keys)};
});
for(const width of [320,1440])for(const surface of ['admin','backlog','team'])test(`pagination cross-screen ${surface}/${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.goto('/ui-catalog/core.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 await page.evaluate(async()=>{const {pagination}=await import('/js/ui/forms.js');document.querySelector('main').innerHTML=pagination({page:1,pages:3});await document.fonts.ready;});
 const canonical=await fingerprint(page.locator('.ui-pagination'));
 if(surface==='admin'){
  await page.goto('/e2e/fixtures/uiKitAdminReports.html?admin_tab=teams');
  await expect(page.locator('html')).toHaveAttribute('data-fixture-ready','true');
 }else{
  await mockApp(page,{count:205});await page.goto('/#/'+(surface==='team'?'team-backlog':'backlog'));
 }
 const nav=page.locator('.ui-pagination');await expect(nav).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);expect(await fingerprint(nav)).toEqual(canonical);
 await expect(nav.getByRole('button',{name:'Назад',exact:true})).toBeDisabled();
 await nav.getByRole('button',{name:'Страница 2',exact:true}).click();
 await expect(nav.locator('[aria-current="page"]')).toHaveText('2');
 await expect(nav.getByRole('button',{name:'Назад',exact:true})).toBeEnabled();
 if(surface==='admin')await expect(nav.getByRole('button',{name:'Далее',exact:true})).toBeDisabled();
 else {await nav.getByRole('button',{name:'Страница 3',exact:true}).click();await expect(nav.getByRole('button',{name:'Далее',exact:true})).toBeDisabled();}
 await nav.getByRole('button',{name:'Страница 1',exact:true}).click();await expect(nav.getByRole('button',{name:'Назад',exact:true})).toBeDisabled();
 expect(await nav.evaluate(e=>e.getBoundingClientRect().width)).toBeLessThanOrEqual(width);
 for(const b of await nav.locator('button').all()){await expect(b).toHaveClass(/ui-btn/);await expect(b).toHaveCSS('font-family',/Inter/);}
});
