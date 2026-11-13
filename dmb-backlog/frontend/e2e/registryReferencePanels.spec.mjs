import {test,expect} from '@playwright/test';
import {setup} from './stickyRegistrySetup.mjs';
import {mockApp} from './helpers/backlogMock.mjs';
import {createRequire} from 'node:module';
const {PNG}=createRequire(import.meta.url)('../../node_modules/playwright-core/lib/utilsBundle.js');

async function requests(page,surface,theme){
 await mockApp(page);await page.addInitScript(t=>localStorage.setItem('dmb_theme',t),theme);
 const user={id:101,name:'Мария Соколова',role_name:'Администратор',permissions:{review:'all',customer_portal_mode:'all'}};
 await page.route('**/api/v1/auth/**',r=>r.fulfill({json:new URL(r.request().url()).pathname.endsWith('/me')?user:{access_token:'fixture',user}}));
 const row={id:101,kind:'request',status:'in_review',title:'Автоматизация сверки расчётных инструкций',author_name:'Анна Смирнова',team_name:'Продукт',created_at:'2026-11-06T09:00:00Z',updated_at:'2026-11-10T10:30:00Z',available_actions:[]};
 await page.route('**/api/v1/agent/requests/registry**',r=>r.fulfill({json:{items:[row],total:1,counts:{new:1},options:{teams:[],customers:[],coordinators:[]}}}));
 await page.route('**/api/v1/customer/queue**',r=>r.fulfill({json:{items:[row],total:1,pages:1,page:1,counts:{all:1},warnings:[],preferred_draft:null}}));
 await page.route('**/api/v1/agent/session',r=>r.fulfill({json:{active:false}}));
 await page.goto('/#/'+surface);
}

for(const surface of ['metrics','projects','work','review','customer'])for(const [theme,width] of [['light',1440],['dark',1440],['light',390]]){
 test(`reference composition ${surface} ${theme} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:width<700?844:900});
  if(['review','customer'].includes(surface))await requests(page,surface,theme);else await setup(page,surface,theme);
  const root=page.locator(`.ui-registry-reference[data-registry-reference=${surface}]`);
  await expect(root).toBeVisible();await expect(root.locator('.ui-reference-panel')).toBeVisible();
  await page.waitForFunction(()=>document.querySelector('link[data-registry-reference]')?.sheet);
  await expect(root.locator('input[type=search]').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath('full-screen.png'),fullPage:true,animations:'disabled'});
  if(surface==='work'){
   await expect(page.getByRole('button',{name:'Список',exact:true})).toBeVisible();
   if(width<700){await page.locator('#work-view').selectOption('all');await expect(page).toHaveURL(/view=all/);}
  }
  const quick=root.locator('[data-reference-quick]');
  if(width<700&&await quick.count()){await quick.click();await expect(root.locator('.ui-reference-quick')).toBeVisible();await quick.click();await expect(root.locator('.ui-reference-quick')).toBeHidden();}
  if(surface==='customer')return;
  const toggle=root.locator(surface==='work'?'[data-work-action=filters]':'button').filter({hasText:'Все фильтры'});
  await toggle.click();
  const extra=root.locator({metrics:'#qmetric-filter-extra',projects:'#project-catalog-filters',review:'#review-filters-panel',work:'.work-extra-filters'}[surface]);
  await expect(extra).toBeVisible();
  await page.screenshot({path:info.outputPath('all-filters.png'),fullPage:true,animations:'disabled'});
  if(surface==='work')await root.locator('[data-work-action=cancel-filters]').last().click();else await toggle.click();
  await expect(extra).toBeHidden();
  await expect(root.locator(surface==='work'?'.work-toolbar-primary':'.ui-reference-pins')).toBeVisible();
 });
}

for(const theme of ['light','dark'])test(`Backlog unchanged after visiting new panels ${theme}`,async({page},info)=>{
 await page.setViewportSize({width:1440,height:900});await setup(page,'backlog',theme);
 await expect(page.locator('#tasks-tbody tr').first()).toBeVisible();
 await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({animations:'disabled'});
 const before=await page.screenshot({path:info.outputPath('backlog-before.png'),animations:'disabled'});
 await page.goto('/#/metrics');await expect(page.locator('.ui-reference-pins')).toBeVisible();
 await page.goto('/#/work-projects?cview=table');await expect(page.locator('.ui-reference-pins')).toBeVisible();
 await page.goto('/#/backlog');await expect(page.locator('#tasks-tbody tr').first()).toBeVisible();
 await expect(page.locator('.ui-registry-reference')).toHaveCount(0);
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({animations:'disabled'});
 const after=await page.screenshot({path:info.outputPath('backlog-after.png'),animations:'disabled'});
 const a=PNG.sync.read(before),b=PNG.sync.read(after);
 expect([b.width,b.height]).toEqual([a.width,a.height]);
 let different=0;for(let i=0;i<a.data.length;i+=4)if(!a.data.subarray(i,i+4).equals(b.data.subarray(i,i+4)))different++;
 // Same 80-pixel rasterisation tolerance as the Windows design suite.
 // Only antialiasing of the avatar/chevrons differs after lazy routes load.
 expect(different).toBeLessThanOrEqual(80);
 await page.locator('#f-backlog-search').fill('Проверка');await expect(page.locator('#f-backlog-search')).toHaveValue('Проверка');
});
