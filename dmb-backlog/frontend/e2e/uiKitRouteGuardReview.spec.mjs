import {test,expect} from '@playwright/test';
for(const target of ['/admin','/kanban','/assistant-v2'])test('unsaved guard precedes access or redirect: '+target,async({page})=>{
 await page.goto('/ui-catalog/core.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 const result=await page.evaluate(async target=>{const {Router}=await import('/js/router.js');const calls=[];const app={store:{get:()=>({permissions:{admin:'none'}})},api:{get:async p=>{calls.push(p);return {board_enabled:true};}}};const router=new Router(app);router.lastHash='/metrics/71';router.onBeforeNavigate=async()=>false;history.replaceState(null,'','#'+target);document.querySelector('main').id='page-content';document.querySelector('main').innerHTML='<p>Несохранённая форма</p>';await router.handleRoute();return {hash:location.hash,text:document.querySelector('main').textContent,calls};},target);
 expect(result.hash).toBe('#/metrics/71');expect(result.text).toBe('Несохранённая форма');expect(result.calls).toEqual([]);
});

test('forbidden route updates breadcrumbs and allows returning to the previous renderer',async({page})=>{
 await page.goto('/ui-catalog/core.html');await expect(page.locator('html')).toHaveAttribute('data-ready','true');
 const result=await page.evaluate(async()=>{const {Router}=await import('/js/router.js');const app={store:{get:()=>({permissions:{admin:'none'}})}};const r=new Router(app);const main=document.querySelector('main');main.id='page-content';const bc=document.createElement('nav');bc.id='breadcrumb-nav';bc.textContent='Старая карточка';main.before(bc);r.lastHash='/example';r.renderedPath='/example';r.routes['/example']={render:()=>'<h1>Возвращённая страница</h1>'};history.replaceState(null,'','#/admin');await r.handleRoute();const denied={crumb:bc.textContent,last:r.lastHash,rendered:r.renderedPath};history.replaceState(null,'','#/example');await r.handleRoute();return {denied,returned:main.textContent};});
 expect(result.denied).toEqual({crumb:'Главная/Недостаточно прав',last:'/admin',rendered:'/admin'});expect(result.returned).toBe('Возвращённая страница');
});
